"use client";

import { useState } from "react";
import { Avatar } from "@/components/fresh/people";
import { fmtMoney } from "@/lib/money";
import type { PersonLine, Settlement } from "@/lib/settlement";

type Props = {
  settlement: Settlement;
  title: string;
  // Month label, e.g. "September 2026".
  subtitle?: string;
  loading?: boolean;
};

function parts(line: PersonLine): { label: string; cents: number }[] {
  return [
    { label: "House", cents: line.house },
    { label: "Meals", cents: line.meals },
    { label: "Bills", cents: line.bills },
    { label: "Rent", cents: line.rent },
  ].filter((p) => p.cents !== 0);
}

/**
 * Per-person send / withdraw against the joint account. Read-only: the
 * numbers are edited on the month view, this is the answer to "what do I
 * owe". Tapping a row opens that person's pool breakdown underneath it.
 */
export default function FreshSettlementCard({
  settlement,
  title,
  subtitle,
  loading = false,
}: Props) {
  const [openName, setOpenName] = useState<string | null>(null);
  const anyMovement = settlement.lines.some((l) => l.share !== l.paid);

  return (
    <section className="fresh-card fresh-settle-card">
      <div className="fresh-card-head">
        <h2 className="fresh-h2">{title}</h2>
        {subtitle ? <span className="fresh-sub">{subtitle}</span> : null}
      </div>

      {loading ? (
        <>
          <div className="fresh-skel fresh-skel-row" />
          <div className="fresh-skel fresh-skel-row" />
          <div className="fresh-skel fresh-skel-row" />
        </>
      ) : !anyMovement ? (
        <div className="fresh-empty">
          <strong>Nothing to settle yet</strong>
          Log a receipt or this month&apos;s bills and the split shows up here.
        </div>
      ) : (
        <>
          <div className="fresh-settle-total">
            <span className="fresh-settle-total-label">Settling</span>
            <span className="fresh-big-money">{fmtMoney(settlement.grand)}</span>
          </div>

          {settlement.lines.map((line) => {
            const delta = line.share - line.paid;
            const open = openName === line.name;
            return (
              <div key={line.name}>
                <button
                  type="button"
                  className="fresh-settle-row"
                  aria-expanded={open}
                  onClick={() => setOpenName(open ? null : line.name)}
                >
                  <Avatar name={line.name} size={28} />
                  <span className="fresh-settle-name">{line.name}</span>
                  <span
                    className={
                      delta > 0
                        ? "fresh-money-amount send"
                        : delta < 0
                          ? "fresh-money-amount withdraw"
                          : "fresh-money-amount even"
                    }
                  >
                    {delta > 0
                      ? `Send ${fmtMoney(delta)}`
                      : delta < 0
                        ? `Withdraw ${fmtMoney(-delta)}`
                        : "Even"}
                  </span>
                </button>
                {open ? (
                  <div className="fresh-settle-parts">
                    <span>Paid {fmtMoney(line.paid)}</span>
                    <span>Share {fmtMoney(line.share)}</span>
                    {parts(line).map((p) => (
                      <span key={p.label}>
                        {p.label} {fmtMoney(p.cents)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
