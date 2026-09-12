"use client";

import { useMemo, useState, type ReactNode } from "react";
import FreshExpenses from "@/components/fresh/FreshExpenses";
import FreshGrocery from "@/components/fresh/FreshGrocery";
import FreshHome from "@/components/fresh/FreshHome";
import FreshInventory from "@/components/fresh/FreshInventory";
import FreshMore from "@/components/fresh/FreshMore";
import FreshRecipes from "@/components/fresh/FreshRecipes";
import {
  IconCart,
  IconHome,
  IconKey,
  IconMore,
  IconBox,
  IconPot,
  IconReceipt,
  IconSettings,
} from "@/components/fresh/icons";
import HouseholdSettingsModal from "@/components/HouseholdSettingsModal";
import ManageCategoriesModal from "@/components/ManageCategoriesModal";
import PasswordsView from "@/components/PasswordsView";
import RefreshButton from "@/components/RefreshButton";
import Toast from "@/components/Toast";
import { effectiveMealGroup } from "@/lib/mealGroup";
import { currentExpenseMonth } from "@/lib/expenseMonths";
import { settlementForMonth, useMonthlyBills } from "@/lib/monthlyBills";
import type { HouseholdData } from "@/lib/useHouseholdData";
import { useTabHash } from "@/lib/useTabHash";

export type FreshTab =
  | "home"
  | "grocery"
  | "recipes"
  | "expenses"
  | "more"
  | "fridge"
  | "passwords";

/** A (weekStart, day) the user asked to plan from somewhere other than Recipes. */
export type RecipeSlot = { weekStart: string; day: number };

const TITLES: Record<FreshTab, string> = {
  home: "Home",
  grocery: "Grocery",
  recipes: "Recipes",
  expenses: "Expenses",
  more: "More",
  fridge: "Inventory",
  passwords: "Passwords",
};

/**
 * Which wash the screen wears. fresh.css turns this into `--accent`, which
 * the reused classic modals read too, so a recipe modal opened from the
 * Recipes tab comes up in the Recipes colour without knowing it exists.
 */
const SECTIONS: Record<FreshTab, string> = {
  home: "home",
  grocery: "grocery",
  recipes: "recipes",
  expenses: "expenses",
  more: "home",
  fridge: "inventory",
  passwords: "passwords",
};

const ICONS: Record<FreshTab, (p: { size?: number }) => ReactNode> = {
  home: IconHome,
  recipes: IconPot,
  grocery: IconCart,
  expenses: IconReceipt,
  more: IconMore,
  fridge: IconBox,
  passwords: IconKey,
};

const PHONE_TABS: FreshTab[] = [
  "home",
  "recipes",
  "grocery",
  "expenses",
  "more",
];

const RAIL_TABS: FreshTab[] = [
  "home",
  "recipes",
  "grocery",
  "expenses",
  "fridge",
  "passwords",
];

