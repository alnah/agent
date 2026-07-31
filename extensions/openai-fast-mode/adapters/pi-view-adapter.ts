import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
  FastModeNotificationLevel,
  FastModePresentation,
  FastModeView,
} from "../application/fast-mode-view.ts";

const STATUS_KEY = "openai-fast-mode";

/** Adapts application presentation to the active Pi mode. */
export class PiViewAdapter implements FastModeView {
  constructor(private readonly context: ExtensionContext) {}

  render(presentation: FastModePresentation): void {
    if (!this.context.hasUI) return;
    if (presentation.kind === "hidden") {
      this.context.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    if (presentation.kind === "waiting") {
      this.context.ui.setStatus(STATUS_KEY, "fast: waiting");
      return;
    }
    if (presentation.kind === "priority") {
      this.context.ui.setStatus(STATUS_KEY, "fast: priority");
      return;
    }
    this.context.ui.setStatus(STATUS_KEY, "fast: error");
  }

  notify(message: string, level: FastModeNotificationLevel): void {
    if (!this.context.hasUI) return;
    this.context.ui.notify(message, level);
  }
}
