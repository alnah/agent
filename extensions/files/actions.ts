/**
 * User-facing file actions for this extension.
 *
 * Each exported action assumes policy has already been computed or recomputes a
 * small preflight, then focuses on messaging and side-effect orchestration.
 */

import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import {
  type ActionDeps,
  cleanupPath,
  defaultActionDeps,
  openExternalEditor,
  readHeadDiffContent,
  runCommand,
  toSafetyOverrides,
} from "./execution.ts";
import type { FileEntry } from "./models.ts";
import {
  debugFiles,
  formatFailureMessage,
  formatSuccessMessage,
  formatUnavailableActionMessage,
} from "./operability.ts";
import { createExecCommand } from "./runtime.ts";
import {
  createSafetyDeps,
  getDiffAvailability,
  getOpenAccessCheck,
  getOpenCommand,
  getQuickLookAvailability,
  getRevealCommand,
  isCommandAvailable,
  loadEditableContent,
  readSafeDiffText,
  type SafetyDeps,
} from "./safety.ts";

/**
 * Opens the selected file in the user's configured external editor.
 */
export const editPath = async (
  ctx: ExtensionContext,
  target: FileEntry,
  gitRoot: string | null,
  deps: Partial<ActionDeps & SafetyDeps> = {},
): Promise<void> => {
  const actionDeps: ActionDeps = {
    ...defaultActionDeps,
    ...deps,
    fs: deps.fs ?? defaultActionDeps.fs,
    process: deps.process ?? defaultActionDeps.process,
    spawnSync: deps.spawnSync ?? defaultActionDeps.spawnSync,
  };
  const content = loadEditableContent(target, gitRoot, {
    fs: {
      existsSync: actionDeps.fs.existsSync,
      readFileSync: actionDeps.fs.readFileSync,
      statSync: actionDeps.fs.statSync,
    },
  });
  if (!content.allowed || content.content === undefined) {
    ctx.ui.notify(
      formatUnavailableActionMessage(
        "edit",
        target,
        content.reason ?? "Editing policy blocked this file.",
      ),
      "warning",
    );
    return;
  }

  const editorCmd =
    actionDeps.process.env.VISUAL || actionDeps.process.env.EDITOR;
  if (!editorCmd) {
    ctx.ui.notify(
      formatUnavailableActionMessage(
        "edit",
        target,
        "No editor configured. Set $VISUAL or $EDITOR and retry.",
      ),
      "warning",
    );
    return;
  }

  const updated = await ctx.ui.custom<{
    content?: string;
    error?: string;
    cancelled?: boolean;
  }>((tui, theme, _kb, done) => {
    queueMicrotask(() => {
      done(
        openExternalEditor(tui, editorCmd, content.content ?? "", actionDeps),
      );
    });

    return new Text(theme.fg("dim", `Opening ${editorCmd}...`), 0, 0);
  });

  if (updated?.error) {
    debugFiles(actionDeps.process.env, "external editor failed", {
      target: target.displayPath,
      editor: editorCmd,
      error: updated.error,
    });
    ctx.ui.notify(formatFailureMessage("edit", target, updated.error), "error");
    return;
  }
  if (updated?.cancelled || updated?.content === undefined) {
    ctx.ui.notify(`Edit cancelled for ${target.displayPath}`, "info");
    return;
  }
  if (updated.content === content.content) {
    ctx.ui.notify(`No changes to save for ${target.displayPath}`, "info");
    return;
  }

  try {
    actionDeps.fs.writeFileSync(target.resolvedPath, updated.content, "utf8");
    ctx.ui.notify(
      formatSuccessMessage("edit", target, "Changes saved."),
      "info",
    );
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unable to write the file.";
    debugFiles(actionDeps.process.env, "save failed", {
      target: target.displayPath,
      error: reason,
    });
    ctx.ui.notify(
      formatFailureMessage(
        "edit",
        target,
        reason,
        "Check permissions and retry.",
      ),
      "error",
    );
  }
};

