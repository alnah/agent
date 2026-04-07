/**
 * Review session message helpers.
 *
 * Reads assistant output from the current branch and waits for review/fix turns
 * to start so loop-fixing can react to the latest result.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

const LOOP_START_TIMEOUT_MS = 15000;
const LOOP_START_POLL_MS = 50;

/**
 * Snapshot of the latest assistant turn on the current branch.
 */
export type AssistantSnapshot = {
  id: string;
  text: string;
  stopReason?: string;
};

/**
 * Extracts text blocks from assistant message content.
 *
 * Accepts either a plain string or Pi's structured content array and ignores
 * non-text parts.
 */
function extractAssistantTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const textParts = content
    .filter((part): part is { type: "text"; text: string } =>
      Boolean(
        part &&
          typeof part === "object" &&
          "type" in part &&
          part.type === "text" &&
          "text" in part,
      ),
    )
    .map((part) => part.text);
  return textParts.join("\n").trim();
}

/**
 * Returns the latest assistant message from the current branch.
 */
export function getLastAssistantSnapshot(
  ctx: ExtensionContext,
): AssistantSnapshot | null {
  const entries = ctx.sessionManager.getBranch();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "message" || entry.message.role !== "assistant") {
      continue;
    }

    const assistantMessage = entry.message as {
      content?: unknown;
      stopReason?: string;
    };
    return {
      id: entry.id,
      text: extractAssistantTextContent(assistantMessage.content),
      stopReason: assistantMessage.stopReason,
    };
  }

  return null;
}

/**
 * Sleeps for the requested number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits until a new review or fix turn visibly starts.
 *
 * A turn counts as started when the session is no longer idle, when there are
 * pending messages, or when a new assistant entry appeared.
 */
export async function waitForLoopTurnToStart(
  ctx: ExtensionContext,
  previousAssistantId?: string,
): Promise<boolean> {
  const deadline = Date.now() + LOOP_START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const lastAssistantId = getLastAssistantSnapshot(ctx)?.id;
    if (
      !ctx.isIdle() ||
      ctx.hasPendingMessages() ||
      (lastAssistantId && lastAssistantId !== previousAssistantId)
    ) {
      return true;
    }
    await sleep(LOOP_START_POLL_MS);
  }

  return false;
}
