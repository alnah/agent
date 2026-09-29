import type {
  ModelSnapshot,
  PriorityEligibilityPolicy,
} from "./eligibility.ts";
import type {
  InMemoryPriorityModeState,
  PriorityCommandParser,
  PriorityMode,
} from "./state.ts";

export type PriorityNotificationLevel = "info" | "warning" | "error";

export type PriorityPresentation =
  | { readonly kind: "hidden" }
  | { readonly kind: "waiting" }
  | { readonly kind: "priority" }
  | { readonly kind: "fault"; readonly message: string };

/** Output boundary used by the application layer. */
export interface PriorityView {
  render(presentation: PriorityPresentation): void;
  notify(message: string, level: PriorityNotificationLevel): void;
}

const PRICING_WARNING =
  "Fireworks priority mode armed. Priority pricing applies to eligible requests (1.2x-1.5x standard rates).";
const USAGE = "Usage: /fireworks-priority [toggle|on|off|status]";

export type PriorityModeCommandResult =
  | { readonly kind: "ignored" }
  | { readonly kind: "status" }
  | { readonly kind: "changed"; readonly mode: PriorityMode };

/** Application controller for priority mode lifecycle and command handling. */
export class PriorityModeController {
  constructor(
    private readonly commandParser: PriorityCommandParser,
    private readonly state: InMemoryPriorityModeState,
    private readonly eligibilityPolicy: PriorityEligibilityPolicy,
  ) {}

  initialize(
    mode: PriorityMode,
    model: ModelSnapshot | undefined,
    view: PriorityView,
  ): void {
    this.state.initialize(mode);
    this.render(model, view);
    if (mode === "armed") view.notify(PRICING_WARNING, "warning");
  }

  restore(
    mode: PriorityMode,
    model: ModelSnapshot | undefined,
    view: PriorityView,
  ): void {
    this.state.initialize(mode);
    this.render(model, view);
  }

  handleCommand(
    rawCommand: string,
    model: ModelSnapshot | undefined,
    view: PriorityView,
  ): PriorityModeCommandResult {
    const parsed = this.commandParser.parse(rawCommand);
    if (!parsed.valid) {
      view.notify(USAGE, "error");
      return { kind: "ignored" };
    }

    const previous = this.state.snapshot();
    if (parsed.command === "status") {
      const presentation = this.render(model, view);
      view.notify(this.describe(presentation), "info");
      return { kind: "status" };
    }

    const nextMode: PriorityMode =
      parsed.command === "on"
        ? "armed"
        : parsed.command === "off"
          ? "disabled"
          : previous.mode === "armed"
            ? "disabled"
            : "armed";

    if (nextMode === "armed") this.state.enable();
    else this.state.disable();

    const presentation = this.render(model, view);
    const result: PriorityModeCommandResult = {
      kind: "changed",
      mode: nextMode,
    };
    if (nextMode === "armed" && previous.mode !== "armed") {
      view.notify(PRICING_WARNING, "warning");
      return result;
    }

    view.notify(this.describe(presentation), "info");
    return result;
  }

  getMode(): PriorityMode {
    return this.state.snapshot().mode;
  }

  handleModelSelection(model: ModelSnapshot, view: PriorityView): void {
    this.render(model, view);
  }

  private derivePresentation(
    model: ModelSnapshot | undefined,
  ): PriorityPresentation {
    const state = this.state.snapshot();
    if (state.fault) return { kind: "fault", message: state.fault.message };
    if (state.mode === "disabled") return { kind: "hidden" };
    return this.eligibilityPolicy.evaluate(model).eligible
      ? { kind: "priority" }
      : { kind: "waiting" };
  }

  private render(
    model: ModelSnapshot | undefined,
    view: PriorityView,
  ): PriorityPresentation {
    const presentation = this.derivePresentation(model);
    view.render(presentation);
    return presentation;
  }

  private describe(presentation: PriorityPresentation): string {
    if (presentation.kind === "hidden") return "Fireworks priority mode: off.";
    if (presentation.kind === "waiting") {
      return "Fireworks priority mode: waiting for a supported target.";
    }
    if (presentation.kind === "priority") {
      return "Fireworks priority mode: priority.";
    }
    return `Fireworks priority mode: error. ${presentation.message}`;
  }
}
