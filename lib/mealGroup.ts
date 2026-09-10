import { BUYERS, isBuyer, type MealGroup } from "./types";

/**
 * The meal group as the UI should read it: an empty (or missing) group means
 * "everyone", which is exactly the old five-way behaviour. Returns names in
 * roster order so cook dropdowns and "Meals (n)" labels stay stable.
 */
export function effectiveMealGroup(
  group: MealGroup | null | undefined
): string[] {
  const members = (group?.members ?? []).filter(isBuyer);
  if (members.length === 0) return [...BUYERS];
  return BUYERS.filter((b) => members.includes(b));
}
