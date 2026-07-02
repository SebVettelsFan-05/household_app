"use client";

import { useState } from "react";
import ReceiptLightbox from "@/components/ReceiptLightbox";
import { driveImageUrl } from "@/lib/imageResize";
import { fmtMoney } from "@/lib/money";
import type { Expense } from "@/lib/types";

type Props = {
  item: Expense;
  onClick: (id: string) => void;
  locked?: boolean;
};

export default function ExpenseRow({ item, onClick, locked = false }: Props) {
  const [receiptExpanded, setReceiptExpanded] = useState(false);
  const hasReceipt = Boolean(item.receiptUrl);
  const canPreviewReceipt = Boolean(
    item.receiptUrl &&
      item.receiptFileId &&
      item.receiptMime &&
      item.receiptMime.startsWith("image/")
  );
  const previewSrc = canPreviewReceipt
    ? driveImageUrl(item.receiptFileId, 1600)
    : "";

  return (
    <>
      <button
        type="button"
        className={`item${locked ? " locked" : ""}`}
        onClick={() => onClick(item.id)}
        title={locked ? "Past months are locked" : "Edit expense"}
      >
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
                  onClick={(e) => {
                    e.stopPropagation();
                    if (canPreviewReceipt) {
                      e.preventDefault();
                      setReceiptExpanded(true);
                    }
                  }}
                  title={canPreviewReceipt ? "Preview receipt" : "Open receipt"}
                  aria-label={
                    canPreviewReceipt ? "Preview receipt" : "Open receipt"
                  }
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
            {locked ? (
              <>
                <span className="dot" />
                <span className="receipt-missing">locked</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="item-qty">{fmtMoney(item.amountCents)}</div>
        {locked ? null : <div className="item-chev">›</div>}
      </button>

      {receiptExpanded && previewSrc ? (
        <ReceiptLightbox
          src={previewSrc}
          alt="Receipt"
          originalHref={item.receiptUrl}
          onClose={() => setReceiptExpanded(false)}
        />
      ) : null}
    </>
  );
}
