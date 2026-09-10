"use client";

import { useEffect, useState } from "react";
import { ReceiptPicker } from "@/components/AddExpenseForm";
import AllocationEditor, {
  allocationsForSubmit,
  allocationsRemainder,
  blankAllocation,
  type EditableAllocation,
} from "@/components/AllocationEditor";
import { normalizeAllocations } from "@/lib/allocations";
import { addExpense } from "@/lib/client";
import {
  currentExpenseMonth,
  firstDayOfMonth,
  isPastExpenseMonth,
} from "@/lib/expenseMonths";
import { prepareReceipt } from "@/lib/imageResize";
import { parseCents } from "@/lib/money";
import { BUYERS, type Expense } from "@/lib/types";

type Props = {
  mealGroup: string[];
  onClose: () => void;
  onResult: (expenses: Expense[], toast: string) => void;
};

function todayYmdLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Full-height add sheet: amount first, then who paid, then what the receipt
 * was for. The validation and the API call are the same sequence the classic
 * add card runs, so an expense entered here is indistinguishable from one
 * entered there.
 */
export default function FreshAddExpenseSheet({
  mealGroup,
  onClose,
  onResult,
}: Props) {
  const currentMonthStart = firstDayOfMonth(currentExpenseMonth());
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [store, setStore] = useState("");
  const [description, setDescription] = useState("");
  const [occurredOn, setOccurredOn] = useState<string>(todayYmdLocal);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [allocations, setAllocations] = useState<EditableAllocation[]>(() => [
    blankAllocation(),
  ]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const totalCents = parseCents(amount) ?? 0;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Object URLs need to be revoked or the browser leaks the blob.
  useEffect(() => {
    if (!receipt || !receipt.type.startsWith("image/")) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(receipt);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [receipt]);

  async function submit() {
    const cents = parseCents(amount);
    if (cents === null || cents <= 0) {
      setError("Amount must be greater than $0");
      return;
    }
    if (!store.trim()) {
      setError("Store or source is required");
      return;
    }
    if (!paidBy) {
      setError("Pick who paid");
      return;
    }
    if (isPastExpenseMonth(occurredOn)) {
      setError("Past months are locked");
      return;
    }
    if (!receipt) {
      setError("Attach a receipt photo or PDF");
      return;
    }
    if (allocations.some((a) => a.kind === "")) {
      setError("Pick what each split line was for");
      return;
    }
    if (allocationsRemainder(allocations, cents) !== 0) {
      setError("The split lines have to add up to the receipt total");
      return;
    }
    const payload = allocationsForSubmit(allocations, { keepSnapshots: false });
    try {
      // Same validator the server runs, so bad input fails here with the
      // identical message instead of after the receipt upload.
      normalizeAllocations(payload, cents, { members: BUYERS, mealGroup });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    setError("");
    setBusy(true);
    try {
      const prepared = await prepareReceipt(receipt);
      const res = await addExpense({
        amountCents: cents,
        store: store.trim(),
        paidBy,
        occurredOn,
        description: description.trim() || undefined,
        allocations: payload,
        receipt: { blob: prepared.blob, filename: prepared.filename },
      });
      onResult(res.expenses, "Expense added");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fresh-sheet-bg"
      onClick={(e) => {
        // Catch layer: only a click that lands on the backdrop itself
        // dismisses, and it never reaches whatever is underneath.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="fresh-sheet fresh-sheet-tall"
        role="dialog"
        aria-modal="true"
        aria-label="Add expense"
      >
        <div className="fresh-sheet-head">
          <h2 className="fresh-h2">Add expense</h2>
          <button
            type="button"
            className="fresh-btn fresh-btn-quiet"
            onClick={onClose}
            aria-label="Close"
          >
            Close
          </button>
        </div>

        <div className="fresh-field">
          <label htmlFor="fx-amount">Amount</label>
          <input
            id="fx-amount"
            className="fresh-input fresh-input-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <p className="fresh-field-hint">The receipt total, before the split.</p>
        </div>

        <div className="fresh-field">
          <label id="fx-paid-label">Paid by</label>
          <div className="fresh-chips" role="group" aria-labelledby="fx-paid-label">
            {BUYERS.map((b) => (
              <button
                key={b}
                type="button"
                className={`fresh-chip${paidBy === b ? " active" : ""}`}
                aria-pressed={paidBy === b}
                onClick={() => setPaidBy(b)}
                disabled={busy}
              >
                {b}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Split</label>
          <AllocationEditor
            totalCents={totalCents}
            value={allocations}
            onChange={setAllocations}
            members={BUYERS}
            mealGroup={mealGroup}
            disabled={busy}
          />
        </div>

        <div className="fresh-field">
          <label htmlFor="fx-store">Store or source</label>
          <input
            id="fx-store"
            className="fresh-input"
            type="text"
            placeholder="e.g. Costco"
            autoComplete="off"
            value={store}
            onChange={(e) => setStore(e.target.value)}
          />
        </div>

        <div className="fresh-field-row">
          <div className="fresh-field">
            <label htmlFor="fx-date">Date</label>
            <input
              id="fx-date"
              className="fresh-input"
              type="date"
              min={currentMonthStart}
              value={occurredOn}
              onChange={(e) => setOccurredOn(e.target.value)}
            />
          </div>
          <div className="fresh-field">
            <label htmlFor="fx-desc">Description</label>
            <input
              id="fx-desc"
              className="fresh-input"
              type="text"
              placeholder="Optional"
              autoComplete="off"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="fx-receipt">Receipt</label>
          <ReceiptPicker
            inputId="fx-receipt"
            file={receipt}
            previewUrl={previewUrl}
            onChange={setReceipt}
          />
        </div>

        {error ? (
          <p className="fresh-form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="fresh-sheet-actions">
          <button
            type="button"
            className="fresh-btn"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="fresh-btn fresh-btn-primary"
            onClick={submit}
            disabled={busy}
          >
            {busy ? "Uploading" : "Add expense"}
          </button>
        </div>
      </div>
    </div>
  );
}
