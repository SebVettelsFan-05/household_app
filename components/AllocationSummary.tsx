"use client";

import { allocationLabel } from "@/lib/allocations";
import { fmtMoney } from "@/lib/money";
import type { ExpenseAllocation } from "@/lib/types";

/**
 * Compact "who was this for" line under an expense. Shared by the expenses
 * list and the monthly breakdown so both read the same way.
 */
export default function AllocationSummary({
  allocations,
  memberCount,
}: {
  allocations: readonly ExpenseAllocation[];
  memberCount: number;
}) {
  if (allocations.length === 0) return null;
  const parts = allocations.map((a) => {
    const text = `${allocationLabel(a, memberCount)} ${fmtMoney(a.amountCents)}`;
    return a.kind === "personal" ? `${text} (not shared)` : text;
  });

  // Two lines fit on one row with a single separator; more than that reads
  // better stacked.
  if (parts.length > 2) {
    return (
      <div className="alloc-summary stacked">
        {parts.map((p, i) => (
          <span key={i}>{p}</span>
        ))}
      </div>
    );
  }
  return <div className="alloc-summary">{parts.join(" · ")}</div>;
}
