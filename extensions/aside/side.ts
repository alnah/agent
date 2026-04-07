import type {
  ThinkingLevel as AiThinkingLevel,
  AssistantMessage,
} from "@mariozechner/pi-ai";
import {
  type AgentSession,
  type AgentSessionEvent,
  codingTools,
  createAgentSession,
  type ExtensionCommandContext,
  type ExtensionContext,
  SessionManager,
} from "@mariozechner/pi-coding-agent";

import {
  buildSeedMessages,
  createAsideResourceLoader,
  extractText,
  formatThread,
  getLastAssistantMessage,
  getModelKey,
  getThinkingLevel,
} from "./context.ts";

const ASIDE_SUMMARY_PROMPT =
  "Summarize this aside conversation for handoff into the main conversation. Keep key decisions, findings, risks, and next actions. Output only the summary.";

export type SessionThinkingLevel = "off" | AiThinkingLevel;

export type AsideDetails = {
  question: string;
  answer: string;
  timestamp: number;
  provider: string;
  model: string;
  thinkingLevel: SessionThinkingLevel;
  usage?: AssistantMessage["usage"];
};

export type SideSessionRuntime = {
  session: AgentSession;
  modelKey: string;
  unsubscribe: () => void;
};

/**
 * Creates the isolated aside agent session used for side-chat turns.
 *
 * The side session mirrors the active model and coding tools, seeds itself with
 * the current main-context branch plus prior aside exchanges, and streams events
 * back to the controller through one callback.
 */
export async function createSideSession(
  pi: { getThinkingLevel(): string },
  ctx: ExtensionCommandContext,
  thread: AsideDetails[],
  onEvent: (event: AgentSessionEvent) => void,
): Promise<SideSessionRuntime | null> {
  if (!ctx.model) {
    return null;
  }

  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    model: ctx.model,
    modelRegistry: ctx.modelRegistry as AgentSession["modelRegistry"],
    thinkingLevel: getThinkingLevel(pi),
    tools: codingTools,
    resourceLoader: createAsideResourceLoader(ctx),
  });

  const seedMessages = buildSeedMessages(ctx, thread);
  if (seedMessages.length > 0) {
    session.state.messages = [
      ...(seedMessages as typeof session.state.messages),
    ];
  }

  return {
    session,
    modelKey: getModelKey(ctx),
    unsubscribe: session.subscribe(onEvent),
  };
}

/**
 * Summarizes the accumulated aside thread for injection into the main chat.
 *
 * Summary generation deliberately runs in a fresh tool-free session with
 * thinking disabled so the handoff stays deterministic and compact.
 */
export async function summarizeThread(
  ctx: ExtensionContext,
  items: AsideDetails[],
): Promise<string> {
  const model = ctx.model;
  if (!model) {
    throw new Error("No active model selected.");
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (auth.ok === false) {
    throw new Error(auth.error);
  }

  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    model,
    modelRegistry: ctx.modelRegistry as AgentSession["modelRegistry"],
    thinkingLevel: "off" as SessionThinkingLevel,
    tools: [],
    resourceLoader: createAsideResourceLoader(ctx, [ASIDE_SUMMARY_PROMPT]),
  });

  try {
    await session.prompt(formatThread(items), { source: "extension" });
    const response = getLastAssistantMessage(session);
    if (!response) {
      throw new Error("Summary finished without a response.");
    }
    if (response.stopReason === "aborted") {
      throw new Error("Summary request was aborted.");
    }
    if (response.stopReason === "error") {
      throw new Error(response.errorMessage || "Summary request failed.");
    }

    return extractText(response.content) || "(No summary generated)";
  } finally {
    try {
      await session.abort();
    } catch {
      // Ignore abort errors during temporary session teardown.
    }
    session.dispose();
  }
}
