"use client";

import { useMemo, useState } from "react";
import AddItemForm from "@/components/AddItemForm";
import EditModal from "@/components/EditModal";
import { expiryStatus, fmtQty } from "@/lib/format";
import { sortCategories } from "@/lib/normalize";
import type { Item } from "@/lib/types";
import type { HouseholdData } from "@/lib/useHouseholdData";

type Props = {
  data: HouseholdData;
  onManageCategories: () => void;
};

const EXPIRING_WINDOW_DAYS = 3;

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
  const [ownerFilter, setOwnerFilter] = useState<"all" | "shared" | "personal">(
    "all"
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const editing = editingId
    ? (data.items.find((i) => i.id === editingId) ?? null)
    : null;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.items.filter((i) => {
      if (ownerFilter === "shared" && i.owner) return false;
      if (ownerFilter === "personal" && !i.owner) return false;
      if (term && !i.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [data.items, search, ownerFilter]);

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
        .sort((a, b) => a.days - b.days || a.item.name.localeCompare(b.item.name)),
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
      .map(([name, items]) => ({
        name,
        items: items.sort((a, b) => a.name.localeCompare(b.name)),
      }));
    // expiringIds is derived from `expiring`, which is memoised on `filtered`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, data.categories, expiring]);

  function row(item: Item) {
    const qty = fmtQty(item.quantity);
    const status = expiryStatus(item.expiry);
    const tone =
      status.cls === "expired"
        ? " fresh-expired"
        : status.cls === "expiring"
          ? " fresh-expiring"
          : "";
    return (
      <button
        key={item.id}
        type="button"
        className={`fresh-row${tone}`}
        onClick={() => setEditingId(item.id)}
      >
        <span className="fresh-row-main">
          <span className="fresh-row-title">{item.name}</span>
          <span className="fresh-row-meta">
            {item.category}
            {item.owner ? (
              <>
                {" · "}
                <span className="fresh-owner">{item.owner}</span>
              </>
            ) : null}
          </span>
        </span>
        {status.label ? (
          <span className="fresh-row-note">{status.label}</span>
        ) : null}
        <span className="fresh-row-amount">
          {qty.num}
          {qty.unit}
        </span>
      </button>
    );
  }

  return (
    <>
      <div className="fresh-section-head">
        <div className="fresh-chips" role="group" aria-label="Owner filter">
          {(["all", "shared", "personal"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`fresh-chip${ownerFilter === f ? " active" : ""}`}
              aria-pressed={ownerFilter === f}
              onClick={() => setOwnerFilter(f)}
            >
              {f === "all" ? "All" : f === "shared" ? "Shared" : "Personal"}
            </button>
          ))}
        </div>
        <span className="fresh-sub">{filtered.length} items</span>
      </div>

      <div className="fresh-field fresh-field-narrow">
        <label htmlFor="fi-search">Search</label>
        <input
          id="fi-search"
          className="fresh-input"
          type="search"
          placeholder="Name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
                <h2 className="fresh-h2">Use these first</h2>
                <span className="fresh-sub">{expiring.length}</span>
              </div>
              <div className="fresh-rows">
                {expiring.map((r) => row(r.item))}
              </div>
            </section>
          ) : null}

          {groups.map((g) => (
            <section className="fresh-section" key={g.name}>
              <div className="fresh-section-head">
                <h2 className="fresh-h2">{g.name}</h2>
                <span className="fresh-sub">{g.items.length}</span>
              </div>
              <div className="fresh-rows">{g.items.map(row)}</div>
            </section>
          ))}
        </>
      )}

      <button
        type="button"
        className="fresh-fab"
        onClick={() => setAdding(true)}
      >
        Add item
      </button>

      {adding ? (
        <div
          className="fresh-sheet-bg"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAdding(false);
          }}
        >
          <div
            className="fresh-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Add to inventory"
          >
            <div className="fresh-sheet-head">
              <h2 className="fresh-h2">Add item</h2>
              <button
                type="button"
                className="fresh-btn fresh-btn-quiet"
                onClick={() => setAdding(false)}
              >
                Close
              </button>
            </div>
            <AddItemForm
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
          </div>
        </div>
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
