"use client";

import { getCategoryColor } from "@/lib/categoryColors";
import type { Category } from "@/lib/types";

type Props = {
  categories: Category[];
  value: Category;
  onChange: (c: Category) => void;
};

export default function CategoryPills({ categories, value, onChange }: Props) {
  return (
    <div className="cat-pills">
      {categories.map((c) => {
        const { color, soft } = getCategoryColor(c);
        const active = value === c;
        return (
          <button
            key={c}
            type="button"
            className={`cat-pill${active ? " active" : ""}`}
            onClick={() => onChange(c)}
            style={{
              color,
              background: active ? soft : undefined,
            }}
          >
            {c}
          </button>
        );
      })}
    </div>
  );
}
