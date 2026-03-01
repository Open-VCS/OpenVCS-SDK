#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const { resolveBinaryPath } = require("../lib/resolve-binary");

function run() {
  const binaryPath = resolveBinaryPath();
  const args = process.argv.slice(2);
  const result = spawnSync(binaryPath, args, { stdio: "inherit" });

  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number") {
    process.exit(result.status);
  }
  process.exit(1);
}

try {
  run();
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${detail}\n`);
  process.exit(1);
}
