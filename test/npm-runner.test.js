const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { npmCommand, resolveNpmCli } = require("../lib/npm-runner");

test("npmCommand uses npm directly on non-Windows platforms", () => {
  const command = npmCommand("linux", "/usr/bin/node");

  assert.deepEqual(command, { program: "npm", argsPrefix: [] });
});

test("npmCommand runs npm through node.exe on Windows without cmd.exe", () => {
  const execPath = "C:\\Program Files\\nodejs\\node.exe";
  const localCli = path.join(path.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js");

  const command = npmCommand("win32", execPath, (candidate) => candidate === localCli);

  assert.equal(command.program, execPath);
  assert.deepEqual(command.argsPrefix, [localCli]);
  assert.notEqual(command.program.toLowerCase(), "cmd.exe");
  assert.notEqual(path.basename(command.argsPrefix[0]).toLowerCase(), "npm.cmd");
});

test("resolveNpmCli falls back to require.resolve when local npm cli is unavailable", () => {
  const resolved = resolveNpmCli(
    "C:\\Program Files\\nodejs\\node.exe",
    () => false,
    (specifier) => `resolved:${specifier}`,
  );

  assert.equal(resolved, "resolved:npm/bin/npm-cli.js");
});
