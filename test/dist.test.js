const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { bundlePlugin, parseDistArgs, __private } = require("../lib/dist");
const {
  cleanupTempDir,
  makeTempDir,
  readBundleEntries,
  writeJson,
  writeText,
} = require("./helpers");

test("parseDistArgs uses defaults", () => {
  const parsed = parseDistArgs([]);
  assert.equal(parsed.pluginDir, process.cwd());
  assert.equal(parsed.outDir, path.resolve("dist"));
  assert.equal(parsed.verbose, false);
  assert.equal(parsed.noNpmDeps, false);
});

test("parseDistArgs parses known flags", () => {
  const parsed = parseDistArgs([
    "--plugin-dir",
    "some/plugin",
    "--out",
    "some/out",
    "--no-npm-deps",
    "--verbose",
  ]);
  assert.equal(parsed.pluginDir, path.resolve("some/plugin"));
  assert.equal(parsed.outDir, path.resolve("some/out"));
  assert.equal(parsed.noNpmDeps, true);
  assert.equal(parsed.verbose, true);
});

test("parseDistArgs rejects unknown flag", () => {
  assert.throws(() => parseDistArgs(["--nope"]), /unknown flag: --nope/);
});

test("parseDistArgs requires plugin-dir value", () => {
  assert.throws(() => parseDistArgs(["--plugin-dir"]), /missing value for --plugin-dir/);
});

test("parseDistArgs requires out value", () => {
  assert.throws(() => parseDistArgs(["--out"]), /missing value for --out/);
});

test("parseDistArgs help returns usage error", () => {
  assert.throws(() => parseDistArgs(["--help"]), /openvcs dist \[args\]/);
});

test("readManifest parses and trims fields", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  writeText(
    path.join(pluginDir, "openvcs.plugin.json"),
    '{\n  "id": "  my.plugin  ",\n  "module": { "exec": "  module.mjs  " }\n}\n'
  );

  const parsed = __private.readManifest(pluginDir);
  assert.equal(parsed.pluginId, "my.plugin");
  assert.equal(parsed.moduleExec, "module.mjs");

  cleanupTempDir(root);
});

test("readManifest errors for missing manifest", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  fs.mkdirSync(pluginDir, { recursive: true });
  assert.throws(() => __private.readManifest(pluginDir), /missing openvcs\.plugin\.json/);
  cleanupTempDir(root);
});

