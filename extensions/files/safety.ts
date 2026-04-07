/**
 * Safety and capability checks for this extension.
 *
 * This module answers questions such as: "is this action allowed?", "what is
 * missing on this platform?", and "how should we explain that to the user?"
 */

import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type {
  ActionAvailability,
  ActionCheckResult,
  EditLoadResult,
  FileEntry,
} from "./models.ts";
import { debugFiles } from "./operability.ts";
import { isPathInside } from "./paths.ts";
import {
  createExecCommand,
  defaultFsDeps,
  defaultProcessDeps,
  type ExecCommand,
  type FilesFsDeps,
  type FilesProcessDeps,
} from "./runtime.ts";

export const MAX_TEXT_EDIT_BYTES = 10 * 1024 * 1024;
export const MAX_DIFF_BYTES = 10 * 1024 * 1024;

export type SafetyDeps = {
  fs: Pick<FilesFsDeps, "existsSync" | "readFileSync" | "statSync">;
  process: FilesProcessDeps;
  execCommand: ExecCommand;
  commandAvailabilityCache: Map<string, Promise<boolean>>;
};

const defaultCommandAvailabilityCache = new Map<string, Promise<boolean>>();

/**
 * Builds the lightweight dependency bundle used by safety checks.
 */
export const createSafetyDeps = (
  execCommand: ExecCommand,
  overrides: Partial<SafetyDeps> = {},
): SafetyDeps => ({
  fs: overrides.fs ?? defaultFsDeps,
  process: overrides.process ?? defaultProcessDeps,
  execCommand,
  commandAvailabilityCache:
    overrides.commandAvailabilityCache ?? defaultCommandAvailabilityCache,
});

const hasOpenAccess = (target: FileEntry): boolean =>
  target.inRepo || target.isReferenced;

const readTextFile = (
  targetPath: string,
  maxBytes: number,
  sizeMessage: string,
  deps: Pick<SafetyDeps, "fs">,
): EditLoadResult => {
  try {
    const stats = deps.fs.statSync(targetPath);
    if (!stats.isFile()) {
      return { allowed: false, reason: "Only regular files are supported" };
    }
    if (stats.size > maxBytes) {
      return { allowed: false, reason: sizeMessage };
    }

    const buffer = deps.fs.readFileSync(targetPath);
    if (buffer.includes(0)) {
      return { allowed: false, reason: "Binary files are not allowed" };
    }

    return { allowed: true, content: buffer.toString("utf8") };
  } catch (error) {
    return {
      allowed: false,
      reason: error instanceof Error ? error.message : "Failed to read file",
    };
  }
};

const isProtectedEditPath = (
  target: FileEntry,
  gitRoot: string | null,
): boolean => {
  if (!gitRoot) {
    return false;
  }

  return isPathInside(path.join(gitRoot, ".git"), target.canonicalPath);
};

const getCommandCheck = (command: string): string[] => {
  if (command === "git" || command === "code") {
    return ["--version"];
  }
  if (command === "qlmanage") {
    return ["-h"];
  }
  return ["--help"];
};

/**
 * Checks whether a required command is available, with cache reuse across
 * repeated availability checks in the same process.
 */
export const isCommandAvailable = async (
  command: string,
  deps: Pick<SafetyDeps, "commandAvailabilityCache" | "execCommand">,
): Promise<boolean> => {
  const cached = deps.commandAvailabilityCache.get(command);
  if (cached) {
    return cached;
  }

  const promise = deps
    .execCommand(command, getCommandCheck(command))
    .then((result) => result.code === 0)
    .catch(() => false);
  deps.commandAvailabilityCache.set(command, promise);
  return promise;
};

/**
 * Returns the platform-specific command used for generic file opening.
 */
export const getOpenCommand = (
  platform: NodeJS.Platform = defaultProcessDeps.platform,
): string => (platform === "darwin" ? "open" : "xdg-open");

/**
 * Returns the platform-specific command used to reveal a file or directory.
 */
export const getRevealCommand = (
  platform: NodeJS.Platform = defaultProcessDeps.platform,
): { command: string; args: string[] } =>
  platform === "darwin"
    ? { command: "open", args: [] }
    : { command: "xdg-open", args: [] };

/**
 * Validates whether a file can be edited safely under the current policy.
 */
export const getEditCheck = (
  target: FileEntry,
  gitRoot: string | null,
  deps: Pick<SafetyDeps, "fs"> = { fs: defaultFsDeps },
): ActionCheckResult => {
  if (!target.exists || !deps.fs.existsSync(target.resolvedPath)) {
    return { allowed: false, reason: "File not found" };
  }
  if (!target.inRepo) {
    return { allowed: false, reason: "Editing is limited to repository files" };
  }
  if (target.isDirectory) {
    return { allowed: false, reason: "Directories cannot be edited" };
  }
  if (isProtectedEditPath(target, gitRoot)) {
    return { allowed: false, reason: "Files inside .git cannot be edited" };
  }

  try {
    const stats = deps.fs.statSync(target.resolvedPath);
    if (!stats.isFile()) {
      return { allowed: false, reason: "Special files cannot be edited" };
    }
  } catch (error) {
    return {
      allowed: false,
      reason: error instanceof Error ? error.message : "Failed to inspect file",
    };
  }

  const textCheck = readTextFile(
    target.resolvedPath,
    MAX_TEXT_EDIT_BYTES,
    "File is too large to edit safely",
    deps,
  );
  return textCheck.allowed
    ? { allowed: true }
    : { allowed: false, reason: textCheck.reason };
};

