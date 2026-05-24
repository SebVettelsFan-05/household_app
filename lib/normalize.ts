export const FALLBACK_CATEGORY = "Other";
export const DEFAULT_CATEGORIES = ["Meat", "Veggies", "Other"];

export const EXPENSE_FALLBACK = "Misc";
export const DEFAULT_EXPENSE_CATEGORIES = ["Rent + Utilities", "Food", "Misc"];

export function normalizeName(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function pickCategory(
  input: string | undefined,
  validList: string[],
  fallback: string = FALLBACK_CATEGORY
): string {
  const s = String(input ?? "").trim();
  if (!s) return fallback;
  const match = validList.find((v) => v.toLowerCase() === s.toLowerCase());
  return match || fallback;
}

export function formatDate(d: Date | null | undefined): string {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
