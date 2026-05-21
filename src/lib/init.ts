import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { spawnSync } from "node:child_process";

import { npmArgsPrefix, npmExecutable } from "./npm-runner";

const packageJson: { version: string } = require("../package.json");

type UsageError = Error & { code?: string };

interface InitAnswers {
  targetDir: string;
  kind: "module" | "theme";
  pluginId: string;
  pluginName: string;
  pluginVersion: string;
  defaultEnabled: boolean;
  runNpmInstall: boolean;
}

interface CollectAnswersOptions {
  forceTheme: boolean;
  targetHint?: string;
}

interface PromptDriver {
  promptText(label: string, defaultValue?: string): Promise<string>;
  promptBoolean(label: string, defaultValue: boolean): Promise<boolean>;
  close(): void;
}

interface InitCommandError {
  code?: string;
}

export function initUsage(commandName = "openvcs"): string {
  return `Usage: ${commandName} init [--theme] [target-dir]\n\nOptions:\n  --theme                Start with a theme-only plugin template\n`;
}

function sanitizeIdToken(raw: string): string {
  let output = "";
  let lastWasSeparator = false;
  for (const char of raw) {
    const isValid = /[a-zA-Z0-9._-]/.test(char);
    if (isValid) {
      output += char.toLowerCase();
      lastWasSeparator = false;
      continue;
    }
    if (!lastWasSeparator) {
      output += "-";
      lastWasSeparator = true;
    }
  }
  return output.replace(/^-+|-+$/g, "");
}

function defaultPluginIdFromDir(targetDir: string): string {
  const name = path.basename(targetDir) || "openvcs-plugin";
  const token = sanitizeIdToken(name);
  return token || "openvcs.plugin";
}

function defaultPluginNameFromId(pluginId: string): string {
  const words = pluginId
    .split(/[._-]+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1));
  return words.length > 0 ? words.join(" ") : "OpenVCS Plugin";
}

function validatePluginId(pluginId: string): string | undefined {
  if (!pluginId) {
    return "Plugin id is required.";
  }
  if (pluginId === "." || pluginId === "..") {
    return "Plugin id must not be '.' or '..'.";
  }
  if (pluginId.includes("/") || pluginId.includes("\\")) {
    return "Plugin id must not contain path separators (/ or \\).";
  }
  return undefined;
}

