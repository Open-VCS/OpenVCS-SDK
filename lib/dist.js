const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const tar = require("tar");
const {
  copyDirectoryRecursiveStrict,
  copyFileStrict,
  ensureDirectory,
  isPathInside,
  rejectSymlinksRecursive,
} = require("./fs-utils");

const ICON_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "avif", "svg"];

function distUsage(commandName = "openvcs") {
  return `${commandName} dist [args]\n\n  --plugin-dir <path>   Plugin repository root (contains openvcs.plugin.json)\n  --out <path>          Output directory (default: ./dist)\n  --no-npm-deps         Disable npm dependency bundling (enabled by default)\n  -V, --verbose         Enable verbose output\n`;
}

function npmExecutable() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function parseDistArgs(args) {
  let pluginDir = process.cwd();
  let outDir = "dist";
  let verbose = false;
  let noNpmDeps = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--plugin-dir") {
      index += 1;
      if (index >= args.length) {
        throw new Error("missing value for --plugin-dir");
      }
      pluginDir = args[index];
      continue;
    }
    if (arg === "--out") {
      index += 1;
      if (index >= args.length) {
        throw new Error("missing value for --out");
      }
      outDir = args[index];
      continue;
    }
    if (arg === "--no-npm-deps") {
      noNpmDeps = true;
      continue;
    }
    if (arg === "-V" || arg === "--verbose") {
      verbose = true;
      continue;
    }
    if (arg === "--help") {
      const error = new Error(distUsage());
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
  };
}

