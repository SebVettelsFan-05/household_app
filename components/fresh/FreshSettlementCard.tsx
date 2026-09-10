"use client";

import { useState } from "react";
import { fmtMoney } from "@/lib/money";
import type { PersonLine, Settlement } from "@/lib/settlement";

type Props = {
  settlement: Settlement;
  title: string;
  // Month label, e.g. "September 2026".
  subtitle?: string;
  loading?: boolean;
  // Optional "go to the tab this belongs to" action.
  linkLabel?: string;
  onLink?: () => void;
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
 * Per-person send / withdraw against the joint account, with the pool
 * breakdown revealed inline. Read-only: the numbers are edited on the
 * month view, this is the answer to "what do I owe".
 */
export default function FreshSettlementCard({
  settlement,
  title,
  subtitle,
  loading = false,
  linkLabel,
  onLink,
}: Props) {
  const [showParts, setShowParts] = useState(false);
  const anyMovement = settlement.lines.some((l) => l.share !== l.paid);

  return (
    <section className="fresh-card">
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
          Log an expense or a month&apos;s bills and the split shows up here.
        </div>
      ) : (
        settlement.lines.map((line) => {
          const delta = line.share - line.paid;
          const tone =
            delta > 0
              ? "fresh-settle-send"
              : delta < 0
                ? "fresh-settle-receive"
                : "fresh-settle-even";
          return (
            <div key={line.name}>
              <div className={`fresh-settle-row ${tone}`}>
                <span className="fresh-settle-name">{line.name}</span>
                <span className="fresh-settle-amount">
                  {delta > 0
                    ? `Send ${fmtMoney(delta)}`
                    : delta < 0
                      ? `Withdraw ${fmtMoney(-delta)}`
                      : "Even"}
                </span>
              </div>
              {showParts ? (
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
        })
      )}

      <div className="fresh-btn-row">
        {anyMovement && !loading ? (
          <button
            type="button"
            className="fresh-block-link"
            onClick={() => setShowParts((v) => !v)}
            aria-expanded={showParts}
          >
            {showParts ? "Hide breakdown" : "Show breakdown"}
          </button>
        ) : null}
        {linkLabel && onLink ? (
          <button type="button" className="fresh-block-link" onClick={onLink}>
            {linkLabel}
          </button>
        ) : null}
      </div>
    </section>
  );
}
