"use client";

import { useEffect, useMemo, useState } from "react";
import { fmtMoney, parseCents } from "@/lib/money";
import { titleCaseName } from "@/lib/normalize";
import type { Expense } from "@/lib/types";

/**
 * Recurring bills have history now.
 *
 * Each bill carries:
 *   - `schedule`: ordered list of `{ from: "YYYY-MM", cents }` markers. The
 *     amount for a month is whatever the most recent marker said. Edits made
 *     while viewing the *current* month append/replace at the current month
 *     and trim future markers — that's the "write forward" rule.
 *   - `overrides`: per-month one-shot amounts. Edits to any month *other*
 *     than the current month land here, so past months never propagate.
 *
 * Resolution order for a month M: override[M] wins, otherwise the most recent
 * schedule marker with `from <= M`. Missing on both = 0.
 *
 * Variable bills (gas/water/electricity) are always per-month and live in a
 * simple map.
 */
type ScheduleEntry = { from: string; cents: number };
type FixedRecurring = {
  id: string;
  name: string;
  protected?: boolean;
  schedule: ScheduleEntry[];
  overrides: Record<string, number>;
};
type VariableMap = Record<string, Record<string, number>>;

// Bumped to v3 / v2 to wipe out stale test values from earlier development
// — protected mainstays start at $0 again, variable utilities start blank,
// and the old keys are removed on load so they don't linger.
const LS_FIXED_V3 = "monthly_recurring_fixed_v3";
const LEGACY_FIXED_KEYS = [
  "monthly_recurring_fixed_v2",
  "monthly_recurring_fixed_v1",
];
const LS_VARIABLE_V2 = "monthly_recurring_variable_v2";
const LEGACY_VARIABLE_KEYS = ["monthly_recurring_variable_v1"];

const PROTECTED_FIXED: Pick<FixedRecurring, "id" | "name">[] = [
  { id: "fixed-mainstay-rent", name: "Rent" },
  { id: "fixed-mainstay-internet", name: "Internet" },
  { id: "fixed-mainstay-rental-insurance", name: "Rental insurance" },
];

const VARIABLE_KEYS = ["Gas", "Water", "Electricity"] as const;
type VariableKey = (typeof VARIABLE_KEYS)[number];

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

function emptyProtected(): FixedRecurring[] {
  return PROTECTED_FIXED.map((p) => ({
    id: p.id,
    name: p.name,
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
    schedule?: unknown;
    overrides?: unknown;
  };
  if (typeof r.id !== "string" || typeof r.name !== "string") return null;
  return {
    id: r.id,
    name: r.name,
    protected: Boolean(r.protected),
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
  // Drop legacy keys on read so old test data doesn't keep coming back if
  // someone uses both old and new builds.
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
  for (const p of PROTECTED_FIXED) {
    const existing = arr.find((r) => r.id === p.id);
    if (!existing) {
      arr.push({
        id: p.id,
        name: p.name,
        protected: true,
        schedule: [],
        overrides: {},
      });
    } else {
      existing.protected = true;
      existing.name = p.name;
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

function sortFixed(rows: FixedRecurring[]): FixedRecurring[] {
  const order = PROTECTED_FIXED.map((p) => p.id);
  const protectedRows = order
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is FixedRecurring => Boolean(r));
  const others = rows.filter((r) => !order.includes(r.id));
  return [...protectedRows, ...others];
}

/** Resolves `bill`'s amount for the given month. Returns 0 if nothing matches. */
function amountForMonth(bill: FixedRecurring, month: string): number {
  if (Object.prototype.hasOwnProperty.call(bill.overrides, month)) {
    return bill.overrides[month];
  }
  // Walk schedule (ascending) and keep the latest entry whose `from <= month`.
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

/**
 * Applies an edit.
 *
 *   - Editing the *current month or any future month* writes forward: trims
 *     schedule markers >= the edit month and appends a new marker at the
 *     edit month. Every subsequent month (until another forward-write or a
 *     per-month override) picks up the new amount.
 *   - Editing a *past month* only sets a per-month override. The schedule
 *     is left untouched, so accidentally typing in last August's rent
 *     doesn't repaint everything since.
 */
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

/** Drops a month-level override and falls back to the schedule. */
function clearBillOverride(bill: FixedRecurring, month: string): FixedRecurring {
  if (!hasOverride(bill, month)) return bill;
  const next = { ...bill.overrides };
  delete next[month];
  return { ...bill, overrides: next };
}

/* ---- Free-form amount input (commits on blur/Enter, never on keystroke) ---- */

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

type Props = {
  expenses: Expense[];
  onToast: (msg: string) => void;
};

export default function MonthlyBreakdown({ expenses, onToast }: Props) {
  const [month, setMonth] = useState<string>(() => ym(new Date()));
  // Recomputed each render so a tab left open overnight rolls into the new
  // month without the user noticing.
  const currentMonth = ym(new Date());
  const isCurrentMonth = month === currentMonth;

  const [fixed, setFixed] = useState<FixedRecurring[]>([]);
  const [variable, setVariable] = useState<VariableMap>({});
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");

  useEffect(() => {
    const loaded = sortFixed(loadFixed());
    setFixed(loaded);
    setVariable(loadVariable());
    try {
      window.localStorage.setItem(LS_FIXED_V3, JSON.stringify(loaded));
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
    return { rows, total, count: inMonth.length };
  }, [expenses, month]);

  /* ---- Fixed recurring: resolved per displayed month ---- */

  const fixedTotal = useMemo(
    () => fixed.reduce((s, r) => s + amountForMonth(r, month), 0),
    [fixed, month]
  );

  function addFixed() {
    const trimmed = newName.trim();
    if (!trimmed) {
      onToast("Name is required");
      return;
    }
    const cents = parseCents(newAmount);
    if (!cents || cents <= 0) {
      onToast("Amount must be greater than zero");
      return;
    }
    // New bills start from the current month forward, so they don't
    // accidentally repaint past months with amounts the user never paid.
    persistFixed([
      ...fixed,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: trimmed,
        schedule: [{ from: currentMonth, cents }],
        overrides: {},
      },
    ]);
    setNewName("");
    setNewAmount("");
  }

  function renameFixed(id: string, name: string) {
    persistFixed(fixed.map((r) => (r.id === id ? { ...r, name } : r)));
  }

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

  function removeFixed(id: string) {
    const row = fixed.find((r) => r.id === id);
    if (!row || row.protected) return;
    if (!confirm(`Remove "${row.name}" from recurring bills?`)) return;
    persistFixed(fixed.filter((r) => r.id !== id));
  }

  /* ---- Variable recurring: per-month amounts for gas/water/electricity ---- */

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

  const grandTotal = oneTime.total + fixedTotal + variableTotal;

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
              <div
                className={`monthly-row${r.protected ? " is-protected" : " editable"}`}
                key={r.id}
              >
                {r.protected ? (
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
                ) : (
                  <input
                    className="monthly-input-name"
                    type="text"
                    value={r.name}
                    onChange={(e) => renameFixed(r.id, e.target.value)}
                    maxLength={32}
                  />
                )}
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
                ) : r.protected ? null : (
                  <button
                    type="button"
                    className="monthly-remove"
                    onClick={() => removeFixed(r.id)}
                    aria-label={`Remove ${r.name}`}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="monthly-add">
          <input
            type="text"
            placeholder="e.g. Phone bill"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={32}
          />
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
          />
          <button type="button" className="btn-accent" onClick={addFixed}>
            Add
          </button>
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
    </section>
  );
}
