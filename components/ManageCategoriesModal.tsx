"use client";

import { KeyboardEvent, useState } from "react";
import ModalFrame from "@/components/ModalFrame";
import {
  addCategory,
  deleteCategory,
  getCategoryUsage,
  listGrocery,
  listRecipes,
  updateCategoryColor,
  type CategoryUsage,
} from "@/lib/client";
import { getCategoryColor } from "@/lib/categoryColors";
import { isProtectedCategory, sortCategories } from "@/lib/normalize";
import {
  FALLBACK_CATEGORY,
  type CategoryDef,
  type GroceryItem,
  type Item,
  type Recipe,
} from "@/lib/types";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "3 items, 1 grocery row and 4 recipe ingredients will move to "Other"." */
function usageSentence(usage: CategoryUsage): string {
  const recipeIngredients =
    usage.recipeIngredients + usage.favoriteIngredients;
  const parts = [
    usage.items > 0 ? plural(usage.items, "item", "items") : "",
    usage.grocery > 0 ? plural(usage.grocery, "grocery row", "grocery rows") : "",
    recipeIngredients > 0
      ? plural(recipeIngredients, "recipe ingredient", "recipe ingredients")
      : "",
  ].filter(Boolean);
  if (parts.length === 0) return "Nothing uses it.";
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `${list} will move to "${FALLBACK_CATEGORY}".`;
}

type Props = {
  categories: CategoryDef[];
  items: Item[];
  onClose: () => void;
  onCategoriesChange: (categories: CategoryDef[]) => void;
  onItemsChange: (items: Item[]) => void;
  // A delete reassigns grocery rows and recipe ingredients as well, so the
  // screens showing them have to be told.
  onGroceryChange: (grocery: GroceryItem[]) => void;
  onRecipesChange: (recipes: Recipe[]) => void;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
};

export default function ManageCategoriesModal({
  categories,
  items,
  onClose,
  onCategoriesChange,
  onItemsChange,
  onGroceryChange,
  onRecipesChange,
  onToast,
  onError,
}: Props) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function add() {
    const trimmed = newName.trim();
    if (!trimmed) {
      onError("Name is required");
      return;
    }
    if (trimmed.length > 32) {
      onError("Name is too long");
      return;
    }
    setBusy(true);
    try {
      const res = await addCategory(trimmed, newColor || null);
      onCategoriesChange(res.categories);
      setNewName("");
      setNewColor("");
      onToast(res.existed ? `"${trimmed}" already exists` : `Added "${trimmed}"`);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(name: string) {
    // The server counts, not this modal: it only holds the inventory rows,
    // and the grocery list and recipe ingredients move to the fallback too.
    const usage = await getCategoryUsage(name).catch(() => null);
    const msg = usage
      ? `Delete "${name}"? ${usageSentence(usage)}`
      : `Delete "${name}"? Everything using it will move to "${FALLBACK_CATEGORY}".`;
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      const res = await deleteCategory(name);
      onCategoriesChange(res.categories);
      onItemsChange(res.items);
      // The lists the server just rewrote under us.
      onGroceryChange(await listGrocery());
      onRecipesChange(await listRecipes());
      onToast(
        res.reassigned
          ? `Removed "${name}", ${res.reassigned} reference${res.reassigned === 1 ? "" : "s"} moved to ${FALLBACK_CATEGORY}`
          : `Removed "${name}"`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function changeColor(name: string, hex: string) {
    setBusy(true);
    try {
      const res = await updateCategoryColor(name, hex);
      onCategoriesChange(res.categories);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function resetColor(name: string) {
    setBusy(true);
    try {
      const res = await updateCategoryColor(name, null);
      onCategoriesChange(res.categories);
      onToast(`Reset "${name}" to default color`);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onEnter(e: KeyboardEvent) {
    if (e.key === "Enter") add();
  }

  // Resolve a color for the "new category" preview swatch — falls back to a
  // neutral grey when no name/color is chosen yet.
  const newSwatch =
    newColor ||
    (newName.trim() ? getCategoryColor(newName.trim()) : "#8B8278");

  return (
    <ModalFrame
      title="Categories"
      onClose={onClose}
      actions={
        <>
          <div />
          <div className="right">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={busy}
            >
              Done
            </button>
          </div>
        </>
      }
    >
      <div className="cat-mgr-list">
        {sortCategories(categories).map((c) => {
          const resolved = getCategoryColor(c.name, c.color);
          const inUse = items.filter((i) => i.category === c.name).length;
          const protectedCat = isProtectedCategory(c.name);
          const swatchValue = c.color || resolved;
          const inputId = `color-${c.name}`;
          return (
            <div className="cat-mgr-row" key={c.name}>
              <label
                htmlFor={inputId}
                className="cat-swatch"
                style={{ background: swatchValue }}
                title="Click to change color"
              />
              <input
                id={inputId}
                type="color"
                className="cat-color-input"
                value={swatchValue}
                disabled={busy}
                onChange={(e) => changeColor(c.name, e.target.value)}
              />
              <span className="cat-mgr-name" style={{ color: resolved }}>
                {c.name}
              </span>
              <span className="cat-mgr-meta">
                {inUse} item{inUse === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                className="cat-mgr-link"
                onClick={() => resetColor(c.name)}
                disabled={busy || !c.color}
                title={
                  c.color
                    ? "Reset to default palette color"
                    : "Already using default color"
                }
              >
                Reset
              </button>
              {protectedCat ? (
                <span className="cat-mgr-protected">default</span>
              ) : (
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => remove(c.name)}
                  disabled={busy}
                >
                  Remove
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="field">
        <label htmlFor="new-cat">New category</label>
        <div className="new-cat-row">
          <label
            htmlFor="new-cat-color"
            className="cat-swatch"
            style={{ background: newSwatch }}
            title="Pick a color"
          />
          <input
            id="new-cat-color"
            type="color"
            className="cat-color-input"
            value={newColor || newSwatch}
            onChange={(e) => setNewColor(e.target.value)}
            disabled={busy}
          />
          <input
            id="new-cat"
            type="text"
            placeholder="e.g. Dairy"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={onEnter}
            maxLength={32}
            disabled={busy}
          />
          <button
            type="button"
            className="btn-accent"
            onClick={add}
            disabled={busy}
          >
            Add
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}
