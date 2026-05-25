"use client";

import { useEffect, useMemo, useState } from "react";
import SplitCard, { type SplitLine } from "@/components/SplitCard";
import { fmtMoney, parseCents } from "@/lib/money";
import { titleCaseName } from "@/lib/normalize";
import { BUYERS, type Expense } from "@/lib/types";

/**
 * Monthly breakdown — three editable sections (one-time, recurring fixed,
 * recurring variable) plus a per-person Rent block and a settlement section
 * at the bottom that folds everything into a Send / Withdraw breakdown.
 *
 * Rent is its own thing because each house member owes a different amount
 * (e.g. Arthur $800, Daniel $800, Eli $700, …). We store per-person
 * allocations with the same forward-write schedule + per-month overrides
 * pattern used for the other bills, just keyed by name instead of carrying
 * a single cents value.
 *
 * Internet is folded into the 5-way share pool but recorded as fully paid
 * by Arthur — that's the household convention, so the settlement math
 * gives Arthur credit for the whole amount.
 */

/* ---------- Types ---------- */

type ScheduleEntry = { from: string; cents: number };
type FixedRecurring = {
  id: string;
  name: string;
  protected?: boolean;
  // When set, the bill's full amount is treated as "paid" by this person
  // in the settlement math (the household's Internet convention).
  paidBy?: string;
  schedule: ScheduleEntry[];
  overrides: Record<string, number>;
};
type VariableMap = Record<string, Record<string, number>>;

type RentAlloc = Record<string, number>; // name → cents
type RentAllocSchedule = { from: string; alloc: RentAlloc };
type RentState = {
  schedule: RentAllocSchedule[];
  overrides: Record<string, RentAlloc>;
};

/* ---------- Storage keys ---------- */

const LS_FIXED_V3 = "monthly_recurring_fixed_v3";
const LEGACY_FIXED_KEYS = [
  "monthly_recurring_fixed_v2",
  "monthly_recurring_fixed_v1",
];
const LS_VARIABLE_V2 = "monthly_recurring_variable_v2";
const LEGACY_VARIABLE_KEYS = ["monthly_recurring_variable_v1"];
const LS_RENT_V1 = "monthly_rent_alloc_v1";

// Rent used to be a regular protected entry in the fixed list. It's been
// promoted to its own per-person allocation block — filter the legacy id out
// on load so it doesn't linger as an unprotected single-amount line.
const LEGACY_RENT_ID = "fixed-mainstay-rent";

/* ---------- Protected mainstays ---------- */

type ProtectedSeed = Pick<FixedRecurring, "id" | "name" | "paidBy">;

const PROTECTED_FIXED: ProtectedSeed[] = [
  { id: "fixed-mainstay-internet", name: "Internet", paidBy: "Arthur" },
  { id: "fixed-mainstay-rental-insurance", name: "Rental insurance" },
];

const VARIABLE_KEYS = ["Gas", "Water", "Electricity"] as const;
type VariableKey = (typeof VARIABLE_KEYS)[number];

/* ---------- Month helpers ---------- */

function ym(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function ymLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return ym(d);
}

/* ---------- Fixed-bill load + persist ---------- */

function emptyProtected(): FixedRecurring[] {
  return PROTECTED_FIXED.map((p) => ({
    id: p.id,
    name: p.name,
    paidBy: p.paidBy,
    protected: true,
    schedule: [],
    overrides: {},
  }));
}

