"use client";

import { useState } from "react";
import { getCategoryColor } from "@/lib/categoryColors";
import {
  FALLBACK_CATEGORY,
  type CategoryDef,
  type RecipeIngredient,
} from "@/lib/types";

type Props = {
  value: RecipeIngredient[];
  onChange: (next: RecipeIngredient[]) => void;
  categories: CategoryDef[];
};

export default function IngredientList({ value, onChange, categories }: Props) {
  const [draftName, setDraftName] = useState("");
  const [draftQty, setDraftQty] = useState("");
  const [draftCat, setDraftCat] = useState<string>(FALLBACK_CATEGORY);

  function add() {
    const name = draftName.trim();
    const qty = parseFloat(draftQty);
    if (!name || !qty || qty <= 0) return;
    onChange([
      ...value,
      { name, quantity: qty, category: draftCat || FALLBACK_CATEGORY },
    ]);
    setDraftName("");
    setDraftQty("");
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  function updateIngredient(idx: number, patch: Partial<RecipeIngredient>) {
    onChange(value.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  return (
    <div className="ingredient-list">
      {value.length === 0 ? (
        <div className="ingredient-empty">No ingredients yet.</div>
      ) : (
        value.map((ing, i) => {
          const color = getCategoryColor(
            ing.category,
            categories.find((c) => c.name === ing.category)?.color ?? null
          );
          return (
            <div className="ingredient-row" key={i}>
              <span className="ingredient-dot" style={{ background: color }} />
              <input
                className="ingredient-name"
                type="text"
                value={ing.name}
                onChange={(e) => updateIngredient(i, { name: e.target.value })}
              />
              <input
                className="ingredient-qty"
                type="number"
                inputMode="numeric"
                min={0}
                value={ing.quantity}
                onChange={(e) =>
                  updateIngredient(i, { quantity: Number(e.target.value) })
                }
              />
              <span className="ingredient-unit">g</span>
              <select
                className="ingredient-cat"
                value={ing.category}
                onChange={(e) =>
                  updateIngredient(i, { category: e.target.value })
                }
              >
                {categories.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ingredient-remove"
                onClick={() => remove(i)}
                aria-label="Remove ingredient"
              >
                ×
              </button>
            </div>
          );
        })
      )}

      <div className="ingredient-add">
        <input
          className="ingredient-name"
          type="text"
          placeholder="Add ingredient…"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <input
          className="ingredient-qty"
          type="number"
          inputMode="numeric"
          min={0}
          placeholder="g"
          value={draftQty}
          onChange={(e) => setDraftQty(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <select
          className="ingredient-cat"
          value={draftCat}
          onChange={(e) => setDraftCat(e.target.value)}
        >
          {categories.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ingredient-add-btn"
          onClick={add}
          disabled={!draftName.trim() || !parseFloat(draftQty)}
        >
          Add
        </button>
      </div>
    </div>
  );
}
