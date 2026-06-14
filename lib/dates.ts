/**
 * Date helpers for the recipes feature.
 *
 * The household cooks Sunday → Thursday, so each "week" is anchored to its
 * Sunday. All dates are handled in the user's local timezone — we never use
 * UTC for week boundaries (cooking days don't shift across time zones for a
 * household).
 *
 * Week boundary: the active cooking week advances at Friday 00:00 local
 * time. Before that (Sun–Thu) "this week" means the current calendar
 * week's Sunday; on Fri–Sat it means the UPCOMING Sunday — i.e. once
 * Thursday cooking ends, the view skips the dead weekend and points at
 * next week's slots so adds land where the user expects.
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

/**
 * Sunday anchor for the "active" cooking week. On Sun–Thu this is the
 * current calendar week's Sunday; on Fri/Sat it skips ahead to next
 * Sunday so "this week" always has at least one cooking day still ahead.
 */
export function weekStartFor(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  if (dow >= 5) {
    // Fri/Sat — current cooking week is done. Advance to next Sunday.
    d.setDate(d.getDate() + (7 - dow));
  } else {
    // Sun–Thu — back up to this week's Sunday.
    d.setDate(d.getDate() - dow);
  }
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
