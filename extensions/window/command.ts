import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import {
  formatExtensionSourceLabel,
  loadProjectContextFiles,
  shortenPath,
} from "./files.ts";
import {
  estimateTokens,
  estimateToolDefinitionTokens,
  formatUsd,
  sumSessionUsage,
} from "./metrics.ts";
import {
  getSkillsObservedViaReadFromSession,
  normalizeSkillName,
} from "./skills.ts";
import { joinComma, WindowView, type WindowViewData } from "./view.ts";

/**
 * Detects whether the current Pi process runs in RPC mode.
 *
 * `/window` uses a custom TUI component in interactive mode but must fall back
 * to plain custom messages when the host owns the UI.
 */
function isRpcMode(): boolean {
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--mode" && process.argv[i + 1] === "rpc") return true;
    if (arg === "--mode=rpc") return true;
  }
  return false;
}

/**
 * Creates the `/window` command handler.
 *
 * The handler assembles resource discovery, context usage estimates, tool
 * overhead, session totals, and the interactive/plain-text presentation path.
 */
export function createWindowHandler(pi: ExtensionAPI) {
  return async function handleWindow(
    _args: string,
    ctx: ExtensionCommandContext,
  ): Promise<void> {
    const commands = pi.getCommands();
    const extensionCmds = commands.filter((c) => c.source === "extension");
    const skillCmds = commands.filter((c) => c.source === "skill");

    const extensionsByPath = new Map<string, string[]>();
    for (const c of extensionCmds) {
      const p = c.sourceInfo?.path ?? "<unknown>";
      const arr = extensionsByPath.get(p) ?? [];
      arr.push(c.name);
      extensionsByPath.set(p, arr);
    }
    const extensionFiles = [...extensionsByPath.keys()]
      .map((p) => formatExtensionSourceLabel(p))
      .sort((a, b) => a.localeCompare(b));

    const skills = skillCmds
      .map((c) => normalizeSkillName(c.name))
      .sort((a, b) => a.localeCompare(b));

    const contextFiles = await loadProjectContextFiles(ctx.cwd);
    const contextFilePaths = contextFiles.map((f) =>
      shortenPath(f.path, ctx.cwd),
    );
    const contextFileTokens = contextFiles.reduce((a, f) => a + f.tokens, 0);

    const systemPrompt = ctx.getSystemPrompt();
    const systemPromptTokens = systemPrompt ? estimateTokens(systemPrompt) : 0;

    const usage = ctx.getContextUsage();
    const contextUsageTokens = usage?.tokens ?? 0;
    const ctxWindow = usage?.contextWindow ?? 0;

    const TOOL_FUDGE = 1.15;
    const activeToolNames = pi.getActiveTools();
    const toolInfoByName = new Map(
      pi.getAllTools().map((t) => [t.name, t] as const),
    );
    let toolsTokens = 0;
    for (const name of activeToolNames) {
      const info = toolInfoByName.get(name);
      if (!info) {
        toolsTokens += estimateTokens(name);
        continue;
      }
      toolsTokens += estimateToolDefinitionTokens(info);
    }
    toolsTokens = Math.round(toolsTokens * TOOL_FUDGE);

    const effectiveTokens = contextUsageTokens + toolsTokens;
    const percent = ctxWindow > 0 ? (effectiveTokens / ctxWindow) * 100 : 0;
    const remainingTokens =
      ctxWindow > 0 ? Math.max(0, ctxWindow - effectiveTokens) : 0;

    const sessionUsage = sumSessionUsage(ctx);

    const makePlainText = () => {
      const lines: string[] = [];
      lines.push("Window");
      if (usage) {
        lines.push(
          `Window: ~${effectiveTokens.toLocaleString()} / ${ctxWindow.toLocaleString()} (${percent.toFixed(1)}% used, ~${remainingTokens.toLocaleString()} left)`,
        );
      } else {
        lines.push("Window: (unknown)");
      }
      lines.push(
        `System: ~${systemPromptTokens.toLocaleString()} tok (context files ~${contextFileTokens.toLocaleString()})`,
      );
      lines.push(
        `Tools: ~${toolsTokens.toLocaleString()} tok (${activeToolNames.length} active)`,
      );
      lines.push(
        `AGENTS: ${contextFilePaths.length ? joinComma(contextFilePaths) : "(none)"}`,
      );
      lines.push(
        `Extensions (${extensionFiles.length}): ${extensionFiles.length ? joinComma(extensionFiles) : "(none)"}`,
      );
      lines.push(
        `Skills (${skills.length}): ${skills.length ? joinComma(skills) : "(none)"}`,
      );
      lines.push(
        `Session: ${sessionUsage.totalTokens.toLocaleString()} tokens · ${formatUsd(sessionUsage.totalCost)}`,
      );
      return lines.join("\n");
    };

    if (!ctx.hasUI || isRpcMode()) {
      pi.sendMessage(
        { customType: "window", content: makePlainText(), display: true },
        { triggerTurn: false },
      );
      return;
    }

    const skillsObservedViaRead = Array.from(
      getSkillsObservedViaReadFromSession(ctx),
    ).sort((a, b) => a.localeCompare(b));

    const viewData: WindowViewData = {
      usage: usage
        ? {
            contextUsageTokens,
            contextWindow: ctxWindow,
            effectiveTokens,
            percent,
            remainingTokens,
            systemPromptTokens,
            contextFileTokens,
            toolsTokens,
            activeTools: activeToolNames.length,
          }
        : null,
      contextFiles: contextFilePaths,
      extensions: extensionFiles,
      skills,
      skillsObservedViaRead,
      session: {
        totalTokens: sessionUsage.totalTokens,
        totalCost: sessionUsage.totalCost,
      },
    };

    await ctx.ui.custom<void>((tui, theme, _kb, done) => {
      return new WindowView(tui, theme, viewData, done);
    });
  };
}
