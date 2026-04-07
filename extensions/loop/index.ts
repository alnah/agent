/**
 * Loop extension.
 *
 * Registers `/loop` and `signal_loop_success` so the agent can keep sending a
 * follow-up prompt until an explicit breakout condition is satisfied.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { compact } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { buildPrompt, getCompactionInstructions } from "./prompting.ts";
import { showLoopSelector } from "./selector.ts";
import {
  type LoopStateData,
  loadPersistedState,
  persistState,
} from "./state.ts";
import { updateStatus } from "./status.ts";
import { summarizeBreakoutCondition } from "./summaries.ts";

export type { LoopMode, LoopStateData } from "./state.ts";
export {
  buildPrompt,
  getCompactionInstructions,
  loadPersistedState,
  persistState,
  showLoopSelector,
  summarizeBreakoutCondition,
  updateStatus,
};

/**
 * Parses `/loop` arguments into a persisted loop state.
 *
 * Returns `null` when the arguments are empty or incomplete so the caller can
 * fall back to the interactive selector.
 */
function parseArgs(args: string | undefined): LoopStateData | null {
  if (!args?.trim()) return null;
  const parts = args.trim().split(/\s+/);
  const mode = parts[0]?.toLowerCase();

  switch (mode) {
    case "tests":
      return { active: true, mode: "tests", prompt: buildPrompt("tests") };
    case "self":
      return { active: true, mode: "self", prompt: buildPrompt("self") };
    case "custom": {
      const condition = parts.slice(1).join(" ").trim();
      if (!condition) return null;
      return {
        active: true,
        mode: "custom",
        condition,
        prompt: buildPrompt("custom", condition),
      };
    }
    default:
      return null;
  }
}

/**
 * Checks whether the latest assistant message ended with an abort.
 *
 * The loop uses this to ask whether it should stop after the user interrupts an
 * in-progress turn.
 */
function wasLastAssistantAborted(
  messages: Array<{ role?: string; stopReason?: string }>,
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "assistant") {
      return message.stopReason === "aborted";
    }
  }
  return false;
}

export default function loopExtension(pi: ExtensionAPI): void {
  let loopState: LoopStateData = { active: false };

  /**
   * Stores loop state locally, persists it, and refreshes the widget.
   *
   * All state transitions flow through this helper so runtime and persisted
   * state stay in sync.
   */
  function setLoopState(state: LoopStateData, ctx: ExtensionContext): void {
    loopState = state;
    persistState(pi, state);
    updateStatus(ctx, state);
  }

  /**
   * Clears the active loop both in memory and in session storage.
   */
  function clearLoopState(ctx: ExtensionContext): void {
    setLoopState({ active: false }, ctx);
  }

  /**
   * Ends the loop and notifies the user.
   */
  function breakLoop(ctx: ExtensionContext): void {
    clearLoopState(ctx);
    ctx.ui.notify("Loop ended", "info");
  }

  /**
   * Schedules the next follow-up loop turn when the loop is still active.
   *
   * Pending outbound messages suppress requeueing so the extension does not
   * stack multiple loop prompts for the same turn.
   */
  function triggerLoopPrompt(ctx: ExtensionContext): void {
    if (!loopState.active || !loopState.mode || !loopState.prompt) return;
    if (ctx.hasPendingMessages()) return;

    const loopCount = (loopState.loopCount ?? 0) + 1;
    loopState = { ...loopState, loopCount };
    persistState(pi, loopState);
    updateStatus(ctx, loopState);

    pi.sendMessage(
      {
        customType: "loop",
        content: loopState.prompt,
        display: true,
      },
      {
        deliverAs: "followUp",
        triggerTurn: true,
      },
    );
  }

  /**
   * Refreshes the short breakout summary shown in the widget.
   *
   * The summary update is discarded when the active loop changed while the
   * model request was in flight.
   */
  function refreshSummary(
    ctx: ExtensionContext,
    mode: NonNullable<LoopStateData["mode"]>,
    condition?: string,
  ): void {
    void (async () => {
      const summary = await summarizeBreakoutCondition(ctx, mode, condition);
      if (
        !loopState.active ||
        loopState.mode !== mode ||
        loopState.condition !== condition
      ) {
        return;
      }
      loopState = { ...loopState, summary };
      persistState(pi, loopState);
      updateStatus(ctx, loopState);
    })();
  }

  /**
   * Restores persisted loop state on session start.
   *
   * When a restored loop is missing its summary, the extension recomputes it in
   * the background without changing the loop prompt or counter.
   */
  async function restoreLoopState(ctx: ExtensionContext): Promise<void> {
    loopState = await loadPersistedState(ctx);
    updateStatus(ctx, loopState);

    if (loopState.active && loopState.mode && !loopState.summary) {
      refreshSummary(ctx, loopState.mode, loopState.condition);
    }
  }

  pi.registerTool({
    name: "signal_loop_success",
    label: "Signal Loop Success",
    description:
      "Stop the active loop when the breakout condition is satisfied. Only call this tool when explicitly instructed to do so by the user, tool or system prompt.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      if (!loopState.active) {
        return {
          content: [{ type: "text", text: "No active loop is running." }],
          details: { active: false },
        };
      }

      clearLoopState(ctx);

      return {
        content: [{ type: "text", text: "Loop ended." }],
        details: { active: false },
      };
    },
  });

  pi.registerCommand("loop", {
    description: "Start a follow-up loop until a breakout condition is met",
    handler: async (args, ctx) => {
      let nextState = parseArgs(args);
      if (!nextState) {
        if (!ctx.hasUI) {
          ctx.ui.notify(
            "Usage: /loop tests | /loop custom <condition> | /loop self",
            "warning",
          );
          return;
        }
        nextState = await showLoopSelector(ctx);
      }

      if (!nextState) {
        ctx.ui.notify("Loop cancelled", "info");
        return;
      }

      if (loopState.active) {
        const confirm = ctx.hasUI
          ? await ctx.ui.confirm(
              "Replace active loop?",
              "A loop is already active. Replace it?",
            )
          : true;
        if (!confirm) {
          ctx.ui.notify("Loop unchanged", "info");
          return;
        }
      }

      const summarizedState: LoopStateData = {
        ...nextState,
        summary: undefined,
        loopCount: 0,
      };
      setLoopState(summarizedState, ctx);
      ctx.ui.notify("Loop active", "info");
      triggerLoopPrompt(ctx);

      if (nextState.mode) {
        refreshSummary(ctx, nextState.mode, nextState.condition);
      }
    },
  });

  pi.on("agent_end", async (event, ctx) => {
    if (!loopState.active) return;

    if (ctx.hasUI && wasLastAssistantAborted(event.messages)) {
      const confirm = await ctx.ui.confirm(
        "Break active loop?",
        "Operation aborted. Break out of the loop?",
      );
      if (confirm) {
        breakLoop(ctx);
        return;
      }
    }

    triggerLoopPrompt(ctx);
  });

  pi.on("session_before_compact", async (event, ctx) => {
    if (!loopState.active || !loopState.mode || !ctx.model) return;
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    if (!auth.ok) return;

    const instructionParts = [
      event.customInstructions,
      getCompactionInstructions(loopState.mode, loopState.condition),
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const compaction = await compact(
        event.preparation,
        ctx.model,
        auth.apiKey ?? "",
        auth.headers,
        instructionParts,
        event.signal,
      );
      return { compaction };
    } catch (error) {
      if (ctx.hasUI) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Loop compaction failed: ${message}`, "warning");
      }
      return;
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    await restoreLoopState(ctx);
  });
}
