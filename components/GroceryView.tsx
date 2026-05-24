"use client";

import { useMemo, useState } from "react";
import AddGroceryForm from "@/components/AddGroceryForm";
import EditGroceryModal from "@/components/EditGroceryModal";
import GroceryItemRow from "@/components/GroceryItemRow";
import { clearGrocery, updateGrocery } from "@/lib/client";
import { buildColorLookup } from "@/lib/categoryColors";
import type { CategoryDef, GroceryItem, Item } from "@/lib/types";

type SortMode = "newest" | "store" | "name";
const SORT_MODES: SortMode[] = ["newest", "store", "name"];
const SORT_LABELS: Record<SortMode, string> = {
  newest: "newest",
  store: "store",
  name: "A–Z",
};

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
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  const colorFor = useMemo(() => buildColorLookup(categories), [categories]);

  const editing = editingId ? grocery.find((g) => g.id === editingId) : null;

  const remaining = grocery.filter((g) => !g.done).length;
  const totalGrams = grocery.reduce((s, g) => s + g.quantity, 0);
  const totalDisplay =
    totalGrams >= 1000
      ? `${(totalGrams / 1000).toFixed(totalGrams % 1000 === 0 ? 0 : 1)} kg`
      : `${totalGrams} g`;
  const [totalNum, totalUnit] = totalDisplay.split(" ");

  // Done items always sink to the bottom (newest first) so the active
  // shopping list stays readable. The chosen sortMode only reorders the
  // open items above.
  const sorted = useMemo(() => {
    const byNewest = (a: GroceryItem, b: GroceryItem) =>
      (b.added || "").localeCompare(a.added || "");

    const byStore = (a: GroceryItem, b: GroceryItem) => {
      const sa = (a.store || "").trim();
      const sb = (b.store || "").trim();
      // Items without a store sink within the open group so each store
      // cluster stays clean.
      if (!sa && !sb) return byNewest(a, b);
      if (!sa) return 1;
      if (!sb) return -1;
      const cmp = sa.localeCompare(sb);
      return cmp !== 0 ? cmp : byNewest(a, b);
    };

    const byName = (a: GroceryItem, b: GroceryItem) =>
      a.name.localeCompare(b.name);

    const comparator =
      sortMode === "store" ? byStore : sortMode === "name" ? byName : byNewest;

    const open = grocery.filter((g) => !g.done).sort(comparator);
    const done = grocery.filter((g) => g.done).sort(byNewest);
    return [...open, ...done];
  }, [grocery, sortMode]);

  function cycleSort() {
    setSortMode(
      SORT_MODES[(SORT_MODES.indexOf(sortMode) + 1) % SORT_MODES.length]
    );
  }

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
        <div className="head-actions">
          <button
            type="button"
            className="sort-toggle"
            onClick={cycleSort}
          >
            Sort: {SORT_LABELS[sortMode]}
          </button>
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
