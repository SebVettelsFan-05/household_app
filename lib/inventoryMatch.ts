import { normalizeName } from "./normalize";

/**
 * The inventory row that answers a grocery request for `name`, if there is
 * one. Plain name match — inventory is shared household food, so anything on
 * the shelf counts against buying more of it.
 */
export function findInventoryMatch<T extends { name: string }>(
  items: T[],
  name: string
): T | null {
  const norm = normalizeName(name);
  if (!norm) return null;
  return items.find((i) => normalizeName(i.name) === norm) ?? null;
}
