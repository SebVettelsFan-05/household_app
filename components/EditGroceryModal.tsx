"use client";

import { useEffect, useState } from "react";
import { deleteGrocery, updateGrocery } from "@/lib/client";
import {
  BUYERS,
  FALLBACK_CATEGORY,
  type Category,
  type CategoryDef,
  type GroceryItem,
} from "@/lib/types";
import CategoryPills from "./CategoryPills";

type Props = {
  item: GroceryItem;
  categories: CategoryDef[];
  onClose: () => void;
  onResult: (grocery: GroceryItem[], toast: string) => void;
  onError: (message: string) => void;
  onManageCategories: () => void;
};

export default function EditGroceryModal({
  item,
  categories,
  onClose,
  onResult,
  onError,
  onManageCategories,
}: Props) {
  const [name, setName] = useState(item.name);
  const [qty, setQty] = useState(String(item.quantity));
  const [cat, setCat] = useState<Category>(item.category || FALLBACK_CATEGORY);
  const [store, setStore] = useState(item.store || "");
  const [addedBy, setAddedBy] = useState(item.addedBy);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (categories.length > 0 && !categories.some((c) => c.name === cat)) {
      const hasFallback = categories.some((c) => c.name === FALLBACK_CATEGORY);
      setCat(hasFallback ? FALLBACK_CATEGORY : categories[0].name);
    }
  }, [categories, cat]);

  async function save() {
    const trimmed = name.trim();
    const qtyNum = parseFloat(qty);
    if (!trimmed || !qtyNum || qtyNum <= 0) {
      onError("Check your inputs");
      return;
    }
    if (!addedBy) {
      onError("Pick who's adding this");
      return;
    }
    setBusy(true);
    try {
      const res = await updateGrocery({
        id: item.id,
        name: trimmed,
        quantity: qtyNum,
        category: cat,
        store,
        addedBy,
      });
      onResult(res.grocery, "Saved");
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!confirm("Remove this item from the list?")) return;
    setBusy(true);
    try {
      const res = await deleteGrocery(item.id);
      onResult(res.grocery, "Removed");
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <h2>Edit grocery item</h2>
        <div className="field">
          <label htmlFor="eg-name">Name</label>
          <input
            id="eg-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <div className="cat-pills-row">
            <label>Category</label>
            <button
              type="button"
              className="manage-link"
              onClick={onManageCategories}
            >
              Manage
            </button>
          </div>
          <CategoryPills
            categories={categories}
            value={cat}
            onChange={setCat}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="eg-qty">Quantity (g)</label>
            <input
              id="eg-qty"
              type="number"
              inputMode="numeric"
              min={0}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="eg-store">Store</label>
            <input
              id="eg-store"
              type="text"
              value={store}
              onChange={(e) => setStore(e.target.value)}
              placeholder="(optional)"
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="eg-by">Added by</label>
          <select
            id="eg-by"
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

        <div className="modal-actions">
          <button
            type="button"
            className="btn-danger"
            onClick={del}
            disabled={busy}
          >
            Remove
          </button>
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
              onClick={save}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
