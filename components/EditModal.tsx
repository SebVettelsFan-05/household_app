"use client";

import { useEffect, useState } from "react";
import { deleteItem, updateItem } from "@/lib/client";
import type { Category, Item } from "@/lib/types";
import CategoryPills from "./CategoryPills";

type Props = {
  item: Item;
  onClose: () => void;
  onResult: (items: Item[], toast: string) => void;
  onError: (message: string) => void;
};

export default function EditModal({ item, onClose, onResult, onError }: Props) {
  const [name, setName] = useState(item.name);
  const [qty, setQty] = useState(String(item.quantity));
  const [exp, setExp] = useState(item.expiry || "");
  const [cat, setCat] = useState<Category>(item.category || "Other");
  const [useAmt, setUseAmt] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    const trimmed = name.trim();
    const qtyNum = parseFloat(qty);
    if (!trimmed || !qtyNum || qtyNum < 0) {
      onError("Check your inputs");
      return;
    }
    setBusy(true);
    try {
      const res = await updateItem({
        id: item.id,
        name: trimmed,
        quantity: qtyNum,
        expiry: exp || undefined,
        category: cat,
      });
      onResult(res.items, "Saved");
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!confirm("Delete this item?")) return;
    setBusy(true);
    try {
      const res = await deleteItem(item.id);
      onResult(res.items, "Deleted");
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function useSome() {
    const used = parseFloat(useAmt);
    if (!used || used <= 0) {
      onError("Enter grams to use");
      return;
    }
    const remaining = item.quantity - used;
    if (remaining <= 0) {
      // Used it all → delete
      if (!confirm(`Using ${used}g empties this item. Remove it?`)) return;
      setBusy(true);
      try {
        const res = await deleteItem(item.id);
        onResult(res.items, `Used ${used}g — removed`);
        onClose();
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      const res = await updateItem({
        id: item.id,
        name: item.name,
        quantity: remaining,
        expiry: item.expiry || undefined,
        category: item.category,
      });
      onResult(res.items, `Used ${used}g`);
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <h2>Edit item</h2>
        <div className="field">
          <label htmlFor="edit-name">Name</label>
          <input
            id="edit-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Category</label>
          <CategoryPills value={cat} onChange={setCat} />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="edit-qty">Quantity (g)</label>
            <input
              id="edit-qty"
              type="number"
              inputMode="numeric"
              min={0}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="edit-exp">Expiry</label>
            <input
              id="edit-exp"
              type="date"
              value={exp}
              onChange={(e) => setExp(e.target.value)}
            />
          </div>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="use-amt">Use some (g)</label>
          <div className="use-row">
            <input
              id="use-amt"
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="e.g. 200"
              value={useAmt}
              onChange={(e) => setUseAmt(e.target.value)}
            />
            <button
              type="button"
              className="btn-accent"
              onClick={useSome}
              disabled={busy}
            >
              Use
            </button>
          </div>
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="btn-danger"
            onClick={del}
            disabled={busy}
          >
            Delete
          </button>
          <div className="right">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ background: "var(--accent)", color: "white" }}
              onClick={save}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
