"use client";

import { useEffect, useState } from "react";
import { ReceiptPicker } from "@/components/AddExpenseForm";
import { deleteExpense, updateExpense } from "@/lib/client";
import { prepareReceipt } from "@/lib/imageResize";
import { fmtMoney, parseCents } from "@/lib/money";
import { BUYERS, type Expense } from "@/lib/types";

type Props = {
  item: Expense;
  onClose: () => void;
  onResult: (expenses: Expense[], toast: string) => void;
  onError: (message: string) => void;
};

export default function EditExpenseModal({
  item,
  onClose,
  onResult,
  onError,
}: Props) {
  const [store, setStore] = useState(item.store || "");
  const [amount, setAmount] = useState(
    fmtMoney(item.amountCents).replace("$", "")
  );
  const [paidBy, setPaidBy] = useState(item.paidBy);
  const [occurredOn, setOccurredOn] = useState(item.occurredOn || item.added);
  const [description, setDescription] = useState(item.description || "");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hasExistingReceipt = Boolean(item.receiptUrl);
  const existingIsImage =
    hasExistingReceipt &&
    !!item.receiptMime &&
    item.receiptMime.startsWith("image/");

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
          <label>Receipt</label>
          {hasExistingReceipt && !receipt ? (
            <div className="receipt-existing">
              {existingIsImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.receiptUrl}
                  alt="Current receipt"
                  className="receipt-existing-thumb"
                />
              ) : (
                <span className="receipt-existing-icon">📄</span>
              )}
              <div className="receipt-existing-meta">
                <a
                  href={item.receiptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="receipt-existing-link"
                >
                  Open current receipt ↗
                </a>
                <p className="receipt-hint">
                  Attach a new file below to replace it.
                </p>
              </div>
            </div>
          ) : !hasExistingReceipt && !receipt ? (
            <p className="receipt-legacy-note">
              This expense was logged before receipts were required — attach
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
