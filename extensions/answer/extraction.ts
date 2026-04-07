import type { AssistantMessage } from "@mariozechner/pi-ai";
import {
  type ExtractedQuestion,
  type ExtractionResult,
  parseExtractionResult,
} from "./parsing.ts";

/**
 * System prompt used when a model-backed extraction path is available.
 *
 * The questionnaire UI needs structured data rather than prose so it can
 * preserve order, context, and validation across navigation.
 */
export const SYSTEM_PROMPT = `You are a question extractor. Given text from a conversation, extract any questions that need answering.

Output a JSON object with this structure:
{
 "questions": [
 {
 "question": "The question text",
 "context": "Optional context that helps answer the question"
 }
 ]
}

Rules:
- Extract all questions that require user input
- Keep questions in the order they appeared
- Be concise with question text
- Include context only when it provides essential information for answering
- If no questions are found, return {"questions": []}

Example output:
{
 "questions": [
 {
 "question": "What is your preferred database?",
 "context": "We can only configure MySQL and PostgreSQL because of what is implemented."
 },
 {
 "question": "Should we use TypeScript or JavaScript?"
 }
 ]
}`;

export type ExtractParams = {
  assistantText: string;
  model: unknown;
  reasoning: string;
  getApiKeyAndHeaders: (
    model: unknown,
  ) => Promise<
    | { ok: true; apiKey?: string; headers?: Record<string, string> }
    | { ok: false; error: string }
  >;
  complete: (
    model: unknown,
    input: unknown,
    options?: unknown,
  ) => Promise<AssistantMessage>;
  now?: () => number;
  signal?: AbortSignal;
};

export type ExtractResult =
  | { ok: true; value: ExtractionResult }
  | { ok: false; error: "AUTH"; message: string }
  | { ok: false; error: "PROVIDER"; message: string }
  | { ok: false; error: "CANCELLED" }
  | { ok: false; error: "PARSE" };

/**
 * Extracts likely questions without calling a model.
 *
 * This remains the last-resort fallback if model extraction fails or if the
 * provider output cannot be parsed.
 */
export function heuristicExtractQuestions(text: string): ExtractionResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const questions: ExtractedQuestion[] = [];
  for (const line of lines) {
    const numbered = line.match(/^\d+[.):-]?\s+(.*)$/);
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const candidate = (numbered?.[1] ?? bullet?.[1] ?? line).trim();
    if (!candidate) continue;
    if (
      candidate.includes("?") ||
      /^(quel|quelle|quels|quelles|qui|quoi|quand|comment|pourquoi|où|ou|what|which|who|when|where|why|how|should|would|could|do\s+you|can\s+you)\b/i.test(
        candidate,
      )
    ) {
      questions.push({ question: candidate });
    }
  }

  return { questions };
}

/**
 * Runs model-backed question extraction for the latest assistant text.
 *
 * The interactive UI needs structured follow-up questions instead of raw
 * assistant prose. It performs auth lookup first, forwards the configured
 * reasoning mode, treats provider aborts as cancellation, and returns typed
 * failures so the caller can distinguish auth, provider, and parse problems.
 */
export async function extractQuestionsFromAssistantText(
  params: ExtractParams,
): Promise<ExtractResult> {
  const auth = await params.getApiKeyAndHeaders(params.model);
  if (auth.ok === false)
    return { ok: false, error: "AUTH", message: auth.error };

  try {
    const response = await params.complete(
      params.model,
      {
        systemPrompt: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: params.assistantText }],
            timestamp: (params.now ?? Date.now)(),
          },
        ],
      },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        signal: params.signal,
        reasoning: params.reasoning === "off" ? undefined : params.reasoning,
      },
    );

    if (response.stopReason === "aborted")
      return { ok: false, error: "CANCELLED" };
    const text = (response.content ?? [])
      .filter((part) => part?.type === "text")
      .map((part) => ("text" in part ? (part.text ?? "") : ""))
      .join("\n");
    const parsed = parseExtractionResult(text);
    return parsed ? { ok: true, value: parsed } : { ok: false, error: "PARSE" };
  } catch (error) {
    return {
      ok: false,
      error: "PROVIDER",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
