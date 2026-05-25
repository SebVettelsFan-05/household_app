/**
 * Date helpers for the recipes feature.
 *
 * The household cooks Sunday → Thursday, so each "week" is anchored to its
 * Sunday. All dates are handled in the user's local timezone — we never use
 * UTC for week boundaries (cooking days don't shift across time zones for a
 * household).
 */

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu"] as const;
export const DAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
] as const;
export const COOKING_DAYS = [0, 1, 2, 3, 4] as const;

export function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseYmd(s: string): Date {
  // Avoid Date(s) UTC parsing surprises — construct in local time.
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** Sunday on or before `date`, at local midnight. */
export function weekStartFor(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function thisWeekStart(now: Date = new Date()): string {
  return ymd(weekStartFor(now));
}

export function nextWeekStart(now: Date = new Date()): string {
  return ymd(addDays(weekStartFor(now), 7));
}

/**
 * Milliseconds from `now` until the next local midnight. Used by the recipes
 * view to schedule a single re-render at 00:00 so "this week" / "next week"
 * roll forward without requiring a page refresh.
 */
export function msUntilNextLocalMidnight(now: Date = new Date()): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  const diff = next.getTime() - now.getTime();
  return diff > 0 ? diff : 1000; // safety: never schedule a zero/negative timeout
}

/** Pretty label like "Sun, May 24". */
export function shortDayLabel(weekStart: string, day: number): string {
  const d = addDays(parseYmd(weekStart), day);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${DAY_NAMES[day]}, ${months[d.getMonth()]} ${d.getDate()}`;
}
