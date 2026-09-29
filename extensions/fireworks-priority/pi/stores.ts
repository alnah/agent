import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  type ExtensionAPI,
  getAgentDir,
  type SessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { PriorityPreferenceStore } from "../core/preference.ts";
import {
  decodePriorityPreference,
  encodePriorityPreference,
  type PriorityMode,
} from "../core/state.ts";

const PREFERENCE_FILENAME = "fireworks-priority.json";
const READ_ERROR = "Cannot read the global fireworks priority preference";
const WRITE_ERROR = "Cannot save the global fireworks priority preference";

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Reflect.get(error, "code") === "ENOENT"
  );
}

export class PriorityPreferenceStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriorityPreferenceStoreError";
  }
}

/** Stores one versioned global preference with an atomic replacement. */
export class GlobalPriorityStore implements PriorityPreferenceStore {
  constructor(
    private readonly preferencePath = join(getAgentDir(), PREFERENCE_FILENAME),
  ) {}

  async load(): Promise<PriorityMode | undefined> {
    let serialized: string;
    try {
      serialized = await readFile(this.preferencePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw new PriorityPreferenceStoreError(READ_ERROR);
    }

    try {
      const decoded = decodePriorityPreference(JSON.parse(serialized));
      if (decoded.valid) return decoded.mode;
    } catch {
      // The sanitized error below covers malformed JSON and invalid data.
    }
    throw new PriorityPreferenceStoreError(READ_ERROR);
  }

  async save(mode: PriorityMode): Promise<void> {
    const directory = dirname(this.preferencePath);
    const temporaryPath = join(
      directory,
      `.${basename(this.preferencePath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(
        temporaryPath,
        `${JSON.stringify(encodePriorityPreference(mode), null, 2)}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      await rename(temporaryPath, this.preferencePath);
    } catch {
      throw new PriorityPreferenceStoreError(WRITE_ERROR);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

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
