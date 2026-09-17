"use client";

import { useState } from "react";
import AllocationSummary from "@/components/AllocationSummary";
import AmountInput from "@/components/AmountInput";
import ReceiptLightbox from "@/components/ReceiptLightbox";
import SplitCard from "@/components/SplitCard";
import { driveImageUrl } from "@/lib/imageResize";
import {
  fmtTripDate,
  useMonthlyBills,
  useMonthlyBreakdown,
  ymLabel,
} from "@/lib/monthlyBills";
import { fmtMoney } from "@/lib/money";
import { BUYERS, type Expense } from "@/lib/types";

/**
 * Monthly breakdown — three editable sections (one-time, recurring fixed,
 * recurring variable) plus a per-person Rent block and a settlement section
 * at the bottom that folds everything into a Send / Withdraw breakdown.
 *
 * Rent is its own thing because each house member owes a different amount
 * (e.g. Arthur $800, Daniel $800, Eli $700, …). We store per-person
 * allocations with the same forward-write schedule + per-month overrides
 * pattern used for the other bills, just keyed by name instead of carrying
 * a single cents value.
 *
 * Internet is folded into the 5-way share pool but recorded as fully paid
 * by Arthur — that's the household convention, so the settlement math
 * gives Arthur credit for the whole amount.
 */

/* ---------- Component ---------- */

type Props = {
  expenses: Expense[];
  onToast: (msg: string) => void;
};

