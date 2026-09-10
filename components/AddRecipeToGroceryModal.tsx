"use client";

import { useEffect, useMemo, useState } from "react";
import PoolChips from "@/components/PoolChips";
import { bulkAddGrocery } from "@/lib/client";
import { fmtQty } from "@/lib/format";
import { inventoryItemCounts } from "@/lib/inventoryMatch";
import { normalizeName } from "@/lib/normalize";
import {
  BUYERS,
  FALLBACK_CATEGORY,
  type CategoryDef,
  type GroceryItem,
  type GroceryPool,
  type Item,
  type RecipeIngredient,
} from "@/lib/types";

type Props = {
  recipeName: string;
  ingredients: RecipeIngredient[];
  categories: CategoryDef[];
  defaultAddedBy: string;
  // Base servings the recipe's weights were written for (0 = unknown).
  servings: number;
  // Portions being cooked this time (0 = not set).
  portions: number;
  fridgeItems: Item[];
  onCategoriesReviewed: (ingredients: RecipeIngredient[]) => void;
  onClose: () => void;
  onAdded: (grocery: GroceryItem[], toast: string) => void;
  onError: (msg: string) => void;
};

function resolveCategory(category: string, categories: CategoryDef[]): string {
  const requested = String(category ?? "").trim().toLowerCase();
  const match = categories.find((c) => c.name.toLowerCase() === requested);
  if (match) return match.name;

  const fallback = categories.find(
    (c) => c.name.toLowerCase() === FALLBACK_CATEGORY.toLowerCase()
  );
  return fallback?.name ?? categories[0]?.name ?? FALLBACK_CATEGORY;
}

