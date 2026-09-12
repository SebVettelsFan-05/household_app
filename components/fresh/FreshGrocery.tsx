"use client";

import { useEffect, useMemo, useState } from "react";
import AddGroceryForm from "@/components/AddGroceryForm";
import EditGroceryModal from "@/components/EditGroceryModal";
import FreshSheet from "@/components/fresh/FreshSheet";
import { Avatar } from "@/components/fresh/people";
import { IconCheck, IconPlus } from "@/components/fresh/icons";
import {
  moveDoneGroceryToInventory,
  ROW_GONE_MESSAGE,
  updateGrocery,
} from "@/lib/client";
import { buildColorLookup } from "@/lib/categoryColors";
import { fmtQty } from "@/lib/format";
import { findInventoryMatch } from "@/lib/inventoryMatch";
import { sortCategories } from "@/lib/normalize";
import { type GroceryItem } from "@/lib/types";
import type { HouseholdData } from "@/lib/useHouseholdData";

type Props = {
  data: HouseholdData;
  onManageCategories: () => void;
};

/**
 * Classic's default order inside a category: by store, then newest first.
 * Rows with no store sink below the ones that name where to buy them.
 */
function byStoreThenNewest(a: GroceryItem, b: GroceryItem): number {
  const sa = (a.store || "").trim();
  const sb = (b.store || "").trim();
  if (sa && sb) {
    const cmp = sa.localeCompare(sb);
    if (cmp !== 0) return cmp;
  } else if (sa || sb) {
    return sa ? -1 : 1;
  }
  return (b.added || "").localeCompare(a.added || "");
}

