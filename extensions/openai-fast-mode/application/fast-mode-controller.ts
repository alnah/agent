import type { FastCommandParser } from "../domain/fast-command.ts";
import type { FastModeEligibilityPolicy } from "../domain/fast-mode-policy.ts";
import type { InMemoryFastModeState } from "../domain/fast-mode-state.ts";
import type { ModelSnapshot } from "../domain/model-snapshot.ts";
import type { FastModeView } from "./fast-mode-view.ts";

/** Application controller for fast mode lifecycle and request events. */
export class FastModeController {
  constructor(
    private readonly commandParser: FastCommandParser,
    private readonly state: InMemoryFastModeState,
    private readonly eligibilityPolicy: FastModeEligibilityPolicy,
  ) {}

  initialize(enabledByFlag: boolean, _model: ModelSnapshot | undefined): void {
    this.state.initialize(enabledByFlag);
  }

  handleCommand(
    rawCommand: string,
    model: ModelSnapshot | undefined,
    view: FastModeView,
  ): void {
    const parsed = this.commandParser.parse(rawCommand);
    if (!parsed.valid) {
      view.notify("Usage: /fast on|off|status", "error");
      return;
    }

    if (parsed.command === "on") this.state.enable();
    if (parsed.command === "off") this.state.disable();

    const state = this.state.snapshot();
    if (state.mode === "disabled") {
      view.notify(
        "Fast mode is disabled; priority injection is not implemented yet.",
        "info",
      );
      return;
    }

    const eligibility = this.eligibilityPolicy.evaluate(model);
    const message = eligibility.eligible
      ? "Fast mode is armed for this target, but priority injection is not implemented yet."
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
    if (this.state.snapshot().mode === "disabled") return payload;
    if (!this.eligibilityPolicy.evaluate(model).eligible) return payload;
    return payload;
  }
}
