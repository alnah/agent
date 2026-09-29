/**
 * Session breakdown aggregation.
 *
 * Turns parsed sessions into day/range aggregates and chooses the palette-ready
 * summary structure consumed by rendering.
 */

import {
  addDaysLocal,
  type DowKey,
  localMidnight,
  type TodKey,
  toLocalDayKey,
} from "./calendar.ts";
import {
  buildDowPalette,
  buildTodPalette,
  chooseCwdPaletteFromLast30Days,
  choosePaletteFromLast30Days,
  type RGB,
} from "./palette.ts";
import type { CwdKey, ModelKey, ParsedSession } from "./parsing.ts";

export type BreakdownView = "model" | "cwd" | "dow" | "tod";
export type MeasurementMode = "sessions" | "messages" | "tokens";
export type BreakdownProgressPhase = "scan" | "parse" | "finalize";

/**
 * Progress state shown by the loader while session usage is being analyzed.
 */
export interface BreakdownProgressState {
  phase: BreakdownProgressPhase;
  foundFiles: number;
  parsedFiles: number;
  totalFiles: number;
  currentFile?: string;
}

/**
 * Per-day aggregate used by the calendar graph and summary tables.
 */
export interface DayAgg {
  date: Date;
  dayKeyLocal: string;
  sessions: number;
  messages: number;
  tokens: number;
  totalCost: number;
  costByModel: Map<ModelKey, number>;
  sessionsByModel: Map<ModelKey, number>;
  messagesByModel: Map<ModelKey, number>;
  tokensByModel: Map<ModelKey, number>;
  sessionsByCwd: Map<CwdKey, number>;
  messagesByCwd: Map<CwdKey, number>;
  tokensByCwd: Map<CwdKey, number>;
  costByCwd: Map<CwdKey, number>;
  sessionsByTod: Map<TodKey, number>;
  messagesByTod: Map<TodKey, number>;
  tokensByTod: Map<TodKey, number>;
  costByTod: Map<TodKey, number>;
}

/**
 * Aggregate for one selectable time range.
 */
export interface RangeAgg {
  days: DayAgg[];
  dayByKey: Map<string, DayAgg>;
  sessions: number;
  totalMessages: number;
  totalTokens: number;
  totalCost: number;
  modelCost: Map<ModelKey, number>;
  modelSessions: Map<ModelKey, number>;
  modelMessages: Map<ModelKey, number>;
  modelTokens: Map<ModelKey, number>;
  cwdCost: Map<CwdKey, number>;
  cwdSessions: Map<CwdKey, number>;
  cwdMessages: Map<CwdKey, number>;
  cwdTokens: Map<CwdKey, number>;
  dowCost: Map<DowKey, number>;
  dowSessions: Map<DowKey, number>;
  dowMessages: Map<DowKey, number>;
  dowTokens: Map<DowKey, number>;
  todCost: Map<TodKey, number>;
  todSessions: Map<TodKey, number>;
  todMessages: Map<TodKey, number>;
  todTokens: Map<TodKey, number>;
}

/**
 * Fully computed breakdown payload used by the TUI.
 */
export interface BreakdownData {
  generatedAt: Date;
  ranges: Map<number, RangeAgg>;
  palette: {
    modelColors: Map<ModelKey, RGB>;
    otherColor: RGB;
    orderedModels: ModelKey[];
  };
  cwdPalette: {
    cwdColors: Map<CwdKey, RGB>;
    otherColor: RGB;
    orderedCwds: CwdKey[];
  };
  dowPalette: {
    dowColors: Map<DowKey, RGB>;
    orderedDows: DowKey[];
  };
  todPalette: {
    todColors: Map<TodKey, RGB>;
    orderedTods: TodKey[];
  };
}

export const RANGE_DAYS = [7, 30, 90] as const;

/**
 * Returns one required range aggregate or fails fast on inconsistent state.
 */
export function requireRange(
  ranges: Map<number, RangeAgg>,
  days: number,
): RangeAgg {
  const range = ranges.get(days);
  if (!range) {
    throw new Error(`Missing breakdown range for ${days} days`);
  }
  return range;
}

/**
 * Creates an empty range aggregate covering the last `days` days.
 */
export function buildRangeAgg(days: number, now: Date): RangeAgg {
  const end = localMidnight(now);
  const start = addDaysLocal(end, -(days - 1));
  const outDays: DayAgg[] = [];
  const dayByKey = new Map<string, DayAgg>();

  for (let i = 0; i < days; i++) {
    const date = addDaysLocal(start, i);
    const dayKeyLocal = toLocalDayKey(date);
    const day: DayAgg = {
      date,
      dayKeyLocal,
      sessions: 0,
      messages: 0,
      tokens: 0,
      totalCost: 0,
      costByModel: new Map(),
      sessionsByModel: new Map(),
      messagesByModel: new Map(),
      tokensByModel: new Map(),
      sessionsByCwd: new Map(),
      messagesByCwd: new Map(),
      tokensByCwd: new Map(),
      costByCwd: new Map(),
      sessionsByTod: new Map(),
      messagesByTod: new Map(),
      tokensByTod: new Map(),
      costByTod: new Map(),
    };
    outDays.push(day);
    dayByKey.set(dayKeyLocal, day);
  }

  return {
    days: outDays,
    dayByKey,
    sessions: 0,
    totalMessages: 0,
    totalTokens: 0,
    totalCost: 0,
    modelCost: new Map(),
    modelSessions: new Map(),
    modelMessages: new Map(),
    modelTokens: new Map(),
    cwdCost: new Map(),
    cwdSessions: new Map(),
    cwdMessages: new Map(),
    cwdTokens: new Map(),
    dowCost: new Map(),
    dowSessions: new Map(),
    dowMessages: new Map(),
    dowTokens: new Map(),
    todCost: new Map(),
    todSessions: new Map(),
    todMessages: new Map(),
    todTokens: new Map(),
  };
}

