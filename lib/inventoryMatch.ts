import type { GroceryPool, Item } from "./types";

/**
 * Whether an inventory item answers a grocery request for the same name.
 * Shared food (no owner) always counts; somebody's own food only counts for
 * their own personal request, so Eli's chicken never suppresses the "buy
 * chicken" warning for the house or the meal group.
 */
export function inventoryItemCounts(
  item: Pick<Item, "owner">,
  pool: GroceryPool,
  requester: string
): boolean {
  const owner = (item.owner || "").trim();
  if (!owner) return true;
  return pool === "personal" && owner === requester.trim();
}
