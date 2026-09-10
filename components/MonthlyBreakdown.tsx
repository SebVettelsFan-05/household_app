"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AllocationSummary from "@/components/AllocationSummary";
import ReceiptLightbox from "@/components/ReceiptLightbox";
import SplitCard from "@/components/SplitCard";
import { getSetting, putSetting } from "@/lib/client";
import {
  currentExpenseMonth,
  FIRST_EXPENSE_MONTH,
} from "@/lib/expenseMonths";
import { driveImageUrl } from "@/lib/imageResize";
import {
  activeForMonth,
  amountForMonth,
  BE_FIXED,
  BE_RENT,
  BE_VARIABLE,
  clearBillOverride,
  clearRentOverride,
  emptyVariable,
  hasOverride,
  hasRentOverride,
  isFixedTrivial,
  isRentTrivial,
  isVariableTrivial,
  loadFixed,
  loadRent,
  loadVariable,
  LS_FIXED_V3,
  LS_RENT_V1,
  LS_VARIABLE_V3,
  makeRecurringId,
  mergeProtected,
  normalizeVariableState,
  parseFixedEntry,
  parseVariableState,
  rentForMonth,
  setBillAmount,
  setRentAlloc,
  settlementBills,
  sortFixed,
  ymLabel,
  shiftMonth,
  fmtTripDate,
  type FixedRecurring,
  type RentAlloc,
  type RentState,
  type VariableKey,
  type VariableMap,
  type VariableState,
} from "@/lib/monthlyBills";
import { fmtMoney, parseCents } from "@/lib/money";
import { titleCaseName } from "@/lib/normalize";
import { computeSettlement } from "@/lib/settlement";
import { BUYERS, type Expense, type ExpenseAllocation } from "@/lib/types";

/**
 * Monthly breakdown — three editable sections (one-time, recurring fixed,
 * recurring variable) plus a per-person Rent block and a settlement section
 * at the bottom that folds everything into a Send / Withdraw breakdown.
 *
 * Rent is its own thing because each house member owes a different amount
 * (e.g. Arthur $800, Daniel $800, Eli $700, …). We store per-person
 * allocations with the same forward-write schedule + per-month overrides
 * pattern used for the other bills, just keyed by name instead of carrying
 * a single cents value.
 *
 * Internet is folded into the 5-way share pool but recorded as fully paid
 * by Arthur — that's the household convention, so the settlement math
 * gives Arthur credit for the whole amount.
 */

/* ---------- Free-form amount input ---------- */

