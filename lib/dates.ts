/**
 * Date helpers for the recipes feature.
 *
 * The household cooks Sunday through Thursday, so each "week" is anchored to
 * its Sunday. Week boundaries are evaluated in the household timezone, not the
 * server or browser timezone. This matters on Vercel: Thursday evening in
 * Toronto is already Friday in UTC, but the current cooking week should not
 * roll forward until midnight in Toronto.
 *
 * Week boundary: the active cooking week advances at Friday 00:00 household
 * time. Before that (Sun-Thu) "this week" means the current calendar week's
 * Sunday; on Fri-Sat it means the upcoming Sunday. Once Thursday cooking ends,
 * the view skips the dead weekend and points at next week's slots so adds land
 * where the user expects.
 */

const DEFAULT_HOUSEHOLD_TIME_ZONE = "America/Toronto";

export const HOUSEHOLD_TIME_ZONE =
  process.env.NEXT_PUBLIC_HOUSEHOLD_TIME_ZONE || DEFAULT_HOUSEHOLD_TIME_ZONE;

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

type DateParts = {
  year: number;
  month: number;
  day: number;
};

type DateTimeParts = DateParts & {
  hour: number;
  minute: number;
  second: number;
};

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = dateFormatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  dateFormatters.set(timeZone, formatter);
  return formatter;
}

function dateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = dateTimeFormatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  });
  dateTimeFormatters.set(timeZone, formatter);
  return formatter;
}

function numberPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes
): number {
  const raw = parts.find((p) => p.type === type)?.value;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Could not read ${type} for ${HOUSEHOLD_TIME_ZONE}`);
  }
  return value;
}

function zonedDateParts(
  date: Date,
  timeZone = HOUSEHOLD_TIME_ZONE
): DateParts {
  const parts = dateFormatter(timeZone).formatToParts(date);
  return {
    year: numberPart(parts, "year"),
    month: numberPart(parts, "month"),
    day: numberPart(parts, "day"),
  };
}

function zonedDateTimeParts(
  date: Date,
  timeZone = HOUSEHOLD_TIME_ZONE
): DateTimeParts {
  const parts = dateTimeFormatter(timeZone).formatToParts(date);
  return {
    year: numberPart(parts, "year"),
    month: numberPart(parts, "month"),
    day: numberPart(parts, "day"),
    hour: numberPart(parts, "hour"),
    minute: numberPart(parts, "minute"),
    second: numberPart(parts, "second"),
  };
}

function ymdFromParts(parts: DateParts): string {
  const y = String(parts.year).padStart(4, "0");
  const m = String(parts.month).padStart(2, "0");
  const d = String(parts.day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysToParts(parts: DateParts, n: number): DateParts {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + n));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function dayOfWeek(parts: DateParts): number {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function weekStartPartsFor(
  date: Date,
  timeZone = HOUSEHOLD_TIME_ZONE
): DateParts {
  const parts = zonedDateParts(date, timeZone);
  const dow = dayOfWeek(parts);
  return addDaysToParts(parts, dow >= 5 ? 7 - dow : -dow);
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedDateTimeParts(date, timeZone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return localAsUtc - (date.getTime() - date.getMilliseconds());
}

function zonedMidnightUtc(parts: DateParts, timeZone: string): Date {
  const localMidnightAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  let instant = new Date(localMidnightAsUtc);

  // Refine because the UTC offset at the first guess can differ around DST.
  for (let i = 0; i < 3; i += 1) {
    instant = new Date(localMidnightAsUtc - timeZoneOffsetMs(instant, timeZone));
  }
  return instant;
}

export function parseYmd(s: string): Date {
  // Avoid Date(s) UTC parsing surprises - construct in local time.
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Sunday anchor for the "active" cooking week in the household timezone. On
 * Sun-Thu this is the current calendar week's Sunday; on Fri/Sat it skips
 * ahead to next Sunday so "this week" always has at least one cooking day
 * still ahead.
 */
export function weekStartFor(
  date: Date,
  timeZone = HOUSEHOLD_TIME_ZONE
): Date {
  const parts = weekStartPartsFor(date, timeZone);
  return new Date(parts.year, parts.month - 1, parts.day);
}

export function thisWeekStart(now: Date = new Date()): string {
  return ymdFromParts(weekStartPartsFor(now));
}

export function nextWeekStart(now: Date = new Date()): string {
  return ymdFromParts(addDaysToParts(weekStartPartsFor(now), 7));
}

/**
 * Milliseconds from `now` until the next household-timezone midnight. Used by
 * the recipes view to schedule a single re-render at 00:00 so "this week" /
 * "next week" roll forward without requiring a page refresh.
 */
export function msUntilNextLocalMidnight(now: Date = new Date()): number {
  const tomorrow = addDaysToParts(zonedDateParts(now), 1);
  const next = zonedMidnightUtc(tomorrow, HOUSEHOLD_TIME_ZONE);
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
