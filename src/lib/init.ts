import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { spawnSync } from "node:child_process";

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

interface InitCommandError {
  code?: string;
}

function npmExecutable(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
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

async function promptText(
  rl: readline.Interface,
  label: string,
  defaultValue = ""
): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await rl.question(`${label}${suffix}: `);
  const trimmed = answer.trim();
  return trimmed || defaultValue;
}

async function promptBoolean(
  rl: readline.Interface,
  label: string,
  defaultValue: boolean
): Promise<boolean> {
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
    process.stderr.write("Please answer yes or no.\n");
  }
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

async function collectAnswers({ forceTheme, targetHint }: CollectAnswersOptions): Promise<InitAnswers> {
  const defaultTarget = targetHint || path.join(process.cwd(), "openvcs-plugin");
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const targetText = await promptText(rl, "Target directory", defaultTarget);
    const targetDir = path.resolve(targetText);

    let kind: "module" | "theme" = "module";
    if (forceTheme) {
      kind = "theme";
    } else {
      while (true) {
        const value = (await promptText(rl, "Template type (module/theme)", "module"))
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
        process.stderr.write("Please choose 'module' or 'theme'.\n");
      }
    }

    const defaultId = defaultPluginIdFromDir(targetDir);
    let pluginId = "";
    while (!pluginId) {
      pluginId = (await promptText(rl, "Plugin id", defaultId)).trim();
    }

    const defaultName = defaultPluginNameFromId(pluginId);
    let pluginName = "";
    while (!pluginName) {
      pluginName = (await promptText(rl, "Plugin name", defaultName)).trim();
    }

    let pluginVersion = "";
    while (!pluginVersion) {
      pluginVersion = (await promptText(rl, "Version", "0.1.0")).trim();
    }

    const defaultEnabled = await promptBoolean(rl, "Default enabled", true);
    const runNpmInstall = await promptBoolean(rl, "Run npm install now", true);

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
    rl.close();
  }
}

function runNpmInstall(targetDir: string): void {
  const result = spawnSync(npmExecutable(), ["install"], {
    cwd: targetDir,
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(`failed to spawn npm install in ${targetDir}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`npm install failed in ${targetDir} (code ${result.status})`);
  }
}

function writeCommonFiles(answers: InitAnswers): void {
  writeJson(path.join(answers.targetDir, "openvcs.plugin.json"), {
    id: answers.pluginId,
    name: answers.pluginName,
    version: answers.pluginVersion,
    default_enabled: answers.defaultEnabled,
    ...(answers.kind === "module" ? { module: { exec: "plugin.js" } } : {}),
  });
  writeText(path.join(answers.targetDir, ".gitignore"), "node_modules/\ndist/\n");
}

function writeModuleTemplate(answers: InitAnswers): void {
  writeCommonFiles(answers);
  writeJson(path.join(answers.targetDir, "package.json"), {
    name: answers.pluginId,
    version: answers.pluginVersion,
    private: true,
    type: "module",
    scripts: {
      "build:ts": "tsc -p tsconfig.json",
      build: "npm run build:ts && openvcs dist --plugin-dir . --out dist",
      test: "openvcs dist --plugin-dir . --out dist --no-npm-deps",
    },
    devDependencies: {
      "@openvcs/sdk": `^${packageJson.version}`,
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
    "const message = \"OpenVCS plugin started\";\nprocess.stderr.write(`${message}\\n`);\n"
  );
}

function writeThemeTemplate(answers: InitAnswers): void {
  writeCommonFiles(answers);
  writeJson(path.join(answers.targetDir, "package.json"), {
    name: answers.pluginId,
    version: answers.pluginVersion,
    private: true,
    scripts: {
      build: "openvcs dist --plugin-dir . --out dist",
      test: "openvcs dist --plugin-dir . --out dist --no-npm-deps",
    },
    devDependencies: {
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
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      const proceed = await promptBoolean(
        rl,
        `Directory ${answers.targetDir} is not empty. Continue and overwrite known files`,
        false
      );
      if (!proceed) {
        throw new Error("aborted by user");
      }
    } finally {
      rl.close();
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
