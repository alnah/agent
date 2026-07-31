import type { FastMode } from "../domain/fast-mode-state.ts";

export interface FastModeStartupInput {
  readonly forcedByFlag: boolean;
  readonly forkMode?: FastMode;
  readonly sessionMode?: FastMode;
  readonly globalMode?: FastMode;
}

/** Resolves startup state without coupling persistence layers. */
export class FastModeStartupPolicy {
  resolve(input: FastModeStartupInput): FastMode {
    if (input.forcedByFlag) return "armed";
    return (
      input.forkMode ?? input.sessionMode ?? input.globalMode ?? "disabled"
    );
  }
}
