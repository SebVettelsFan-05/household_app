"use client";

import { useMemo, useState } from "react";
import EditExpenseModal from "@/components/EditExpenseModal";
import FreshAddExpenseSheet from "@/components/fresh/FreshAddExpenseSheet";
import FreshSettlementCard from "@/components/fresh/FreshSettlementCard";
import { Avatar } from "@/components/fresh/people";
import { IconPlus } from "@/components/fresh/icons";
import MonthlyBreakdown from "@/components/MonthlyBreakdown";
import { allocationLabel } from "@/lib/allocations";
import { currentExpenseMonth, expenseMonthOf } from "@/lib/expenseMonths";
import { fmtMoney } from "@/lib/money";
import { BUYERS, type Expense, type ExpenseAllocation } from "@/lib/types";
import { useMonthlySettlement } from "@/lib/useMonthlySettlement";
import type { HouseholdData } from "@/lib/useHouseholdData";

export type ExpenseSegment = "receipts" | "month";

type Props = {
  data: HouseholdData;
  mealGroup: string[];
  segment: ExpenseSegment;
  onSegmentChange: (segment: ExpenseSegment) => void;
};

/** "Wed, Sep 10" from a YYYY-MM-DD. Empty when the row has no usable date. */
function dateHeading(iso: string): string {
  const [y, m, d] = (iso || "").split("-").map(Number);
  if (!y || !m || !d) return "No date";
  return new Date(y, m - 1, d).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "Meals 3" / "Everyone" / "Personal", the same rule the classic UI uses. */
function splitTag(a: ExpenseAllocation): string {
  return allocationLabel(a, BUYERS.length).replace(/[()]/g, "");
}

export default function FreshExpenses({
  data,
  mealGroup,
  segment,
  onSegmentChange,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { settlement, loadingBills } = useMonthlySettlement(data.expenses);
  const currentMonth = currentExpenseMonth();
  const editing = editingId
    ? (data.expenses.find((e) => e.id === editingId) ?? null)
    : null;

  // Newest first, then grouped under one heading per day.
  const days = useMemo(() => {
    const dateOf = (e: Expense) => e.occurredOn || e.added || "";
    const sorted = data.expenses.slice().sort((a, b) => {
      const cmp = dateOf(b).localeCompare(dateOf(a));
      if (cmp !== 0) return cmp;
      return (b.added || "").localeCompare(a.added || "");
    });
    const out: { date: string; rows: Expense[] }[] = [];
    for (const e of sorted) {
      const date = dateOf(e);
      const last = out[out.length - 1];
      if (last && last.date === date) last.rows.push(e);
      else out.push({ date, rows: [e] });
    }
    return out;
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
      <div className="fresh-seg" role="tablist" aria-label="Expense view">
        <button
          type="button"
          role="tab"
          aria-selected={segment === "receipts"}
          className={`fresh-seg-btn${segment === "receipts" ? " active" : ""}`}
          onClick={() => onSegmentChange("receipts")}
        >
          Receipts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={segment === "month"}
          className={`fresh-seg-btn${segment === "month" ? " active" : ""}`}
          onClick={() => onSegmentChange("month")}
        >
          Month
        </button>
      </div>

      <div className="fresh-expenses" data-segment={segment}>
        <div className="fresh-expenses-main">
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
          ) : days.length === 0 ? (
            <div className="fresh-empty">
              <strong>No receipts yet</strong>
              Add the first one and the month starts settling itself.
            </div>
          ) : (
            days.map((day) => (
              <section className="fresh-section" key={day.date}>
                <div className="fresh-date-head">{dateHeading(day.date)}</div>
                <div className="fresh-rows">
                  {day.rows.map((e) => {
                    const locked = isLocked(e);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        className={`fresh-row${locked ? " locked" : ""}`}
                        onClick={() => openExpense(e)}
                        title={
                          locked ? "Past months are locked" : "Edit expense"
                        }
                      >
                        <span className="fresh-row-main">
                          <span className="fresh-row-title">
                            {e.store || e.name}
                          </span>
                          {e.description ? (
                            <span className="fresh-row-desc">
                              {e.description}
                            </span>
                          ) : null}
                          <span className="fresh-row-meta">
                            <span className="fresh-person">
                              <Avatar name={e.paidBy} size={20} />
                              <span className="fresh-person-name">
                                {e.paidBy}
                              </span>
                            </span>
                            {(e.allocations ?? []).map((a, i) => (
                              <span
                                className="fresh-split-tag"
                                data-kind={a.kind}
                                key={i}
                              >
                                {splitTag(a)}
                              </span>
                            ))}
                          </span>
                        </span>
                        <span className="fresh-row-amount fresh-num">
                          {fmtMoney(e.amountCents)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
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
        <IconPlus size={20} />
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