/**
 * Adds one parsed session into a range aggregate.
 */
export function addSessionToRange(
  range: RangeAgg,
  session: ParsedSession,
): void {
  const day = range.dayByKey.get(session.dayKeyLocal);
  if (!day) return;

  range.sessions += 1;
  range.totalMessages += session.messages;
  range.totalTokens += session.tokens;
  range.totalCost += session.totalCost;
  day.sessions += 1;
  day.messages += session.messages;
  day.tokens += session.tokens;
  day.totalCost += session.totalCost;

  for (const modelKey of session.modelsUsed) {
    day.sessionsByModel.set(
      modelKey,
      (day.sessionsByModel.get(modelKey) ?? 0) + 1,
    );
    range.modelSessions.set(
      modelKey,
      (range.modelSessions.get(modelKey) ?? 0) + 1,
    );
  }

  for (const [modelKey, count] of session.messagesByModel.entries()) {
    day.messagesByModel.set(
      modelKey,
      (day.messagesByModel.get(modelKey) ?? 0) + count,
    );
    range.modelMessages.set(
      modelKey,
      (range.modelMessages.get(modelKey) ?? 0) + count,
    );
  }

  for (const [modelKey, count] of session.tokensByModel.entries()) {
    day.tokensByModel.set(
      modelKey,
      (day.tokensByModel.get(modelKey) ?? 0) + count,
    );
    range.modelTokens.set(
      modelKey,
      (range.modelTokens.get(modelKey) ?? 0) + count,
    );
  }

  for (const [modelKey, cost] of session.costByModel.entries()) {
    day.costByModel.set(modelKey, (day.costByModel.get(modelKey) ?? 0) + cost);
    range.modelCost.set(modelKey, (range.modelCost.get(modelKey) ?? 0) + cost);
  }

  const cwd = session.cwd;
  if (cwd) {
    day.sessionsByCwd.set(cwd, (day.sessionsByCwd.get(cwd) ?? 0) + 1);
    range.cwdSessions.set(cwd, (range.cwdSessions.get(cwd) ?? 0) + 1);
    day.messagesByCwd.set(
      cwd,
      (day.messagesByCwd.get(cwd) ?? 0) + session.messages,
    );
    range.cwdMessages.set(
      cwd,
      (range.cwdMessages.get(cwd) ?? 0) + session.messages,
    );
    day.tokensByCwd.set(cwd, (day.tokensByCwd.get(cwd) ?? 0) + session.tokens);
    range.cwdTokens.set(cwd, (range.cwdTokens.get(cwd) ?? 0) + session.tokens);
    day.costByCwd.set(cwd, (day.costByCwd.get(cwd) ?? 0) + session.totalCost);
    range.cwdCost.set(cwd, (range.cwdCost.get(cwd) ?? 0) + session.totalCost);
  }

  const dow = session.dow;
  range.dowSessions.set(dow, (range.dowSessions.get(dow) ?? 0) + 1);
  range.dowMessages.set(
    dow,
    (range.dowMessages.get(dow) ?? 0) + session.messages,
  );
  range.dowTokens.set(dow, (range.dowTokens.get(dow) ?? 0) + session.tokens);
  range.dowCost.set(dow, (range.dowCost.get(dow) ?? 0) + session.totalCost);

  const tod = session.tod;
  day.sessionsByTod.set(tod, (day.sessionsByTod.get(tod) ?? 0) + 1);
  day.messagesByTod.set(
    tod,
    (day.messagesByTod.get(tod) ?? 0) + session.messages,
  );
  day.tokensByTod.set(tod, (day.tokensByTod.get(tod) ?? 0) + session.tokens);
  day.costByTod.set(tod, (day.costByTod.get(tod) ?? 0) + session.totalCost);
  range.todSessions.set(tod, (range.todSessions.get(tod) ?? 0) + 1);
  range.todMessages.set(
    tod,
    (range.todMessages.get(tod) ?? 0) + session.messages,
  );
  range.todTokens.set(tod, (range.todTokens.get(tod) ?? 0) + session.tokens);
  range.todCost.set(tod, (range.todCost.get(tod) ?? 0) + session.totalCost);
}

/**
 * Finalizes the full breakdown payload after range aggregation.
 */
export function buildBreakdownData(
  generatedAt: Date,
  ranges: Map<number, RangeAgg>,
): BreakdownData {
  const range30 = requireRange(ranges, 30);

  return {
    generatedAt,
    ranges,
    palette: choosePaletteFromLast30Days(range30, 4),
    cwdPalette: chooseCwdPaletteFromLast30Days(range30, 4),
    dowPalette: buildDowPalette(),
    todPalette: buildTodPalette(),
  };
}
