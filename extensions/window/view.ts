import { DynamicBorder, type Theme } from "@mariozechner/pi-coding-agent";
import {
  type Component,
  Container,
  Key,
  matchesKey,
  Text,
  type TUI,
} from "@mariozechner/pi-tui";
import { formatUsd } from "./metrics.ts";

/**
 * Presentation model consumed by the interactive `/window` TUI.
 *
 * The command builds this once so the view can stay focused on rendering and
 * keyboard handling rather than reaching back into Pi runtime APIs.
 */
export type WindowViewData = {
  usage: {
    // Context-window usage estimate returned by ctx.getContextUsage().
    // This is not a precise breakdown by source, so tool definitions are
    // estimated separately and added on top.
    contextUsageTokens: number;
    contextWindow: number;
    // Effective usage incl. a rough tool-definition estimate.
    effectiveTokens: number;
    percent: number;
    remainingTokens: number;
    systemPromptTokens: number;
    contextFileTokens: number;
    toolsTokens: number;
    activeTools: number;
  } | null;
  contextFiles: string[];
  extensions: string[];
  skills: string[];
  skillsObservedViaRead: string[];
  session: { totalTokens: number; totalCost: number };
};

/**
 * Renders the proportional usage bar for the current context window.
 *
 * The view separates system prompt, tool definitions, message context, and
 * remaining space so users can see where the budget is going at a glance.
 */
export function renderUsageBar(
  theme: Theme,
  parts: { system: number; tools: number; convo: number; remaining: number },
  total: number,
  width: number,
): string {
  const w = Math.max(10, width);
  if (total <= 0) return "";

  const toCols = (n: number) => Math.round((n / total) * w);
  const sys = toCols(parts.system);
  const tools = toCols(parts.tools);
  const con = toCols(parts.convo);
  let rem = w - sys - tools - con;
  if (rem < 0) rem = 0;
  while (sys + tools + con + rem < w) rem++;
  while (sys + tools + con + rem > w && rem > 0) rem--;

  const block = "█";
  const sysStr = theme.fg("accent", block.repeat(sys));
  const toolsStr = theme.fg("warning", block.repeat(tools));
  const conStr = theme.fg("success", block.repeat(con));
  const remStr = theme.fg("dim", block.repeat(rem));
  return `${sysStr}${toolsStr}${conStr}${remStr}`;
}

/**
 * Joins plain display labels with a comma separator.
 *
 * The view keeps list formatting centralized so both TUI and plain-text output
 * stay visually consistent.
 */
export function joinComma(items: string[]): string {
  return items.join(", ");
}

/**
 * Joins styled display labels with a styled separator.
 *
 * Skill rendering mixes muted and highlighted entries, so separator styling is
 * kept explicit instead of relying on inherited ANSI state.
 */
export function joinCommaStyled(
  items: string[],
  renderItem: (item: string) => string,
  sep: string,
): string {
  return items.map(renderItem).join(sep);
}

/**
 * TUI component used by `/window` in interactive mode.
 *
 * The command falls back to a plain custom message in RPC and print-like
 * environments, but interactive mode gets a compact bordered summary that can
 * be dismissed with standard close keys.
 */
export class WindowView implements Component {
  private theme: Theme;
  private onDone: () => void;
  private data: WindowViewData;
  private container: Container;
  private body: Text;
  private cachedWidth?: number;

  constructor(
    _tui: TUI,
    theme: Theme,
    data: WindowViewData,
    onDone: () => void,
  ) {
    this.theme = theme;
    this.data = data;
    this.onDone = onDone;

    this.container = new Container();
    this.container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
    this.container.addChild(
      new Text(
        theme.fg("accent", theme.bold("Window")) +
          theme.fg("dim", "  (Esc/q/Enter to close)"),
        1,
        0,
      ),
    );
    this.container.addChild(new Text("", 1, 0));

    this.body = new Text("", 1, 0);
    this.container.addChild(this.body);

    this.container.addChild(new Text("", 1, 0));
    this.container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
  }