function AmountInput({
  cents,
  onCommit,
  placeholder = "0.00",
  ariaLabel,
  disabled = false,
}: {
  cents: number | undefined;
  onCommit: (cents: number | null) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const formatted = cents !== undefined ? (cents / 100).toFixed(2) : "";
  const [draft, setDraft] = useState<string>(formatted);

  useEffect(() => {
    setDraft(formatted);
  }, [formatted]);

  function commit() {
    if (disabled) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      onCommit(null);
      setDraft("");
      return;
    }
    const c = parseCents(trimmed);
    if (c === null) {
      setDraft(formatted);
      return;
    }
    onCommit(c);
    setDraft((c / 100).toFixed(2));
  }

  return (
    <input
      className="monthly-input-amount"
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/* ---------- Component ---------- */

type Props = {
  expenses: Expense[];
  onToast: (msg: string) => void;
};

export default function MonthlyBreakdown({ expenses, onToast }: Props) {
  const [month, setMonth] = useState<string>(() => currentExpenseMonth());
  const currentMonth = currentExpenseMonth();
  const isCurrentMonth = month === currentMonth;
  const monthLocked = month < currentMonth;
  const canEditMonth = !monthLocked;
  const canGoPrev = month > FIRST_EXPENSE_MONTH;

  const [fixed, setFixed] = useState<FixedRecurring[]>([]);
  const [variable, setVariable] = useState<VariableState>(() => emptyVariable());
  const [rent, setRent] = useState<RentState>({ schedule: [], overrides: {} });
  const [newFixedName, setNewFixedName] = useState("");
  const [newFixedAmount, setNewFixedAmount] = useState("");
  const [newVariableName, setNewVariableName] = useState("");
  const [newVariableAmount, setNewVariableAmount] = useState("");
  const [receiptPreview, setReceiptPreview] = useState<{
    src: string;
    href: string;
  } | null>(null);
  // Suppress backend pushes triggered by the mount-time hydration. Without
  // this, hydrating from the backend would echo the same value back as a PUT.
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    // 1. Fast first paint from localStorage so the user sees their last
    //    known numbers instantly while the backend round-trip runs.
    const lsFixed = sortFixed(loadFixed());
    const lsVariable = loadVariable();
    const lsRent = loadRent();
    setFixed(lsFixed);
    setVariable(lsVariable);
    setRent(lsRent);
    try {
      window.localStorage.setItem(LS_FIXED_V3, JSON.stringify(lsFixed));
      window.localStorage.setItem(LS_VARIABLE_V3, JSON.stringify(lsVariable));
    } catch {
      /* ignore */
    }

    // 2. Hydrate from backend (the shared source of truth). When the
    //    backend has real data, adopt it. When backend is empty/missing
    //    but localStorage has data, push localStorage up as a one-time
    //    migration so a fresh device sees the same numbers next load.
    //    "Trivial" = no user data beyond the protected mainstay scaffold
    //    — used both ways so an empty backend row doesn't clobber an
    //    existing device's saved bills.
    Promise.all([
      getSetting<FixedRecurring[]>(BE_FIXED).catch(() => null),
      getSetting<unknown>(BE_VARIABLE).catch(() => null),
      getSetting<RentState>(BE_RENT).catch(() => null),
    ]).then(([beFixed, beVariable, beRent]) => {
      if (cancelled) return;

      if (Array.isArray(beFixed)) {
        const parsed = beFixed
          .map(parseFixedEntry)
          .filter((x): x is FixedRecurring => x !== null);
        if (!isFixedTrivial(parsed)) {
          const merged = sortFixed(mergeProtected(parsed));
          setFixed(merged);
          try {
            window.localStorage.setItem(LS_FIXED_V3, JSON.stringify(merged));
          } catch {
            /* ignore */
          }
        } else if (!isFixedTrivial(lsFixed)) {
          putSetting(BE_FIXED, lsFixed).catch((err) => {
            console.warn("[settings] migrate recurring_fixed failed", err);
          });
        }
      } else if (!isFixedTrivial(lsFixed)) {
        putSetting(BE_FIXED, lsFixed).catch((err) => {
          console.warn("[settings] migrate recurring_fixed failed", err);
        });
      }

      if (beVariable && typeof beVariable === "object") {
        const v = parseVariableState(beVariable);
        if (!isVariableTrivial(v)) {
          setVariable(v);
          try {
            window.localStorage.setItem(LS_VARIABLE_V3, JSON.stringify(v));
          } catch {
            /* ignore */
          }
        } else if (!isVariableTrivial(lsVariable)) {
          putSetting(BE_VARIABLE, lsVariable).catch((err) => {
            console.warn("[settings] migrate recurring_variable failed", err);
          });
        }
      } else if (!isVariableTrivial(lsVariable)) {
        putSetting(BE_VARIABLE, lsVariable).catch((err) => {
          console.warn("[settings] migrate recurring_variable failed", err);
        });
      }

      if (beRent && typeof beRent === "object") {
        const r = beRent as RentState;
        if (!isRentTrivial(r)) {
          setRent(r);
          try {
            window.localStorage.setItem(LS_RENT_V1, JSON.stringify(r));
          } catch {
            /* ignore */
          }
        } else if (!isRentTrivial(lsRent)) {
          putSetting(BE_RENT, lsRent).catch((err) => {
            console.warn("[settings] migrate rent_alloc failed", err);
          });
        }
      } else if (!isRentTrivial(lsRent)) {
        putSetting(BE_RENT, lsRent).catch((err) => {
          console.warn("[settings] migrate rent_alloc failed", err);
        });
      }

      hydratedRef.current = true;
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pushBackend(key: string, value: unknown, label: string) {
    if (!hydratedRef.current) return; // mount-time setState, not a real edit
    putSetting(key, value).catch((err) => {
      console.warn(`[settings] push ${key} failed`, err);
      onToast(`Couldn't sync ${label}, saved locally only`);
    });
  }

  function persistFixed(next: FixedRecurring[]) {
    const sorted = sortFixed(next);
    setFixed(sorted);
    try {
      window.localStorage.setItem(LS_FIXED_V3, JSON.stringify(sorted));
    } catch {
      onToast("Couldn't save recurring bills");
    }
    pushBackend(BE_FIXED, sorted, "recurring bills");
  }

  function persistVariable(next: VariableState) {
    const normalized = normalizeVariableState(next);
    setVariable(normalized);
    try {
      window.localStorage.setItem(LS_VARIABLE_V3, JSON.stringify(normalized));
    } catch {
      onToast("Couldn't save utility amounts");
    }
    pushBackend(BE_VARIABLE, normalized, "utility amounts");
  }

  function persistRent(next: RentState) {
    setRent(next);
    try {
      window.localStorage.setItem(LS_RENT_V1, JSON.stringify(next));
    } catch {
      onToast("Couldn't save rent allocations");
    }
    pushBackend(BE_RENT, next, "rent allocations");
  }

  /* ---- One-time: group by store, list each trip underneath ---- */

  const oneTime = useMemo(() => {
    const inMonth = expenses.filter((e) => {
      const when = e.occurredOn || e.added || "";
      return when.startsWith(month);
    });
    type Trip = {
      id: string;
      occurredOn: string;
      description: string;
      amount: number;
      allocations: ExpenseAllocation[];
      receiptUrl: string;
      receiptFileId: string;
      receiptMime: string;
    };
    type StoreGroup = {
      store: string;
      total: number;
      trips: Trip[];
    };
    const buckets = new Map<string, StoreGroup>();
    let total = 0;
    for (const e of inMonth) {
      const rawStore = (e.store || "").trim();
      const store = rawStore ? titleCaseName(rawStore) : "Unspecified";
      const key = store.toLowerCase();
      const trip: Trip = {
        id: e.id,
        occurredOn: e.occurredOn || e.added || "",
        description: (e.description || "").trim(),
        amount: e.amountCents,
        allocations: e.allocations ?? [],
        receiptUrl: e.receiptUrl || "",
        receiptFileId: e.receiptFileId || "",
        receiptMime: e.receiptMime || "",
      };
      const existing = buckets.get(key);
      if (existing) {
        existing.total += e.amountCents;
        existing.trips.push(trip);
      } else {
        buckets.set(key, {
          store,
          total: e.amountCents,
          trips: [trip],
        });
      }
      total += e.amountCents;
    }
    for (const g of buckets.values()) {
      // Most recent trip first — date desc, then larger amount as tiebreaker.
      g.trips.sort((a, b) => {
        if (a.occurredOn !== b.occurredOn) {
          return a.occurredOn < b.occurredOn ? 1 : -1;
        }
        return b.amount - a.amount;
      });
    }
    const rows = Array.from(buckets.values()).sort((a, b) => b.total - a.total);
    return { rows, total, count: inMonth.length, inMonth };
  }, [expenses, month]);

  /* ---- Rent: resolved per displayed month ---- */

  const monthRent = useMemo(() => rentForMonth(rent, month), [rent, month]);
  const rentTotal = useMemo(
    () => BUYERS.reduce((s, name) => s + (monthRent[name] ?? 0), 0),
    [monthRent]
  );
  const rentOverridden = hasRentOverride(rent, month);

  function commitRentForPerson(name: string, cents: number | null) {
    if (monthLocked) return;
    const nextAlloc: RentAlloc = { ...monthRent };
    if (cents === null || cents <= 0) {
      delete nextAlloc[name];
    } else {
      nextAlloc[name] = cents;
    }
    persistRent(setRentAlloc(rent, month, currentMonth, nextAlloc));
  }

  function clearRent() {
    if (monthLocked) return;
    if (rentOverridden) {
      persistRent(clearRentOverride(rent, month));
    }
  }

  /* ---- Fixed recurring: resolved per displayed month ---- */

  const fixedForMonth = useMemo(
    () => fixed.filter((r) => activeForMonth(r, month)),
    [fixed, month]
  );
  const fixedTotal = useMemo(
    () => fixedForMonth.reduce((s, r) => s + amountForMonth(r, month), 0),
    [fixedForMonth, month]
  );

  function commitAmount(id: string, cents: number | null) {
    if (monthLocked) return;
    persistFixed(
      fixed.map((r) =>
        r.id === id ? setBillAmount(r, month, currentMonth, cents ?? 0) : r
      )
    );
  }

  function clearOverride(id: string) {
    if (monthLocked) return;
    persistFixed(
      fixed.map((r) => (r.id === id ? clearBillOverride(r, month) : r))
    );
  }

  function addFixedRecurring() {
    if (!canEditMonth) return;
    const name = titleCaseName(newFixedName);
    const cents = parseCents(newFixedAmount);
    if (!name) {
      onToast("Name required");
      return;
    }
    if (cents === null || cents <= 0) {
      onToast("Amount must be greater than $0");
      return;
    }
    const duplicate = fixedForMonth.some(
      (r) => r.name.toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      onToast(`${name} is already active this month`);
      return;
    }
    persistFixed([
      ...fixed,
      {
        id: makeRecurringId("fixed", name),
        name,
        activeFrom: month,
        schedule: [{ from: month, cents }],
        overrides: {},
      },
    ]);
    setNewFixedName("");
    setNewFixedAmount("");
  }

  function removeFixedRecurring(id: string) {
    if (!canEditMonth) return;
    const row = fixed.find((r) => r.id === id);
    if (!row || row.protected) return;
    if ((row.activeFrom || FIRST_EXPENSE_MONTH) >= month) {
      persistFixed(fixed.filter((r) => r.id !== id));
      return;
    }
    persistFixed(
      fixed.map((r) => (r.id === id ? { ...r, inactiveFrom: month } : r))
    );
  }

  /* ---- Variable recurring ---- */

  const monthVariable = variable.amounts[month] ?? {};
  const variableLines = useMemo(
    () => variable.lines.filter((line) => activeForMonth(line, month)),
    [variable.lines, month]
  );
  const variableTotal = variableLines.reduce(
    (s, line) => s + (monthVariable[line.name] ?? 0),
    0
  );

  function setVariableAmount(key: VariableKey, cents: number | null) {
    if (monthLocked) return;
    const nextAmounts: VariableMap = { ...variable.amounts };
    const bucket = { ...(nextAmounts[month] ?? {}) };
    if (cents === null) {
      delete bucket[key];
    } else {
      bucket[key] = cents;
    }
    if (Object.keys(bucket).length === 0) delete nextAmounts[month];
    else nextAmounts[month] = bucket;
    persistVariable({ ...variable, amounts: nextAmounts });
  }

  function addVariableRecurring() {
    if (!canEditMonth) return;
    const name = titleCaseName(newVariableName);
    if (!name) {
      onToast("Name required");
      return;
    }
    const duplicate = variableLines.some(
      (line) => line.name.toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      onToast(`${name} is already active this month`);
      return;
    }
    let nextAmounts = variable.amounts;
    const trimmedAmount = newVariableAmount.trim();
    if (trimmedAmount) {
      const cents = parseCents(trimmedAmount);
      if (cents === null || cents <= 0) {
        onToast("Amount must be greater than $0");
        return;
      }
      nextAmounts = {
        ...variable.amounts,
        [month]: {
          ...(variable.amounts[month] ?? {}),
          [name]: cents,
        },
      };
    }
    persistVariable({
      lines: [
        ...variable.lines,
        {
          id: makeRecurringId("variable", name),
          name,
          activeFrom: month,
        },
      ],
      amounts: nextAmounts,
    });
    setNewVariableName("");
    setNewVariableAmount("");
  }

  function removeVariableRecurring(id: string) {
    if (!canEditMonth) return;
    const line = variable.lines.find((r) => r.id === id);
    if (!line || line.protected) return;
    if ((line.activeFrom || FIRST_EXPENSE_MONTH) >= month) {
      persistVariable({
        ...variable,
        lines: variable.lines.filter((r) => r.id !== id),
      });
      return;
    }
    persistVariable({
      ...variable,
      lines: variable.lines.map((r) =>
        r.id === id ? { ...r, inactiveFrom: month } : r
      ),
    });
  }

  /* ---- Settlement math ---- */

  const settlement = useMemo(
    () =>
      computeSettlement({
        members: BUYERS,
        expenses: oneTime.inMonth.map((e) => ({
          paidBy: e.paidBy,
          amountCents: e.amountCents,
          allocations: e.allocations ?? [],
        })),
        bills: settlementBills(fixed, variable, month),
        rent: monthRent,
      }),
    [oneTime, fixed, variable, month, monthRent]
  );

  const grandTotal = settlement.grand;

  return (
    <section className="monthly-card">
      <div className="monthly-head">
        <button
          type="button"
          className="monthly-nav"
          onClick={() => {
            if (canGoPrev) setMonth(shiftMonth(month, -1));
          }}
          disabled={!canGoPrev}
          aria-label="Previous month"
        >
          ‹
        </button>
        <div className="monthly-label">{ymLabel(month)}</div>
        <button
          type="button"
          className="monthly-nav"
          onClick={() => setMonth(shiftMonth(month, +1))}
          aria-label="Next month"
        >
          ›
        </button>
      </div>
      <div className="monthly-section">
        <div className="monthly-section-head">
          <h3>One-time (by store)</h3>
          <span className="monthly-sub">
            {oneTime.count} expense{oneTime.count === 1 ? "" : "s"} ·{" "}
            <strong>{fmtMoney(oneTime.total)}</strong>
          </span>
        </div>
        {oneTime.rows.length === 0 ? (
          <p className="monthly-empty">No logged expenses this month yet.</p>
        ) : (
          <div className="monthly-list">
            {oneTime.rows.map((r) => (
              <details className="monthly-store-row" key={r.store}>
                <summary className="monthly-store-summary">
                  <span className="monthly-row-name">
                    {r.store}
                    <span className="monthly-row-desc">
                      {" "}
                      · {r.trips.length} trip{r.trips.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="monthly-row-amount">
                    {fmtMoney(r.total)}
                  </span>
                </summary>
                <div className="monthly-store-trips">
                  {r.trips.map((t) => {
                    const date = fmtTripDate(t.occurredOn);
                    const canPreviewReceipt = Boolean(
                      t.receiptUrl &&
                        t.receiptFileId &&
                        t.receiptMime &&
                        t.receiptMime.startsWith("image/")
                    );
                    return (
                      <div className="monthly-trip-row" key={t.id}>
                        <span className="monthly-trip-label">
                          {date ? (
                            <span className="monthly-trip-date">{date}</span>
                          ) : null}
                          {t.description ? (
                            <span className="monthly-trip-desc">
                              {date ? " · " : ""}
                              {t.description}
                            </span>
                          ) : null}
                          {!date && !t.description ? (
                            <span className="monthly-trip-desc">Untitled</span>
                          ) : null}
                          {t.receiptUrl ? (
                            <a
                              href={t.receiptUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="receipt-pill"
                              title={
                                canPreviewReceipt
                                  ? "Preview receipt"
                                  : "Open receipt"
                              }
                              style={{ marginLeft: 6 }}
                              onClick={(e) => {
                                if (!canPreviewReceipt) return;
                                e.preventDefault();
                                setReceiptPreview({
                                  src: driveImageUrl(t.receiptFileId, 1600),
                                  href: t.receiptUrl,
                                });
                              }}
                            >
                              📎
                            </a>
                          ) : null}
                        </span>
                        <span className="monthly-trip-amount">
                          {fmtMoney(t.amount)}
                        </span>
                        <AllocationSummary
                          allocations={t.allocations}
                          memberCount={BUYERS.length}
                        />
                      </div>
                    );
                  })}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>

      <div className="monthly-section">
        <div className="monthly-section-head">
          <h3>
            Rent (per person)
            {rentOverridden ? (
              <span
                className="monthly-row-desc"
                title="A custom allocation is set just for this month"
              >
                {" "}(override)
              </span>
            ) : null}
          </h3>
          <span className="monthly-sub">
            <strong>{fmtMoney(rentTotal)}</strong> this month
          </span>
        </div>
        <div className="monthly-list">
          {BUYERS.map((name) => (
            <div
              className={`monthly-row is-protected${monthLocked ? " is-locked" : ""}`}
              key={name}
            >
              <span className="monthly-row-name">{name}</span>
              <AmountInput
                cents={monthRent[name] || undefined}
                onCommit={(cents) => commitRentForPerson(name, cents)}
                ariaLabel={`${name}'s rent share`}
                disabled={monthLocked}
              />
            </div>
          ))}
          {rentOverridden && !isCurrentMonth && !monthLocked ? (
            <button
              type="button"
              className="cat-mgr-link"
              onClick={clearRent}
              style={{ alignSelf: "flex-start" }}
              title="Drop this month's override and fall back to the default split"
            >
              ↺ Reset this month
            </button>
          ) : null}
        </div>
      </div>

      <div className="monthly-section">
        <div className="monthly-section-head">
          <h3>Recurring (fixed)</h3>
          <span className="monthly-sub">
            <strong>{fmtMoney(fixedTotal)}</strong> this month
          </span>
        </div>
        <div className="monthly-list">
          {fixedForMonth.map((r) => {
            const monthCents = amountForMonth(r, month);
            const overridden = hasOverride(r, month);
            return (
              <div
                className={`monthly-row${r.protected ? " is-protected" : ""}${monthLocked ? " is-locked" : ""}`}
                key={r.id}
              >
                <span className="monthly-row-name">
                  {r.name}
                  {overridden ? (
                    <span
                      className="monthly-row-desc"
                      title="A custom amount is set just for this month"
                    >
                      {" "}(override)
                    </span>
                  ) : null}
                </span>
                {overridden && !isCurrentMonth && !monthLocked ? (
                  <button
                    type="button"
                    className="monthly-remove"
                    onClick={() => clearOverride(r.id)}
                    title="Clear this month's override and fall back to the default"
                    aria-label={`Clear ${r.name} override for this month`}
                  >
                    ↺
                  </button>
                ) : null}
                {!r.protected && !monthLocked ? (
                  <button
                    type="button"
                    className="monthly-remove"
                    onClick={() => removeFixedRecurring(r.id)}
                    title={`Stop ${r.name} from ${ymLabel(month)} forward`}
                    aria-label={`Stop ${r.name} from this month forward`}
                  >
                    x
                  </button>
                ) : null}
                <AmountInput
                  cents={monthCents || undefined}
                  onCommit={(cents) => commitAmount(r.id, cents)}
                  ariaLabel={`${r.name} amount`}
                  disabled={monthLocked}
                />
              </div>
            );
          })}
          {canEditMonth ? (
            <div className="monthly-add">
              <input
                type="text"
                placeholder="New fixed bill"
                value={newFixedName}
                onChange={(e) => setNewFixedName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addFixedRecurring();
                }}
              />
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={newFixedAmount}
                onChange={(e) => setNewFixedAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addFixedRecurring();
                }}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={addFixedRecurring}
              >
                Add
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="monthly-section">
        <div className="monthly-section-head">
          <h3>Recurring (variable)</h3>
          <span className="monthly-sub">
            <strong>{fmtMoney(variableTotal)}</strong> this month
          </span>
        </div>
        <div className="monthly-list">
          {variableLines.map((line) => {
            const cents = monthVariable[line.name];
            return (
              <div
                className={`monthly-row${line.protected ? " is-protected" : ""}${monthLocked ? " is-locked" : ""}`}
                key={line.id}
              >
                <span className="monthly-row-name">{line.name}</span>
                {!line.protected && !monthLocked ? (
                  <button
                    type="button"
                    className="monthly-remove"
                    onClick={() => removeVariableRecurring(line.id)}
                    title={`Stop ${line.name} from ${ymLabel(month)} forward`}
                    aria-label={`Stop ${line.name} from this month forward`}
                  >
                    x
                  </button>
                ) : null}
                <AmountInput
                  cents={cents}
                  onCommit={(c) => setVariableAmount(line.name, c)}
                  ariaLabel={`${line.name} amount`}
                  disabled={monthLocked}
                />
              </div>
            );
          })}
          {canEditMonth ? (
            <div className="monthly-add">
              <input
                type="text"
                placeholder="New variable bill"
                value={newVariableName}
                onChange={(e) => setNewVariableName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addVariableRecurring();
                }}
              />
              <input
                type="text"
                inputMode="decimal"
                placeholder="optional"
                value={newVariableAmount}
                onChange={(e) => setNewVariableAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addVariableRecurring();
                }}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={addVariableRecurring}
              >
                Add
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="monthly-total">
        <span>Total for {ymLabel(month)}</span>
        <strong>{fmtMoney(grandTotal)}</strong>
      </div>
      <p className="monthly-total-note">
        Personal items on receipts are excluded
      </p>

      {grandTotal > 0 ? (
        <SplitCard
          title={`Settlement for ${ymLabel(month)}`}
          lines={settlement.lines}
        />
      ) : null}

      {receiptPreview ? (
        <ReceiptLightbox
          src={receiptPreview.src}
          alt="Receipt"
          originalHref={receiptPreview.href}
          onClose={() => setReceiptPreview(null)}
        />
      ) : null}
    </section>
  );
}