function readManifest(pluginDir) {
  const manifestPath = path.join(pluginDir, "openvcs.plugin.json");
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    throw new Error(`missing openvcs.plugin.json at ${manifestPath}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`parse ${manifestPath}: ${error.message}`);
  }

  const pluginId = typeof manifest.id === "string" ? manifest.id.trim() : "";
  if (!pluginId) {
    throw new Error(`manifest ${manifestPath} is missing a string 'id'`);
  }
  if (
    pluginId === "." ||
    pluginId === ".." ||
    pluginId.includes("/") ||
    pluginId.includes("\\")
  ) {
    throw new Error(`manifest id must not contain path separators: ${pluginId}`);
  }

  const moduleExec =
    typeof manifest.module?.exec === "string" ? manifest.module.exec.trim() : undefined;

  return {
    pluginId,
    moduleExec,
    manifestPath,
  };
}

function validateDeclaredModuleExec(pluginDir, moduleExec) {
  if (!moduleExec) {
    return;
  }

  const normalizedExec = moduleExec.trim();
  const lowered = normalizedExec.toLowerCase();
  if (!lowered.endsWith(".js") && !lowered.endsWith(".mjs") && !lowered.endsWith(".cjs")) {
    throw new Error(`manifest exec must end with .js/.mjs/.cjs (Node runtime): ${moduleExec}`);
  }
  if (path.isAbsolute(normalizedExec)) {
    throw new Error(`manifest module.exec must be a relative path under bin/: ${moduleExec}`);
  }

  const binDir = path.resolve(pluginDir, "bin");
  const targetPath = path.resolve(binDir, normalizedExec);
  if (!isPathInside(binDir, targetPath) || targetPath === binDir) {
    throw new Error(`manifest module.exec must point to a file under bin/: ${moduleExec}`);
  }
  if (!fs.existsSync(targetPath) || !fs.lstatSync(targetPath).isFile()) {
    throw new Error(`module entrypoint not found at ${targetPath}`);
  }
}

function hasPackageJson(pluginDir) {
  const packageJsonPath = path.join(pluginDir, "package.json");
  return fs.existsSync(packageJsonPath) && fs.lstatSync(packageJsonPath).isFile();
}

function runCommand(program, args, cwd, verbose) {
  if (verbose) {
    process.stderr.write(`Running command in ${cwd}: ${program} ${args.join(" ")}\n`);
  }

  const result = spawnSync(program, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw new Error(`failed to spawn '${program}' in ${cwd}: ${result.error.message}`);
  }
  if (result.status === 0) {
    if (verbose) {
      if (result.stdout?.trim()) {
        process.stderr.write(`${result.stdout.trim()}\n`);
      }
      if (result.stderr?.trim()) {
        process.stderr.write(`${result.stderr.trim()}\n`);
      }
    }
    return;
  }

  throw new Error(
    `command failed (${program} ${args.join(" ")}), exit code ${result.status}, stdout='${(result.stdout || "").trim()}', stderr='${(result.stderr || "").trim()}'`
  );
}

function ensurePackageLock(pluginDir, verbose) {
  if (!hasPackageJson(pluginDir)) {
    return;
  }
  const lockPath = path.join(pluginDir, "package-lock.json");
  if (fs.existsSync(lockPath) && fs.lstatSync(lockPath).isFile()) {
    return;
  }

  if (verbose) {
    process.stderr.write(`Generating package-lock.json in ${pluginDir}\n`);
  }
  runCommand(
    npmExecutable(),
    ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
    pluginDir,
    verbose
  );
}

function copyNpmFilesToStaging(pluginDir, bundleDir) {
  const packageJsonPath = path.join(pluginDir, "package.json");
  const lockPath = path.join(pluginDir, "package-lock.json");

  if (!fs.existsSync(packageJsonPath) || !fs.lstatSync(packageJsonPath).isFile()) {
    throw new Error(`missing package.json at ${packageJsonPath}`);
  }
  if (!fs.existsSync(lockPath) || !fs.lstatSync(lockPath).isFile()) {
    throw new Error(`missing package-lock.json at ${lockPath}`);
  }

  copyFileStrict(packageJsonPath, path.join(bundleDir, "package.json"));
  copyFileStrict(lockPath, path.join(bundleDir, "package-lock.json"));
}

function rejectNativeAddonsRecursive(dirPath) {
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
      throw new Error(
        `native Node addon files are not supported in portable bundles: ${entryPath}`
      );
    }
  }
}

function installNpmDependencies(pluginDir, bundleDir, verbose) {
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

function copyIcon(pluginDir, bundleDir) {
  for (const extension of ICON_EXTENSIONS) {
    const fileName = `icon.${extension}`;
    const sourcePath = path.join(pluginDir, fileName);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }
    copyFileStrict(sourcePath, path.join(bundleDir, fileName));
    return;
  }
}

function uniqueStagingDir(outDir) {
  return path.join(outDir, `.openvcs-plugin-staging-${Date.now()}-${process.pid}`);
}

async function writeTarGz(outPath, baseDir, folderName) {
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

async function bundlePlugin(parsedArgs) {
  const { pluginDir, outDir, verbose, noNpmDeps } = parsedArgs;
  if (verbose) {
    process.stderr.write(`Bundling plugin from: ${pluginDir}\n`);
  }

  const { pluginId, moduleExec, manifestPath } = readManifest(pluginDir);
  const themesPath = path.join(pluginDir, "themes");
  const hasThemes = fs.existsSync(themesPath) && fs.lstatSync(themesPath).isDirectory();
  if (!moduleExec && !hasThemes) {
    throw new Error("manifest has no module.exec or themes/");
  }
  validateDeclaredModuleExec(pluginDir, moduleExec);

  ensureDirectory(outDir);
  const stagingRoot = uniqueStagingDir(outDir);
  const bundleDir = path.join(stagingRoot, pluginId);

  ensureDirectory(bundleDir);

  try {
    copyFileStrict(manifestPath, path.join(bundleDir, "openvcs.plugin.json"));
    copyIcon(pluginDir, bundleDir);

    const sourceBinDir = path.join(pluginDir, "bin");
    if (fs.existsSync(sourceBinDir) && fs.lstatSync(sourceBinDir).isDirectory()) {
      copyDirectoryRecursiveStrict(sourceBinDir, path.join(bundleDir, "bin"));
    }
    if (hasThemes) {
      copyDirectoryRecursiveStrict(themesPath, path.join(bundleDir, "themes"));
    }

    if (!noNpmDeps && hasPackageJson(pluginDir)) {
      ensurePackageLock(pluginDir, verbose);
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

module.exports = {
  bundlePlugin,
  distUsage,
  parseDistArgs,
  __private: {
    ICON_EXTENSIONS,
    copyIcon,
    readManifest,
    rejectNativeAddonsRecursive,
    uniqueStagingDir,
    validateDeclaredModuleExec,
    writeTarGz,
  },
};
