/**
 * Operator-facing labels, messages, and lightweight diagnostics.
 *
 * The examples in pi mostly use short top-level JSDoc blocks plus targeted
 * docstrings on exported helpers. This module follows that pattern.
 */

import type { ActionAvailability, FileAction, FileEntry } from "./models.ts";

const actionLabels: Record<FileAction, string> = {
  reveal: "Reveal",
  quicklook: "Quick Look",
  open: "Open",
  edit: "Edit",
  addToPrompt: "Add to prompt",
  diff: "Diff in VS Code",
};

const formatTarget = (target: FileEntry | string): string =>
  typeof target === "string" ? target : target.displayPath;

const withTarget = (reason: string, target: FileEntry | string): string =>
  `${formatTarget(target)}: ${reason}`;

const withSuggestion = (message: string, suggestion?: string): string =>
  suggestion ? `${message} ${suggestion}` : message;

/**
 * Returns the stable human-readable label for an action.
 */
export const getActionLabel = (action: FileAction): string =>
  actionLabels[action];

/**
 * Formats a consistent warning for an action that is known to be unavailable.
 */
export const formatUnavailableActionMessage = (
  action: FileAction,
  target: FileEntry | string,
  reason: string,
): string =>
  withSuggestion(
    `${getActionLabel(action)} unavailable for ${withTarget(reason, target)}`,
  );

/**
 * Formats a consistent failure message with an optional corrective suggestion.
 */
export const formatFailureMessage = (
  action: FileAction,
  target: FileEntry | string,
  reason: string,
  suggestion?: string,
): string =>
  withSuggestion(
    `${getActionLabel(action)} failed for ${withTarget(reason, target)}`,
    suggestion,
  );

/**
 * Formats a short informational success message for an action.
 */
export const formatSuccessMessage = (
  action: FileAction,
  target: FileEntry | string,
  suffix?: string,
): string =>
  suffix
    ? `${getActionLabel(action)} ready for ${formatTarget(target)}. ${suffix}`
    : `${getActionLabel(action)} ready for ${formatTarget(target)}`;

/**
 * Builds action descriptions for the picker, including unavailability reasons.
 */
export const getActionDescriptions = (
  availability: ActionAvailability,
): Record<FileAction, string | undefined> => ({
  reveal: availability.canReveal
    ? "Reveal in Finder on macOS, or open the parent folder on Linux"
    : availability.revealReason,
  open: availability.canOpen
    ? "Open with the default application"
    : availability.openReason,
  addToPrompt: "Insert an @path mention into the editor",
  quicklook: availability.canQuickLook
    ? "Preview the file without leaving pi"
    : availability.quickLookReason,
  edit: availability.canEdit
    ? "Open in $VISUAL or $EDITOR and save back on exit"
    : availability.editReason,
  diff: availability.canDiff
    ? "Compare working tree against HEAD in VS Code"
    : availability.diffReason,
});

/**
 * Returns true when lightweight console diagnostics are enabled.
 */
export const isFilesDebugEnabled = (env: NodeJS.ProcessEnv): boolean =>
  env.PI_FILES_DEBUG === "1";

/**
 * Emits a console diagnostic only when `PI_FILES_DEBUG=1` is set.
 */
export const debugFiles = (
  env: NodeJS.ProcessEnv,
  message: string,
  details?: Record<string, unknown>,
): void => {
  if (!isFilesDebugEnabled(env)) {
    return;
  }

  if (details) {
    console.error(`[files] ${message}`, details);
    return;
  }

  console.error(`[files] ${message}`);
};
