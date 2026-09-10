import {
  ALLOCATION_KINDS,
  BUYERS,
  type AllocationKind,
  type ExpenseAllocation,
} from "./types";

/**
 * Validation and normalisation of expense allocations. Pure; used by the
 * API/repo on write and by the forms on the client so both sides agree.
 * See docs/SHARED_KITCHEN.md for the invariants.
 */

export type RawAllocation = {
  kind?: unknown;
  amountCents?: unknown;
  splitAmong?: unknown;
};

export type ResolveContext = {
  // Members the household currently has. `house` lines resolve to this.
  members: readonly string[];
  // Current meal group. `meals` lines with no explicit list resolve to this.
  mealGroup: readonly string[];
  // Names that are not members any more but appear on the row being edited.
  // A saved snapshot must round-trip through an edit untouched, so these
  // are accepted alongside the roster. Never set on a fresh add.
  allowed?: readonly string[];
};

function dedupeMembers(
  names: readonly string[],
  members: readonly string[],
  allowed: readonly string[] = []
): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const name = String(raw ?? "").trim();
    if (!name || out.includes(name)) continue;
    if (!members.includes(name) && !allowed.includes(name)) {
      throw new Error(`Unknown household member: ${name}`);
    }
    out.push(name);
  }
  // Stable order (household roster order, then departed names) so snapshots
  // compare equal regardless of the order the client sent them in.
  return [
    ...members.filter((m) => out.includes(m)),
    ...out.filter((n) => !members.includes(n)),
  ];
}

function isKind(x: unknown): x is AllocationKind {
  return typeof x === "string" && (ALLOCATION_KINDS as readonly string[]).includes(x);
}

/**
 * Turn client input into a valid, normalised allocation list for an expense
 * of `totalCents`. Throws with a user-facing message on any violation.
 */
export function normalizeAllocations(
  raw: unknown,
  totalCents: number,
  ctx: ResolveContext
): ExpenseAllocation[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("At least one allocation is required");
  }
  const out: ExpenseAllocation[] = [];
  for (const item of raw as RawAllocation[]) {
    if (!item || typeof item !== "object") {
      throw new Error("Allocation must be an object");
    }
    if (!isKind(item.kind)) {
      throw new Error(`Allocation kind must be one of ${ALLOCATION_KINDS.join(", ")}`);
    }
    const cents = Math.round(Number(item.amountCents));
    if (!Number.isFinite(cents) || cents <= 0) {
      throw new Error("Each allocation must be greater than $0");
    }
    const provided = Array.isArray(item.splitAmong)
      ? (item.splitAmong as unknown[]).map((s) => String(s ?? ""))
      : [];
    let splitAmong: string[];
    if (item.kind === "personal") {
      splitAmong = [];
    } else if (provided.length > 0) {
      splitAmong = dedupeMembers(provided, ctx.members, ctx.allowed);
    } else if (item.kind === "house") {
      splitAmong = [...ctx.members];
    } else if (item.kind === "meals") {
      // An empty meal group means "everyone" throughout the app.
      splitAmong = dedupeMembers(ctx.mealGroup, ctx.members);
      if (splitAmong.length === 0) splitAmong = [...ctx.members];
    } else {
      throw new Error("Custom allocation needs at least one person");
    }
    if (item.kind !== "personal" && splitAmong.length === 0) {
      throw new Error("Allocation needs at least one person");
    }
    out.push({ kind: item.kind, amountCents: cents, splitAmong });
  }
  const sum = out.reduce((s, a) => s + a.amountCents, 0);
  if (sum !== Math.round(totalCents)) {
    throw new Error(
      `Allocations add up to ${(sum / 100).toFixed(2)} but the receipt total is ${(totalCents / 100).toFixed(2)}`
    );
  }
  return out;
}

/** What a legacy row (no allocations stored) means: everyone, whole amount. */
export function legacyAllocations(
  amountCents: number,
  members: readonly string[] = BUYERS
): ExpenseAllocation[] {
  return [{ kind: "house", amountCents, splitAmong: [...members] }];
}

/** Read allocations back from storage, tolerating junk. */
export function allocationsFromStored(
  raw: unknown,
  amountCents: number
): ExpenseAllocation[] {
  if (!Array.isArray(raw) || raw.length === 0) return legacyAllocations(amountCents);
  const out: ExpenseAllocation[] = [];
  for (const item of raw as RawAllocation[]) {
    if (!item || typeof item !== "object" || !isKind(item.kind)) continue;
    const cents = Math.round(Number(item.amountCents));
    if (!Number.isFinite(cents) || cents <= 0) continue;
    // Snapshots are history: a name that has since left the roster stays
    // on the line so the money it represents never silently disappears.
    // (`computeSettlement` adds such names to the month's roster.)
    const splitAmong =
      item.kind === "personal"
        ? []
        : Array.isArray(item.splitAmong)
          ? Array.from(
              new Set(
                (item.splitAmong as unknown[])
                  .map((s) => String(s ?? "").trim())
                  .filter(Boolean)
              )
            )
          : [];
    if (item.kind !== "personal" && splitAmong.length === 0) {
      return legacyAllocations(amountCents);
    }
    out.push({ kind: item.kind, amountCents: cents, splitAmong });
  }
  const sum = out.reduce((s, a) => s + a.amountCents, 0);
  if (out.length === 0 || sum !== amountCents) return legacyAllocations(amountCents);
  return out;
}

/** Cents the payer actually fronted for the household (personal lines excluded). */
export function sharedCents(allocations: readonly ExpenseAllocation[]): number {
  return allocations
    .filter((a) => a.kind !== "personal")
    .reduce((s, a) => s + a.amountCents, 0);
}

/** Short human label, e.g. "Meals (3)", "Everyone", "Arthur, Eli". */
export function allocationLabel(a: ExpenseAllocation, memberCount: number): string {
  switch (a.kind) {
    case "house":
      return a.splitAmong.length === memberCount ? "Everyone" : `House (${a.splitAmong.length})`;
    case "meals":
      return `Meals (${a.splitAmong.length})`;
    case "personal":
      return "Personal";
    case "custom":
      return a.splitAmong.join(", ");
  }
}
