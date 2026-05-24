"use client";

import { useEffect, useMemo, useState } from "react";
import AddItemForm from "@/components/AddItemForm";
import EditModal from "@/components/EditModal";
import FilterRow from "@/components/FilterRow";
import ItemRow from "@/components/ItemRow";
import ManageCategoriesModal from "@/components/ManageCategoriesModal";
import Toast, { type ToastMessage } from "@/components/Toast";
import { listCategories, listItems } from "@/lib/client";
import type { Category, FilterCat, Item, SortMode } from "@/lib/types";

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

export default function Page() {
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [filterCat, setFilterCat] = useState<FilterCat>("all");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [managingCats, setManagingCats] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listItems(), listCategories()])
      .then(([itemData, catData]) => {
        if (cancelled) return;
        setItems(itemData);
        setCategories(catData);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function showToast(text: string) {
    setToast({ id: Date.now(), text });
  }

  const editing = editingId ? items.find((i) => i.id === editingId) : null;

  const filtered = useMemo(() => {
    const byCat =
      filterCat === "all" ? items : items.filter((i) => i.category === filterCat);
    const term = search.trim().toLowerCase();
    if (!term) return byCat;
    return byCat.filter((i) => i.name.toLowerCase().includes(term));
  }, [items, filterCat, search]);

  const sorted = useMemo(() => sortItems(filtered, sortMode), [filtered, sortMode]);

  // If filter targets a category that no longer exists, reset to "all".
  useEffect(() => {
    if (
      filterCat !== "all" &&
      categories.length > 0 &&
      !categories.includes(filterCat)
    ) {
      setFilterCat("all");
    }
  }, [categories, filterCat]);

  const total = filtered.reduce((s, i) => s + (i.quantity || 0), 0);
  const totalDisplay =
    total >= 1000
      ? `${(total / 1000).toFixed(total % 1000 === 0 ? 0 : 1)} kg`
      : `${total} g`;
  const [totalNum, totalUnit] = totalDisplay.split(" ");

  function cycleSort() {
    const next = SORT_MODES[(SORT_MODES.indexOf(sortMode) + 1) % SORT_MODES.length];
    setSortMode(next);
  }

  return (
    <div className="wrap">
      <header className="app-header">
        <h1>Fridge</h1>
        <div className="stats">
          <div>
            <strong>{filtered.length}</strong> items
          </div>
          <div>
            <strong>{totalNum}</strong> {totalUnit} total
          </div>
        </div>
      </header>

      <AddItemForm
        categories={categories}
        onResult={(next, msg) => {
          setItems(next);
          showToast(msg);
        }}
        onError={(msg) => showToast("Error: " + msg)}
        onManageCategories={() => setManagingCats(true)}
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
      ) : (
        <div className="items">
          {sorted.map((it) => (
            <ItemRow key={it.id} item={it} onClick={setEditingId} />
          ))}
        </div>
      )}

      {editing ? (
        <EditModal
          item={editing}
          categories={categories}
          onClose={() => setEditingId(null)}
          onResult={(next, msg) => {
            setItems(next);
            showToast(msg);
          }}
          onError={(msg) => showToast("Error: " + msg)}
          onManageCategories={() => setManagingCats(true)}
        />
      ) : null}

      {managingCats ? (
        <ManageCategoriesModal
          categories={categories}
          items={items}
          onClose={() => setManagingCats(false)}
          onCategoriesChange={setCategories}
          onItemsChange={setItems}
          onToast={showToast}
          onError={(msg) => showToast("Error: " + msg)}
        />
      ) : null}

      <Toast message={toast} />
    </div>
  );
}
