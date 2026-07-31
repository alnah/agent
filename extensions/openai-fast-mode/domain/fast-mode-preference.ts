import type { FastMode } from "./fast-mode-state.ts";

export const FAST_MODE_PREFERENCE_VERSION = 1;

export interface FastModePreference {
  readonly version: typeof FAST_MODE_PREFERENCE_VERSION;
  readonly mode: FastMode;
}

export type FastModePreferenceDecodeResult =
  | { readonly valid: true; readonly mode: FastMode }
  | { readonly valid: false };

/** Encodes the only state allowed to cross persistence boundaries. */
export function encodeFastModePreference(mode: FastMode): FastModePreference {
  return { version: FAST_MODE_PREFERENCE_VERSION, mode };
}

/** Validates version and mode while ignoring unrelated data such as faults. */
export function decodeFastModePreference(
  value: unknown,
): FastModePreferenceDecodeResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false };
  }
  const version = Reflect.get(value, "version");
  const mode = Reflect.get(value, "mode");
  if (
    version !== FAST_MODE_PREFERENCE_VERSION ||
    (mode !== "armed" && mode !== "disabled")
  ) {
    return { valid: false };
  }
  return { valid: true, mode };
}
