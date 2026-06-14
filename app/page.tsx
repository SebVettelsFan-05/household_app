"use client";

import { useEffect, useState } from "react";
import ExpensesView from "@/components/ExpensesView";
import FridgeView from "@/components/FridgeView";
import GroceryView from "@/components/GroceryView";
import HomeView from "@/components/HomeView";
import ManageCategoriesModal from "@/components/ManageCategoriesModal";
import RecipesView from "@/components/RecipesView";
import RefreshButton from "@/components/RefreshButton";
import TabBar, { type Tab } from "@/components/TabBar";
import ThemeToggle from "@/components/ThemeToggle";
import Toast, { type ToastMessage } from "@/components/Toast";
import {
  listCategories,
  listExpenses,
  listGrocery,
  listItems,
  listRecipes,
} from "@/lib/client";
import { sortCategories } from "@/lib/normalize";
import type {
  CategoryDef,
  Expense,
  GroceryItem,
  Item,
  Recipe,
} from "@/lib/types";

export default function Page() {
  const [items, setItems] = useState<Item[]>([]);
  const [grocery, setGrocery] = useState<GroceryItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<CategoryDef[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [groceryLoading, setGroceryLoading] = useState(true);
  const [groceryError, setGroceryError] = useState<string | null>(null);
  const [recipesLoading, setRecipesLoading] = useState(true);
  const [recipesError, setRecipesError] = useState<string | null>(null);
  const [expensesLoading, setExpensesLoading] = useState(true);
  const [expensesError, setExpensesError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [managingCats, setManagingCats] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  // Reusable fetcher — used both at mount and by the header refresh button.
  // `cancelled` short-circuits state writes if the caller bailed (StrictMode
  // double-effect, unmount). Returns a list of "<label>: <message>" strings
  // for any individual fetch that failed, so manual refresh can surface a
  // toast instead of failing silently.
  async function loadAll(opts?: {
    cancelled?: () => boolean;
  }): Promise<{ errors: string[] }> {
    const isCancelled = opts?.cancelled ?? (() => false);
    const errors: string[] = [];

    const tasks: Promise<unknown>[] = [
      listItems()
        .then((d) => {
          if (isCancelled()) return;
          setItems(d);
          setItemsLoading(false);
          setItemsError(null);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`inventory: ${msg}`);
          if (isCancelled()) return;
          setItemsError(msg);
          setItemsLoading(false);
        }),

      listGrocery()
        .then((d) => {
          if (isCancelled()) return;
          setGrocery(d);
          setGroceryLoading(false);
          setGroceryError(null);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`grocery: ${msg}`);
          if (isCancelled()) return;
          setGroceryError(msg);
          setGroceryLoading(false);
        }),

      listRecipes()
        .then((d) => {
          if (isCancelled()) return;
          setRecipes(d);
          setRecipesLoading(false);
          setRecipesError(null);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`recipes: ${msg}`);
          if (isCancelled()) return;
          setRecipesError(msg);
          setRecipesLoading(false);
        }),

      listExpenses()
        .then((d) => {
          if (isCancelled()) return;
          setExpenses(d);
          setExpensesLoading(false);
          setExpensesError(null);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`expenses: ${msg}`);
          if (isCancelled()) return;
          setExpensesError(msg);
          setExpensesLoading(false);
        }),

      listCategories()
        .then((d) => {
          if (isCancelled()) return;
          setCategories(sortCategories(d));
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`categories: ${msg}`);
          if (isCancelled()) return;
          setCategories(
            sortCategories(
              [
                "Meat",
                "Veggies",
                "Fruits",
                "Dairy",
                "Bakery",
                "Pantry",
                "Frozen",
                "Snacks",
                "Beverages",
                "Condiments",
                "Other",
              ].map((name) => ({ name, color: null }))
            )
          );
        }),
    ];

    await Promise.allSettled(tasks);
    return { errors };
  }

  useEffect(() => {
    let cancelled = false;
    void loadAll({ cancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
    // loadAll closes over stable setState refs — re-running on every render
    // would mean refetching forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRefresh(): Promise<void> {
    const { errors } = await loadAll();
    if (errors.length > 0) {
      const first = errors[0];
      const extra = errors.length > 1 ? ` (+${errors.length - 1} more)` : "";
      showToast(`Refresh failed — ${first}${extra}`);
    }
  }

  function showToast(text: string) {
    setToast({ id: Date.now(), text });
  }

  const openGroceryCount = grocery.filter((g) => !g.done).length;
  const headerTitle =
    tab === "home"
      ? "Household"
      : tab === "fridge"
        ? "Inventory"
        : tab === "grocery"
          ? "Grocery"
          : tab === "recipes"
            ? "Recipes"
            : "Expenses";

  return (
    <div className="wrap">
      <header className="app-header">
        <h1>{headerTitle}</h1>
        <div className="header-actions">
          <RefreshButton onRefresh={handleRefresh} onError={showToast} />
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
          loading={recipesLoading}
          loadError={recipesError}
          onRecipesChange={setRecipes}
          onGroceryChange={setGrocery}
          onToast={showToast}
        />
      ) : (
        <ExpensesView
          expenses={expenses}
          loading={expensesLoading}
          loadError={expensesError}
          onExpensesChange={setExpenses}
          onToast={showToast}
        />
      )}

      {managingCats ? (
        <ManageCategoriesModal
          categories={categories}
          items={items}
          onClose={() => setManagingCats(false)}
          onCategoriesChange={setCategories}
          onItemsChange={setItems}
          onToast={showToast}
          onError={(msg) => showToast("Error: " + msg)}
        />
      ) : null}

      <Toast message={toast} />
    </div>
  );
}
