import type { FastMode } from "../domain/fast-mode-state.ts";

/** Persistence port for the global default shared by all workspaces. */
export interface FastModePreferenceStore {
  load(): Promise<FastMode | undefined>;
  save(mode: FastMode): Promise<void>;
}
