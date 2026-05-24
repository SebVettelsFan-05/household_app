"use client";

import { KeyboardEvent, useEffect, useState } from "react";
import { addExpense } from "@/lib/client";
import { parseCents } from "@/lib/money";
import {
  BUYERS,
  type Category,
  type Expense,
  type ExpenseCategoryDef,
} from "@/lib/types";
import CategoryPills from "./CategoryPills";

type Props = {
  categories: ExpenseCategoryDef[];
  onResult: (expenses: Expense[], toast: string) => void;
  onError: (message: string) => void;
  onManageCategories: () => void;
};

const EXPENSE_FALLBACK = "Misc";

export default function AddExpenseForm({
  categories,
  onResult,
  onError,
  onManageCategories,
}: Props) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [store, setStore] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [cat, setCat] = useState<Category>(EXPENSE_FALLBACK);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (categories.length > 0 && !categories.some((c) => c.name === cat)) {
      const hasFallback = categories.some((c) => c.name === EXPENSE_FALLBACK);
      setCat(hasFallback ? EXPENSE_FALLBACK : categories[0].name);
    }
  }, [categories, cat]);

  async function submit() {
    const trimmed = name.trim();
    const cents = parseCents(amount);
    if (!trimmed) {
      onError("Name is required");
      return;
    }
    if (cents === null || cents <= 0) {
      onError("Amount must be greater than $0");
      return;
    }
    if (!paidBy) {
      onError("Pick who paid");
      return;
    }
    setBusy(true);
    try {
      const res = await addExpense({
        name: trimmed,
        amountCents: cents,
        category: cat,
        store: store.trim() || undefined,
        paidBy,
      });
      onResult(res.expenses, "Expense added");
      setName("");
      setAmount("");
      setStore("");
      // Keep paidBy + category for fast repeated entry.
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onEnter(e: KeyboardEvent) {
    if (e.key === "Enter") submit();
  }

  return (
    <section className="add-card">
      <h2>Add expense</h2>
      <div className="field">
        <label htmlFor="e-name">Name</label>
        <input
          id="e-name"
          type="text"
          placeholder="e.g. Costco run, March rent"
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onEnter}
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
        <CategoryPills categories={categories} value={cat} onChange={setCat} />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="e-amount">Amount ($)</label>
          <input
            id="e-amount"
            type="text"
            inputMode="decimal"
            placeholder="49.99"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={onEnter}
          />
        </div>
        <div className="field">
          <label htmlFor="e-store">Store / To (optional)</label>
          <input
            id="e-store"
            type="text"
            placeholder="e.g. Costco, Hydro Quebec"
            autoComplete="off"
            value={store}
            onChange={(e) => setStore(e.target.value)}
            onKeyDown={onEnter}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="e-by">Paid by</label>
        <select
          id="e-by"
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

      <button
        className="btn-primary"
        onClick={submit}
        disabled={busy}
        type="button"
      >
        {busy ? "Adding…" : "Add expense"}
      </button>
    </section>
  );
}
