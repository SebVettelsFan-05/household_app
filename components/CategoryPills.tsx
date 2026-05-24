"use client";

import { getCategoryColor } from "@/lib/categoryColors";
import type { Category, CategoryDef } from "@/lib/types";

type Props = {
  categories: CategoryDef[];
  value: Category;
  onChange: (c: Category) => void;
};

export default function CategoryPills({ categories, value, onChange }: Props) {
  return (
    <div className="cat-pills">
      {categories.map((c) => {
        const { color, soft } = getCategoryColor(c.name, c.color);
        const active = value === c.name;
        return (
          <button
            key={c.name}
            type="button"
            className={`cat-pill${active ? " active" : ""}`}
            onClick={() => onChange(c.name)}
            style={{
              color,
              background: active ? soft : undefined,
            }}
          >
            {c.name}
          </button>
        );
      })}
    </div>
  );
}
