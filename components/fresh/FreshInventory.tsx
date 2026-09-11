"use client";

import { useEffect, useMemo, useState } from "react";
import AddItemForm from "@/components/AddItemForm";
import EditModal from "@/components/EditModal";
import FreshSheet from "@/components/fresh/FreshSheet";
import { IconPlus, IconSearch } from "@/components/fresh/icons";
import { buildColorLookup } from "@/lib/categoryColors";
import { expiryStatus, fmtQty } from "@/lib/format";
import { sortCategories } from "@/lib/normalize";
import type { Item, SortMode } from "@/lib/types";
import type { HouseholdData } from "@/lib/useHouseholdData";

type Props = {
  data: HouseholdData;
  onManageCategories: () => void;
};

const EXPIRING_WINDOW_DAYS = 3;

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "name", label: "A to Z" },
  { value: "quantity", label: "Qty" },
  { value: "expiry", label: "Expiry" },
];

/** Same orders the classic inventory offers. */
function sortItems(arr: Item[], mode: SortMode): Item[] {
  const copy = arr.slice();
  if (mode === "name") return copy.sort((a, b) => a.name.localeCompare(b.name));
  if (mode === "quantity") return copy.sort((a, b) => b.quantity - a.quantity);
  if (mode === "newest") {
    return copy.sort((a, b) => (b.added || "").localeCompare(a.added || ""));
  }
  // expiry — soonest first; missing expiries sink to the bottom.
  return copy.sort((a, b) => {
    if (!a.expiry && !b.expiry) return 0;
    if (!a.expiry) return 1;
    if (!b.expiry) return -1;
    return a.expiry.localeCompare(b.expiry);
  });
}

