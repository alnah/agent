import { complete } from "@mariozechner/pi-ai";
import {
  BorderedLoader,
  type ExtensionAPI,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  extractQuestionsFromAssistantText,
  heuristicExtractQuestions,
} from "./extraction.ts";
import {
  type ExtractionResult,
  getLastCompleteAssistantText,
  type LastAssistantTextResult,
} from "./parsing.ts";
import { QnAComponent } from "./qna-ui.ts";

/**
 * Converts assistant-selection failures into user-facing notifications.
 *
 * `/answer` distinguishes between missing, incomplete, and textless
 * assistant messages and should explain the exact recovery path.
 */
export function notifyForAssistantTextError(
  ctx: { ui: { notify(message: string, level: string): void } },
  result: LastAssistantTextResult,
) {
  if (result.ok) return;

  const failure = result as Exclude<LastAssistantTextResult, { ok: true }>;
  if (failure.error === "NO_ASSISTANT_MESSAGE") {
    ctx.ui.notify("No assistant message found on the current branch", "error");
  } else if (failure.error === "LAST_ASSISTANT_INCOMPLETE") {
    ctx.ui.notify(
      `Last assistant message incomplete${failure.stopReason ? ` (${failure.stopReason})` : ""}`,
      "error",
    );
  } else {
    ctx.ui.notify("Last assistant message has no text content", "error");
  }
}

/**
 * Creates the `/answer` handler.
 *
 * The command coordinates session selection, question extraction, the TUI
 * questionnaire, and submission back to Pi.
 */
export function createAnswerHandler(
  pi: Pick<ExtensionAPI, "getThinkingLevel" | "sendMessage">,
) {
  return async (_args: string, ctx: ExtensionContext) => {
    if (!ctx.hasUI) {
      ctx.ui.notify("answer requires interactive mode", "error");
      return;
    }
    if (!ctx.model) {
      ctx.ui.notify("No model selected", "error");
      return;
    }

    const branch = ctx.sessionManager?.getBranch?.() ?? [];
    const lastAssistant = getLastCompleteAssistantText(branch);
    if (!lastAssistant.ok) {
      notifyForAssistantTextError(ctx, lastAssistant);
      return;
    }

    const extractionModel = ctx.model;
    let extractionResult: ExtractionResult | null;
    try {
      extractionResult = await ctx.ui.custom<ExtractionResult | null>(
        (tui, theme, _kb, done) => {
          const loader = new BorderedLoader(
            tui,
            theme,
            `Extracting questions using ${extractionModel.id ?? ctx.model.id}...`,
          );
          loader.onAbort = () => done(null);

          extractQuestionsFromAssistantText({
            assistantText: lastAssistant.text,
            model: extractionModel,
            reasoning: pi.getThinkingLevel?.() ?? "medium",
            getApiKeyAndHeaders: (model) =>
              ctx.modelRegistry.getApiKeyAndHeaders(
                model as typeof extractionModel,
              ),
            complete,
            now: () => Date.now(),
            signal: loader.signal,
          })
            .then((result) => {
              if (result.ok) {
                done(result.value);
                return;
              }
              const failure = result as Exclude<
                typeof result,
                { ok: true; value: ExtractionResult }
              >;
              if (failure.error === "CANCELLED") {
                done(null);
                return;
              }
              if (failure.error === "AUTH") {
                ctx.ui.notify(
                  `Question extraction auth failed, using heuristic fallback: ${failure.message}`,
                  "warning",
                );
              } else if (failure.error === "PROVIDER") {
                ctx.ui.notify(
                  `Question extraction failed, using heuristic fallback: ${failure.message}`,
                  "warning",
                );
              } else {
                ctx.ui.notify(
                  "Question extraction returned invalid JSON, using heuristic fallback",
                  "warning",
                );
              }
              done(heuristicExtractQuestions(lastAssistant.text));
            })
            .catch((error) => {
              ctx.ui.notify(
                `Question extraction crashed, using heuristic fallback: ${error instanceof Error ? error.message : String(error)}`,
                "warning",
              );
              done(heuristicExtractQuestions(lastAssistant.text));
            });

          return loader;
        },
      );
    } catch (error) {
      ctx.ui.notify(
        `Question extraction failed: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
      return;
    }
    if (extractionResult === null) {
      ctx.ui.notify("Cancelled", "info");
      return;
    }
    if (extractionResult.questions.length === 0) {
      ctx.ui.notify("No questions found in the last assistant message", "info");
      return;
    }

    const transcript = await ctx.ui.custom<string | null>(
      (tui, _theme, _kb, done) =>
        new QnAComponent(extractionResult.questions, tui, done),
    );
    if (transcript === null) {
      ctx.ui.notify("Cancelled", "info");
      return;
    }

    pi.sendMessage(
      {
        customType: "answers",
        content: `I answered your questions in the following way:\n\n${transcript}`,
        display: true,
      },
      { triggerTurn: true },
    );
  };
}
