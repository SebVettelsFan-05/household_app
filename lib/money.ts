/**
 * Money formatting helpers. We store amounts as integer cents to avoid the
 * usual floating-point traps in summation, then format here for display.
 */

export function parseCents(input: string): number | null {
  const s = String(input ?? "").trim().replace(/^\$/, "");
  if (!s) return null;
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function fmtMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const c = abs % 100;
  const dollarsStr = dollars.toLocaleString("en-US");
  return `${sign}$${dollarsStr}.${String(c).padStart(2, "0")}`;
}
