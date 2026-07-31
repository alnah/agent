import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
  FastModeNotificationLevel,
  FastModeView,
} from "../application/fast-mode-view.ts";

/** Adapts application notifications to the active Pi mode. */
export class PiViewAdapter implements FastModeView {
  constructor(private readonly context: ExtensionContext) {}

  notify(message: string, level: FastModeNotificationLevel): void {
    if (!this.context.hasUI) return;
    this.context.ui.notify(message, level);
  }
}
