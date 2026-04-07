/**
 * Session breakdown rendering.
 *
 * Renders the interactive calendar graph, legends, and summary tables for the
 * session breakdown command.
 */

import os from "node:os";
import {
  type Component,
  Key,
  matchesKey,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui";
import {
  type BreakdownData,
  type BreakdownView,
  type DayAgg,
  type MeasurementMode,
  RANGE_DAYS,
  type RangeAgg,
} from "./aggregation.ts";
import {
  addDaysLocal,
  countDaysInclusiveLocal,
  DOW_NAMES,
  mondayIndex,
  TOD_BUCKETS,
  todBucketLabel,
  toLocalDayKey,
} from "./calendar.ts";
import {
  clamp01,
  DEFAULT_BG,
  EMPTY_CELL_BG,
  mixRgb,
  type RGB,
  weightedMix,
} from "./palette.ts";

/**
 * Wraps text in a 24-bit ANSI background color.
 */
function _ansiBg(rgb: RGB, text: string): string {
  return `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m${text}\x1b[0m`;
}

/**
 * Wraps text in a 24-bit ANSI foreground color.
 */
function ansiFg(rgb: RGB, text: string): string {
  return `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m${text}\x1b[0m`;
}

/**
 * Renders dim ANSI text.
 */
function dim(text: string): string {
  return `\x1b[2m${text}\x1b[0m`;
}

/**
 * Renders bold ANSI text.
 */
function bold(text: string): string {
  return `\x1b[1m${text}\x1b[0m`;
}

/**
 * Formats counts for compact table cells.
 */
function formatCount(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("en-US");
}

/**
 * Formats USD with small-value precision.
 */
function formatUsd(cost: number): string {
  if (!Number.isFinite(cost)) return "$0.00";
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost >= 0.1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(4)}`;
}

/**
 * Abbreviates a path for narrow legends and tables.
 */
function abbreviatePath(pathValue: string, maxWidth = 40): string {
  const home = os.homedir();
  let display = pathValue;
  if (display.startsWith(home)) {
    display = `~${display.slice(home.length)}`;
  }
  if (display.length <= maxWidth) return display;

  const parts = display.split("/").filter(Boolean);
  if (parts.length <= 2) return display;

  const prefix = parts[0];
  for (let keep = parts.length - 1; keep >= 1; keep--) {
    const tail = parts.slice(parts.length - keep);
    const candidate = `${prefix}/…/${tail.join("/")}`;
    if (candidate.length <= maxWidth || keep === 1) return candidate;
  }
  return display;
}

/**
 * Pads a string on the right using plain character width.
 */
function padRight(value: string, width: number): string {
  const delta = width - value.length;
  return delta > 0 ? value + " ".repeat(delta) : value;
}

/**
 * Pads a string on the left using plain character width.
 */
function padLeft(value: string, width: number): string {
  const delta = width - value.length;
  return delta > 0 ? " ".repeat(delta) + value : value;
}

/**
 * Returns the display name of a `provider/model` key.
 */
function displayModelName(modelKey: string): string {
  const slashIndex = modelKey.indexOf("/");
  return slashIndex === -1 ? modelKey : modelKey.slice(slashIndex + 1);
}

/**
 * Chooses the active graph metric for the selected range and mode.
 *
 * Token mode falls back to messages or sessions when token usage is absent.
 */
function graphMetricForRange(
  range: RangeAgg,
  mode: MeasurementMode,
): { kind: "sessions" | "messages" | "tokens"; max: number; denom: number } {
  if (mode === "tokens") {
    const maxTokens = Math.max(0, ...range.days.map((day) => day.tokens));
    if (maxTokens > 0) {
      return {
        kind: "tokens",
        max: maxTokens,
        denom: Math.log1p(maxTokens),
      };
    }
    mode = "messages";
  }

  if (mode === "messages") {
    const maxMessages = Math.max(0, ...range.days.map((day) => day.messages));
    if (maxMessages > 0) {
      return {
        kind: "messages",
        max: maxMessages,
        denom: Math.log1p(maxMessages),
      };
    }
    mode = "sessions";
  }

  const maxSessions = Math.max(0, ...range.days.map((day) => day.sessions));
  return {
    kind: "sessions",
    max: maxSessions,
    denom: Math.log1p(maxSessions),
  };
}

/**
 * Returns how many week columns the current range needs.
 */
function weeksForRange(range: RangeAgg): number {
  const start = range.days[0].date;
  const end = range.days[range.days.length - 1].date;
  const gridStart = addDaysLocal(start, -mondayIndex(start));
  const gridEnd = addDaysLocal(end, 6 - mondayIndex(end));
  const totalGridDays = countDaysInclusiveLocal(gridStart, gridEnd);
  return Math.ceil(totalGridDays / 7);
}

/**
 * Chooses the mixed hue used for one calendar cell.
 */
function dayMixedColor(
  day: DayAgg,
  colorMap: Map<string, RGB>,
  otherColor: RGB,
  mode: MeasurementMode,
  view: BreakdownView,
): RGB {
  const parts: Array<{ color: RGB; weight: number }> = [];
  let otherWeight = 0;

  let map: Map<string, number>;
  if (view === "dow") {
    const dowKey = DOW_NAMES[mondayIndex(day.date)];
    const color = colorMap.get(dowKey);
    return color ?? otherColor;
  }

  if (view === "tod") {
    map =
      mode === "tokens"
        ? day.tokens > 0
          ? day.tokensByTod
          : day.messages > 0
            ? day.messagesByTod
            : day.sessionsByTod
        : mode === "messages"
          ? day.messages > 0
            ? day.messagesByTod
            : day.sessionsByTod
          : day.sessionsByTod;
  } else if (view === "cwd") {
    map =
      mode === "tokens"
        ? day.tokens > 0
          ? day.tokensByCwd
          : day.messages > 0
            ? day.messagesByCwd
            : day.sessionsByCwd
        : mode === "messages"
          ? day.messages > 0
            ? day.messagesByCwd
            : day.sessionsByCwd
          : day.sessionsByCwd;
  } else {
    map =
      mode === "tokens"
        ? day.tokens > 0
          ? day.tokensByModel
          : day.messages > 0
            ? day.messagesByModel
            : day.sessionsByModel
        : mode === "messages"
          ? day.messages > 0
            ? day.messagesByModel
            : day.sessionsByModel
          : day.sessionsByModel;
  }

  for (const [key, weight] of map.entries()) {
    const color = colorMap.get(key);
    if (color) parts.push({ color, weight });
    else otherWeight += weight;
  }
  if (otherWeight > 0) parts.push({ color: otherColor, weight: otherWeight });
  return weightedMix(parts);
}

/**
 * Renders the GitHub-style calendar graph for model/cwd/tod views.
 */
function renderGraphLines(
  range: RangeAgg,
  colorMap: Map<string, RGB>,
  otherColor: RGB,
  mode: MeasurementMode,
  options?: { cellWidth?: number; gap?: number },
  view: BreakdownView = "model",
): string[] {
  const start = range.days[0].date;
  const end = range.days[range.days.length - 1].date;

  const gridStart = addDaysLocal(start, -mondayIndex(start));
  const gridEnd = addDaysLocal(end, 6 - mondayIndex(end));
  const totalGridDays = countDaysInclusiveLocal(gridStart, gridEnd);
  const weeks = Math.ceil(totalGridDays / 7);

  const cellWidth = Math.max(1, Math.floor(options?.cellWidth ?? 1));
  const gap = Math.max(0, Math.floor(options?.gap ?? 1));
  const block = "█".repeat(cellWidth);
  const gapStr = " ".repeat(gap);

  const metric = graphMetricForRange(range, mode);
  const denom = metric.denom;

  const labelByRow = new Map<number, string>([
    [0, "Mon"],
    [2, "Wed"],
    [4, "Fri"],
  ]);

  const lines: string[] = [];
  for (let row = 0; row < 7; row++) {
    const label = labelByRow.get(row);
    let line = label ? `${padRight(label, 3)} ` : "    ";

    for (let week = 0; week < weeks; week++) {
      const cellDate = addDaysLocal(gridStart, week * 7 + row);
      const inRange = cellDate >= start && cellDate <= end;
      const colGap = week < weeks - 1 ? gapStr : "";
      if (!inRange) {
        line += " ".repeat(cellWidth) + colGap;
        continue;
      }

      const key = toLocalDayKey(cellDate);
      const day = range.dayByKey.get(key);
      const value =
        metric.kind === "tokens"
          ? (day?.tokens ?? 0)
          : metric.kind === "messages"
            ? (day?.messages ?? 0)
            : (day?.sessions ?? 0);

      if (!day || value <= 0) {
        line += ansiFg(EMPTY_CELL_BG, block) + colGap;
        continue;
      }

      const hue = dayMixedColor(day, colorMap, otherColor, mode, view);
      let intensity = denom > 0 ? Math.log1p(value) / denom : 0;
      intensity = clamp01(intensity);
      const minVisible = 0.2;
      const scaled = minVisible + (1 - minVisible) * intensity;
      const rgb = mixRgb(DEFAULT_BG, hue, scaled);
      line += ansiFg(rgb, block) + colGap;
    }

    lines.push(line);
  }

  return lines;
}

/**
 * Renders the per-model summary table.
 */
function renderModelTable(
  range: RangeAgg,
  mode: MeasurementMode,
  maxRows = 8,
): string[] {
  const metric = graphMetricForRange(range, mode);
  const kind = metric.kind;

  let perModel: Map<string, number>;
  let total = 0;
  const label = kind;

  if (kind === "tokens") {
    perModel = range.modelTokens;
    total = range.totalTokens;
  } else if (kind === "messages") {
    perModel = range.modelMessages;
    total = range.totalMessages;
  } else {
    perModel = range.modelSessions;
    total = range.sessions;
  }

  const rows = [...perModel.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, maxRows);

  const valueWidth = kind === "tokens" ? 10 : 8;
  const modelWidth = Math.min(
    52,
    Math.max("model".length, ...rows.map((row) => row.key.length)),
  );

  const lines: string[] = [];
  lines.push(
    `${padRight("model", modelWidth)}  ${padLeft(label, valueWidth)}  ${padLeft("cost", 10)}  ${padLeft("share", 6)}`,
  );
  lines.push(
    `${"-".repeat(modelWidth)}  ${"-".repeat(valueWidth)}  ${"-".repeat(10)}  ${"-".repeat(6)}`,
  );

  for (const row of rows) {
    const value = perModel.get(row.key) ?? 0;
    const cost = range.modelCost.get(row.key) ?? 0;
    const share = total > 0 ? `${Math.round((value / total) * 100)}%` : "0%";
    lines.push(
      `${padRight(row.key.slice(0, modelWidth), modelWidth)}  ${padLeft(formatCount(value), valueWidth)}  ${padLeft(formatUsd(cost), 10)}  ${padLeft(share, 6)}`,
    );
  }

  if (rows.length === 0) {
    lines.push(dim("(no model data found)"));
  }

  return lines;
}

/**
 * Renders the per-directory summary table.
 */
function renderCwdTable(
  range: RangeAgg,
  mode: MeasurementMode,
  maxRows = 8,
): string[] {
  const metric = graphMetricForRange(range, mode);
  const kind = metric.kind;

  let perCwd: Map<string, number>;
  let total = 0;
  const label = kind;

  if (kind === "tokens") {
    perCwd = range.cwdTokens;
    total = range.totalTokens;
  } else if (kind === "messages") {
    perCwd = range.cwdMessages;
    total = range.totalMessages;
  } else {
    perCwd = range.cwdSessions;
    total = range.sessions;
  }

  const rows = [...perCwd.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, maxRows);
  const displayPaths = rows.map((row) => abbreviatePath(row.key, 40));

  const valueWidth = kind === "tokens" ? 10 : 8;
  const cwdWidth = Math.min(
    42,
    Math.max(
      "directory".length,
      ...displayPaths.map((pathValue) => pathValue.length),
    ),
  );

  const lines: string[] = [];
  lines.push(
    `${padRight("directory", cwdWidth)}  ${padLeft(label, valueWidth)}  ${padLeft("cost", 10)}  ${padLeft("share", 6)}`,
  );
  lines.push(
    `${"-".repeat(cwdWidth)}  ${"-".repeat(valueWidth)}  ${"-".repeat(10)}  ${"-".repeat(6)}`,
  );

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const value = perCwd.get(row.key) ?? 0;
    const cost = range.cwdCost.get(row.key) ?? 0;
    const share = total > 0 ? `${Math.round((value / total) * 100)}%` : "0%";
    lines.push(
      `${padRight(displayPaths[i].slice(0, cwdWidth), cwdWidth)}  ${padLeft(formatCount(value), valueWidth)}  ${padLeft(formatUsd(cost), 10)}  ${padLeft(share, 6)}`,
    );
  }

  if (rows.length === 0) {
    lines.push(dim("(no directory data found)"));
  }

  return lines;
}

/**
 * Chooses the weekday metric map for the active view.
 */
function dowMetricForRange(
  range: RangeAgg,
  mode: MeasurementMode,
): {
  kind: "sessions" | "messages" | "tokens";
  perDow: Map<string, number>;
  total: number;
} {
  const metric = graphMetricForRange(range, mode);
  if (metric.kind === "tokens") {
    return {
      kind: metric.kind,
      perDow: range.dowTokens,
      total: range.totalTokens,
    };
  }
  if (metric.kind === "messages") {
    return {
      kind: metric.kind,
      perDow: range.dowMessages,
      total: range.totalMessages,
    };
  }
  return {
    kind: metric.kind,
    perDow: range.dowSessions,
    total: range.sessions,
  };
}

/**
 * Renders the weekday share bars used by the DOW view.
 */
function renderDowDistributionLines(
  range: RangeAgg,
  mode: MeasurementMode,
  dowColors: Map<string, RGB>,
  width: number,
): string[] {
  const { kind, perDow, total } = dowMetricForRange(range, mode);
  const dayWidth = 3;
  const pctWidth = 4;
  const valueWidth = kind === "tokens" ? 10 : 8;
  const showValue = width >= dayWidth + 1 + 10 + 1 + pctWidth + 1 + valueWidth;
  const fixedWidth =
    dayWidth + 1 + 1 + pctWidth + (showValue ? 1 + valueWidth : 0);
  const barWidth = Math.max(1, width - fixedWidth);
  const fallbackColor: RGB = { r: 160, g: 160, b: 160 };

  const lines: string[] = [];
  for (const dow of DOW_NAMES) {
    const value = perDow.get(dow) ?? 0;
    const share = total > 0 ? value / total : 0;
    let filled = share > 0 ? Math.round(share * barWidth) : 0;
    if (share > 0) filled = Math.max(1, filled);
    filled = Math.min(barWidth, filled);
    const empty = Math.max(0, barWidth - filled);

    const color = dowColors.get(dow) ?? fallbackColor;
    const filledBar = filled > 0 ? ansiFg(color, "█".repeat(filled)) : "";
    const emptyBar = empty > 0 ? ansiFg(EMPTY_CELL_BG, "█".repeat(empty)) : "";
    const pct = padLeft(`${Math.round(share * 100)}%`, pctWidth);

    let line = `${padRight(dow, dayWidth)} ${filledBar}${emptyBar} ${pct}`;
    if (showValue) line += ` ${padLeft(formatCount(value), valueWidth)}`;
    lines.push(line);
  }

  return lines;
}

/**
 * Renders the weekday summary table.
 */
function renderDowTable(range: RangeAgg, mode: MeasurementMode): string[] {
  const { kind, perDow, total } = dowMetricForRange(range, mode);
  const valueWidth = kind === "tokens" ? 10 : 8;
  const dowWidth = 5;

  const lines: string[] = [];
  lines.push(
    `${padRight("day", dowWidth)}  ${padLeft(kind, valueWidth)}  ${padLeft("cost", 10)}  ${padLeft("share", 6)}`,
  );
  lines.push(
    `${"-".repeat(dowWidth)}  ${"-".repeat(valueWidth)}  ${"-".repeat(10)}  ${"-".repeat(6)}`,
  );

  for (const dow of DOW_NAMES) {
    const value = perDow.get(dow) ?? 0;
    const cost = range.dowCost.get(dow) ?? 0;
    const share = total > 0 ? `${Math.round((value / total) * 100)}%` : "0%";
    lines.push(
      `${padRight(dow, dowWidth)}  ${padLeft(formatCount(value), valueWidth)}  ${padLeft(formatUsd(cost), 10)}  ${padLeft(share, 6)}`,
    );
  }

  return lines;
}

/**
 * Renders the time-of-day summary table.
 */
function renderTodTable(range: RangeAgg, mode: MeasurementMode): string[] {
  const metric = graphMetricForRange(range, mode);
  const kind = metric.kind;

  let perTod: Map<string, number>;
  let total = 0;

  if (kind === "tokens") {
    perTod = range.todTokens;
    total = range.totalTokens;
  } else if (kind === "messages") {
    perTod = range.todMessages;
    total = range.totalMessages;
  } else {
    perTod = range.todSessions;
    total = range.sessions;
  }

  const valueWidth = kind === "tokens" ? 10 : 8;
  const todWidth = 22;

  const lines: string[] = [];
  lines.push(
    `${padRight("time of day", todWidth)}  ${padLeft(kind, valueWidth)}  ${padLeft("cost", 10)}  ${padLeft("share", 6)}`,
  );
  lines.push(
    `${"-".repeat(todWidth)}  ${"-".repeat(valueWidth)}  ${"-".repeat(10)}  ${"-".repeat(6)}`,
  );

  for (const bucket of TOD_BUCKETS) {
    const value = perTod.get(bucket.key) ?? 0;
    const cost = range.todCost.get(bucket.key) ?? 0;
    const share = total > 0 ? `${Math.round((value / total) * 100)}%` : "0%";
    lines.push(
      `${padRight(bucket.label, todWidth)}  ${padLeft(formatCount(value), valueWidth)}  ${padLeft(formatUsd(cost), 10)}  ${padLeft(share, 6)}`,
    );
  }

  return lines;
}

/**
 * Builds the one-line range summary shown above the graph.
 */
export function rangeSummary(
  range: RangeAgg,
  days: number,
  mode: MeasurementMode,
): string {
  const avg = range.sessions > 0 ? range.totalCost / range.sessions : 0;
  const costPart =
    range.totalCost > 0
      ? `${formatUsd(range.totalCost)} · avg ${formatUsd(avg)}/session`
      : `$0.0000`;

  if (mode === "tokens") {
    return `Last ${days} days: ${formatCount(range.sessions)} sessions · ${formatCount(range.totalTokens)} tokens · ${costPart}`;
  }
  if (mode === "messages") {
    return `Last ${days} days: ${formatCount(range.sessions)} sessions · ${formatCount(range.totalMessages)} messages · ${costPart}`;
  }
  return `Last ${days} days: ${formatCount(range.sessions)} sessions · ${costPart}`;
}

/**
 * Interactive TUI component for browsing the computed session breakdown.
 */
export class BreakdownComponent implements Component {
  private data: BreakdownData;
  private tui: TUI;
  private onDone: () => void;
  private rangeIndex = 1;
  private measurement: MeasurementMode = "sessions";
  private view: BreakdownView = "model";
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(data: BreakdownData, tui: TUI, onDone: () => void) {
    this.data = data;
    this.tui = tui;
    this.onDone = onDone;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  handleInput(data: string): void {
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl("c")) ||
      data.toLowerCase() === "q"
    ) {
      this.onDone();
      return;
    }

    if (
      matchesKey(data, Key.tab) ||
      matchesKey(data, Key.shift("tab")) ||
      data.toLowerCase() === "t"
    ) {
      const order: MeasurementMode[] = ["sessions", "messages", "tokens"];
      const idx = Math.max(0, order.indexOf(this.measurement));
      const dir = matchesKey(data, Key.shift("tab")) ? -1 : 1;
      this.measurement =
        order[(idx + order.length + dir) % order.length] ?? "sessions";
      this.invalidate();
      this.tui.requestRender();
      return;
    }

    const prev = () => {
      this.rangeIndex =
        (this.rangeIndex + RANGE_DAYS.length - 1) % RANGE_DAYS.length;
      this.invalidate();
      this.tui.requestRender();
    };
    const next = () => {
      this.rangeIndex = (this.rangeIndex + 1) % RANGE_DAYS.length;
      this.invalidate();
      this.tui.requestRender();
    };

    if (matchesKey(data, Key.left) || data.toLowerCase() === "h") prev();
    if (matchesKey(data, Key.right) || data.toLowerCase() === "l") next();

    if (
      matchesKey(data, Key.up) ||
      matchesKey(data, Key.down) ||
      data.toLowerCase() === "j" ||
      data.toLowerCase() === "k"
    ) {
      const views: BreakdownView[] = ["model", "cwd", "dow", "tod"];
      const idx = views.indexOf(this.view);
      const dir =
        matchesKey(data, Key.up) || data.toLowerCase() === "k" ? -1 : 1;
      this.view = views[(idx + views.length + dir) % views.length] ?? "model";
      this.invalidate();
      this.tui.requestRender();
      return;
    }

    if (data === "1") {
      this.rangeIndex = 0;
      this.invalidate();
      this.tui.requestRender();
    }
    if (data === "2") {
      this.rangeIndex = 1;
      this.invalidate();
      this.tui.requestRender();
    }
    if (data === "3") {
      this.rangeIndex = 2;
      this.invalidate();
      this.tui.requestRender();
    }
  }

  render(width: number): string[] {
    if (this.cachedWidth === width && this.cachedLines) return this.cachedLines;

    const selectedDays = RANGE_DAYS[this.rangeIndex] ?? 30;
    const range = this.data.ranges.get(selectedDays);
    if (!range) {
      throw new Error(`Missing breakdown range for ${selectedDays} days`);
    }
    const metric = graphMetricForRange(range, this.measurement);

    const tab = (days: number, idx: number): string => {
      const selected = idx === this.rangeIndex;
      const label = `${days}d`;
      return selected ? bold(`[${label}]`) : dim(` ${label} `);
    };

    const metricTab = (mode: MeasurementMode, label: string): string => {
      const selected = mode === this.measurement;
      return selected ? bold(`[${label}]`) : dim(` ${label} `);
    };

    const viewTab = (view: BreakdownView, label: string): string => {
      const selected = view === this.view;
      return selected ? bold(`[${label}]`) : dim(` ${label} `);
    };

    const header =
      `${bold("Session breakdown")}  ${tab(7, 0)}${tab(30, 1)}${tab(90, 2)}  ` +
      `${metricTab("sessions", "sess")}${metricTab("messages", "msg")}${metricTab("tokens", "tok")}  ` +
      `${viewTab("model", "model")}${viewTab("cwd", "cwd")}${viewTab("dow", "dow")}${viewTab("tod", "tod")}`;

    let activeColorMap: Map<string, RGB>;
    let activeOtherColor: RGB = { r: 160, g: 160, b: 160 };
    const legendItems: string[] = [];

    if (this.view === "model") {
      activeColorMap = this.data.palette.modelColors;
      activeOtherColor = this.data.palette.otherColor;
      for (const modelKey of this.data.palette.orderedModels) {
        const color = activeColorMap.get(modelKey);
        if (color)
          legendItems.push(
            `${ansiFg(color, "█")} ${displayModelName(modelKey)}`,
          );
      }
      legendItems.push(`${ansiFg(activeOtherColor, "█")} other`);
    } else if (this.view === "cwd") {
      activeColorMap = this.data.cwdPalette.cwdColors;
      activeOtherColor = this.data.cwdPalette.otherColor;
      for (const cwd of this.data.cwdPalette.orderedCwds) {
        const color = activeColorMap.get(cwd);
        if (color)
          legendItems.push(`${ansiFg(color, "█")} ${abbreviatePath(cwd, 30)}`);
      }
      legendItems.push(`${ansiFg(activeOtherColor, "█")} other`);
    } else if (this.view === "dow") {
      activeColorMap = this.data.dowPalette.dowColors;
      for (const dow of this.data.dowPalette.orderedDows) {
        const color = activeColorMap.get(dow);
        if (color) legendItems.push(`${ansiFg(color, "█")} ${dow}`);
      }
    } else {
      activeColorMap = this.data.todPalette.todColors;
      for (const tod of this.data.todPalette.orderedTods) {
        const color = activeColorMap.get(tod);
        if (color)
          legendItems.push(`${ansiFg(color, "█")} ${todBucketLabel(tod)}`);
      }
    }

    const graphDescriptor =
      this.view === "dow"
        ? `share of ${metric.kind} by weekday`
        : `${metric.kind}/day`;
    const summary =
      rangeSummary(range, selectedDays, metric.kind) +
      dim(`   (graph: ${graphDescriptor})`);

    let graphLines: string[];
    if (this.view === "dow") {
      graphLines = renderDowDistributionLines(
        range,
        this.measurement,
        this.data.dowPalette.dowColors,
        width,
      );
    } else {
      const maxScale = selectedDays === 7 ? 4 : selectedDays === 30 ? 3 : 2;
      const weeks = weeksForRange(range);
      const leftMargin = 4;
      const gap = 1;
      const graphArea = Math.max(1, width - leftMargin);
      const idealCellWidth =
        Math.floor((graphArea + gap) / Math.max(1, weeks)) - gap;
      const cellWidth = Math.min(maxScale, Math.max(1, idealCellWidth));

      graphLines = renderGraphLines(
        range,
        activeColorMap,
        activeOtherColor,
        this.measurement,
        { cellWidth, gap },
        this.view,
      );
    }

    const tableLines =
      this.view === "model"
        ? renderModelTable(range, metric.kind, 8)
        : this.view === "cwd"
          ? renderCwdTable(range, metric.kind, 8)
          : this.view === "dow"
            ? renderDowTable(range, metric.kind)
            : renderTodTable(range, metric.kind);

    const lines: string[] = [];
    lines.push(truncateToWidth(header, width));
    lines.push(
      truncateToWidth(
        dim("←/→ range · ↑/↓ view · tab metric · q to close"),
        width,
      ),
    );
    lines.push("");
    lines.push(truncateToWidth(summary, width));
    lines.push("");

    if (this.view === "dow") {
      for (const graphLine of graphLines)
        lines.push(truncateToWidth(graphLine, width));
    } else {
      const graphWidth = Math.max(
        0,
        ...graphLines.map((line) => visibleWidth(line)),
      );
      const sep = 2;
      const legendWidth = width - graphWidth - sep;
      const showSideLegend = legendWidth >= 22;

      if (showSideLegend) {
        const legendBlock: string[] = [];
        const legendTitle =
          this.view === "model"
            ? "Top models (30d palette):"
            : this.view === "cwd"
              ? "Top directories (30d palette):"
              : "Time of day:";
        legendBlock.push(dim(legendTitle));
        legendBlock.push(...legendItems);

        const maxLegendRows = graphLines.length;
        let legendLines = legendBlock.slice(0, maxLegendRows);
        if (legendBlock.length > maxLegendRows) {
          const remaining = legendBlock.length - (maxLegendRows - 1);
          legendLines = [
            ...legendBlock.slice(0, maxLegendRows - 1),
            dim(`+${remaining} more`),
          ];
        }
        while (legendLines.length < graphLines.length) legendLines.push("");

        const padRightAnsi = (value: string, target: number): string => {
          const current = visibleWidth(value);
          return current >= target
            ? value
            : value + " ".repeat(target - current);
        };

        for (let i = 0; i < graphLines.length; i++) {
          const left = padRightAnsi(graphLines[i] ?? "", graphWidth);
          const right = truncateToWidth(
            legendLines[i] ?? "",
            Math.max(0, legendWidth),
          );
          lines.push(truncateToWidth(left + " ".repeat(sep) + right, width));
        }
      } else {
        for (const graphLine of graphLines)
          lines.push(truncateToWidth(graphLine, width));
        lines.push("");
        const legendTitle =
          this.view === "model"
            ? "Top models (30d palette):"
            : this.view === "cwd"
              ? "Top directories (30d palette):"
              : "Time of day:";
        lines.push(truncateToWidth(dim(legendTitle), width));
        for (const item of legendItems)
          lines.push(truncateToWidth(item, width));
      }
    }

    lines.push("");
    for (const tableLine of tableLines)
      lines.push(truncateToWidth(tableLine, width));

    this.cachedWidth = width;
    this.cachedLines = lines.map((line) =>
      visibleWidth(line) > width ? truncateToWidth(line, width) : line,
    );
    return this.cachedLines;
  }
}
