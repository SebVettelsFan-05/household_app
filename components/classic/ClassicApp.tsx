"use client";

import { useState } from "react";
import ExpensesView from "@/components/ExpensesView";
import FridgeView from "@/components/FridgeView";
import GroceryView from "@/components/GroceryView";
import HomeView from "@/components/HomeView";
import HouseholdSettingsModal from "@/components/HouseholdSettingsModal";
import ManageCategoriesModal from "@/components/ManageCategoriesModal";
import PasswordsView from "@/components/PasswordsView";
import RecipesView from "@/components/RecipesView";
import RefreshButton from "@/components/RefreshButton";
import TabBar, { type Tab } from "@/components/TabBar";
import ThemeToggle from "@/components/ThemeToggle";
import Toast from "@/components/Toast";
import { effectiveMealGroup } from "@/lib/mealGroup";
import type { HouseholdData } from "@/lib/useHouseholdData";
import { useTabHash } from "@/lib/useTabHash";

const TABS: Tab[] = [
  "home",
  "fridge",
  "grocery",
  "recipes",
  "expenses",
  "passwords",
];

/** The tab the URL hash names, falling back to Home. */
function tabFromHash(hash: string): Tab {
  const name = hash.replace(/^#/, "") as Tab;
  return TABS.includes(name) ? name : "home";
}

type Props = {
  data: HouseholdData;
  // Hands the device over to the fresh shell. Offered from the household
  // settings modal so the classic UI keeps its five-tab bar untouched.
  onSwitchUi: () => void;
};

export default function ClassicApp({ data, onSwitchUi }: Props) {
  const {
    items,
    grocery,
    recipes,
    expenses,
    sharedAccounts,
    categories,
    mealGroup,
    itemsLoading,
    itemsError,
    groceryLoading,
    groceryError,
    recipesLoading,
    recipesError,
    expensesLoading,
    expensesError,
    sharedAccountsLoading,
    sharedAccountsError,
    setItems,
    setGrocery,
    setRecipes,
    setExpenses,
    setSharedAccounts,
    setCategories,
    setMealGroup,
    refresh,
    toast,
    showToast,
  } = data;

  // The shell only ever renders in the browser (the page picks a look in a
  // mount effect), so the first tab can come straight off the hash.
  const [tab, setTab] = useState<Tab>(() =>
    typeof window === "undefined" ? "home" : tabFromHash(window.location.hash)
  );
  useTabHash(tab, setTab, tabFromHash);
  const [managingCats, setManagingCats] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const openGroceryCount = grocery.filter((g) => !g.done).length;
  const cookGroup = effectiveMealGroup(mealGroup);
  const headerTitle =
    tab === "home"
      ? "Household"
      : tab === "fridge"
        ? "Inventory"
        : tab === "grocery"
          ? "Grocery"
          : tab === "recipes"
            ? "Recipes"
            : tab === "expenses"
              ? "Expenses"
              : "Passwords";

  return (
    <div className="wrap">
      <header className="app-header">
        <h1>{headerTitle}</h1>
        <div className="header-actions">
          <RefreshButton onRefresh={refresh} onError={showToast} />
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

      <TabBar value={tab} onChange={setTab} groceryCount={openGroceryCount} />

      {tab === "home" ? (
        <HomeView onNavigate={setTab} />
      ) : tab === "fridge" ? (
        <FridgeView
          items={items}
          categories={categories}
          loading={itemsLoading}
          loadError={itemsError}
          onItemsChange={setItems}
          onToast={showToast}
          onManageCategories={() => setManagingCats(true)}
        />
      ) : tab === "grocery" ? (
        <GroceryView
          grocery={grocery}
          categories={categories}
          fridgeItems={items}
          loading={groceryLoading}
          loadError={groceryError}
          onGroceryChange={setGrocery}
          onItemsChange={setItems}
          onToast={showToast}
          onManageCategories={() => setManagingCats(true)}
        />
      ) : tab === "recipes" ? (
        <RecipesView
          recipes={recipes}
          categories={categories}
          fridgeItems={items}
          mealGroup={cookGroup}
          loading={recipesLoading}
          loadError={recipesError}
          onRecipesChange={setRecipes}
          onGroceryChange={setGrocery}
          onToast={showToast}
        />
      ) : tab === "expenses" ? (
        <ExpensesView
          expenses={expenses}
          mealGroup={cookGroup}
          loading={expensesLoading}
          loadError={expensesError}
          onExpensesChange={setExpenses}
          onToast={showToast}
        />
      ) : (
        <PasswordsView
          accounts={sharedAccounts}
          loading={sharedAccountsLoading}
          loadError={sharedAccountsError}
          onAccountsChange={setSharedAccounts}
          onToast={showToast}
        />
      )}

      {settingsOpen ? (
        <HouseholdSettingsModal
          group={mealGroup}
          onClose={() => setSettingsOpen(false)}
          onSaved={setMealGroup}
          onToast={showToast}
          onError={(msg) => showToast("Error: " + msg)}
          switchLabel="Try the new look"
          onSwitchUi={onSwitchUi}
        />
      ) : null}

      {managingCats ? (
        <ManageCategoriesModal
          categories={categories}
          items={items}
          onClose={() => setManagingCats(false)}
          onCategoriesChange={setCategories}
          onItemsChange={setItems}
          onGroceryChange={setGrocery}
          onRecipesChange={setRecipes}
          onToast={showToast}
          onError={(msg) => showToast("Error: " + msg)}
        />
      ) : null}

      <Toast message={toast} />
    </div>
  );
}
