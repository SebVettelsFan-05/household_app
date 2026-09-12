"use client";

import { useEffect, useState } from "react";
import { ReceiptPicker } from "@/components/AddExpenseForm";
import AllocationEditor, {
  allocationsForSubmit,
  allocationsRemainder,
  blankAllocation,
  type EditableAllocation,
} from "@/components/AllocationEditor";
import FreshSheet from "@/components/fresh/FreshSheet";
import PersonPicker from "@/components/PersonPicker";
import { normalizeAllocations } from "@/lib/allocations";
import { addExpense } from "@/lib/client";
import { todayYmd } from "@/lib/dates";
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

/**
 * Add sheet: the amount first and large, then who paid, then how the
 * receipt splits, then the paperwork. The validation and the API call are
 * the same sequence the classic add card runs, so an expense entered here is
 * indistinguishable from one entered there.
 */
export default function FreshAddExpenseSheet({
  mealGroup,
  onClose,
  onResult,
}: Props) {
  const currentMonthStart = firstDayOfMonth(currentExpenseMonth());
  // The household calendar, not the browser's: a receipt entered late on the
  // last of the month must not be dated into next month (or the future) just
  // because the phone is in another timezone.
  const today = todayYmd();
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [store, setStore] = useState("");
  const [description, setDescription] = useState("");
  const [occurredOn, setOccurredOn] = useState<string>(today);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [allocations, setAllocations] = useState<EditableAllocation[]>(() => [
    blankAllocation(),
  ]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const totalCents = parseCents(amount) ?? 0;

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
    <FreshSheet
      title="Add expense"
      onClose={onClose}
      actions={
        <button
          type="button"
          className="fresh-btn fresh-btn-primary fresh-btn-block"
          onClick={submit}
          disabled={busy}
        >
          {busy ? "Uploading" : "Add expense"}
        </button>
      }
    >
      <div className="fresh-field">
        <label htmlFor="fx-amount">Amount</label>
        <div className="fresh-amount-wrap">
          <span className="fresh-amount-sign" aria-hidden="true">
            $
          </span>
          <input
            id="fx-amount"
            className="fresh-input fresh-input-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
      </div>

      <PersonPicker
        id="fx-by"
        label="Paid by"
        value={paidBy}
        onChange={setPaidBy}
        emptyLabel="Pick a name…"
        disabled={busy}
      />

      <div className="fresh-field">
        <label id="fx-split-label">Split</label>
        <div role="group" aria-labelledby="fx-split-label">
          <AllocationEditor
            totalCents={totalCents}
            value={allocations}
            onChange={setAllocations}
            members={BUYERS}
            mealGroup={mealGroup}
            disabled={busy}
          />
        </div>
      </div>

      <div className="fresh-field">
        <label htmlFor="fx-receipt">Receipt</label>
        <ReceiptPicker
          inputId="fx-receipt"
          file={receipt}
          previewUrl={previewUrl}
          onChange={setReceipt}
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
            max={today}
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

      {error ? (
        <p className="fresh-form-error" role="alert">
          {error}
        </p>
      ) : null}
    </FreshSheet>
  );
}
