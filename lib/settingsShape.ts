/**
 * Server-side shape checking for the `household_settings` rows.
 *
 * These rows are read back by every housemate's client, which parses them
 * optimistically — a junk value written once (a rent share sent as "xxxx",
 * a utility amount sent as -50) breaks hydration for everyone until someone
 * edits the row by hand. So the write side is the gate: a value either has
 * the exact shape `lib/monthlyBills.ts` parses, or it is rejected with a
 * message naming the field.
 *
 * Every validator returns a rebuilt value, so nothing outside the known
 * shape is ever persisted.
 */

import { ValidationError } from "./errors";
import { MEAL_GROUP_KEY, isBuyer } from "./types";

export const ALLOWED_SETTING_KEYS = [
  "recurring_fixed",
  "recurring_variable",
  "rent_alloc",
  MEAL_GROUP_KEY,
] as const;

export function isAllowedSettingKey(key: string): boolean {
  return (ALLOWED_SETTING_KEYS as readonly string[]).includes(key);
}

// Money is stored in whole cents. The ceiling is Postgres' int4 max, which
// every other amount in the app already respects.
const MAX_CENTS = 2_147_483_647;
const MAX_TEXT = 120;

function fail(field: string, detail: string): never {
  throw new ValidationError(`${field} ${detail}`);
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(field, "must be an object");
  }
  return value as Record<string, unknown>;
}

/**
 * A setting whose value is an object of known halves, all of them required.
 *
 * Defaulting a missing half to empty is what made a foreign body dangerous:
 * `PUT /api/settings/rent_alloc` with somebody else's JSON answered 200 and
 * rebuilt the row as `{ schedule: [], overrides: {} }`, wiping every share
 * the household had entered. A body that isn't the shape we store — a half
 * missing, or a key we don't know — is refused instead, so the row can only
 * be emptied by a client that means it.
 */
function asWholeSetting(
  value: unknown,
  field: string,
  keys: readonly string[]
): Record<string, unknown> {
  const obj = asObject(value, field);
  for (const key of Object.keys(obj)) {
    if (!keys.includes(key)) fail(`${field}.${key}`, "is not a known field");
  }
  for (const key of keys) {
    if (obj[key] === undefined) fail(`${field}.${key}`, "is required");
  }
  return obj;
}

// These values are stored as JSON, and Postgres refuses a jsonb document
// containing U+0000 outright (SQLSTATE 22021) — an opaque 500 for what is
// really a bad paste. The other C0 controls are dropped with it; tab and
// newline are left alone.
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

function asText(value: unknown, field: string): string {
  if (typeof value !== "string") fail(field, "must be text");
  const trimmed = value.replace(CONTROL_CHARS, "").trim();
  if (!trimmed) fail(field, "is required");
  if (trimmed.length > MAX_TEXT) {
    fail(field, `is too long (max ${MAX_TEXT} characters)`);
  }
  return trimmed;
}

function asMonthKey(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) {
    fail(field, "must be a month like 2026-05");
  }
  const month = Number(value.slice(5));
  if (month < 1 || month > 12) fail(field, "must be a month like 2026-05");
  return value;
}

function asCents(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(field, "must be a whole number of cents");
  }
  if (value < 0) fail(field, "cannot be negative");
  if (value > MAX_CENTS) fail(field, "is too large");
  return value;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") fail(field, "must be true or false");
  return value;
}

/**
 * `{ name: cents }` — one person's share of a bill.
 *
 * `membersOnly` is for the maps whose keys really are people: settlement
 * ignores a name it doesn't recognise, so a typo there would quietly drop
 * someone's rent share, exactly the way an unknown `paidBy` would skew a
 * month. The variable-bill amounts are keyed by line name instead, so they
 * are left open.
 */
function asAllocMap(
  value: unknown,
  field: string,
  membersOnly = false
): Record<string, number> {
  const obj = asObject(value, field);
  const out: Record<string, number> = {};
  for (const [name, cents] of Object.entries(obj)) {
    const person = asText(name, `${field} name`);
    if (membersOnly && !isBuyer(person)) {
      fail(`${field} name "${person}"`, "is not a household member");
    }
    out[person] = asCents(cents, `${field}.${person}`);
  }
  return out;
}

type ScheduleEntry = { from: string; cents: number };

function asFixedSchedule(value: unknown, field: string): ScheduleEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(field, "must be an array");
  return value.map((entry, i) => {
    const e = asObject(entry, `${field}[${i}]`);
    return {
      from: asMonthKey(e.from, `${field}[${i}].from`),
      cents: asCents(e.cents, `${field}[${i}].cents`),
    };
  });
}

function asCentsByMonth(value: unknown, field: string): Record<string, number> {
  if (value === undefined) return {};
  const obj = asObject(value, field);
  const out: Record<string, number> = {};
  for (const [month, cents] of Object.entries(obj)) {
    asMonthKey(month, `${field} key "${month}"`);
    out[month] = asCents(cents, `${field}["${month}"]`);
  }
  return out;
}

/** Someone who pays a bill outright; "" / absent means "nobody in particular". */
function asPayer(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const name = asText(value, field);
  // Settlement silently ignores a payer it does not recognise, so an unknown
  // name has to be refused here rather than quietly skewing the month.
  if (!isBuyer(name)) fail(field, "is not a household member");
  return name;
}

