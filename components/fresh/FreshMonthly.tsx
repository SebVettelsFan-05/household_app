"use client";

import { useState } from "react";
import AmountInput from "@/components/AmountInput";
import FreshSettlementCard from "@/components/fresh/FreshSettlementCard";
import {
  IconChevronLeft,
  IconChevronRight,
  IconPlus,
  IconRefresh,
  IconX,
} from "@/components/fresh/icons";
import { Avatar } from "@/components/fresh/people";
import ReceiptImage from "@/components/ReceiptImage";
import ReceiptLightbox from "@/components/ReceiptLightbox";
import { allocationTag } from "@/lib/allocations";
import { driveImageUrl } from "@/lib/imageResize";
import {
  fmtTripDate,
  useMonthlyBreakdown,
  ymLabel,
  type MonthStoreGroup,
} from "@/lib/monthlyBills";
import { fmtMoney } from "@/lib/money";
import { BUYERS, type Expense } from "@/lib/types";

type Props = {
  expenses: Expense[];
  onToast: (msg: string) => void;
};

/**
 * The month, in the fresh look: what the house spent at each store, what
 * everyone owes on rent, the recurring bills, the total, and the settlement.
 *
 * Every number and every edit goes through `useMonthlyBreakdown`, the same
 * hook the classic breakdown renders, so the two screens cannot drift apart.
 */
