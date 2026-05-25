"use client";

import { useEffect, useMemo, useState } from "react";
import AddItemForm from "@/components/AddItemForm";
import EditModal from "@/components/EditModal";
import FilterRow from "@/components/FilterRow";
import ItemRow from "@/components/ItemRow";
import { buildColorLookup, getCategoryColor } from "@/lib/categoryColors";
import { sortCategories } from "@/lib/normalize";
import type { CategoryDef, FilterCat, Item, SortMode } from "@/lib/types";

const SORT_MODES: SortMode[] = ["newest", "name", "quantity", "expiry"];
const SORT_LABELS: Record<SortMode, string> = {
  newest: "newest",
  name: "A–Z",
  quantity: "quantity",
  expiry: "expiry",
};

function sortItems(arr: Item[], mode: SortMode): Item[] {
  const copy = arr.slice();
  if (mode === "name") return copy.sort((a, b) => a.name.localeCompare(b.name));
  if (mode === "quantity") return copy.sort((a, b) => b.quantity - a.quantity);
  if (mode === "expiry")
    return copy.sort((a, b) => {
      if (!a.expiry && !b.expiry) return 0;
      if (!a.expiry) return 1;
      if (!b.expiry) return -1;
      return a.expiry.localeCompare(b.expiry);
    });
  return copy.sort((a, b) => (b.added || "").localeCompare(a.added || ""));
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
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [filterCat, setFilterCat] = useState<FilterCat>("all");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (
      filterCat !== "all" &&
      categories.length > 0 &&
      !categories.some((c) => c.name === filterCat)
    ) {
      setFilterCat("all");
    }
  }, [categories, filterCat]);

  const editing = editingId ? items.find((i) => i.id === editingId) : null;

  const filtered = useMemo(() => {
    const byCat =
      filterCat === "all"
        ? items
        : items.filter((i) => i.category === filterCat);
    const term = search.trim().toLowerCase();
    if (!term) return byCat;
    return byCat.filter((i) => i.name.toLowerCase().includes(term));
  }, [items, filterCat, search]);

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
        onResult={(next, msg) => {
          onItemsChange(next);
          onToast(msg);
        }}
        onError={(msg) => onToast("Error: " + msg)}
        onManageCategories={onManageCategories}
      />

      <div className="list-head">
        <h2>In the fridge</h2>
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
        value={filterCat}
        onChange={setFilterCat}
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
          <p>Your fridge is empty.</p>
          <p style={{ fontSize: 13 }}>Add something above to get started.</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="empty">
          <p>
            No{" "}
            {search.trim()
              ? "matching"
              : filterCat === "all"
                ? "items"
                : filterCat.toLowerCase()}{" "}
            items.
          </p>
        </div>
      ) : filterCat !== "all" ? (
        <div className="items">
          {sorted.map((it) => (
            <ItemRow
              key={it.id}
              item={it}
              color={colorFor(it.category)}
              onClick={setEditingId}
            />
          ))}
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
