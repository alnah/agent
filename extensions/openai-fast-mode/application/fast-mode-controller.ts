import type { FastCommandParser } from "../domain/fast-command.ts";
import type { FastModeEligibilityPolicy } from "../domain/fast-mode-policy.ts";
import type {
  FastMode,
  InMemoryFastModeState,
} from "../domain/fast-mode-state.ts";
import type { ModelSnapshot } from "../domain/model-snapshot.ts";
import type {
  PayloadTransformResult,
  PriorityPayloadDecorator,
} from "../domain/priority-payload-decorator.ts";
import type { FastModePresentation, FastModeView } from "./fast-mode-view.ts";

const PRICING_WARNING =
  "Fast mode armed. OpenAI priority pricing applies to eligible requests.";

export type FastModeCommandResult =
  | { readonly kind: "ignored" }
  | { readonly kind: "status" }
  | { readonly kind: "changed"; readonly mode: FastMode };

/** Application controller for fast mode lifecycle and request events. */
export class FastModeController {
  constructor(
    private readonly commandParser: FastCommandParser,
    private readonly state: InMemoryFastModeState,
    private readonly eligibilityPolicy: FastModeEligibilityPolicy,
    private readonly payloadDecorator: PriorityPayloadDecorator,
  ) {}

  initialize(
    mode: FastMode,
    model: ModelSnapshot | undefined,
    view: FastModeView,
  ): void {
    this.state.initialize(mode);
    this.render(model, view);
    if (mode === "armed") view.notify(PRICING_WARNING, "warning");
  }

  restore(
    mode: FastMode,
    model: ModelSnapshot | undefined,
    view: FastModeView,
  ): void {
    this.state.initialize(mode);
    this.render(model, view);
  }

  handleCommand(
    rawCommand: string,
    model: ModelSnapshot | undefined,
    view: FastModeView,
  ): FastModeCommandResult {
    const parsed = this.commandParser.parse(rawCommand);
    if (!parsed.valid) {
      view.notify("Usage: /fast on|off|status", "error");
      return { kind: "ignored" };
    }

    const previous = this.state.snapshot();
    if (parsed.command === "on") this.state.enable();
    if (parsed.command === "off") this.state.disable();

    const presentation = this.render(model, view);
    if (parsed.command === "status") {
      view.notify(this.describe(presentation), "info");
      return { kind: "status" };
    }

    const result: FastModeCommandResult = {
      kind: "changed",
      mode: parsed.command === "on" ? "armed" : "disabled",
    };
    const isActivation =
      parsed.command === "on" &&
      (previous.mode === "disabled" || previous.fault !== undefined);
    if (isActivation) {
      view.notify(PRICING_WARNING, "warning");
      return result;
    }

    view.notify(this.describe(presentation), "info");
    return result;
  }

  getMode(): FastMode {
    return this.state.snapshot().mode;
  }

  handleModelSelection(model: ModelSnapshot, view: FastModeView): void {
    this.render(model, view);
  }

  transformProviderPayload(
    model: ModelSnapshot | undefined,
    payload: unknown,
    view: FastModeView,
  ): PayloadTransformResult {
    const state = this.state.snapshot();
    if (state.mode === "disabled" || state.fault) {
      return { kind: "unchanged", payload };
    }
    if (!this.eligibilityPolicy.evaluate(model).eligible) {
      return { kind: "unchanged", payload };
    }

    const result = this.payloadDecorator.decorate(payload);
    if (result.kind === "failure") {
      this.state.setFault(result.fault);
      this.render(model, view);
      view.notify(result.fault.message, "error");
    }
    return result;
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
