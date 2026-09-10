"use client";

import { useMemo, useState } from "react";
import AllocationSummary from "@/components/AllocationSummary";
import EditExpenseModal from "@/components/EditExpenseModal";
import FreshAddExpenseSheet from "@/components/fresh/FreshAddExpenseSheet";
import FreshSettlementCard from "@/components/fresh/FreshSettlementCard";
import MonthlyBreakdown from "@/components/MonthlyBreakdown";
import { currentExpenseMonth, expenseMonthOf } from "@/lib/expenseMonths";
import { fmtMoney } from "@/lib/money";
import { BUYERS, type Expense } from "@/lib/types";
import { useMonthlySettlement } from "@/lib/useMonthlySettlement";
import type { HouseholdData } from "@/lib/useHouseholdData";

type Props = {
  data: HouseholdData;
  mealGroup: string[];
};

/** "Jun 12" from a YYYY-MM-DD. Empty when the row has no usable date. */
function shortDate(iso: string): string {
  const [y, m, d] = (iso || "").split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function FreshExpenses({ data, mealGroup }: Props) {
  const [segment, setSegment] = useState<"current" | "month">("current");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { settlement, loadingBills } = useMonthlySettlement(data.expenses);
  const currentMonth = currentExpenseMonth();
  const editing = editingId
    ? (data.expenses.find((e) => e.id === editingId) ?? null)
    : null;

  const sorted = useMemo(() => {
    const dateOf = (e: Expense) => e.occurredOn || e.added || "";
    return data.expenses.slice().sort((a, b) => {
      const cmp = dateOf(b).localeCompare(dateOf(a));
      if (cmp !== 0) return cmp;
      return (b.added || "").localeCompare(a.added || "");
    });
  }, [data.expenses]);

  const monthLabel = new Date().toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  function isLocked(e: Expense): boolean {
    return expenseMonthOf(e.occurredOn || e.added) < currentMonth;
  }

  function openExpense(e: Expense) {
    if (isLocked(e)) {
      data.showToast("Past months are locked");
      return;
    }
    setEditingId(e.id);
  }

  return (
    <>
      <div className="fresh-expenses">
        <div className="fresh-expenses-main">
          <div className="fresh-section-head">
            <div className="fresh-seg" role="tablist" aria-label="Expense view">
              <button
                type="button"
                role="tab"
                aria-selected={segment === "current"}
                className={`fresh-seg-btn${segment === "current" ? " active" : ""}`}
                onClick={() => setSegment("current")}
              >
                Current
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={segment === "month"}
                className={`fresh-seg-btn${segment === "month" ? " active" : ""}`}
                onClick={() => setSegment("month")}
              >
                Month
              </button>
            </div>
            <span className="fresh-sub">
              {data.expenses.length} logged
            </span>
          </div>

          {segment === "month" ? (
            <MonthlyBreakdown
              expenses={data.expenses}
              onToast={data.showToast}
            />
          ) : data.expensesLoading ? (
            <div>
              <div className="fresh-skel fresh-skel-row" />
              <div className="fresh-skel fresh-skel-row" />
              <div className="fresh-skel fresh-skel-row" />
            </div>
          ) : data.expensesError ? (
            <div className="fresh-error">
              Couldn&apos;t load expenses. {data.expensesError}
            </div>
          ) : sorted.length === 0 ? (
            <div className="fresh-empty">
              <strong>No expenses yet</strong>
              Add the first receipt and the month starts settling itself.
            </div>
          ) : (
            <div className="fresh-rows">
              {sorted.map((e) => {
                const locked = isLocked(e);
                return (
                  <button
                    key={e.id}
                    type="button"
                    className={`fresh-row${locked ? " locked" : ""}`}
                    onClick={() => openExpense(e)}
                    title={locked ? "Past months are locked" : "Edit expense"}
                  >
                    <span className="fresh-row-main">
                      <span className="fresh-row-title">
                        {e.store || e.name}
                        {e.description ? ` (${e.description})` : ""}
                      </span>
                      <span className="fresh-row-meta">
                        {shortDate(e.occurredOn || e.added)} · Paid by{" "}
                        {e.paidBy}
                      </span>
                      <AllocationSummary
                        allocations={e.allocations ?? []}
                        memberCount={BUYERS.length}
                      />
                    </span>
                    <span className="fresh-row-amount">
                      {fmtMoney(e.amountCents)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <aside className="fresh-settlement-col">
          <FreshSettlementCard
            settlement={settlement}
            title="Settlement"
            subtitle={monthLabel}
            loading={loadingBills || data.expensesLoading}
          />
        </aside>
      </div>

      <button
        type="button"
        className="fresh-fab"
        onClick={() => setAdding(true)}
      >
        Add expense
      </button>

      {adding ? (
        <FreshAddExpenseSheet
          mealGroup={mealGroup}
          onClose={() => setAdding(false)}
          onResult={(next, msg) => {
            data.setExpenses(next);
            data.showToast(msg);
          }}
        />
      ) : null}

      {editing ? (
        <EditExpenseModal
          item={editing}
          mealGroup={mealGroup}
          onClose={() => setEditingId(null)}
          onResult={(next, msg) => {
            data.setExpenses(next);
            data.showToast(msg);
          }}
          onError={(msg) => data.showToast("Error: " + msg)}
        />
      ) : null}
    </>
  );
}
