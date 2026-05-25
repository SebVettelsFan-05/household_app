"use client";

import { KeyboardEvent, useEffect, useState } from "react";
import { addExpense } from "@/lib/client";
import { prepareReceipt } from "@/lib/imageResize";
import { parseCents } from "@/lib/money";
import { BUYERS, type Expense } from "@/lib/types";

type Props = {
  onResult: (expenses: Expense[], toast: string) => void;
  onError: (message: string) => void;
};

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const ACCEPT = "image/*,application/pdf";

export default function AddExpenseForm({ onResult, onError }: Props) {
  const [store, setStore] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [occurredOn, setOccurredOn] = useState<string>(todayYmd);
  const [description, setDescription] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Object URLs need to be revoked or the browser leaks the blob.
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

  async function submit() {
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
    if (!receipt) {
      onError("Attach a receipt photo or PDF");
      return;
    }
    setBusy(true);
    try {
      const prepared = await prepareReceipt(receipt);
      const res = await addExpense({
        amountCents: cents,
        store: store.trim(),
        paidBy,
        occurredOn,
        description: description.trim() || undefined,
        receipt: { blob: prepared.blob, filename: prepared.filename },
      });
      onResult(res.expenses, "Expense added");
      setStore("");
      setAmount("");
      setDescription("");
      setReceipt(null);
      setOccurredOn(todayYmd());
      // Keep paidBy for fast repeated entry.
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
        <label htmlFor="e-store">Store / source</label>
        <input
          id="e-store"
          type="text"
          placeholder="e.g. Costco"
          autoComplete="off"
          value={store}
          onChange={(e) => setStore(e.target.value)}
          onKeyDown={onEnter}
        />
      </div>

      <div className="field">
        <label htmlFor="e-desc">Description (optional)</label>
        <input
          id="e-desc"
          type="text"
          placeholder="e.g. Gas, Pizza"
          autoComplete="off"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={onEnter}
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="e-amount">Amount ($)</label>
          <input
            id="e-amount"
            type="text"
            inputMode="decimal"
            placeholder="17.38"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={onEnter}
          />
        </div>
        <div className="field">
          <label htmlFor="e-date">Date</label>
          <input
            id="e-date"
            type="date"
            value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
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

      <div className="field">
        <label htmlFor="e-receipt">Receipt</label>
        <ReceiptPicker
          inputId="e-receipt"
          file={receipt}
          previewUrl={previewUrl}
          onChange={setReceipt}
        />
      </div>

      <button
        className="btn-primary"
        onClick={submit}
        disabled={busy}
        type="button"
      >
        {busy ? "Uploading…" : "Add expense"}
      </button>
    </section>
  );
}

export function ReceiptPicker({
  inputId,
  file,
  previewUrl,
  onChange,
}: {
  inputId: string;
  file: File | null;
  previewUrl: string | null;
  onChange: (file: File | null) => void;
}) {
  return (
    <div className="receipt-picker">
      <label htmlFor={inputId} className="receipt-picker-cta">
        {file ? "Choose a different file" : "Take photo or choose file"}
      </label>
      <input
        id={inputId}
        type="file"
        accept={ACCEPT}
        capture="environment"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          onChange(f);
          // Reset the input so re-picking the same file still fires onChange.
          e.target.value = "";
        }}
      />
      {file ? (
        <div className="receipt-preview">
          {previewUrl ? (
            // Local preview — never sent anywhere until submit.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Receipt preview" />
          ) : (
            <div className="receipt-preview-file">
              <span className="receipt-file-icon">📄</span>
              <span>{file.name}</span>
            </div>
          )}
          <button
            type="button"
            className="receipt-clear"
            onClick={() => onChange(null)}
            aria-label="Remove attached receipt"
          >
            ×
          </button>
        </div>
      ) : (
        <p className="receipt-hint">JPEG, PNG, HEIC, or PDF. Max 4 MB.</p>
      )}
    </div>
  );
}
