// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import * as fs from "node:fs";
import * as path from "node:path";

type ExistsFn = (path: string) => boolean;
type ResolveFn = (specifier: string) => string;

export interface NpmCommand {
  program: string;
  argsPrefix: string[];
}

export function resolveNpmCli(
  execPath = process.execPath,
  exists: ExistsFn = fs.existsSync,
  resolve: ResolveFn = require.resolve,
): string {
  const localNodeModules = path.join(path.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (exists(localNodeModules)) {
    return localNodeModules;
  }

  return resolve("npm/bin/npm-cli.js");
}

export function npmCommand(
  platform = process.platform,
  execPath = process.execPath,
  exists: ExistsFn = fs.existsSync,
  resolve: ResolveFn = require.resolve,
): NpmCommand {
  if (platform !== "win32") {
    return { program: "npm", argsPrefix: [] };
  }

  return { program: execPath, argsPrefix: [resolveNpmCli(execPath, exists, resolve)] };
}

export function npmExecutable(): string {
  return npmCommand().program;
}

export function npmArgsPrefix(): string[] {
  return npmCommand().argsPrefix;
}
