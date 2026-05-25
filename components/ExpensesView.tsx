"use client";

import { useMemo, useState } from "react";
import AddExpenseForm from "@/components/AddExpenseForm";
import EditExpenseModal from "@/components/EditExpenseModal";
import ExpenseRow from "@/components/ExpenseRow";
import MonthlyBreakdown from "@/components/MonthlyBreakdown";
import { clearExpenses } from "@/lib/client";
import { fmtMoney } from "@/lib/money";
import { type Expense } from "@/lib/types";

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

  const total = useMemo(
    () => expenses.reduce((s, e) => s + e.amountCents, 0),
    [expenses]
  );

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
          <strong>{fmtMoney(total)}</strong> total
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

          {/* Split breakdown lives on the Monthly tab now — the math is
              month-specific once rent + utilities are folded in, so an
              all-time split here would be misleading. */}

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