test("readManifest errors for malformed JSON with path", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  writeText(path.join(pluginDir, "openvcs.plugin.json"), "{");

  assert.throws(
    () => __private.readManifest(pluginDir),
    new RegExp(`parse ${pluginDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
  );

  cleanupTempDir(root);
});

test("readManifest errors for empty id", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  writeJson(path.join(pluginDir, "openvcs.plugin.json"), { id: "   " });
  assert.throws(() => __private.readManifest(pluginDir), /missing a string 'id'/);
  cleanupTempDir(root);
});

test("readManifest rejects id with path separators", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  writeJson(path.join(pluginDir, "openvcs.plugin.json"), { id: "bad/id" });
  assert.throws(() => __private.readManifest(pluginDir), /must not contain path separators/);
  cleanupTempDir(root);
});

test("validateDeclaredModuleExec accepts .js/.mjs/.cjs", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export {};\n");
  writeText(path.join(pluginDir, "bin", "plugin.mjs"), "export {};\n");
  writeText(path.join(pluginDir, "bin", "plugin.cjs"), "module.exports = {};\n");

  assert.doesNotThrow(() => __private.validateDeclaredModuleExec(pluginDir, "plugin.js"));
  assert.doesNotThrow(() => __private.validateDeclaredModuleExec(pluginDir, "plugin.mjs"));
  assert.doesNotThrow(() => __private.validateDeclaredModuleExec(pluginDir, "plugin.cjs"));

  cleanupTempDir(root);
});

test("validateDeclaredModuleExec rejects non-node extension", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  writeText(path.join(pluginDir, "bin", "plugin.ts"), "export {};\n");
  assert.throws(
    () => __private.validateDeclaredModuleExec(pluginDir, "plugin.ts"),
    /must end with .js\/.mjs\/.cjs/
  );
  cleanupTempDir(root);
});

test("validateDeclaredModuleExec rejects absolute path", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export {};\n");
  assert.throws(
    () => __private.validateDeclaredModuleExec(pluginDir, path.resolve(pluginDir, "bin", "plugin.js")),
    /must be a relative path under bin/
  );
  cleanupTempDir(root);
});

test("validateDeclaredModuleExec rejects path traversal", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  writeText(path.join(pluginDir, "secret.js"), "export {};\n");
  assert.throws(
    () => __private.validateDeclaredModuleExec(pluginDir, "../secret.js"),
    /must point to a file under bin/
  );
  cleanupTempDir(root);
});

test("validateDeclaredModuleExec errors when file missing", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  fs.mkdirSync(path.join(pluginDir, "bin"), { recursive: true });
  assert.throws(
    () => __private.validateDeclaredModuleExec(pluginDir, "missing.mjs"),
    /module entrypoint not found/
  );
  cleanupTempDir(root);
});

test("copyIcon prefers png over jpg", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const bundleDir = path.join(root, "bundle");
  fs.mkdirSync(bundleDir, { recursive: true });
  writeText(path.join(pluginDir, "icon.jpg"), "jpg");
  writeText(path.join(pluginDir, "icon.png"), "png");

  __private.copyIcon(pluginDir, bundleDir);

  assert.equal(fs.readFileSync(path.join(bundleDir, "icon.png"), "utf8"), "png");
  assert.equal(fs.existsSync(path.join(bundleDir, "icon.jpg")), false);
  cleanupTempDir(root);
});

test("copyIcon is no-op when icon is absent", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const bundleDir = path.join(root, "bundle");
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.mkdirSync(bundleDir, { recursive: true });

  __private.copyIcon(pluginDir, bundleDir);

  for (const ext of __private.ICON_EXTENSIONS) {
    assert.equal(fs.existsSync(path.join(bundleDir, `icon.${ext}`)), false);
  }

  cleanupTempDir(root);
});

test("uniqueStagingDir uses expected prefix", () => {
  const staging = __private.uniqueStagingDir("/tmp/output");
  assert.match(path.basename(staging), /^\.openvcs-plugin-staging-/);
});

test("writeTarGz creates a valid gzip tar", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const baseDir = path.join(root, "base");
  const outPath = path.join(root, "bundle.ovcsp");
  writeText(path.join(baseDir, "myplugin", "file.txt"), "content");
  writeText(path.join(baseDir, "myplugin", "sub", "nested.txt"), "nested");

  await __private.writeTarGz(outPath, baseDir, "myplugin");
  const entries = await readBundleEntries(outPath);

  assert.equal(entries.has("myplugin/file.txt"), true);
  assert.equal(entries.has("myplugin/sub/nested.txt"), true);
  cleanupTempDir(root);
});

test("rejectNativeAddonsRecursive rejects .node files", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const modulesDir = path.join(root, "node_modules");
  writeText(path.join(modulesDir, "pkg", "addon.node"), "binary");
  assert.throws(() => __private.rejectNativeAddonsRecursive(modulesDir), /native Node addon/);
  cleanupTempDir(root);
});

test("rejectNativeAddonsRecursive allows normal files", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const modulesDir = path.join(root, "node_modules");
  writeText(path.join(modulesDir, "pkg", "index.js"), "module.exports = {};\n");
  assert.doesNotThrow(() => __private.rejectNativeAddonsRecursive(modulesDir));
  cleanupTempDir(root);
});

test("bundlePlugin writes a gzip .ovcsp for themes-only plugin", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const outDir = path.join(root, "out");

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), { id: "ui-only" });
  writeText(path.join(pluginDir, "themes", "default", "theme.json"), '{"name":"test"}\n');
  writeText(path.join(pluginDir, "icon.png"), "icon-bytes");

  const outPath = await bundlePlugin({ pluginDir, outDir, verbose: false, noNpmDeps: true });
  const entries = await readBundleEntries(outPath);

  assert.equal(path.basename(outPath), "ui-only.ovcsp");
  assert.equal(entries.has("ui-only/openvcs.plugin.json"), true);
  assert.equal(entries.has("ui-only/themes/default/theme.json"), true);
  assert.equal(entries.has("ui-only/icon.png"), true);

  cleanupTempDir(root);
});

test("bundlePlugin rejects manifest with no module and no themes", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const outDir = path.join(root, "out");
  writeJson(path.join(pluginDir, "openvcs.plugin.json"), { id: "x" });

  await assert.rejects(
    () => bundlePlugin({ pluginDir, outDir, verbose: false, noNpmDeps: true }),
    /manifest has no module\.exec or themes\//
  );

  cleanupTempDir(root);
});

test("bundlePlugin trims module.exec and includes extra bin files", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const outDir = path.join(root, "out");

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), {
    id: "x",
    module: { exec: "  module.mjs  " },
  });
  writeText(path.join(pluginDir, "bin", "module.mjs"), "export {};\n");
  writeText(path.join(pluginDir, "bin", "helpers", "util.mjs"), "export const x = 1;\n");

  const outPath = await bundlePlugin({ pluginDir, outDir, verbose: false, noNpmDeps: true });
  const entries = await readBundleEntries(outPath);

  assert.equal(entries.has("x/bin/module.mjs"), true);
  assert.equal(entries.has("x/bin/helpers/util.mjs"), true);
  cleanupTempDir(root);
});

test("bundlePlugin rejects module.exec path traversal", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const outDir = path.join(root, "out");

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), {
    id: "bad",
    module: { exec: "../secret.js" },
  });
  writeText(path.join(pluginDir, "secret.js"), "console.log('secret')\n");

  await assert.rejects(
    () => bundlePlugin({ pluginDir, outDir, verbose: false, noNpmDeps: true }),
    /module\.exec/
  );

  cleanupTempDir(root);
});

test("bundlePlugin rejects non-node module.exec extension", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const outDir = path.join(root, "out");

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), {
    id: "bad",
    module: { exec: "plugin.ts" },
  });
  writeText(path.join(pluginDir, "bin", "plugin.ts"), "export {};\n");

  await assert.rejects(
    () => bundlePlugin({ pluginDir, outDir, verbose: false, noNpmDeps: true }),
    /must end with .js\/.mjs\/.cjs/
  );

  cleanupTempDir(root);
});

test("bundlePlugin rejects plugin id with path separators", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const outDir = path.join(root, "out");

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), {
    id: "bad/id",
    module: { exec: "plugin.js" },
  });
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export {};\n");

  await assert.rejects(
    () => bundlePlugin({ pluginDir, outDir, verbose: false, noNpmDeps: true }),
    /must not contain path separators/
  );

  cleanupTempDir(root);
});

test("bundlePlugin rejects symlink in bin", async () => {
  if (process.platform === "win32") {
    return;
  }

  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const outDir = path.join(root, "out");

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), {
    id: "x",
    module: { exec: "plugin.js" },
  });
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export {};\n");
  writeText(path.join(pluginDir, "bin", "target.js"), "export {};\n");
  fs.symlinkSync(path.join(pluginDir, "bin", "target.js"), path.join(pluginDir, "bin", "link.js"));

  await assert.rejects(
    () => bundlePlugin({ pluginDir, outDir, verbose: false, noNpmDeps: true }),
    /symlink/
  );

  cleanupTempDir(root);
});

test("bundlePlugin output archive keeps plugin-id root directory", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const outDir = path.join(root, "out");

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), {
    id: "root-check",
    module: { exec: "plugin.js" },
  });
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export {};\n");

  const outPath = await bundlePlugin({ pluginDir, outDir, verbose: false, noNpmDeps: true });
  const entries = await readBundleEntries(outPath);
  for (const key of entries.keys()) {
    assert.equal(key.startsWith("root-check/"), true);
  }

  cleanupTempDir(root);
});

test("bundlePlugin overwrites existing bundle file", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const outDir = path.join(root, "out");
  fs.mkdirSync(outDir, { recursive: true });

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), {
    id: "replace",
    module: { exec: "plugin.js" },
  });
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export {};\n");

  const existingPath = path.join(outDir, "replace.ovcsp");
  writeText(existingPath, "not-a-tar");

  const outPath = await bundlePlugin({ pluginDir, outDir, verbose: false, noNpmDeps: true });
  const entries = await readBundleEntries(outPath);
  assert.equal(entries.has("replace/openvcs.plugin.json"), true);

  cleanupTempDir(root);
});

test("bundlePlugin generates package-lock when package.json exists", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const outDir = path.join(root, "out");

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), {
    id: "npm-plugin",
    module: { exec: "plugin.js" },
  });
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export {};\n");
  writeJson(path.join(pluginDir, "package.json"), {
    name: "npm-plugin",
    version: "0.1.0",
    private: true,
  });

  const outPath = await bundlePlugin({ pluginDir, outDir, verbose: false, noNpmDeps: false });
  const entries = await readBundleEntries(outPath);

  assert.equal(fs.existsSync(path.join(pluginDir, "package-lock.json")), true);
  assert.equal(entries.has("npm-plugin/package.json"), true);
  assert.equal(entries.has("npm-plugin/package-lock.json"), true);

  cleanupTempDir(root);
});

test("bundlePlugin with --no-npm-deps does not generate lockfile", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const outDir = path.join(root, "out");

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), {
    id: "no-npm",
    module: { exec: "plugin.js" },
  });
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export {};\n");
  writeJson(path.join(pluginDir, "package.json"), {
    name: "no-npm",
    version: "0.1.0",
    private: true,
  });

  await bundlePlugin({ pluginDir, outDir, verbose: false, noNpmDeps: true });

  assert.equal(fs.existsSync(path.join(pluginDir, "package-lock.json")), false);

  cleanupTempDir(root);
});