/**
 * Loads editable text content only after the edit policy has passed.
 */
export const loadEditableContent = (
  target: FileEntry,
  gitRoot: string | null,
  deps: Pick<SafetyDeps, "fs"> = { fs: defaultFsDeps },
): EditLoadResult => {
  const editCheck = getEditCheck(target, gitRoot, deps);
  if (!editCheck.allowed) {
    return editCheck;
  }

  return readTextFile(
    target.resolvedPath,
    MAX_TEXT_EDIT_BYTES,
    "File is too large to edit safely",
    deps,
  );
};

const getQuickLookCheck = async (
  target: FileEntry,
  deps: SafetyDeps,
): Promise<ActionCheckResult> => {
  if (deps.process.platform !== "darwin") {
    return { allowed: false, reason: "Quick Look is only available on macOS" };
  }
  if (!hasOpenAccess(target)) {
    return { allowed: false, reason: "Path is outside the allowed scope" };
  }
  if (!target.exists || !deps.fs.existsSync(target.resolvedPath)) {
    return { allowed: false, reason: "File not found" };
  }
  if (target.isDirectory) {
    return { allowed: false, reason: "Quick Look only works on files" };
  }

  return (await isCommandAvailable("qlmanage", deps))
    ? { allowed: true }
    : { allowed: false, reason: "qlmanage is not available" };
};

const getDiffCandidate = (
  target: FileEntry,
  gitRoot: string | null,
): ActionCheckResult => {
  if (!gitRoot) {
    return { allowed: false, reason: "Git repository not found" };
  }
  if (!target.inRepo) {
    return { allowed: false, reason: "Diff is limited to repository files" };
  }
  if (!target.isTracked) {
    return {
      allowed: false,
      reason: "Diff is only available for tracked files",
    };
  }
  if (target.isDirectory) {
    return { allowed: false, reason: "Directories cannot be diffed" };
  }
  return { allowed: true };
};

/**
 * Computes picker-facing availability flags and operator-facing reasons for all
 * actions on a given file.
 */
export const getActionAvailability = async (
  pi: ExtensionAPI,
  target: FileEntry,
  gitRoot: string | null,
  overrides: Partial<SafetyDeps> = {},
): Promise<ActionAvailability> => {
  const deps = createSafetyDeps(createExecCommand(pi), overrides);
  const accessCheck = getOpenAccessCheck(target, deps);
  const openReason = accessCheck.allowed ? undefined : accessCheck.reason;
  const editCheck = getEditCheck(target, gitRoot, deps);
  const diffCheck = getDiffCandidate(target, gitRoot);
  const quickLookCheck = await getQuickLookCheck(target, deps);
  const codeAvailable = diffCheck.allowed
    ? await isCommandAvailable("code", deps)
    : false;
  const editorCommand = deps.process.env.VISUAL || deps.process.env.EDITOR;

  debugFiles(deps.process.env, "computed action availability", {
    target: target.displayPath,
    gitRoot,
    platform: deps.process.platform,
    canOpen: accessCheck.allowed,
    canQuickLook: quickLookCheck.allowed,
    canEdit: editCheck.allowed && Boolean(editorCommand),
    canDiff: diffCheck.allowed && codeAvailable,
  });

  return {
    canReveal: accessCheck.allowed,
    canOpen: accessCheck.allowed,
    canQuickLook: quickLookCheck.allowed,
    canEdit: editCheck.allowed && Boolean(editorCommand),
    canDiff: diffCheck.allowed && codeAvailable,
    revealReason: openReason,
    openReason,
    quickLookReason: quickLookCheck.allowed
      ? undefined
      : quickLookCheck.reason === "qlmanage is not available"
        ? "Missing required command: qlmanage. Quick Look is only available on macOS."
        : quickLookCheck.reason,
    editReason: editCheck.allowed
      ? editorCommand
        ? undefined
        : "No editor configured. Set $VISUAL or $EDITOR and retry."
      : editCheck.reason,
    diffReason: diffCheck.allowed
      ? codeAvailable
        ? undefined
        : "Missing required command: code. Install the VS Code CLI and retry."
      : diffCheck.reason,
  };
};

/**
 * Verifies whether an open-like action is allowed for the target path.
 */
export const getOpenAccessCheck = (
  target: FileEntry,
  deps: Pick<SafetyDeps, "fs"> = { fs: defaultFsDeps },
): ActionCheckResult => {
  if (!hasOpenAccess(target)) {
    return { allowed: false, reason: "Path is outside the allowed scope" };
  }
  if (!target.exists || !deps.fs.existsSync(target.resolvedPath)) {
    return { allowed: false, reason: "File not found" };
  }
  return { allowed: true };
};

/**
 * Exposes the Quick Look check for action handlers and tests.
 */
export const getQuickLookAvailability = async (
  pi: ExtensionAPI,
  target: FileEntry,
  overrides: Partial<SafetyDeps> = {},
): Promise<ActionCheckResult> =>
  getQuickLookCheck(target, createSafetyDeps(createExecCommand(pi), overrides));

export const getDiffAvailability = getDiffCandidate;

/**
 * Reads working-tree text that will be materialized in a diff temp file.
 */
export const readSafeDiffText = (
  targetPath: string,
  deps: Pick<SafetyDeps, "fs"> = { fs: defaultFsDeps },
): EditLoadResult =>
  readTextFile(
    targetPath,
    MAX_DIFF_BYTES,
    "File is too large to diff safely",
    deps,
  );