export default function MonthlyBreakdown({ expenses, onToast }: Props) {
  // Classic shows the month on one screen only, so the breakdown is the sole
  // reader of the bills and can own the store itself.
  const bills = useMonthlyBills(onToast);
  const view = useMonthlyBreakdown(expenses, onToast, bills);
  const {
    month,
    isCurrentMonth,
    monthLocked,
    canEditMonth,
    canGoPrev,
    oneTime,
    settlement,
    grandTotal,
  } = view;
  const [newFixedName, setNewFixedName] = useState("");
  const [newFixedAmount, setNewFixedAmount] = useState("");
  const [newVariableName, setNewVariableName] = useState("");
  const [newVariableAmount, setNewVariableAmount] = useState("");
  const [receiptPreview, setReceiptPreview] = useState<{
    src: string;
    href: string;
  } | null>(null);

  function addFixedRecurring() {
    if (!view.fixed.add(newFixedName, newFixedAmount)) return;
    setNewFixedName("");
    setNewFixedAmount("");
  }

  function addVariableRecurring() {
    if (!view.variable.add(newVariableName, newVariableAmount)) return;
    setNewVariableName("");
    setNewVariableAmount("");
  }

  return (
    <section className="monthly-card">
      <div className="monthly-head">
        <button
          type="button"
          className="monthly-nav"
          onClick={() => {
            view.goPrev();
          }}
          disabled={!canGoPrev}
          aria-label="Previous month"
        >
          ‹
        </button>
        <div className="monthly-label">{ymLabel(month)}</div>
        <button
          type="button"
          className="monthly-nav"
          onClick={view.goNext}
          aria-label="Next month"
        >
          ›
        </button>
      </div>
      <div className="monthly-section">
        <div className="monthly-section-head">
          <h3>One-time (by store)</h3>
          {/* The shared amount, so this section plus rent plus the bills add
              up to the settlement below. The face value follows it whenever a
              receipt carried a personal line. */}
          <span className="monthly-sub">
            {oneTime.count} expense{oneTime.count === 1 ? "" : "s"} ·{" "}
            <strong>{fmtMoney(oneTime.sharedTotal)}</strong>
            {oneTime.sharedTotal !== oneTime.total ? (
              <span className="monthly-sub-faint">
                {" "}
                of {fmtMoney(oneTime.total)}
              </span>
            ) : null}
          </span>
        </div>
        {oneTime.rows.length === 0 ? (
          <p className="monthly-empty">No logged expenses this month yet.</p>
        ) : (
          <div className="monthly-list">
            {oneTime.rows.map((r) => (
              <details className="monthly-store-row" key={r.store}>
                <summary className="monthly-store-summary">
                  <span className="monthly-row-name">
                    {r.store}
                    <span className="monthly-row-desc">
                      {" "}
                      · {r.trips.length} trip{r.trips.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="monthly-row-amount">
                    {fmtMoney(r.total)}
                  </span>
                </summary>
                <div className="monthly-store-trips">
                  {r.trips.map((t) => {
                    const date = fmtTripDate(t.occurredOn);
                    const canPreviewReceipt = t.canPreview;
                    return (
                      <div className="monthly-trip-row" key={t.id}>
                        <span className="monthly-trip-label">
                          {date ? (
                            <span className="monthly-trip-date">{date}</span>
                          ) : null}
                          {t.description ? (
                            <span className="monthly-trip-desc">
                              {date ? " · " : ""}
                              {t.description}
                            </span>
                          ) : null}
                          {!date && !t.description ? (
                            <span className="monthly-trip-desc">Untitled</span>
                          ) : null}
                          {t.receiptUrl ? (
                            <a
                              href={t.receiptUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="receipt-pill"
                              aria-label="Open receipt"
                              title={
                                canPreviewReceipt
                                  ? "Preview receipt"
                                  : "Open receipt"
                              }
                              style={{ marginLeft: 6 }}
                              onClick={(e) => {
                                if (!canPreviewReceipt) return;
                                e.preventDefault();
                                setReceiptPreview({
                                  src: driveImageUrl(t.receiptFileId, 1600),
                                  href: t.receiptUrl,
                                });
                              }}
                            >
                              <span className="btn-emoji" aria-hidden="true">📎</span>
                            </a>
                          ) : null}
                        </span>
                        <span className="monthly-trip-amount">
                          {fmtMoney(t.amount)}
                        </span>
                        <AllocationSummary
                          allocations={t.allocations}
                          memberCount={BUYERS.length}
                        />
                      </div>
                    );
                  })}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>

      <div className="monthly-section">
        <div className="monthly-section-head">
          <h3>
            Rent (per person)
            {view.rent.overridden ? (
              <span
                className="monthly-row-desc"
                title="A custom allocation is set just for this month"
              >
                {" "}(override)
              </span>
            ) : null}
          </h3>
          <span className="monthly-sub">
            <strong>{fmtMoney(view.rent.total)}</strong> this month
          </span>
        </div>
        <div className="monthly-list">
          {BUYERS.map((name) => (
            <div
              className={`monthly-row is-protected${monthLocked ? " is-locked" : ""}`}
              key={name}
            >
              <span className="monthly-row-name">{name}</span>
              <AmountInput
                cents={view.rent.alloc[name] || undefined}
                onCommit={(cents) => view.rent.commitFor(name, cents)}
                ariaLabel={`${name}'s rent share`}
                disabled={!canEditMonth}
              />
            </div>
          ))}
          {view.rent.overridden && !isCurrentMonth && canEditMonth ? (
            <button
              type="button"
              className="cat-mgr-link"
              onClick={view.rent.clearOverride}
              style={{ alignSelf: "flex-start" }}
              title="Drop this month's override and fall back to the default split"
            >
              ↺ Reset this month
            </button>
          ) : null}
        </div>
      </div>

      <div className="monthly-section">
        <div className="monthly-section-head">
          <h3>Recurring (fixed)</h3>
          <span className="monthly-sub">
            <strong>{fmtMoney(view.fixed.total)}</strong> this month
          </span>
        </div>
        <div className="monthly-list">
          {view.fixed.rows.map((r) => {
            const monthCents = view.fixed.amountFor(r);
            const overridden = view.fixed.isOverridden(r);
            return (
              <div
                className={`monthly-row${r.protected ? " is-protected" : ""}${monthLocked ? " is-locked" : ""}`}
                key={r.id}
              >
                <span className="monthly-row-name">
                  {r.name}
                  {overridden ? (
                    <span
                      className="monthly-row-desc"
                      title="A custom amount is set just for this month"
                    >
                      {" "}(override)
                    </span>
                  ) : null}
                </span>
                {overridden && !isCurrentMonth && canEditMonth ? (
                  <button
                    type="button"
                    className="monthly-remove"
                    onClick={() => view.fixed.clearOverride(r.id)}
                    title="Clear this month's override and fall back to the default"
                    aria-label={`Clear ${r.name} override for this month`}
                  >
                    ↺
                  </button>
                ) : null}
                {!r.protected && canEditMonth ? (
                  <button
                    type="button"
                    className="monthly-remove"
                    onClick={() => view.fixed.remove(r.id)}
                    title={`Stop ${r.name} from ${ymLabel(month)} forward`}
                    aria-label={`Stop ${r.name} from this month forward`}
                  >
                    x
                  </button>
                ) : null}
                <AmountInput
                  cents={monthCents || undefined}
                  onCommit={(cents) => view.fixed.commitAmount(r.id, cents)}
                  ariaLabel={`${r.name} amount`}
                  disabled={!canEditMonth}
                />
              </div>
            );
          })}
          {canEditMonth ? (
            <div className="monthly-add">
              <input
                type="text"
                placeholder="New fixed bill"
                value={newFixedName}
                onChange={(e) => setNewFixedName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addFixedRecurring();
                }}
              />
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={newFixedAmount}
                onChange={(e) => setNewFixedAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addFixedRecurring();
                }}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={addFixedRecurring}
              >
                Add
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="monthly-section">
        <div className="monthly-section-head">
          <h3>Recurring (variable)</h3>
          <span className="monthly-sub">
            <strong>{fmtMoney(view.variable.total)}</strong> this month
          </span>
        </div>
        <div className="monthly-list">
          {view.variable.rows.map((line) => {
            const cents = view.variable.amountFor(line);
            return (
              <div
                className={`monthly-row${line.protected ? " is-protected" : ""}${monthLocked ? " is-locked" : ""}`}
                key={line.id}
              >
                <span className="monthly-row-name">{line.name}</span>
                {!line.protected && canEditMonth ? (
                  <button
                    type="button"
                    className="monthly-remove"
                    onClick={() => view.variable.remove(line.id)}
                    title={`Stop ${line.name} from ${ymLabel(month)} forward`}
                    aria-label={`Stop ${line.name} from this month forward`}
                  >
                    x
                  </button>
                ) : null}
                <AmountInput
                  cents={cents}
                  onCommit={(c) => view.variable.setAmount(line.name, c)}
                  ariaLabel={`${line.name} amount`}
                  disabled={!canEditMonth}
                />
              </div>
            );
          })}
          {canEditMonth ? (
            <div className="monthly-add">
              <input
                type="text"
                placeholder="New variable bill"
                value={newVariableName}
                onChange={(e) => setNewVariableName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addVariableRecurring();
                }}
              />
              <input
                type="text"
                inputMode="decimal"
                placeholder="optional"
                value={newVariableAmount}
                onChange={(e) => setNewVariableAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addVariableRecurring();
                }}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={addVariableRecurring}
              >
                Add
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="monthly-total">
        <span>Total for {ymLabel(month)}</span>
        <strong>{fmtMoney(grandTotal)}</strong>
      </div>
      {grandTotal > 0 ? (
        <SplitCard
          title={`Settlement for ${ymLabel(month)}`}
          lines={settlement.lines}
        />
      ) : null}

      {receiptPreview ? (
        <ReceiptLightbox
          src={receiptPreview.src}
          alt="Receipt"
          originalHref={receiptPreview.href}
          onClose={() => setReceiptPreview(null)}
        />
      ) : null}
    </section>
  );
}
