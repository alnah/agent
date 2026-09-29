import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  type LastAssistantTextResult,
  trimToOptionalString,
} from "../core/questions.ts";

/**
 * Selects the latest assistant message that is safe to process.
 *
 * `/answer` must not extract from an incomplete assistant turn or fall back to
 * an older message that no longer matches the visible conversation. It
 * inspects only the most recent assistant entry, joins its text blocks in
 * order, and returns a typed error describing why it cannot be used.
 */
export function getLastCompleteAssistantText(
  entries: SessionEntry[],
): LastAssistantTextResult {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type !== "message" || entry.message?.role !== "assistant")
      continue;

    if (entry.message.stopReason !== "stop") {
      return {
        ok: false,
        error: "LAST_ASSISTANT_INCOMPLETE",
        stopReason: entry.message.stopReason,
      };
    }

    const text = (entry.message.content ?? [])
      .filter((part) => part?.type === "text")
      .map((part) =>
        "text" in part ? (trimToOptionalString(part.text) ?? "") : "",
      )
      .filter(Boolean)
      .join("\n");

    if (!text) return { ok: false, error: "LAST_ASSISTANT_HAS_NO_TEXT" };
    return { ok: true, text };
  }

  return { ok: false, error: "NO_ASSISTANT_MESSAGE" };
}
