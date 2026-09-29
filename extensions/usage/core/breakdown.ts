import os from "node:os";
import path from "node:path";
import {
  addSessionToRange,
  type BreakdownData,
  type BreakdownProgressState,
  buildBreakdownData,
  buildRangeAgg,
  RANGE_DAYS,
  requireRange,
} from "./aggregation.ts";
import { parseSessionFile, walkSessionFiles } from "./parsing.ts";

/**
 * Resolves Pi's agent directory the same way the runtime does, so a
 * relocated `PI_CODING_AGENT_DIR` also moves the scanned sessions.
 */
function resolveAgentDir(): string {
  const envCandidates = ["PI_CODING_AGENT_DIR", "TAU_CODING_AGENT_DIR"];
  let envDir: string | undefined;
  for (const key of envCandidates) {
    if (process.env[key]) {
      envDir = process.env[key];
      break;
    }
  }
  if (!envDir) {
    for (const [key, value] of Object.entries(process.env)) {
      if (key.endsWith("_CODING_AGENT_DIR") && value) {
        envDir = value;
        break;
      }
    }
  }
  if (envDir) {
    if (envDir === "~") return os.homedir();
    if (envDir.startsWith("~/")) {
      return path.join(os.homedir(), envDir.slice(2));
    }
    return envDir;
  }
  return path.join(os.homedir(), ".pi", "agent");
}

const SESSION_ROOT = path.join(resolveAgentDir(), "sessions");

/**
 * Computes the complete session breakdown for the last 7, 30, and 90 days.
 *
 * Progress updates are emitted in scan/parse/finalize phases so the loader can
 * show live counts during long-running filesystem work.
 */
export async function computeBreakdown(
  signal?: AbortSignal,
  onProgress?: (update: Partial<BreakdownProgressState>) => void,
): Promise<BreakdownData> {
  const now = new Date();
  const ranges = new Map<number, ReturnType<typeof buildRangeAgg>>();
  for (const days of RANGE_DAYS) ranges.set(days, buildRangeAgg(days, now));
  const range90 = requireRange(ranges, 90);
  const start90 = range90.days[0].date;

  onProgress?.({
    phase: "scan",
    foundFiles: 0,
    parsedFiles: 0,
    totalFiles: 0,
    currentFile: undefined,
  });

  const candidates = await walkSessionFiles(
    SESSION_ROOT,
    start90,
    signal,
    (found) => {
      onProgress?.({ phase: "scan", foundFiles: found });
    },
  );

  const totalFiles = candidates.length;
  onProgress?.({
    phase: "parse",
    foundFiles: totalFiles,
    totalFiles,
    parsedFiles: 0,
    currentFile: candidates[0] ? path.basename(candidates[0]) : undefined,
  });

  let parsedFiles = 0;
  for (const filePath of candidates) {
    if (signal?.aborted) break;
    parsedFiles += 1;
    onProgress?.({
      phase: "parse",
      parsedFiles,
      totalFiles,
      currentFile: path.basename(filePath),
    });

    const session = await parseSessionFile(filePath, signal);
    if (!session) continue;

    const sessionDay = new Date(
      session.startedAt.getFullYear(),
      session.startedAt.getMonth(),
      session.startedAt.getDate(),
      0,
      0,
      0,
      0,
    );
    for (const days of RANGE_DAYS) {
      const range = requireRange(ranges, days);
      const start = range.days[0].date;
      const end = range.days[range.days.length - 1].date;
      if (sessionDay < start || sessionDay > end) continue;
      addSessionToRange(range, session);
    }
  }

  onProgress?.({ phase: "finalize", currentFile: undefined });
  return buildBreakdownData(now, ranges);
}
