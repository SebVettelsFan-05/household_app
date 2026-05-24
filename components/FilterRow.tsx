"use client";

import { getCategoryColor } from "@/lib/categoryColors";
import type { CategoryDef, FilterCat } from "@/lib/types";

type Props = {
  categories: CategoryDef[];
  value: FilterCat;
  onChange: (f: FilterCat) => void;
};

export default function FilterRow({ categories, value, onChange }: Props) {
  return (
    <div className="filter-row">
      <button
        type="button"
        className={`filter-pill${value === "all" ? " active" : ""}`}
        onClick={() => onChange("all")}
      >
        All
      </button>
      {categories.map((c) => {
        const { color } = getCategoryColor(c.name, c.color);
        const active = value === c.name;
        return (
          <button
            key={c.name}
            type="button"
            className={`filter-pill${active ? " active" : ""}`}
            onClick={() => onChange(c.name)}
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
