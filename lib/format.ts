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

export function expiryStatus(dateStr: string): ExpiryStatus {
  if (!dateStr) return { label: "", cls: "" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff < 0)
    return { label: `Expired ${Math.abs(diff)}d ago`, cls: "expired" };
  if (diff === 0) return { label: "Expires today", cls: "expiring" };
  if (diff === 1) return { label: "Expires tomorrow", cls: "expiring" };
  if (diff <= 3) return { label: `Expires in ${diff}d`, cls: "expiring" };
  return { label: `Expires ${dateStr}`, cls: "" };
}
