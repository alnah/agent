/**
 * Runtime dependencies for this extension.
 *
 * Keeps process, filesystem, and command execution seams in one place so
 * other modules can stay focused on behavior and stay easy to test.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export type ExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type ExecCommand = (
  command: string,
  args: string[],
  options?: { cwd?: string },
) => Promise<ExecResult>;

export type FilesFsDeps = {
  existsSync: typeof existsSync;
  statSync: typeof statSync;
  readFileSync: typeof readFileSync;
  writeFileSync: typeof writeFileSync;
  mkdtempSync: typeof mkdtempSync;
  rmSync: typeof rmSync;
};

export type FilesProcessDeps = {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  tmpdir: () => string;
  shell: () => string;
};

export type FilesSpawnSync = typeof spawnSync;

export const defaultFsDeps: FilesFsDeps = {
  existsSync,
  statSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
};

export const defaultProcessDeps: FilesProcessDeps = {
  env: process.env,
  platform: process.platform,
  tmpdir: () => os.tmpdir(),
  shell: () => process.env.SHELL || "/bin/sh",
};

export const defaultSpawnSync: FilesSpawnSync = spawnSync;

/**
 * Adapts pi's `exec()` API to the smaller command shape used internally.
 */
export const createExecCommand =
  (pi: ExtensionAPI): ExecCommand =>
  async (command, args, options) => {
    const result = await pi.exec(command, args, options);
    return {
      code: result.code ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  };
