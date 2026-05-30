const assert = require("node:assert/strict");
const test = require("node:test");

const { runCli } = require("../lib/cli");

async function captureCli(args) {
  const stdout = [];
  const stderr = [];
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  process.stdout.write = (chunk) => { stdout.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { stderr.push(String(chunk)); return true; };
  try {
    await runCli(args);
    return { stdout: stdout.join(""), stderr: stderr.join(""), exitCode: process.exitCode };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.exitCode = originalExitCode;
  }
}

test("runCli writes usage to stderr for empty args", async () => {
  const result = await captureCli([]);

  assert.match(result.stderr, /Usage: openvcs/);
  assert.equal(result.exitCode, 1);
});

test("runCli writes root help to stdout", async () => {
  const result = await captureCli(["help"]);

  assert.match(result.stdout, /Commands:/);
  assert.equal(result.exitCode, undefined);
});

test("runCli passes through build parser errors", async () => {
  await assert.rejects(() => runCli(["build", "--plugin-dir"]), /missing value for --plugin-dir/);
});

test("runCli rejects invalid init arguments", async () => {
  await assert.rejects(() => runCli(["init", "--bad"]), /unknown argument for init/);
});

test("runCli direct help branches write subcommand usage", async () => {
  const buildHelp = await captureCli(["build", "--help"]);
  const initHelp = await captureCli(["init", "--help"]);

  assert.match(buildHelp.stdout, /openvcs build \[args\]/);
  assert.match(initHelp.stdout, /Usage: openvcs init/);
});

test("runCli direct unknown command branch rejects", async () => {
  await assert.rejects(() => runCli(["wat"]), /unknown command: wat/);
});