function createReadlinePromptDriver(output: NodeJS.WritableStream = process.stderr): PromptDriver {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  return {
    async promptText(label: string, defaultValue = ""): Promise<string> {
      const suffix = defaultValue ? ` [${defaultValue}]` : "";
      const answer = await rl.question(`${label}${suffix}: `);
      const trimmed = answer.trim();
      return trimmed || defaultValue;
    },
    async promptBoolean(label: string, defaultValue: boolean): Promise<boolean> {
      const suffix = defaultValue ? "Y/n" : "y/N";
      while (true) {
        const answer = await rl.question(`${label} (${suffix}): `);
        const normalized = answer.trim().toLowerCase();
        if (!normalized) {
          return defaultValue;
        }
        if (normalized === "y" || normalized === "yes") {
          return true;
        }
        if (normalized === "n" || normalized === "no") {
          return false;
        }
        output.write("Please answer yes or no.\n");
      }
    },
    close(): void {
      rl.close();
    },
  };
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function directoryHasEntries(targetDir: string): boolean {
  const entries = fs.readdirSync(targetDir);
  return entries.length > 0;
}

async function collectAnswers(
  { forceTheme, targetHint }: CollectAnswersOptions,
  promptDriver: PromptDriver = createReadlinePromptDriver(),
  output: NodeJS.WritableStream = process.stderr
): Promise<InitAnswers> {
  const defaultTarget = targetHint || path.join(process.cwd(), "openvcs-plugin");
  try {
    const targetText = await promptDriver.promptText("Target directory", defaultTarget);
    const targetDir = path.resolve(targetText);

    let kind: "module" | "theme" = "module";
    if (forceTheme) {
      kind = "theme";
    } else {
      while (true) {
        const value = (await promptDriver.promptText("Template type (module/theme)", "module"))
          .trim()
          .toLowerCase();
        if (value === "module" || value === "m") {
          kind = "module";
          break;
        }
        if (value === "theme" || value === "t") {
          kind = "theme";
          break;
        }
        output.write("Please choose 'module' or 'theme'.\n");
      }
    }

    const defaultId = defaultPluginIdFromDir(targetDir);
    let pluginId: string | undefined;
    while (!pluginId) {
      const candidateId = (await promptDriver.promptText("Plugin id", defaultId)).trim();
      const validationError = validatePluginId(candidateId);
      if (!validationError) {
        pluginId = candidateId;
        break;
      }
      output.write(`${validationError}\n`);
    }

    const defaultName = defaultPluginNameFromId(pluginId);
    let pluginName = "";
    while (!pluginName) {
      pluginName = (await promptDriver.promptText("Plugin name", defaultName)).trim();
    }

    let pluginVersion = "";
    while (!pluginVersion) {
      pluginVersion = (await promptDriver.promptText("Version", "0.1.0")).trim();
    }

    const defaultEnabled = await promptDriver.promptBoolean("Default enabled", true);
    const runNpmInstall = await promptDriver.promptBoolean("Run npm install now", true);

    return {
      targetDir,
      kind,
      pluginId,
      pluginName,
      pluginVersion,
      defaultEnabled,
      runNpmInstall,
    };
  } finally {
    promptDriver.close();
  }
}

function runNpmInstall(targetDir: string): void {
  const result = spawnSync(npmExecutable(), [...npmArgsPrefix(), "install"], {
    cwd: targetDir,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`failed to spawn npm install in ${targetDir}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`npm install failed in ${targetDir} (code ${result.status})`);
  }
}

function writeCommonFiles(answers: InitAnswers): void {
  writeText(path.join(answers.targetDir, ".gitignore"), "node_modules/\ndist/\n");
}

function writeModuleTemplate(answers: InitAnswers): void {
  writeCommonFiles(answers);
  writeJson(path.join(answers.targetDir, "package.json"), {
    name: answers.pluginId,
    version: answers.pluginVersion,
    private: true,
    type: "module",
    openvcs: {
      id: answers.pluginId,
      name: answers.pluginName,
      version: answers.pluginVersion,
      default_enabled: answers.defaultEnabled,
      module: { exec: "openvcs-plugin.js" },
    },
    scripts: {
      "build:plugin": "tsc -p tsconfig.json",
      build: "openvcs build",
      test: "npm run build",
    },
    dependencies: {
      "@openvcs/sdk": `^${packageJson.version}`,
    },
    devDependencies: {
      "@types/node": "^22.0.0",
      typescript: "^5.8.2",
    },
  });
  writeJson(path.join(answers.targetDir, "tsconfig.json"), {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      types: ["node"],
      strict: true,
      skipLibCheck: true,
      outDir: "bin",
      rootDir: "src",
    },
    include: ["src/**/*.ts"],
  });
  writeText(
    path.join(answers.targetDir, "src", "plugin.ts"),
    "// Copyright © 2025-2026 OpenVCS Contributors\n// SPDX-License-Identifier: GPL-3.0-or-later\n\nimport type { PluginModuleDefinition } from '@openvcs/sdk/runtime';\n\nexport const PluginDefinition: PluginModuleDefinition = {\n  plugin: {\n    async 'plugin.init'(_params, context) {\n      context.host.info('OpenVCS plugin started');\n      return null;\n    },\n  },\n};\n\n/** Runs plugin startup work before the generated runtime begins processing requests. */\nexport function OnPluginStart(): void {}\n"
  );
}

function writeThemeTemplate(answers: InitAnswers): void {
  writeCommonFiles(answers);
  writeJson(path.join(answers.targetDir, "package.json"), {
    name: answers.pluginId,
    version: answers.pluginVersion,
    private: true,
    openvcs: {
      id: answers.pluginId,
      name: answers.pluginName,
      version: answers.pluginVersion,
      default_enabled: answers.defaultEnabled,
    },
    scripts: {
      build: "openvcs build",
      test: "npm run build",
    },
    dependencies: {
      "@openvcs/sdk": `^${packageJson.version}`,
    },
  });
  writeJson(path.join(answers.targetDir, "themes", "default", "theme.json"), {
    name: answers.pluginName || "Default Theme",
    description: "Starter OpenVCS theme generated by @openvcs/sdk",
    tokens: {
      accent: "#2a7fff",
      background: "#0f172a",
      foreground: "#e2e8f0",
    },
  });
}

export async function runInitCommand(args: string[]): Promise<string> {
  let forceTheme = false;
  let targetHint: string | undefined;

  for (const arg of args) {
    if (arg === "--theme") {
      forceTheme = true;
      continue;
    }
    if (arg === "--help") {
      const error = new Error(initUsage()) as UsageError;
      error.code = "USAGE";
      throw error;
    }
    if (arg.startsWith("-")) {
      throw new Error(`unknown argument for init: ${arg}`);
    }
    if (targetHint) {
      throw new Error("init accepts at most one target directory");
    }
    targetHint = arg;
  }

  const answers = await collectAnswers({ forceTheme, targetHint });
  if (!fs.existsSync(answers.targetDir)) {
    fs.mkdirSync(answers.targetDir, { recursive: true });
  } else if (!fs.lstatSync(answers.targetDir).isDirectory()) {
    throw new Error(`target path exists but is not a directory: ${answers.targetDir}`);
  } else if (directoryHasEntries(answers.targetDir)) {
    const promptDriver = createReadlinePromptDriver();
    try {
      const proceed = await promptDriver.promptBoolean(
        `Directory ${answers.targetDir} is not empty. Continue and overwrite known files`,
        false
      );
      if (!proceed) {
        throw new Error("aborted by user");
      }
    } finally {
      promptDriver.close();
    }
  }

  if (answers.kind === "module") {
    writeModuleTemplate(answers);
  } else {
    writeThemeTemplate(answers);
  }

  if (answers.runNpmInstall) {
    runNpmInstall(answers.targetDir);
  }

  return answers.targetDir;
}

export function isUsageError(error: unknown): error is InitCommandError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as InitCommandError).code === "string"
  );
}

export const __private = {
  collectAnswers,
  createReadlinePromptDriver,
  defaultPluginIdFromDir,
  sanitizeIdToken,
  validatePluginId,
  writeModuleTemplate,
  writeThemeTemplate,
};