/** "Sep 22" rather than the raw ISO the shared helper falls back to. */
function farExpiryLabel(expiry: string): string {
  const [y, m, d] = expiry.split("-").map(Number);
  if (!y || !m || !d) return "";
  return `Expires ${new Date(y, m - 1, d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}

function daysUntil(expiry: string): number | null {
  if (!expiry) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(expiry + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export default function FreshInventory({ data, onManageCategories }: Props) {
  const [search, setSearch] = useState("");
  // Additive category filter: an empty set shows everything, each chip
  // toggles its membership (matches the classic FilterRow).
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const editing = editingId
    ? (data.items.find((i) => i.id === editingId) ?? null)
    : null;

  const colorFor = useMemo(
    () => buildColorLookup(data.categories),
    [data.categories]
  );

  // Only categories that actually hold something, in the household's order.
  const categoryChips = useMemo(() => {
    const present = new Set(data.items.map((i) => i.category));
    return sortCategories(data.categories)
      .map((c) => c.name)
      .filter((name) => present.has(name));
  }, [data.items, data.categories]);

  const showingAll = selected.size === 0;
  function toggleCategory(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }
  useEffect(() => {
    if (selected.size === 0) return;
    const live = new Set(categoryChips);
    if ([...selected].every((c) => live.has(c))) return;
    setSelected(new Set([...selected].filter((c) => live.has(c))));
  }, [categoryChips, selected]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.items.filter((i) => {
      if (selected.size > 0 && !selected.has(i.category)) return false;
      if (term && !i.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [data.items, search, selected]);

  // Pinned at the top: anything already gone off, or going off inside three
  // days. Everything else groups by category underneath.
  const expiring = useMemo(
    () =>
      filtered
        .map((item) => ({ item, days: daysUntil(item.expiry) }))
        .filter(
          (r): r is { item: Item; days: number } =>
            r.days !== null && r.days <= EXPIRING_WINDOW_DAYS
        )
        .sort(
          (a, b) => a.days - b.days || a.item.name.localeCompare(b.item.name)
        ),
    [filtered]
  );
  const expiringIds = new Set(expiring.map((r) => r.item.id));

  const groups = useMemo(() => {
    const order = sortCategories(data.categories).map((c) => c.name);
    const rank = (name: string) => {
      const i = order.indexOf(name);
      return i === -1 ? order.length : i;
    };
    const buckets = new Map<string, Item[]>();
    for (const item of filtered) {
      if (expiringIds.has(item.id)) continue;
      const list = buckets.get(item.category) ?? [];
      list.push(item);
      buckets.set(item.category, list);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([name, items]) => ({ name, items: sortItems(items, sortMode) }));
    // expiringIds is derived from `expiring`, which is memoised on `filtered`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, data.categories, expiring, sortMode]);

  /**
   * `withCategory` is on only in the Use soon block, which mixes categories.
   * Inside a category group the heading already says it.
   */
  function row(item: Item, withCategory = false) {
    const qty = fmtQty(item.quantity);
    const status = expiryStatus(item.expiry);
    const expiryLabel =
      status.cls === "" ? farExpiryLabel(item.expiry) : status.label;
    return (
      <button
        key={item.id}
        type="button"
        className="fresh-row"
        onClick={() => setEditingId(item.id)}
      >
        <span className="fresh-row-main">
          <span className="fresh-row-title">{item.name}</span>
          <span className="fresh-row-meta">
            {withCategory ? (
              <span className="fresh-row-note">{item.category}</span>
            ) : null}
            {expiryLabel ? (
              <span
                className={`fresh-badge${
                  status.cls === "expired"
                    ? " danger"
                    : status.cls === "expiring"
                      ? " warn"
                      : ""
                }`}
              >
                {expiryLabel}
              </span>
            ) : null}
          </span>
        </span>
        <span className="fresh-row-qty fresh-num">
          {qty.num}
          {qty.unit}
        </span>
      </button>
    );
  }

  return (
    <>
      <div className="fresh-search">
        <IconSearch size={20} />
        <input
          className="fresh-input"
          type="search"
          aria-label="Search inventory"
          placeholder="Search what the house has"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="fresh-chips" role="group" aria-label="Category filter">
        <button
          type="button"
          className={`fresh-chip${showingAll ? " active" : ""}`}
          aria-pressed={showingAll}
          onClick={() => setSelected(new Set())}
          title="Clear category filters"
        >
          All
        </button>
        {categoryChips.map((name) => {
          const active = selected.has(name);
          return (
            <button
              key={name}
              type="button"
              className={`fresh-chip fresh-chip-cat${active ? " active" : ""}`}
              aria-pressed={active}
              onClick={() => toggleCategory(name)}
            >
              <span
                className="fresh-cat-dot"
                style={{ background: colorFor(name) }}
                aria-hidden="true"
              />
              {name}
            </button>
          );
        })}
      </div>

      <div
        className="fresh-seg fresh-seg-sm"
        role="group"
        aria-label="Sort inventory"
      >
        {SORT_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`fresh-seg-btn${o.value === sortMode ? " active" : ""}`}
            aria-pressed={o.value === sortMode}
            onClick={() => setSortMode(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>

      {data.itemsLoading ? (
        <div>
          <div className="fresh-skel fresh-skel-row" />
          <div className="fresh-skel fresh-skel-row" />
          <div className="fresh-skel fresh-skel-row" />
        </div>
      ) : data.itemsError ? (
        <div className="fresh-error">
          Couldn&apos;t load inventory. {data.itemsError}
        </div>
      ) : filtered.length === 0 ? (
        <div className="fresh-empty">
          <strong>Nothing here</strong>
          Add what the house has on hand, or move a finished grocery list into
          inventory in one tap.
        </div>
      ) : (
        <>
          {expiring.length > 0 ? (
            <section className="fresh-section">
              <div className="fresh-section-head">
                <span className="fresh-pool-tag" data-pool="soon">
                  Use soon
                </span>
                <span className="fresh-sub">{expiring.length}</span>
              </div>
              <div className="fresh-rows">
                {expiring.map((r) => row(r.item, true))}
              </div>
            </section>
          ) : null}

          {groups.map((g) => (
            <section className="fresh-section" key={g.name}>
              <div className="fresh-section-head">
                <h2 className="fresh-h2">
                  <span
                    className="fresh-cat-dot"
                    style={{ background: colorFor(g.name) }}
                  />
                  {g.name}
                </h2>
                <span className="fresh-sub">{g.items.length}</span>
              </div>
              <div className="fresh-rows">
                {g.items.map((item) => row(item))}
              </div>
            </section>
          ))}
        </>
      )}

      <button
        type="button"
        className="fresh-fab"
        onClick={() => setAdding(true)}
      >
        <IconPlus size={20} />
        Add item
      </button>

      {adding ? (
        <FreshSheet title="Add to inventory" onClose={() => setAdding(false)}>
          <AddItemForm
            embedded
            categories={data.categories}
            items={data.items}
            onResult={(next, msg) => {
              data.setItems(next);
              data.showToast(msg);
              setAdding(false);
            }}
            onError={(msg) => data.showToast("Error: " + msg)}
            onManageCategories={onManageCategories}
          />
        </FreshSheet>
      ) : null}

      {editing ? (
        <EditModal
          item={editing}
          categories={data.categories}
          onClose={() => setEditingId(null)}
          onResult={(next, msg) => {
            data.setItems(next);
            data.showToast(msg);
          }}
          onError={(msg) => data.showToast("Error: " + msg)}
          onManageCategories={onManageCategories}
        />
      ) : null}
    </>
  );
}
