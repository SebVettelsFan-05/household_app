"use client";

import { CATEGORIES, type Category } from "@/lib/types";

type Props = {
  value: Category;
  onChange: (c: Category) => void;
};

export default function CategoryPills({ value, onChange }: Props) {
  return (
    <div className="cat-pills">
      {CATEGORIES.map((c) => (
        <button
          key={c}
          type="button"
          className={`cat-pill${value === c ? " active" : ""}`}
          data-cat={c}
          onClick={() => onChange(c)}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
