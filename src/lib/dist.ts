import * as fs from "node:fs";
import * as path from "node:path";
import tar = require("tar");
import {
  buildPluginAssets,
  hasPackageJson,
  ManifestInfo,
  npmExecutable,
  readManifest,
  runCommand,
  validateDeclaredModuleExec,
} from "./build";
import {
  copyDirectoryRecursiveStrict,
  copyFileStrict,
  ensureDirectory,
  isPathInside,
  rejectSymlinksRecursive,
} from "./fs-utils";

const ICON_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "avif", "svg"];

type UsageError = Error & { code?: string };

interface DistArgs {
  pluginDir: string;
  outDir: string;
  verbose: boolean;
  noNpmDeps: boolean;
  noBuild: boolean;
}

export function distUsage(commandName = "openvcs"): string {
  return `${commandName} dist [args]\n\n  --plugin-dir <path>   Plugin repository root (contains openvcs.plugin.json)\n  --out <path>          Output directory (default: ./dist)\n  --no-build            Skip the plugin build step before packaging\n  --no-npm-deps         Disable npm dependency bundling (enabled by default)\n  -V, --verbose         Enable verbose output\n`;
}

export function parseDistArgs(args: string[]): DistArgs {
  let pluginDir = process.cwd();
  let outDir = "dist";
  let verbose = false;
  let noNpmDeps = false;
  let noBuild = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--plugin-dir") {
      index += 1;
      if (index >= args.length) {
        throw new Error("missing value for --plugin-dir");
      }
      pluginDir = args[index] as string;
      continue;
    }
    if (arg === "--out") {
      index += 1;
      if (index >= args.length) {
        throw new Error("missing value for --out");
      }
      outDir = args[index] as string;
      continue;
    }
    if (arg === "--no-npm-deps") {
      noNpmDeps = true;
      continue;
    }
    if (arg === "--no-build") {
      noBuild = true;
      continue;
    }
    if (arg === "-V" || arg === "--verbose") {
      verbose = true;
      continue;
    }
    if (arg === "--help") {
      const error = new Error(distUsage()) as UsageError;
      error.code = "USAGE";
      throw error;
    }
    throw new Error(`unknown flag: ${arg}`);
  }

  return {
    pluginDir: path.resolve(pluginDir),
    outDir: path.resolve(outDir),
    verbose,
    noNpmDeps,
    noBuild,
  };
}

function validateManifestEntry(pluginDir: string, entry: string): void {
  const normalized = entry.trim();
  if (path.isAbsolute(normalized)) {
    throw new Error(`manifest entry must be a relative path: ${entry}`);
  }
  const targetPath = path.resolve(pluginDir, normalized);
  const pluginDirResolved = path.resolve(pluginDir);
  if (!isPathInside(pluginDirResolved, targetPath) || targetPath === pluginDirResolved) {
    throw new Error(`manifest entry must point to a file under the plugin directory: ${entry}`);
  }
  if (!fs.existsSync(targetPath) || !fs.lstatSync(targetPath).isFile()) {
    throw new Error(`manifest entry file not found: ${entry}`);
  }
}

function copyEntryDirectory(pluginDir: string, bundleDir: string, entry: string): void {
  const normalized = entry.trim();
  const entryDir = path.dirname(normalized);
  const sourceDir = path.join(pluginDir, entryDir);
  const destDir = path.join(bundleDir, entryDir);
  copyDirectoryRecursiveStrict(sourceDir, destDir);
}

function ensurePackageLock(pluginDir: string, bundleDir: string, verbose: boolean): void {
  if (!hasPackageJson(pluginDir)) {
    return;
  }
  const lockPath = path.join(pluginDir, "package-lock.json");
  if (fs.existsSync(lockPath) && fs.lstatSync(lockPath).isFile()) {
    return;
  }

  const packageJsonPath = path.join(pluginDir, "package.json");
  copyFileStrict(packageJsonPath, path.join(bundleDir, "package.json"));

  if (verbose) {
    process.stderr.write(`Generating package-lock.json in staging\n`);
  }
  runCommand(
    npmExecutable(),
    ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
    bundleDir,
    verbose
  );
}

function copyNpmFilesToStaging(pluginDir: string, bundleDir: string): void {
  const packageJsonPath = path.join(pluginDir, "package.json");
  const lockPath = path.join(pluginDir, "package-lock.json");

  if (!fs.existsSync(packageJsonPath) || !fs.lstatSync(packageJsonPath).isFile()) {
    throw new Error(`missing package.json at ${packageJsonPath}`);
  }

  copyFileStrict(packageJsonPath, path.join(bundleDir, "package.json"));

  const stagedLockPath = path.join(bundleDir, "package-lock.json");
  if (fs.existsSync(stagedLockPath) && fs.lstatSync(stagedLockPath).isFile()) {
    return;
  }

  if (fs.existsSync(lockPath) && fs.lstatSync(lockPath).isFile()) {
    copyFileStrict(lockPath, path.join(bundleDir, "package-lock.json"));
  }
}