/**
 * Opens the selected file with the platform default application.
 */
export const openPath = async (
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  target: FileEntry,
  overrides: Partial<SafetyDeps> = {},
): Promise<void> => {
  const deps = createSafetyDeps(createExecCommand(pi), overrides);
  const accessCheck = getOpenAccessCheck(target, deps);
  if (!accessCheck.allowed) {
    ctx.ui.notify(
      formatUnavailableActionMessage(
        "open",
        target,
        accessCheck.reason ?? "Opening is blocked by policy.",
      ),
      "warning",
    );
    return;
  }

  const result = await runCommand(
    deps.execCommand,
    getOpenCommand(deps.process.platform),
    [target.resolvedPath],
    `Failed to open ${target.displayPath}`,
  );
  if (!result.ok) {
    ctx.ui.notify(
      result.message ?? `Failed to open ${target.displayPath}`,
      "error",
    );
  }
};

/**
 * Reveals the selected file or directory in the platform file manager.
 */
export const revealPath = async (
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  target: FileEntry,
  overrides: Partial<SafetyDeps> = {},
): Promise<void> => {
  const deps = createSafetyDeps(createExecCommand(pi), overrides);
  const accessCheck = getOpenAccessCheck(target, deps);
  if (!accessCheck.allowed) {
    ctx.ui.notify(
      formatUnavailableActionMessage(
        "reveal",
        target,
        accessCheck.reason ?? "Reveal is blocked by policy.",
      ),
      "warning",
    );
    return;
  }

  const revealCommand = getRevealCommand(deps.process.platform);
  let isDirectory = target.isDirectory;

  try {
    isDirectory =
      target.isDirectory || deps.fs.statSync(target.resolvedPath).isDirectory();
  } catch {}

  const args =
    deps.process.platform === "darwin"
      ? isDirectory
        ? [target.resolvedPath]
        : ["-R", target.resolvedPath]
      : [isDirectory ? target.resolvedPath : path.dirname(target.resolvedPath)];

  const result = await runCommand(
    deps.execCommand,
    revealCommand.command,
    args,
    `Failed to reveal ${target.displayPath}`,
  );
  if (!result.ok) {
    ctx.ui.notify(
      result.message ?? `Failed to reveal ${target.displayPath}`,
      "error",
    );
  }
};

/**
 * Previews the selected file through macOS Quick Look when available.
 */
export const quickLookPath = async (
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  target: FileEntry,
  overrides: Partial<SafetyDeps> = {},
): Promise<void> => {
  const deps = createSafetyDeps(createExecCommand(pi), overrides);
  const quickLookCheck = await getQuickLookAvailability(pi, target, overrides);
  if (!quickLookCheck.allowed) {
    ctx.ui.notify(
      formatUnavailableActionMessage(
        "quicklook",
        target,
        quickLookCheck.reason ?? "Quick Look is unavailable.",
      ),
      "warning",
    );
    return;
  }

  const result = await runCommand(
    deps.execCommand,
    "qlmanage",
    ["-p", target.resolvedPath],
    `Failed to Quick Look ${target.displayPath}`,
  );
  if (!result.ok) {
    ctx.ui.notify(
      formatFailureMessage(
        "quicklook",
        target,
        result.message ?? "The Quick Look command returned an error.",
        "Quick Look is only available on macOS with qlmanage installed.",
      ),
      "error",
    );
  }
};

/**
 * Opens a HEAD-vs-working-tree diff in VS Code for a tracked file.
 */