export default function FreshMonthly({ expenses, onToast }: Props) {
  const view = useMonthlyBreakdown(expenses, onToast);
  const [openStore, setOpenStore] = useState<string | null>(null);
  const [newFixedName, setNewFixedName] = useState("");
  const [newFixedAmount, setNewFixedAmount] = useState("");
  const [newVariableName, setNewVariableName] = useState("");
  const [newVariableAmount, setNewVariableAmount] = useState("");
  const [preview, setPreview] = useState<{ src: string; href: string } | null>(
    null
  );

  const { month, monthLocked, canEditMonth, isCurrentMonth } = view;

  function addFixed() {
    if (!view.fixed.add(newFixedName, newFixedAmount)) return;
    setNewFixedName("");
    setNewFixedAmount("");
  }

  function addVariable() {
    if (!view.variable.add(newVariableName, newVariableAmount)) return;
    setNewVariableName("");
    setNewVariableAmount("");
  }

  function storeRow(group: MonthStoreGroup) {
    const open = openStore === group.store;
    return (
      <div key={group.store}>
        <button
          type="button"
          className="fresh-row"
          aria-expanded={open}
          onClick={() => setOpenStore(open ? null : group.store)}
        >
          <span className="fresh-row-main">
            <span className="fresh-row-title">{group.store}</span>
            <span className="fresh-row-meta">
              {group.trips.length} trip{group.trips.length === 1 ? "" : "s"}
            </span>
          </span>
          <span className="fresh-row-amount fresh-num">
            {fmtMoney(group.total)}
          </span>
          <span className="fresh-chev">
            <IconChevronRight size={20} />
          </span>
        </button>
        {open ? (
          <div className="fresh-trips">
            {group.trips.map((t) => (
              <div className="fresh-trip" key={t.id}>
                {t.canPreview ? (
                  <button
                    type="button"
                    className="fresh-trip-thumb"
                    onClick={() =>
                      setPreview({
                        src: driveImageUrl(t.receiptFileId, 1600),
                        href: t.receiptUrl,
                      })
                    }
                    aria-label={`Preview the ${group.store} receipt`}
                  >
                    <ReceiptImage
                      src={driveImageUrl(t.receiptFileId, 200)}
                      alt=""
                      loading="lazy"
                      className="fresh-thumb-img"
                      fallback={
                        <span className="fresh-thumb-fallback">Receipt</span>
                      }
                    />
                  </button>
                ) : null}
                <span className="fresh-trip-main">
                  <span className="fresh-trip-when">
                    {fmtTripDate(t.occurredOn) || "No date"}
                  </span>
                  <span className="fresh-trip-desc">
                    {t.description || "Untitled"}
                  </span>
                  <span className="fresh-trip-tags">
                    {t.allocations.map((a, i) => (
                      <span
                        className="fresh-split-tag"
                        data-kind={a.kind}
                        key={i}
                      >
                        {allocationTag(a, BUYERS.length)}
                      </span>
                    ))}
                  </span>
                  {t.receiptUrl && !t.canPreview ? (
                    <a
                      className="fresh-trip-link"
                      href={t.receiptUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open receipt
                    </a>
                  ) : null}
                </span>
                <span className="fresh-trip-amount fresh-num">
                  {fmtMoney(t.amount)}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="fresh-month">
      <div className="fresh-month-head">
        <button
          type="button"
          className="fresh-icon-btn fresh-month-nav"
          onClick={view.goPrev}
          disabled={!view.canGoPrev}
          aria-label="Previous month"
        >
          <IconChevronLeft size={20} />
        </button>
        <span className="fresh-month-label">{ymLabel(month)}</span>
        <button
          type="button"
          className="fresh-icon-btn fresh-month-nav"
          onClick={view.goNext}
          aria-label="Next month"
        >
          <IconChevronRight size={20} />
        </button>
        {monthLocked ? (
          <span className="fresh-badge">Locked</span>
        ) : null}
      </div>

      <section className="fresh-card">
        <div className="fresh-card-head">
          <h2 className="fresh-h2">Receipts</h2>
          <span className="fresh-sub">
            {view.oneTime.count} expense{view.oneTime.count === 1 ? "" : "s"}{" "}
            <strong className="fresh-num">
              {fmtMoney(view.oneTime.total)}
            </strong>
          </span>
        </div>
        {view.oneTime.rows.length === 0 ? (
          <div className="fresh-empty">
            <strong>Nothing logged yet</strong>
            Receipts added this month show up here, grouped by store.
          </div>
        ) : (
          <div className="fresh-rows">{view.oneTime.rows.map(storeRow)}</div>
        )}
      </section>

      <section className="fresh-card">
        <div className="fresh-card-head">
          <h2 className="fresh-h2">Rent</h2>
          <span className="fresh-sub">
            <strong className="fresh-num">{fmtMoney(view.rent.total)}</strong>{" "}
            this month
            {view.rent.overridden ? " (override)" : ""}
          </span>
        </div>
        <div className="fresh-bill-rows">
          {BUYERS.map((name) => (
            <div className="fresh-bill-row" key={name}>
              <Avatar name={name} size={28} />
              <span className="fresh-bill-name">{name}</span>
              <span className="fresh-money-field">
                <span className="fresh-money-sign" aria-hidden="true">
                  $
                </span>
                <AmountInput
                  className="fresh-money-input"
                  cents={view.rent.alloc[name] || undefined}
                  onCommit={(cents) => view.rent.commitFor(name, cents)}
                  ariaLabel={`${name}'s rent share`}
                  disabled={monthLocked}
                />
              </span>
            </div>
          ))}
        </div>
        {view.rent.overridden && !isCurrentMonth && !monthLocked ? (
          <button
            type="button"
            className="fresh-btn fresh-btn-small"
            onClick={view.rent.clearOverride}
            title="Drop this month's override and fall back to the default split"
          >
            <IconRefresh size={16} />
            Reset this month
          </button>
        ) : null}
      </section>

      <section className="fresh-card">
        <div className="fresh-card-head">
          <h2 className="fresh-h2">Fixed bills</h2>
          <span className="fresh-sub">
            <strong className="fresh-num">{fmtMoney(view.fixed.total)}</strong>{" "}
            this month
          </span>
        </div>
        <div className="fresh-bill-rows">
          {view.fixed.rows.map((r) => {
            const overridden = view.fixed.isOverridden(r);
            return (
              <div className="fresh-bill-row" key={r.id}>
                <span className="fresh-bill-name">
                  {r.name}
                  {r.paidBy ? (
                    <span className="fresh-bill-note">
                      Paid by {r.paidBy}
                    </span>
                  ) : null}
                  {overridden ? (
                    <span className="fresh-bill-note">
                      Just this month
                    </span>
                  ) : null}
                </span>
                {overridden && !isCurrentMonth && !monthLocked ? (
                  <button
                    type="button"
                    className="fresh-icon-btn fresh-bill-btn"
                    onClick={() => view.fixed.clearOverride(r.id)}
                    aria-label={`Clear ${r.name} override for this month`}
                    title="Clear this month's override"
                  >
                    <IconRefresh size={16} />
                  </button>
                ) : null}
                {!r.protected && !monthLocked ? (
                  <button
                    type="button"
                    className="fresh-icon-btn fresh-bill-btn"
                    onClick={() => view.fixed.remove(r.id)}
                    aria-label={`Stop ${r.name} from this month forward`}
                    title={`Stop ${r.name} from ${ymLabel(month)} forward`}
                  >
                    <IconX size={16} />
                  </button>
                ) : null}
                <span className="fresh-money-field">
                  <span className="fresh-money-sign" aria-hidden="true">
                    $
                  </span>
                  <AmountInput
                    className="fresh-money-input"
                    cents={view.fixed.amountFor(r) || undefined}
                    onCommit={(cents) => view.fixed.commitAmount(r.id, cents)}
                    ariaLabel={`${r.name} amount`}
                    disabled={monthLocked}
                  />
                </span>
              </div>
            );
          })}
        </div>
        {canEditMonth ? (
          <div className="fresh-bill-add">
            <input
              className="fresh-input"
              type="text"
              placeholder="New fixed bill"
              aria-label="New fixed bill name"
              value={newFixedName}
              onChange={(e) => setNewFixedName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addFixed();
              }}
            />
            <input
              className="fresh-input"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              aria-label="New fixed bill amount"
              value={newFixedAmount}
              onChange={(e) => setNewFixedAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addFixed();
              }}
            />
            <button
              type="button"
              className="fresh-btn fresh-btn-add"
              onClick={addFixed}
            >
              <IconPlus size={18} />
              Add
            </button>
          </div>
        ) : null}
      </section>

      <section className="fresh-card">
        <div className="fresh-card-head">
          <h2 className="fresh-h2">Utilities</h2>
          <span className="fresh-sub">
            <strong className="fresh-num">
              {fmtMoney(view.variable.total)}
            </strong>{" "}
            this month
          </span>
        </div>
        <div className="fresh-bill-rows">
          {view.variable.rows.map((line) => (
            <div className="fresh-bill-row" key={line.id}>
              <span className="fresh-bill-name">{line.name}</span>
              {!line.protected && !monthLocked ? (
                <button
                  type="button"
                  className="fresh-icon-btn fresh-bill-btn"
                  onClick={() => view.variable.remove(line.id)}
                  aria-label={`Stop ${line.name} from this month forward`}
                  title={`Stop ${line.name} from ${ymLabel(month)} forward`}
                >
                  <IconX size={16} />
                </button>
              ) : null}
              <span className="fresh-money-field">
                <span className="fresh-money-sign" aria-hidden="true">
                  $
                </span>
                <AmountInput
                  className="fresh-money-input"
                  cents={view.variable.amountFor(line)}
                  onCommit={(c) => view.variable.setAmount(line.name, c)}
                  ariaLabel={`${line.name} amount`}
                  disabled={monthLocked}
                />
              </span>
            </div>
          ))}
        </div>
        {canEditMonth ? (
          <div className="fresh-bill-add">
            <input
              className="fresh-input"
              type="text"
              placeholder="New utility"
              aria-label="New variable bill name"
              value={newVariableName}
              onChange={(e) => setNewVariableName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addVariable();
              }}
            />
            <input
              className="fresh-input"
              type="text"
              inputMode="decimal"
              placeholder="Optional"
              aria-label="New variable bill amount"
              value={newVariableAmount}
              onChange={(e) => setNewVariableAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addVariable();
              }}
            />
            <button
              type="button"
              className="fresh-btn fresh-btn-add"
              onClick={addVariable}
            >
              <IconPlus size={18} />
              Add
            </button>
          </div>
        ) : null}
      </section>

      <section className="fresh-card fresh-month-total">
        <span className="fresh-settle-total-label">
          Total for {ymLabel(month)}
        </span>
        <span className="fresh-big-money">{fmtMoney(view.grandTotal)}</span>
      </section>

      <FreshSettlementCard
        settlement={view.settlement}
        title="Settlement"
        subtitle={ymLabel(month)}
      />

      {preview ? (
        <ReceiptLightbox
          src={preview.src}
          alt="Receipt"
          originalHref={preview.href}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}