type FixedSetting = {
  id: string;
  name: string;
  protected?: boolean;
  activeFrom?: string;
  inactiveFrom?: string;
  paidBy?: string;
  schedule: ScheduleEntry[];
  overrides: Record<string, number>;
};

function validateRecurringFixed(value: unknown): FixedSetting[] {
  if (!Array.isArray(value)) fail("recurring_fixed", "must be an array");
  return value.map((entry, i) => {
    const field = `recurring_fixed[${i}]`;
    const e = asObject(entry, field);
    const row: FixedSetting = {
      id: asText(e.id, `${field}.id`),
      name: asText(e.name, `${field}.name`),
      schedule: asFixedSchedule(e.schedule, `${field}.schedule`),
      overrides: asCentsByMonth(e.overrides, `${field}.overrides`),
    };
    if (e.protected !== undefined) {
      row.protected = asBoolean(e.protected, `${field}.protected`);
    }
    if (e.activeFrom !== undefined) {
      row.activeFrom = asMonthKey(e.activeFrom, `${field}.activeFrom`);
    }
    if (e.inactiveFrom !== undefined) {
      row.inactiveFrom = asMonthKey(e.inactiveFrom, `${field}.inactiveFrom`);
    }
    const paidBy = asPayer(e.paidBy, `${field}.paidBy`);
    if (paidBy) row.paidBy = paidBy;
    return row;
  });
}

type VariableLine = {
  id: string;
  name: string;
  protected?: boolean;
  activeFrom?: string;
  inactiveFrom?: string;
};

type VariableSetting = {
  lines: VariableLine[];
  amounts: Record<string, Record<string, number>>;
};

function validateRecurringVariable(value: unknown): VariableSetting {
  const o = asWholeSetting(value, "recurring_variable", ["lines", "amounts"]);
  const linesRaw = o.lines;
  if (!Array.isArray(linesRaw)) fail("recurring_variable.lines", "must be an array");
  const lines = linesRaw.map((entry, i) => {
    const field = `recurring_variable.lines[${i}]`;
    const e = asObject(entry, field);
    const line: VariableLine = {
      id: asText(e.id, `${field}.id`),
      name: asText(e.name, `${field}.name`),
    };
    if (e.protected !== undefined) {
      line.protected = asBoolean(e.protected, `${field}.protected`);
    }
    if (e.activeFrom !== undefined) {
      line.activeFrom = asMonthKey(e.activeFrom, `${field}.activeFrom`);
    }
    if (e.inactiveFrom !== undefined) {
      line.inactiveFrom = asMonthKey(e.inactiveFrom, `${field}.inactiveFrom`);
    }
    return line;
  });

  const amountsObj = asObject(o.amounts, "recurring_variable.amounts");
  const amounts: Record<string, Record<string, number>> = {};
  for (const [month, bucket] of Object.entries(amountsObj)) {
    asMonthKey(month, `recurring_variable.amounts key "${month}"`);
    amounts[month] = asAllocMap(
      bucket,
      `recurring_variable.amounts["${month}"]`
    );
  }
  return { lines, amounts };
}

type RentSetting = {
  schedule: Array<{ from: string; alloc: Record<string, number> }>;
  overrides: Record<string, Record<string, number>>;
};

function validateRentAlloc(value: unknown): RentSetting {
  const o = asWholeSetting(value, "rent_alloc", ["schedule", "overrides"]);
  const scheduleRaw = o.schedule;
  if (!Array.isArray(scheduleRaw)) fail("rent_alloc.schedule", "must be an array");
  const schedule = scheduleRaw.map((entry, i) => {
    const field = `rent_alloc.schedule[${i}]`;
    const e = asObject(entry, field);
    return {
      from: asMonthKey(e.from, `${field}.from`),
      alloc: asAllocMap(e.alloc, `${field}.alloc`, true),
    };
  });

  const overridesObj = asObject(o.overrides, "rent_alloc.overrides");
  const overrides: Record<string, Record<string, number>> = {};
  for (const [month, alloc] of Object.entries(overridesObj)) {
    asMonthKey(month, `rent_alloc.overrides key "${month}"`);
    overrides[month] = asAllocMap(
      alloc,
      `rent_alloc.overrides["${month}"]`,
      true
    );
  }
  return { schedule, overrides };
}

/**
 * The meal group is read back by the allocation validator, so it is stored
 * in a fixed shape: { members: string[] } with only real household members.
 */
function validateMealGroup(value: unknown): { members: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(
      "meal_group must be an object like { members: [...] }"
    );
  }
  const raw = (value as { members?: unknown }).members ?? [];
  // A non-array `members` used to be accepted and stored as an empty list,
  // which silently wiped the meal group instead of refusing the write.
  if (!Array.isArray(raw)) {
    throw new ValidationError("meal_group.members must be an array of names");
  }
  const members = raw.map((m) => String(m ?? "").trim()).filter(isBuyer);
  return { members: [...new Set(members)] };
}

/**
 * Validates one setting write and returns the value to store. Throws a
 * ValidationError naming the offending field when the shape is wrong.
 */
export function validateSettingValue(key: string, value: unknown): unknown {
  switch (key) {
    case "recurring_fixed":
      return validateRecurringFixed(value);
    case "recurring_variable":
      return validateRecurringVariable(value);
    case "rent_alloc":
      return validateRentAlloc(value);
    case MEAL_GROUP_KEY:
      return validateMealGroup(value);
    default:
      throw new ValidationError(`unknown setting key: ${key}`);
  }
}
