"use client";

import { KeyboardEvent, useState } from "react";
import { addCategory, deleteCategory } from "@/lib/client";
import { getCategoryColor } from "@/lib/categoryColors";
import { FALLBACK_CATEGORY, type Category, type Item } from "@/lib/types";

type Props = {
  categories: Category[];
  items: Item[];
  onClose: () => void;
  onCategoriesChange: (categories: Category[]) => void;
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
      const res = await addCategory(trimmed);
      onCategoriesChange(res.categories);
      setNewName("");
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

  function onEnter(e: KeyboardEvent) {
    if (e.key === "Enter") add();
  }

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
            const { color } = getCategoryColor(c);
            const inUse = items.filter((i) => i.category === c).length;
            const protectedCat = c === FALLBACK_CATEGORY;
            return (
              <div className="cat-mgr-row" key={c}>
                <span className="cat-mgr-name" style={{ color }}>
                  {c}
                </span>
                <span className="cat-mgr-meta">
                  {inUse} item{inUse === 1 ? "" : "s"}
                </span>
                {protectedCat ? (
                  <span className="cat-mgr-protected">default</span>
                ) : (
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => remove(c)}
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
          <div className="use-row">
            <input
              id="new-cat"
              type="text"
              placeholder="e.g. Dairy"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={onEnter}
              maxLength={32}
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
