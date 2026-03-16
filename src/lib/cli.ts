import { buildPluginAssets, buildUsage, parseBuildArgs } from "./build";
import { bundlePlugin, distUsage, parseDistArgs } from "./dist";
import { initUsage, runInitCommand } from "./init";

const packageJson: { version: string } = require("../package.json");

interface CodedError {
  code?: string;
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as CodedError).code === code
  );
}

function usage(): string {
  return "Usage: openvcs <command> [options]\n\nCommands:\n  build [args]           Build plugin runtime assets\n  dist [args]            Package plugin into .ovcsp\n  init [--theme] [dir]   Interactively scaffold a plugin project\n  -v, --version          Show version information\n\nBuild args:\n  --plugin-dir <path>    Plugin root containing openvcs.plugin.json\n  -V, --verbose          Verbose output\n\nDist args:\n  --plugin-dir <path>    Plugin root containing openvcs.plugin.json\n  --out <path>           Output directory (default: ./dist)\n  --no-build             Skip plugin build before packaging\n  --no-npm-deps          Skip npm dependency bundling\n  -V, --verbose          Verbose output\n";
}

export async function runCli(args: string[]): Promise<void> {
  if (args.length === 0) {
    process.stderr.write(usage());
    process.exitCode = 1;
    return;
  }

  if (args[0] === "-v" || args[0] === "--version") {
    process.stdout.write(`openvcs ${packageJson.version}\n`);
    return;
  }

  const [command, ...rest] = args;
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(usage());
    return;
  }

  if (command === "dist") {
    if (rest.includes("--help")) {
      process.stdout.write(distUsage());
      return;
    }
    try {
      const parsed = parseDistArgs(rest);
      const outPath = await bundlePlugin(parsed);
      process.stdout.write(`${outPath}\n`);
      return;
    } catch (error: unknown) {
      if (hasCode(error, "USAGE")) {
        throw new Error(distUsage());
      }
      throw error;
    }
  }

  if (command === "build") {
    if (rest.includes("--help")) {
      process.stdout.write(buildUsage());
      return;
    }
    try {
      const parsed = parseBuildArgs(rest);
      const manifest = buildPluginAssets(parsed);
      process.stdout.write(`${manifest.pluginId}\n`);
      return;
    } catch (error: unknown) {
      if (hasCode(error, "USAGE")) {
        throw new Error(buildUsage());
      }
      throw error;
    }
  }

  if (command === "init") {
    if (rest.includes("--help")) {
      process.stdout.write(initUsage());
      return;
    }
    try {
      const targetDir = await runInitCommand(rest);
      process.stdout.write(`Initialized plugin at ${targetDir}\n`);
      return;
    } catch (error: unknown) {
      if (hasCode(error, "USAGE")) {
        throw new Error(initUsage());
      }
      throw error;
    }
  }

  throw new Error(`unknown command: ${command}`);
}
