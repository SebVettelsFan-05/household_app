"use client";

import type { Item } from "@/lib/types";
import { expiryStatus, fmtQty } from "@/lib/format";

type Props = {
  item: Item;
  color: string;
  onClick: (id: string) => void;
};

export default function ItemRow({ item, color, onClick }: Props) {
  const exp = expiryStatus(item.expiry);
  const qty = fmtQty(item.quantity);

  return (
    <button
      type="button"
      className={`item ${exp.cls}`}
      onClick={() => onClick(item.id)}
    >
      <div className="item-main">
        <div className="item-name">{item.name}</div>
        <div className="item-meta">
          <span className="cat-tag" style={{ color }}>
            {item.category}
          </span>
          {exp.label ? (
            <>
              <span className="dot" />
              <span className="expiry">{exp.label}</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="item-qty">
        {qty.num}
        <span>{qty.unit}</span>
      </div>
      <div className="item-chev">›</div>
    </button>
  );
}
