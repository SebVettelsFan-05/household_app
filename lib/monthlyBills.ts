/**
 * Shared monthly-bill state: the recurring fixed bills, the variable
 * utilities and the per-person rent allocations that the monthly breakdown
 * edits and the settlement math consumes.
 *
 * Extracted from `components/MonthlyBreakdown.tsx` so the fresh UI can read
 * the exact same numbers without re-implementing the schedule/override
 * rules or duplicating the editor.
 */

import { getSetting } from "./client";
import { FIRST_EXPENSE_MONTH } from "./expenseMonths";
import { computeSettlement, type Settlement, type SettlementBill } from "./settlement";
import { BUYERS, isBuyer, type Expense } from "./types";


/* ---------- Types ---------- */

export type ScheduleEntry = { from: string; cents: number };
export type FixedRecurring = {
  id: string;
  name: string;
  protected?: boolean;
  activeFrom?: string;
  inactiveFrom?: string;
  // When set, the bill's full amount is treated as "paid" by this person
  // in the settlement math (the household's Internet convention).
  paidBy?: string;
  schedule: ScheduleEntry[];
  overrides: Record<string, number>;
};
export type VariableMap = Record<string, Record<string, number>>;
export type VariableRecurring = {
  id: string;
  name: string;
  protected?: boolean;
  activeFrom: string;
  inactiveFrom?: string;
};
export type VariableState = {
  lines: VariableRecurring[];
  amounts: VariableMap;
};

export type RentAlloc = Record<string, number>; // name → cents
export type RentAllocSchedule = { from: string; alloc: RentAlloc };
export type RentState = {
  schedule: RentAllocSchedule[];
  overrides: Record<string, RentAlloc>;
};

/* ---------- Storage keys ---------- */

// localStorage keys — kept around as a write-through cache so the first
// paint is instant. Backend (household_settings table) is the source of
// truth so all housemates and fresh devices see the same numbers.
export const LS_FIXED_V3 = "monthly_recurring_fixed_v3";
export const LEGACY_FIXED_KEYS = [
  "monthly_recurring_fixed_v2",
  "monthly_recurring_fixed_v1",
];
export const LS_VARIABLE_V3 = "monthly_recurring_variable_v3";
export const LEGACY_VARIABLE_KEYS = [
  "monthly_recurring_variable_v2",
  "monthly_recurring_variable_v1",
];
export const LS_RENT_V1 = "monthly_rent_alloc_v1";

// Backend keys (household_settings.key). Must match the server allowlist.
export const BE_FIXED = "recurring_fixed";
export const BE_VARIABLE = "recurring_variable";
export const BE_RENT = "rent_alloc";

// Rent used to be a regular protected entry in the fixed list. It's been
// promoted to its own per-person allocation block — filter the legacy id out
// on load so it doesn't linger as an unprotected single-amount line.
export const LEGACY_RENT_ID = "fixed-mainstay-rent";

/* ---------- Protected mainstays ---------- */

export type ProtectedSeed = Pick<FixedRecurring, "id" | "name" | "paidBy">;

export const PROTECTED_FIXED: ProtectedSeed[] = [
  { id: "fixed-mainstay-internet", name: "Internet", paidBy: "Arthur" },
  { id: "fixed-mainstay-rental-insurance", name: "Rental insurance" },
];

export const VARIABLE_SEEDS = ["Gas", "Water", "Electricity"] as const;
export type VariableKey = string;

/* ---------- Month helpers ---------- */

export function ym(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function ymLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return ym(d);
}

/** Validates YYYY-MM keys used by recurring bill schedules. */
export function validMonthKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^\d{4}-\d{2}$/.test(value) ? value : undefined;
}

export function activeForMonth(
  entry: { activeFrom?: string; inactiveFrom?: string },
  month: string
): boolean {
  const from = entry.activeFrom || FIRST_EXPENSE_MONTH;
  if (month < from) return false;
  if (entry.inactiveFrom && month >= entry.inactiveFrom) return false;
  return true;
}

export function makeRecurringId(kind: "fixed" | "variable", name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "row";
  return `${kind}-${Date.now().toString(36)}-${slug}`;
}

/** "2026-06-12" to "Jun 12". Empty string when the input isn't a valid date. */
export function fmtTripDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/* ---------- Fixed-bill load + persist ---------- */

export function emptyProtected(): FixedRecurring[] {
  return PROTECTED_FIXED.map((p) => ({
    id: p.id,
    name: p.name,
    paidBy: p.paidBy,
    protected: true,
    activeFrom: FIRST_EXPENSE_MONTH,
    schedule: [],
    overrides: {},
  }));
}

