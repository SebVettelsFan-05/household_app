import type { ExpenseAllocation } from "./types";

/**
 * Monthly settlement math. Pure and cent-exact; the UI only formats.
 *
 * Model (docs/SHARED_KITCHEN.md): every one-time expense is a receipt with
 * allocation lines. Each line is split with largest-remainder rounding over
 * its own participant list, so the cents always add up. Recurring bills are
 * split over all members. Rent is per person. The joint-account workflow
 * is unchanged: someone whose share exceeds what they fronted sends the
 * difference; someone who fronted more withdraws it.
 */

export type SettlementExpense = {
  paidBy: string;
  amountCents: number;
  allocations: readonly ExpenseAllocation[];
};

export type SettlementBill = {
  cents: number;
  // When set, this person fronted the bill and is credited for it in full.
  paidBy?: string;
};

export type SettlementInput = {
  members: readonly string[];
  expenses: readonly SettlementExpense[];
  bills: readonly SettlementBill[];
  rent: Readonly<Record<string, number>>;
};

export type PersonLine = {
  name: string;
  paid: number;
  share: number;
  // Sub-totals of `share`, for the "why is mine different" breakdown.
  house: number;
  meals: number;
  bills: number;
  rent: number;
};

export type Settlement = {
  lines: PersonLine[];
  // Everything the household is settling this month: shared expense lines
  // (personal lines excluded) + bills + rent.
  grand: number;
  sharedExpenses: number;
  billsTotal: number;
  rentTotal: number;
};

/**
 * Split `total` cents across `names` so every part is an integer and the
 * parts sum exactly to `total`. The first `total mod n` names (in the order
 * given) carry the extra cent. Callers pass names in roster order so the
 * same people consistently round up, which keeps month-to-month shares
 * predictable rather than jittering by insertion order.
 */
export function splitCents(total: number, names: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  const n = names.length;
  if (n === 0) return out;
  const base = Math.floor(total / n);
  let extra = total - base * n;
  for (const name of names) {
    out.set(name, base + (extra > 0 ? 1 : 0));
    if (extra > 0) extra -= 1;
  }
  return out;
}

/**
 * The month's roster: current members first, then anyone who appears on a
 * snapshot or as a payer but is no longer a member (someone who moved out
 * still owes, and is still owed, for the months they were here).
 */
export function settlementRoster(input: SettlementInput): string[] {
  const roster = [...input.members];
  const add = (name: string) => {
    if (name && !roster.includes(name)) roster.push(name);
  };
  for (const e of input.expenses) {
    add(e.paidBy);
    for (const a of e.allocations) for (const n of a.splitAmong) add(n);
  }
  for (const b of input.bills) if (b.paidBy) add(b.paidBy);
  return roster;
}

export function computeSettlement(input: SettlementInput): Settlement {
  const members = settlementRoster(input);
  const inRoster = (names: readonly string[]) => members.filter((m) => names.includes(m));

  const paid = new Map<string, number>();
  const house = new Map<string, number>();
  const meals = new Map<string, number>();
  const bills = new Map<string, number>();
  for (const m of members) {
    paid.set(m, 0);
    house.set(m, 0);
    meals.set(m, 0);
    bills.set(m, 0);
  }
  const bump = (map: Map<string, number>, name: string, cents: number) => {
    if (!map.has(name)) return;
    map.set(name, (map.get(name) ?? 0) + cents);
  };

  let sharedExpenses = 0;
  for (const e of input.expenses) {
    for (const a of e.allocations) {
      if (a.kind === "personal") continue;
      const participants = inRoster(a.splitAmong);
      if (participants.length === 0) continue;
      sharedExpenses += a.amountCents;
      bump(paid, e.paidBy, a.amountCents);
      const target = a.kind === "meals" ? meals : house;
      for (const [name, cents] of splitCents(a.amountCents, participants)) {
        bump(target, name, cents);
      }
    }
  }

  // Recurring bills are split over the current household only.
  let billsTotal = 0;
  for (const b of input.bills) {
    if (b.cents <= 0) continue;
    billsTotal += b.cents;
    if (b.paidBy) bump(paid, b.paidBy, b.cents);
    for (const [name, cents] of splitCents(b.cents, input.members)) bump(bills, name, cents);
  }

  let rentTotal = 0;
  for (const m of members) rentTotal += input.rent[m] ?? 0;

  const lines: PersonLine[] = members.map((name) => {
    const h = house.get(name) ?? 0;
    const ml = meals.get(name) ?? 0;
    const b = bills.get(name) ?? 0;
    const r = input.rent[name] ?? 0;
    return {
      name,
      paid: paid.get(name) ?? 0,
      share: h + ml + b + r,
      house: h,
      meals: ml,
      bills: b,
      rent: r,
    };
  });

  return {
    lines,
    grand: sharedExpenses + billsTotal + rentTotal,
    sharedExpenses,
    billsTotal,
    rentTotal,
  };
}