/** The tab the URL hash names, falling back to Home. */
function tabFromHash(hash: string): FreshTab {
  const name = hash.replace(/^#/, "");
  return name in TITLES ? (name as FreshTab) : "home";
}

type Props = {
  data: HouseholdData;
  onSwitchUi: () => void;
};

export default function FreshApp({ data, onSwitchUi }: Props) {
  // The shell only ever renders in the browser (the page picks a look in a
  // mount effect), so the first tab can come straight off the hash.
  const [tab, setTab] = useState<FreshTab>(() =>
    typeof window === "undefined" ? "home" : tabFromHash(window.location.hash)
  );
  useTabHash(tab, setTab, tabFromHash);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [managingCats, setManagingCats] = useState(false);
  // Set when Home's "Plan dinner" hands a slot to the Recipes tab.
  const [pendingSlot, setPendingSlot] = useState<RecipeSlot | null>(null);
  // Set when Home's money block sends the user straight to the month view.
  const [expensesSegment, setExpensesSegment] = useState<"receipts" | "month">(
    "receipts"
  );

  // One bill store for the whole shell. Home, the Receipts settlement card
  // and the Month editor all read it, so editing Internet on the month view
  // moves every number on every screen at once.
  const bills = useMonthlyBills(data.showToast);
  const { fixed, variable, rent } = bills;
  const thisMonth = currentExpenseMonth();
  const settlement = useMemo(
    () =>
      settlementForMonth(data.expenses, { fixed, variable, rent }, thisMonth),
    [data.expenses, fixed, variable, rent, thisMonth]
  );

  const openGroceryCount = data.grocery.filter((g) => !g.done).length;
  const cookGroup = effectiveMealGroup(data.mealGroup);
  const manageCategories = () => setManagingCats(true);

  function planDinner(slot: RecipeSlot) {
    setPendingSlot(slot);
    setTab("recipes");
  }

  function openMonth() {
    setExpensesSegment("month");
    setTab("expenses");
  }

  // "More" stays lit while the user is inside one of the screens it leads to.
  function tabIsActive(t: FreshTab): boolean {
    if (t === "more") {
      return tab === "more" || tab === "fridge" || tab === "passwords";
    }
    return tab === t;
  }

  return (
    <div className="fresh" data-section={SECTIONS[tab]}>
      <header className="fresh-top">
        <h1 className="fresh-title">{TITLES[tab]}</h1>
        <div className="fresh-top-actions">
          <RefreshButton onRefresh={data.refresh} onError={data.showToast} />
          <button
            type="button"
            className="fresh-icon-btn"
            onClick={() => setSettingsOpen(true)}
            aria-label="Household settings"
            title="Household settings"
          >
            <IconSettings size={20} />
          </button>
        </div>
      </header>

      <div className="fresh-body">
        <nav className="fresh-rail" aria-label="Sections">
          {RAIL_TABS.map((t) => {
            const Icon = ICONS[t];
            return (
              <button
                key={t}
                type="button"
                className={`fresh-rail-btn${tab === t ? " active" : ""}`}
                aria-current={tab === t ? "page" : undefined}
                onClick={() => setTab(t)}
              >
                <Icon size={22} />
                <span className="fresh-rail-label">{TITLES[t]}</span>
                {t === "grocery" && openGroceryCount > 0 ? (
                  <span className="fresh-rail-count">{openGroceryCount}</span>
                ) : null}
              </button>
            );
          })}
          <div className="fresh-rail-sep" />
          <button
            type="button"
            className="fresh-rail-btn"
            onClick={() => setSettingsOpen(true)}
            title="Appearance, look and household preferences"
          >
            <IconSettings size={22} />
            <span className="fresh-rail-label">Household settings</span>
          </button>
        </nav>

        <main className="fresh-main">
          {tab === "home" ? (
            <FreshHome
              data={data}
              mealGroup={cookGroup}
              settlement={settlement}
              loadingBills={bills.loading}
              onNavigate={setTab}
              onOpenMonth={openMonth}
              onPlanDinner={planDinner}
            />
          ) : tab === "grocery" ? (
            <FreshGrocery data={data} onManageCategories={manageCategories} />
          ) : tab === "recipes" ? (
            <FreshRecipes
              data={data}
              mealGroup={cookGroup}
              openSlot={pendingSlot}
              onOpenSlotHandled={() => setPendingSlot(null)}
            />
          ) : tab === "expenses" ? (
            <FreshExpenses
              data={data}
              mealGroup={cookGroup}
              bills={bills}
              settlement={settlement}
              segment={expensesSegment}
              onSegmentChange={setExpensesSegment}
            />
          ) : tab === "fridge" ? (
            <FreshInventory data={data} onManageCategories={manageCategories} />
          ) : tab === "passwords" ? (
            <PasswordsView
              accounts={data.sharedAccounts}
              loading={data.sharedAccountsLoading}
              loadError={data.sharedAccountsError}
              onAccountsChange={data.setSharedAccounts}
              onToast={data.showToast}
            />
          ) : (
            <FreshMore
              onNavigate={setTab}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          )}
        </main>
      </div>

      <nav className="fresh-tabbar" aria-label="Sections">
        {PHONE_TABS.map((t) => {
          const Icon = ICONS[t];
          const active = tabIsActive(t);
          return (
            <button
              key={t}
              type="button"
              className={`fresh-tab${active ? " active" : ""}`}
              aria-current={tab === t ? "page" : undefined}
              onClick={() => setTab(t)}
            >
              <span className="fresh-tab-icon">
                <Icon size={22} />
                {t === "grocery" && openGroceryCount > 0 ? (
                  <span className="fresh-tab-count">{openGroceryCount}</span>
                ) : null}
              </span>
              <span className="fresh-tab-label">{TITLES[t]}</span>
            </button>
          );
        })}
      </nav>

      {settingsOpen ? (
        <HouseholdSettingsModal
          group={data.mealGroup}
          onSwitchUi={onSwitchUi}
          onClose={() => setSettingsOpen(false)}
          onSaved={data.setMealGroup}
          onToast={data.showToast}
          onError={(msg) => data.showToast("Error: " + msg)}
        />
      ) : null}

      {managingCats ? (
        <ManageCategoriesModal
          categories={data.categories}
          items={data.items}
          onClose={() => setManagingCats(false)}
          onCategoriesChange={data.setCategories}
          onItemsChange={data.setItems}
          onGroceryChange={data.setGrocery}
          onRecipesChange={data.setRecipes}
          onToast={data.showToast}
          onError={(msg) => data.showToast("Error: " + msg)}
        />
      ) : null}

      <Toast message={data.toast} />
    </div>
  );
}
