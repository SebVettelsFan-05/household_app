"use client";

import { useEffect, useMemo, useState } from "react";
import AddItemForm from "@/components/AddItemForm";
import EditModal from "@/components/EditModal";
import FilterRow from "@/components/FilterRow";
import ItemRow from "@/components/ItemRow";
import { buildColorLookup, getCategoryColor } from "@/lib/categoryColors";
import { sortCategories } from "@/lib/normalize";
import type { CategoryDef, Item, SortMode } from "@/lib/types";

type FridgeSortMode = Exclude<SortMode, "newest">;
const SORT_MODES: FridgeSortMode[] = ["expiry", "name", "quantity"];
const SORT_LABELS: Record<FridgeSortMode, string> = {
  name: "A–Z",
  quantity: "quantity",
  expiry: "expiry",
};

function sortItems(arr: Item[], mode: FridgeSortMode): Item[] {
  const copy = arr.slice();
  if (mode === "name") return copy.sort((a, b) => a.name.localeCompare(b.name));
  if (mode === "quantity") return copy.sort((a, b) => b.quantity - a.quantity);
  // expiry — soonest first; missing expiries sink to the bottom.
  return copy.sort((a, b) => {
    if (!a.expiry && !b.expiry) return 0;
    if (!a.expiry) return 1;
    if (!b.expiry) return -1;
    return a.expiry.localeCompare(b.expiry);
  });
}

type Props = {
  items: Item[];
  categories: CategoryDef[];
  loading: boolean;
  loadError: string | null;
  onItemsChange: (next: Item[]) => void;
  onToast: (msg: string) => void;
  onManageCategories: () => void;
};

export default function FridgeView({
  items,
  categories,
  loading,
  loadError,
  onItemsChange,
  onToast,
  onManageCategories,
}: Props) {
  const [sortMode, setSortMode] = useState<FridgeSortMode>("name");
  // Multi-select: empty set = show all. Clicking a pill toggles its presence;
  // the "All" pill empties the set.
  const [filterCats, setFilterCats] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Prune the selection when categories disappear (deleted from manage),
  // so an old filter doesn't keep silently hiding everything.
  useEffect(() => {
    setFilterCats((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(categories.map((c) => c.name));
      const next = new Set<string>();
      let changed = false;
      for (const name of prev) {
        if (valid.has(name)) next.add(name);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [categories]);

  function toggleCat(name: string) {
    setFilterCats((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function clearCats() {
    setFilterCats(new Set());
  }

  const editing = editingId ? items.find((i) => i.id === editingId) : null;

  const filtered = useMemo(() => {
    const byCat =
      filterCats.size === 0
        ? items
        : items.filter((i) => filterCats.has(i.category));
    const term = search.trim().toLowerCase();
    if (!term) return byCat;
    return byCat.filter((i) => i.name.toLowerCase().includes(term));
  }, [items, filterCats, search]);

  const sorted = useMemo(
    () => sortItems(filtered, sortMode),
    [filtered, sortMode]
  );

  // When showing "all", group the sorted list by category — categories follow
  // the same user-added-first / Other-last order used elsewhere, and items
  // within each group keep the chosen sort mode (newest, expiry, etc.).
  const grouped = useMemo(() => {
    const order = sortCategories(categories).map((c) => c.name);
    const buckets = new Map<string, Item[]>();
    for (const name of order) buckets.set(name, []);
    for (const it of sorted) {
      if (!buckets.has(it.category)) buckets.set(it.category, []);
      buckets.get(it.category)!.push(it);
    }
    return Array.from(buckets.entries())
      .filter(([, list]) => list.length > 0)
      .map(([name, list]) => ({ name, items: list }));
  }, [sorted, categories]);

  const colorFor = useMemo(() => buildColorLookup(categories), [categories]);

  const total = filtered.reduce((s, i) => s + (i.quantity || 0), 0);
  const totalDisplay =
    total >= 1000
      ? `${(total / 1000).toFixed(total % 1000 === 0 ? 0 : 1)} kg`
      : `${total} g`;
  const [totalNum, totalUnit] = totalDisplay.split(" ");

  function cycleSort() {
    const next =
      SORT_MODES[(SORT_MODES.indexOf(sortMode) + 1) % SORT_MODES.length];
    setSortMode(next);
  }

  return (
    <>
      <div className="view-stats">
        <div>
          <strong>{filtered.length}</strong> items
        </div>
        <div>
          <strong>{totalNum}</strong> {totalUnit} total
        </div>
      </div>

      <AddItemForm
        categories={categories}
        items={items}
        onResult={(next, msg) => {
          onItemsChange(next);
          onToast(msg);
        }}
        onError={(msg) => onToast("Error: " + msg)}
        onManageCategories={onManageCategories}
      />

      <div className="list-head">
        <h2>Inventory</h2>
        <button type="button" className="sort-toggle" onClick={cycleSort}>
          Sort: {SORT_LABELS[sortMode]}
        </button>
      </div>

      <div className="search-row">
        <input
          type="search"
          placeholder="Search items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <FilterRow
        categories={categories}
        selected={filterCats}
        onToggle={toggleCat}
        onClear={clearCats}
      />
      <div className="list-hint">Tap any item to edit, use, or delete</div>

      {loading ? (
        <div className="loading">
          <span className="spinner" />
          Loading…
        </div>
      ) : loadError ? (
        <div className="empty">
          <p>Couldn&apos;t load items.</p>
          <p style={{ fontSize: 13 }}>{loadError}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <div className="icon">∅</div>
          <p>Your inventory is empty.</p>
          <p style={{ fontSize: 13 }}>Add something above to get started.</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="empty">
          <p>
            No{" "}
            {search.trim()
              ? "matching"
              : filterCats.size === 0
                ? "items"
                : Array.from(filterCats).join(" / ").toLowerCase()}{" "}
            items.
          </p>
        </div>
      ) : (
        <div className="items">
          {grouped.map((g) => {
            const cat = categories.find((c) => c.name === g.name);
            const headColor = getCategoryColor(g.name, cat?.color ?? null);
            return (
              <div key={g.name} className="cat-group">
                <div
                  className="cat-group-head"
                  style={{ color: headColor }}
                >
                  <span className="cat-group-name">{g.name}</span>
                  <span className="cat-group-count">{g.items.length}</span>
                </div>
                {g.items.map((it) => (
                  <ItemRow
                    key={it.id}
                    item={it}
                    color={colorFor(it.category)}
                    onClick={setEditingId}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {editing ? (
        <EditModal
          item={editing}
          categories={categories}
          onClose={() => setEditingId(null)}
          onResult={(next, msg) => {
            onItemsChange(next);
            onToast(msg);
          }}
          onError={(msg) => onToast("Error: " + msg)}
          onManageCategories={onManageCategories}
        />
      ) : null}
    </>
  );
}
