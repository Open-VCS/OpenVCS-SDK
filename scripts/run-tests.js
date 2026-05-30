const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const testDir = path.join(rootDir, "test");

const files = fs
  .readdirSync(testDir)
  .filter((f) => f.endsWith(".test.js"))
  .map((f) => path.join("test", f));

const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: rootDir,
  stdio: "inherit",
});
process.exit(result.status);
