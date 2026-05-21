const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { npmArgsPrefix, npmCommand, npmExecutable, resolveNpmCli } = require("../lib/npm-runner");

test("npmCommand uses npm directly on non-Windows platforms", () => {
  const command = npmCommand("linux", "/usr/bin/node");

  assert.deepEqual(command, { program: "npm", argsPrefix: [] });
});

test("npmExecutable and npmArgsPrefix expose the default npm command", () => {
  if (process.platform === "win32") {
    assert.equal(npmExecutable(), process.execPath);
    assert.ok(npmArgsPrefix().length > 0);
  } else {
    assert.equal(npmExecutable(), "npm");
    assert.deepEqual(npmArgsPrefix(), []);
  }
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

test("resolveNpmCli prefers npm cli beside node.exe before require.resolve", () => {
  const execPath = "C:\\Tools With Spaces\\nodejs\\node.exe";
  const localCli = path.join(path.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js");
  let fallbackCalled = false;

  const resolved = resolveNpmCli(
    execPath,
    (candidate) => candidate === localCli,
    () => {
      fallbackCalled = true;
      return "fallback";
    },
  );

  assert.equal(resolved, localCli);
  assert.equal(fallbackCalled, false);
});

test("npmCommand keeps Windows paths unquoted because spawn receives argv array", () => {
  const execPath = "C:\\Program Files\\nodejs\\node.exe";
  const cliPath = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
  const command = npmCommand("win32", execPath, () => false, () => cliPath);

  assert.equal(command.program, execPath);
  assert.equal(command.argsPrefix[0], cliPath);
  assert.equal(command.program.startsWith('"'), false);
  assert.equal(command.argsPrefix[0].startsWith('"'), false);
});

test("npmCommand returns a fresh argsPrefix array per Windows call", () => {
  const execPath = "C:\\nodejs\\node.exe";
  const cliPath = "C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
  const first = npmCommand("win32", execPath, () => false, () => cliPath);
  const second = npmCommand("win32", execPath, () => false, () => cliPath);

  first.argsPrefix.push("mutated");

  assert.deepEqual(second.argsPrefix, [cliPath]);
});

test("SDK build module no longer exposes shell-wrapper helper", () => {
  const buildModule = require("../lib/build");

  assert.equal(Object.hasOwn(buildModule, "shouldUseWindowsShell"), false);
});
