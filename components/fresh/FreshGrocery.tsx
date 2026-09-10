"use client";

import { useMemo, useState } from "react";
import AddGroceryForm from "@/components/AddGroceryForm";
import EditGroceryModal from "@/components/EditGroceryModal";
import FreshSheet from "@/components/fresh/FreshSheet";
import { Avatar } from "@/components/fresh/people";
import { IconCheck, IconPlus } from "@/components/fresh/icons";
import { POOL_LABELS } from "@/components/PoolChips";
import { moveDoneGroceryToInventory, updateGrocery } from "@/lib/client";
import { fmtQty } from "@/lib/format";
import { inventoryItemCounts } from "@/lib/inventoryMatch";
import { normalizeName, sortCategories } from "@/lib/normalize";
import { type GroceryItem, type GroceryPool } from "@/lib/types";
import type { HouseholdData } from "@/lib/useHouseholdData";

type Props = {
  data: HouseholdData;
  onManageCategories: () => void;
};

// Dinner first: the meal group's list is the one that has a deadline.
const POOL_ORDER: GroceryPool[] = ["meals", "house", "personal"];

export default function FreshGrocery({ data, onManageCategories }: Props) {
  const [poolFilter, setPoolFilter] = useState<GroceryPool | "all">("all");
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

  const open = data.grocery.filter((g) => !g.done);
  const done = data.grocery.filter((g) => g.done);

  const groups = useMemo(() => {
    const visible =
      poolFilter === "all"
        ? open
        : open.filter((g) => (g.pool ?? "house") === poolFilter);
    const rank = (name: string) => {
      const i = categoryOrder.indexOf(name);
      return i === -1 ? categoryOrder.length : i;
    };
    return POOL_ORDER.map((pool) => ({
      pool,
      items: visible
        .filter((g) => (g.pool ?? "house") === pool)
        .sort(
          (a, b) =>
            rank(a.category) - rank(b.category) || a.name.localeCompare(b.name)
        ),
    })).filter((g) => g.items.length > 0);
  }, [open, poolFilter, categoryOrder]);

  // Somebody is about to buy what the house already has. Shown on the row
  // itself rather than in a side list, so it is read while shopping.
  const conflicts = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of open) {
      const norm = normalizeName(g.name);
      const match = data.items.find(
        (i) =>
          normalizeName(i.name) === norm &&
          inventoryItemCounts(i, g.pool ?? "house", g.addedBy)
      );
      if (match) map.set(g.id, match.quantity);
    }
    return map;
  }, [open, data.items]);

  async function toggle(item: GroceryItem) {
    setBusy(true);
    try {
      const res = await updateGrocery({ id: item.id, done: !item.done });
      data.setGrocery(res.grocery);
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
          </span>
          {haveQty ? (
            <span className="fresh-row-warn">
              Already have {haveQty.num}
              {haveQty.unit}
            </span>
          ) : null}
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
      <div className="fresh-chips" role="group" aria-label="Pool filter">
        <button
          type="button"
          className={`fresh-chip${poolFilter === "all" ? " active" : ""}`}
          aria-pressed={poolFilter === "all"}
          onClick={() => setPoolFilter("all")}
        >
          All
        </button>
        {POOL_ORDER.map((p) => (
          <button
            key={p}
            type="button"
            className={`fresh-chip${poolFilter === p ? " active" : ""}`}
            data-pool={p}
            aria-pressed={poolFilter === p}
            onClick={() => setPoolFilter(p)}
          >
            {POOL_LABELS[p]}
          </button>
        ))}
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
          Add what the house is out of, and say which pool it belongs to so the
          receipt splits itself later.
        </div>
      ) : (
        groups.map((group) => (
          <section className="fresh-section" key={group.pool}>
            <div className="fresh-section-head">
              <span className="fresh-pool-tag" data-pool={group.pool}>
                {POOL_LABELS[group.pool]}
              </span>
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
          <div className="fresh-rows">{done.map(row)}</div>
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
