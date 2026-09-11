"use client";

import { fmtMoney } from "@/lib/money";

/**
 * Settlement breakdown. Two columns of actionable rows — "Send to joint
 * account" for people whose share exceeds what they paid, "Withdraw from
 * joint account" for people who fronted more than their share. Even rows
 * (paid exactly their share) drop off both lists since they have nothing to
 * do. Each row carries a Paid / Share sub-line so the amount is auditable
 * at a glance.
 *
 * The card intentionally has no Total / Target-share header — the caller
 * already shows the monthly total right above this card, and when shares
 * vary per person (rent allocation) a single headline value is misleading
 * anyway. Per-row Paid / Share sub-lines give the full picture.
 *
 * Sorted by amount descending within each group, so the biggest movers
 * read first.
 */
export type SplitLine = {
  name: string;
  paid: number;
  // The full share for this person across whatever pools are being settled.
  // Pre-computed by the caller so this component is purely presentational.
  share: number;
  // Optional sub-totals of `share`, shown as a second muted line so people
  // can see why their share differs from someone else's.
  house?: number;
  meals?: number;
  bills?: number;
  rent?: number;
};

/** "House $a · Meals $b · Bills $c · Rent $d", zero parts dropped. */
function shareParts(line: SplitLine): string {
  const parts: string[] = [];
  if (line.house) parts.push(`House ${fmtMoney(line.house)}`);
  if (line.meals) parts.push(`Meals ${fmtMoney(line.meals)}`);
  if (line.bills) parts.push(`Bills ${fmtMoney(line.bills)}`);
  if (line.rent) parts.push(`Rent ${fmtMoney(line.rent)}`);
  return parts.join(" · ");
}

type Props = {
  title?: string;
  lines: SplitLine[];
};

export default function SplitCard({ title = "Split", lines }: Props) {
  const senders = lines
    .filter((l) => l.paid - l.share < 0)
    .map((l) => ({ ...l, amount: l.share - l.paid }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  const receivers = lines
    .filter((l) => l.paid - l.share > 0)
    .map((l) => ({ ...l, amount: l.paid - l.share }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  const evens = lines
    .filter((l) => l.paid - l.share === 0)
    .map((l) => l.name);

  return (
    <section className="split-card">
      <h2>{title}</h2>

      {senders.length > 0 ? (
        <div className="split-group split-group-send">
          <h3>Send to joint account</h3>
          <ul>
            {senders.map((s) => (
              <li key={s.name}>
                <div className="split-row-main">
                  <span className="split-name">{s.name}</span>
                  <span className="split-amount">{fmtMoney(s.amount)}</span>
                </div>
                <div className="split-row-sub">
                  Paid {fmtMoney(s.paid)} · Share {fmtMoney(s.share)}
                </div>
                {shareParts(s) ? (
                  <div className="split-row-sub split-row-pools">
                    {shareParts(s)}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {receivers.length > 0 ? (
        <div className="split-group split-group-receive">
          <h3>Withdraw from joint account</h3>
          <ul>
            {receivers.map((r) => (
              <li key={r.name}>
                <div className="split-row-main">
                  <span className="split-name">{r.name}</span>
                  <span className="split-amount">{fmtMoney(r.amount)}</span>
                </div>
                <div className="split-row-sub">
                  Paid {fmtMoney(r.paid)} · Share {fmtMoney(r.share)}
                </div>
                {shareParts(r) ? (
                  <div className="split-row-sub split-row-pools">
                    {shareParts(r)}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {evens.length > 0 ? (
        <p className="split-note">Already even: {evens.join(", ")}</p>
      ) : null}
    </section>
  );
}