export function parseFixedEntry(raw: unknown): FixedRecurring | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as {
    id?: unknown;
    name?: unknown;
    protected?: unknown;
    activeFrom?: unknown;
    inactiveFrom?: unknown;
    paidBy?: unknown;
    schedule?: unknown;
    overrides?: unknown;
  };
  if (typeof r.id !== "string" || typeof r.name !== "string") return null;
  return {
    id: r.id,
    name: r.name,
    protected: Boolean(r.protected),
    activeFrom: validMonthKey(r.activeFrom) || FIRST_EXPENSE_MONTH,
    inactiveFrom: validMonthKey(r.inactiveFrom),
    paidBy: typeof r.paidBy === "string" ? r.paidBy : undefined,
    schedule: Array.isArray(r.schedule)
      ? (r.schedule as ScheduleEntry[]).filter(
          (s) =>
            s && typeof s.from === "string" && typeof s.cents === "number"
        )
      : [],
    overrides:
      r.overrides && typeof r.overrides === "object"
        ? (r.overrides as Record<string, number>)
        : {},
  };
}

/** True when the recurring-fixed list has no user-entered amounts in it. */
export function isFixedTrivial(arr: FixedRecurring[]): boolean {
  return arr.every(
    (r) => r.schedule.length === 0 && Object.keys(r.overrides).length === 0
  );
}

/** True when the variable utility state has no user rows or recorded amounts. */
export function isVariableTrivial(v: VariableState): boolean {
  if (v.lines.some((line) => !line.protected)) return false;
  for (const month of Object.values(v.amounts)) {
    for (const cents of Object.values(month)) {
      if (cents && cents > 0) return false;
    }
  }
  return true;
}

/** True when the rent state has no allocation schedule or overrides. */
export function isRentTrivial(r: RentState): boolean {
  return r.schedule.length === 0 && Object.keys(r.overrides).length === 0;
}

/**
 * Drops the legacy rent entry (moved to its own per-person block) and
 * ensures every protected mainstay (Internet, Rental insurance) is present
 * with the correct flags. Pure — safe to call on backend payloads too.
 */
export function mergeProtected(arr: FixedRecurring[]): FixedRecurring[] {
  const next = arr.filter((r) => r.id !== LEGACY_RENT_ID);
  for (const p of PROTECTED_FIXED) {
    const existing = next.find((r) => r.id === p.id);
    if (!existing) {
      next.push({
        id: p.id,
        name: p.name,
        protected: true,
        paidBy: p.paidBy,
        activeFrom: FIRST_EXPENSE_MONTH,
        schedule: [],
        overrides: {},
      });
    } else {
      existing.protected = true;
      existing.name = p.name;
      existing.paidBy = p.paidBy;
      existing.activeFrom = existing.activeFrom || FIRST_EXPENSE_MONTH;
      existing.inactiveFrom = undefined;
      existing.schedule = existing.schedule ?? [];
      existing.overrides = existing.overrides ?? {};
    }
  }
  return next;
}

export function loadFixed(): FixedRecurring[] {
  if (typeof window === "undefined") return emptyProtected();
  for (const key of LEGACY_FIXED_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(LS_FIXED_V3);
  } catch {
    return emptyProtected();
  }
  let arr: FixedRecurring[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        arr = parsed
          .map(parseFixedEntry)
          .filter((x): x is FixedRecurring => x !== null);
      }
    } catch {
      arr = [];
    }
  }
  return mergeProtected(arr);
}

export function seedVariableLines(): VariableRecurring[] {
  return VARIABLE_SEEDS.map((name) => ({
    id: `variable-mainstay-${name.toLowerCase()}`,
    name,
    protected: true,
    activeFrom: FIRST_EXPENSE_MONTH,
  }));
}

export function emptyVariable(): VariableState {
  return { lines: seedVariableLines(), amounts: {} };
}

export function parseVariableLine(raw: unknown): VariableRecurring | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as {
    id?: unknown;
    name?: unknown;
    protected?: unknown;
    activeFrom?: unknown;
    inactiveFrom?: unknown;
  };
  if (typeof r.id !== "string" || typeof r.name !== "string") return null;
  const name = r.name.trim();
  if (!name) return null;
  return {
    id: r.id,
    name,
    protected: Boolean(r.protected),
    activeFrom: validMonthKey(r.activeFrom) || FIRST_EXPENSE_MONTH,
    inactiveFrom: validMonthKey(r.inactiveFrom),
  };
}

export function parseVariableAmounts(raw: unknown): VariableMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: VariableMap = {};
  for (const [month, bucket] of Object.entries(raw as Record<string, unknown>)) {
    if (!validMonthKey(month) || !bucket || typeof bucket !== "object") continue;
    const cleanBucket: Record<string, number> = {};
    for (const [name, cents] of Object.entries(bucket as Record<string, unknown>)) {
      if (typeof cents === "number" && Number.isFinite(cents)) {
        cleanBucket[name] = cents;
      }
    }
    if (Object.keys(cleanBucket).length > 0) out[month] = cleanBucket;
  }
  return out;
}

