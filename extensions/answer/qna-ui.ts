import {
  type Component,
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  type TUI,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import {
  createQuestionnaireController,
  type QuestionnaireController,
  type SubmitCheck,
} from "./form.ts";
import { buildAnswerTranscript, type ExtractedQuestion } from "./parsing.ts";

/**
 * Interactive questionnaire component used by `/answer`.
 *
 * Users often need to answer several assistant follow-up questions in one
 * place without manually copying them back into the editor. It preserves one
 * draft per question, uses Pi's native editor and key handling, and keeps the
 * rendering logic ANSI-safe through the TUI helpers.
 */
export class QnAComponent implements Component {
  private questions: ExtractedQuestion[];
  private tui: TUI;
  private onDone: (result: string | null) => void;
  private editor: Editor;
  private controller: QuestionnaireController;
  private cachedWidth?: number;
  private cachedLines?: string[];

  private dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  private bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  private cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
  private green = (s: string) => `\x1b[32m${s}\x1b[0m`;
  private yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
  private gray = (s: string) => `\x1b[90m${s}\x1b[0m`;

  constructor(
    questions: ExtractedQuestion[],
    tui: TUI,
    onDone: (result: string | null) => void,
    deps?: { createController?: () => QuestionnaireController },
  ) {
    this.questions = questions;
    this.tui = tui;
    this.onDone = onDone;
    this.controller =
      deps?.createController?.() ?? createQuestionnaireController(questions);

    const editorTheme: EditorTheme = {
      borderColor: this.dim,
      selectList: {} as EditorTheme["selectList"],
    };

    this.editor = new Editor(tui, editorTheme);
    this.editor.disableSubmit = true;
    this.editor.onChange = () => {
      this.syncDraft();
      this.invalidate();
      this.tui.requestRender();
    };
  }

  private syncDraft() {
    this.controller.updateDraft(this.editor.getText());
  }

  private moveTo(index: number) {
    const current = this.controller.getCurrentIndex();
    this.syncDraft();
    while (this.controller.getCurrentIndex() < index) this.controller.next();
    while (this.controller.getCurrentIndex() > index)
      this.controller.previous();
    if (this.controller.getCurrentIndex() !== current) {
      this.editor.setText(this.controller.getCurrentDraft());
      this.invalidate();
    }
  }

  private submit() {
    this.syncDraft();
    this.onDone(
      buildAnswerTranscript(this.questions, this.controller.getAllDrafts()),
    );
  }

  private cancel() {
    this.onDone(null);
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  handleInput(data: string): void {
    if (this.controller.isShowingConfirmation()) {
      if (matchesKey(data, Key.enter) || data.toLowerCase() === "y") {
        const submitCheck = this.controller.canSubmit();
        if (submitCheck.ok) {
          this.submit();
        } else {
          const pending = submitCheck as Extract<SubmitCheck, { ok: false }>;
          const firstMissing = pending.missingIndexes[0] ?? 0;
          this.controller.closeConfirmation();
          this.moveTo(firstMissing);
          this.tui.requestRender();
        }
        return;
      }
      if (
        matchesKey(data, Key.escape) ||
        matchesKey(data, Key.ctrl("c")) ||
        data.toLowerCase() === "n"
      ) {
        this.controller.closeConfirmation();
        this.invalidate();
        this.tui.requestRender();
        return;
      }
      return;
    }

    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.cancel();
      return;
    }

    const currentIndex = this.controller.getCurrentIndex();
    const isLast = currentIndex === this.questions.length - 1;

    if (matchesKey(data, Key.tab)) {
      this.moveTo(Math.min(this.questions.length - 1, currentIndex + 1));
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.shift("tab"))) {
      this.moveTo(Math.max(0, currentIndex - 1));
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.up) && this.editor.getText() === "") {
      this.moveTo(Math.max(0, currentIndex - 1));
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.down) && this.editor.getText() === "") {
      this.moveTo(Math.min(this.questions.length - 1, currentIndex + 1));
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.enter) && !matchesKey(data, Key.shift("enter"))) {
      this.syncDraft();
      if (isLast) {
        const submitCheck = this.controller.canSubmit();
        if (submitCheck.ok) {
          this.controller.openConfirmation();
        } else {
          const pending = submitCheck as Extract<SubmitCheck, { ok: false }>;
          const firstMissing = pending.missingIndexes[0] ?? currentIndex;
          this.moveTo(firstMissing);
        }
      } else {
        this.controller.next();
        this.editor.setText(this.controller.getCurrentDraft());
      }
      this.invalidate();
      this.tui.requestRender();
      return;
    }

    this.editor.handleInput(data);
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    const lines: string[] = [];
    const boxWidth = Math.max(6, Math.min(width - 4, 120));
    const contentWidth = Math.max(1, boxWidth - 4);
    const q = this.questions[this.controller.getCurrentIndex()];
    const horizontal = "─".repeat(Math.max(0, boxWidth - 2));

    const boxLine = (content: string, leftPad = 2) => {
      const padded = " ".repeat(leftPad) + content;
      const rightPad = Math.max(0, boxWidth - visibleWidth(padded) - 2);
      return this.dim(" ") + padded + " ".repeat(rightPad) + this.dim(" ");
    };
    const emptyBoxLine = () =>
      this.dim(" ") + " ".repeat(boxWidth - 2) + this.dim(" ");
    const padToWidth = (line: string) =>
      line + " ".repeat(Math.max(0, width - visibleWidth(line)));

    lines.push(padToWidth(this.dim(`╭${horizontal}╮`)));
    lines.push(
      padToWidth(
        boxLine(
          `${this.bold(this.cyan("Questions"))} ${this.dim(`(${this.controller.getCurrentIndex() + 1}/${this.questions.length})`)}`,
        ),
      ),
    );
    lines.push(padToWidth(this.dim(`├${horizontal}┤`)));

    const drafts = this.controller.getAllDrafts();
    const progress: string[] = [];
    for (let i = 0; i < this.questions.length; i++) {
      const answered = (drafts[i]?.trim() ?? "").length > 0;
      const current = i === this.controller.getCurrentIndex();
      progress.push(
        current ? this.cyan("●") : answered ? this.green("●") : this.dim("○"),
      );
    }
    lines.push(padToWidth(boxLine(progress.join(" "))));
    lines.push(padToWidth(emptyBoxLine()));

    for (const line of wrapTextWithAnsi(
      `${this.bold("Q:")} ${q.question}`,
      contentWidth,
    )) {
      lines.push(padToWidth(boxLine(line)));
    }
    if (q.context) {
      lines.push(padToWidth(emptyBoxLine()));
      for (const line of wrapTextWithAnsi(
        this.gray(`> ${q.context}`),
        Math.max(1, contentWidth - 2),
      )) {
        lines.push(padToWidth(boxLine(line)));
      }
    }
    lines.push(padToWidth(emptyBoxLine()));

    const answerPrefix = this.bold("A: ");
    const editorLines = this.editor.render(Math.max(1, contentWidth - 7));
    for (let i = 1; i < editorLines.length - 1; i++) {
      if (i === 1)
        lines.push(padToWidth(boxLine(answerPrefix + editorLines[i])));
      else lines.push(padToWidth(boxLine(` ${editorLines[i]}`)));
    }
    lines.push(padToWidth(emptyBoxLine()));
    lines.push(padToWidth(this.dim(`├${horizontal}┤`)));

    if (this.controller.isShowingConfirmation()) {
      const message = `${this.yellow("Submit all answers?")} ${this.dim("(Enter/y to confirm, Esc/n to cancel)")}`;
      lines.push(padToWidth(boxLine(truncateToWidth(message, contentWidth))));
    } else {
      const controls = `${this.dim("Tab/Enter")} next · ${this.dim("Shift+Tab")} prev · ${this.dim("Shift+Enter")} newline · ${this.dim("Esc")} cancel`;
      lines.push(padToWidth(boxLine(truncateToWidth(controls, contentWidth))));
    }
    lines.push(padToWidth(this.dim(`╰${horizontal}╯`)));

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }
}
