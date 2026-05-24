"use client";

import { KeyboardEvent, useState } from "react";
import {
  addExpenseCategory,
  deleteExpenseCategory,
  updateExpenseCategoryColor,
} from "@/lib/client";
import { getCategoryColor } from "@/lib/categoryColors";
import type { Expense, ExpenseCategoryDef } from "@/lib/types";

const EXPENSE_FALLBACK = "Misc";

type Props = {
  categories: ExpenseCategoryDef[];
  expenses: Expense[];
  onClose: () => void;
  onCategoriesChange: (categories: ExpenseCategoryDef[]) => void;
  onExpensesChange: (expenses: Expense[]) => void;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
};

export default function ManageExpenseCategoriesModal({
  categories,
  expenses,
  onClose,
  onCategoriesChange,
  onExpensesChange,
  onToast,
  onError,
}: Props) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function add() {
    const trimmed = newName.trim();
    if (!trimmed) {
      onError("Name is required");
      return;
    }
    if (trimmed.length > 32) {
      onError("Name is too long");
      return;
    }
    setBusy(true);
    try {
      const res = await addExpenseCategory(trimmed, newColor || null);
      onCategoriesChange(res.expenseCategories);
      setNewName("");
      setNewColor("");
      onToast(res.existed ? `"${trimmed}" already exists` : `Added "${trimmed}"`);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(name: string) {
    const usingCount = expenses.filter((e) => e.category === name).length;
    const msg = usingCount
      ? `Delete "${name}"? ${usingCount} expense${usingCount === 1 ? "" : "s"} will move to "${EXPENSE_FALLBACK}".`
      : `Delete "${name}"?`;
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      const res = await deleteExpenseCategory(name);
      onCategoriesChange(res.expenseCategories);
      onExpensesChange(res.expenses);
      onToast(
        res.reassigned
          ? `Removed "${name}" — ${res.reassigned} expense${res.reassigned === 1 ? "" : "s"} reassigned`
          : `Removed "${name}"`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function changeColor(name: string, hex: string) {
    setBusy(true);
    try {
      const res = await updateExpenseCategoryColor(name, hex);
      onCategoriesChange(res.expenseCategories);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function resetColor(name: string) {
    setBusy(true);
    try {
      const res = await updateExpenseCategoryColor(name, null);
      onCategoriesChange(res.expenseCategories);
      onToast(`Reset "${name}" to default color`);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onEnter(e: KeyboardEvent) {
    if (e.key === "Enter") add();
  }

  const newSwatch =
    newColor ||
    (newName.trim() ? getCategoryColor(newName.trim()) : "#8B8278");

  return (
    <div
      className="modal-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <h2>Expense categories</h2>
        <div className="cat-mgr-list">
          {categories.map((c) => {
            const resolved = getCategoryColor(c.name, c.color);
            const inUse = expenses.filter((e) => e.category === c.name).length;
            const protectedCat = c.name === EXPENSE_FALLBACK;
            const swatchValue = c.color || resolved;
            const inputId = `excolor-${c.name}`;
            return (
              <div className="cat-mgr-row" key={c.name}>
                <label
                  htmlFor={inputId}
                  className="cat-swatch"
                  style={{ background: swatchValue }}
                  title="Click to change color"
                />
                <input
                  id={inputId}
                  type="color"
                  className="cat-color-input"
                  value={swatchValue}
                  disabled={busy}
                  onChange={(e) => changeColor(c.name, e.target.value)}
                />
                <span className="cat-mgr-name" style={{ color: resolved }}>
                  {c.name}
                </span>
                <span className="cat-mgr-meta">
                  {inUse} expense{inUse === 1 ? "" : "s"}
                </span>
                {c.color ? (
                  <button
                    type="button"
                    className="cat-mgr-link"
                    onClick={() => resetColor(c.name)}
                    disabled={busy}
                  >
                    Reset
                  </button>
                ) : null}
                {protectedCat ? (
                  <span className="cat-mgr-protected">default</span>
                ) : (
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => remove(c.name)}
                    disabled={busy}
                  >
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="field">
          <label htmlFor="new-ex-cat">New category</label>
          <div className="new-cat-row">
            <label
              htmlFor="new-ex-cat-color"
              className="cat-swatch"
              style={{ background: newSwatch }}
            />
            <input
              id="new-ex-cat-color"
              type="color"
              className="cat-color-input"
              value={newColor || newSwatch}
              onChange={(e) => setNewColor(e.target.value)}
              disabled={busy}
            />
            <input
              id="new-ex-cat"
              type="text"
              placeholder="e.g. Travel"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={onEnter}
              maxLength={32}
              disabled={busy}
            />
            <button
              type="button"
              className="btn-accent"
              onClick={add}
              disabled={busy}
            >
              Add
            </button>
          </div>
        </div>

        <div className="modal-actions">
          <div />
          <div className="right">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={busy}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
