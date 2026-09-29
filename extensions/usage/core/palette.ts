/**
 * Session breakdown colors and palette selection.
 *
 * Defines the fixed palette data and the color-mixing helpers used by the
 * calendar graph and legends.
 */

import type { RangeAgg } from "./aggregation.ts";
import {
  DOW_NAMES,
  type DowKey,
  TOD_BUCKETS,
  type TodKey,
} from "./calendar.ts";
import type { CwdKey, ModelKey } from "./parsing.ts";

/**
 * RGB color triple used by the graph renderer.
 */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

export const DEFAULT_BG: RGB = { r: 13, g: 17, b: 23 };
export const EMPTY_CELL_BG: RGB = { r: 22, g: 27, b: 34 };

const PALETTE: RGB[] = [
  { r: 64, g: 196, b: 99 },
  { r: 47, g: 129, b: 247 },
  { r: 163, g: 113, b: 247 },
  { r: 255, g: 159, b: 10 },
  { r: 244, g: 67, b: 54 },
];

const DOW_PALETTE: RGB[] = [
  { r: 47, g: 129, b: 247 },
  { r: 64, g: 196, b: 99 },
  { r: 163, g: 113, b: 247 },
  { r: 47, g: 175, b: 200 },
  { r: 100, g: 200, b: 150 },
  { r: 255, g: 159, b: 10 },
  { r: 244, g: 67, b: 54 },
];

const TOD_PALETTE: Map<TodKey, RGB> = new Map([
  ["after-midnight", { r: 100, g: 60, b: 180 }],
  ["morning", { r: 255, g: 200, b: 50 }],
  ["afternoon", { r: 64, g: 196, b: 99 }],
  ["evening", { r: 47, g: 129, b: 247 }],
  ["night", { r: 60, g: 40, b: 140 }],
]);

/**
 * Clamps a ratio into the `[0, 1]` range.
 */
export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Linearly interpolates between two numbers.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Linearly interpolates between two RGB colors.
 */
export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return {
    r: Math.round(lerp(a.r, b.r, t)),
    g: Math.round(lerp(a.g, b.g, t)),
    b: Math.round(lerp(a.b, b.b, t)),
  };
}

/**
 * Computes a weighted average of RGB colors.
 */
export function weightedMix(
  colors: Array<{ color: RGB; weight: number }>,
): RGB {
  let total = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const entry of colors) {
    if (!Number.isFinite(entry.weight) || entry.weight <= 0) continue;
    total += entry.weight;
    r += entry.color.r * entry.weight;
    g += entry.color.g * entry.weight;
    b += entry.color.b * entry.weight;
  }
  if (total <= 0) return EMPTY_CELL_BG;
  return {
    r: Math.round(r / total),
    g: Math.round(g / total),
    b: Math.round(b / total),
  };
}

/**
 * Sorts a numeric map in descending value order.
 */
function sortMapByValueDesc<K extends string>(
  map: Map<K, number>,
): Array<{ key: K; value: number }> {
  return [...map.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Chooses the top model palette from the last 30 days.
 *
 * Cost dominates when available, then tokens, then messages, then sessions.
 */
export function choosePaletteFromLast30Days(
  range30: RangeAgg,
  topN = 4,
): {
  modelColors: Map<ModelKey, RGB>;
  otherColor: RGB;
  orderedModels: ModelKey[];
} {
  const costSum = [...range30.modelCost.values()].reduce((a, b) => a + b, 0);
  const popularity =
    costSum > 0
      ? range30.modelCost
      : range30.totalTokens > 0
        ? range30.modelTokens
        : range30.totalMessages > 0
          ? range30.modelMessages
          : range30.modelSessions;

  const sorted = sortMapByValueDesc(popularity);
  const orderedModels = sorted.slice(0, topN).map((entry) => entry.key);
  const modelColors = new Map<ModelKey, RGB>();
  for (let i = 0; i < orderedModels.length; i++) {
    modelColors.set(orderedModels[i], PALETTE[i % PALETTE.length]);
  }
  return {
    modelColors,
    otherColor: { r: 160, g: 160, b: 160 },
    orderedModels,
  };
}

/**
 * Chooses the top working-directory palette from the last 30 days.
 */
export function chooseCwdPaletteFromLast30Days(
  range30: RangeAgg,
  topN = 4,
): {
  cwdColors: Map<CwdKey, RGB>;
  otherColor: RGB;
  orderedCwds: CwdKey[];
} {
  const costSum = [...range30.cwdCost.values()].reduce((a, b) => a + b, 0);
  const popularity =
    costSum > 0
      ? range30.cwdCost
      : range30.totalTokens > 0
        ? range30.cwdTokens
        : range30.totalMessages > 0
          ? range30.cwdMessages
          : range30.cwdSessions;

  const sorted = sortMapByValueDesc(popularity);
  const orderedCwds = sorted.slice(0, topN).map((entry) => entry.key);
  const cwdColors = new Map<CwdKey, RGB>();
  for (let i = 0; i < orderedCwds.length; i++) {
    cwdColors.set(orderedCwds[i], PALETTE[i % PALETTE.length]);
  }
  return {
    cwdColors,
    otherColor: { r: 160, g: 160, b: 160 },
    orderedCwds,
  };
}

/**
 * Builds the fixed weekday palette.
 */
export function buildDowPalette(): {
  dowColors: Map<DowKey, RGB>;
  orderedDows: DowKey[];
} {
  const dowColors = new Map<DowKey, RGB>();
  for (let i = 0; i < DOW_NAMES.length; i++) {
    dowColors.set(DOW_NAMES[i], DOW_PALETTE[i]);
  }
  return { dowColors, orderedDows: [...DOW_NAMES] };
}

/**
 * Builds the fixed time-of-day palette.
 */
export function buildTodPalette(): {
  todColors: Map<TodKey, RGB>;
  orderedTods: TodKey[];
} {
  const todColors = new Map<TodKey, RGB>();
  const orderedTods: TodKey[] = [];
  for (const bucket of TOD_BUCKETS) {
    const color = TOD_PALETTE.get(bucket.key);
    if (color) todColors.set(bucket.key, color);
    orderedTods.push(bucket.key);
  }
  return { todColors, orderedTods };
}
