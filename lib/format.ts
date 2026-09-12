import { todayYmd } from "./dates";

export function fmtQty(n: number): { num: string; unit: "kg" | "g" } {
  if (n >= 1000) {
    const kg = n / 1000;
    return { num: kg.toFixed(n % 1000 === 0 ? 0 : 1), unit: "kg" };
  }
  return { num: String(n), unit: "g" };
}

export type ExpiryStatus = {
  label: string;
  cls: "" | "expiring" | "expired";
};

/** Midnight UTC for a YYYY-MM-DD, or null when the string isn't one. */
function ymdUtcMs(dateStr: string): number | null {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return null;
  }
  const ms = Date.UTC(y, m - 1, d);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Whole days from today to `dateStr`, or null when it isn't a date.
 *
 * Both ends are calendar dates in the household timezone — the browser's own
 * clock decides nothing. A phone still set to Vancouver would otherwise call
 * a Toronto midnight-to-3am expiry "tomorrow" while the fridge says today.
 */
export function daysUntil(dateStr: string, now: Date = new Date()): number | null {
  if (!dateStr) return null;
  const target = ymdUtcMs(dateStr);
  const today = ymdUtcMs(todayYmd(now));
  if (target === null || today === null) return null;
  return Math.round((target - today) / 86400000);
}

export function expiryStatus(
  dateStr: string,
  now: Date = new Date()
): ExpiryStatus {
  if (!dateStr) return { label: "", cls: "" };
  const diff = daysUntil(dateStr, now);
  if (diff === null) return { label: `Expires ${dateStr}`, cls: "" };
  if (diff < 0)
    return { label: `Expired ${Math.abs(diff)}d ago`, cls: "expired" };
  if (diff === 0) return { label: "Expires today", cls: "expiring" };
  if (diff === 1) return { label: "Expires tomorrow", cls: "expiring" };
  if (diff <= 3) return { label: `Expires in ${diff}d`, cls: "expiring" };
  return { label: `Expires ${dateStr}`, cls: "" };
}
