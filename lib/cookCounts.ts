import { BUYERS, type Recipe } from "./types";

/**
 * How many dinners each cook has in a set of recipes. "No shared meal"
 * markers carry no cook and are ignored. Roster order so the same names
 * read in the same place week to week.
 */
export function cookCounts(
  recipes: readonly Recipe[]
): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of recipes) {
    if (r.noMeal) continue;
    const name = (r.assignedTo || "").trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const rank = (name: string) => {
    const i = (BUYERS as readonly string[]).indexOf(name);
    return i === -1 ? BUYERS.length : i;
  };
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

/** "Arthur 2 · Eli 1 · Minh 1". Empty string when nobody is assigned. */
export function cookCountsLabel(recipes: readonly Recipe[]): string {
  return cookCounts(recipes)
    .map((c) => `${c.name} ${c.count}`)
    .join(" · ");
}
