const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  authoredPluginModulePath,
  buildPluginAssets,
  generateModuleBootstrap,
  hasPackageJson,
  parseBuildArgs,
  readManifest,
  runCommand,
  validateDeclaredModuleExec,
  validateGeneratedBootstrapTargets,
} = require("../lib/build");
const { cleanupTempDir, makeTempDir, writeJson, writeText } = require("./helpers");

function captureStderr(fn) {
  const chunks = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    return { result: fn(), stderr: chunks.join("") };
  } finally {
    process.stderr.write = originalWrite;
  }
}

test("renderGeneratedBootstrap creates ESM code", () => {
  const output = require("../lib/build").renderGeneratedBootstrap("./plugin.js", true);
  assert.match(output, /^#!/);
  assert.match(output, /import \{ bootstrapPluginModule \}/);
  assert.match(output, /import\('\.\/plugin\.js'\)/);
});

test("renderGeneratedBootstrap creates CJS code", () => {
  const output = require("../lib/build").renderGeneratedBootstrap("./plugin.js", false);
  assert.match(output, /^#!/);
  assert.match(output, /require\('@openvcs\/sdk\/runtime'\)/);
  assert.match(output, /require\('\.\/plugin\.js'\)/);
  assert.match(output, /\(\s*async\s*\(\s*\)\s*=>/);
});

test("renderGeneratedBootstrap handles subdirectory import paths", () => {
  const output = require("../lib/build").renderGeneratedBootstrap("./subdir/plugin.js", true);
  assert.match(output, /import\('\.\/subdir\/plugin\.js'\)/);
});

test("parseBuildArgs uses defaults", () => {
  const parsed = parseBuildArgs([]);
  assert.equal(parsed.pluginDir, process.cwd());
  assert.equal(parsed.verbose, false);
});

test("parseBuildArgs parses known flags", () => {
  const parsed = parseBuildArgs(["--plugin-dir", "some/plugin", "--verbose"]);
  assert.equal(parsed.pluginDir, path.resolve("some/plugin"));
  assert.equal(parsed.verbose, true);
});

test("parseBuildArgs help returns usage error", () => {
  assert.throws(() => parseBuildArgs(["--help"]), /openvcs build \[args\]/);
});

test("parseBuildArgs rejects unknown flags", () => {
  assert.throws(() => parseBuildArgs(["--wat"]), /unknown flag: --wat/);
});

test("buildPluginAssets no-ops for theme-only plugins", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");

  writeJson(path.join(pluginDir, "package.json"), {
    name: "theme-only",
    openvcs: { id: "theme-only" },
  });
  const { result: manifest, stderr } = captureStderr(() => buildPluginAssets({ pluginDir, verbose: false }));

  assert.equal(manifest.pluginId, "theme-only");
  assert.match(stderr, /openvcs build: reading plugin manifest/);
  assert.match(stderr, /openvcs build: theme-only plugin theme-only; nothing to build/);
  cleanupTempDir(root);
});

test("buildPluginAssets requires package.json for code plugins", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");

  writeJson(path.join(pluginDir, "package.json"), {
    name: "missing-package",
    openvcs: {
      id: "missing-package",
      module: { exec: "openvcs-plugin.js" },
    },
  });

  assert.throws(
    () => buildPluginAssets({ pluginDir, verbose: false }),
    /code plugins must define scripts\["build:plugin"\]/
  );

  cleanupTempDir(root);
});

test("buildPluginAssets runs build:plugin and validates output", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");

  writeJson(path.join(pluginDir, "package.json"), {
    name: "builder",
    private: true,
    openvcs: {
      id: "builder",
      module: { exec: "openvcs-plugin.js" },
    },
    scripts: {
      "build:plugin": "node ./scripts/build-plugin.js",
    },
  });
  writeText(
    path.join(pluginDir, "scripts", "build-plugin.js"),
    "const fs = require('node:fs');\nconst path = require('node:path');\nconst out = path.join(process.cwd(), 'bin', 'plugin.js');\nfs.mkdirSync(path.dirname(out), { recursive: true });\nfs.writeFileSync(out, 'export {};\\n', 'utf8');\n"
  );

  const { result: manifest, stderr } = captureStderr(() => buildPluginAssets({ pluginDir, verbose: false }));

  assert.equal(manifest.pluginId, "builder");
  assert.equal(fs.existsSync(path.join(pluginDir, "bin", "plugin.js")), true);
  assert.equal(fs.existsSync(path.join(pluginDir, "bin", "openvcs-plugin.js")), true);
  assert.match(
    fs.readFileSync(path.join(pluginDir, "bin", "openvcs-plugin.js"), "utf8"),
    /bootstrapPluginModule/
  );
  assert.match(stderr, /openvcs build: reading plugin manifest/);
  assert.match(stderr, /openvcs build: running build:plugin/);
  assert.match(stderr, /openvcs build: generating bootstrap openvcs-plugin.js/);
  assert.match(stderr, /openvcs build: validating bootstrap openvcs-plugin.js/);
  assert.match(stderr, /openvcs build: build complete for builder/);
  cleanupTempDir(root);
});

