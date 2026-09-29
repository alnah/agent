import type { PriorityMode } from "./priority-mode-state.ts";

export const PRIORITY_PREFERENCE_VERSION = 1;

export interface PriorityPreference {
  readonly version: typeof PRIORITY_PREFERENCE_VERSION;
  readonly mode: PriorityMode;
}

export type PriorityPreferenceDecodeResult =
  | { readonly valid: true; readonly mode: PriorityMode }
  | { readonly valid: false };

/** Encodes the only state allowed to cross persistence boundaries. */
export function encodePriorityPreference(
  mode: PriorityMode,
): PriorityPreference {
  return { version: PRIORITY_PREFERENCE_VERSION, mode };
}

/** Validates version and mode while ignoring unrelated data such as faults. */
export function decodePriorityPreference(
  value: unknown,
): PriorityPreferenceDecodeResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false };
  }
  const version = Reflect.get(value, "version");
  const mode = Reflect.get(value, "mode");
  if (
    version !== PRIORITY_PREFERENCE_VERSION ||
    (mode !== "armed" && mode !== "disabled")
  ) {
    return { valid: false };
  }
  return { valid: true, mode };
}
