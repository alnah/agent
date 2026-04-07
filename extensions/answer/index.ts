import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createAnswerHandler } from "./command.ts";

export { createAnswerHandler, notifyForAssistantTextError } from "./command.ts";

export {
  extractQuestionsFromAssistantText,
  heuristicExtractQuestions,
  SYSTEM_PROMPT,
} from "./extraction.ts";

export { createQuestionnaireController } from "./form.ts";
export {
  buildAnswerTranscript,
  type ExtractedQuestion,
  type ExtractionResult,
  getLastCompleteAssistantText,
  type LastAssistantTextResult,
  parseExtractionResult,
} from "./parsing.ts";
export { QnAComponent } from "./qna-ui.ts";

/**
 * Registers the `/answer` command and keyboard shortcut.
 *
 * This extension turns unresolved questions in the latest assistant reply into
 * an interactive questionnaire and sends the completed answers back as a
 * visible follow-up message.
 */
export default function (pi: ExtensionAPI) {
  const handler = createAnswerHandler(pi);

  pi.registerCommand("answer", {
    description:
      "Extract questions from last assistant message into interactive Q&A",
    handler,
  });
  pi.registerShortcut("ctrl+.", {
    description: "Extract and answer questions",
    handler: (ctx) => handler("", ctx),
  });
}
