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
    "--no-build",
    "--no-npm-deps",
    "--verbose",
  ]);
  assert.equal(parsed.pluginDir, path.resolve("some/plugin"));
  assert.equal(parsed.outDir, path.resolve("some/out"));
  assert.equal(parsed.noBuild, true);
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
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export function OnPluginStart() {}\n");
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
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export function OnPluginStart() {}\n");
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

  const outPath = await bundlePlugin({
    pluginDir,
    outDir,
    verbose: false,
    noBuild: true,
    noNpmDeps: true,
  });
  const entries = await readBundleEntries(outPath);

  assert.equal(path.basename(outPath), "ui-only.ovcsp");
  assert.equal(entries.has("ui-only/openvcs.plugin.json"), true);
  assert.equal(entries.has("ui-only/themes/default/theme.json"), true);
  assert.equal(entries.has("ui-only/icon.png"), true);

  cleanupTempDir(root);
});

test("bundlePlugin rejects manifest with no module, entry, or themes", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const outDir = path.join(root, "out");
  writeJson(path.join(pluginDir, "openvcs.plugin.json"), { id: "x" });

  await assert.rejects(
    () => bundlePlugin({ pluginDir, outDir, verbose: false, noBuild: true, noNpmDeps: true }),
    /manifest has no module\.exec, entry, or themes\//
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
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export function OnPluginStart() {}\n");
  writeText(path.join(pluginDir, "bin", "module.mjs"), "export {};\n");
  writeText(path.join(pluginDir, "bin", "helpers", "util.mjs"), "export const x = 1;\n");

  const outPath = await bundlePlugin({
    pluginDir,
    outDir,
    verbose: false,
    noBuild: true,
    noNpmDeps: true,
  });
  const entries = await readBundleEntries(outPath);

  assert.equal(entries.has("x/bin/plugin.js"), true);
  assert.equal(entries.has("x/bin/module.mjs"), true);
  assert.equal(entries.has("x/bin/helpers/util.mjs"), true);
  cleanupTempDir(root);
});

test("bundlePlugin builds code plugins before packaging", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const outDir = path.join(root, "out");

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), {
    id: "builder",
    module: { exec: "openvcs-plugin.js" },
  });
  writeJson(path.join(pluginDir, "package.json"), {
    name: "builder",
    private: true,
    scripts: {
      "build:plugin": "node ./scripts/build-plugin.js",
    },
  });
  writeText(
    path.join(pluginDir, "scripts", "build-plugin.js"),
    "const fs = require('node:fs');\nconst path = require('node:path');\nconst out = path.join(process.cwd(), 'bin', 'plugin.js');\nfs.mkdirSync(path.dirname(out), { recursive: true });\nfs.writeFileSync(out, 'export {};\\n', 'utf8');\n"
  );

  const outPath = await bundlePlugin({
    pluginDir,
    outDir,
    verbose: false,
    noBuild: false,
    noNpmDeps: true,
  });
  const entries = await readBundleEntries(outPath);

  assert.equal(entries.has("builder/bin/plugin.js"), true);
  assert.equal(entries.has("builder/bin/openvcs-plugin.js"), true);
  cleanupTempDir(root);
});

test("bundlePlugin with no-build requires prebuilt module entrypoint", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const outDir = path.join(root, "out");

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), {
    id: "prebuilt",
    module: { exec: "openvcs-plugin.js" },
  });

  await assert.rejects(
    () => bundlePlugin({ pluginDir, outDir, verbose: false, noBuild: true, noNpmDeps: true }),
    /compiled plugin module not found/
  );

  cleanupTempDir(root);
});

test("bundlePlugin errors when code plugin lacks build:plugin", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const outDir = path.join(root, "out");

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), {
    id: "missing-script",
    module: { exec: "openvcs-plugin.js" },
  });
  writeJson(path.join(pluginDir, "package.json"), {
    name: "missing-script",
    private: true,
    scripts: {},
  });

  await assert.rejects(
    () => bundlePlugin({ pluginDir, outDir, verbose: false, noBuild: false, noNpmDeps: true }),
    /build:plugin/
  );

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
    () => bundlePlugin({ pluginDir, outDir, verbose: false, noBuild: true, noNpmDeps: true }),
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
    () => bundlePlugin({ pluginDir, outDir, verbose: false, noBuild: true, noNpmDeps: true }),
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
    module: { exec: "openvcs-plugin.js" },
  });
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export function OnPluginStart() {}\n");
  writeText(path.join(pluginDir, "bin", "openvcs-plugin.js"), "export {};\n");

  await assert.rejects(
    () => bundlePlugin({ pluginDir, outDir, verbose: false, noBuild: true, noNpmDeps: true }),
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
    module: { exec: "openvcs-plugin.js" },
  });
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export function OnPluginStart() {}\n");
  writeText(path.join(pluginDir, "bin", "openvcs-plugin.js"), "export {};\n");
  writeText(path.join(pluginDir, "bin", "target.js"), "export {};\n");
  fs.symlinkSync(path.join(pluginDir, "bin", "target.js"), path.join(pluginDir, "bin", "link.js"));

  await assert.rejects(
    () => bundlePlugin({ pluginDir, outDir, verbose: false, noBuild: true, noNpmDeps: true }),
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
    module: { exec: "openvcs-plugin.js" },
  });
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export function OnPluginStart() {}\n");
  writeText(path.join(pluginDir, "bin", "openvcs-plugin.js"), "export {};\n");

  const outPath = await bundlePlugin({
    pluginDir,
    outDir,
    verbose: false,
    noBuild: true,
    noNpmDeps: true,
  });
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
    module: { exec: "openvcs-plugin.js" },
  });
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export function OnPluginStart() {}\n");
  writeText(path.join(pluginDir, "bin", "openvcs-plugin.js"), "export {};\n");

  const existingPath = path.join(outDir, "replace.ovcsp");
  writeText(existingPath, "not-a-tar");

  const outPath = await bundlePlugin({
    pluginDir,
    outDir,
    verbose: false,
    noBuild: true,
    noNpmDeps: true,
  });
  const entries = await readBundleEntries(outPath);
  assert.equal(entries.has("replace/openvcs.plugin.json"), true);

  cleanupTempDir(root);
});

