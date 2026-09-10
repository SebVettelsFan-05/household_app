"use client";

import { useEffect, useMemo, useState } from "react";
import { currentExpenseMonth } from "@/lib/expenseMonths";
import {
  loadMonthlyBills,
  settlementForMonth,
  type MonthlyBills,
} from "@/lib/monthlyBills";
import type { Settlement } from "@/lib/settlement";
import type { Expense } from "@/lib/types";

const NO_BILLS: MonthlyBills = {
  fixed: [],
  variable: { lines: [], amounts: {} },
  rent: { schedule: [], overrides: {} },
};

/**
 * A month's settlement for a read-only view. The recurring bills and rent
 * come from the same shared setting the monthly breakdown edits, so the
 * numbers here and there are the same numbers.
 */
export function useMonthlySettlement(
  expenses: Expense[],
  month: string = currentExpenseMonth()
): { settlement: Settlement; loadingBills: boolean } {
  const [bills, setBills] = useState<MonthlyBills | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMonthlyBills()
      .then((b) => {
        if (!cancelled) setBills(b);
      })
      .catch((err: unknown) => {
        // Expenses alone still settle; the bills half just stays empty.
        console.warn("[settings] monthly bills load failed", err);
        if (!cancelled) setBills(NO_BILLS);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const settlement = useMemo(
    () => settlementForMonth(expenses, bills ?? NO_BILLS, month),
    [expenses, bills, month]
  );

  return { settlement, loadingBills: bills === null };
}
