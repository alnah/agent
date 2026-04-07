/**
 * Session breakdown extension.
 *
 * Registers `/usage`, computes recent session usage statistics, and
 * renders them either as an interactive TUI or a short non-interactive summary.
 */

import os from "node:os";
import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { BorderedLoader } from "@mariozechner/pi-coding-agent";
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
import { BreakdownComponent, rangeSummary } from "./rendering.ts";

export type {
  BreakdownData,
  BreakdownProgressPhase,
  BreakdownProgressState,
  BreakdownView,
  DayAgg,
  MeasurementMode,
  RangeAgg,
} from "./aggregation.ts";
export type {
  CwdKey,
  ModelKey,
  ParsedSession,
} from "./parsing.ts";
export {
  addSessionToRange,
  BreakdownComponent,
  buildBreakdownData,
  buildRangeAgg,
  parseSessionFile,
  rangeSummary,
  walkSessionFiles,
};

const SESSION_ROOT = path.join(os.homedir(), ".pi", "agent", "sessions");

/**
 * Updates a bordered loader message even though the inner loader is not exposed.
 */
function setBorderedLoaderMessage(loader: BorderedLoader, message: string) {
  const inner = (
    loader as unknown as {
      loader?: { setMessage?: (nextMessage: string) => void };
    }
  ).loader;
  if (inner && typeof inner.setMessage === "function") {
    inner.setMessage(message);
  }
}

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

export default function sessionBreakdownExtension(pi: ExtensionAPI) {
  pi.registerCommand("usage", {
    description:
      "Interactive breakdown of last 7/30/90 days of ~/.pi session usage (sessions/messages/tokens + cost by model)",
    handler: async (_args, ctx: ExtensionContext) => {
      if (!ctx.hasUI) {
        const data = await computeBreakdown(undefined);
        const range = requireRange(data.ranges, 30);
        pi.sendMessage(
          {
            customType: "usage",
            content: `Session breakdown (non-interactive)\n${rangeSummary(range, 30, "sessions")}`,
            display: true,
          },
          { triggerTurn: false },
        );
        return;
      }

      let aborted = false;
      const data = await ctx.ui.custom<BreakdownData | null>(
        (tui, theme, _kb, done) => {
          const baseMessage = "Analyzing sessions (last 90 days)…";
          const loader = new BorderedLoader(tui, theme, baseMessage);

          const startedAt = Date.now();
          const progress: BreakdownProgressState = {
            phase: "scan",
            foundFiles: 0,
            parsedFiles: 0,
            totalFiles: 0,
            currentFile: undefined,
          };

          const renderMessage = (): string => {
            const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
            if (progress.phase === "scan") {
              return `${baseMessage}  scanning (${progress.foundFiles.toLocaleString("en-US")} files) · ${elapsed}s`;
            }
            if (progress.phase === "parse") {
              return `${baseMessage}  parsing (${progress.parsedFiles.toLocaleString("en-US")}/${progress.totalFiles.toLocaleString("en-US")}) · ${elapsed}s`;
            }
            return `${baseMessage}  finalizing · ${elapsed}s`;
          };

          let intervalId: NodeJS.Timeout | null = null;
          const stopTicker = () => {
            if (intervalId) {
              clearInterval(intervalId);
              intervalId = null;
            }
          };

          setBorderedLoaderMessage(loader, renderMessage());
          intervalId = setInterval(() => {
            setBorderedLoaderMessage(loader, renderMessage());
          }, 500);

          loader.onAbort = () => {
            aborted = true;
            stopTicker();
            done(null);
          };

          computeBreakdown(loader.signal, (update) =>
            Object.assign(progress, update),
          )
            .then((result) => {
              stopTicker();
              if (!aborted) done(result);
            })
            .catch((error) => {
              stopTicker();
              console.error(
                "usage: failed to analyze sessions",
                error,
              );
              if (!aborted) done(null);
            });

          return loader;
        },
      );

      if (!data) {
        ctx.ui.notify(
          aborted ? "Cancelled" : "Failed to analyze sessions",
          aborted ? "info" : "error",
        );
        return;
      }

      await ctx.ui.custom<void>((tui, _theme, _kb, done) => {
        return new BreakdownComponent(data, tui, done);
      });
    },
  });
}
