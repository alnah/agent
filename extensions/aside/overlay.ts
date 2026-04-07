import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  Container,
  type Focusable,
  Input,
  type KeybindingsManager,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui";

type Theme = ExtensionContext["ui"]["theme"];

/**
 * Floating aside transcript + input dialog.
 *
 * The component keeps layout concerns local: transcript viewport, status line,
 * input field, and close/submit key handling. Higher-level state stays in the
 * controller so the overlay remains a thin render shell.
 */
export class AsideOverlay extends Container implements Focusable {
  private readonly input: Input;
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly keybindings: KeybindingsManager;
  private readonly getTranscript: (width: number, theme: Theme) => string[];
  private readonly getStatus: () => string;
  private readonly onSubmitCallback: (value: string) => void;
  private readonly onDismissCallback: () => void;
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    getTranscript: (width: number, theme: Theme) => string[],
    getStatus: () => string,
    onSubmit: (value: string) => void,
    onDismiss: () => void,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.getTranscript = getTranscript;
    this.getStatus = getStatus;
    this.onSubmitCallback = onSubmit;
    this.onDismissCallback = onDismiss;

    this.input = new Input();
    this.input.onSubmit = (value) => {
      this.onSubmitCallback(value);
    };
    this.input.onEscape = () => {
      this.onDismissCallback();
    };
  }

  /**
   * Routes key input to either the close action or the embedded input field.
   *
   * Aside follows Pi's cancel binding when available so the overlay behaves like
   * the rest of the UI instead of inventing separate dismissal semantics.
   */
  handleInput(data: string): void {
    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.onDismissCallback();
      return;
    }

    this.input.handleInput(data);
  }

  setDraft(value: string): void {
    this.input.setValue(value);
    this.tui.requestRender();
  }

  getDraft(): string {
    return this.input.getValue();
  }

  private frameLine(content: string, innerWidth: number): string {
    const truncated = truncateToWidth(content, innerWidth, "");
    const padding = Math.max(0, innerWidth - visibleWidth(truncated));
    return `${this.theme.fg("borderMuted", " ")}${truncated}${" ".repeat(padding)}${this.theme.fg("borderMuted", " ")}`;
  }

  private borderLine(innerWidth: number, edge: "top" | "bottom"): string {
    const left = edge === "top" ? "┌" : "└";
    const right = edge === "top" ? "┐" : "┘";
    return this.theme.fg(
      "borderMuted",
      `${left}${"─".repeat(innerWidth)}${right}`,
    );
  }

  /**
   * Renders a bounded dialog around the latest transcript slice.
   *
   * The transcript is cropped to the visible viewport while preserving the
   * input and status chrome, so long side conversations stay readable without
   * expanding past the terminal.
   */
  override render(width: number): string[] {
    const dialogWidth = Math.max(56, Math.min(width, Math.floor(width * 0.9)));
    const innerWidth = Math.max(40, dialogWidth - 2);
    const terminalRows = process.stdout.rows ?? 30;
    const dialogHeight = Math.max(
      16,
      Math.min(30, Math.floor(terminalRows * 0.75)),
    );
    const chromeHeight = 7;
    const transcriptHeight = Math.max(6, dialogHeight - chromeHeight);

    const transcript = this.getTranscript(innerWidth, this.theme);
    const visibleTranscript = transcript.slice(-transcriptHeight);
    const transcriptPadding = Math.max(
      0,
      transcriptHeight - visibleTranscript.length,
    );
    const status = this.getStatus();

    const previousFocused = this.input.focused;
    this.input.focused = false;
    const inputLine = this.input.render(innerWidth)[0] ?? "";
    this.input.focused = previousFocused;

    const lines = [
      this.borderLine(innerWidth, "top"),
      this.frameLine(
        this.theme.fg("accent", this.theme.bold(" Aside ")),
        innerWidth,
      ),
      this.frameLine(
        this.theme.fg("dim", "Separate side conversation. Esc closes."),
        innerWidth,
      ),
      this.theme.fg("borderMuted", `├${"─".repeat(innerWidth)}┤`),
    ];

    for (const line of visibleTranscript) {
      lines.push(this.frameLine(line, innerWidth));
    }
    for (let i = 0; i < transcriptPadding; i++) {
      lines.push(this.frameLine("", innerWidth));
    }

    lines.push(this.theme.fg("borderMuted", `├${"─".repeat(innerWidth)}┤`));
    lines.push(this.frameLine(this.theme.fg("warning", status), innerWidth));
    lines.push(
      `${this.theme.fg("borderMuted", " ")}${inputLine}${this.theme.fg("borderMuted", " ")}`,
    );
    lines.push(
      this.frameLine(
        this.theme.fg("dim", "Enter submit · Esc close"),
        innerWidth,
      ),
    );
    lines.push(this.borderLine(innerWidth, "bottom"));
    return lines;
  }
}
