"use client";

import { useEffect, useMemo, useState } from "react";
import { addItem } from "@/lib/client";
import { parseDictation, type DictationItem } from "@/lib/dictationParse";
import { guessCategoryOrFallback } from "@/lib/guessCategory";
import { FALLBACK_CATEGORY, type CategoryDef, type Item } from "@/lib/types";

type DraftRow = DictationItem & {
  id: string;
  category: string;
};

type Props = {
  categories: CategoryDef[];
  items: Item[];
  onClose: () => void;
  // Same shape as AddItemForm.onResult — gives us a single atomic "items
  // changed + toast" hook instead of two separate setters that could race.
  onResult: (items: Item[], toast: string) => void;
  onError: (msg: string) => void;
};

/**
 * Free-text inventory dictation. The user taps the mic on their phone
 * keyboard, talks at the textarea, then hits Parse. We split the blob into
 * one draft row per item, run extraction (name + grams + expiry), and let
 * the user verify/edit each row before bulk-adding to inventory.
 *
 * Phone keyboard dictation is universal (iOS Safari, Android Chrome, every
 * browser with a virtual keyboard), and the OS-level recognition is better
 * than anything Web Speech API would give us — so we just give a textarea.
 */
export default function DictateInventoryModal({
  categories,
  items,
  onClose,
  onResult,
  onError,
}: Props) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const validCategoryNames = useMemo(
    () => categories.map((c) => c.name),
    [categories]
  );
  const history = useMemo(
    () => items.map((i) => ({ name: i.name, category: i.category })),
    [items]
  );

  function handleParse() {
    const parsed = parseDictation(text);
    if (parsed.length === 0) {
      onError(
        "Didn't catch any items — try adding commas or periods between them."
      );
      return;
    }
    const drafts: DraftRow[] = parsed.map((p, idx) => ({
      ...p,
      id: `${Date.now()}-${idx}`,
      category: guessCategoryOrFallback(
        p.name,
        history,
        validCategoryNames
      ),
    }));
    setRows(drafts);
  }

  function updateRow(id: string, patch: Partial<DraftRow>) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function addAll() {
    const ready = rows.filter(
      (r) => r.name.trim().length > 0 && r.quantityGrams > 0
    );
    if (ready.length === 0) {
      onError("Each row needs a name and a weight (g) before it can be added.");
      return;
    }
    setBusy(true);
    let lastItems: Item[] = items;
    let added = 0;
    let failed = 0;
    try {
      for (const row of ready) {
        try {
          const res = await addItem({
            name: row.name.trim(),
            quantity: row.quantityGrams,
            expiry: row.expiry || undefined,
            category:
              row.category && validCategoryNames.includes(row.category)
                ? row.category
                : FALLBACK_CATEGORY,
          });
          lastItems = res.items;
          added++;
        } catch (err) {
          failed++;
          // Keep going — surface a per-row error at the end so the user can
          // edit the failing rows without losing the rest of their work.
          console.error("[dictation] failed to add row", row, err);
        }
      }
      const parts = [];
      if (added > 0) parts.push(`Added ${added} item${added === 1 ? "" : "s"}`);
      if (failed > 0)
        parts.push(`${failed} failed — fix and try again`);
      const summary = parts.join("; ");
      if (added > 0) {
        // Single atomic notification so the parent's `setItems` and toast
        // don't race against each other.
        onResult(lastItems, summary);
      } else if (failed > 0) {
        onError(summary);
      }
      if (failed === 0) onClose();
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
      <div className="modal modal-wide">
        <h2>🎙️ Dictate items</h2>
        <p className="scan-hint" style={{ marginTop: -4 }}>
          Tap the mic on your keyboard and read off product, weight, and
          (optional) expiry — separate items with commas or periods. We&apos;ll
          split them and show each one for you to confirm.
        </p>

        <textarea
          className="textarea"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            'e.g. "Chicken breast 500 grams expires June 12, ' +
            'onions one kilogram, yogurt 750 grams best before May 30"'
          }
        />

        <div className="dictate-toolbar">
          <button
            type="button"
            className="btn-secondary"
            onClick={handleParse}
            disabled={busy || !text.trim()}
          >
            Parse
          </button>
          {rows.length > 0 ? (
            <span className="scan-hint" style={{ marginLeft: "auto" }}>
              {rows.length} draft{rows.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>

        {rows.length > 0 ? (
          <div className="dictate-rows">
            {rows.map((row) => (
              <DraftRowEditor
                key={row.id}
                row={row}
                categories={categories}
                onChange={(patch) => updateRow(row.id, patch)}
                onRemove={() => removeRow(row.id)}
              />
            ))}
          </div>
        ) : null}

        <div className="modal-actions">
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
            className="btn-primary"
            onClick={addAll}
            disabled={busy || rows.length === 0}
            style={{ width: "auto", marginTop: 0 }}
          >
            {busy
              ? "Adding…"
              : `Add ${rows.length || ""} to inventory`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}

function DraftRowEditor({
  row,
  categories,
  onChange,
  onRemove,
}: {
  row: DraftRow;
  categories: CategoryDef[];
  onChange: (patch: Partial<DraftRow>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="dictate-row">
      <div className="dictate-row-head">
        <input
          className="dictate-input-name"
          type="text"
          value={row.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Name"
        />
        <button
          type="button"
          className="ingredient-remove"
          onClick={onRemove}
          aria-label="Remove this row"
          title="Remove"
        >
          ×
        </button>
      </div>
      <div className="dictate-row-fields">
        <input
          className="dictate-input-qty"
          type="number"
          inputMode="numeric"
          min={0}
          value={row.quantityGrams || ""}
          placeholder="grams"
          onChange={(e) =>
            onChange({
              quantityGrams: Math.max(0, Math.round(Number(e.target.value) || 0)),
            })
          }
        />
        <input
          className="dictate-input-exp"
          type="date"
          value={row.expiry}
          onChange={(e) => onChange({ expiry: e.target.value })}
        />
        <select
          className="dictate-input-cat"
          value={row.category}
          onChange={(e) => onChange({ category: e.target.value })}
        >
          {categories.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {row.warnings.length > 0 ? (
        <p className="scan-hint" style={{ marginTop: 4 }}>
          {row.warnings.join(" · ")}
        </p>
      ) : null}
      <p className="scan-hint" style={{ opacity: 0.7, marginTop: 2 }}>
        Heard: &ldquo;{row.raw}&rdquo;
      </p>
    </div>
  );
}
