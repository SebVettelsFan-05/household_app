"use client";

import { useEffect, useMemo, useState } from "react";
import { addGrocery, addItem } from "@/lib/client";
import { parseDictation, type DictationItem } from "@/lib/dictationParse";
import { guessCategoryOrFallback } from "@/lib/guessCategory";
import {
  BUYERS,
  FALLBACK_CATEGORY,
  type CategoryDef,
  type GroceryItem,
  type Item,
} from "@/lib/types";

type DraftRow = DictationItem & {
  id: string;
  category: string;
};

type InventoryProps = {
  mode: "inventory";
  categories: CategoryDef[];
  items: Item[];
  onClose: () => void;
  // Same shape as AddItemForm.onResult — single atomic notification so the
  // parent's setItems + toast can't race.
  onResult: (items: Item[], toast: string) => void;
  onError: (msg: string) => void;
};

type GroceryProps = {
  mode: "grocery";
  categories: CategoryDef[];
  // Both lists are passed in for category auto-suggest (history-driven).
  grocery: GroceryItem[];
  fridgeItems: Item[];
  onClose: () => void;
  onResult: (grocery: GroceryItem[], toast: string) => void;
  onError: (msg: string) => void;
};

type Props = InventoryProps | GroceryProps;

/**
 * Free-text dictation for inventory or grocery. The user taps the mic on
 * their phone keyboard, talks at the textarea, then hits Parse. We split
 * the blob into one draft row per item, run extraction (name + grams +
 * expiry), and let the user verify/edit each row before bulk-adding.
 *
 * Inventory mode: name + grams + expiry + category. Calls addItem.
 * Grocery   mode: name + grams + category + addedBy (chosen once at the
 *                 top of the modal — all rows attribute to that person).
 *                 Calls addGrocery. Expiry is ignored even if parsed.
 *
 * Phone keyboard dictation is universal (iOS Safari, Android Chrome,
 * every browser with a virtual keyboard), and the OS-level recognition
 * is better than anything Web Speech API would give us — so we just give
 * a textarea.
 */
export default function DictateItemsModal(props: Props) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [addedBy, setAddedBy] = useState<string>(""); // grocery mode only

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") props.onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  const validCategoryNames = useMemo(
    () => props.categories.map((c) => c.name),
    [props.categories]
  );

  const history = useMemo(() => {
    if (props.mode === "inventory") {
      return props.items.map((i) => ({ name: i.name, category: i.category }));
    }
    return [
      ...props.grocery.map((g) => ({ name: g.name, category: g.category })),
      ...props.fridgeItems.map((i) => ({
        name: i.name,
        category: i.category,
      })),
    ];
  }, [props]);

  function handleParse() {
    const parsed = parseDictation(text);
    if (parsed.length === 0) {
      props.onError(
        "Didn't catch any items — try saying the product names with weights."
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
      props.onError("Each row needs a name and a weight (g) before it can be added.");
      return;
    }
    if (props.mode === "grocery" && !addedBy) {
      props.onError("Pick who's adding these.");
      return;
    }
    setBusy(true);
    let added = 0;
    let failed = 0;
    try {
      if (props.mode === "inventory") {
        let lastItems = props.items;
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
            console.error("[dictation] failed to add inventory row", row, err);
          }
        }
        finalize(added, failed, () =>
          props.onResult(
            lastItems,
            summarize(added, failed, "item")
          )
        );
      } else {
        let lastGrocery = props.grocery;
        for (const row of ready) {
          try {
            const res = await addGrocery({
              name: row.name.trim(),
              quantity: row.quantityGrams,
              category:
                row.category && validCategoryNames.includes(row.category)
                  ? row.category
                  : FALLBACK_CATEGORY,
              addedBy,
            });
            lastGrocery = res.grocery;
            added++;
          } catch (err) {
            failed++;
            console.error("[dictation] failed to add grocery row", row, err);
          }
        }
        finalize(added, failed, () =>
          props.onResult(
            lastGrocery,
            summarize(added, failed, "item")
          )
        );
      }
    } finally {
      setBusy(false);
    }
  }

  function finalize(added: number, failed: number, onSuccess: () => void) {
    if (added > 0) {
      onSuccess();
    } else if (failed > 0) {
      props.onError(summarize(added, failed, "item"));
    }
    if (failed === 0) props.onClose();
  }

  const targetLabel = props.mode === "inventory" ? "inventory" : "grocery";
  const hasExpiry = props.mode === "inventory";

  return (
    <div
      className="modal-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="modal modal-wide">
        <h2>🎙️ Dictate {targetLabel} items</h2>
        <p className="scan-hint" style={{ marginTop: -4 }}>
          Tap the mic on your keyboard and read off products with their
          weights. We&apos;ll detect each item from its weight, so you
          don&apos;t need to add commas or pauses between them.
        </p>

        {props.mode === "grocery" ? (
          <div className="field">
            <label htmlFor="dict-by">Added by</label>
            <select
              id="dict-by"
              className="select"
              value={addedBy}
              onChange={(e) => setAddedBy(e.target.value)}
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
        ) : null}

        <textarea
          className="textarea"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            hasExpiry
              ? '"Chicken breast 500 grams expires June 12 onions one kilogram yogurt 750 grams best before May 30"'
              : '"Chicken breast 500 grams onions one kilogram yogurt 750 grams two pounds ground beef"'
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
                categories={props.categories}
                hasExpiry={hasExpiry}
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
            onClick={props.onClose}
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
              : `Add ${rows.length || ""} to ${targetLabel}`.replace(
                  /\s+/g,
                  " "
                )}
          </button>
        </div>
      </div>
    </div>
  );
}

function summarize(added: number, failed: number, noun: string): string {
  const parts: string[] = [];
  if (added > 0)
    parts.push(`Added ${added} ${noun}${added === 1 ? "" : "s"}`);
  if (failed > 0) parts.push(`${failed} failed — fix and try again`);
  return parts.join("; ");
}

function DraftRowEditor({
  row,
  categories,
  hasExpiry,
  onChange,
  onRemove,
}: {
  row: DraftRow;
  categories: CategoryDef[];
  hasExpiry: boolean;
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
      <div
        className="dictate-row-fields"
        style={hasExpiry ? undefined : { gridTemplateColumns: "90px 1fr" }}
      >
        <input
          className="dictate-input-qty"
          type="number"
          inputMode="numeric"
          min={0}
          value={row.quantityGrams || ""}
          placeholder="grams"
          onChange={(e) =>
            onChange({
              quantityGrams: Math.max(
                0,
                Math.round(Number(e.target.value) || 0)
              ),
            })
          }
        />
        {hasExpiry ? (
          <input
            className="dictate-input-exp"
            type="date"
            value={row.expiry}
            onChange={(e) => onChange({ expiry: e.target.value })}
          />
        ) : null}
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