function rejectNativeAddonsRecursive(dirPath: string): void {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    const stats = fs.lstatSync(entryPath);
    if (stats.isSymbolicLink()) {
      throw new Error(`plugin contains a symlink: ${entryPath}`);
    }
    if (stats.isDirectory()) {
      rejectNativeAddonsRecursive(entryPath);
      continue;
    }
    if (!stats.isFile()) {
      continue;
    }
    if (entry.name.toLowerCase().endsWith(".node")) {
      throw new Error(`native Node addon files are not supported in portable bundles: ${entryPath}`);
    }
  }
}

function installNpmDependencies(pluginDir: string, bundleDir: string, verbose: boolean): void {
  copyNpmFilesToStaging(pluginDir, bundleDir);
  runCommand(
    npmExecutable(),
    ["ci", "--omit=dev", "--ignore-scripts", "--no-bin-links", "--no-audit", "--no-fund"],
    bundleDir,
    verbose
  );

  const nodeModulesPath = path.join(bundleDir, "node_modules");
  if (!fs.existsSync(nodeModulesPath)) {
    return;
  }
  if (!fs.lstatSync(nodeModulesPath).isDirectory()) {
    throw new Error(`npm install produced non-directory node_modules path: ${nodeModulesPath}`);
  }
  rejectNativeAddonsRecursive(nodeModulesPath);
}

function copyIcon(pluginDir: string, bundleDir: string): void {
  const entries = fs.readdirSync(pluginDir, { withFileTypes: true });
  const iconEntries = entries.filter((e) => {
    if (!e.isFile()) return false;
    const name = e.name.toLowerCase();
    return name.startsWith("icon.") && ICON_EXTENSIONS.includes(name.slice(5));
  });
  for (const ext of ICON_EXTENSIONS) {
    const found = iconEntries.find((e) => e.name.toLowerCase() === `icon.${ext}`);
    if (found) {
      copyFileStrict(
        path.join(pluginDir, found.name),
        path.join(bundleDir, found.name)
      );
      return;
    }
  }
}

function uniqueStagingDir(outDir: string): string {
  return path.join(outDir, `.openvcs-plugin-staging-${Date.now()}-${process.pid}`);
}

async function writeTarGz(outPath: string, baseDir: string, folderName: string): Promise<void> {
  const folderPath = path.join(baseDir, folderName);
  rejectSymlinksRecursive(folderPath);
  await tar.create(
    {
      cwd: baseDir,
      file: outPath,
      gzip: true,
      portable: true,
      noMtime: true,
      preservePaths: false,
      strict: true,
    },
    [folderName]
  );
}

export async function bundlePlugin(parsedArgs: DistArgs): Promise<string> {
  const { pluginDir, outDir, verbose, noNpmDeps, noBuild } = parsedArgs;
  if (verbose) {
    process.stderr.write(`Bundling plugin from: ${pluginDir}\n`);
  }

  const { pluginId, moduleExec, entry, manifestPath } = noBuild
    ? readManifest(pluginDir)
    : buildPluginAssets({ pluginDir, verbose });
  const themesPath = path.join(pluginDir, "themes");
  const hasThemes = fs.existsSync(themesPath) && fs.lstatSync(themesPath).isDirectory();
  if (entry) {
    validateManifestEntry(pluginDir, entry);
  }
  if (!moduleExec && !hasThemes && !entry) {
    throw new Error("manifest has no module.exec, entry, or themes/");
  }
  validateDeclaredModuleExec(pluginDir, moduleExec);

  ensureDirectory(outDir);
  const stagingRoot = uniqueStagingDir(outDir);
  const bundleDir = path.join(stagingRoot, pluginId);

  ensureDirectory(bundleDir);

  try {
    copyFileStrict(manifestPath, path.join(bundleDir, "openvcs.plugin.json"));
    copyIcon(pluginDir, bundleDir);

    if (entry) {
      copyEntryDirectory(pluginDir, bundleDir, entry);
    }

    const sourceBinDir = path.join(pluginDir, "bin");
    if (fs.existsSync(sourceBinDir) && fs.lstatSync(sourceBinDir).isDirectory()) {
      copyDirectoryRecursiveStrict(sourceBinDir, path.join(bundleDir, "bin"));
    }
    if (hasThemes) {
      copyDirectoryRecursiveStrict(themesPath, path.join(bundleDir, "themes"));
    }

    if (!noNpmDeps && hasPackageJson(pluginDir)) {
      ensurePackageLock(pluginDir, bundleDir, verbose);
      installNpmDependencies(pluginDir, bundleDir, verbose);
    }

    const outPath = path.join(outDir, `${pluginId}.ovcsp`);
    if (fs.existsSync(outPath)) {
      fs.rmSync(outPath, { force: true });
    }

    await writeTarGz(outPath, stagingRoot, pluginId);
    return outPath;
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

export const __private = {
  ICON_EXTENSIONS,
  copyIcon,
  readManifest,
  rejectNativeAddonsRecursive,
  uniqueStagingDir,
  validateDeclaredModuleExec,
  validateManifestEntry,
  writeTarGz,
};
