/**
 * Loop state persistence.
 *
 * Stores the active loop configuration in custom session entries so the
 * status widget and follow-up behavior survive navigation and reloads.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";

/**
 * Supported loop presets.
 *
 * `tests` keeps running until tests pass, `custom` waits for a user-defined
 * breakout condition, and `self` lets the agent decide when work is done.
 */
export type LoopMode = "tests" | "custom" | "self";

/**
 * Persisted loop state stored in the session timeline.
 *
 * `prompt` is the follow-up message sent after each turn, `summary` is the
 * short widget label, and `loopCount` tracks how many loop turns were queued.
 */
export type LoopStateData = {
  active: boolean;
  mode?: LoopMode;
  condition?: string;
  prompt?: string;
  summary?: string;
  loopCount?: number;
};

export const LOOP_STATE_ENTRY = "loop-state";

/**
 * Reads the newest persisted loop state from the full session history.
 *
 * Returns an inactive state when no custom loop entry exists yet.
 */
export async function loadPersistedState(
  ctx: ExtensionContext,
): Promise<LoopStateData> {
  const entries = ctx.sessionManager.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as {
      type: string;
      customType?: string;
      data?: LoopStateData;
    };
    if (
      entry.type === "custom" &&
      entry.customType === LOOP_STATE_ENTRY &&
      entry.data
    ) {
      return entry.data;
    }
  }
  return { active: false };
}

/**
 * Appends the current loop state to the session timeline.
 *
 * The latest entry wins on restore, so callers should persist after every
 * state change that must survive navigation or session restarts.
 */
export function persistState(pi: ExtensionAPI, state: LoopStateData): void {
  pi.appendEntry(LOOP_STATE_ENTRY, state);
}
