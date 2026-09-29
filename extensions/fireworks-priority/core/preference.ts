import type { PriorityMode } from "./state.ts";

/** Persistence port for the global default shared by all workspaces. */
export interface PriorityPreferenceStore {
  load(): Promise<PriorityMode | undefined>;
  save(mode: PriorityMode): Promise<void>;
}

export interface PriorityStartupInput {
  readonly forkMode?: PriorityMode;
  readonly sessionMode?: PriorityMode;
  readonly globalMode?: PriorityMode;
}

/** Resolves startup state without coupling persistence layers. */
export class PriorityStartupPolicy {
  resolve(input: PriorityStartupInput): PriorityMode {
    return (
      input.forkMode ?? input.sessionMode ?? input.globalMode ?? "disabled"
    );
  }
}
