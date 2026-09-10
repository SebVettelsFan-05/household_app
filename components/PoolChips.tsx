"use client";

import { GROCERY_POOLS, type GroceryPool } from "@/lib/types";

export const POOL_LABELS: Record<GroceryPool, string> = {
  house: "House",
  meals: "Meals",
  personal: "Personal",
};

/** Which pool a grocery request belongs to. Same chips everywhere it is set. */
export default function PoolChips({
  value,
  onChange,
  disabled = false,
}: {
  value: GroceryPool;
  onChange: (pool: GroceryPool) => void;
  disabled?: boolean;
}) {
  return (
    <div className="pool-chips">
      {GROCERY_POOLS.map((p) => (
        <button
          key={p}
          type="button"
          className={`pool-chip${value === p ? " active" : ""}`}
          onClick={() => onChange(p)}
          disabled={disabled}
          aria-pressed={value === p}
        >
          {POOL_LABELS[p]}
        </button>
      ))}
    </div>
  );
}
