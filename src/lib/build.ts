// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { isPathInside } from "./fs-utils";

type UsageError = Error & { code?: string };

/** CLI arguments for `openvcs build`. */
export interface BuildArgs {
  pluginDir: string;
  verbose: boolean;
}

/** Trimmed manifest details used by build and dist flows. */
export interface ManifestInfo {
  pluginId: string;
  moduleExec: string | undefined;
  manifestPath: string;
}

interface CommandResult {
  status: number | null;
  error?: Error;
}

interface PackageScripts {
  [scriptName: string]: unknown;
}

/** Returns the npm executable name for the current platform. */
export function npmExecutable(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

/** Formats help text for the build command. */
export function buildUsage(commandName = "openvcs"): string {
  return `${commandName} build [args]\n\n  --plugin-dir <path>   Plugin repository root (contains openvcs.plugin.json)\n  -V, --verbose         Enable verbose output\n`;
}

/** Parses `openvcs build` arguments. */
export function parseBuildArgs(args: string[]): BuildArgs {
  let pluginDir = process.cwd();
  let verbose = false;

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
    if (arg === "-V" || arg === "--verbose") {
      verbose = true;
      continue;
    }
    if (arg === "--help") {
      const error = new Error(buildUsage()) as UsageError;
      error.code = "USAGE";
      throw error;
    }
    throw new Error(`unknown flag: ${arg}`);
  }

  return {
    pluginDir: path.resolve(pluginDir),
    verbose,
  };
}

/** Reads and validates the plugin manifest. */
export function readManifest(pluginDir: string): ManifestInfo {
  const manifestPath = path.join(pluginDir, "openvcs.plugin.json");
  let manifestRaw: string;
  let manifestFd: number | undefined;
  let manifest: unknown;
  try {
    manifestFd = fs.openSync(manifestPath, "r");
    const manifestStat = fs.fstatSync(manifestFd);
    if (!manifestStat.isFile()) {
      throw new Error(`missing openvcs.plugin.json at ${manifestPath}`);
    }
    manifestRaw = fs.readFileSync(manifestFd, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`missing openvcs.plugin.json at ${manifestPath}`);
    }
    throw error;
  } finally {
    if (typeof manifestFd === "number") {
      fs.closeSync(manifestFd);
    }
  }

  try {
    manifest = JSON.parse(manifestRaw);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`parse ${manifestPath}: ${detail}`);
  }

  const pluginId =
    typeof (manifest as { id?: unknown }).id === "string"
      ? ((manifest as { id: string }).id.trim() as string)
      : "";
  if (!pluginId) {
    throw new Error(`manifest ${manifestPath} is missing a string 'id'`);
  }
  if (pluginId === "." || pluginId === ".." || pluginId.includes("/") || pluginId.includes("\\")) {
    throw new Error(`manifest id must not contain path separators: ${pluginId}`);
  }

  const moduleValue = (manifest as { module?: { exec?: unknown } }).module;
  const moduleExec = typeof moduleValue?.exec === "string" ? moduleValue.exec.trim() : undefined;

  return {
    pluginId,
    moduleExec,
    manifestPath,
  };
}

/** Verifies that a declared module entry resolves to a real file under `bin/`. */
export function validateDeclaredModuleExec(pluginDir: string, moduleExec: string | undefined): void {
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

/** Returns whether the plugin repository has a `package.json`. */
export function hasPackageJson(pluginDir: string): boolean {
  const packageJsonPath = path.join(pluginDir, "package.json");
  return fs.existsSync(packageJsonPath) && fs.lstatSync(packageJsonPath).isFile();
}

/** Runs a command in the given directory with optional verbose logging. */
export function runCommand(program: string, args: string[], cwd: string, verbose: boolean): void {
  if (verbose) {
    process.stderr.write(`Running command in ${cwd}: ${program} ${args.join(" ")}\n`);
  }

  const result = spawnSync(program, args, {
    cwd,
    stdio: ["ignore", verbose ? "inherit" : "ignore", "inherit"],
  }) as CommandResult;

  if (result.error) {
    throw new Error(`failed to spawn '${program}' in ${cwd}: ${result.error.message}`);
  }
  if (result.status === 0) {
    return;
  }

  throw new Error(`command failed (${program} ${args.join(" ")}), exit code ${result.status}`);
}

/** Reads `package.json` scripts for the plugin, if present. */
function readPackageScripts(pluginDir: string): PackageScripts {
  const packageJsonPath = path.join(pluginDir, "package.json");
  let packageData: unknown;
  try {
    packageData = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`code plugins must include package.json: ${packageJsonPath}`);
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`parse ${packageJsonPath}: ${detail}`);
  }

  const scripts = (packageData as { scripts?: unknown }).scripts;
  if (typeof scripts !== "object" || scripts === null) {
    return {};
  }
  return scripts as PackageScripts;
}

/** Builds a plugin's runtime assets when it declares a code module. */
export function buildPluginAssets(parsedArgs: BuildArgs): ManifestInfo {
  const manifest = readManifest(parsedArgs.pluginDir);
  if (!manifest.moduleExec) {
    return manifest;
  }

  if (!hasPackageJson(parsedArgs.pluginDir)) {
    throw new Error(`code plugins must include package.json: ${path.join(parsedArgs.pluginDir, "package.json")}`);
  }

  const scripts = readPackageScripts(parsedArgs.pluginDir);
  const buildScript = scripts["build:plugin"];
  if (typeof buildScript !== "string" || buildScript.trim() === "") {
    throw new Error(
      `code plugins must define scripts[\"build:plugin\"] in ${path.join(parsedArgs.pluginDir, "package.json")}`
    );
  }

  runCommand(npmExecutable(), ["run", "build:plugin"], parsedArgs.pluginDir, parsedArgs.verbose);
  validateDeclaredModuleExec(parsedArgs.pluginDir, manifest.moduleExec);
  return manifest;
}
