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
  entry: string | undefined;
  manifestPath: string;
}

interface CommandResult {
  status: number | null;
  error?: Error;
}

interface PackageScripts {
  [scriptName: string]: unknown;
}

const AUTHORED_PLUGIN_MODULE_BASENAME = "plugin.js";

/** Returns the npm executable name for the current platform. */
export function npmExecutable(): string {
  return process.platform === "win32" ? process.execPath : "npm";
}

function npmArgsPrefix(): string[] {
  if (process.platform !== "win32") {
    return [];
  }

  return [resolveNpmCli()];
}

function resolveNpmCli(): string {
  const localNodeModules = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (fs.existsSync(localNodeModules)) {
    return localNodeModules;
  }

  return require.resolve("npm/bin/npm-cli.js");
}

/** Formats help text for the build command. */
export function buildUsage(commandName = "openvcs"): string {
  return `${commandName} build [args]\n\n  --plugin-dir <path>   Plugin repository root (contains package.json with openvcs metadata)\n  -V, --verbose         Enable verbose output\n`;
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
  const manifestPath = path.join(pluginDir, "package.json");
  let manifestRaw: string;
  let manifestFd: number | undefined;
  let manifest: unknown;
  try {
    manifestFd = fs.openSync(manifestPath, "r");
    const manifestStat = fs.fstatSync(manifestFd);
    if (!manifestStat.isFile()) {
      throw new Error(`missing package.json at ${manifestPath}`);
    }
    manifestRaw = fs.readFileSync(manifestFd, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`missing package.json at ${manifestPath}`);
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

  const openvcs = (manifest as { openvcs?: unknown }).openvcs as
    | { id?: unknown; module?: { exec?: unknown }; entry?: unknown }
    | undefined;
  if (!openvcs || typeof openvcs !== "object") {
    throw new Error(`package.json ${manifestPath} is missing an 'openvcs' object`);
  }

  const pluginId =
    typeof openvcs.id === "string"
      ? (openvcs.id.trim() as string)
      : "";
  if (!pluginId) {
    throw new Error(`package.json ${manifestPath} is missing openvcs.id`);
  }
  if (pluginId === "." || pluginId === ".." || pluginId.includes("/") || pluginId.includes("\\")) {
    throw new Error(`manifest id must not contain path separators: ${pluginId}`);
  }

  const moduleValue = openvcs.module;
  const moduleExec = typeof moduleValue?.exec === "string" ? moduleValue.exec.trim() : undefined;

  const entryValue = openvcs.entry;
  const entry = typeof entryValue === "string" ? entryValue.trim() : undefined;

  return {
    pluginId,
    moduleExec,
    entry,
    manifestPath,
  };
}

/** Verifies that a declared module entry resolves to a real file under `bin/`. */
export function validateDeclaredModuleExec(pluginDir: string, moduleExec: string | undefined): void {
  if (!moduleExec) {
    return;
  }

  const targetPath = resolveDeclaredModuleExecPath(pluginDir, moduleExec);
  if (!fs.existsSync(targetPath) || !fs.lstatSync(targetPath).isFile()) {
    throw new Error(`module entrypoint not found at ${targetPath}`);
  }
}

/** Resolves `module.exec` to an absolute path under `bin/`, rejecting invalid targets. */
function resolveDeclaredModuleExecPath(pluginDir: string, moduleExec: string): string {
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

  return targetPath;
}

/** Returns the compiled plugin module path imported by the generated bootstrap. */
export function authoredPluginModulePath(pluginDir: string): string {
  return path.resolve(pluginDir, "bin", AUTHORED_PLUGIN_MODULE_BASENAME);
}

/** Ensures the plugin's authored module and generated bootstrap paths are compatible. */
export function validateGeneratedBootstrapTargets(
  pluginDir: string,
  moduleExec: string | undefined,
): void {
  if (!moduleExec) {
    return;
  }

  resolveDeclaredModuleExecPath(pluginDir, moduleExec);
  const normalizedExec = moduleExec.trim().toLowerCase();
  if (normalizedExec === AUTHORED_PLUGIN_MODULE_BASENAME.toLowerCase()) {
    throw new Error(
      `manifest module.exec must not be ${AUTHORED_PLUGIN_MODULE_BASENAME}; SDK reserves bin/${AUTHORED_PLUGIN_MODULE_BASENAME} for the compiled OnPluginStart module`
    );
  }

  const authoredModulePath = authoredPluginModulePath(pluginDir);
  if (!fs.existsSync(authoredModulePath) || !fs.lstatSync(authoredModulePath).isFile()) {
    throw new Error(
      `compiled plugin module not found at ${authoredModulePath}; build:plugin must emit bin/${AUTHORED_PLUGIN_MODULE_BASENAME}`
    );
  }
}

/** Returns a normalized import specifier from one bin file to another. */
function relativeBinImport(fromExecPath: string, toModulePath: string): string {
  const relativePath = path.relative(path.dirname(fromExecPath), toModulePath).replace(/\\/g, "/");
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

/** Validates that a module import path contains only safe characters for code generation. */
function validateModuleImportPath(importPath: string): void {
  if (!/^[./a-zA-Z0-9_-]+$/.test(importPath)) {
    throw new Error(
      `unsafe module import path: ${importPath}; path must contain only alphanumeric characters, dots, slashes, hyphens, and underscores`
    );
  }
}

/** Renders the generated Node bootstrap that owns runtime startup. */
export function renderGeneratedBootstrap(
  pluginModuleImportPath: string,
  isEsm: boolean,
): string {
  validateModuleImportPath(pluginModuleImportPath);

  if (isEsm) {
    return `#!/usr/bin/env node\n// Copyright © 2025-2026 OpenVCS Contributors\n// SPDX-License-Identifier: GPL-3.0-or-later\n\nimport { bootstrapPluginModule } from '@openvcs/sdk/runtime';\n\nawait bootstrapPluginModule({\n  importPluginModule: async () => import('${pluginModuleImportPath}'),\n  modulePath: '${pluginModuleImportPath}',\n});\n`;
  }

  return `#!/usr/bin/env node\n// Copyright © 2025-2026 OpenVCS Contributors\n// SPDX-License-Identifier: GPL-3.0-or-later\n\n(async () => {\n  const { bootstrapPluginModule } = require('@openvcs/sdk/runtime');\n  await bootstrapPluginModule({\n    importPluginModule: async () => require('${pluginModuleImportPath}'),\n    modulePath: '${pluginModuleImportPath}',\n  });\n})();\n`;
}

/** Writes the generated SDK-owned module entrypoint under `bin/<module.exec>`. */
export function generateModuleBootstrap(pluginDir: string, moduleExec: string | undefined): void {
  if (!moduleExec) {
    console.debug(`generateModuleBootstrap: no module.exec defined, skipping bootstrap generation for ${pluginDir}`);
    return;
  }

  validateGeneratedBootstrapTargets(pluginDir, moduleExec);
  const execPath = resolveDeclaredModuleExecPath(pluginDir, moduleExec);
  const pluginModulePath = authoredPluginModulePath(pluginDir);
  const pluginModuleImportPath = relativeBinImport(execPath, pluginModulePath);
  const isEsm = detectEsmMode(pluginDir, moduleExec);

  fs.mkdirSync(path.dirname(execPath), { recursive: true });
  fs.writeFileSync(execPath, renderGeneratedBootstrap(pluginModuleImportPath, isEsm), "utf8");
}

/** Detects whether the plugin runs in ESM mode based on package.json or file extension. */
function detectEsmMode(pluginDir: string, moduleExec: string): boolean {
  const packageJsonPath = path.join(pluginDir, "package.json");
  if (fs.existsSync(packageJsonPath) && fs.lstatSync(packageJsonPath).isFile()) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      if (packageJson.type === "module") {
        return true;
      }
    } catch {
      // Ignore JSON parse errors
    }
  }
  return moduleExec.trim().endsWith(".mjs");
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
    windowsHide: true,
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

  runCommand(npmExecutable(), [...npmArgsPrefix(), "run", "build:plugin"], parsedArgs.pluginDir, parsedArgs.verbose);
  generateModuleBootstrap(parsedArgs.pluginDir, manifest.moduleExec);
  validateDeclaredModuleExec(parsedArgs.pluginDir, manifest.moduleExec);
  return manifest;
}
