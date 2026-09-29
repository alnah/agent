import type { PriorityMode } from "../domain/priority-mode-state.ts";

/** Persistence port for the global default shared by all workspaces. */
export interface PriorityPreferenceStore {
  load(): Promise<PriorityMode | undefined>;
  save(mode: PriorityMode): Promise<void>;
}
