import { todayYmd } from "./dates";

export const FIRST_EXPENSE_MONTH = "2026-05";

/**
 * Which expense month an instant falls in, evaluated in the household
 * timezone rather than the browser's. A housemate whose phone is in another
 * timezone (or who is travelling) must see the same "this month" as everyone
 * else, or an expense logged near a month boundary lands in the wrong
 * settlement and gets refused as "past".
 */
export function monthKey(date: Date = new Date()): string {
  return todayYmd(date).slice(0, 7);
}

export function currentExpenseMonth(): string {
  return monthKey(new Date());
}

export function firstDayOfMonth(month: string): string {
  return `${month}-01`;
}

export function expenseMonthOf(dateLike: string): string {
  const s = String(dateLike ?? "");
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : "";
}

export function isPastExpenseMonth(
  dateLike: string,
  currentMonth: string = currentExpenseMonth()
): boolean {
  const month = expenseMonthOf(dateLike);
  return Boolean(month && month < currentMonth);
}
