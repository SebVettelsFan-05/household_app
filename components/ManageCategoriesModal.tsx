"use client";

import { KeyboardEvent, useState } from "react";
import {
  addCategory,
  deleteCategory,
  updateCategoryColor,
} from "@/lib/client";
import { getCategoryColor } from "@/lib/categoryColors";
import {
  FALLBACK_CATEGORY,
  type CategoryDef,
  type Item,
} from "@/lib/types";

type Props = {
  categories: CategoryDef[];
  items: Item[];
  onClose: () => void;
  onCategoriesChange: (categories: CategoryDef[]) => void;
  onItemsChange: (items: Item[]) => void;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
};

export default function ManageCategoriesModal({
  categories,
  items,
  onClose,
  onCategoriesChange,
  onItemsChange,
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
    const usingCount = items.filter((i) => i.category === name).length;
    const msg = usingCount
      ? `Delete "${name}"? ${usingCount} item${usingCount === 1 ? "" : "s"} will move to "${FALLBACK_CATEGORY}".`
      : `Delete "${name}"?`;
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      const res = await deleteCategory(name);
      onCategoriesChange(res.categories);
      onItemsChange(res.items);
      onToast(
        res.reassigned
          ? `Removed "${name}" — ${res.reassigned} item${res.reassigned === 1 ? "" : "s"} reassigned`
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
    (newName.trim() ? getCategoryColor(newName.trim()).color : "#8B8278");

  return (
    <div
      className="modal-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <h2>Categories</h2>
        <div className="cat-mgr-list">
          {categories.map((c) => {
            const resolved = getCategoryColor(c.name, c.color);
            const inUse = items.filter((i) => i.category === c.name).length;
            const protectedCat = c.name === FALLBACK_CATEGORY;
            const swatchValue = c.color || resolved.color;
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
                <span className="cat-mgr-name" style={{ color: resolved.color }}>
                  {c.name}
                </span>
                <span className="cat-mgr-meta">
                  {inUse} item{inUse === 1 ? "" : "s"}
                </span>
                {c.color ? (
                  <button
                    type="button"
                    className="cat-mgr-link"
                    onClick={() => resetColor(c.name)}
                    disabled={busy}
                    title="Reset to default palette color"
                  >
                    Reset
                  </button>
                ) : null}
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

        <div className="modal-actions">
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
        </div>
      </div>
    </div>
  );
}