test("buildPluginAssets verbose mode adds detailed progress output", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");

  writeJson(path.join(pluginDir, "package.json"), {
    name: "verbose-builder",
    private: true,
    type: "module",
    openvcs: {
      id: "verbose-builder",
      module: { exec: "openvcs-plugin.mjs" },
    },
    scripts: {
      "build:plugin": "node ./scripts/build-plugin.cjs",
    },
  });
  writeText(
    path.join(pluginDir, "scripts", "build-plugin.cjs"),
    "const fs = require('node:fs');\nconst path = require('node:path');\nconst out = path.join(process.cwd(), 'bin', 'plugin.js');\nfs.mkdirSync(path.dirname(out), { recursive: true });\nfs.writeFileSync(out, 'export {};\\n', 'utf8');\n"
  );

  const { result: manifest, stderr } = captureStderr(() => buildPluginAssets({ pluginDir, verbose: true }));

  assert.equal(manifest.pluginId, "verbose-builder");
  assert.match(stderr, /openvcs build: reading manifest at .*package\.json/);
  assert.match(stderr, /openvcs build: manifest loaded for verbose-builder \(module\.exec: openvcs-plugin\.mjs\)/);
  assert.match(stderr, /Running command in .*: .* run build:plugin/);
  assert.match(stderr, /openvcs build: writing bootstrap .*openvcs-plugin\.mjs -> .*plugin\.js \(esm\)/);
  cleanupTempDir(root);
});

test("readManifest and validateDeclaredModuleExec stay reusable", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");

  writeJson(path.join(pluginDir, "package.json"), {
    name: "reusable",
    openvcs: {
      id: "reusable",
      module: { exec: "openvcs-plugin.js" },
    },
  });
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export function OnPluginStart() {}\n");
  writeText(path.join(pluginDir, "bin", "openvcs-plugin.js"), "export {};\n");

  const manifest = readManifest(pluginDir);
  assert.equal(manifest.moduleExec, "openvcs-plugin.js");
  assert.doesNotThrow(() => validateGeneratedBootstrapTargets(pluginDir, manifest.moduleExec));
  assert.doesNotThrow(() => validateDeclaredModuleExec(pluginDir, manifest.moduleExec));

  cleanupTempDir(root);
});

test("readManifest reports missing and invalid package manifests", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const missingDir = path.join(root, "missing");
  fs.mkdirSync(missingDir, { recursive: true });
  assert.throws(() => readManifest(missingDir), /missing package\.json/);

  const invalidDir = path.join(root, "invalid");
  writeText(path.join(invalidDir, "package.json"), "{");
  assert.throws(() => readManifest(invalidDir), /parse .*package\.json/);

  const noOpenVcs = path.join(root, "no-openvcs");
  writeJson(path.join(noOpenVcs, "package.json"), { name: "x" });
  assert.throws(() => readManifest(noOpenVcs), /missing an 'openvcs' object/);

  const badId = path.join(root, "bad-id");
  writeJson(path.join(badId, "package.json"), { openvcs: { id: "bad/id" } });
  assert.throws(() => readManifest(badId), /must not contain path separators/);

  const missingId = path.join(root, "missing-id");
  writeJson(path.join(missingId, "package.json"), { openvcs: {} });
  assert.throws(() => readManifest(missingId), /missing openvcs\.id/);

  cleanupTempDir(root);
});

test("validateDeclaredModuleExec rejects invalid module paths", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  fs.mkdirSync(path.join(pluginDir, "bin"), { recursive: true });

  assert.doesNotThrow(() => validateDeclaredModuleExec(pluginDir, undefined));
  assert.throws(() => validateDeclaredModuleExec(pluginDir, "native.node"), /must end with/);
  assert.throws(() => validateDeclaredModuleExec(pluginDir, path.join(pluginDir, "bin", "x.js")), /must be a relative path/);
  assert.throws(() => validateDeclaredModuleExec(pluginDir, "../escape.js"), /must point to a file under bin/);
  assert.throws(() => validateDeclaredModuleExec(pluginDir, "missing.js"), /module entrypoint not found/);

  cleanupTempDir(root);
});

test("renderGeneratedBootstrap rejects unsafe import paths", () => {
  assert.throws(() => require("../lib/build").renderGeneratedBootstrap("./bad path.js", true), /unsafe module import path/);
});

test("build helpers handle no-op and package existence paths", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  fs.mkdirSync(pluginDir, { recursive: true });

  assert.equal(hasPackageJson(pluginDir), false);
  writeJson(path.join(pluginDir, "package.json"), { openvcs: { id: "x" } });
  assert.equal(hasPackageJson(pluginDir), true);
  assert.equal(authoredPluginModulePath(pluginDir), path.join(pluginDir, "bin", "plugin.js"));
  assert.doesNotThrow(() => generateModuleBootstrap(pluginDir, undefined));

  cleanupTempDir(root);
});

