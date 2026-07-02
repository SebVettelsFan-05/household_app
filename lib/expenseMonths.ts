export const FIRST_EXPENSE_MONTH = "2026-05";

export function monthKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
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
