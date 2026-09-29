import {
  type ExtensionAPI,
  type SessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { PriorityMode } from "../domain/priority-mode-state.ts";
import {
  decodePriorityPreference,
  encodePriorityPreference,
} from "../domain/priority-preference.ts";

const SESSION_ENTRY_TYPE = "fireworks-priority-state";

export interface PrioritySessionReadResult {
  readonly mode?: PriorityMode;
  readonly invalid: boolean;
}

/** Reads the latest valid mode on one active session branch. */
export function readPrioritySessionState(
  entries: readonly SessionEntry[],
): PrioritySessionReadResult {
  let invalid = false;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== SESSION_ENTRY_TYPE) {
      continue;
    }
    const decoded = decodePriorityPreference(entry.data);
    if (decoded.valid) return { mode: decoded.mode, invalid };
    invalid = true;
  }
  return { invalid };
}

/** Reads the source session checkpoint written immediately before a fork. */
export function readPriorityForkState(
  previousSessionFile: string,
): PrioritySessionReadResult {
  const sourceSession = SessionManager.open(previousSessionFile);
  return readPrioritySessionState(sourceSession.getBranch());
}

/** Appends mode-only state that never enters model context. */
export function appendPrioritySessionState(
  pi: ExtensionAPI,
  mode: PriorityMode,
): void {
  pi.appendEntry(SESSION_ENTRY_TYPE, encodePriorityPreference(mode));
}
