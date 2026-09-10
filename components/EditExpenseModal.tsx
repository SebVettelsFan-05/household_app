"use client";

import { useEffect, useState } from "react";
import AllocationEditor, {
  allocationsForSubmit,
  allocationsRemainder,
  seedAllocations,
  type EditableAllocation,
} from "@/components/AllocationEditor";
import { ReceiptPicker } from "@/components/AddExpenseForm";
import { normalizeAllocations } from "@/lib/allocations";
import ReceiptLightbox from "@/components/ReceiptLightbox";
import { deleteExpense, updateExpense } from "@/lib/client";
import {
  currentExpenseMonth,
  firstDayOfMonth,
  isPastExpenseMonth,
} from "@/lib/expenseMonths";
import { driveImageUrl, prepareReceipt } from "@/lib/imageResize";
import { fmtMoney, parseCents } from "@/lib/money";
import { BUYERS, type Expense } from "@/lib/types";

type Props = {
  item: Expense;
  mealGroup: string[];
  onClose: () => void;
  onResult: (expenses: Expense[], toast: string) => void;
  onError: (message: string) => void;
};

export default function EditExpenseModal({
  item,
  mealGroup,
  onClose,
  onResult,
  onError,
}: Props) {
  const currentMonthStart = firstDayOfMonth(currentExpenseMonth());
  const [store, setStore] = useState(item.store || "");
  const [amount, setAmount] = useState(
    fmtMoney(item.amountCents).replace("$", "")
  );
  const [paidBy, setPaidBy] = useState(item.paidBy);
  const [occurredOn, setOccurredOn] = useState(item.occurredOn || item.added);
  const [description, setDescription] = useState(item.description || "");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [expandedExisting, setExpandedExisting] = useState(false);
  const [allocations, setAllocations] = useState<EditableAllocation[]>(() =>
    seedAllocations(item.allocations ?? [])
  );
  const [busy, setBusy] = useState(false);

  const totalCents = parseCents(amount) ?? 0;

  const hasExistingReceipt = Boolean(item.receiptUrl);
  const existingIsImage =
    hasExistingReceipt &&
    !!item.receiptMime &&
    item.receiptMime.startsWith("image/");
  // Drive's getUrl() points to a viewer HTML page that can't be used as <img>.
  // The lh3.googleusercontent.com host serves the raw bytes for files shared
  // "anyone with the link can view", which is how the GAS handler sets them.
  const existingImgSrc = existingIsImage && item.receiptFileId
    ? driveImageUrl(item.receiptFileId, 1600)
    : "";

  useEffect(() => {
    if (!receipt) {
      setPreviewUrl(null);
      return;
    }
    if (!receipt.type.startsWith("image/")) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(receipt);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [receipt]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    const cents = parseCents(amount);
    if (cents === null || cents <= 0) {
      onError("Amount must be greater than $0");
      return;
    }
    if (!store.trim()) {
      onError("Store / source is required");
      return;
    }
    if (!paidBy) {
      onError("Pick who paid");
      return;
    }
    if (isPastExpenseMonth(occurredOn)) {
      onError("Past months are locked");
      return;
    }
    if (allocations.some((a) => a.kind === "")) {
      onError("Pick what each split line was for");
      return;
    }
    if (allocationsRemainder(allocations, cents) !== 0) {
      onError("The split lines have to add up to the receipt total");
      return;
    }
    // Untouched lines send their stored snapshot back so an old month keeps
    // the people it was settled against.
    const payload = allocationsForSubmit(allocations, { keepSnapshots: true });
    try {
      normalizeAllocations(payload, cents, { members: BUYERS, mealGroup });
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      return;
    }
    setBusy(true);
    try {
      const prepared = receipt ? await prepareReceipt(receipt) : null;
      const res = await updateExpense({
        id: item.id,
        amountCents: cents,
        store: store.trim(),
        paidBy,
        occurredOn,
        description: description.trim(),
        allocations: payload,
        ...(prepared
          ? { receipt: { blob: prepared.blob, filename: prepared.filename } }
          : {}),
      });
      onResult(res.expenses, prepared ? "Saved (receipt replaced)" : "Saved");
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
          <label htmlFor="ee-store">Store / source</label>
          <input
            id="ee-store"
            type="text"
            value={store}
            onChange={(e) => setStore(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="ee-desc">Description (optional)</label>
          <input
            id="ee-desc"
            type="text"
            placeholder="e.g. Gas, Pizza"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
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
            <label htmlFor="ee-date">Date</label>
            <input
              id="ee-date"
              type="date"
              min={currentMonthStart}
              value={occurredOn}
              onChange={(e) => setOccurredOn(e.target.value)}
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

        <div className="field">
          <label>Receipt</label>
          {hasExistingReceipt && !receipt ? (
            <div className="receipt-existing">
              {existingImgSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={existingImgSrc}
                  alt="Current receipt"
                  className="receipt-existing-thumb"
                  onClick={() => setExpandedExisting(true)}
                  title="Click to expand"
                />
              ) : (
                <span className="receipt-existing-icon btn-emoji" aria-hidden="true">📄</span>
              )}
              <div className="receipt-existing-meta">
                <a
                  href={item.receiptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="receipt-existing-link"
                >
                  Open current receipt<span className="btn-emoji" aria-hidden="true"> ↗</span>
                </a>
                <p className="receipt-hint">
                  Attach a new file below to replace it.
                </p>
              </div>
            </div>
          ) : !hasExistingReceipt && !receipt ? (
            <p className="receipt-legacy-note">
              This expense was logged before receipts were required. Attach
              one now to backfill (optional).
            </p>
          ) : null}
          <ReceiptPicker
            inputId="ee-receipt"
            file={receipt}
            previewUrl={previewUrl}
            onChange={setReceipt}
          />
        </div>

        {expandedExisting && existingImgSrc ? (
          <ReceiptLightbox
            src={existingImgSrc}
            alt="Current receipt"
            originalHref={item.receiptUrl}
            onClose={() => setExpandedExisting(false)}
          />
        ) : null}

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
