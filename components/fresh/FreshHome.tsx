"use client";

import { useMemo } from "react";
import { useHouseholdToday } from "@/lib/useHouseholdToday";
import type { FreshTab, RecipeSlot } from "@/components/fresh/FreshApp";
import { Avatar } from "@/components/fresh/people";
import { IconChevronRight } from "@/components/fresh/icons";
import { DAY_LONG, shortDayLabel, thisWeekStart, todayCookingDay } from "@/lib/dates";
import { expiryStatus } from "@/lib/format";
import { fmtMoney } from "@/lib/money";
import type { Item } from "@/lib/types";
import { useMonthlySettlement } from "@/lib/useMonthlySettlement";
import type { HouseholdData } from "@/lib/useHouseholdData";

type Props = {
  data: HouseholdData;
  mealGroup: string[];
  onNavigate: (tab: FreshTab) => void;
  onOpenMonth: () => void;
  onPlanDinner: (slot: RecipeSlot) => void;
};

const EXPIRING_WINDOW_DAYS = 3;

/** Days until `expiry`, or null when the item carries no date. */
function daysUntil(expiry: string): number | null {
  if (!expiry) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(expiry + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export default function FreshHome({
  data,
  mealGroup,
  onNavigate,
  onOpenMonth,
  onPlanDinner,
}: Props) {
  const { settlement, loadingBills } = useMonthlySettlement(data.expenses);

  const today = useHouseholdToday();
  const weekStart = thisWeekStart(today);
  const dayIndex = todayCookingDay(weekStart, today);
  const tonight = useMemo(
    () =>
      dayIndex < 0
        ? null
        : (data.recipes.find(
            (r) => r.weekStart === weekStart && r.day === dayIndex
          ) ?? null),
    [data.recipes, weekStart, dayIndex]
  );

  const toBuy = useMemo(
    () => data.grocery.filter((g) => !g.done),
    [data.grocery]
  );

  const expiring = useMemo(() => {
    const rows: { item: Item; days: number }[] = [];
    for (const item of data.items) {
      const days = daysUntil(item.expiry);
      if (days === null || days > EXPIRING_WINDOW_DAYS) continue;
      rows.push({ item, days });
    }
    return rows.sort(
      (a, b) => a.days - b.days || a.item.name.localeCompare(b.item.name)
    );
  }, [data.items]);

  const monthName = new Date().toLocaleString("en-US", { month: "long" });
  // "Sun, May 24" -> "May 24"; the long day name is written out separately.
  const dateLine =
    dayIndex >= 0 ? (shortDayLabel(weekStart, dayIndex).split(", ")[1] ?? "") : "";
  const anyMovement = settlement.lines.some((l) => l.share !== l.paid);

  return (
    <div className="fresh-home">
      {/* ---- Tonight ---- */}
      <section className="fresh-tonight">
        <button
          type="button"
          className="fresh-tonight-tap"
          onClick={() => onNavigate("recipes")}
        >
          <span className="fresh-tonight-when">
            {dayIndex >= 0 ? `${DAY_LONG[dayIndex]} ${dateLine}` : "Tonight"}
          </span>

          {data.recipesLoading ? (
            <span className="fresh-skel fresh-skel-line" />
          ) : tonight && tonight.noMeal ? (
            <span className="fresh-tonight-quiet">
              No shared dinner tonight
            </span>
          ) : tonight ? (
            <>
              <span className="fresh-tonight-dish">{tonight.name}</span>
              <span className="fresh-tonight-meta">
                {tonight.assignedTo ? (
                  <span className="fresh-person">
                    <Avatar
                      name={tonight.assignedTo}
                      size={26}
                      className="fresh-ring"
                    />
                    <span className="fresh-person-name">
                      {tonight.assignedTo}
                    </span>
                  </span>
                ) : (
                  <span className="fresh-tonight-nocook">No cook picked</span>
                )}
                {tonight.portions > 0 ? (
                  <span className="fresh-pill-note">
                    {tonight.portions} portions
                  </span>
                ) : (
                  <span className="fresh-pill-note">
                    {mealGroup.length} eating
                  </span>
                )}
                {tonight.ingredients.length > 0 ? (
                  <span className="fresh-pill-note">
                    {tonight.ingredients.length} ingredient
                    {tonight.ingredients.length === 1 ? "" : "s"}
                  </span>
                ) : null}
              </span>
            </>
          ) : (
            <span className="fresh-tonight-quiet">
              Nothing planned for tonight
            </span>
          )}
        </button>

        {!data.recipesLoading && !tonight && dayIndex >= 0 ? (
          <button
            type="button"
            className="fresh-btn fresh-btn-primary fresh-btn-block"
            onClick={() => onPlanDinner({ weekStart, day: dayIndex })}
          >
            Plan dinner
          </button>
        ) : null}
      </section>

      {/* ---- Money ---- */}
      <section className="fresh-card">
        <div className="fresh-card-head">
          <h2 className="fresh-h2">{monthName}</h2>
          <button
            type="button"
            className="fresh-head-link"
            onClick={onOpenMonth}
          >
            Open month
            <IconChevronRight size={16} />
          </button>
        </div>

        {loadingBills || data.expensesLoading ? (
          <>
            <div className="fresh-skel fresh-skel-row" />
            <div className="fresh-skel fresh-skel-row" />
            <div className="fresh-skel fresh-skel-row" />
          </>
        ) : !anyMovement ? (
          <div className="fresh-empty">
            <strong>Nothing to settle yet</strong>
            Log a receipt or this month&apos;s bills and the split shows up
            here.
          </div>
        ) : (
          <>
            <div className="fresh-money-rows">
              {settlement.lines.map((line) => {
                const delta = line.share - line.paid;
                return (
                  <button
                    key={line.name}
                    type="button"
                    className="fresh-money-row"
                    onClick={onOpenMonth}
                  >
                    <Avatar name={line.name} size={32} />
                    <span className="fresh-money-name">{line.name}</span>
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
                );
              })}
            </div>
            <div className="fresh-money-total">
              <span>Household total</span>
              <span className="fresh-num">{fmtMoney(settlement.grand)}</span>
            </div>
          </>
        )}
      </section>

      {/* ---- Still to buy ---- */}
      <button
        type="button"
        className="fresh-counter fresh-counter-wide"
        onClick={() => onNavigate("grocery")}
      >
        <span className="fresh-counter-num">{toBuy.length}</span>
        <span className="fresh-counter-label">Still to buy</span>
        {toBuy.length > 0 ? (
          <span className="fresh-counter-names">
            {toBuy
              .slice(0, 4)
              .map((g) => g.name)
              .join(", ")}
            {toBuy.length > 4 ? "…" : ""}
          </span>
        ) : null}
      </button>

      {/* ---- Use soon ---- */}
      <section className="fresh-card">
        <div className="fresh-card-head">
          <h2 className="fresh-h2">Use soon</h2>
          <button
            type="button"
            className="fresh-head-link"
            onClick={() => onNavigate("fridge")}
          >
            Inventory
            <IconChevronRight size={16} />
          </button>
        </div>

        {data.itemsLoading ? (
          <>
            <div className="fresh-skel fresh-skel-row" />
            <div className="fresh-skel fresh-skel-row" />
          </>
        ) : expiring.length === 0 ? (
          <div className="fresh-empty">
            <strong>Nothing about to go off</strong>
            Anything with an expiry date lands here three days ahead.
          </div>
        ) : (
          <div className="fresh-rows">
            {expiring.slice(0, 6).map(({ item }) => {
              const status = expiryStatus(item.expiry);
              return (
                <div className="fresh-row" key={item.id}>
                  <span className="fresh-row-main">
                    <span className="fresh-row-title">{item.name}</span>
                    <span className="fresh-row-meta">
                      <span className="fresh-row-note">{item.category}</span>
                    </span>
                  </span>
                  <span
                    className={`fresh-badge${status.cls === "expired" ? " danger" : " warn"}`}
                  >
                    {status.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
