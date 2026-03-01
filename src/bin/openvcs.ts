#!/usr/bin/env node

import { runCli } from "../lib/cli";

runCli(process.argv.slice(2)).catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${detail}\n`);
  process.exit(1);
});
