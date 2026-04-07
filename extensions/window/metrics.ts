import type {
  ExtensionCommandContext,
  SessionMessageEntry,
} from "@mariozechner/pi-coding-agent";

/**
 * Formats a session cost total for compact display.
 *
 * `/window` needs stable, low-noise currency output so tiny totals remain
 * readable without overwhelming the rest of the summary.
 */
export function formatUsd(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return "$0.00";
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost >= 0.1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(4)}`;
}

/**
 * Applies the lightweight token heuristic used throughout the extension.
 *
 * The view only needs order-of-magnitude estimates for files, prompts, and
 * tool definitions, so a fast character-based approximation is sufficient.
 */
export function estimateTokens(text: string): number {
  // Deliberately fuzzy (good enough for “how big-ish is this”).
  return Math.max(0, Math.ceil(text.length / 4));
}

/**
 * Normalizes usage cost payloads into one numeric total.
 *
 * Session history may contain slightly different shapes depending on provider
 * or runtime version, so the command accepts both flat and nested totals.
 */
type UsageLike = {
  cost?: unknown;
  input?: unknown;
  inputTokens?: unknown;
  output?: unknown;
  outputTokens?: unknown;
  cacheRead?: unknown;
  cacheWrite?: unknown;
};

export function extractCostTotal(usage: unknown): number {
  if (!usage || typeof usage !== "object") return 0;
  const c = (usage as UsageLike).cost;
  if (typeof c === "number") return Number.isFinite(c) ? c : 0;
  if (typeof c === "string") {
    const n = Number(c);
    return Number.isFinite(n) ? n : 0;
  }
  const t =
    c && typeof c === "object" ? (c as { total?: unknown }).total : undefined;
  if (typeof t === "number") return Number.isFinite(t) ? t : 0;
  if (typeof t === "string") {
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

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

/**
 * Estimates how much context an active tool definition contributes.
 *
 * Tool schemas are often a large share of prompt overhead, so the estimate
 * includes the tool name, description, and serialized parameter schema.
 */
export function estimateToolDefinitionTokens(tool: {
  name: string;
  description?: string;
  parameters?: unknown;
}): number {
  let parametersText = "";
  try {
    parametersText = tool.parameters
      ? JSON.stringify(tool.parameters, null, 2)
      : "";
  } catch {
    parametersText = "";
  }
  return estimateTokens(
    [tool.name, tool.description ?? "", parametersText]
      .filter(Boolean)
      .join("\n"),
  );
}
