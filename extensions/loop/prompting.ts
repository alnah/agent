/**
 * Loop prompt builders.
 *
 * Turns loop presets into agent-facing prompts and summary text used by the
 * widget and compaction flow.
 */

import type { LoopMode } from "./state.ts";

/**
 * Builds the follow-up prompt sent on each loop turn.
 *
 * The prompt always tells the agent when to call `signal_loop_success` so the
 * loop can stop itself once the breakout condition is satisfied.
 */
export function buildPrompt(mode: LoopMode, condition?: string): string {
  switch (mode) {
    case "tests":
      return (
        "Run all tests. If they are passing, call the signal_loop_success tool. " +
        "Otherwise continue until the tests pass."
      );
    case "custom": {
      const customCondition =
        condition?.trim() || "the custom condition is satisfied";
      return (
        `Continue until the following condition is satisfied: ${customCondition}. ` +
        "When it is satisfied, call the signal_loop_success tool."
      );
    }
    case "self":
      return "Continue until you are done. When finished, call the signal_loop_success tool.";
  }
}

/**
 * Returns the raw breakout condition in human-readable form.
 *
 * This text is reused for summaries and compaction instructions, so it should
 * stay short and stable across restore cycles.
 */
export function getConditionText(mode: LoopMode, condition?: string): string {
  switch (mode) {
    case "tests":
      return "tests pass";
    case "custom":
      return condition?.trim() || "custom condition";
    case "self":
      return "you are done";
  }
}

/**
 * Builds the local fallback summary shown in the loop widget.
 *
 * It trims custom conditions and shortens long values so the widget stays
 * readable before model summarization finishes or when summarization fails.
 */
export function summarizeCondition(mode: LoopMode, condition?: string): string {
  switch (mode) {
    case "tests":
      return "tests pass";
    case "custom": {
      const summary = condition?.trim() || "custom condition";
      return summary.length > 48 ? `${summary.slice(0, 45)}...` : summary;
    }
    case "self":
      return "done";
  }
}

/**
 * Adds loop-specific instructions to session compaction.
 *
 * Compaction must preserve the breakout condition so a restored loop continues
 * with the same stop criteria after the session is summarized.
 */
export function getCompactionInstructions(
  mode: LoopMode,
  condition?: string,
): string {
  const conditionText = getConditionText(mode, condition);
  return `Loop active. Breakout condition: ${conditionText}. Preserve this loop state and breakout condition in the summary.`;
}
