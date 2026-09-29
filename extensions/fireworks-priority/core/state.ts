export type PriorityMode = "disabled" | "armed";

export interface PriorityModeFault {
  readonly code: "invalid_provider_payload";
  readonly message: string;
}

export interface PriorityModeStateSnapshot {
  readonly mode: PriorityMode;
  readonly fault?: PriorityModeFault;
}

/** Process-local state restored by the application without performing I/O. */
export class InMemoryPriorityModeState {
  private mode: PriorityMode = "disabled";
  private fault: PriorityModeFault | undefined;

  initialize(mode: PriorityMode): void {
    this.mode = mode;
    this.fault = undefined;
  }

  enable(): void {
    this.mode = "armed";
    this.fault = undefined;
  }

  disable(): void {
    this.mode = "disabled";
    this.fault = undefined;
  }

  setFault(fault: PriorityModeFault): void {
    this.fault = fault;
  }

  snapshot(): PriorityModeStateSnapshot {
    return this.fault
      ? { mode: this.mode, fault: this.fault }
      : { mode: this.mode };
  }
}

export type PriorityCommand = "toggle" | "on" | "off" | "status";

export type PriorityCommandParseResult =
  | { readonly valid: true; readonly command: PriorityCommand }
  | { readonly valid: false };

/** Parses the public `/fireworks-priority` command contract. */
export class PriorityCommandParser {
  parse(rawCommand: string): PriorityCommandParseResult {
    const normalized = rawCommand.trim().toLowerCase();
    if (normalized === "" || normalized === "toggle") {
      return { valid: true, command: "toggle" };
    }
    if (
      normalized === "on" ||
      normalized === "off" ||
      normalized === "status"
    ) {
      return { valid: true, command: normalized };
    }
    return { valid: false };
  }
}

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
