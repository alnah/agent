/**
 * Session file discovery and parsing.
 *
 * Scans `~/.pi/agent/sessions`, parses recent `.jsonl` files, and normalizes
 * each session into a shape that aggregation can consume.
 */

import { createReadStream, type Dirent } from "node:fs";
import fs from "node:fs/promises";
import readline from "node:readline";
import {
  DOW_NAMES,
  type DowKey,
  localMidnight,
  mondayIndex,
  type TodKey,
  todBucketForHour,
  toLocalDayKey,
} from "./calendar.ts";

export type ModelKey = string;
export type CwdKey = string;

type JsonObject = Record<string, unknown>;

type ProviderModelUsage = {
  provider?: unknown;
  model?: unknown;
  modelId?: unknown;
  usage?: unknown;
};

function toObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" ? (value as JsonObject) : null;
}

/**
 * Parsed session summary extracted from one `.jsonl` file.
 */
export interface ParsedSession {
  filePath: string;
  startedAt: Date;
  dayKeyLocal: string;
  cwd: CwdKey | null;
  dow: DowKey;
  tod: TodKey;
  modelsUsed: Set<ModelKey>;
  messages: number;
  tokens: number;
  totalCost: number;
  costByModel: Map<ModelKey, number>;
  messagesByModel: Map<ModelKey, number>;
  tokensByModel: Map<ModelKey, number>;
}

/**
 * Parses a session start timestamp from a Pi session filename.
 */
