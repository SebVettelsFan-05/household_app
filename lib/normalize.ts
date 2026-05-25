export const FALLBACK_CATEGORY = "Other";
// Mainstays appear in this canonical order in dropdowns / pill rows. They
// can't be deleted, but their colors are still editable.
export const MAINSTAY_CATEGORIES = [
  "Meat",
  "Veggies",
  "Fruits",
  "Dairy",
  "Bakery",
  "Pantry",
  "Frozen",
  "Snacks",
  "Beverages",
  "Condiments",
];
export const DEFAULT_CATEGORIES = [...MAINSTAY_CATEGORIES, FALLBACK_CATEGORY];

export const EXPENSE_FALLBACK = "Misc";
export const DEFAULT_EXPENSE_CATEGORIES = ["Rent + Utilities", "Food", "Misc"];

// User-added categories first (A–Z), then mainstays in their canonical order,
// with the fallback ("Other") always pinned to the very end.
export function sortCategories<T extends { name: string }>(cats: T[]): T[] {
  const mainstayLower = MAINSTAY_CATEGORIES.map((m) => m.toLowerCase());
  const fallbackLower = FALLBACK_CATEGORY.toLowerCase();
  const userAdded: T[] = [];
  const mainstays: T[] = [];
  let fallback: T | undefined;
  for (const c of cats) {
    const lc = c.name.toLowerCase();
    if (lc === fallbackLower) {
      fallback = c;
    } else if (mainstayLower.includes(lc)) {
      mainstays.push(c);
    } else {
      userAdded.push(c);
    }
  }
  userAdded.sort((a, b) => a.name.localeCompare(b.name));
  mainstays.sort(
    (a, b) =>
      mainstayLower.indexOf(a.name.toLowerCase()) -
      mainstayLower.indexOf(b.name.toLowerCase())
  );
  return [...userAdded, ...mainstays, ...(fallback ? [fallback] : [])];
}

/**
 * Combines existing and incoming "addedBy" values for a merged grocery row.
 * Both can be comma-separated already (after prior merges). Result is
 * deduped (case-insensitive) and sorted A→Z so the UI stays predictable.
 */
export function mergeAddedBy(existing: string, incoming: string): string {
  const seen = new Map<string, string>(); // lowercase → original casing
  for (const raw of `${existing},${incoming}`.split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) seen.set(key, trimmed);
  }
  return Array.from(seen.values())
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
}

export function isProtectedCategory(name: string): boolean {
  const lc = name.toLowerCase();
  if (lc === FALLBACK_CATEGORY.toLowerCase()) return true;
  return MAINSTAY_CATEGORIES.some((m) => m.toLowerCase() === lc);
}

export function normalizeName(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

// "chicken NOODLE soup" → "Chicken Noodle Soup". Preserves internal
// non-letter characters (hyphens, apostrophes) so things like "Reese's" and
// "Half-and-half" survive intact.
export function titleCaseName(s: string): string {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/(^|[\s\-/])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
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
