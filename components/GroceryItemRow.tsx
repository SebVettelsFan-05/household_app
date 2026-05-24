"use client";

import { fmtQty } from "@/lib/format";
import type { GroceryItem } from "@/lib/types";

type Props = {
  item: GroceryItem;
  color: string;
  busy: boolean;
  onToggle: (id: string, done: boolean) => void;
  onOpen: (id: string) => void;
};

export default function GroceryItemRow({
  item,
  color,
  busy,
  onToggle,
  onOpen,
}: Props) {
  const qty = fmtQty(item.quantity);
  return (
    <div className={`grocery-row${item.done ? " done" : ""}`}>
      <button
        type="button"
        className={`check${item.done ? " checked" : ""}`}
        onClick={() => onToggle(item.id, !item.done)}
        disabled={busy}
        aria-label={item.done ? "Mark as not done" : "Mark as done"}
      >
        {item.done ? "✓" : ""}
      </button>
      <button
        type="button"
        className="grocery-row-body"
        onClick={() => onOpen(item.id)}
      >
        <div className="grocery-row-main">
          <div className="grocery-name">{item.name}</div>
          <div className="grocery-meta">
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
            <span>For {item.addedBy}</span>
          </div>
        </div>
        <div className="item-qty">
          {qty.num}
          <span>{qty.unit}</span>
        </div>
      </button>
    </div>
  );
}