test("runCommand reports spawn failures and non-zero exits", () => {
  const root = makeTempDir("openvcs-sdk-test");

  assert.doesNotThrow(() => runCommand(process.execPath, ["-e", "process.exit(0)"], root, true));
  assert.throws(() => runCommand(process.execPath, ["-e", "process.exit(7)"], root, false), /exit code 7/);
  assert.throws(() => runCommand(path.join(root, "missing-binary"), [], root, false), /failed to spawn/);

  cleanupTempDir(root);
});

test("validateGeneratedBootstrapTargets rejects module.exec collisions", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");

  writeText(path.join(pluginDir, "bin", "plugin.js"), "export function OnPluginStart() {}\n");

  assert.throws(
    () => validateGeneratedBootstrapTargets(pluginDir, "plugin.js"),
    /must not be plugin\.js/
  );

  cleanupTempDir(root);
});

test("validateGeneratedBootstrapTargets rejects case-insensitive collisions", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");

  writeText(path.join(pluginDir, "bin", "plugin.js"), "export function OnPluginStart() {}\n");

  assert.throws(
    () => validateGeneratedBootstrapTargets(pluginDir, "Plugin.js"),
    /must not be plugin\.js/
  );
  assert.throws(
    () => validateGeneratedBootstrapTargets(pluginDir, "PLUGIN.JS"),
    /must not be plugin\.js/
  );

  cleanupTempDir(root);
});

test("validateGeneratedBootstrapTargets no-ops without module exec and rejects missing compiled module", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  fs.mkdirSync(path.join(pluginDir, "bin"), { recursive: true });

  assert.doesNotThrow(() => validateGeneratedBootstrapTargets(pluginDir, undefined));
  assert.throws(() => validateGeneratedBootstrapTargets(pluginDir, "openvcs-plugin.js"), /compiled plugin module not found/);

  cleanupTempDir(root);
});

test("generateModuleBootstrap tolerates invalid package json and uses extension for ESM", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");
  writeText(path.join(pluginDir, "package.json"), "{");
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export {};\n");
  writeText(path.join(pluginDir, "bin", "bootstrap.mjs"), "");

  generateModuleBootstrap(pluginDir, "bootstrap.mjs");

  assert.match(fs.readFileSync(path.join(pluginDir, "bin", "bootstrap.mjs"), "utf8"), /^import/m);
  cleanupTempDir(root);
});

test("generateModuleBootstrap handles subdirectory module.exec paths", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");

  writeJson(path.join(pluginDir, "package.json"), {
    name: "subdir-plugin",
    type: "module",
    private: true,
    openvcs: {
      id: "subdir-plugin",
      module: { exec: "subdir/openvcs-plugin.js" },
    },
    scripts: { "build:plugin": "node ./scripts/build.js" },
  });
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export function OnPluginStart() {}\n");
  writeText(path.join(pluginDir, "bin", "subdir", "openvcs-plugin.js"), "export {};\n");

  const { generateModuleBootstrap } = require("../lib/build");
  generateModuleBootstrap(pluginDir, "subdir/openvcs-plugin.js");

  const bootstrapContent = fs.readFileSync(
    path.join(pluginDir, "bin", "subdir", "openvcs-plugin.js"),
    "utf8"
  );
  assert.match(bootstrapContent, /\.\.\/plugin\.js/);
  cleanupTempDir(root);
});

test("detectEsmMode returns true for package.json type: module", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");

  writeJson(path.join(pluginDir, "package.json"), {
    name: "esm-plugin",
    type: "module",
    openvcs: {
      id: "esm-plugin",
      module: { exec: "bootstrap.js" },
    },
  });
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export function OnPluginStart() {}\n");
  writeText(path.join(pluginDir, "bin", "bootstrap.js"), "export {};\n");

  const { generateModuleBootstrap } = require("../lib/build");
  generateModuleBootstrap(pluginDir, "bootstrap.js");

  const bootstrapContent = fs.readFileSync(path.join(pluginDir, "bin", "bootstrap.js"), "utf8");
  assert.match(bootstrapContent, /^#!/);
  assert.match(bootstrapContent, /^import\s*{/m);
  cleanupTempDir(root);
});

test("detectEsmMode returns false for package.json type: commonjs", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");

  writeJson(path.join(pluginDir, "package.json"), {
    name: "cjs-plugin",
    type: "commonjs",
    openvcs: {
      id: "cjs-plugin",
      module: { exec: "bootstrap.js" },
    },
  });
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export function OnPluginStart() {}\n");
  writeText(path.join(pluginDir, "bin", "bootstrap.js"), "export {};\n");

  const { generateModuleBootstrap } = require("../lib/build");
  generateModuleBootstrap(pluginDir, "bootstrap.js");

  const bootstrapContent = fs.readFileSync(path.join(pluginDir, "bin", "bootstrap.js"), "utf8");
  assert.match(bootstrapContent, /require\(/);
  assert.match(bootstrapContent, /\(\s*async\s*\(\s*\)\s*=>/);
  cleanupTempDir(root);
});