export default function AddRecipeToGroceryModal({
  recipeName,
  ingredients,
  categories,
  defaultAddedBy,
  servings,
  portions,
  fridgeItems,
  onCategoriesReviewed,
  onClose,
  onAdded,
  onError,
}: Props) {
  // This draft belongs only to the grocery review. Category changes here do
  // not silently mutate the saved recipe the modal was opened from.
  const [draftIngredients, setDraftIngredients] = useState<RecipeIngredient[]>(
    () =>
      ingredients.map((ing) => {
        const category = resolveCategory(ing.category, categories);
        return {
          ...ing,
          category,
          categoryReviewed:
            category === ing.category && ing.categoryReviewed === true,
        };
      })
  );
  const [checked, setChecked] = useState<boolean[]>(
    draftIngredients.map((ingredient) => ingredient.quantity > 0)
  );
  const [categoryTouched, setCategoryTouched] = useState<boolean[]>(
    draftIngredients.map(() => false)
  );
  const [addedBy, setAddedBy] = useState<string>(defaultAddedBy);
  const [store, setStore] = useState<string>("");
  // Recipe ingredients are dinner shopping by definition.
  const [pool, setPool] = useState<GroceryPool>("meals");
  const [busy, setBusy] = useState(false);

  // Weights in the recipe are for `servings` people; we are cooking for
  // `portions`. Scale on the way out only — the recipe itself is untouched.
  const scale =
    servings > 0 && portions > 0 && servings !== portions
      ? portions / servings
      : 1;
  function scaledQuantity(quantity: number): number {
    if (quantity <= 0) return 0;
    if (scale === 1) return quantity;
    return Math.max(1, Math.round(quantity * scale));
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const categoryOptions = useMemo<CategoryDef[]>(
    () =>
      categories.length > 0
        ? categories
        : [{ name: FALLBACK_CATEGORY, color: null }],
    [categories]
  );

  // Categories can be removed elsewhere while the app is open. Keep this
  // review draft valid instead of submitting a now-phantom category.
  useEffect(() => {
    const invalid = draftIngredients.map(
      (ing) => resolveCategory(ing.category, categories) !== ing.category
    );
    if (!invalid.some(Boolean)) return;
    setCategoryTouched((reviewed) =>
      reviewed.map((value, index) =>
        invalid[index] ? false : value
      )
    );
    setDraftIngredients((prev) =>
      prev.map((ing) => {
        const category = resolveCategory(ing.category, categories);
        return category === ing.category
          ? ing
          : { ...ing, category, categoryReviewed: false };
      })
    );
  }, [categories, draftIngredients]);

  const fridgeIndex = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of fridgeItems) {
      const key = normalizeName(it.name);
      const list = map.get(key);
      if (list) list.push(it);
      else map.set(key, [it]);
    }
    return map;
  }, [fridgeItems]);

  const matches = useMemo(
    () =>
      draftIngredients.map(
        (ing) =>
          (fridgeIndex.get(normalizeName(ing.name)) ?? []).find((it) =>
            inventoryItemCounts(it, pool, addedBy)
          ) ?? null
      ),
    [draftIngredients, fridgeIndex, pool, addedBy]
  );

  function toggle(i: number) {
    setChecked((prev) => prev.map((v, idx) => (idx === i ? !v : v)));
  }

  function selectAll() {
    setChecked(
      draftIngredients.map((ingredient) => ingredient.quantity > 0)
    );
  }
  function selectNone() {
    setChecked(draftIngredients.map(() => false));
  }

  function updateCategory(index: number, category: string) {
    const safeCategory = resolveCategory(category, categories);
    setDraftIngredients((prev) =>
      prev.map((ing, i) =>
        i === index
          ? {
              ...ing,
              category: safeCategory,
              categoryReviewed: true,
            }
          : ing
      )
    );
    setCategoryTouched((prev) =>
      prev.map((reviewed, i) => (i === index ? true : reviewed))
    );
  }

  async function submit() {
    if (!addedBy) {
      onError("Pick who's adding this");
      return;
    }
    const toAdd = draftIngredients
      .map((ingredient, index) => ({ ingredient, index }))
      .filter(
        ({ ingredient, index }) =>
          checked[index] && ingredient.quantity > 0
      );
    if (toAdd.length === 0) {
      onError("Nothing checked");
      return;
    }
    setBusy(true);
    try {
      const res = await bulkAddGrocery({
        items: toAdd.map(({ ingredient, index }) => ({
          name: ingredient.name,
          quantity: scaledQuantity(ingredient.quantity),
          category: resolveCategory(ingredient.category, categories),
          categoryReviewed: ingredient.categoryReviewed === true,
          store: store || undefined,
          addedBy,
          pool,
        })),
      });
      const reviewedCount = toAdd.filter(
        ({ index }) => categoryTouched[index]
      ).length;
      if (reviewedCount > 0) {
        onCategoriesReviewed(draftIngredients);
      }
      onAdded(
        res.grocery,
        `Added ${toAdd.length} item${toAdd.length === 1 ? "" : "s"} to grocery list${
          reviewedCount > 0
            ? "; category edits applied to the recipe draft"
            : ""
        }`
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

        {scale !== 1 ? (
          <p className="scale-note">
            Scaled x{String(Math.round(scale * 100) / 100)} for {portions} of{" "}
            {servings} servings
          </p>
        ) : null}

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
          {draftIngredients.map((ing, i) => {
            const match = matches[i];
            const qty = fmtQty(scaledQuantity(ing.quantity));
            const hasQuantity = ing.quantity > 0;
            return (
              <div className="ing-add-row" key={i}>
                <label className="ing-add-choice">
                  <input
                    type="checkbox"
                    checked={checked[i] ?? false}
                    onChange={() => toggle(i)}
                    disabled={busy || !hasQuantity}
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
                        in inventory
                      </div>
                    ) : null}
                    {!hasQuantity ? (
                      <div className="ing-add-hint">
                        Add a weight in the recipe before putting this item on
                        the grocery list.
                      </div>
                    ) : null}
                  </div>
                </label>
                <select
                  className="ingredient-cat ing-add-category"
                  aria-label={`Category for ${ing.name}`}
                  value={resolveCategory(ing.category, categories)}
                  onChange={(e) => updateCategory(i, e.target.value)}
                  disabled={busy || !checked[i]}
                >
                  {categoryOptions.map((category) => (
                    <option key={category.name} value={category.name}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        <div className="field">
          <label>Pool</label>
          <PoolChips value={pool} onChange={setPool} disabled={busy} />
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