function parseFixedEntry(raw: unknown): FixedRecurring | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as {
    id?: unknown;
    name?: unknown;
    protected?: unknown;
    paidBy?: unknown;
    schedule?: unknown;
    overrides?: unknown;
  };
  if (typeof r.id !== "string" || typeof r.name !== "string") return null;
  return {
    id: r.id,
    name: r.name,
    protected: Boolean(r.protected),
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

function loadFixed(): FixedRecurring[] {
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
  // Rent migrated out of the fixed list — drop any stale entry so we don't
  // double-count it against the per-person allocation.
  arr = arr.filter((r) => r.id !== LEGACY_RENT_ID);

  for (const p of PROTECTED_FIXED) {
    const existing = arr.find((r) => r.id === p.id);
    if (!existing) {
      arr.push({
        id: p.id,
        name: p.name,
        protected: true,
        paidBy: p.paidBy,
        schedule: [],
        overrides: {},
      });
    } else {
      existing.protected = true;
      existing.name = p.name;
      existing.paidBy = p.paidBy;
      existing.schedule = existing.schedule ?? [];
      existing.overrides = existing.overrides ?? {};
    }
  }
  return arr;
}

function loadVariable(): VariableMap {
  if (typeof window === "undefined") return {};
  for (const key of LEGACY_VARIABLE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  try {
    const raw = window.localStorage.getItem(LS_VARIABLE_V2);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as VariableMap;
  } catch {
    return {};
  }
}

function loadRent(): RentState {
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

function sortFixed(rows: FixedRecurring[]): FixedRecurring[] {
  const order = PROTECTED_FIXED.map((p) => p.id);
  const protectedRows = order
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is FixedRecurring => Boolean(r));
  const others = rows.filter((r) => !order.includes(r.id));
  return [...protectedRows, ...others];
}

/* ---------- Resolution helpers ---------- */

/** Resolves `bill`'s amount for the given month. Returns 0 if nothing matches. */
function amountForMonth(bill: FixedRecurring, month: string): number {
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

function hasOverride(bill: FixedRecurring, month: string): boolean {
  return Object.prototype.hasOwnProperty.call(bill.overrides, month);
}

function setBillAmount(
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

function clearBillOverride(
  bill: FixedRecurring,
  month: string
): FixedRecurring {
  if (!hasOverride(bill, month)) return bill;
  const next = { ...bill.overrides };
  delete next[month];
  return { ...bill, overrides: next };
}

/** Resolves rent allocations for a month — same schedule/override rules. */
function rentForMonth(state: RentState, month: string): RentAlloc {
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

function hasRentOverride(state: RentState, month: string): boolean {
  return Object.prototype.hasOwnProperty.call(state.overrides, month);
}

/**
 * Applies a per-person rent edit. The whole alloc map for the month is
 * written together — current/future edits forward-write, past edits go to
 * overrides only. Caller passes the full new alloc map.
 */
function setRentAlloc(
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

function clearRentOverride(state: RentState, month: string): RentState {
  if (!hasRentOverride(state, month)) return state;
  const next = { ...state.overrides };
  delete next[month];
  return { ...state, overrides: next };
}

/* ---------- Free-form amount input ---------- */

function AmountInput({
  cents,
  onCommit,
  placeholder = "0.00",
  ariaLabel,
}: {
  cents: number | undefined;
  onCommit: (cents: number | null) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const formatted = cents !== undefined ? (cents / 100).toFixed(2) : "";
  const [draft, setDraft] = useState<string>(formatted);

  useEffect(() => {
    setDraft(formatted);
  }, [formatted]);

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed) {
      onCommit(null);
      setDraft("");
      return;
    }
    const c = parseCents(trimmed);
    if (c === null) {
      setDraft(formatted);
      return;
    }
    onCommit(c);
    setDraft((c / 100).toFixed(2));
  }

  return (
    <input
      className="monthly-input-amount"
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/* ---------- Component ---------- */

type Props = {
  expenses: Expense[];
  onToast: (msg: string) => void;
};

export default function MonthlyBreakdown({ expenses, onToast }: Props) {
  const [month, setMonth] = useState<string>(() => ym(new Date()));
  const currentMonth = ym(new Date());
  const isCurrentMonth = month === currentMonth;

  const [fixed, setFixed] = useState<FixedRecurring[]>([]);
  const [variable, setVariable] = useState<VariableMap>({});
  const [rent, setRent] = useState<RentState>({ schedule: [], overrides: {} });

  useEffect(() => {
    const loadedFixed = sortFixed(loadFixed());
    setFixed(loadedFixed);
    setVariable(loadVariable());
    setRent(loadRent());
    try {
      window.localStorage.setItem(LS_FIXED_V3, JSON.stringify(loadedFixed));
    } catch {
      /* ignore */
    }
  }, []);

  function persistFixed(next: FixedRecurring[]) {
    const sorted = sortFixed(next);
    setFixed(sorted);
    try {
      window.localStorage.setItem(LS_FIXED_V3, JSON.stringify(sorted));
    } catch {
      onToast("Couldn't save recurring bills");
    }
  }

  function persistVariable(next: VariableMap) {
    setVariable(next);
    try {
      window.localStorage.setItem(LS_VARIABLE_V2, JSON.stringify(next));
    } catch {
      onToast("Couldn't save utility amounts");
    }
  }

  function persistRent(next: RentState) {
    setRent(next);
    try {
      window.localStorage.setItem(LS_RENT_V1, JSON.stringify(next));
    } catch {
      onToast("Couldn't save rent allocations");
    }
  }

  /* ---- One-time: group by store+description, title-case for display ---- */

  const oneTime = useMemo(() => {
    const inMonth = expenses.filter((e) => {
      const when = e.occurredOn || e.added || "";
      return when.startsWith(month);
    });
    type Bucket = {
      store: string;
      description: string;
      amount: number;
      receiptUrls: string[];
    };
    const buckets = new Map<string, Bucket>();
    let total = 0;
    for (const e of inMonth) {
      const rawStore = (e.store || "").trim();
      const store = rawStore ? titleCaseName(rawStore) : "Unspecified";
      const description = (e.description || "").trim();
      const key = `${store.toLowerCase()}${description.toLowerCase()}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.amount += e.amountCents;
        if (e.receiptUrl) existing.receiptUrls.push(e.receiptUrl);
      } else {
        buckets.set(key, {
          store,
          description,
          amount: e.amountCents,
          receiptUrls: e.receiptUrl ? [e.receiptUrl] : [],
        });
      }
      total += e.amountCents;
    }
    const rows = Array.from(buckets.values()).sort(
      (a, b) => b.amount - a.amount
    );
    return { rows, total, count: inMonth.length, inMonth };
  }, [expenses, month]);

  /* ---- Rent: resolved per displayed month ---- */

  const monthRent = useMemo(() => rentForMonth(rent, month), [rent, month]);
  const rentTotal = useMemo(
    () => BUYERS.reduce((s, name) => s + (monthRent[name] ?? 0), 0),
    [monthRent]
  );
  const rentOverridden = hasRentOverride(rent, month);

  function commitRentForPerson(name: string, cents: number | null) {
    const nextAlloc: RentAlloc = { ...monthRent };
    if (cents === null || cents <= 0) {
      delete nextAlloc[name];
    } else {
      nextAlloc[name] = cents;
    }
    persistRent(setRentAlloc(rent, month, currentMonth, nextAlloc));
  }

  function clearRent() {
    if (rentOverridden) {
      persistRent(clearRentOverride(rent, month));
    }
  }

  /* ---- Fixed recurring: resolved per displayed month ---- */

  const fixedTotal = useMemo(
    () => fixed.reduce((s, r) => s + amountForMonth(r, month), 0),
    [fixed, month]
  );

  function commitAmount(id: string, cents: number | null) {
    persistFixed(
      fixed.map((r) =>
        r.id === id ? setBillAmount(r, month, currentMonth, cents ?? 0) : r
      )
    );
  }

  function clearOverride(id: string) {
    persistFixed(
      fixed.map((r) => (r.id === id ? clearBillOverride(r, month) : r))
    );
  }

  /* ---- Variable recurring ---- */

  const monthVariable = variable[month] ?? {};
  const variableTotal = VARIABLE_KEYS.reduce(
    (s, k) => s + (monthVariable[k] ?? 0),
    0
  );

  function setVariableAmount(key: VariableKey, cents: number | null) {
    const next: VariableMap = { ...variable };
    const bucket = { ...(next[month] ?? {}) };
    if (cents === null) {
      delete bucket[key];
    } else {
      bucket[key] = cents;
    }
    if (Object.keys(bucket).length === 0) delete next[month];
    else next[month] = bucket;
    persistVariable(next);
  }

  /* ---- Settlement math ---- */

  const settlement = useMemo(() => {
    const N = BUYERS.length;
    // One-time pool: split N ways. Each person's "paid" picks up whatever
    // they fronted in the expenses list.
    const oneTimePaidBy = new Map<string, number>();
    for (const b of BUYERS) oneTimePaidBy.set(b, 0);
    for (const e of oneTime.inMonth) {
      oneTimePaidBy.set(
        e.paidBy,
        (oneTimePaidBy.get(e.paidBy) ?? 0) + e.amountCents
      );
    }
    const oneTimeShare = Math.round(oneTime.total / N);

    // Five-way bills (non-rent recurring fixed without paidBy + variable).
    // For each, the share is total/N and any paidBy gets credit for the
    // full amount.
    let fiveWayPool = 0;
    const paidByExtra = new Map<string, number>();
    for (const b of BUYERS) paidByExtra.set(b, 0);

    for (const r of fixed) {
      const cents = amountForMonth(r, month);
      if (cents <= 0) continue;
      fiveWayPool += cents;
      if (r.paidBy && BUYERS.includes(r.paidBy as (typeof BUYERS)[number])) {
        paidByExtra.set(r.paidBy, (paidByExtra.get(r.paidBy) ?? 0) + cents);
      }
    }
    for (const k of VARIABLE_KEYS) {
      const cents = monthVariable[k] ?? 0;
      if (cents > 0) fiveWayPool += cents;
    }
    const fiveWayShare = Math.round(fiveWayPool / N);

    // Settlement total = the entire monthly pool (one-time + 5-way + rent).
    // Rent is per-person, so its share is whatever each person owes.
    const grand = oneTime.total + fiveWayPool + rentTotal;

    const lines: SplitLine[] = BUYERS.map((name) => {
      const paid =
        (oneTimePaidBy.get(name) ?? 0) + (paidByExtra.get(name) ?? 0);
      const share =
        oneTimeShare + fiveWayShare + (monthRent[name] ?? 0);
      return { name, paid, share };
    });

    // Compute the rounding remainder so the total ÷ N share notes still
    // line up. For mixed pools the cleanest representation is the sum of
    // shares vs the grand total.
    const sumOfShares = lines.reduce((s, l) => s + l.share, 0);
    const roundingRemainder = grand - sumOfShares;
    return { lines, grand, roundingRemainder };
  }, [oneTime, fixed, month, monthVariable, rentTotal, monthRent]);

  const grandTotal = settlement.grand;

  return (
    <section className="monthly-card">
      <div className="monthly-head">
        <button
          type="button"
          className="monthly-nav"
          onClick={() => setMonth(shiftMonth(month, -1))}
          aria-label="Previous month"
        >
          ‹
        </button>
        <div className="monthly-label">{ymLabel(month)}</div>
        <button
          type="button"
          className="monthly-nav"
          onClick={() => setMonth(shiftMonth(month, +1))}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="monthly-section">
        <div className="monthly-section-head">
          <h3>One-time (by store)</h3>
          <span className="monthly-sub">
            {oneTime.count} expense{oneTime.count === 1 ? "" : "s"} ·{" "}
            <strong>{fmtMoney(oneTime.total)}</strong>
          </span>
        </div>
        {oneTime.rows.length === 0 ? (
          <p className="monthly-empty">No logged expenses this month yet.</p>
        ) : (
          <div className="monthly-list">
            {oneTime.rows.map((r) => (
              <div
                className="monthly-row"
                key={`${r.store}|${r.description}`}
              >
                <span className="monthly-row-name">
                  {r.store}
                  {r.description ? (
                    <span className="monthly-row-desc">
                      {" "}
                      ({r.description})
                    </span>
                  ) : null}
                  {r.receiptUrls.length === 1 ? (
                    <a
                      href={r.receiptUrls[0]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="receipt-pill"
                      title="Open receipt"
                      style={{ marginLeft: 6 }}
                    >
                      📎
                    </a>
                  ) : r.receiptUrls.length > 1 ? (
                    <span
                      className="monthly-row-desc"
                      style={{ marginLeft: 6 }}
                      title={`${r.receiptUrls.length} receipts grouped`}
                    >
                      📎×{r.receiptUrls.length}
                    </span>
                  ) : null}
                </span>
                <span className="monthly-row-amount">
                  {fmtMoney(r.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="monthly-section">
        <div className="monthly-section-head">
          <h3>
            Rent (per person)
            {rentOverridden ? (
              <span
                className="monthly-row-desc"
                title="A custom allocation is set just for this month"
              >
                {" "}(override)
              </span>
            ) : null}
          </h3>
          <span className="monthly-sub">
            <strong>{fmtMoney(rentTotal)}</strong> this month
          </span>
        </div>
        <div className="monthly-list">
          {BUYERS.map((name) => (
            <div className="monthly-row is-protected" key={name}>
              <span className="monthly-row-name">{name}</span>
              <AmountInput
                cents={monthRent[name] || undefined}
                onCommit={(cents) => commitRentForPerson(name, cents)}
                ariaLabel={`${name}'s rent share`}
              />
            </div>
          ))}
          {rentOverridden && !isCurrentMonth ? (
            <button
              type="button"
              className="cat-mgr-link"
              onClick={clearRent}
              style={{ alignSelf: "flex-start" }}
              title="Drop this month's override and fall back to the default split"
            >
              ↺ Reset this month
            </button>
          ) : null}
        </div>
      </div>

      <div className="monthly-section">
        <div className="monthly-section-head">
          <h3>Recurring (fixed)</h3>
          <span className="monthly-sub">
            <strong>{fmtMoney(fixedTotal)}</strong> this month
          </span>
        </div>
        <div className="monthly-list">
          {fixed.map((r) => {
            const monthCents = amountForMonth(r, month);
            const overridden = hasOverride(r, month);
            return (
              <div className="monthly-row is-protected" key={r.id}>
                <span className="monthly-row-name">
                  {r.name}
                  {overridden ? (
                    <span
                      className="monthly-row-desc"
                      title="A custom amount is set just for this month"
                    >
                      {" "}(override)
                    </span>
                  ) : null}
                </span>
                <AmountInput
                  cents={monthCents || undefined}
                  onCommit={(cents) => commitAmount(r.id, cents)}
                  ariaLabel={`${r.name} amount`}
                />
                {overridden && !isCurrentMonth ? (
                  <button
                    type="button"
                    className="monthly-remove"
                    onClick={() => clearOverride(r.id)}
                    title="Clear this month's override and fall back to the default"
                    aria-label={`Clear ${r.name} override for this month`}
                  >
                    ↺
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="monthly-section">
        <div className="monthly-section-head">
          <h3>Recurring (variable)</h3>
          <span className="monthly-sub">
            <strong>{fmtMoney(variableTotal)}</strong> this month
          </span>
        </div>
        <div className="monthly-list">
          {VARIABLE_KEYS.map((key) => {
            const cents = monthVariable[key];
            return (
              <div className="monthly-row" key={key}>
                <span className="monthly-row-name">{key}</span>
                <AmountInput
                  cents={cents}
                  onCommit={(c) => setVariableAmount(key, c)}
                  ariaLabel={`${key} amount`}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="monthly-total">
        <span>Total for {ymLabel(month)}</span>
        <strong>{fmtMoney(grandTotal)}</strong>
      </div>

      {grandTotal > 0 ? (
        <SplitCard
          title={`Settlement for ${ymLabel(month)}`}
          lines={settlement.lines}
          roundingRemainder={settlement.roundingRemainder}
        />
      ) : null}
    </section>
  );
}
