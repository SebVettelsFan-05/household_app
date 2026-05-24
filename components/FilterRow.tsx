"use client";

import { getCategoryColor } from "@/lib/categoryColors";
import type { Category, FilterCat } from "@/lib/types";

type Props = {
  categories: Category[];
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
        const { color } = getCategoryColor(c);
        const active = value === c;
        return (
          <button
            key={c}
            type="button"
            className={`filter-pill${active ? " active" : ""}`}
            onClick={() => onChange(c)}
            style={!active ? { color } : undefined}
          >
            <span className="dot-cat" />
            {c}
          </button>
        );
      })}
    </div>
  );
}
