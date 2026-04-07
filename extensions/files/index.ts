/**
 * File browser extension.
 *
 * Browse repository files and recent session-referenced files,
 * then reveal, open, diff, edit, or mention them in the prompt.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  addFileToPrompt,
  editPath,
  openDiff,
  openPath,
  quickLookPath,
  revealPath,
} from "./actions.ts";
import { buildFileEntries } from "./data.ts";
import type { FileEntry } from "./models.ts";
import { formatUnavailableActionMessage } from "./operability.ts";
import { toCanonicalPath } from "./paths.ts";
import { getActionAvailability } from "./safety.ts";
import { findLatestFileReference } from "./session.ts";
import { showActionSelector, showFileSelector } from "./ui.ts";

/**
 * Converts a referenced path into the picker entry shape used by action helpers.
 */
const toReferenceEntry = (
  targetPath: string,
  displayPath: string,
): FileEntry | null => {
  const canonical = toCanonicalPath(targetPath);
  if (!canonical) {
    return null;
  }

  return {
    canonicalPath: canonical.canonicalPath,
    resolvedPath: canonical.canonicalPath,
    displayPath,
    exists: true,
    isDirectory: canonical.isDirectory,
    status: undefined,
    inRepo: false,
    isTracked: false,
    isReferenced: true,
    hasSessionChange: false,
    lastTimestamp: 0,
  };
};

/**
 * Resolves the newest referenced file in the current session and hands it to an
 * action callback when it still exists.
 */
const withLatestReference = async (
  ctx: ExtensionContext,
  onEntry: (entry: FileEntry) => Promise<void>,
): Promise<void> => {
  const latest = findLatestFileReference(
    ctx.sessionManager.getBranch(),
    ctx.cwd,
  );
  if (!latest) {
    ctx.ui.notify(
      "No referenced file found in this session yet. Mention or open a file first.",
      "warning",
    );
    return;
  }

  const entry = toReferenceEntry(latest.path, latest.display);
  if (!entry) {
    ctx.ui.notify(
      `${latest.display}: file no longer exists. Refresh the reference and retry.`,
      "error",
    );
    return;
  }

  await onEntry(entry);
};

/**
 * Runs the action selected for a file after applying availability checks.
 */
const runSelectedAction = async (
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  selected: FileEntry,
  gitRoot: string | null,
): Promise<void> => {
  const availability = await getActionAvailability(pi, selected, gitRoot);
  const action = await showActionSelector(ctx, availability);
  if (!action) {
    return;
  }

  if (action === "reveal" && !availability.canReveal) {
    ctx.ui.notify(
      formatUnavailableActionMessage(
        "reveal",
        selected,
        availability.revealReason ?? "Missing capability",
      ),
      "warning",
    );
    return;
  }
  if (action === "open" && !availability.canOpen) {
    ctx.ui.notify(
      formatUnavailableActionMessage(
        "open",
        selected,
        availability.openReason ?? "Missing capability",
      ),
      "warning",
    );
    return;
  }
  if (action === "quicklook" && !availability.canQuickLook) {
    ctx.ui.notify(
      formatUnavailableActionMessage(
        "quicklook",
        selected,
        availability.quickLookReason ?? "Missing capability",
      ),
      "warning",
    );
    return;
  }
  if (action === "edit" && !availability.canEdit) {
    ctx.ui.notify(
      formatUnavailableActionMessage(
        "edit",
        selected,
        availability.editReason ?? "Missing capability",
      ),
      "warning",
    );
    return;
  }
  if (action === "diff" && !availability.canDiff) {
    ctx.ui.notify(
      formatUnavailableActionMessage(
        "diff",
        selected,
        availability.diffReason ?? "Missing capability",
      ),
      "warning",
    );
    return;
  }

  switch (action) {
    case "quicklook":
      await quickLookPath(pi, ctx, selected);
      return;
    case "open":
      await openPath(pi, ctx, selected);
      return;
    case "edit":
      await editPath(ctx, selected, gitRoot);
      return;
    case "addToPrompt":
      addFileToPrompt(ctx, selected);
      return;
    case "diff":
      await openDiff(pi, ctx, selected, gitRoot);
      return;
    case "reveal":
      await revealPath(pi, ctx, selected);
      return;
  }
};

/**
 * Orchestrates the file picker loop in interactive mode.
 */
const runFileBrowser = async (
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> => {
  if (!ctx.hasUI) {
    ctx.ui.notify(
      "Files requires interactive mode. Retry in interactive mode.",
      "error",
    );
    return;
  }

  let lastSelectedPath: string | null = null;
  while (true) {
    const { files, gitRoot } = await buildFileEntries(pi, ctx);
    if (files.length === 0) {
      ctx.ui.notify(
        "No files found. Open a repository or reference files in the session first.",
        "info",
      );
      return;
    }

    const { selected, quickAction } = await showFileSelector(
      ctx,
      files,
      lastSelectedPath,
      gitRoot,
    );
    if (!selected) {
      ctx.ui.notify("Files picker closed", "info");
      return;
    }

    lastSelectedPath = selected.canonicalPath;
    if (quickAction === "diff") {
      await openDiff(pi, ctx, selected, gitRoot);
      continue;
    }

    await runSelectedAction(pi, ctx, selected, gitRoot);
  }
};

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("files", {
    description: "Browse files with git status and session references",
    handler: async (_args, ctx) => {
      await runFileBrowser(pi, ctx);
    },
  });

  pi.registerCommand("diff", {
    description: "Browse files and open diffs for tracked files",
    handler: async (_args, ctx) => {
      await runFileBrowser(pi, ctx);
    },
  });

  pi.registerShortcut("ctrl+shift+o", {
    description: "Browse repository files and recent session references",
    handler: async (ctx) => {
      await runFileBrowser(pi, ctx);
    },
  });

  pi.registerShortcut("ctrl+shift+f", {
    description: "Reveal the latest referenced file in Finder",
    handler: async (ctx) => {
      await withLatestReference(ctx, async (entry) => {
        await revealPath(pi, ctx, entry);
      });
    },
  });

  pi.registerShortcut("ctrl+shift+r", {
    description: "Preview the latest referenced file with Quick Look on macOS",
    handler: async (ctx) => {
      await withLatestReference(ctx, async (entry) => {
        await quickLookPath(pi, ctx, entry);
      });
    },
  });
}
