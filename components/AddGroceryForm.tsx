"use client";

import { KeyboardEvent, useEffect, useMemo, useState } from "react";
import DictateItemsModal from "@/components/DictateItemsModal";
import ScanLabelModal, {
  type ScanResult,
} from "@/components/ScanLabelModal";
import { addGrocery } from "@/lib/client";
import { fmtQty } from "@/lib/format";
import { guessCategory } from "@/lib/guessCategory";
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
  grocery: GroceryItem[];
  onResult: (grocery: GroceryItem[], toast: string) => void;
  onError: (message: string) => void;
  onManageCategories: () => void;
};

export default function AddGroceryForm({
  categories,
  fridgeItems,
  grocery,
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
  // Once the user taps a category pill, we stop overriding their choice as
  // they keep typing. Reset on submit so the next entry auto-suggests again.
  const [userPickedCat, setUserPickedCat] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [dictating, setDictating] = useState(false);

  function applyScan(r: ScanResult) {
    if (r.name) setName(r.name);
    if (r.quantityGrams > 0) setQty(String(r.quantityGrams));
    if (r.category && categories.some((c) => c.name === r.category)) {
      setCat(r.category);
      setUserPickedCat(true);
    }
    // Grocery items don't carry expiry, so r.expiry is ignored here.
  }

  useEffect(() => {
    if (categories.length > 0 && !categories.some((c) => c.name === cat)) {
      const hasFallback = categories.some((c) => c.name === FALLBACK_CATEGORY);
      setCat(hasFallback ? FALLBACK_CATEGORY : categories[0].name);
    }
  }, [categories, cat]);

  // History fed to the category guesser. Putting grocery before fridge means
  // recent grocery tagging carries more weight than older fridge items, which
  // matches "what did I just type for this kind of thing".
  const guessHistory = useMemo(
    () => [
      ...grocery.map((g) => ({ name: g.name, category: g.category })),
      ...fridgeItems.map((i) => ({ name: i.name, category: i.category })),
    ],
    [grocery, fridgeItems]
  );
  const validCategoryNames = useMemo(
    () => categories.map((c) => c.name),
    [categories]
  );

  // Re-run the guesser whenever the name changes (and the user hasn't taken
  // control of the picker). Cheap — synchronous, runs on each keystroke.
  useEffect(() => {
    if (userPickedCat) return;
    const guess = guessCategory(name, guessHistory, validCategoryNames);
    if (guess && guess !== cat) setCat(guess);
  }, [name, guessHistory, validCategoryNames, userPickedCat, cat]);

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
      // Reset auto-suggest control so the next entry's name drives the
      // category again. Keep addedBy + cat for fast repeated entries — the
      // suggester will overwrite cat as soon as the user starts typing.
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

  const matchQty = fridgeMatch ? fmtQty(fridgeMatch.quantity) : null;

  return (
    <section className="add-card">
      <div className="add-card-head">
        <h2>Add to list</h2>
        <div className="add-card-actions">
          <button
            type="button"
            className="scan-trigger"
            onClick={() => setDictating(true)}
            title="Dictate several items at once using your phone keyboard mic"
          >
            🎙️ Dictate
          </button>
          <button
            type="button"
            className="scan-trigger"
            onClick={() => setScanning(true)}
            title="Scan a barcode / label with your camera"
          >
            📷 Scan
          </button>
        </div>
      </div>
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
              <strong>{fridgeMatch.name}</strong> in inventory.
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
      {scanning ? (
        <ScanLabelModal
          withExpiry={false}
          onConfirm={applyScan}
          onClose={() => setScanning(false)}
        />
      ) : null}
      {dictating ? (
        <DictateItemsModal
          mode="grocery"
          categories={categories}
          grocery={grocery}
          fridgeItems={fridgeItems}
          onClose={() => setDictating(false)}
          onResult={onResult}
          onError={onError}
        />
      ) : null}
    </section>
  );
}
