/**
 * Shared side-effect helpers for file actions.
 *
 * These helpers wrap the lowest-level process and temp-file behavior so the
 * higher-level action module can focus on policy, messaging, and orchestration.
 */

import path from "node:path";
import type { TUI } from "@mariozechner/pi-tui";
import {
  defaultFsDeps,
  defaultProcessDeps,
  defaultSpawnSync,
  type ExecCommand,
  type FilesFsDeps,
  type FilesProcessDeps,
  type FilesSpawnSync,
} from "./runtime.ts";
import { MAX_DIFF_BYTES, type SafetyDeps } from "./safety.ts";

export type ActionDeps = {
  fs: Pick<
    FilesFsDeps,
    | "existsSync"
    | "mkdtempSync"
    | "readFileSync"
    | "rmSync"
    | "statSync"
    | "writeFileSync"
  >;
  process: FilesProcessDeps;
  spawnSync: FilesSpawnSync;
};

export const defaultActionDeps: ActionDeps = {
  fs: defaultFsDeps,
  process: defaultProcessDeps,
  spawnSync: defaultSpawnSync,
};

const shellQuote = (value: string): string =>
  `'${value.replace(/'/g, "'\"'\"'")}'`;

/**
 * Best-effort recursive cleanup for temporary paths created by file actions.
 */
export const cleanupPath = (
  targetPath: string,
  deps: Pick<ActionDeps, "fs"> = defaultActionDeps,
): void => {
  try {
    deps.fs.rmSync(targetPath, { recursive: true, force: true });
  } catch {}
};

/**
 * Executes a command through the injected runtime and normalizes failures.
 */
export const runCommand = async (
  execCommand: ExecCommand,
  command: string,
  args: string[],
  fallbackMessage: string,
  cwd?: string,
): Promise<{ ok: boolean; message?: string }> => {
  try {
    const result = await execCommand(command, args, cwd ? { cwd } : undefined);
    if (result.code === 0) {
      return { ok: true };
    }
    return { ok: false, message: result.stderr?.trim() || fallbackMessage };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : fallbackMessage,
    };
  }
};

/**
 * Opens the configured external editor against a temporary buffer and returns
 * the edited content when the editor exits successfully.
 */
export const openExternalEditor = (
  tui: TUI,
  editorCmd: string,
  content: string,
  deps: ActionDeps = defaultActionDeps,
): { content?: string; error?: string; cancelled?: boolean } => {
  let tempDir = "";
  let tempFile = "";

  try {
    tempDir = deps.fs.mkdtempSync(
      path.join(deps.process.tmpdir(), "pi-files-edit-"),
    );
    tempFile = path.join(tempDir, "edit-buffer.txt");
    deps.fs.writeFileSync(tempFile, content, "utf8");
    tui.stop();

    const result = deps.spawnSync(
      deps.process.shell(),
      ["-lc", `${editorCmd} ${shellQuote(tempFile)}`],
      { stdio: "inherit" },
    );

    if (result.error) {
      return { error: result.error.message };
    }
    if (result.status !== 0) {
      return { cancelled: true };
    }

    return { content: deps.fs.readFileSync(tempFile, "utf8") };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Failed to open editor",
    };
  } finally {
    if (tempDir) {
      cleanupPath(tempDir, deps);
    }
    tui.start();
    tui.requestRender(true);
  }
};

/**
 * Reuses action-level dependencies as safety-layer overrides when both layers
 * need to inspect the same filesystem and runtime state.
 */
export const toSafetyOverrides = (
  execCommand: ExecCommand,
  actionDeps: ActionDeps,
  overrides: Partial<SafetyDeps>,
): Partial<SafetyDeps> => ({
  ...overrides,
  fs: overrides.fs ?? {
    existsSync: actionDeps.fs.existsSync,
    readFileSync: actionDeps.fs.readFileSync,
    statSync: actionDeps.fs.statSync,
  },
  process: overrides.process ?? actionDeps.process,
  execCommand: overrides.execCommand ?? execCommand,
});

const ensureDiffContentSafe = (
  content: string,
): { ok: true } | { ok: false; reason: string } => {
  const buffer = Buffer.from(content, "utf8");
  if (buffer.byteLength > MAX_DIFF_BYTES) {
    return { ok: false, reason: "File is too large to diff safely" };
  }
  if (buffer.includes(0)) {
    return { ok: false, reason: "Binary files cannot be diffed safely" };
  }
  return { ok: true };
};

/**
 * Reads the HEAD version of a tracked file and validates that the diff input is
 * still safe to materialize in temporary files.
 */
export const readHeadDiffContent = async (
  execCommand: ExecCommand,
  gitRoot: string,
  relativePath: string,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> => {
  const existsInHead = await execCommand(
    "git",
    ["cat-file", "-e", `HEAD:${relativePath}`],
    { cwd: gitRoot },
  );
  if (existsInHead.code !== 0) {
    return { ok: true, text: "" };
  }

  const result = await execCommand("git", ["show", `HEAD:${relativePath}`], {
    cwd: gitRoot,
  });
  if (result.code !== 0) {
    return {
      ok: false,
      reason: result.stderr?.trim() || `Failed to diff ${relativePath}`,
    };
  }

  const text = result.stdout ?? "";
  const safety = ensureDiffContentSafe(text);
  if (safety.ok === false) {
    return { ok: false, reason: safety.reason };
  }

  return { ok: true, text };
};
