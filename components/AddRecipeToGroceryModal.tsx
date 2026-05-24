"use client";

import { useMemo, useState } from "react";
import { bulkAddGrocery } from "@/lib/client";
import { fmtQty } from "@/lib/format";
import { normalizeName } from "@/lib/normalize";
import {
  BUYERS,
  type GroceryItem,
  type Item,
  type RecipeIngredient,
} from "@/lib/types";

type Props = {
  recipeName: string;
  ingredients: RecipeIngredient[];
  defaultAddedBy: string;
  fridgeItems: Item[];
  onClose: () => void;
  onAdded: (grocery: GroceryItem[], toast: string) => void;
  onError: (msg: string) => void;
};

export default function AddRecipeToGroceryModal({
  recipeName,
  ingredients,
  defaultAddedBy,
  fridgeItems,
  onClose,
  onAdded,
  onError,
}: Props) {
  const [checked, setChecked] = useState<boolean[]>(ingredients.map(() => true));
  const [addedBy, setAddedBy] = useState<string>(defaultAddedBy);
  const [store, setStore] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const fridgeIndex = useMemo(() => {
    const map = new Map<string, Item>();
    for (const it of fridgeItems) {
      map.set(normalizeName(it.name), it);
    }
    return map;
  }, [fridgeItems]);

  const matches = useMemo(
    () =>
      ingredients.map(
        (ing) => fridgeIndex.get(normalizeName(ing.name)) ?? null
      ),
    [ingredients, fridgeIndex]
  );

  function toggle(i: number) {
    setChecked((prev) => prev.map((v, idx) => (idx === i ? !v : v)));
  }

  function selectAll() {
    setChecked(ingredients.map(() => true));
  }
  function selectNone() {
    setChecked(ingredients.map(() => false));
  }

  async function submit() {
    if (!addedBy) {
      onError("Pick who's adding this");
      return;
    }
    const toAdd = ingredients.filter((_, i) => checked[i]);
    if (toAdd.length === 0) {
      onError("Nothing checked");
      return;
    }
    setBusy(true);
    try {
      const res = await bulkAddGrocery({
        items: toAdd.map((ing) => ({
          name: ing.name,
          quantity: ing.quantity,
          category: ing.category,
          store: store || undefined,
          addedBy,
        })),
      });
      onAdded(
        res.grocery,
        `Added ${toAdd.length} item${toAdd.length === 1 ? "" : "s"} to grocery list`
      );
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const checkedCount = checked.filter(Boolean).length;

  return (
    <div
      className="modal-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal modal-wide">
        <div className="modal-header">
          <h2>Add to grocery list</h2>
          <span className="modal-sub">{recipeName || "Recipe"}</span>
        </div>

        <div className="ingredient-actions">
          <button
            type="button"
            className="manage-link"
            onClick={selectAll}
            disabled={busy}
          >
            Select all
          </button>
          <button
            type="button"
            className="manage-link"
            onClick={selectNone}
            disabled={busy}
          >
            None
          </button>
        </div>

        <div className="ing-add-list">
          {ingredients.map((ing, i) => {
            const match = matches[i];
            const qty = fmtQty(ing.quantity);
            return (
              <label className="ing-add-row" key={i}>
                <input
                  type="checkbox"
                  checked={checked[i] ?? false}
                  onChange={() => toggle(i)}
                  disabled={busy}
                />
                <div className="ing-add-body">
                  <div className="ing-add-name">
                    {ing.name}{" "}
                    <span className="ing-add-qty">
                      {qty.num}
                      {qty.unit}
                    </span>
                  </div>
                  {match ? (
                    <div className="ing-add-hint">
                      You already have{" "}
                      <strong>
                        {fmtQty(match.quantity).num}
                        {fmtQty(match.quantity).unit}
                      </strong>{" "}
                      in the fridge
                    </div>
                  ) : null}
                </div>
              </label>
            );
          })}
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="rg-by">Added by</label>
            <select
              id="rg-by"
              className="select"
              value={addedBy}
              onChange={(e) => setAddedBy(e.target.value)}
            >
              <option value="" disabled>
                Pick a name…
              </option>
              {BUYERS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rg-store">Store (optional)</label>
            <input
              id="rg-store"
              type="text"
              placeholder="e.g. Costco"
              value={store}
              onChange={(e) => setStore(e.target.value)}
            />
          </div>
        </div>

        <div className="modal-actions">
          <div />
          <div className="right">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ background: "var(--accent)", color: "white" }}
              onClick={submit}
              disabled={busy || checkedCount === 0}
            >
              {busy
                ? "Adding…"
                : `Add ${checkedCount} item${checkedCount === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
