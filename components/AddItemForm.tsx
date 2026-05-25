"use client";

import { KeyboardEvent, useEffect, useMemo, useState } from "react";
import ScanLabelModal, {
  type ScanResult,
} from "@/components/ScanLabelModal";
import { addItem } from "@/lib/client";
import { guessCategory } from "@/lib/guessCategory";
import {
  FALLBACK_CATEGORY,
  type Category,
  type CategoryDef,
  type Item,
} from "@/lib/types";
import CategoryPills from "./CategoryPills";

type Props = {
  categories: CategoryDef[];
  items: Item[];
  onResult: (items: Item[], toast: string) => void;
  onError: (message: string) => void;
  onManageCategories: () => void;
};

export default function AddItemForm({
  categories,
  items,
  onResult,
  onError,
  onManageCategories,
}: Props) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [exp, setExp] = useState("");
  const [cat, setCat] = useState<Category>(FALLBACK_CATEGORY);
  const [busy, setBusy] = useState(false);
  // Same idea as the grocery form — once you tap a pill, we stop overriding
  // your choice until the form submits.
  const [userPickedCat, setUserPickedCat] = useState(false);
  const [scanning, setScanning] = useState(false);

  function applyScan(r: ScanResult) {
    if (r.name) setName(r.name);
    if (r.quantityGrams > 0) setQty(String(r.quantityGrams));
    if (r.expiry) setExp(r.expiry);
    if (r.category && categories.some((c) => c.name === r.category)) {
      setCat(r.category);
      setUserPickedCat(true);
    }
  }

  // If the currently selected category disappears (deleted in manage modal),
  // fall back to Other so we never submit a phantom category.
  useEffect(() => {
    if (categories.length > 0 && !categories.some((c) => c.name === cat)) {
      const hasFallback = categories.some((c) => c.name === FALLBACK_CATEGORY);
      setCat(hasFallback ? FALLBACK_CATEGORY : categories[0].name);
    }
  }, [categories, cat]);

  const guessHistory = useMemo(
    () => items.map((i) => ({ name: i.name, category: i.category })),
    [items]
  );
  const validCategoryNames = useMemo(
    () => categories.map((c) => c.name),
    [categories]
  );

  useEffect(() => {
    if (userPickedCat) return;
    const guess = guessCategory(name, guessHistory, validCategoryNames);
    if (guess && guess !== cat) setCat(guess);
  }, [name, guessHistory, validCategoryNames, userPickedCat, cat]);

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
    setBusy(true);
    try {
      const res = await addItem({
        name: trimmed,
        quantity: qtyNum,
        expiry: exp || undefined,
        category: cat,
      });
      const msg = res.merged
        ? `Added ${res.addedQty}g to existing "${res.mergedInto}"`
        : "Added";
      onResult(res.items, msg);
      setName("");
      setQty("");
      setExp("");
      setCat(FALLBACK_CATEGORY);
      setUserPickedCat(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onEnter(e: KeyboardEvent) {
    if (e.key === "Enter") submit();
  }

  return (
    <section className="add-card">
      <div className="add-card-head">
        <h2>Add item</h2>
        <button
          type="button"
          className="scan-trigger"
          onClick={() => setScanning(true)}
          title="Scan a barcode / label with your camera"
        >
          📷 Scan
        </button>
      </div>
      <div className="field">
        <label htmlFor="name">Name</label>
        <input
          id="name"
          type="text"
          placeholder="e.g. Chicken breast"
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onEnter}
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
          onChange={(c) => {
            setCat(c);
            setUserPickedCat(true);
          }}
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="qty">Quantity (g)</label>
          <input
            id="qty"
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
          <label htmlFor="exp">Expiry (optional)</label>
          <input
            id="exp"
            type="date"
            value={exp}
            onChange={(e) => setExp(e.target.value)}
            onKeyDown={onEnter}
          />
        </div>
      </div>
      <button
        className="btn-primary"
        onClick={submit}
        disabled={busy}
        type="button"
      >
        {busy ? "Adding…" : "Add to inventory"}
      </button>
      {scanning ? (
        <ScanLabelModal
          withExpiry
          onConfirm={applyScan}
          onClose={() => setScanning(false)}
        />
      ) : null}
    </section>
  );
}
