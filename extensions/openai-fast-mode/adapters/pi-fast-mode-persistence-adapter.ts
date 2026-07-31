import {
  type ExtensionAPI,
  type SessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  decodeFastModePreference,
  encodeFastModePreference,
} from "../domain/fast-mode-preference.ts";
import type { FastMode } from "../domain/fast-mode-state.ts";

const SESSION_ENTRY_TYPE = "openai-fast-mode-state";

export interface FastModeSessionReadResult {
  readonly mode?: FastMode;
  readonly invalid: boolean;
}

/** Reads the latest valid mode on one active session branch. */
export function readFastModeSessionState(
  entries: readonly SessionEntry[],
): FastModeSessionReadResult {
  let invalid = false;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== SESSION_ENTRY_TYPE) {
      continue;
    }
    const decoded = decodeFastModePreference(entry.data);
    if (decoded.valid) return { mode: decoded.mode, invalid };
    invalid = true;
  }
  return { invalid };
}

/** Reads the source session checkpoint written immediately before a fork. */
export function readFastModeForkState(
  previousSessionFile: string,
): FastModeSessionReadResult {
  const sourceSession = SessionManager.open(previousSessionFile);
  return readFastModeSessionState(sourceSession.getBranch());
}

/** Appends mode-only state that never enters model context. */
export function appendFastModeSessionState(
  pi: ExtensionAPI,
  mode: FastMode,
): void {
  pi.appendEntry(SESSION_ENTRY_TYPE, encodeFastModePreference(mode));
}
