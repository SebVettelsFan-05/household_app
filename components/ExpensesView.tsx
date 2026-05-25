"use client";

import { useMemo, useState } from "react";
import AddExpenseForm from "@/components/AddExpenseForm";
import EditExpenseModal from "@/components/EditExpenseModal";
import ExpenseRow from "@/components/ExpenseRow";
import MonthlyBreakdown from "@/components/MonthlyBreakdown";
import { clearExpenses } from "@/lib/client";
import { fmtMoney } from "@/lib/money";
import { BUYERS, type Expense } from "@/lib/types";

type Props = {
  expenses: Expense[];
  loading: boolean;
  loadError: string | null;
  onExpensesChange: (next: Expense[]) => void;
  onToast: (msg: string) => void;
};

export default function ExpensesView({
  expenses,
  loading,
  loadError,
  onExpensesChange,
  onToast,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [subTab, setSubTab] = useState<"current" | "monthly">("current");

  const editing = editingId ? expenses.find((e) => e.id === editingId) : null;

  // Chronological by the user-picked date (May 1, May 2, May 3 …). `added`
  // is the row creation timestamp and reflects when you typed it in, which
  // had been scrambling the order during backfill — `occurredOn` is what
  // people actually care about. Tiebreak on `added` so multiple entries
  // dated the same day stay in insertion order. Legacy rows without
  // `occurredOn` fall back to `added`.
  const sorted = useMemo(() => {
    const dateOf = (e: Expense) => e.occurredOn || e.added || "";
    return expenses.slice().sort((a, b) => {
      const cmp = dateOf(a).localeCompare(dateOf(b));
      if (cmp !== 0) return cmp;
      return (a.added || "").localeCompare(b.added || "");
    });
  }, [expenses]);

  // ---- Split math ----
  // Five-way even split. Per-person share rounded to the nearest cent;
  // any remainder from rounding is shown so totals balance to the penny.
  const summary = useMemo(() => {
    const total = expenses.reduce((s, e) => s + e.amountCents, 0);
    const share = Math.round(total / BUYERS.length);
    const paidBy = new Map<string, number>();
    for (const b of BUYERS) paidBy.set(b, 0);
    for (const e of expenses) {
      paidBy.set(e.paidBy, (paidBy.get(e.paidBy) ?? 0) + e.amountCents);
    }
    const lines = BUYERS.map((b) => {
      const paid = paidBy.get(b) ?? 0;
      const net = paid - share;
      return { name: b, paid, net };
    });
    // True remainder so the math reads honestly when total doesn't divide evenly.
    const roundingRemainder = total - share * BUYERS.length;
    return { total, share, lines, roundingRemainder };
  }, [expenses]);

  async function clearAll() {
    if (expenses.length === 0) return;
    if (
      !confirm(
        `Clear all ${expenses.length} expense${expenses.length === 1 ? "" : "s"}?`
      )
    )
      return;
    setBusy(true);
    try {
      const res = await clearExpenses();
      onExpensesChange(res.expenses);
      onToast("Expenses cleared");
    } catch (err) {
      onToast("Error: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="view-stats">
        <div>
          <strong>{expenses.length}</strong> expense
          {expenses.length === 1 ? "" : "s"}
        </div>
        <div>
          <strong>{fmtMoney(summary.total)}</strong> total
        </div>
      </div>

      <div className="sub-tabs">
        <button
          type="button"
          className={`sub-tab${subTab === "current" ? " active" : ""}`}
          onClick={() => setSubTab("current")}
        >
          Current
        </button>
        <button
          type="button"
          className={`sub-tab${subTab === "monthly" ? " active" : ""}`}
          onClick={() => setSubTab("monthly")}
        >
          Monthly
        </button>
      </div>

      {subTab === "monthly" ? (
        <MonthlyBreakdown expenses={expenses} onToast={onToast} />
      ) : (
        <>
          <AddExpenseForm
            onResult={(next, msg) => {
              onExpensesChange(next);
              onToast(msg);
            }}
            onError={(msg) => onToast("Error: " + msg)}
          />

          {expenses.length > 0 ? (
            <SplitCard
              total={summary.total}
              share={summary.share}
              lines={summary.lines}
              roundingRemainder={summary.roundingRemainder}
            />
          ) : null}

          <div className="list-head">
            <h2>Expenses</h2>
            <button
              type="button"
              className="sort-toggle"
              onClick={clearAll}
              disabled={busy || expenses.length === 0}
              style={{ color: "var(--danger)" }}
            >
              Clear expenses
            </button>
          </div>

          <div className="list-hint">Tap any expense to edit or delete</div>

          {loading ? (
            <div className="loading">
              <span className="spinner" />
              Loading…
            </div>
          ) : loadError ? (
            <div className="empty">
              <p>Couldn&apos;t load expenses.</p>
              <p style={{ fontSize: 13 }}>{loadError}</p>
            </div>
          ) : expenses.length === 0 ? (
            <div className="empty">
              <div className="icon">∅</div>
              <p>No expenses yet.</p>
              <p style={{ fontSize: 13 }}>Add one above to start the split.</p>
            </div>
          ) : (
            <div className="items">
              {sorted.map((e) => (
                <ExpenseRow key={e.id} item={e} onClick={setEditingId} />
              ))}
            </div>
          )}
        </>
      )}

      {editing ? (
        <EditExpenseModal
          item={editing}
          onClose={() => setEditingId(null)}
          onResult={(next, msg) => {
            onExpensesChange(next);
            onToast(msg);
          }}
          onError={(msg) => onToast("Error: " + msg)}
        />
      ) : null}
    </>
  );
}

/**
 * Settlement breakdown. Two columns of actionable rows — "Send to joint
 * account" for people whose share exceeds what they paid, "Withdraw from
 * joint account" for people who fronted more than their share. Even rows
 * (paid exactly their share) drop off both lists since they have nothing to
 * do. Each row carries a Paid / Share sub-line so the amount is auditable
 * at a glance.
 *
 * Sorted by amount descending within each group, so the biggest movers
 * read first.
 */
function SplitCard({
  total,
  share,
  lines,
  roundingRemainder,
}: {
  total: number;
  share: number;
  lines: { name: string; paid: number; net: number }[];
  roundingRemainder: number;
}) {
  const senders = lines
    .filter((l) => l.net < 0)
    .map((l) => ({ name: l.name, paid: l.paid, amount: -l.net }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  const receivers = lines
    .filter((l) => l.net > 0)
    .map((l) => ({ name: l.name, paid: l.paid, amount: l.net }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  const evens = lines.filter((l) => l.net === 0).map((l) => l.name);

  return (
    <section className="split-card">
      <h2>Split</h2>

      <dl className="split-summary">
        <div>
          <dt>Total group expenses</dt>
          <dd>{fmtMoney(total)}</dd>
        </div>
        <div>
          <dt>Target share per person</dt>
          <dd>{fmtMoney(share)}</dd>
        </div>
      </dl>

      {senders.length > 0 ? (
        <div className="split-group split-group-send">
          <h3>Send to joint account</h3>
          <ul>
            {senders.map((s) => (
              <li key={s.name}>
                <div className="split-row-main">
                  <span className="split-name">{s.name}</span>
                  <span className="split-amount">{fmtMoney(s.amount)}</span>
                </div>
                <div className="split-row-sub">
                  Paid {fmtMoney(s.paid)} — Share {fmtMoney(share)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {receivers.length > 0 ? (
        <div className="split-group split-group-receive">
          <h3>Withdraw from joint account</h3>
          <ul>
            {receivers.map((r) => (
              <li key={r.name}>
                <div className="split-row-main">
                  <span className="split-name">{r.name}</span>
                  <span className="split-amount">{fmtMoney(r.amount)}</span>
                </div>
                <div className="split-row-sub">
                  Paid {fmtMoney(r.paid)} — Share {fmtMoney(share)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {evens.length > 0 ? (
        <p className="split-note">
          Already even: {evens.join(", ")}
        </p>
      ) : null}

      {roundingRemainder !== 0 ? (
        <p className="split-note">
          Rounding leaves {fmtMoney(Math.abs(roundingRemainder))}{" "}
          {roundingRemainder > 0 ? "short of" : "over"} the total — one
          person can absorb it.
        </p>
      ) : null}
    </section>
  );
}
