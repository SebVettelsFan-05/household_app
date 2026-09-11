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
      // Color the left-edge ribbon to match the item's category. CSS picks
      // this up via var(--item-ribbon-color) and still hands off to the
      // expiring/expired overrides when those classes are present.
      style={{ "--item-ribbon-color": color } as React.CSSProperties}
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
