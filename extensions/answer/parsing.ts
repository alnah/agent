/**
 * Canonical follow-up question shown to the user.
 *
 * Extraction may come from a model or a heuristic parser, so the rest of the
 * extension needs one stable shape. `question` is the prompt to answer and
 * `context`, when present, is supporting detail that should be rendered
 * adjacent to that prompt.
 */
export type ExtractedQuestion = {
  question: string;
  context?: string;
};

/**
 * Ordered extraction payload consumed by the questionnaire UI.
 *
 * `questions` preserves source order so the submitted transcript mirrors the
 * assistant message that produced it.
 */
export type ExtractionResult = {
  questions: ExtractedQuestion[];
};

import type { SessionEntry } from "@mariozechner/pi-coding-agent";

export type LastAssistantTextResult =
  | { ok: true; text: string }
  | { ok: false; error: "NO_ASSISTANT_MESSAGE" }
  | { ok: false; error: "LAST_ASSISTANT_INCOMPLETE"; stopReason?: string }
  | { ok: false; error: "LAST_ASSISTANT_HAS_NO_TEXT" };

/**
 * Normalizes optional string fields emitted by extraction.
 *
 * Model output often contains extra whitespace and blank strings that are
 * semantically equivalent to an omitted field. Returns `undefined` for
 * non-strings and blank strings.
 */
export function trimToOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Parses extractor output into the canonical question list.
 *
 * The model is asked for JSON but may still wrap it in fenced code blocks or
 * emit extra whitespace. It accepts bare JSON or one fenced JSON payload,
 * trims fields, discards blank questions, preserves order, and returns `null`
 * for malformed structures instead of throwing.
 */
export function parseExtractionResult(text: string): ExtractionResult | null {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const payload = fenced ? fenced[1] : text.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { questions?: unknown }).questions)
  ) {
    return null;
  }

  const questions: ExtractedQuestion[] = [];
  for (const item of (parsed as { questions: unknown[] }).questions) {
    if (!item || typeof item !== "object") return null;
    const rawQuestion = (item as { question?: unknown }).question;
    const rawContext = (item as { context?: unknown }).context;
    if (typeof rawQuestion !== "string") return null;
    if (rawContext !== undefined && typeof rawContext !== "string") return null;

    const question = trimToOptionalString(rawQuestion);
    const context = trimToOptionalString(rawContext);
    if (!question) continue;
    questions.push(context ? { question, context } : { question });
  }

  return { questions };
}

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

/**
 * Compiles answered questions into the follow-up transcript sent back to Pi.
 *
 * The assistant should receive a deterministic, human-readable Q/A block
 * rather than opaque UI state. It preserves question order, trims outer answer
 * whitespace, omits absent context lines, and throws when the questionnaire
 * state is incomplete.
 */
export function buildAnswerTranscript(
  questions: ExtractedQuestion[],
  answers: string[],
): string {
  if (questions.length === 0) throw new Error("Need at least one question");
  if (questions.length !== answers.length)
    throw new Error("Questions and answers must have the same length");

  return questions
    .map((item, index) => {
      const answer = answers[index]?.trim() ?? "";
      if (!answer) throw new Error(`Blank answer at index ${index}`);
      return [
        `Q: ${item.question}`,
        ...(item.context ? [`> ${item.context}`] : []),
        `A: ${answer}`,
      ].join("\n");
    })
    .join("\n\n");
}
