"use client";

/**
 * Shared monthly-bill state: the recurring fixed bills, the variable
 * utilities and the per-person rent allocations that the monthly breakdown
 * edits and the settlement math consumes.
 *
 * Extracted from `components/MonthlyBreakdown.tsx` so the fresh UI can read
 * the exact same numbers without re-implementing the schedule/override
 * rules or duplicating the editor. `useMonthlyBills` owns the loading and
 * the writing for both editors, so the two views cannot disagree about what
 * a month costs.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { sharedCents } from "./allocations";
import { getSetting, putSetting } from "./client";
import { currentExpenseMonth, FIRST_EXPENSE_MONTH } from "./expenseMonths";
import { computeSettlement, type Settlement, type SettlementBill } from "./settlement";
import { parseCents } from "./money";
import { titleCaseName } from "./normalize";
import {
  BUYERS,
  isBuyer,
  type Expense,
  type ExpenseAllocation,
} from "./types";


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
    // Replace this month's entry, keep every other one. Trimming everything
    // from `month` onwards would throw away the increases already scheduled
    // for later months, which the editor gives no way to get back.
    const schedule = bill.schedule
      .filter((s) => s.from !== month)
      .concat({ from: month, cents })
      .sort((a, b) => a.from.localeCompare(b.from));
    return { ...bill, schedule };
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
    // Same rule as `setBillAmount`: this month's entry is replaced, later
    // ones survive.
    const schedule = state.schedule
      .filter((s) => s.from !== month)
      .concat({ from: month, alloc })
      .sort((a, b) => a.from.localeCompare(b.from));
    return { ...state, schedule };
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

/* ---------- The editable store both month views share ---------- */

export type MonthlyBillsStore = MonthlyBills & {
  /** True until the backend row has been read (or has failed to read). */
  loading: boolean;
  persistFixed: (next: FixedRecurring[]) => void;
  persistVariable: (next: VariableState) => void;
  persistRent: (next: RentState) => void;
};

/**
 * Loads the shared bill state and hands back writers for it.
 *
 * localStorage is a write-through cache so the first paint is instant; the
 * `household_settings` row is the source of truth so every housemate and
 * every device sees the same numbers. When the backend row is still empty
 * but this device has real data, the device's data is pushed up once as a
 * migration. "Trivial" means nothing beyond the protected mainstay
 * scaffold, and it is checked both ways so an empty row can never clobber a
 * device's saved bills.
 */
