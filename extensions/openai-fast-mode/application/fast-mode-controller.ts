import type { FastModeEligibilityPolicy } from "../domain/fast-mode-policy.ts";
import type { ModelSnapshot } from "../domain/model-snapshot.ts";
import type { FastModeView } from "./fast-mode-view.ts";

/** Application controller for fast mode lifecycle and request events. */
export class FastModeController {
  private requestedAtStartup = false;

  constructor(private readonly eligibilityPolicy: FastModeEligibilityPolicy) {}

  initialize(
    requestedAtStartup: boolean,
    _model: ModelSnapshot | undefined,
  ): void {
    this.requestedAtStartup = requestedAtStartup;
  }

  handleCommand(
    _rawCommand: string,
    model: ModelSnapshot | undefined,
    view: FastModeView,
  ): void {
    if (!this.requestedAtStartup) {
      view.notify(
        "Fast mode is disabled; priority injection is not implemented yet.",
        "info",
      );
      return;
    }

    const eligibility = this.eligibilityPolicy.evaluate(model);
    const message = eligibility.eligible
      ? "Fast mode target recognized, but priority injection is not implemented yet."
      : "Fast mode is waiting for a supported target; priority injection is not implemented yet.";
    view.notify(message, "info");
  }

  handleModelSelection(_model: ModelSnapshot): void {
    // Presentation updates belong to a later core slice.
  }

  transformProviderPayload(
    model: ModelSnapshot | undefined,
    payload: unknown,
  ): unknown {
    if (!this.eligibilityPolicy.evaluate(model).eligible) return payload;
    return payload;
  }
}