test("bundlePlugin generates package-lock in staging, not pluginDir", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const outDir = path.join(root, "out");

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), {
    id: "npm-plugin",
    module: { exec: "openvcs-plugin.js" },
  });
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export function OnPluginStart() {}\n");
  writeText(path.join(pluginDir, "bin", "openvcs-plugin.js"), "export {};\n");
  writeJson(path.join(pluginDir, "package.json"), {
    name: "npm-plugin",
    version: "0.1.0",
    private: true,
  });

  const outPath = await bundlePlugin({
    pluginDir,
    outDir,
    verbose: false,
    noBuild: true,
    noNpmDeps: false,
  });
  const entries = await readBundleEntries(outPath);

  assert.equal(fs.existsSync(path.join(pluginDir, "package-lock.json")), false);
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
    module: { exec: "openvcs-plugin.js" },
  });
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export function OnPluginStart() {}\n");
  writeText(path.join(pluginDir, "bin", "openvcs-plugin.js"), "export {};\n");
  writeJson(path.join(pluginDir, "package.json"), {
    name: "no-npm",
    version: "0.1.0",
    private: true,
  });

  await bundlePlugin({ pluginDir, outDir, verbose: false, noBuild: true, noNpmDeps: true });

  assert.equal(fs.existsSync(path.join(pluginDir, "package-lock.json")), false);

  cleanupTempDir(root);
});

test("bundlePlugin bundles manifest entry file with sibling assets", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const outDir = path.join(root, "out");

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), {
    id: "ui-plugin",
    entry: "ui/index.html",
  });
  writeText(path.join(pluginDir, "ui", "index.html"), "<html></html>\n");
  writeText(path.join(pluginDir, "ui", "app.js"), "console.log('ui');\n");
  writeText(path.join(pluginDir, "ui", "styles.css"), "body {}\n");
  writeText(path.join(pluginDir, "icon.png"), "icon-bytes");

  const outPath = await bundlePlugin({
    pluginDir,
    outDir,
    verbose: false,
    noBuild: true,
    noNpmDeps: true,
  });
  const entries = await readBundleEntries(outPath);

  assert.equal(entries.has("ui-plugin/openvcs.plugin.json"), true);
  assert.equal(entries.has("ui-plugin/ui/index.html"), true);
  assert.equal(entries.has("ui-plugin/ui/app.js"), true);
  assert.equal(entries.has("ui-plugin/ui/styles.css"), true);
  assert.equal(entries.has("ui-plugin/icon.png"), true);

  cleanupTempDir(root);
});

test("bundlePlugin bundles root-level entry with sibling assets", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const outDir = path.join(root, "out");

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), {
    id: "root-ui",
    entry: "index.html",
  });
  writeText(path.join(pluginDir, "index.html"), "<html></html>\n");
  writeText(path.join(pluginDir, "app.js"), "console.log('ui');\n");
  writeText(path.join(pluginDir, "styles.css"), "body {}\n");

  const outPath = await bundlePlugin({
    pluginDir,
    outDir,
    verbose: false,
    noBuild: true,
    noNpmDeps: true,
  });
  const entries = await readBundleEntries(outPath);

  assert.equal(entries.has("root-ui/openvcs.plugin.json"), true);
  assert.equal(entries.has("root-ui/index.html"), true);
  assert.equal(entries.has("root-ui/app.js"), true);
  assert.equal(entries.has("root-ui/styles.css"), true);

  cleanupTempDir(root);
});

test("bundlePlugin rejects manifest entry path traversal", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const outDir = path.join(root, "out");

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), {
    id: "bad-entry",
    entry: "../secret.txt",
  });
  writeText(path.join(pluginDir, "secret.txt"), "secret");

  await assert.rejects(
    () => bundlePlugin({ pluginDir, outDir, verbose: false, noBuild: true, noNpmDeps: true }),
    /manifest entry must point to a file under the plugin directory/
  );

  cleanupTempDir(root);
});

test("bundlePlugin rejects manifest entry absolute path", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const outDir = path.join(root, "out");

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), {
    id: "abs-entry",
    entry: "/tmp/secret.txt",
  });

  await assert.rejects(
    () => bundlePlugin({ pluginDir, outDir, verbose: false, noBuild: true, noNpmDeps: true }),
    /manifest entry must be a relative path/
  );

  cleanupTempDir(root);
});

test("bundlePlugin rejects missing manifest entry file", async () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  const outDir = path.join(root, "out");

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), {
    id: "missing-entry",
    entry: "nonexistent.html",
  });

  await assert.rejects(
    () => bundlePlugin({ pluginDir, outDir, verbose: false, noBuild: true, noNpmDeps: true }),
    /manifest entry file not found/
  );

  cleanupTempDir(root);
});
