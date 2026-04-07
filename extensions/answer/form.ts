import type { ExtractedQuestion } from "./parsing.ts";

export type SubmitCheck =
  | { ok: true }
  | { ok: false; error: "MISSING_ANSWERS"; missingIndexes: number[] };

export type QuestionnaireController = {
  getCurrentIndex(): number;
  getCurrentDraft(): string;
  updateDraft(value: string): void;
  next(): void;
  previous(): void;
  canSubmit(): SubmitCheck;
  isShowingConfirmation(): boolean;
  openConfirmation(): void;
  closeConfirmation(): void;
  getAllDrafts(): string[];
};

/**
 * Creates navigation state for the multi-question answer flow.
 *
 * The TUI needs a small state container that survives moving back and forth
 * between questions without coupling tests to rendering details. It stores one
 * draft per question, clamps navigation to bounds, and reports which answers
 * are still missing before submission.
 */
export function createQuestionnaireController(
  questions: ExtractedQuestion[],
): QuestionnaireController {
  if (questions.length === 0) throw new Error("Need at least one question");

  const drafts = questions.map(() => "");
  let currentIndex = 0;
  let showingConfirmation = false;

  return {
    getCurrentIndex() {
      return currentIndex;
    },
    getCurrentDraft() {
      return drafts[currentIndex] ?? "";
    },
    updateDraft(value: string) {
      drafts[currentIndex] = value;
    },
    next() {
      if (currentIndex < questions.length - 1) currentIndex += 1;
    },
    previous() {
      if (currentIndex > 0) currentIndex -= 1;
    },
    canSubmit() {
      const missingIndexes = drafts
        .map((draft, index) => ({ draft: draft.trim(), index }))
        .filter((entry) => !entry.draft)
        .map((entry) => entry.index);
      return missingIndexes.length
        ? {
            ok: false as const,
            error: "MISSING_ANSWERS" as const,
            missingIndexes,
          }
        : { ok: true as const };
    },
    isShowingConfirmation() {
      return showingConfirmation;
    },
    openConfirmation() {
      showingConfirmation = true;
    },
    closeConfirmation() {
      showingConfirmation = false;
    },
    getAllDrafts() {
      return [...drafts];
    },
  };
}
