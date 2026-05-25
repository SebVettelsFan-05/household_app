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

  // Newest first.
  const sorted = useMemo(() => {
    return expenses
      .slice()
      .sort((a, b) => (b.added || "").localeCompare(a.added || ""));
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
            <section className="split-card">
              <div className="split-head">
                <h2>Split</h2>
                <span className="split-sub">
                  {fmtMoney(summary.total)} ÷ {BUYERS.length} ={" "}
                  <strong>{fmtMoney(summary.share)}</strong> each
                </span>
              </div>

              <div className="split-step">
                <span className="split-step-num">1</span>
                <span>
                  Everyone deposits <strong>{fmtMoney(summary.share)}</strong>{" "}
                  into the joint account.
                </span>
              </div>

              {summary.lines.some((l) => l.paid > 0) ? (
                <div className="split-step">
                  <span className="split-step-num">2</span>
                  <span>
                    Reimburse from the joint account back to whoever paid:
                  </span>
                </div>
              ) : null}

              <div className="split-people">
                {summary.lines.map((l) => (
                  <div
                    key={l.name}
                    className={`split-person${l.paid === 0 ? " quiet" : ""}`}
                  >
                    <span className="split-name">{l.name}</span>
                    <span className="split-paid">
                      paid {fmtMoney(l.paid)}
                    </span>
                    <span
                      className={`split-net${l.net > 0 ? " positive" : l.net < 0 ? " negative" : ""}`}
                    >
                      {l.net > 0
                        ? `receives ${fmtMoney(l.net)}`
                        : l.net < 0
                          ? `still owes ${fmtMoney(-l.net)}`
                          : "even"}
                    </span>
                  </div>
                ))}
              </div>

              {summary.roundingRemainder !== 0 ? (
                <div className="split-note">
                  Rounding leaves{" "}
                  {fmtMoney(Math.abs(summary.roundingRemainder))}{" "}
                  {summary.roundingRemainder > 0 ? "short of" : "over"} the
                  total — one person can absorb it.
                </div>
              ) : null}
            </section>
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
