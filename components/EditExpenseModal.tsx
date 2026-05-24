"use client";

import { useEffect, useState } from "react";
import { deleteExpense, updateExpense } from "@/lib/client";
import { fmtMoney, parseCents } from "@/lib/money";
import {
  BUYERS,
  type Category,
  type Expense,
  type ExpenseCategoryDef,
} from "@/lib/types";
import CategoryPills from "./CategoryPills";

const EXPENSE_FALLBACK = "Misc";

type Props = {
  item: Expense;
  categories: ExpenseCategoryDef[];
  onClose: () => void;
  onResult: (expenses: Expense[], toast: string) => void;
  onError: (message: string) => void;
  onManageCategories: () => void;
};

export default function EditExpenseModal({
  item,
  categories,
  onClose,
  onResult,
  onError,
  onManageCategories,
}: Props) {
  const [name, setName] = useState(item.name);
  const [amount, setAmount] = useState(
    fmtMoney(item.amountCents).replace("$", "")
  );
  const [store, setStore] = useState(item.store || "");
  const [paidBy, setPaidBy] = useState(item.paidBy);
  const [cat, setCat] = useState<Category>(item.category || EXPENSE_FALLBACK);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (categories.length > 0 && !categories.some((c) => c.name === cat)) {
      const hasFallback = categories.some((c) => c.name === EXPENSE_FALLBACK);
      setCat(hasFallback ? EXPENSE_FALLBACK : categories[0].name);
    }
  }, [categories, cat]);

  async function save() {
    const trimmed = name.trim();
    const cents = parseCents(amount);
    if (!trimmed || cents === null || cents <= 0) {
      onError("Check your inputs");
      return;
    }
    if (!paidBy) {
      onError("Pick who paid");
      return;
    }
    setBusy(true);
    try {
      const res = await updateExpense({
        id: item.id,
        name: trimmed,
        amountCents: cents,
        category: cat,
        store,
        paidBy,
      });
      onResult(res.expenses, "Saved");
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!confirm("Delete this expense?")) return;
    setBusy(true);
    try {
      const res = await deleteExpense(item.id);
      onResult(res.expenses, "Deleted");
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
        <h2>Edit expense</h2>
        <div className="field">
          <label htmlFor="ee-name">Name</label>
          <input
            id="ee-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <div className="cat-pills-row">
            <label>Category</label>
            <button
              type="button"
              className="manage-link"
              onClick={onManageCategories}
            >
              Manage
            </button>
          </div>
          <CategoryPills
            categories={categories}
            value={cat}
            onChange={setCat}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="ee-amount">Amount ($)</label>
            <input
              id="ee-amount"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="ee-store">Store / To</label>
            <input
              id="ee-store"
              type="text"
              placeholder="(optional)"
              value={store}
              onChange={(e) => setStore(e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="ee-by">Paid by</label>
          <select
            id="ee-by"
            className="select"
            value={paidBy}
            onChange={(e) => setPaidBy(e.target.value)}
          >
            <option value="" disabled>
              Pick a name…
            </option>
            {BUYERS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
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
