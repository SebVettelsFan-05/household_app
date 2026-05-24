"use client";

import { useMemo, useState } from "react";
import AddGroceryForm from "@/components/AddGroceryForm";
import EditGroceryModal from "@/components/EditGroceryModal";
import GroceryItemRow from "@/components/GroceryItemRow";
import { clearGrocery, updateGrocery } from "@/lib/client";
import { buildColorLookup } from "@/lib/categoryColors";
import type { CategoryDef, GroceryItem, Item } from "@/lib/types";

type Props = {
  grocery: GroceryItem[];
  categories: CategoryDef[];
  fridgeItems: Item[];
  loading: boolean;
  loadError: string | null;
  onGroceryChange: (next: GroceryItem[]) => void;
  onToast: (msg: string) => void;
  onManageCategories: () => void;
};

export default function GroceryView({
  grocery,
  categories,
  fridgeItems,
  loading,
  loadError,
  onGroceryChange,
  onToast,
  onManageCategories,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const colorFor = useMemo(() => buildColorLookup(categories), [categories]);

  const editing = editingId ? grocery.find((g) => g.id === editingId) : null;

  const remaining = grocery.filter((g) => !g.done).length;
  const totalGrams = grocery.reduce((s, g) => s + g.quantity, 0);
  const totalDisplay =
    totalGrams >= 1000
      ? `${(totalGrams / 1000).toFixed(totalGrams % 1000 === 0 ? 0 : 1)} kg`
      : `${totalGrams} g`;
  const [totalNum, totalUnit] = totalDisplay.split(" ");

  // Sort: open items first (newest first), then done items (newest first).
  const sorted = useMemo(() => {
    const copy = grocery.slice();
    copy.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (b.added || "").localeCompare(a.added || "");
    });
    return copy;
  }, [grocery]);

  async function toggle(id: string, done: boolean) {
    setBusy(true);
    try {
      const res = await updateGrocery({ id, done });
      onGroceryChange(res.grocery);
    } catch (err) {
      onToast("Error: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function clearAll() {
    if (grocery.length === 0) return;
    if (
      !confirm(
        `Clear all ${grocery.length} item${grocery.length === 1 ? "" : "s"} from the list?`
      )
    )
      return;
    setBusy(true);
    try {
      const res = await clearGrocery();
      onGroceryChange(res.grocery);
      onToast("List cleared");
    } catch (err) {
      onToast("Error: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="view-stats">
        <div>
          <strong>{remaining}</strong> to get
        </div>
        <div>
          <strong>{totalNum}</strong> {totalUnit} total
        </div>
      </div>

      <AddGroceryForm
        categories={categories}
        fridgeItems={fridgeItems}
        onResult={(next, msg) => {
          onGroceryChange(next);
          onToast(msg);
        }}
        onError={(msg) => onToast("Error: " + msg)}
        onManageCategories={onManageCategories}
      />

      <div className="list-head">
        <h2>Shopping list</h2>
        <button
          type="button"
          className="sort-toggle"
          onClick={clearAll}
          disabled={busy || grocery.length === 0}
          style={{ color: "var(--danger)" }}
        >
          Clear list
        </button>
      </div>

      <div className="list-hint">Tap the circle to check off, or the row to edit</div>

      {loading ? (
        <div className="loading">
          <span className="spinner" />
          Loading…
        </div>
      ) : loadError ? (
        <div className="empty">
          <p>Couldn&apos;t load list.</p>
          <p style={{ fontSize: 13 }}>{loadError}</p>
        </div>
      ) : grocery.length === 0 ? (
        <div className="empty">
          <div className="icon">∅</div>
          <p>Nothing on the list.</p>
          <p style={{ fontSize: 13 }}>Add something above.</p>
        </div>
      ) : (
        <div className="items">
          {sorted.map((g) => (
            <GroceryItemRow
              key={g.id}
              item={g}
              color={colorFor(g.category)}
              busy={busy}
              onToggle={toggle}
              onOpen={setEditingId}
            />
          ))}
        </div>
      )}

      {editing ? (
        <EditGroceryModal
          item={editing}
          categories={categories}
          onClose={() => setEditingId(null)}
          onResult={(next, msg) => {
            onGroceryChange(next);
            onToast(msg);
          }}
          onError={(msg) => onToast("Error: " + msg)}
          onManageCategories={onManageCategories}
        />
      ) : null}
    </>
  );
}
