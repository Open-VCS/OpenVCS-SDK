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
        console.warn(`warning: plugin contains a symlink: ${entryPath} (symlinks may not work in portable bundles)`);
        continue;
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
    console.warn(`warning: plugin contains a symlink: ${sourcePath} (symlinks may not work in portable bundles)`);
    const target = fs.readlinkSync(sourcePath);
    console.warn(`       resolving to: ${target}`);
    const resolvedTarget = path.isAbsolute(target) ? target : path.resolve(path.dirname(sourcePath), target);
    if (!fs.existsSync(resolvedTarget)) {
      throw new Error(`symlink target does not exist: ${resolvedTarget}`);
    }
    return copyFileStrict(resolvedTarget, destinationPath);
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
    console.warn(`warning: plugin contains a symlink: ${sourceDir} (symlinks may not work in portable bundles)`);
    return;
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
      console.warn(`warning: plugin contains a symlink: ${sourcePath} (symlinks may not work in portable bundles)`);
      const target = fs.readlinkSync(sourcePath);
      console.warn(`       resolving to: ${target}`);
      const resolvedTarget = path.isAbsolute(target) ? target : path.resolve(path.dirname(sourcePath), target);
      if (!fs.existsSync(resolvedTarget)) {
        throw new Error(`symlink target does not exist: ${resolvedTarget}`);
      }
      if (fs.statSync(resolvedTarget).isDirectory()) {
        copyDirectoryRecursiveStrict(resolvedTarget, destinationPath);
      } else if (fs.statSync(resolvedTarget).isFile()) {
        ensureDirectory(path.dirname(destinationPath));
        fs.copyFileSync(resolvedTarget, destinationPath);
      }
      continue;
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
