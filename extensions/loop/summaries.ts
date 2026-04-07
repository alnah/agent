/**
 * Loop summary generation.
 *
 * Produces a short breakout summary for the loop widget, using the current
 * model or a cheaper Anthropic Haiku model when available.
 */

import {
  type Api,
  complete,
  type Model,
  type UserMessage,
} from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getConditionText, summarizeCondition } from "./prompting.ts";
import type { LoopMode } from "./state.ts";

const HAIKU_MODEL_ID = "claude-haiku-4-5";

const SUMMARY_SYSTEM_PROMPT = `You summarize loop breakout conditions for a status widget.
Return a concise phrase (max 6 words) that says when the loop should stop.
Use plain text only, no quotes, no punctuation, no prefix.

Form should be "breaks when ...", "loops until ...", "stops on ...", "runs until ...", or similar.
Use the best form that makes sense for the loop condition.
`;

/**
 * Chooses the model used to summarize the breakout condition.
 *
 * Anthropic sessions prefer Haiku when auth is available. Other providers fall
 * back to the active model so summary generation matches current credentials.
 */
async function selectSummaryModel(ctx: ExtensionContext): Promise<{
  model: Model<Api>;
  apiKey?: string;
  headers?: Record<string, string>;
} | null> {
  if (!ctx.model) return null;

  if (ctx.model.provider === "anthropic") {
    const haikuModel = ctx.modelRegistry.find("anthropic", HAIKU_MODEL_ID);
    if (haikuModel) {
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(haikuModel);
      if (auth.ok) {
        return {
          model: haikuModel,
          apiKey: auth.apiKey,
          headers: auth.headers,
        };
      }
    }
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
  if (!auth.ok) return null;
  return { model: ctx.model, apiKey: auth.apiKey, headers: auth.headers };
}

/**
 * Summarizes the active breakout condition for the status widget.
 *
 * Returns a local fallback when no usable model/auth is available or when the
 * provider responds without text. Long model summaries are truncated.
 */
export async function summarizeBreakoutCondition(
  ctx: ExtensionContext,
  mode: LoopMode,
  condition?: string,
): Promise<string> {
  const fallback = summarizeCondition(mode, condition);
  const selection = await selectSummaryModel(ctx);
  if (!selection) return fallback;

  const conditionText = getConditionText(mode, condition);
  const userMessage: UserMessage = {
    role: "user",
    content: [{ type: "text", text: conditionText }],
    timestamp: Date.now(),
  };

  const response = await complete(
    selection.model,
    { systemPrompt: SUMMARY_SYSTEM_PROMPT, messages: [userMessage] },
    { apiKey: selection.apiKey, headers: selection.headers },
  );

  if (response.stopReason === "aborted" || response.stopReason === "error") {
    return fallback;
  }

  const summary = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!summary) return fallback;
  return summary.length > 60 ? `${summary.slice(0, 57)}...` : summary;
}
