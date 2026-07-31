import type { FastModeView } from "./fast-mode-view.ts";

/** Minimal application seam for the walking skeleton. */
export class FastModeController {
  private requestedAtStartup = false;

  initialize(requestedAtStartup: boolean): void {
    this.requestedAtStartup = requestedAtStartup;
  }

  handleCommand(view: FastModeView): void {
    const message = this.requestedAtStartup
      ? "Fast mode was requested with --fast, but priority injection is not implemented yet."
      : "Fast mode is disabled; priority injection is not implemented yet.";

    view.notify(message, "info");
  }

  handleModelSelection(): void {
    // Model eligibility belongs to a later core slice.
  }

  transformProviderPayload(payload: unknown): unknown {
    return payload;
  }
}
