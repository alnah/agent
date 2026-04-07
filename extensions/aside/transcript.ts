import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Markdown, truncateToWidth } from "@mariozechner/pi-tui";

import type { AsideDetails } from "./side.ts";

export type ToolCallInfo = {
  toolCallId: string;
  toolName: string;
  args: string;
  status: "running" | "done" | "error";
};

export type TranscriptState = {
  thread: AsideDetails[];
  pendingQuestion: string | null;
  pendingAnswer: string;
  pendingError: string | null;
  pendingToolCalls: ToolCallInfo[];
};

const mdTheme = getMarkdownTheme();

type Theme = ExtensionContext["ui"]["theme"];

/**
 * Renders assistant markdown for the aside transcript pane.
 *
 * Markdown is preferred for parity with Pi message rendering, but the fallback
 * keeps the overlay usable if markdown rendering throws on malformed content.
 */
function renderMarkdownLines(text: string, width: number): string[] {
  if (!text) return [];

  try {
    const md = new Markdown(text, 0, 0, mdTheme);
    return md.render(width);
  } catch {
    return text.split("\n").flatMap((line) => {
      if (!line) return [""];
      const wrapped: string[] = [];
      for (let i = 0; i < line.length; i += width) {
        wrapped.push(line.slice(i, i + width));
      }
      return wrapped.length > 0 ? wrapped : [""];
    });
  }
}

function formatToolArgs(toolName: string, args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const input = args as Record<string, unknown>;

  switch (toolName) {
    case "bash":
      return typeof input.command === "string"
        ? truncateToWidth(input.command.split("\n")[0], 50, "…")
        : "";
    case "read":
    case "write":
    case "edit":
      return typeof input.path === "string" ? input.path : "";
    default: {
      const first = Object.values(input)[0];
      return typeof first === "string"
        ? truncateToWidth(first.split("\n")[0], 40, "…")
        : "";
    }
  }
}

/**
 * Normalizes one tool execution event into the compact overlay shape.
 *
 * The overlay only needs a readable name, short argument preview, and status,
 * not the full Pi event payload.
 */
export function createToolCallInfo(
  toolName: string,
  toolCallId: string,
  args: unknown,
): ToolCallInfo {
  return {
    toolCallId,
    toolName,
    args: formatToolArgs(toolName, args),
    status: "running",
  };
}

function renderToolCallLines(
  toolCalls: ToolCallInfo[],
  theme: Theme,
  width: number,
): string[] {
  const lines: string[] = [];

  for (const toolCall of toolCalls) {
    const icon =
      toolCall.status === "running"
        ? "⚙"
        : toolCall.status === "error"
          ? "✗"
          : "✓";
    const color =
      toolCall.status === "error"
        ? "error"
        : toolCall.status === "done"
          ? "success"
          : "dim";
    const label =
      theme.fg(color, `${icon} `) + theme.fg("toolTitle", toolCall.toolName);
    const argsText = toolCall.args ? theme.fg("dim", ` ${toolCall.args}`) : "";
    lines.push(truncateToWidth(` ${label}${argsText}`, width, ""));
  }

  return lines;
}

/**
 * Builds the visible aside transcript lines from persisted and pending state.
 *
 * Completed thread items and the in-flight assistant response share one render
 * path so the overlay can switch cleanly between history, streaming text, tool
 * activity, and terminal errors.
 */
export function getTranscriptLines(
  state: TranscriptState,
  width: number,
  theme: Theme,
): string[] {
  try {
    return getTranscriptLinesInner(state, width, theme);
  } catch (error) {
    return [
      theme.fg(
        "error",
        `Render error: ${error instanceof Error ? error.message : String(error)}`,
      ),
    ];
  }
}

function getTranscriptLinesInner(
  state: TranscriptState,
  width: number,
  theme: Theme,
): string[] {
  if (
    state.thread.length === 0 &&
    !state.pendingQuestion &&
    !state.pendingAnswer &&
    !state.pendingError
  ) {
    return [theme.fg("dim", "No aside messages yet. Type a question below.")];
  }

  const lines: string[] = [];
  for (const item of state.thread.slice(-6)) {
    const userText = item.question.trim().split("\n")[0];
    lines.push(
      theme.fg("accent", theme.bold("You: ")) +
        truncateToWidth(userText, width - 5, "…"),
    );
    lines.push("");
    lines.push(...renderMarkdownLines(item.answer, width));
    lines.push("");
  }

  if (state.pendingQuestion) {
    const userText = state.pendingQuestion.trim().split("\n")[0];
    lines.push(
      theme.fg("accent", theme.bold("You: ")) +
        truncateToWidth(userText, width - 5, "…"),
    );

    if (state.pendingToolCalls.length > 0) {
      lines.push(...renderToolCallLines(state.pendingToolCalls, theme, width));
    }

    if (state.pendingError) {
      lines.push(theme.fg("error", `❌ ${state.pendingError}`));
    } else if (state.pendingAnswer) {
      lines.push("");
      lines.push(...renderMarkdownLines(state.pendingAnswer, width));
    } else if (state.pendingToolCalls.length === 0) {
      lines.push(theme.fg("dim", "…"));
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}
