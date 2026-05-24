"use client";

import { fmtMoney } from "@/lib/money";
import type { Expense } from "@/lib/types";

type Props = {
  item: Expense;
  color: string;
  onClick: (id: string) => void;
};

export default function ExpenseRow({ item, color, onClick }: Props) {
  return (
    <button
      type="button"
      className="item"
      onClick={() => onClick(item.id)}
    >
      <div className="item-main">
        <div className="item-name">{item.name}</div>
        <div className="item-meta">
          <span className="cat-tag" style={{ color }}>
            {item.category}
          </span>
          {item.store ? (
            <>
              <span className="dot" />
              <span>{item.store}</span>
            </>
          ) : null}
          <span className="dot" />
          <span>Paid by {item.paidBy}</span>
        </div>
      </div>
      <div className="item-qty">{fmtMoney(item.amountCents)}</div>
      <div className="item-chev">›</div>
    </button>
  );
}
