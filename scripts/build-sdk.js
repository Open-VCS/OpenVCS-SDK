const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const buildDir = path.join(rootDir, "build");

function removeGeneratedFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      removeGeneratedFiles(entryPath);
      const remaining = fs.readdirSync(entryPath);
      if (remaining.length === 0) {
        fs.rmdirSync(entryPath);
      }
      continue;
    }
    if (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts")) {
      fs.rmSync(entryPath, { force: true });
    }
  }
}

function copyRecursive(sourceDir, destinationDir) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }
  fs.mkdirSync(destinationDir, { recursive: true });

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(sourcePath, destinationPath);
      continue;
    }
    fs.copyFileSync(sourcePath, destinationPath);
  }
}

function runTsc() {
  const tscCli = require.resolve("typescript/bin/tsc");
  const result = spawnSync(process.execPath, [tscCli, "-p", "tsconfig.json"], {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

removeGeneratedFiles(path.join(rootDir, "bin"));
removeGeneratedFiles(path.join(rootDir, "lib"));
fs.rmSync(buildDir, { recursive: true, force: true });

runTsc();

copyRecursive(path.join(buildDir, "bin"), path.join(rootDir, "bin"));
copyRecursive(path.join(buildDir, "lib"), path.join(rootDir, "lib"));

fs.rmSync(buildDir, { recursive: true, force: true });
