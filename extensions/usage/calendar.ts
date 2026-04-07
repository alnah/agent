/**
 * Session breakdown calendar helpers.
 *
 * Defines the day/time buckets and local-date helpers shared by parsing,
 * aggregation, palette selection, and rendering.
 */

export type DowKey = string;
export type TodKey = string;

export const DOW_NAMES: DowKey[] = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
];

export const TOD_BUCKETS: {
  key: TodKey;
  label: string;
  from: number;
  to: number;
}[] = [
  { key: "after-midnight", label: "After midnight (0–5)", from: 0, to: 5 },
  { key: "morning", label: "Morning (6–11)", from: 6, to: 11 },
  { key: "afternoon", label: "Afternoon (12–16)", from: 12, to: 16 },
  { key: "evening", label: "Evening (17–21)", from: 17, to: 21 },
  { key: "night", label: "Night (22–23)", from: 22, to: 23 },
];

/**
 * Maps a local hour to the configured time-of-day bucket.
 */
export function todBucketForHour(hour: number): TodKey {
  for (const bucket of TOD_BUCKETS) {
    if (hour >= bucket.from && hour <= bucket.to) return bucket.key;
  }
  return "after-midnight";
}

/**
 * Returns the display label for a time-of-day bucket.
 */
export function todBucketLabel(key: TodKey): string {
  return TOD_BUCKETS.find((bucket) => bucket.key === key)?.label ?? key;
}

/**
 * Formats a local date as `YYYY-MM-DD`.
 */
export function toLocalDayKey(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Returns local midnight for the given date.
 */
export function localMidnight(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0,
  );
}

/**
 * Adds whole local calendar days without using UTC math.
 */
export function addDaysLocal(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * Counts calendar days inclusively in local time.
 *
 * This avoids millisecond-based day math so DST transitions do not skew the
 * week-grid calculations.
 */
export function countDaysInclusiveLocal(start: Date, end: Date): number {
  let count = 0;
  for (let date = new Date(start); date <= end; date = addDaysLocal(date, 1)) {
    count++;
  }
  return count;
}

/**
 * Returns the weekday index in Monday-first order.
 */
export function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}
