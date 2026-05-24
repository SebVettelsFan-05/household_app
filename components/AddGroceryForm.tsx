"use client";

import { KeyboardEvent, useEffect, useMemo, useState } from "react";
import { addGrocery } from "@/lib/client";
import { fmtQty } from "@/lib/format";
import { normalizeName } from "@/lib/normalize";
import {
  BUYERS,
  FALLBACK_CATEGORY,
  type Category,
  type CategoryDef,
  type GroceryItem,
  type Item,
} from "@/lib/types";
import CategoryPills from "./CategoryPills";

type Props = {
  categories: CategoryDef[];
  fridgeItems: Item[];
  onResult: (grocery: GroceryItem[], toast: string) => void;
  onError: (message: string) => void;
  onManageCategories: () => void;
};

export default function AddGroceryForm({
  categories,
  fridgeItems,
  onResult,
  onError,
  onManageCategories,
}: Props) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [cat, setCat] = useState<Category>(FALLBACK_CATEGORY);
  const [store, setStore] = useState("");
  const [addedBy, setAddedBy] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (categories.length > 0 && !categories.some((c) => c.name === cat)) {
      const hasFallback = categories.some((c) => c.name === FALLBACK_CATEGORY);
      setCat(hasFallback ? FALLBACK_CATEGORY : categories[0].name);
    }
  }, [categories, cat]);

  // Soft warning: if the typed name matches something already in the fridge.
  const fridgeMatch = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const norm = normalizeName(trimmed);
    return fridgeItems.find((i) => normalizeName(i.name) === norm) ?? null;
  }, [name, fridgeItems]);

  async function submit() {
    const trimmed = name.trim();
    const qtyNum = parseFloat(qty);
    if (!trimmed) {
      onError("Name is required");
      return;
    }
    if (!qtyNum || qtyNum <= 0) {
      onError("Quantity must be > 0");
      return;
    }
    if (!addedBy) {
      onError("Pick who's adding this");
      return;
    }
    setBusy(true);
    try {
      const res = await addGrocery({
        name: trimmed,
        quantity: qtyNum,
        category: cat,
        store: store.trim() || undefined,
        addedBy,
      });
      onResult(res.grocery, "Added to list");
      setName("");
      setQty("");
      setStore("");
      // Keep addedBy + category so repeated entries are fast.
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onEnter(e: KeyboardEvent) {
    if (e.key === "Enter") submit();
  }

  const matchQty = fridgeMatch ? fmtQty(fridgeMatch.quantity) : null;

  return (
    <section className="add-card">
      <h2>Add to list</h2>
      <div className="field">
        <label htmlFor="g-name">Name</label>
        <input
          id="g-name"
          type="text"
          placeholder="e.g. Almond milk"
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onEnter}
        />
        {fridgeMatch && matchQty ? (
          <div className="fridge-hint" role="status">
            <span className="fridge-hint-dot" />
            <span>
              You already have <strong>{matchQty.num}{matchQty.unit}</strong> of{" "}
              <strong>{fridgeMatch.name}</strong> in the fridge.
            </span>
          </div>
        ) : null}
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
        <CategoryPills categories={categories} value={cat} onChange={setCat} />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="g-qty">Quantity (g)</label>
          <input
            id="g-qty"
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="500"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onKeyDown={onEnter}
          />
        </div>
        <div className="field">
          <label htmlFor="g-store">Store (optional)</label>
          <input
            id="g-store"
            type="text"
            placeholder="e.g. Costco"
            autoComplete="off"
            value={store}
            onChange={(e) => setStore(e.target.value)}
            onKeyDown={onEnter}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="g-by">Added by</label>
        <select
          id="g-by"
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

      <button
        className="btn-primary"
        onClick={submit}
        disabled={busy}
        type="button"
      >
        {busy ? "Adding…" : "Add to list"}
      </button>
    </section>
  );
}
