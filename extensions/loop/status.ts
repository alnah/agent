/**
 * Loop status widget.
 *
 * Renders or clears the small UI widget that shows whether the loop is active,
 * what it is waiting for, and how many loop turns have run.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { LoopStateData } from "./state.ts";

/**
 * Updates the loop widget to match the current runtime state.
 *
 * Clears the widget when the loop is inactive or incomplete. Active loops show
 * the summary when available and always include the current turn count.
 */
export function updateStatus(
  ctx: ExtensionContext,
  state: LoopStateData,
): void {
  if (!ctx.hasUI) return;
  if (!state.active || !state.mode) {
    ctx.ui.setWidget("loop", undefined);
    return;
  }

  const loopCount = state.loopCount ?? 0;
  const turnText = `(turn ${loopCount})`;
  const summary = state.summary?.trim();
  const text = summary
    ? `Loop active: ${summary} ${turnText}`
    : `Loop active ${turnText}`;
  ctx.ui.setWidget("loop", [ctx.ui.theme.fg("accent", text)]);
}
