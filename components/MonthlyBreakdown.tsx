"use client";

import { useEffect, useMemo, useState } from "react";
import { fmtMoney, parseCents } from "@/lib/money";
import type { Expense } from "@/lib/types";

// LocalStorage shapes — kept simple so the data is easy to inspect/clear.
// `fixed` is a household-wide list of recurring bills with stable amounts
// (rent, internet, etc.). `variable` is the per-month dollar amounts for
// utilities that change each cycle (gas, water, electricity). Amounts in both
// shapes are integer cents.
type FixedRecurring = {
  id: string;
  name: string;
  amountCents: number;
  // Protected entries (Rent / Internet / Rental insurance) — amount stays
  // editable, but the row can't be deleted or renamed.
  protected?: boolean;
};
type VariableMap = Record<string, Record<string, number>>;

const LS_FIXED = "monthly_recurring_fixed_v1";
const LS_VARIABLE = "monthly_recurring_variable_v1";

// Mainstay bills — seeded once on first load and pinned to the top of the
// fixed list. The `id` is deterministic so we can find them across reloads
// even if the user rearranges things.
const PROTECTED_FIXED: FixedRecurring[] = [
  { id: "fixed-mainstay-rent", name: "Rent", amountCents: 0, protected: true },
  {
    id: "fixed-mainstay-internet",
    name: "Internet",
    amountCents: 0,
    protected: true,
  },
  {
    id: "fixed-mainstay-rental-insurance",
    name: "Rental insurance",
    amountCents: 0,
    protected: true,
  },
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

function loadFixed(): FixedRecurring[] {
  if (typeof window === "undefined") return PROTECTED_FIXED.slice();
  try {
    const raw = window.localStorage.getItem(LS_FIXED);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const arr = Array.isArray(parsed)
      ? parsed.filter(
          (x): x is FixedRecurring =>
            !!x &&
            typeof x === "object" &&
            typeof (x as FixedRecurring).id === "string" &&
            typeof (x as FixedRecurring).name === "string" &&
            typeof (x as FixedRecurring).amountCents === "number"
        )
      : [];
    // Ensure all protected mainstays are present (re-add any that were
    // deleted from older state). Preserve their stored amount if present.
    for (const p of PROTECTED_FIXED) {
      const existing = arr.find((r) => r.id === p.id);
      if (!existing) arr.push({ ...p });
      else {
        existing.protected = true;
        existing.name = p.name; // canonical name
      }
    }
    return arr;
  } catch {
    return PROTECTED_FIXED.slice();
  }
}

function loadVariable(): VariableMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_VARIABLE);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as VariableMap;
  } catch {
    return {};
  }
}

// Sorts fixed recurring bills so protected mainstays appear first, in their
// canonical order, with user-added rows after them in insertion order.
function sortFixed(rows: FixedRecurring[]): FixedRecurring[] {
  const order = PROTECTED_FIXED.map((p) => p.id);
  const protectedRows = order
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is FixedRecurring => Boolean(r));
  const others = rows.filter((r) => !order.includes(r.id));
  return [...protectedRows, ...others];
}

// Free-form amount input. Keeps a local draft string so the user can type,
// backspace, and re-type without the controlled value snapping back to a
// formatted form on every keystroke. Commits on blur (or Enter).
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

  // Re-sync the draft when the underlying value changes from the outside
  // (e.g. the user navigated to a different month).
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
      // Unparseable — revert to the last known good value.
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
  const [fixed, setFixed] = useState<FixedRecurring[]>([]);
  const [variable, setVariable] = useState<VariableMap>({});
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");

  useEffect(() => {
    const loaded = sortFixed(loadFixed());
    setFixed(loaded);
    setVariable(loadVariable());
    // Persist immediately if loading injected any missing protected rows so
    // they stick across sessions.
    try {
      window.localStorage.setItem(LS_FIXED, JSON.stringify(loaded));
    } catch {
      /* ignore */
    }
  }, []);

  function persistFixed(next: FixedRecurring[]) {
    const sorted = sortFixed(next);
    setFixed(sorted);
    try {
      window.localStorage.setItem(LS_FIXED, JSON.stringify(sorted));
    } catch {
      onToast("Couldn't save recurring bills");
    }
  }

  function persistVariable(next: VariableMap) {
    setVariable(next);
    try {
      window.localStorage.setItem(LS_VARIABLE, JSON.stringify(next));
    } catch {
      onToast("Couldn't save utility amounts");
    }
  }

  // ---- One-time: pull from the logged expenses for the selected month ----
  // Grouped by store + description. "Costco" with no description and
  // "Costco (Gas)" tally as separate rows; "Costco (Pizza)" and another
  // "Costco (Pizza)" merge. Filter by the user-picked occurrence date so
  // editing a row's date moves it to the right month.
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
      const store = (e.store || "").trim() || "Unspecified";
      const description = (e.description || "").trim();
      const key = `${store.toLowerCase()}${description.toLowerCase()}`;
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

  // ---- Fixed recurring: same amount every month ----
  const fixedTotal = useMemo(
    () => fixed.reduce((s, r) => s + r.amountCents, 0),
    [fixed]
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
    persistFixed([
      ...fixed,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: trimmed,
        amountCents: cents,
      },
    ]);
    setNewName("");
    setNewAmount("");
  }

  function updateFixed(id: string, patch: Partial<FixedRecurring>) {
    persistFixed(fixed.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeFixed(id: string) {
    const row = fixed.find((r) => r.id === id);
    if (!row || row.protected) return;
    if (!confirm(`Remove "${row.name}" from recurring bills?`)) return;
    persistFixed(fixed.filter((r) => r.id !== id));
  }

  // ---- Variable recurring: per-month amounts for gas/water/electricity ----
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
                      {" "}({r.description})
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
                <span className="monthly-row-amount">{fmtMoney(r.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="monthly-section">
        <div className="monthly-section-head">
          <h3>Recurring (fixed)</h3>
          <span className="monthly-sub">
            <strong>{fmtMoney(fixedTotal)}</strong> / month
          </span>
        </div>
        <div className="monthly-list">
          {fixed.map((r) => (
            <div
              className={`monthly-row${r.protected ? " is-protected" : " editable"}`}
              key={r.id}
            >
              {r.protected ? (
                <span className="monthly-row-name">{r.name}</span>
              ) : (
                <input
                  className="monthly-input-name"
                  type="text"
                  value={r.name}
                  onChange={(e) =>
                    updateFixed(r.id, { name: e.target.value })
                  }
                  maxLength={32}
                />
              )}
              <AmountInput
                cents={r.amountCents || undefined}
                onCommit={(cents) =>
                  updateFixed(r.id, { amountCents: cents ?? 0 })
                }
                ariaLabel={`${r.name} amount`}
              />
              {r.protected ? null : (
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
          ))}
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