export function useMonthlyBills(
  onToast: (msg: string) => void
): MonthlyBillsStore {
  const [fixed, setFixed] = useState<FixedRecurring[]>([]);
  const [variable, setVariable] = useState<VariableState>(() => emptyVariable());
  const [rent, setRent] = useState<RentState>({ schedule: [], overrides: {} });
  const [loading, setLoading] = useState(true);
  // Suppress backend pushes triggered by the mount-time hydration. Without
  // this, hydrating from the backend would echo the same value back as a PUT.
  const hydratedRef = useRef(false);
  // Persisting must not re-run the mount effect, so the toast sink is read
  // through a ref rather than closed over.
  const toastRef = useRef(onToast);
  toastRef.current = onToast;

  useEffect(() => {
    let cancelled = false;

    const lsFixed = sortFixed(loadFixed());
    const lsVariable = loadVariable();
    const lsRent = loadRent();
    setFixed(lsFixed);
    setVariable(lsVariable);
    setRent(lsRent);
    try {
      window.localStorage.setItem(LS_FIXED_V3, JSON.stringify(lsFixed));
      window.localStorage.setItem(LS_VARIABLE_V3, JSON.stringify(lsVariable));
    } catch {
      /* ignore */
    }

    function migrate(key: string, value: unknown, label: string) {
      putSetting(key, value).catch((err) => {
        console.warn(`[settings] migrate ${label} failed`, err);
      });
    }

    Promise.all([
      getSetting<FixedRecurring[]>(BE_FIXED).catch(() => null),
      getSetting<unknown>(BE_VARIABLE).catch(() => null),
      getSetting<RentState>(BE_RENT).catch(() => null),
    ]).then(([beFixed, beVariable, beRent]) => {
      if (cancelled) return;

      const parsedFixed = Array.isArray(beFixed)
        ? beFixed
            .map(parseFixedEntry)
            .filter((x): x is FixedRecurring => x !== null)
        : null;
      if (parsedFixed && !isFixedTrivial(parsedFixed)) {
        const merged = sortFixed(mergeProtected(parsedFixed));
        setFixed(merged);
        try {
          window.localStorage.setItem(LS_FIXED_V3, JSON.stringify(merged));
        } catch {
          /* ignore */
        }
      } else if (!isFixedTrivial(lsFixed)) {
        migrate(BE_FIXED, lsFixed, "recurring_fixed");
      }

      const parsedVariable =
        beVariable && typeof beVariable === "object"
          ? parseVariableState(beVariable)
          : null;
      if (parsedVariable && !isVariableTrivial(parsedVariable)) {
        setVariable(parsedVariable);
        try {
          window.localStorage.setItem(
            LS_VARIABLE_V3,
            JSON.stringify(parsedVariable)
          );
        } catch {
          /* ignore */
        }
      } else if (!isVariableTrivial(lsVariable)) {
        migrate(BE_VARIABLE, lsVariable, "recurring_variable");
      }

      const parsedRent =
        beRent && typeof beRent === "object" ? (beRent as RentState) : null;
      if (parsedRent && !isRentTrivial(parsedRent)) {
        setRent(parsedRent);
        try {
          window.localStorage.setItem(LS_RENT_V1, JSON.stringify(parsedRent));
        } catch {
          /* ignore */
        }
      } else if (!isRentTrivial(lsRent)) {
        migrate(BE_RENT, lsRent, "rent_alloc");
      }

      hydratedRef.current = true;
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function push(key: string, value: unknown, label: string) {
    if (!hydratedRef.current) return; // mount-time setState, not a real edit
    putSetting(key, value).catch((err) => {
      console.warn(`[settings] push ${key} failed`, err);
      toastRef.current(`Couldn't sync ${label}, saved locally only`);
    });
  }

  function cache(key: string, value: unknown, failure: string) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      toastRef.current(failure);
    }
  }

  return {
    fixed,
    variable,
    rent,
    loading,
    persistFixed(next) {
      const sorted = sortFixed(next);
      setFixed(sorted);
      cache(LS_FIXED_V3, sorted, "Couldn't save recurring bills");
      push(BE_FIXED, sorted, "recurring bills");
    },
    persistVariable(next) {
      const normalized = normalizeVariableState(next);
      setVariable(normalized);
      cache(LS_VARIABLE_V3, normalized, "Couldn't save utility amounts");
      push(BE_VARIABLE, normalized, "utility amounts");
    },
    persistRent(next) {
      setRent(next);
      cache(LS_RENT_V1, next, "Couldn't save rent allocations");
      push(BE_RENT, next, "rent allocations");
    },
  };
}

/* ---------- The month view model both breakdowns render ---------- */

export type MonthTrip = {
  id: string;
  occurredOn: string;
  description: string;
  amount: number;
  allocations: ExpenseAllocation[];
  receiptUrl: string;
  receiptFileId: string;
  receiptMime: string;
  /** True when the receipt is an image the app can show inline. */
  canPreview: boolean;
};

export type MonthStoreGroup = {
  store: string;
  total: number;
  trips: MonthTrip[];
};

export type MonthlyBreakdownView = {
  month: string;
  setMonth: (month: string) => void;
  currentMonth: string;
  isCurrentMonth: boolean;
  monthLocked: boolean;
  canEditMonth: boolean;
  canGoPrev: boolean;
  goPrev: () => void;
  goNext: () => void;

  oneTime: {
    rows: MonthStoreGroup[];
    /** Face value of the month's receipts, personal lines included. */
    total: number;
    /** What the household is actually settling: personal lines excluded. */
    sharedTotal: number;
    count: number;
    inMonth: Expense[];
  };

  rent: {
    alloc: RentAlloc;
    total: number;
    overridden: boolean;
    /** null or a non-positive amount clears that person's share. */
    commitFor: (name: string, cents: number | null) => void;
    clearOverride: () => void;
  };

  fixed: {
    rows: FixedRecurring[];
    total: number;
    amountFor: (bill: FixedRecurring) => number;
    isOverridden: (bill: FixedRecurring) => boolean;
    commitAmount: (id: string, cents: number | null) => void;
    clearOverride: (id: string) => void;
    /** True when the row was added; false means a toast explained why not. */
    add: (name: string, amountText: string) => boolean;
    remove: (id: string) => void;
  };

  variable: {
    rows: VariableRecurring[];
    total: number;
    amountFor: (line: VariableRecurring) => number | undefined;
    setAmount: (name: string, cents: number | null) => void;
    add: (name: string, amountText: string) => boolean;
    remove: (id: string) => void;
  };

  settlement: Settlement;
  grandTotal: number;
};

/**
 * Everything a month view shows and everything it can change, in one place.
 *
 * Both the classic breakdown and the fresh month screen render this, so a
 * schedule rule, an override rule or a total can never mean one thing on one
 * screen and something else on the other.
 */
export function useMonthlyBreakdown(
  expenses: readonly Expense[],
  onToast: (msg: string) => void,
  store: MonthlyBillsStore
): MonthlyBreakdownView {
  // `currentExpenseMonth` reads the household timezone, so the month money
  // is filed under is the month the recipe weeks agree it is.
  const [month, setMonth] = useState<string>(() => currentExpenseMonth());
  const currentMonth = currentExpenseMonth();
  const isCurrentMonth = month === currentMonth;
  const monthLocked = month < currentMonth;
  const canEditMonth = !monthLocked;
  const canGoPrev = month > FIRST_EXPENSE_MONTH;

  const { fixed, variable, rent, persistFixed, persistVariable, persistRent } =
    store;

  /* ---- One-time: group by store, list each trip underneath ---- */

  const oneTime = useMemo(() => {
    const inMonth = expensesInMonth(expenses, month);
    const buckets = new Map<string, MonthStoreGroup>();
    let total = 0;
    let sharedTotal = 0;
    for (const e of inMonth) {
      const rawStore = (e.store || "").trim();
      const storeName = rawStore ? titleCaseName(rawStore) : "Unspecified";
      const key = storeName.toLowerCase();
      const receiptMime = e.receiptMime || "";
      const trip: MonthTrip = {
        id: e.id,
        occurredOn: e.occurredOn || e.added || "",
        description: (e.description || "").trim(),
        amount: e.amountCents,
        allocations: e.allocations ?? [],
        receiptUrl: e.receiptUrl || "",
        receiptFileId: e.receiptFileId || "",
        receiptMime,
        canPreview: Boolean(
          e.receiptUrl && e.receiptFileId && receiptMime.startsWith("image/")
        ),
      };
      const existing = buckets.get(key);
      if (existing) {
        existing.total += e.amountCents;
        existing.trips.push(trip);
      } else {
        buckets.set(key, {
          store: storeName,
          total: e.amountCents,
          trips: [trip],
        });
      }
      total += e.amountCents;
      sharedTotal += sharedCents(trip.allocations);
    }
    for (const g of buckets.values()) {
      // Most recent trip first, larger amount breaking a same-day tie.
      g.trips.sort((a, b) => {
        if (a.occurredOn !== b.occurredOn) {
          return a.occurredOn < b.occurredOn ? 1 : -1;
        }
        return b.amount - a.amount;
      });
    }
    const rows = Array.from(buckets.values()).sort((a, b) => b.total - a.total);
    return { rows, total, sharedTotal, count: inMonth.length, inMonth };
  }, [expenses, month]);

  /* ---- Rent ---- */

  const monthRent = useMemo(() => rentForMonth(rent, month), [rent, month]);
  const rentTotal = useMemo(
    () => BUYERS.reduce((s, name) => s + (monthRent[name] ?? 0), 0),
    [monthRent]
  );
  const rentOverridden = hasRentOverride(rent, month);

  /* ---- Recurring ---- */

  const fixedForMonth = useMemo(
    () => fixed.filter((r) => activeForMonth(r, month)),
    [fixed, month]
  );
  const fixedTotal = useMemo(
    () => fixedForMonth.reduce((s, r) => s + amountForMonth(r, month), 0),
    [fixedForMonth, month]
  );

  const monthVariable = variable.amounts[month] ?? {};
  const variableLines = useMemo(
    () => variable.lines.filter((line) => activeForMonth(line, month)),
    [variable.lines, month]
  );
  const variableTotal = variableLines.reduce(
    (s, line) => s + (monthVariable[line.name] ?? 0),
    0
  );

  const settlement = useMemo(
    () =>
      computeSettlement({
        members: BUYERS,
        expenses: oneTime.inMonth.map((e) => ({
          paidBy: e.paidBy,
          amountCents: e.amountCents,
          allocations: e.allocations ?? [],
        })),
        bills: settlementBills(fixed, variable, month),
        rent: monthRent,
      }),
    [oneTime, fixed, variable, month, monthRent]
  );

  return {
    month,
    setMonth,
    currentMonth,
    isCurrentMonth,
    monthLocked,
    canEditMonth,
    canGoPrev,
    goPrev() {
      if (canGoPrev) setMonth(shiftMonth(month, -1));
    },
    goNext() {
      setMonth(shiftMonth(month, +1));
    },

    oneTime,

    rent: {
      alloc: monthRent,
      total: rentTotal,
      overridden: rentOverridden,
      commitFor(name, cents) {
        if (monthLocked) return;
        const nextAlloc: RentAlloc = { ...monthRent };
        if (cents === null || cents <= 0) delete nextAlloc[name];
        else nextAlloc[name] = cents;
        persistRent(setRentAlloc(rent, month, currentMonth, nextAlloc));
      },
      clearOverride() {
        if (monthLocked || !rentOverridden) return;
        persistRent(clearRentOverride(rent, month));
      },
    },

    fixed: {
      rows: fixedForMonth,
      total: fixedTotal,
      amountFor: (bill) => amountForMonth(bill, month),
      isOverridden: (bill) => hasOverride(bill, month),
      commitAmount(id, cents) {
        if (monthLocked) return;
        // A negative amount is dropped by the settlement math but would still
        // be counted in this section's header, so the parts would stop adding
        // up to the total. Refuse it instead.
        if (cents !== null && cents < 0) {
          onToast("Amount must be greater than $0");
          return;
        }
        persistFixed(
          fixed.map((r) =>
            r.id === id ? setBillAmount(r, month, currentMonth, cents ?? 0) : r
          )
        );
      },
      clearOverride(id) {
        if (monthLocked) return;
        persistFixed(
          fixed.map((r) => (r.id === id ? clearBillOverride(r, month) : r))
        );
      },
      add(rawName, amountText) {
        if (!canEditMonth) return false;
        const name = titleCaseName(rawName);
        const cents = parseCents(amountText);
        if (!name) {
          onToast("Name required");
          return false;
        }
        if (cents === null || cents <= 0) {
          onToast("Amount must be greater than $0");
          return false;
        }
        if (
          fixedForMonth.some((r) => r.name.toLowerCase() === name.toLowerCase())
        ) {
          onToast(name + " is already active this month");
          return false;
        }
        persistFixed([
          ...fixed,
          {
            id: makeRecurringId("fixed", name),
            name,
            activeFrom: month,
            schedule: [{ from: month, cents }],
            overrides: {},
          },
        ]);
        return true;
      },
      remove(id) {
        if (!canEditMonth) return;
        const row = fixed.find((r) => r.id === id);
        if (!row || row.protected) return;
        // A row that only ever ran from this month forward is deleted; an
        // older one is retired so past months keep their history.
        if ((row.activeFrom || FIRST_EXPENSE_MONTH) >= month) {
          persistFixed(fixed.filter((r) => r.id !== id));
          return;
        }
        persistFixed(
          fixed.map((r) => (r.id === id ? { ...r, inactiveFrom: month } : r))
        );
      },
    },

    variable: {
      rows: variableLines,
      total: variableTotal,
      amountFor: (line) => monthVariable[line.name],
      setAmount(name, cents) {
        if (monthLocked) return;
        if (cents !== null && cents < 0) {
          onToast("Amount must be greater than $0");
          return;
        }
        const nextAmounts: VariableMap = { ...variable.amounts };
        const bucket = { ...(nextAmounts[month] ?? {}) };
        if (cents === null) delete bucket[name];
        else bucket[name] = cents;
        if (Object.keys(bucket).length === 0) delete nextAmounts[month];
        else nextAmounts[month] = bucket;
        persistVariable({ ...variable, amounts: nextAmounts });
      },
      add(rawName, amountText) {
        if (!canEditMonth) return false;
        const name = titleCaseName(rawName);
        if (!name) {
          onToast("Name required");
          return false;
        }
        if (
          variableLines.some(
            (line) => line.name.toLowerCase() === name.toLowerCase()
          )
        ) {
          onToast(name + " is already active this month");
          return false;
        }
        let nextAmounts = variable.amounts;
        const trimmed = amountText.trim();
        if (trimmed) {
          const cents = parseCents(trimmed);
          if (cents === null || cents <= 0) {
            onToast("Amount must be greater than $0");
            return false;
          }
          nextAmounts = {
            ...variable.amounts,
            [month]: { ...(variable.amounts[month] ?? {}), [name]: cents },
          };
        }
        persistVariable({
          lines: [
            ...variable.lines,
            { id: makeRecurringId("variable", name), name, activeFrom: month },
          ],
          amounts: nextAmounts,
        });
        return true;
      },
      remove(id) {
        if (!canEditMonth) return;
        const line = variable.lines.find((r) => r.id === id);
        if (!line || line.protected) return;
        if ((line.activeFrom || FIRST_EXPENSE_MONTH) >= month) {
          persistVariable({
            ...variable,
            lines: variable.lines.filter((r) => r.id !== id),
          });
          return;
        }
        persistVariable({
          ...variable,
          lines: variable.lines.map((r) =>
            r.id === id ? { ...r, inactiveFrom: month } : r
          ),
        });
      },
    },

    settlement,
    grandTotal: settlement.grand,
  };
}