export default function FreshGrocery({ data, onManageCategories }: Props) {
  // Additive category filter: an empty set shows everything, each chip
  // toggles its membership (matches the classic FilterRow).
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const editing = editingId
    ? (data.grocery.find((g) => g.id === editingId) ?? null)
    : null;

  const categoryOrder = useMemo(
    () => sortCategories(data.categories).map((c) => c.name),
    [data.categories]
  );
  const colorFor = useMemo(
    () => buildColorLookup(data.categories),
    [data.categories]
  );

  const open = useMemo(
    () => data.grocery.filter((g) => !g.done),
    [data.grocery]
  );
  const done = useMemo(
    () => data.grocery.filter((g) => g.done),
    [data.grocery]
  );

  // Only categories the list actually holds, in the household's order.
  const categoryChips = useMemo(() => {
    const present = new Set(open.map((g) => g.category));
    const known = categoryOrder.filter((name) => present.has(name));
    const unknown = Array.from(present)
      .filter((name) => !categoryOrder.includes(name))
      .sort((a, b) => a.localeCompare(b));
    return [...known, ...unknown];
  }, [open, categoryOrder]);

  const showingAll = selected.size === 0;
  function toggleCategory(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }
  // Drop a selected category once nothing in the list carries it any more,
  // so the filter can never hide everything behind a chip that is gone.
  useEffect(() => {
    if (selected.size === 0) return;
    const live = new Set(categoryChips);
    if ([...selected].every((c) => live.has(c))) return;
    setSelected(new Set([...selected].filter((c) => live.has(c))));
  }, [categoryChips, selected]);

  const groups = useMemo(() => {
    const visible =
      selected.size === 0
        ? open
        : open.filter((g) => selected.has(g.category));
    const buckets = new Map<string, GroceryItem[]>();
    for (const name of categoryChips) buckets.set(name, []);
    for (const g of visible) {
      const list = buckets.get(g.category);
      if (list) list.push(g);
      else buckets.set(g.category, [g]);
    }
    return Array.from(buckets.entries())
      .filter(([, items]) => items.length > 0)
      .map(([name, items]) => ({ name, items: items.sort(byStoreThenNewest) }));
  }, [open, selected, categoryChips]);

  // Somebody is about to buy what the house already has. Shown on the row
  // itself rather than in a side list, so it is read while shopping.
  const conflicts = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of open) {
      const match = findInventoryMatch(data.items, g.name);
      if (match) map.set(g.id, match.quantity);
    }
    return map;
  }, [open, data.items]);

  async function toggle(item: GroceryItem) {
    setBusy(true);
    try {
      const res = await updateGrocery({ id: item.id, done: !item.done });
      data.setGrocery(res.grocery);
      if (res.gone) data.showToast(ROW_GONE_MESSAGE);
    } catch (err) {
      data.showToast(
        "Error: " + (err instanceof Error ? err.message : String(err))
      );
    } finally {
      setBusy(false);
    }
  }

  async function moveDone() {
    if (done.length === 0) return;
    if (
      !confirm(
        `Move ${done.length} checked-off item${done.length === 1 ? "" : "s"} into inventory? They'll be removed from this list.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await moveDoneGroceryToInventory();
      data.setGrocery(res.grocery);
      data.setItems(res.items);
      data.showToast(
        `Moved ${res.moved} item${res.moved === 1 ? "" : "s"} to inventory`
      );
    } catch (err) {
      data.showToast(
        "Error: " + (err instanceof Error ? err.message : String(err))
      );
    } finally {
      setBusy(false);
    }
  }

  function row(item: GroceryItem) {
    const qty = fmtQty(item.quantity);
    const have = conflicts.get(item.id);
    const haveQty = have === undefined ? null : fmtQty(have);
    return (
      <div className={`fresh-row${item.done ? " done" : ""}`} key={item.id}>
        <button
          type="button"
          className={`fresh-check${item.done ? " checked" : ""}`}
          onClick={() => toggle(item)}
          disabled={busy}
          aria-label={item.done ? "Mark as not done" : "Mark as done"}
          aria-pressed={item.done}
        >
          {item.done ? <IconCheck size={16} /> : null}
        </button>
        <button
          type="button"
          className="fresh-row-main"
          onClick={() => setEditingId(item.id)}
        >
          <span className="fresh-row-title">{item.name}</span>
          <span className="fresh-row-meta">
            {item.store ? (
              <span className="fresh-row-store">{item.store}</span>
            ) : null}
            <span className="fresh-person">
              <Avatar name={item.addedBy} size={20} />
              <span className="fresh-person-name">{item.addedBy}</span>
            </span>
            {haveQty ? (
              <span className="fresh-row-warn">
                have {haveQty.num}
                {haveQty.unit}
                <span className="sr-only"> in the inventory already</span>
              </span>
            ) : null}
          </span>
        </button>
        <span className="fresh-row-qty fresh-num">
          {qty.num}
          {qty.unit}
        </span>
      </div>
    );
  }

  return (
    <>
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

      {data.groceryLoading ? (
        <div>
          <div className="fresh-skel fresh-skel-row" />
          <div className="fresh-skel fresh-skel-row" />
          <div className="fresh-skel fresh-skel-row" />
        </div>
      ) : data.groceryError ? (
        <div className="fresh-error">
          Couldn&apos;t load the list. {data.groceryError}
        </div>
      ) : groups.length === 0 ? (
        <div className="fresh-empty">
          <strong>Nothing to buy</strong>
          Add what the house is out of and it lands under its category here.
        </div>
      ) : (
        groups.map((group) => (
          <section className="fresh-section" key={group.name}>
            <div className="fresh-section-head">
              <h2 className="fresh-h2">
                <span
                  className="fresh-cat-dot"
                  style={{ background: colorFor(group.name) }}
                />
                {group.name}
              </h2>
              <span className="fresh-sub">
                {group.items.length} item{group.items.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="fresh-rows">{group.items.map(row)}</div>
          </section>
        ))
      )}

      {done.length > 0 ? (
        <section className="fresh-section">
          <div className="fresh-section-head">
            <span className="fresh-pool-tag" data-pool="bought">
              Bought
            </span>
            <span className="fresh-sub">{done.length}</span>
          </div>
          <div className="fresh-rows">
            {done.slice().sort(byStoreThenNewest).map(row)}
          </div>
          <button
            type="button"
            className="fresh-btn fresh-btn-primary fresh-btn-block"
            onClick={moveDone}
            disabled={busy}
          >
            Move {done.length} to inventory
          </button>
        </section>
      ) : null}

      <button
        type="button"
        className="fresh-fab"
        onClick={() => setAdding(true)}
      >
        <IconPlus size={20} />
        Add item
      </button>

      {adding ? (
        <FreshSheet title="Add item" onClose={() => setAdding(false)}>
          <AddGroceryForm
            embedded
            categories={data.categories}
            fridgeItems={data.items}
            grocery={data.grocery}
            onResult={(next, msg) => {
              data.setGrocery(next);
              data.showToast(msg);
              setAdding(false);
            }}
            onError={(msg) => data.showToast("Error: " + msg)}
            onManageCategories={onManageCategories}
          />
        </FreshSheet>
      ) : null}

      {editing ? (
        <EditGroceryModal
          item={editing}
          categories={data.categories}
          onClose={() => setEditingId(null)}
          onResult={(next, msg) => {
            data.setGrocery(next);
            data.showToast(msg);
          }}
          onError={(msg) => data.showToast("Error: " + msg)}
          onManageCategories={onManageCategories}
        />
      ) : null}
    </>
  );
}
