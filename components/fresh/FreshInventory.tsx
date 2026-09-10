"use client";

import { useMemo, useState } from "react";
import AddItemForm from "@/components/AddItemForm";
import EditModal from "@/components/EditModal";
import FreshSheet from "@/components/fresh/FreshSheet";
import { Avatar } from "@/components/fresh/people";
import { IconPlus, IconSearch } from "@/components/fresh/icons";
import { expiryStatus, fmtQty } from "@/lib/format";
import { sortCategories } from "@/lib/normalize";
import type { Item } from "@/lib/types";
import type { HouseholdData } from "@/lib/useHouseholdData";

type Props = {
  data: HouseholdData;
  onManageCategories: () => void;
};

const EXPIRING_WINDOW_DAYS = 3;

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
  const [category, setCategory] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const editing = editingId
    ? (data.items.find((i) => i.id === editingId) ?? null)
    : null;

  // Only categories that actually hold something, in the household's order.
  const categoryChips = useMemo(() => {
    const present = new Set(data.items.map((i) => i.category));
    return sortCategories(data.categories)
      .map((c) => c.name)
      .filter((name) => present.has(name));
  }, [data.items, data.categories]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.items.filter((i) => {
      if (category !== "all" && i.category !== category) return false;
      if (term && !i.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [data.items, search, category]);

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
            {item.owner ? (
              <span className="fresh-person">
                <Avatar name={item.owner} size={20} />
                <span className="fresh-person-name">{item.owner}</span>
              </span>
            ) : (
              <span className="fresh-row-note">Shared</span>
            )}
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
          className={`fresh-chip${category === "all" ? " active" : ""}`}
          aria-pressed={category === "all"}
          onClick={() => setCategory("all")}
        >
          All
        </button>
        {categoryChips.map((name) => (
          <button
            key={name}
            type="button"
            className={`fresh-chip${category === name ? " active" : ""}`}
            aria-pressed={category === name}
            onClick={() => setCategory(name)}
          >
            {name}
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
              <div className="fresh-rows">{expiring.map((r) => row(r.item))}</div>
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