export const openDiff = async (
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  target: FileEntry,
  gitRoot: string | null,
  deps: Partial<ActionDeps & SafetyDeps> = {},
): Promise<void> => {
  const execCommand = deps.execCommand ?? createExecCommand(pi);
  const actionDeps: ActionDeps = {
    ...defaultActionDeps,
    ...deps,
    fs: deps.fs ?? defaultActionDeps.fs,
    process: deps.process ?? defaultActionDeps.process,
    spawnSync: deps.spawnSync ?? defaultActionDeps.spawnSync,
  };
  const safetyDeps = createSafetyDeps(
    execCommand,
    toSafetyOverrides(execCommand, actionDeps, deps),
  );

  const diffCheck = getDiffAvailability(target, gitRoot);
  if (!diffCheck.allowed) {
    ctx.ui.notify(
      formatUnavailableActionMessage(
        "diff",
        target,
        diffCheck.reason ?? "Diff is unavailable.",
      ),
      "warning",
    );
    return;
  }
  if (!(await isCommandAvailable("code", safetyDeps))) {
    ctx.ui.notify(
      formatUnavailableActionMessage(
        "diff",
        target,
        "Missing required command: code. Install the VS Code CLI and retry.",
      ),
      "error",
    );
    return;
  }

  if (target.exists) {
    const workingTreeCheck = readSafeDiffText(target.resolvedPath, safetyDeps);
    if (!workingTreeCheck.allowed) {
      ctx.ui.notify(
        formatUnavailableActionMessage(
          "diff",
          target,
          workingTreeCheck.reason ?? "Diff input is unavailable.",
        ),
        "warning",
      );
      return;
    }
  }

  const relativePath = path
    .relative(gitRoot ?? "", target.resolvedPath)
    .split(path.sep)
    .join("/");
  const headResult = await readHeadDiffContent(
    execCommand,
    gitRoot ?? "",
    relativePath,
  );
  if (headResult.ok === false) {
    ctx.ui.notify(
      formatFailureMessage(
        "diff",
        target,
        headResult.reason,
        "Check git state and retry.",
      ),
      "warning",
    );
    return;
  }

  let tempDir = "";
  try {
    tempDir = actionDeps.fs.mkdtempSync(
      path.join(actionDeps.process.tmpdir(), "pi-files-diff-"),
    );
    const fileName = path.basename(target.displayPath) || "file";
    const headFile = path.join(tempDir, `head-${fileName}`);
    const workingFile = path.join(tempDir, `working-${fileName}`);

    actionDeps.fs.writeFileSync(headFile, headResult.text, "utf8");
    if (target.exists) {
      actionDeps.fs.writeFileSync(
        workingFile,
        actionDeps.fs.readFileSync(target.resolvedPath, "utf8"),
        "utf8",
      );
    } else {
      actionDeps.fs.writeFileSync(workingFile, "", "utf8");
    }

    ctx.ui.notify(
      formatSuccessMessage(
        "diff",
        target,
        "Close the VS Code window to return and clean temporary files.",
      ),
      "info",
    );
    const result = await runCommand(
      execCommand,
      "code",
      ["--wait", "--diff", headFile, workingFile],
      `Failed to open diff for ${target.displayPath}`,
    );
    if (!result.ok) {
      ctx.ui.notify(
        formatFailureMessage(
          "diff",
          target,
          result.message ?? "The VS Code diff command returned an error.",
          "Ensure the VS Code CLI works from the terminal and retry.",
        ),
        "error",
      );
    }
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unable to prepare the diff.";
    debugFiles(actionDeps.process.env, "diff failed", {
      target: target.displayPath,
      error: reason,
    });
    ctx.ui.notify(
      formatFailureMessage(
        "diff",
        target,
        reason,
        "Check temporary file access and retry.",
      ),
      "error",
    );
  } finally {
    if (tempDir) {
      cleanupPath(tempDir, actionDeps);
    }
  }
};

/**
 * Inserts an `@path` mention for the selected file into the prompt editor.
 */
export const addFileToPrompt = (
  ctx: ExtensionContext,
  target: FileEntry,
): void => {
  const mentionTarget = target.displayPath || target.resolvedPath;
  const mention = `@${mentionTarget}`;
  const current = ctx.ui.getEditorText();
  const separator = current && !current.endsWith(" ") ? " " : "";
  ctx.ui.setEditorText(`${current}${separator}${mention}`);
  ctx.ui.notify(`Added ${mention} to the prompt editor`, "info");
};