function parseSessionStartFromFilename(name: string): Date | null {
  const match = name.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/,
  );
  if (!match) return null;
  const iso = `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Normalizes provider/model parts into a single key.
 */
function modelKeyFromParts(
  provider?: unknown,
  model?: unknown,
): ModelKey | null {
  const normalizedProvider =
    typeof provider === "string" ? provider.trim() : "";
  const normalizedModel = typeof model === "string" ? model.trim() : "";
  if (!normalizedProvider && !normalizedModel) return null;
  if (!normalizedProvider) return normalizedModel;
  if (!normalizedModel) return normalizedProvider;
  return `${normalizedProvider}/${normalizedModel}`;
}

/**
 * Extracts provider/model/usage fields from session entries across Pi versions.
 */
function extractProviderModelAndUsage(obj: JsonObject): ProviderModelUsage {
  const message = toObject(obj.message);
  return {
    provider: obj.provider ?? message?.provider,
    model: obj.model ?? message?.model,
    modelId: obj.modelId ?? message?.modelId,
    usage: obj.usage ?? message?.usage,
  };
}

/**
 * Extracts a numeric total cost from provider usage metadata.
 */
function extractCostTotal(usage: unknown): number {
  const usageObject = toObject(usage);
  if (!usageObject) return 0;

  const cost = usageObject.cost;
  if (typeof cost === "number") return Number.isFinite(cost) ? cost : 0;
  if (typeof cost === "string") {
    const parsed = Number(cost);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const costObject = toObject(cost);
  const total = costObject?.total;
  if (typeof total === "number") return Number.isFinite(total) ? total : 0;
  if (typeof total === "string") {
    const parsed = Number(total);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * Extracts a numeric total token count from provider usage metadata.
 *
 * The parser accepts the common Pi/provider field variants and falls back to a
 * sum of input/output token fields when no direct total exists.
 */
function extractTokensTotal(usage: unknown): number {
  const usageObject = toObject(usage);
  if (!usageObject) return 0;

  const readNum = (value: unknown): number => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  };

  let total =
    readNum(usageObject.totalTokens) ||
    readNum(usageObject.total_tokens) ||
    readNum(usageObject.tokens) ||
    readNum(usageObject.tokenCount) ||
    readNum(usageObject.token_count);
  if (total > 0) return total;

  const tokensObject = toObject(usageObject.tokens);
  total =
    readNum(tokensObject?.total) ||
    readNum(tokensObject?.totalTokens) ||
    readNum(tokensObject?.total_tokens);
  if (total > 0) return total;

  const input =
    readNum(usageObject.promptTokens) ||
    readNum(usageObject.prompt_tokens) ||
    readNum(usageObject.inputTokens) ||
    readNum(usageObject.input_tokens);
  const output =
    readNum(usageObject.completionTokens) ||
    readNum(usageObject.completion_tokens) ||
    readNum(usageObject.outputTokens) ||
    readNum(usageObject.output_tokens);
  const sum = input + output;
  return sum > 0 ? sum : 0;
}

/**
 * Walks session directories and returns candidate `.jsonl` files within range.
 *
 * Filename timestamps are preferred because they avoid opening older files just
 * to reject them. `onFound` receives periodic counts during the scan.
 */
export async function walkSessionFiles(
  root: string,
  startCutoffLocal: Date,
  signal?: AbortSignal,
  onFound?: (found: number) => void,
): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    if (signal?.aborted) break;
    const dir = stack.pop();
    if (!dir) continue;
    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (signal?.aborted) break;
      const filePath = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        stack.push(filePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;

      const startedAt = parseSessionStartFromFilename(entry.name);
      if (startedAt) {
        if (localMidnight(startedAt) >= startCutoffLocal) {
          out.push(filePath);
          if (onFound && out.length % 10 === 0) onFound(out.length);
        }
        continue;
      }

      try {
        const stats = await fs.stat(filePath);
        const approx = new Date(stats.mtimeMs);
        if (localMidnight(approx) >= startCutoffLocal) {
          out.push(filePath);
          if (onFound && out.length % 10 === 0) onFound(out.length);
        }
      } catch {}
    }
  }
  onFound?.(out.length);
  return out;
}

/**
 * Parses one session file into an aggregate-friendly session summary.
 *
 * Malformed JSONL lines are skipped. Returns `null` when the session has no
 * recoverable start time.
 */
export async function parseSessionFile(
  filePath: string,
  signal?: AbortSignal,
): Promise<ParsedSession | null> {
  const fileName = filePath.split("/").pop() ?? filePath;
  let startedAt = parseSessionStartFromFilename(fileName);
  let currentModel: ModelKey | null = null;
  let cwd: CwdKey | null = null;

  const modelsUsed = new Set<ModelKey>();
  let messages = 0;
  let tokens = 0;
  let totalCost = 0;
  const costByModel = new Map<ModelKey, number>();
  const messagesByModel = new Map<ModelKey, number>();
  const tokensByModel = new Map<ModelKey, number>();

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of reader) {
      if (signal?.aborted) {
        reader.close();
        stream.destroy();
        return null;
      }
      if (!line) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      const obj = toObject(parsed);
      if (!obj) continue;

      if (obj.type === "session") {
        if (!startedAt && typeof obj.timestamp === "string") {
          const parsedDate = new Date(obj.timestamp);
          if (Number.isFinite(parsedDate.getTime())) startedAt = parsedDate;
        }
        if (typeof obj.cwd === "string" && obj.cwd.trim()) {
          cwd = obj.cwd.trim();
        }
        continue;
      }

      if (obj.type === "model_change") {
        const modelKey = modelKeyFromParts(obj.provider, obj.modelId);
        if (modelKey) {
          currentModel = modelKey;
          modelsUsed.add(modelKey);
        }
        continue;
      }

      if (obj.type !== "message") continue;

      const { provider, model, modelId, usage } =
        extractProviderModelAndUsage(obj);
      const modelKey =
        modelKeyFromParts(provider, model) ??
        modelKeyFromParts(provider, modelId) ??
        currentModel ??
        "unknown";
      modelsUsed.add(modelKey);

      messages += 1;
      messagesByModel.set(modelKey, (messagesByModel.get(modelKey) ?? 0) + 1);

      const tokenCount = extractTokensTotal(usage);
      if (tokenCount > 0) {
        tokens += tokenCount;
        tokensByModel.set(
          modelKey,
          (tokensByModel.get(modelKey) ?? 0) + tokenCount,
        );
      }

      const cost = extractCostTotal(usage);
      if (cost > 0) {
        totalCost += cost;
        costByModel.set(modelKey, (costByModel.get(modelKey) ?? 0) + cost);
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  if (!startedAt) return null;
  return {
    filePath,
    startedAt,
    dayKeyLocal: toLocalDayKey(startedAt),
    cwd,
    dow: DOW_NAMES[mondayIndex(startedAt)],
    tod: todBucketForHour(startedAt.getHours()),
    modelsUsed,
    messages,
    tokens,
    totalCost,
    costByModel,
    messagesByModel,
    tokensByModel,
  };
}
