"use client";

import { fmtMoney } from "@/lib/money";
import type { Expense } from "@/lib/types";

type Props = {
  item: Expense;
  onClick: (id: string) => void;
};

export default function ExpenseRow({ item, onClick }: Props) {
  const hasReceipt = Boolean(item.receiptUrl);
  return (
    <button type="button" className="item" onClick={() => onClick(item.id)}>
      <div className="item-main">
        <div className="item-name">{item.name}</div>
        <div className="item-meta">
          <span>Paid by {item.paidBy}</span>
          {item.description ? (
            <>
              <span className="dot" />
              <span className="item-desc">{item.description}</span>
            </>
          ) : null}
          {hasReceipt ? (
            <>
              <span className="dot" />
              <a
                href={item.receiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="receipt-pill"
                onClick={(e) => e.stopPropagation()}
                title="Open receipt"
                aria-label="Open receipt"
              >
                📎
              </a>
            </>
          ) : (
            <>
              <span className="dot" />
              <span className="receipt-missing" title="No receipt on file">
                no receipt
              </span>
            </>
          )}
        </div>
      </div>
      <div className="item-qty">{fmtMoney(item.amountCents)}</div>
      <div className="item-chev">›</div>
    </button>
  );
}
