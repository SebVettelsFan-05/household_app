"use client";

import { useMemo } from "react";
import { useHouseholdToday } from "@/lib/useHouseholdToday";
import type { FreshTab, RecipeSlot } from "@/components/fresh/FreshApp";
import FreshSettlementCard from "@/components/fresh/FreshSettlementCard";
import { POOL_LABELS } from "@/components/PoolChips";
import { DAY_LONG, thisWeekStart, todayCookingDay } from "@/lib/dates";
import { expiryStatus } from "@/lib/format";
import { GROCERY_POOLS, type Item } from "@/lib/types";
import { useMonthlySettlement } from "@/lib/useMonthlySettlement";
import type { HouseholdData } from "@/lib/useHouseholdData";

type Props = {
  data: HouseholdData;
  mealGroup: string[];
  onNavigate: (tab: FreshTab) => void;
  onPlanDinner: (slot: RecipeSlot) => void;
};

const POOL_ORDER = ["meals", "house", "personal"] as const;
const EXPIRING_WINDOW_DAYS = 3;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

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

  const poolCounts = useMemo(() => {
    const counts = new Map<string, number>(GROCERY_POOLS.map((p) => [p, 0]));
    for (const g of data.grocery) {
      if (g.done) continue;
      const pool = g.pool ?? "house";
      counts.set(pool, (counts.get(pool) ?? 0) + 1);
    }
    return counts;
  }, [data.grocery]);
  const openGrocery = data.grocery.filter((g) => !g.done).length;

  const expiring = useMemo(() => {
    const rows: { item: Item; days: number }[] = [];
    for (const item of data.items) {
      const days = daysUntil(item.expiry);
      if (days === null || days > EXPIRING_WINDOW_DAYS) continue;
      rows.push({ item, days });
    }
    return rows.sort((a, b) => a.days - b.days || a.item.name.localeCompare(b.item.name));
  }, [data.items]);

  const monthLabel = new Date().toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="fresh-home">
      <section className="fresh-card fresh-home-wide">
        <div className="fresh-card-head">
          <h2 className="fresh-h2">Tonight&apos;s dinner</h2>
          <span className="fresh-sub">
            {dayIndex >= 0 ? DAY_LONG[dayIndex] : "No cooking day"}
          </span>
        </div>

        {data.recipesLoading ? (
          <div className="fresh-skel fresh-skel-row" />
        ) : dayIndex < 0 ? (
          <>
            <div className="fresh-tonight-quiet">No dinner slot today</div>
            <p className="fresh-field-hint">
              The shared week runs Sunday to Thursday. Next week&apos;s slots
              are already open.
            </p>
          </>
        ) : tonight && tonight.noMeal ? (
          <>
            <div className="fresh-tonight-quiet">No shared meal</div>
            <p className="fresh-field-hint">
              Tonight is marked as everyone feeding themselves.
            </p>
          </>
        ) : tonight ? (
          <>
            <div className="fresh-tonight-dish">{tonight.name}</div>
            <div className="fresh-tonight-line">
              <span className="fresh-avatar" aria-hidden="true">
                {initials(tonight.assignedTo || "?")}
              </span>
              <span>
                {tonight.assignedTo
                  ? `${tonight.assignedTo} is cooking`
                  : "No cook picked yet"}
              </span>
              <span className="fresh-badge">
                {tonight.portions > 0
                  ? `${tonight.portions} portions`
                  : `${mealGroup.length} in the meal group`}
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="fresh-tonight-quiet">Nothing planned</div>
            <p className="fresh-field-hint">
              Pick a cook and a dish and the ingredients can go straight to the
              grocery list.
            </p>
            <div className="fresh-btn-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="fresh-btn fresh-btn-primary"
                onClick={() => onPlanDinner({ weekStart, day: dayIndex })}
              >
                Plan dinner
              </button>
            </div>
          </>
        )}

        <button
          type="button"
          className="fresh-block-link"
          onClick={() => onNavigate("recipes")}
        >
          Open Recipes
        </button>
      </section>

      <FreshSettlementCard
        settlement={settlement}
        title="This month"
        subtitle={monthLabel}
        loading={loadingBills || data.expensesLoading}
        linkLabel="Open Expenses"
        onLink={() => onNavigate("expenses")}
      />

      <section className="fresh-card">
        <div className="fresh-card-head">
          <h2 className="fresh-h2">Still to buy</h2>
          <span className="fresh-sub">{openGrocery} open</span>
        </div>
        {data.groceryLoading ? (
          <div className="fresh-skel fresh-skel-row" />
        ) : openGrocery === 0 ? (
          <div className="fresh-empty">
            <strong>The list is clear</strong>
            Anything the house runs out of goes on here.
          </div>
        ) : (
          POOL_ORDER.map((pool) => (
            <div className="fresh-settle-row" key={pool}>
              <span className="fresh-settle-name">{POOL_LABELS[pool]}</span>
              <span className="fresh-row-note">
                {poolCounts.get(pool) ?? 0} item
                {(poolCounts.get(pool) ?? 0) === 1 ? "" : "s"}
              </span>
            </div>
          ))
        )}
        <button
          type="button"
          className="fresh-block-link"
          onClick={() => onNavigate("grocery")}
        >
          Open Grocery
        </button>
      </section>

      <section className="fresh-card">
        <div className="fresh-card-head">
          <h2 className="fresh-h2">Expiring soon</h2>
          <span className="fresh-sub">Next 3 days</span>
        </div>
        {data.itemsLoading ? (
          <div className="fresh-skel fresh-skel-row" />
        ) : expiring.length === 0 ? (
          <div className="fresh-empty">
            <strong>Nothing about to go off</strong>
            Items with an expiry date show up here three days ahead.
          </div>
        ) : (
          expiring.slice(0, 6).map(({ item }) => {
            const status = expiryStatus(item.expiry);
            return (
              <div
                className={`fresh-settle-row ${status.cls === "expired" ? "fresh-expired" : "fresh-expiring"}`}
                key={item.id}
              >
                <span className="fresh-settle-name">
                  {item.name}
                  {item.owner ? (
                    <span className="fresh-badge" style={{ marginLeft: 8 }}>
                      {item.owner}
                    </span>
                  ) : null}
                </span>
                <span className="fresh-row-note">{status.label}</span>
              </div>
            );
          })
        )}
        <button
          type="button"
          className="fresh-block-link"
          onClick={() => onNavigate("fridge")}
        >
          Open Inventory
        </button>
      </section>
    </div>
  );
}
