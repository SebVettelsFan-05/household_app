"use client";

import { useRef } from "react";
import type { ToastAction } from "@/components/Toast";
import {
  addGrocery,
  addItem,
  deleteGrocery,
  deleteItem,
  updateGrocery,
} from "@/lib/client";
import type { GroceryItem, Item } from "@/lib/types";

/**
 * Deleting a row by swiping it, shared by both looks.
 *
 * The row leaves the list before the request does and comes back if the
 * server refuses, and the toast that follows carries an Undo that posts it
 * again through the ordinary add API — the same path a housemate typing the
 * row back in would take, merge rule and all.
 */

/**
 * Two deletes can be in flight at once, and their answers can land in either
 * order, so neither answer is allowed to replace the list: each one carries a
 * snapshot of the server from before the other delete. A delete only ever
 * takes its own row out, and a refused delete only ever puts its own row back.
 */
function without<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((r) => r.id !== id);
}

function putBack<T extends { id: string }>(list: T[], row: T, index: number): T[] {
  if (list.some((r) => r.id === row.id)) return list;
  const at = Math.min(Math.max(index, 0), list.length);
  return [...list.slice(0, at), row, ...list.slice(at)];
}

/** An Undo button does its work once, however many times it is pressed. */
function once(fn: () => void): () => void {
  let used = false;
  return () => {
    if (used) return;
    used = true;
    fn();
  };
}

/** The shell's one toast slot; an action turns it into the Undo toast. */
type Toast = (msg: string, action?: ToastAction) => void;

function message(err: unknown): string {
  return "Error: " + (err instanceof Error ? err.message : String(err));
}

export function useGroceryDelete(
  grocery: GroceryItem[],
  onGroceryChange: (next: GroceryItem[]) => void,
  onToast: Toast
) {
  // The Undo button outlives the render that built it, so it has to read the
  // list as it is when pressed, not as it was when the row was deleted.
  const listRef = useRef(grocery);
  listRef.current = grocery;

  async function restore(row: GroceryItem) {
    const had = new Set(listRef.current.map((g) => g.id));
    try {
      const res = await addGrocery({
        name: row.name,
        quantity: row.quantity,
        category: row.category,
        categoryReviewed: row.categoryReviewed,
        store: row.store,
        addedBy: row.addedBy,
        pool: row.pool,
      });
      // An add always opens a not-done line, so a row that was in the Bought
      // section needs its tick put back. Only when the add really made a new
      // row, though: if it merged into an open line of the same name, ticking
      // that line would mark shopping nobody has done as bought.
      const made = res.grocery.filter((g) => !had.has(g.id));
      if (row.done && made.length === 1) {
        const ticked = await updateGrocery({ id: made[0].id, done: true });
        onGroceryChange(ticked.grocery);
      } else {
        onGroceryChange(res.grocery);
      }
      onToast(`Restored ${row.name}`);
    } catch (err) {
      onToast(message(err));
    }
  }

  // Written through as well as read, so two deletes in the same tick each
  // see the other's removal without waiting for a render.
  function apply(next: GroceryItem[]) {
    listRef.current = next;
    onGroceryChange(next);
  }

  return async function remove(row: GroceryItem) {
    const index = listRef.current.findIndex((g) => g.id === row.id);
    if (index < 0) return;
    apply(without(listRef.current, row.id));
    try {
      await deleteGrocery(row.id);
      onToast(`Deleted ${row.name}`, {
        label: "Undo",
        onClick: once(() => void restore(row)),
      });
    } catch (err) {
      apply(putBack(listRef.current, row, index));
      onToast(message(err));
    }
  };
}

export function useItemDelete(
  items: Item[],
  onItemsChange: (next: Item[]) => void,
  onToast: Toast
) {
  const listRef = useRef(items);
  listRef.current = items;

  async function restore(row: Item) {
    try {
      const res = await addItem({
        name: row.name,
        quantity: row.quantity,
        expiry: row.expiry,
        category: row.category,
        categoryReviewed: row.categoryReviewed,
      });
      onItemsChange(res.items);
      onToast(`Restored ${row.name}`);
    } catch (err) {
      onToast(message(err));
    }
  }

  function apply(next: Item[]) {
    listRef.current = next;
    onItemsChange(next);
  }

  return async function remove(row: Item) {
    const index = listRef.current.findIndex((i) => i.id === row.id);
    if (index < 0) return;
    apply(without(listRef.current, row.id));
    try {
      await deleteItem(row.id);
      onToast(`Deleted ${row.name}`, {
        label: "Undo",
        onClick: once(() => void restore(row)),
      });
    } catch (err) {
      apply(putBack(listRef.current, row, index));
      onToast(message(err));
    }
  };
}
