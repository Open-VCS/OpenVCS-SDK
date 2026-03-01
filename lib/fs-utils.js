const fs = require("node:fs");
const path = require("node:path");

function isPathInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function rejectSymlinksRecursive(rootDir) {
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      const stats = fs.lstatSync(entryPath);
      if (stats.isSymbolicLink()) {
        throw new Error(`plugin contains a symlink: ${entryPath}`);
      }
      if (stats.isDirectory()) {
        stack.push(entryPath);
      }
    }
  }
}

function ensureDirectory(filePath) {
  fs.mkdirSync(filePath, { recursive: true });
}

function copyFileStrict(sourcePath, destinationPath) {
  const stats = fs.lstatSync(sourcePath);
  if (stats.isSymbolicLink()) {
    throw new Error(`plugin contains a symlink: ${sourcePath}`);
  }
  if (!stats.isFile()) {
    throw new Error(`expected file: ${sourcePath}`);
  }

  ensureDirectory(path.dirname(destinationPath));
  fs.copyFileSync(sourcePath, destinationPath);
}

function copyDirectoryRecursiveStrict(sourceDir, destinationDir) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  const stats = fs.lstatSync(sourceDir);
  if (stats.isSymbolicLink()) {
    throw new Error(`plugin contains a symlink: ${sourceDir}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`expected directory: ${sourceDir}`);
  }

  ensureDirectory(destinationDir);
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    const entryStats = fs.lstatSync(sourcePath);
    if (entryStats.isSymbolicLink()) {
      throw new Error(`plugin contains a symlink: ${sourcePath}`);
    }
    if (entryStats.isDirectory()) {
      copyDirectoryRecursiveStrict(sourcePath, destinationPath);
      continue;
    }
    if (entryStats.isFile()) {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

module.exports = {
  copyDirectoryRecursiveStrict,
  copyFileStrict,
  ensureDirectory,
  isPathInside,
  rejectSymlinksRecursive,
};
