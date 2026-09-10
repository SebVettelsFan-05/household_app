"use client";

import { useState } from "react";
import FreshExpenses from "@/components/fresh/FreshExpenses";
import FreshGrocery from "@/components/fresh/FreshGrocery";
import FreshHome from "@/components/fresh/FreshHome";
import FreshInventory from "@/components/fresh/FreshInventory";
import FreshMore from "@/components/fresh/FreshMore";
import FreshRecipes from "@/components/fresh/FreshRecipes";
import HouseholdSettingsModal from "@/components/HouseholdSettingsModal";
import ManageCategoriesModal from "@/components/ManageCategoriesModal";
import PasswordsView from "@/components/PasswordsView";
import RefreshButton from "@/components/RefreshButton";
import ThemeToggle from "@/components/ThemeToggle";
import Toast from "@/components/Toast";
import { effectiveMealGroup } from "@/lib/mealGroup";
import type { HouseholdData } from "@/lib/useHouseholdData";

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

const PHONE_TABS: FreshTab[] = [
  "home",
  "grocery",
  "recipes",
  "expenses",
  "more",
];

const RAIL_TABS: FreshTab[] = [
  "home",
  "grocery",
  "recipes",
  "expenses",
  "fridge",
  "passwords",
];

const RAIL_LABELS: Record<string, string> = {
  ...TITLES,
  home: "Home",
};

type Props = {
  data: HouseholdData;
  onSwitchUi: () => void;
};

export default function FreshApp({ data, onSwitchUi }: Props) {
  const [tab, setTab] = useState<FreshTab>("home");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [managingCats, setManagingCats] = useState(false);
  // Set when Home's "Plan dinner" hands a slot to the Recipes tab.
  const [pendingSlot, setPendingSlot] = useState<RecipeSlot | null>(null);

  const openGroceryCount = data.grocery.filter((g) => !g.done).length;
  const cookGroup = effectiveMealGroup(data.mealGroup);
  const manageCategories = () => setManagingCats(true);

  function planDinner(slot: RecipeSlot) {
    setPendingSlot(slot);
    setTab("recipes");
  }

  return (
    <div className="fresh">
      <header className="fresh-top">
        <h1 className="fresh-title">{TITLES[tab]}</h1>
        <div className="fresh-top-actions">
          <RefreshButton onRefresh={data.refresh} onError={data.showToast} />
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setSettingsOpen(true)}
            aria-label="Household settings"
            title="Household settings"
          >
            ⚙
          </button>
          <ThemeToggle />
        </div>
      </header>

      <div className="fresh-body">
        <nav className="fresh-rail" aria-label="Sections">
          {RAIL_TABS.map((t) => (
            <button
              key={t}
              type="button"
              className={`fresh-rail-btn${tab === t ? " active" : ""}`}
              aria-current={tab === t ? "page" : undefined}
              onClick={() => setTab(t)}
            >
              <span>{RAIL_LABELS[t]}</span>
              {t === "grocery" && openGroceryCount > 0 ? (
                <span className="fresh-rail-count">{openGroceryCount}</span>
              ) : null}
            </button>
          ))}
          <div className="fresh-rail-sep" />
          <button
            type="button"
            className="fresh-rail-btn"
            onClick={() => setSettingsOpen(true)}
          >
            Household settings
          </button>
          <button type="button" className="fresh-rail-btn" onClick={onSwitchUi}>
            Classic look
          </button>
        </nav>

        <main className="fresh-main">
          {tab === "home" ? (
            <FreshHome
              data={data}
              mealGroup={cookGroup}
              onNavigate={setTab}
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
            <FreshExpenses data={data} mealGroup={cookGroup} />
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
              onSwitchUi={onSwitchUi}
            />
          )}
        </main>
      </div>

      <nav className="fresh-tabbar" aria-label="Sections">
        {PHONE_TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={`fresh-tab${tab === t || (t === "more" && (tab === "fridge" || tab === "passwords")) ? " active" : ""}`}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => setTab(t)}
          >
            {TITLES[t]}
            {t === "grocery" && openGroceryCount > 0 ? (
              <span className="fresh-tab-count"> {openGroceryCount}</span>
            ) : null}
          </button>
        ))}
      </nav>

      {settingsOpen ? (
        <HouseholdSettingsModal
          group={data.mealGroup}
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
          onToast={data.showToast}
          onError={(msg) => data.showToast("Error: " + msg)}
        />
      ) : null}

      <Toast message={data.toast} />
    </div>
  );
}
