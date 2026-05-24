"use client";

import { useEffect, useState } from "react";
import FridgeView from "@/components/FridgeView";
import GroceryView from "@/components/GroceryView";
import ManageCategoriesModal from "@/components/ManageCategoriesModal";
import RecipesView from "@/components/RecipesView";
import TabBar, { type Tab } from "@/components/TabBar";
import ThemeToggle from "@/components/ThemeToggle";
import Toast, { type ToastMessage } from "@/components/Toast";
import {
  listCategories,
  listGrocery,
  listItems,
  listRecipes,
} from "@/lib/client";
import type {
  CategoryDef,
  GroceryItem,
  Item,
  Recipe,
} from "@/lib/types";

export default function Page() {
  const [items, setItems] = useState<Item[]>([]);
  const [grocery, setGrocery] = useState<GroceryItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [categories, setCategories] = useState<CategoryDef[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [groceryLoading, setGroceryLoading] = useState(true);
  const [groceryError, setGroceryError] = useState<string | null>(null);
  const [recipesLoading, setRecipesLoading] = useState(true);
  const [recipesError, setRecipesError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("fridge");
  const [managingCats, setManagingCats] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    let cancelled = false;

    listItems()
      .then((d) => {
        if (cancelled) return;
        setItems(d);
        setItemsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setItemsError(err instanceof Error ? err.message : String(err));
        setItemsLoading(false);
      });

    listGrocery()
      .then((d) => {
        if (cancelled) return;
        setGrocery(d);
        setGroceryLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setGroceryError(err instanceof Error ? err.message : String(err));
        setGroceryLoading(false);
      });

    listRecipes()
      .then((d) => {
        if (cancelled) return;
        setRecipes(d);
        setRecipesLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRecipesError(err instanceof Error ? err.message : String(err));
        setRecipesLoading(false);
      });

    listCategories()
      .then((d) => {
        if (cancelled) return;
        setCategories(d);
      })
      .catch(() => {
        if (cancelled) return;
        setCategories([
          { name: "Meat", color: null },
          { name: "Veggies", color: null },
          { name: "Other", color: null },
        ]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function showToast(text: string) {
    setToast({ id: Date.now(), text });
  }

  const openGroceryCount = grocery.filter((g) => !g.done).length;
  const headerTitle =
    tab === "fridge" ? "Fridge" : tab === "grocery" ? "Grocery" : "Recipes";

  return (
    <div className="wrap">
      <header className="app-header">
        <h1>{headerTitle}</h1>
        <ThemeToggle />
      </header>

      <TabBar value={tab} onChange={setTab} groceryCount={openGroceryCount} />

      {tab === "fridge" ? (
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
          onToast={showToast}
          onManageCategories={() => setManagingCats(true)}
        />
      ) : (
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
