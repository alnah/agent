import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
  PriorityNotificationLevel,
  PriorityPresentation,
  PriorityView,
} from "../application/priority-mode-view.ts";

const STATUS_KEY = "fireworks-priority";

/** Adapts application presentation to the active Pi mode. */
export class PiPriorityViewAdapter implements PriorityView {
  constructor(private readonly context: ExtensionContext) {}

  render(presentation: PriorityPresentation): void {
    if (!this.context.hasUI) return;
    if (presentation.kind === "hidden") {
      this.context.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    if (presentation.kind === "waiting") {
      this.context.ui.setStatus(STATUS_KEY, "fireworks: waiting");
      return;
    }
    if (presentation.kind === "priority") {
      this.context.ui.setStatus(STATUS_KEY, "fireworks: priority");
      return;
    }
    this.context.ui.setStatus(STATUS_KEY, "fireworks: error");
  }

  notify(message: string, level: PriorityNotificationLevel): void {
    if (!this.context.hasUI) {
      if (level === "error") {
        process.stderr.write(`[fireworks-priority] ${message}\n`);
      }
      return;
    }
    this.context.ui.notify(message, level);
  }
}
