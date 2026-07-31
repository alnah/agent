import type { FastCommandParser } from "../domain/fast-command.ts";
import type { FastModeEligibilityPolicy } from "../domain/fast-mode-policy.ts";
import type { InMemoryFastModeState } from "../domain/fast-mode-state.ts";
import type { ModelSnapshot } from "../domain/model-snapshot.ts";
import type {
  PayloadTransformResult,
  PriorityPayloadDecorator,
} from "../domain/priority-payload-decorator.ts";
import type { FastModePresentation, FastModeView } from "./fast-mode-view.ts";

const PRICING_WARNING =
  "Fast mode armed. OpenAI priority pricing applies to eligible requests.";

/** Application controller for fast mode lifecycle and request events. */
export class FastModeController {
  constructor(
    private readonly commandParser: FastCommandParser,
    private readonly state: InMemoryFastModeState,
    private readonly eligibilityPolicy: FastModeEligibilityPolicy,
    private readonly payloadDecorator: PriorityPayloadDecorator,
  ) {}

  initialize(
    enabledByFlag: boolean,
    model: ModelSnapshot | undefined,
    view: FastModeView,
  ): void {
    this.state.initialize(enabledByFlag);
    this.render(model, view);
    if (enabledByFlag) view.notify(PRICING_WARNING, "warning");
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

    const previous = this.state.snapshot();
    if (parsed.command === "on") this.state.enable();
    if (parsed.command === "off") this.state.disable();

    const presentation = this.render(model, view);
    const isActivation =
      parsed.command === "on" &&
      (previous.mode === "disabled" || previous.fault !== undefined);
    if (isActivation) {
      view.notify(PRICING_WARNING, "warning");
      return;
    }

    view.notify(this.describe(presentation), "info");
  }

  handleModelSelection(model: ModelSnapshot, view: FastModeView): void {
    this.render(model, view);
  }

  transformProviderPayload(
    model: ModelSnapshot | undefined,
    payload: unknown,
  ): PayloadTransformResult {
    const state = this.state.snapshot();
    if (state.mode === "disabled" || state.fault) {
      return { kind: "unchanged", payload };
    }
    if (!this.eligibilityPolicy.evaluate(model).eligible) {
      return { kind: "unchanged", payload };
    }
    return this.payloadDecorator.decorate(payload);
  }

  private derivePresentation(
    model: ModelSnapshot | undefined,
  ): FastModePresentation {
    const state = this.state.snapshot();
    if (state.fault) return { kind: "fault", message: state.fault.message };
    if (state.mode === "disabled") return { kind: "hidden" };
    return this.eligibilityPolicy.evaluate(model).eligible
      ? { kind: "priority" }
      : { kind: "waiting" };
  }

  private render(
    model: ModelSnapshot | undefined,
    view: FastModeView,
  ): FastModePresentation {
    const presentation = this.derivePresentation(model);
    view.render(presentation);
    return presentation;
  }

  private describe(presentation: FastModePresentation): string {
    if (presentation.kind === "hidden") return "Fast mode: off.";
    if (presentation.kind === "waiting") {
      return "Fast mode: waiting for a supported target.";
    }
    if (presentation.kind === "priority") return "Fast mode: priority.";
    return `Fast mode: error. ${presentation.message}`;
  }
}
