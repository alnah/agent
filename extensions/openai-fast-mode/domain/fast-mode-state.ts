export type FastMode = "disabled" | "armed";

export interface FastModeFault {
  readonly code: "invalid_provider_payload";
  readonly message: string;
}

export interface FastModeStateSnapshot {
  readonly mode: FastMode;
  readonly fault?: FastModeFault;
}

/** Process-local state. It never reads or writes session persistence. */
export class InMemoryFastModeState {
  private mode: FastMode = "disabled";
  private fault: FastModeFault | undefined;

  initialize(enabledByFlag: boolean): void {
    this.mode = enabledByFlag ? "armed" : "disabled";
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

  setFault(fault: FastModeFault): void {
    this.fault = fault;
  }

  snapshot(): FastModeStateSnapshot {
    return this.fault
      ? { mode: this.mode, fault: this.fault }
      : { mode: this.mode };
  }
}
