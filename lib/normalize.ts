export const FALLBACK_CATEGORY = "Other";
export const DEFAULT_CATEGORIES = ["Meat", "Veggies", "Other"];

export function normalizeName(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function pickCategory(input: string | undefined, validList: string[]): string {
  const s = String(input ?? "").trim();
  if (!s) return FALLBACK_CATEGORY;
  const match = validList.find((v) => v.toLowerCase() === s.toLowerCase());
  return match || FALLBACK_CATEGORY;
}

export function formatDate(d: Date | null | undefined): string {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
