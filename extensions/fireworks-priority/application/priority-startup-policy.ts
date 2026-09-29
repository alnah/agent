import type { PriorityMode } from "../domain/priority-mode-state.ts";

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
