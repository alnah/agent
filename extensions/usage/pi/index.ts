/**
 * Session breakdown extension.
 *
 * Registers `/usage`, computes recent session usage statistics, and
 * renders them either as an interactive TUI or a short non-interactive summary.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";
import {
  type BreakdownData,
  type BreakdownProgressState,
  requireRange,
} from "../core/aggregation.ts";
import { computeBreakdown } from "../core/breakdown.ts";
import { BreakdownComponent, rangeSummary } from "./rendering.ts";

export type {
  BreakdownData,
  BreakdownProgressPhase,
  BreakdownProgressState,
  BreakdownView,
  DayAgg,
  MeasurementMode,
  RangeAgg,
} from "../core/aggregation.ts";
export {
  addSessionToRange,
  buildBreakdownData,
  buildRangeAgg,
} from "../core/aggregation.ts";
export { computeBreakdown } from "../core/breakdown.ts";
export type {
  CwdKey,
  ModelKey,
  ParsedSession,
} from "../core/parsing.ts";
export { parseSessionFile, walkSessionFiles } from "../core/parsing.ts";
export { BreakdownComponent, rangeSummary } from "./rendering.ts";

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
              console.error("usage: failed to analyze sessions", error);
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
