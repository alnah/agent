import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { FastModePreferenceStore } from "../application/fast-mode-preference-store.ts";
import {
  decodeFastModePreference,
  encodeFastModePreference,
} from "../domain/fast-mode-preference.ts";
import type { FastMode } from "../domain/fast-mode-state.ts";

const PREFERENCE_FILENAME = "openai-fast-mode.json";
const READ_ERROR = "Cannot read the global fast mode preference";
const WRITE_ERROR = "Cannot save the global fast mode preference";

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Reflect.get(error, "code") === "ENOENT"
  );
}

export class FastModePreferenceStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FastModePreferenceStoreError";
  }
}

/** Stores one versioned global preference with an atomic replacement. */
export class GlobalFastModeStore implements FastModePreferenceStore {
  constructor(
    private readonly preferencePath = join(getAgentDir(), PREFERENCE_FILENAME),
  ) {}

  async load(): Promise<FastMode | undefined> {
    let serialized: string;
    try {
      serialized = await readFile(this.preferencePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw new FastModePreferenceStoreError(READ_ERROR);
    }

    try {
      const decoded = decodeFastModePreference(JSON.parse(serialized));
      if (decoded.valid) return decoded.mode;
    } catch {
      // The sanitized error below covers malformed JSON and invalid data.
    }
    throw new FastModePreferenceStoreError(READ_ERROR);
  }

  async save(mode: FastMode): Promise<void> {
    const directory = dirname(this.preferencePath);
    const temporaryPath = join(
      directory,
      `.${basename(this.preferencePath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(
        temporaryPath,
        `${JSON.stringify(encodeFastModePreference(mode), null, 2)}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      await rename(temporaryPath, this.preferencePath);
    } catch {
      throw new FastModePreferenceStoreError(WRITE_ERROR);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}