export function normalizeVariableState(state: VariableState): VariableState {
  const lines: VariableRecurring[] = [];
  const seen = new Set<string>();

  for (const seed of seedVariableLines()) {
    const existing = state.lines.find(
      (l) => l.name.toLowerCase() === seed.name.toLowerCase()
    );
    lines.push({
      ...(existing ?? seed),
      id: seed.id,
      name: seed.name,
      protected: true,
      activeFrom: (existing && existing.activeFrom) || FIRST_EXPENSE_MONTH,
      inactiveFrom: undefined,
    });
    seen.add(seed.name.toLowerCase());
  }

  for (const line of state.lines) {
    const key = line.name.toLowerCase();
    if (seen.has(key)) continue;
    lines.push(line);
    seen.add(key);
  }

  for (const bucket of Object.values(state.amounts)) {
    for (const name of Object.keys(bucket)) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      lines.push({
        id: makeRecurringId("variable", name),
        name,
        activeFrom: FIRST_EXPENSE_MONTH,
      });
      seen.add(key);
    }
  }

  return { lines, amounts: state.amounts };
}

export function parseVariableState(raw: unknown): VariableState {
  if (!raw || typeof raw !== "object") return emptyVariable();
  const maybe = raw as { lines?: unknown; amounts?: unknown };
  if (Array.isArray(maybe.lines)) {
    return normalizeVariableState({
      lines: maybe.lines
        .map(parseVariableLine)
        .filter((x): x is VariableRecurring => x !== null),
      amounts: parseVariableAmounts(maybe.amounts),
    });
  }
  return normalizeVariableState({
    lines: [],
    amounts: parseVariableAmounts(raw),
  });
}

export function loadVariable(): VariableState {
  if (typeof window === "undefined") return emptyVariable();
  try {
    const raw = window.localStorage.getItem(LS_VARIABLE_V3);
    if (raw) return parseVariableState(JSON.parse(raw) as unknown);
    for (const key of LEGACY_VARIABLE_KEYS) {
      const legacy = window.localStorage.getItem(key);
      if (legacy) return parseVariableState(JSON.parse(legacy) as unknown);
    }
    return emptyVariable();
  } catch {
    return emptyVariable();
  }
}

export function loadRent(): RentState {
  const empty: RentState = { schedule: [], overrides: {} };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(LS_RENT_V1);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return empty;
    const r = parsed as { schedule?: unknown; overrides?: unknown };
    const schedule = Array.isArray(r.schedule)
      ? (r.schedule as RentAllocSchedule[]).filter(
          (s) =>
            s &&
            typeof s.from === "string" &&
            s.alloc &&
            typeof s.alloc === "object"
        )
      : [];
    const overrides =
      r.overrides && typeof r.overrides === "object"
        ? (r.overrides as Record<string, RentAlloc>)
        : {};
    return { schedule, overrides };
  } catch {
    return empty;
  }
}

export function sortFixed(rows: FixedRecurring[]): FixedRecurring[] {
  const order = PROTECTED_FIXED.map((p) => p.id);
  const protectedRows = order
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is FixedRecurring => Boolean(r));
  const others = rows.filter((r) => !order.includes(r.id));
  return [...protectedRows, ...others];
}

/* ---------- Resolution helpers ---------- */

/** Resolves `bill`'s amount for the given month. Returns 0 if nothing matches. */
export function amountForMonth(bill: FixedRecurring, month: string): number {
  if (!activeForMonth(bill, month)) return 0;
  if (Object.prototype.hasOwnProperty.call(bill.overrides, month)) {
    return bill.overrides[month];
  }
  let result = 0;
  for (const entry of [...bill.schedule].sort((a, b) =>
    a.from.localeCompare(b.from)
  )) {
    if (entry.from <= month) result = entry.cents;
    else break;
  }
  return result;
}

export function hasOverride(bill: FixedRecurring, month: string): boolean {
  return Object.prototype.hasOwnProperty.call(bill.overrides, month);
}

export function setBillAmount(
  bill: FixedRecurring,
  month: string,
  currentMonth: string,
  cents: number
): FixedRecurring {
  if (month >= currentMonth) {
    const trimmed = bill.schedule.filter((s) => s.from < month);
    trimmed.push({ from: month, cents });
    return { ...bill, schedule: trimmed };
  }
  return {
    ...bill,
    overrides: { ...bill.overrides, [month]: cents },
  };
}

export function clearBillOverride(
  bill: FixedRecurring,
  month: string
): FixedRecurring {
  if (!hasOverride(bill, month)) return bill;
  const next = { ...bill.overrides };
  delete next[month];
  return { ...bill, overrides: next };
}

