const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const packageJson = require("../package.json");
const { cleanupTempDir, makeTempDir, writeJson, writeText } = require("./helpers");

const cliPath = path.join(__dirname, "..", "bin", "openvcs.js");

function runCli(args, cwd = process.cwd(), input = "") {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    input,
    encoding: "utf8",
  });
}

test("openvcs --version prints package version", () => {
  const result = runCli(["--version"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), `openvcs ${packageJson.version}`);
});

test("openvcs --help prints usage", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: openvcs <command>/);
  assert.match(result.stdout, /build \[args\]/);
});

test("openvcs with no args exits non-zero", () => {
  const result = runCli([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: openvcs <command>/);
});

test("openvcs build --help prints build usage", () => {
  const result = runCli(["build", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /openvcs build \[args\]/);
});

test("openvcs init --help prints init usage", () => {
  const result = runCli(["init", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: openvcs init/);
});

test("openvcs rejects unknown command", () => {
  const result = runCli(["unknown"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown command: unknown/);
});

test("openvcs build command builds code plugin assets", () => {
  const root = makeTempDir("openvcs-sdk-test");
  const pluginDir = path.join(root, "plugin");

  writeJson(path.join(pluginDir, "package.json"), {
    name: "build-plugin",
    private: true,
    openvcs: {
      id: "build-plugin",
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

  const result = runCli(["build", "--plugin-dir", pluginDir]);

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "build-plugin");
  assert.equal(fs.existsSync(path.join(pluginDir, "bin", "plugin.js")), true);
  assert.equal(fs.existsSync(path.join(pluginDir, "bin", "openvcs-plugin.js")), true);

  cleanupTempDir(root);
});
