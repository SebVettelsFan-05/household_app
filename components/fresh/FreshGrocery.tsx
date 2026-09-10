"use client";

import { useMemo, useState } from "react";
import AddGroceryForm from "@/components/AddGroceryForm";
import EditGroceryModal from "@/components/EditGroceryModal";
import { POOL_LABELS } from "@/components/PoolChips";
import {
  moveDoneGroceryToInventory,
  updateGrocery,
} from "@/lib/client";
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

  // Pool first, then category, so a shopping trip reads in the order the
  // money gets split.
  const groups = useMemo(() => {
    const visible =
      poolFilter === "all"
        ? open
        : open.filter((g) => (g.pool ?? "house") === poolFilter);
    return POOL_ORDER.map((pool) => {
      const rows = visible.filter((g) => (g.pool ?? "house") === pool);
      const byCategory = new Map<string, GroceryItem[]>();
      for (const g of rows) {
        const list = byCategory.get(g.category) ?? [];
        list.push(g);
        byCategory.set(g.category, list);
      }
      const rank = (name: string) => {
        const i = categoryOrder.indexOf(name);
        return i === -1 ? categoryOrder.length : i;
      };
      const categories = Array.from(byCategory.entries())
        .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
        .map(([name, items]) => ({
          name,
          items: items.sort((x, y) => x.name.localeCompare(y.name)),
        }));
      return { pool, count: rows.length, categories };
    }).filter((g) => g.count > 0);
  }, [open, poolFilter, categoryOrder]);

  // Somebody is about to buy what the house already has.
  const conflicts = useMemo(() => {
    const rows: { row: GroceryItem; haveGrams: number }[] = [];
    for (const g of open) {
      const norm = normalizeName(g.name);
      const match = data.items.find(
        (i) =>
          normalizeName(i.name) === norm &&
          inventoryItemCounts(i, g.pool ?? "house", g.addedBy)
      );
      if (match) rows.push({ row: g, haveGrams: match.quantity });
    }
    return rows;
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
    return (
      <div className={`fresh-row${item.done ? " done" : ""}`} key={item.id}>
        <button
          type="button"
          className={`fresh-check${item.done ? " checked" : ""}`}
          onClick={() => toggle(item)}
          disabled={busy}
          aria-label={item.done ? "Mark as not done" : "Mark as done"}
        >
          {item.done ? "✓" : ""}
        </button>
        <button
          type="button"
          className="fresh-row-main"
          onClick={() => setEditingId(item.id)}
        >
          <span className="fresh-row-title">{item.name}</span>
          <span className="fresh-row-meta">
            For {item.addedBy}
            {item.store ? ` · ${item.store}` : ""}
          </span>
        </button>
        <span className="fresh-row-note">
          {qty.num}
          {qty.unit}
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="fresh-grocery">
        <div className="fresh-expenses-main">
          <div className="fresh-section-head">
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
                  aria-pressed={poolFilter === p}
                  onClick={() => setPoolFilter(p)}
                >
                  {POOL_LABELS[p]}
                </button>
              ))}
            </div>
            <span className="fresh-sub">{open.length} to get</span>
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
              Add what the house is out of, and say which pool it belongs to so
              the receipt splits itself later.
            </div>
          ) : (
            groups.map((group) => (
              <section className="fresh-section" key={group.pool}>
                <div className="fresh-section-head">
                  <h2 className="fresh-h2">{POOL_LABELS[group.pool]}</h2>
                  <span className="fresh-sub">
                    {group.count} item{group.count === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="fresh-rows">
                  {group.categories.map((cat) => (
                    <div key={cat.name}>
                      <div className="fresh-group-head">
                        <span>{cat.name}</span>
                        <span>{cat.items.length}</span>
                      </div>
                      {cat.items.map(row)}
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        <aside>
          <section className="fresh-section">
            <div className="fresh-section-head">
              <h2 className="fresh-h2">Bought</h2>
              <span className="fresh-sub">{done.length}</span>
            </div>
            {done.length === 0 ? (
              <p className="fresh-side-note">
                Checked-off items collect here until they move into inventory.
              </p>
            ) : (
              <>
                <div className="fresh-rows">{done.map(row)}</div>
                <div className="fresh-btn-row" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="fresh-btn"
                    onClick={moveDone}
                    disabled={busy}
                  >
                    Move {done.length} into inventory
                  </button>
                </div>
              </>
            )}
          </section>

          <section className="fresh-section">
            <div className="fresh-section-head">
              <h2 className="fresh-h2">Already in inventory</h2>
              <span className="fresh-sub">{conflicts.length}</span>
            </div>
            {conflicts.length === 0 ? (
              <p className="fresh-side-note">
                Nothing on the list duplicates what the house already has.
              </p>
            ) : (
              <div className="fresh-rows">
                {conflicts.map(({ row: g, haveGrams }) => {
                  const have = fmtQty(haveGrams);
                  return (
                    <div className="fresh-row" key={g.id}>
                      <span className="fresh-row-main">
                        <span className="fresh-row-title">{g.name}</span>
                        <span className="fresh-row-meta">
                          {have.num}
                          {have.unit} on hand already
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </aside>
      </div>

      <button
        type="button"
        className="fresh-fab"
        onClick={() => setAdding(true)}
      >
        Add to list
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
            aria-label="Add to grocery list"
          >
            <div className="fresh-sheet-head">
              <h2 className="fresh-h2">Add to list</h2>
              <button
                type="button"
                className="fresh-btn fresh-btn-quiet"
                onClick={() => setAdding(false)}
              >
                Close
              </button>
            </div>
            <AddGroceryForm
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
          </div>
        </div>
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
