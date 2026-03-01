#!/usr/bin/env node

const { runCli } = require("../lib/cli");

runCli(process.argv.slice(2)).catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${detail}\n`);
  process.exit(1);
});
