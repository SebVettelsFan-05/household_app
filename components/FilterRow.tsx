"use client";

import { getCategoryColor } from "@/lib/categoryColors";
import type { CategoryDef } from "@/lib/types";

type Props = {
  categories: CategoryDef[];
  // Empty set = "no filter, show everything". Each pill toggles its membership.
  selected: Set<string>;
  onToggle: (name: string) => void;
  // Clears the entire selection so the list reverts to showing every item.
  onClear: () => void;
};

export default function FilterRow({
  categories,
  selected,
  onToggle,
  onClear,
}: Props) {
  const showingAll = selected.size === 0;
  return (
    <div className="filter-row">
      <button
        type="button"
        className={`filter-pill${showingAll ? " active" : ""}`}
        onClick={onClear}
        title="Clear category filters"
      >
        All
      </button>
      {categories.map((c) => {
        const color = getCategoryColor(c.name, c.color);
        const active = selected.has(c.name);
        return (
          <button
            key={c.name}
            type="button"
            className={`filter-pill${active ? " active" : ""}`}
            onClick={() => onToggle(c.name)}
            aria-pressed={active}
            style={!active ? { color } : undefined}
          >
            <span className="dot-cat" />
            {c.name}
          </button>
        );
      })}
    </div>
  );
}
