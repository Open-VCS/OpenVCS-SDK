const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildPluginAssets,
  parseBuildArgs,
  readManifest,
  validateDeclaredModuleExec,
  validateGeneratedBootstrapTargets,
} = require("../lib/build");
const { cleanupTempDir, makeTempDir, writeJson, writeText } = require("./helpers");

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

test("buildPluginAssets no-ops for theme-only plugins", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), { id: "theme-only" });
  const manifest = buildPluginAssets({ pluginDir, verbose: false });

  assert.equal(manifest.pluginId, "theme-only");
  cleanupTempDir(root);
});

test("buildPluginAssets requires package.json for code plugins", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), {
    id: "missing-package",
    module: { exec: "openvcs-plugin.js" },
  });

  assert.throws(
    () => buildPluginAssets({ pluginDir, verbose: false }),
    /code plugins must include package\.json/
  );

  cleanupTempDir(root);
});

test("buildPluginAssets runs build:plugin and validates output", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");

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

  const manifest = buildPluginAssets({ pluginDir, verbose: false });

  assert.equal(manifest.pluginId, "builder");
  assert.equal(fs.existsSync(path.join(pluginDir, "bin", "plugin.js")), true);
  assert.equal(fs.existsSync(path.join(pluginDir, "bin", "openvcs-plugin.js")), true);
  assert.match(
    fs.readFileSync(path.join(pluginDir, "bin", "openvcs-plugin.js"), "utf8"),
    /bootstrapPluginModule/
  );
  cleanupTempDir(root);
});

test("readManifest and validateDeclaredModuleExec stay reusable", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");

  writeJson(path.join(pluginDir, "openvcs.plugin.json"), {
    id: "reusable",
    module: { exec: "openvcs-plugin.js" },
  });
  writeText(path.join(pluginDir, "bin", "plugin.js"), "export function OnPluginStart() {}\n");
  writeText(path.join(pluginDir, "bin", "openvcs-plugin.js"), "export {};\n");

  const manifest = readManifest(pluginDir);
  assert.equal(manifest.moduleExec, "openvcs-plugin.js");
  assert.doesNotThrow(() => validateGeneratedBootstrapTargets(pluginDir, manifest.moduleExec));
  assert.doesNotThrow(() => validateDeclaredModuleExec(pluginDir, manifest.moduleExec));

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
