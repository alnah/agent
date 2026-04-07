/**
 * Shared domain models for this extension.
 *
 * These shapes describe the file records and action contracts exchanged across
 * the picker, action, and safety modules.
 */

/**
 * Unified file record shown in the picker after git, session, and policy data
 * have been merged together.
 */
export type FileEntry = {
  canonicalPath: string;
  resolvedPath: string;
  displayPath: string;
  exists: boolean;
  isDirectory: boolean;
  status?: string;
  inRepo: boolean;
  isTracked: boolean;
  isReferenced: boolean;
  hasSessionChange: boolean;
  lastTimestamp: number;
};

export type GitStatusEntry = {
  status: string;
  exists: boolean;
  isDirectory: boolean;
};

export type FileAction =
  | "reveal"
  | "quicklook"
  | "open"
  | "edit"
  | "addToPrompt"
  | "diff";

export type ActionCheckResult = {
  allowed: boolean;
  reason?: string;
};

export type EditLoadResult = ActionCheckResult & {
  content?: string;
};

/**
 * Availability flags and operator-facing reasons for each file action.
 */
export type ActionAvailability = {
  canReveal: boolean;
  canOpen: boolean;
  canQuickLook: boolean;
  canEdit: boolean;
  canDiff: boolean;
  revealReason?: string;
  openReason?: string;
  quickLookReason?: string;
  editReason?: string;
  diffReason?: string;
};
