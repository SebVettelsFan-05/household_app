"use client";

import { useMemo, useState } from "react";
import { getCategoryColor } from "@/lib/categoryColors";
import { fmtQty } from "@/lib/format";
import { normalizeName } from "@/lib/normalize";
import {
  FALLBACK_CATEGORY,
  type CategoryDef,
  type Item,
  type RecipeIngredient,
} from "@/lib/types";

type Props = {
  value: RecipeIngredient[];
  onChange: (next: RecipeIngredient[]) => void;
  categories: CategoryDef[];
  fridgeItems: Item[];
};

export default function IngredientList({
  value,
  onChange,
  categories,
  fridgeItems,
}: Props) {
  const [draftName, setDraftName] = useState("");
  const [draftQty, setDraftQty] = useState("");
  const [draftCat, setDraftCat] = useState<string>(FALLBACK_CATEGORY);

  const fridgeIndex = useMemo(() => {
    const map = new Map<string, Item>();
    for (const it of fridgeItems) {
      map.set(normalizeName(it.name), it);
    }
    return map;
  }, [fridgeItems]);

  function findInFridge(name: string): Item | null {
    const key = normalizeName(name);
    if (!key) return null;
    return fridgeIndex.get(key) ?? null;
  }

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

  const draftMatch = findInFridge(draftName);

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
          const match = findInFridge(ing.name);
          return (
            <div className="ingredient-block" key={i}>
              <div className="ingredient-row">
                <span
                  className="ingredient-dot"
                  style={{ background: color }}
                />
                <input
                  className="ingredient-name"
                  type="text"
                  value={ing.name}
                  onChange={(e) =>
                    updateIngredient(i, { name: e.target.value })
                  }
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
              {match ? (
                <div className="ingredient-fridge-hint">
                  In inventory:{" "}
                  <strong>
                    {fmtQty(match.quantity).num}
                    {fmtQty(match.quantity).unit}
                  </strong>{" "}
                  of {match.name}
                </div>
              ) : null}
            </div>
          );
        })
      )}

      <div className="ingredient-add-block">
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
        {draftMatch ? (
          <div className="ingredient-fridge-hint">
            In inventory:{" "}
            <strong>
              {fmtQty(draftMatch.quantity).num}
              {fmtQty(draftMatch.quantity).unit}
            </strong>{" "}
            of {draftMatch.name}
          </div>
        ) : null}
      </div>
    </div>
  );
}
