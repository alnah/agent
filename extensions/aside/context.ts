import type { AssistantMessage, Message } from "@mariozechner/pi-ai";
import {
  type AgentSession,
  buildSessionContext,
  createExtensionRuntime,
  type ExtensionCommandContext,
  type ExtensionContext,
  type ResourceLoader,
} from "@mariozechner/pi-coding-agent";

import type { AsideDetails, SessionThinkingLevel } from "./side.ts";

const ASIDE_SYSTEM_PROMPT = [
  "You are Aside, a side-channel assistant embedded in the user's coding agent.",
  "You have access to the main conversation context — use it to give informed answers.",
  "Help with focused questions, planning, and quick explorations.",
  "Be direct and practical.",
].join(" ");

export type AsideContext = ExtensionContext | ExtensionCommandContext;

/**
 * Removes Pi's volatile date/cwd footer from a system prompt snapshot.
 *
 * Aside wants the stable instruction body from the main session, but replaying
 * per-request dynamic footer lines into seeded side sessions only adds noise.
 */
export function stripDynamicSystemPromptFooter(systemPrompt: string): string {
  return systemPrompt
    .replace(
      /\nCurrent date and time:[^\n]*(?:\nCurrent working directory:[^\n]*)?$/u,
      "",
    )
    .replace(/\nCurrent working directory:[^\n]*$/u, "")
    .trim();
}

/**
 * Creates the minimal resource loader required by temporary aside sessions.
 *
 * Side sessions intentionally inherit the main system prompt while disabling
 * extensions, skills, prompts, and themes so the side channel stays focused.
 */
export function createAsideResourceLoader(
  ctx: ExtensionContext,
  appendSystemPrompt: string[] = [ASIDE_SYSTEM_PROMPT],
): ResourceLoader {
  const extensionsResult = {
    extensions: [],
    errors: [],
    runtime: createExtensionRuntime(),
  };
  const systemPrompt = stripDynamicSystemPromptFooter(ctx.getSystemPrompt());

  return {
    getExtensions: () => extensionsResult,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getAppendSystemPrompt: () => appendSystemPrompt,
    extendResources: () => {},
    reload: async () => {},
  };
}

export function extractText(parts: AssistantMessage["content"]): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

/**
 * Extracts streamed assistant text from a Pi session event payload.
 *
 * Aside only mirrors assistant prose into the overlay; tool call parts and other
 * message shapes are ignored to keep the partial transcript readable.
 */
export function extractEventAssistantText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }

  const maybeMessage = message as { role?: unknown; content?: unknown };
  if (
    maybeMessage.role !== "assistant" ||
    !Array.isArray(maybeMessage.content)
  ) {
    return "";
  }

  return maybeMessage.content
    .filter((part): part is { type: "text"; text: string } => {
      return (
        !!part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text"
      );
    })
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function getLastAssistantMessage(
  session: AgentSession,
): AssistantMessage | null {
  for (let i = session.state.messages.length - 1; i >= 0; i--) {
    const message = session.state.messages[i];
    if (message.role === "assistant") {
      return message as AssistantMessage;
    }
  }

  return null;
}

/**
 * Builds the message seed for a fresh side session.
 *
 * The seed starts with the current main conversation branch when available and
 * then appends the persisted aside exchanges so the side assistant can continue
 * prior work without re-reading the whole transcript manually.
 */
export function buildSeedMessages(
  ctx: ExtensionContext,
  thread: AsideDetails[],
): Message[] {
  const seed: Message[] = [];

  try {
    const contextMessages = buildSessionContext(
      ctx.sessionManager.getEntries(),
      ctx.sessionManager.getLeafId(),
    ).messages;
    seed.push(...(contextMessages as unknown as Message[]));
  } catch {
    // Ignore context seed failures and continue with an empty side thread.
  }

  for (const item of thread) {
    seed.push(
      {
        role: "user",
        content: [{ type: "text", text: item.question }],
        timestamp: item.timestamp,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: item.answer }],
        provider: item.provider,
        model: item.model,
        api: ctx.model?.api ?? "openai-responses",
        usage: item.usage ?? {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: item.timestamp,
      },
    );
  }

  return seed;
}

/**
 * Serializes the aside thread into a compact handoff transcript.
 *
 * Summary generation uses this stable plain-text format instead of the overlay
 * rendering so model input stays deterministic.
 */
export function formatThread(thread: AsideDetails[]): string {
  return thread
    .map(
      (item) =>
        `User: ${item.question.trim()}\nAssistant: ${item.answer.trim()}`,
    )
    .join("\n\n---\n\n");
}

export function notify(
  ctx: AsideContext,
  message: string,
  level: "info" | "warning" | "error",
): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, level);
  }
}

export function getModelKey(ctx: ExtensionContext): string {
  const model = ctx.model;
  return model ? `${model.provider}/${model.id}` : "none";
}

export function getThinkingLevel(ctx: {
  getThinkingLevel(): string;
}): SessionThinkingLevel {
  return ctx.getThinkingLevel() as SessionThinkingLevel;
}
