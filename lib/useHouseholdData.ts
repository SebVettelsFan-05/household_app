"use client";

import { useEffect, useState } from "react";
import type { ToastMessage } from "@/components/Toast";
import {
  getMealGroup,
  listCategories,
  listExpenses,
  listGrocery,
  listItems,
  listRecipes,
  listSharedAccounts,
} from "@/lib/client";
import { sortCategories } from "@/lib/normalize";
import type {
  CategoryDef,
  Expense,
  GroceryItem,
  Item,
  MealGroup,
  Recipe,
  SharedAccount,
} from "@/lib/types";

/**
 * The one data layer both shells consume. Everything the app needs is
 * fetched once here and handed to whichever UI is mounted, so switching
 * between the classic and the fresh look never re-implements a fetch or
 * disagrees about what the household currently holds.
 */
export type HouseholdData = ReturnType<typeof useHouseholdData>;

const DEFAULT_CATEGORIES = [
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
];

export function useHouseholdData() {
  const [items, setItems] = useState<Item[]>([]);
  const [grocery, setGrocery] = useState<GroceryItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [sharedAccounts, setSharedAccounts] = useState<SharedAccount[]>([]);
  const [categories, setCategories] = useState<CategoryDef[]>([]);
  const [mealGroup, setMealGroup] = useState<MealGroup>({ members: [] });
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [groceryLoading, setGroceryLoading] = useState(true);
  const [groceryError, setGroceryError] = useState<string | null>(null);
  const [recipesLoading, setRecipesLoading] = useState(true);
  const [recipesError, setRecipesError] = useState<string | null>(null);
  const [expensesLoading, setExpensesLoading] = useState(true);
  const [expensesError, setExpensesError] = useState<string | null>(null);
  const [sharedAccountsLoading, setSharedAccountsLoading] = useState(true);
  const [sharedAccountsError, setSharedAccountsError] = useState<string | null>(
    null
  );
  const [toast, setToast] = useState<ToastMessage | null>(null);

  function showToast(text: string) {
    setToast({ id: Date.now(), text });
  }

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

      listSharedAccounts()
        .then((d) => {
          if (isCancelled()) return;
          setSharedAccounts(d);
          setSharedAccountsLoading(false);
          setSharedAccountsError(null);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`passwords: ${msg}`);
          if (isCancelled()) return;
          setSharedAccountsError(msg);
          setSharedAccountsLoading(false);
        }),

      getMealGroup()
        .then((g) => {
          if (isCancelled()) return;
          setMealGroup(g);
        })
        .catch((err: unknown) => {
          // An unreachable or not-yet-migrated setting degrades to "everyone",
          // which is the documented meaning of an empty group.
          console.warn("[settings] meal group load failed", err);
          if (isCancelled()) return;
          setMealGroup({ members: [] });
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
              DEFAULT_CATEGORIES.map((name) => ({ name, color: null }))
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

  async function refresh(): Promise<void> {
    const { errors } = await loadAll();
    if (errors.length > 0) {
      const first = errors[0];
      const extra = errors.length > 1 ? ` (+${errors.length - 1} more)` : "";
      showToast(`Refresh failed: ${first}${extra}`);
    }
  }

  return {
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
    loadAll,
    refresh,
    toast,
    showToast,
  };
}
