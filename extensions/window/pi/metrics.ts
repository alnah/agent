import type {
  ExtensionCommandContext,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import { extractCostTotal, type UsageLike } from "../core/metrics.ts";

/**
 * Aggregates assistant-side token usage and cost across the current session.
 *
 * `/window` reports session totals separately from current context usage, so it
 * walks persisted assistant messages and tolerates legacy usage field names.
 */
export function sumSessionUsage(ctx: ExtensionCommandContext): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
} {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let totalCost = 0;

  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "message") continue;

    const msg = (entry as SessionMessageEntry).message;
    if (msg.role !== "assistant") continue;

    const usage = msg.usage as UsageLike | undefined;
    if (!usage) continue;
    input += Number(usage.input ?? usage.inputTokens ?? 0) || 0;
    output += Number(usage.output ?? usage.outputTokens ?? 0) || 0;
    cacheRead += Number(usage.cacheRead ?? 0) || 0;
    cacheWrite += Number(usage.cacheWrite ?? 0) || 0;
    totalCost += extractCostTotal(usage);
  }

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    totalCost,
  };
}
