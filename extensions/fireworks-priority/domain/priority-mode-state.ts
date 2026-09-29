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
