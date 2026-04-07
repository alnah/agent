/**
 * Review runtime and persistence state.
 *
 * Keeps the active review branch, widget flags, and persisted settings in one
 * place without changing the current review lifecycle or storage format.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

/**
 * Persisted review-branch state.
 *
 * `originId` points to the leaf that `/end-review` should navigate back to.
 */
export type SessionState = {
  active: boolean;
  originId?: string;
};

/**
 * Persisted review settings shared across sessions.
 *
 * The loop-fixing toggle and custom instructions are restored from session
 * entries so selector defaults survive reloads.
 */
export type SettingsState = {
  loopFixingEnabled?: boolean;
  customInstructions?: string;
};

export const STATE_TYPE = "review-session";
export const ANCHOR_TYPE = "review-anchor";
export const SETTINGS_TYPE = "review-settings";

let originId: string | undefined;
let endInProgress = false;
let loopFixingEnabled = false;
let customInstructions: string | undefined;
let loopInProgress = false;

/**
 * Returns the active review origin leaf id.
 */
export function getOriginId(): string | undefined {
  return originId;
}

/**
 * Replaces the active review origin leaf id.
 */
export function setOriginId(value: string | undefined): void {
  originId = value;
}

/**
 * Returns whether `/end-review` is already running.
 */
export function isEndInProgress(): boolean {
  return endInProgress;
}

/**
 * Marks whether `/end-review` is currently running.
 */
export function setEndInProgress(value: boolean): void {
  endInProgress = value;
}

/**
 * Returns whether loop fixing is enabled for new reviews.
 */
export function isLoopFixingEnabled(): boolean {
  return loopFixingEnabled;
}

/**
 * Updates the loop-fixing default used by the selector and review command.
 */
export function setLoopFixingEnabled(value: boolean): void {
  loopFixingEnabled = value;
}

/**
 * Returns the shared custom review instructions, if any.
 */
export function getCustomInstructions(): string | undefined {
  return customInstructions;
}

/**
 * Replaces the shared custom review instructions.
 *
 * Blank input is normalized to `undefined` so prompts do not include empty
 * instruction blocks.
 */
export function setCustomInstructions(value: string | undefined): void {
  customInstructions = value?.trim() || undefined;
}

/**
 * Returns whether loop fixing is actively running right now.
 */
export function isLoopInProgress(): boolean {
  return loopInProgress;
}

/**
 * Marks whether a loop-fixing cycle is currently running.
 */
export function setLoopInProgress(value: boolean): void {
  loopInProgress = value;
}

/**
 * Persists the current shared review settings to the session timeline.
 */
export function persistSettings(pi: ExtensionAPI): void {
  pi.appendEntry(SETTINGS_TYPE, {
    loopFixingEnabled,
    customInstructions,
  });
}

/**
 * Updates or clears the review widget.
 *
 * The widget text stays byte-for-byte compatible with the current UX so users
 * still see the same status line while reviewing or loop-fixing.
 */
export function setWidget(ctx: ExtensionContext, active: boolean): void {
  if (!ctx.hasUI) return;
  if (!active) {
    ctx.ui.setWidget("review", undefined);
    return;
  }

  ctx.ui.setWidget("review", (_tui, theme) => {
    const message = loopInProgress
      ? "Review session active (loop fixing running)"
      : loopFixingEnabled
        ? "Review session active (loop fixing enabled), return with /end-review"
        : "Review session active, return with /end-review";
    const text = new Text(theme.fg("warning", message), 0, 0);
    return {
      render(width: number) {
        return text.render(width);
      },
      invalidate() {
        text.invalidate();
      },
    };
  });
}

/**
 * Reads the newest persisted review-branch state from the current branch.
 */
export function getPersistedSessionState(
  ctx: ExtensionContext,
): SessionState | undefined {
  let state: SessionState | undefined;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === STATE_TYPE) {
      state = entry.data as SessionState | undefined;
    }
  }

  return state;
}

/**
 * Applies persisted branch state to the runtime flags and widget.
 */
export function applyPersistedSessionState(ctx: ExtensionContext): void {
  const state = getPersistedSessionState(ctx);

  if (state?.active && state.originId) {
    originId = state.originId;
    setWidget(ctx, true);
    return;
  }

  originId = undefined;
  setWidget(ctx, false);
}

/**
 * Reads the newest persisted review settings from the full session history.
 */
export function getPersistedSettings(ctx: ExtensionContext): SettingsState {
  let state: SettingsState | undefined;
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "custom" && entry.customType === SETTINGS_TYPE) {
      state = entry.data as SettingsState | undefined;
    }
  }

  return {
    loopFixingEnabled: state?.loopFixingEnabled === true,
    customInstructions: state?.customInstructions?.trim() || undefined,
  };
}

/**
 * Applies persisted settings to the runtime flags.
 */
export function applyPersistedSettings(ctx: ExtensionContext): void {
  const state = getPersistedSettings(ctx);
  loopFixingEnabled = state.loopFixingEnabled === true;
  customInstructions = state.customInstructions?.trim() || undefined;
}

/**
 * Reloads both persisted settings and persisted branch state.
 */
export function applyAllPersistedState(ctx: ExtensionContext): void {
  applyPersistedSettings(ctx);
  applyPersistedSessionState(ctx);
}