  private rebuild(width: number): void {
    const muted = (s: string) => this.theme.fg("muted", s);
    const dim = (s: string) => this.theme.fg("dim", s);
    const text = (s: string) => this.theme.fg("text", s);

    const lines: string[] = [];

    if (!this.data.usage) {
      lines.push(muted("Window: ") + dim("(unknown)"));
    } else {
      const u = this.data.usage;
      lines.push(
        muted("Window: ") +
          text(
            `~${u.effectiveTokens.toLocaleString()} / ${u.contextWindow.toLocaleString()}`,
          ) +
          muted(
            `  (${u.percent.toFixed(1)}% used, ~${u.remainingTokens.toLocaleString()} left)`,
          ),
      );

      const barWidth = Math.max(10, Math.min(36, width - 10));
      const sysInMessages = Math.min(
        u.systemPromptTokens,
        u.contextUsageTokens,
      );
      const convoInMessages = Math.max(0, u.contextUsageTokens - sysInMessages);
      const bar = renderUsageBar(
        this.theme,
        {
          system: sysInMessages,
          tools: u.toolsTokens,
          convo: convoInMessages,
          remaining: u.remainingTokens,
        },
        u.contextWindow,
        barWidth,
      );
      const legend =
        this.theme.fg("accent", "■") +
        " " +
        dim("system") +
        "  " +
        this.theme.fg("warning", "■") +
        " " +
        dim("tools") +
        "  " +
        this.theme.fg("success", "■") +
        " " +
        dim("messages") +
        "  " +
        this.theme.fg("dim", "■") +
        " " +
        dim("free");
      lines.push(bar);
      lines.push(legend);
    }

    lines.push("");

    if (this.data.usage) {
      const u = this.data.usage;
      lines.push(
        muted("System: ") +
          text(`~${u.systemPromptTokens.toLocaleString()} tok`) +
          muted(` (context files ~${u.contextFileTokens.toLocaleString()})`),
      );
      lines.push(
        muted("Tools: ") +
          text(`~${u.toolsTokens.toLocaleString()} tok`) +
          muted(` (${u.activeTools} active)`),
      );
    }

    lines.push(
      muted(`AGENTS (${this.data.contextFiles.length}): `) +
        text(
          this.data.contextFiles.length
            ? joinComma(this.data.contextFiles)
            : "(none)",
        ),
    );
    lines.push("");
    lines.push(
      muted(`Extensions (${this.data.extensions.length}): `) +
        text(
          this.data.extensions.length
            ? joinComma(this.data.extensions)
            : "(none)",
        ),
    );

    const skillsObservedViaRead = new Set(this.data.skillsObservedViaRead);
    const skillsRendered = this.data.skills.length
      ? joinCommaStyled(
          this.data.skills,
          (name) =>
            skillsObservedViaRead.has(name)
              ? this.theme.fg("success", name)
              : this.theme.fg("muted", name),
          this.theme.fg("muted", ", "),
        )
      : "(none)";
    lines.push(
      muted(`Skills (${this.data.skills.length}, green = read): `) +
        skillsRendered,
    );
    lines.push("");
    lines.push(
      muted("Session: ") +
        text(`${this.data.session.totalTokens.toLocaleString()} tokens`) +
        muted(" · ") +
        text(formatUsd(this.data.session.totalCost)),
    );

    this.body.setText(lines.join("\n"));
    this.cachedWidth = width;
  }

  handleInput(data: string): void {
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl("c")) ||
      data.toLowerCase() === "q" ||
      data === "\r"
    ) {
      this.onDone();
      return;
    }
  }

  invalidate(): void {
    this.container.invalidate();
    this.cachedWidth = undefined;
  }

  render(width: number): string[] {
    if (this.cachedWidth !== width) this.rebuild(width);
    return this.container.render(width);
  }
}