/** Resolves rent allocations for a month — same schedule/override rules. */
export function rentForMonth(state: RentState, month: string): RentAlloc {
  if (Object.prototype.hasOwnProperty.call(state.overrides, month)) {
    return state.overrides[month];
  }
  let result: RentAlloc = {};
  for (const entry of [...state.schedule].sort((a, b) =>
    a.from.localeCompare(b.from)
  )) {
    if (entry.from <= month) result = entry.alloc;
    else break;
  }
  return result;
}

export function hasRentOverride(state: RentState, month: string): boolean {
  return Object.prototype.hasOwnProperty.call(state.overrides, month);
}

/**
 * Applies a per-person rent edit. The whole alloc map for the month is
 * written together — current/future edits forward-write, past edits go to
 * overrides only. Caller passes the full new alloc map.
 */
export function setRentAlloc(
  state: RentState,
  month: string,
  currentMonth: string,
  alloc: RentAlloc
): RentState {
  if (month >= currentMonth) {
    const trimmed = state.schedule.filter((s) => s.from < month);
    trimmed.push({ from: month, alloc });
    return { ...state, schedule: trimmed };
  }
  return {
    ...state,
    overrides: { ...state.overrides, [month]: alloc },
  };
}

export function clearRentOverride(state: RentState, month: string): RentState {
  if (!hasRentOverride(state, month)) return state;
  const next = { ...state.overrides };
  delete next[month];
  return { ...state, overrides: next };
}
/* ---------- Settlement input assembly ---------- */

/**
 * Recurring bills for `month` in the shape the settlement math wants:
 * split over everyone, with `paidBy` crediting whoever fronted it (the
 * household's Internet convention).
 */
export function settlementBills(
  fixed: readonly FixedRecurring[],
  variable: VariableState,
  month: string
): SettlementBill[] {
  const bills: SettlementBill[] = [];
  for (const r of fixed) {
    const cents = amountForMonth(r, month);
    if (cents <= 0) continue;
    bills.push({
      cents,
      paidBy: r.paidBy && isBuyer(r.paidBy) ? r.paidBy : undefined,
    });
  }
  const amounts = variable.amounts[month] ?? {};
  for (const line of variable.lines) {
    if (!activeForMonth(line, month)) continue;
    const cents = amounts[line.name] ?? 0;
    if (cents > 0) bills.push({ cents });
  }
  return bills;
}

/** Expenses dated inside `month`, by the date the user said it happened. */
export function expensesInMonth(
  expenses: readonly Expense[],
  month: string
): Expense[] {
  return expenses.filter((e) => (e.occurredOn || e.added || "").startsWith(month));
}

export type MonthlyBills = {
  fixed: FixedRecurring[];
  variable: VariableState;
  rent: RentState;
};

/** The whole month folded into send/withdraw lines. */
export function settlementForMonth(
  expenses: readonly Expense[],
  bills: MonthlyBills,
  month: string
): Settlement {
  return computeSettlement({
    members: BUYERS,
    expenses: expensesInMonth(expenses, month).map((e) => ({
      paidBy: e.paidBy,
      amountCents: e.amountCents,
      allocations: e.allocations ?? [],
    })),
    bills: settlementBills(bills.fixed, bills.variable, month),
    rent: rentForMonth(bills.rent, month),
  });
}

/**
 * Read-only load of the shared bill state: the backend row when it holds
 * real data, otherwise whatever this device last cached. Never writes, so
 * it is safe to call from a view that only displays the numbers.
 */
export async function loadMonthlyBills(): Promise<MonthlyBills> {
  const local: MonthlyBills = {
    fixed: sortFixed(loadFixed()),
    variable: loadVariable(),
    rent: loadRent(),
  };

  const [beFixed, beVariable, beRent] = await Promise.all([
    getSetting<FixedRecurring[]>(BE_FIXED).catch(() => null),
    getSetting<unknown>(BE_VARIABLE).catch(() => null),
    getSetting<RentState>(BE_RENT).catch(() => null),
  ]);

  if (Array.isArray(beFixed)) {
    const parsed = beFixed
      .map(parseFixedEntry)
      .filter((x): x is FixedRecurring => x !== null);
    if (!isFixedTrivial(parsed)) local.fixed = sortFixed(mergeProtected(parsed));
  }
  if (beVariable && typeof beVariable === "object") {
    const parsed = parseVariableState(beVariable);
    if (!isVariableTrivial(parsed)) local.variable = parsed;
  }
  if (beRent && typeof beRent === "object") {
    const parsed = beRent as RentState;
    if (!isRentTrivial(parsed)) local.rent = parsed;
  }
  return local;
}
