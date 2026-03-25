import * as fs from "node:fs";
import * as path from "node:path";

export function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function rejectSymlinksRecursive(rootDir: string): void {
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

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

export function ensureDirectory(filePath: string): void {
  fs.mkdirSync(filePath, { recursive: true });
}

export function copyFileStrict(sourcePath: string, destinationPath: string): void {
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

export function copyDirectoryRecursiveStrict(sourceDir: string, destinationDir: string): void {
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
