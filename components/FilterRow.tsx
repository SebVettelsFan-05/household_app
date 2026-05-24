"use client";

import { CATEGORIES, type FilterCat } from "@/lib/types";

type Props = {
  value: FilterCat;
  onChange: (f: FilterCat) => void;
};

export default function FilterRow({ value, onChange }: Props) {
  return (
    <div className="filter-row">
      <button
        type="button"
        className={`filter-pill${value === "all" ? " active" : ""}`}
        data-filter="all"
        onClick={() => onChange("all")}
      >
        All
      </button>
      {CATEGORIES.map((c) => (
        <button
          key={c}
          type="button"
          className={`filter-pill${value === c ? " active" : ""}`}
          data-filter={c}
          onClick={() => onChange(c)}
        >
          <span className="dot-cat" />
          {c}
        </button>
      ))}
    </div>
  );
}
