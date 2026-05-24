"use client";

import { useMemo, useState } from "react";
import AddRecipeToGroceryModal from "@/components/AddRecipeToGroceryModal";
import FavoritesModal from "@/components/FavoritesModal";
import RecipeCard from "@/components/RecipeCard";
import RecipeModal, { type RecipeFields } from "@/components/RecipeModal";
import { listFavorites } from "@/lib/client";
import { COOKING_DAYS, nextWeekStart, thisWeekStart } from "@/lib/dates";
import type {
  CategoryDef,
  FavoriteRecipe,
  GroceryItem,
  Item,
  Recipe,
  RecipeIngredient,
} from "@/lib/types";

type Props = {
  recipes: Recipe[];
  categories: CategoryDef[];
  fridgeItems: Item[];
  loading: boolean;
  loadError: string | null;
  onRecipesChange: (next: Recipe[]) => void;
  onGroceryChange: (next: GroceryItem[]) => void;
  onToast: (msg: string) => void;
};

type EditingState =
  | { mode: "new"; initial: RecipeFields }
  | { mode: "edit"; recipeId: string; initial: RecipeFields }
  | null;

function blankFields(weekStart: string, day: number): RecipeFields {
  return {
    weekStart,
    day,
    assignedTo: "",
    name: "",
    link: "",
    description: "",
    ingredients: [],
  };
}

function recipeToFields(r: Recipe): RecipeFields {
  return {
    weekStart: r.weekStart,
    day: r.day,
    assignedTo: r.assignedTo,
    name: r.name,
    link: r.link,
    description: r.description,
    ingredients: r.ingredients,
  };
}

export default function RecipesView({
  recipes,
  categories,
  fridgeItems,
  loading,
  loadError,
  onRecipesChange,
  onGroceryChange,
  onToast,
}: Props) {
  const [editing, setEditing] = useState<EditingState>(null);
  const [addingToGrocery, setAddingToGrocery] = useState<{
    recipeName: string;
    ingredients: RecipeIngredient[];
    defaultAddedBy: string;
  } | null>(null);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteRecipe[]>([]);
  const [favsLoaded, setFavsLoaded] = useState(false);

  const week1 = useMemo(() => thisWeekStart(), []);
  const week2 = useMemo(() => nextWeekStart(), []);

  const recipesByWeek = useMemo(() => {
    const map = new Map<string, Map<number, Recipe>>();
    map.set(week1, new Map());
    map.set(week2, new Map());
    for (const r of recipes) {
      if (!map.has(r.weekStart)) continue;
      const slot = map.get(r.weekStart)!;
      if (!slot.has(r.day)) slot.set(r.day, r);
    }
    return map;
  }, [recipes, week1, week2]);

  async function openFavorites() {
    setFavoritesOpen(true);
    if (!favsLoaded) {
      try {
        const data = await listFavorites();
        setFavorites(data);
        setFavsLoaded(true);
      } catch (err) {
        onToast(
          "Error loading favorites: " +
            (err instanceof Error ? err.message : String(err))
        );
      }
    }
  }

  function useFavoriteAsTemplate(template: {
    name: string;
    link: string;
    description: string;
    ingredients: FavoriteRecipe["ingredients"];
  }) {
    setFavoritesOpen(false);
    setEditing({
      mode: "new",
      initial: {
        weekStart: week1,
        day: 0,
        assignedTo: "",
        name: template.name,
        link: template.link,
        description: template.description,
        ingredients: template.ingredients,
      },
    });
  }

  return (
    <>
      <div className="recipes-toolbar">
        <button type="button" className="btn-secondary" onClick={openFavorites}>
          ★ Favorites
        </button>
      </div>

      {loading ? (
        <div className="loading">
          <span className="spinner" />
          Loading…
        </div>
      ) : loadError ? (
        <div className="empty">
          <p>Couldn&apos;t load recipes.</p>
          <p style={{ fontSize: 13 }}>{loadError}</p>
        </div>
      ) : (
        <>
          {[
            { label: "This week", weekStart: week1 },
            { label: "Next week", weekStart: week2 },
          ].map(({ label, weekStart }) => (
            <section className="week-section" key={weekStart}>
              <div className="list-head">
                <h2>{label}</h2>
              </div>
              <div className="recipe-grid">
                {COOKING_DAYS.map((d) => {
                  const recipe = recipesByWeek.get(weekStart)?.get(d) ?? null;
                  return (
                    <RecipeCard
                      key={`${weekStart}-${d}`}
                      weekStart={weekStart}
                      day={d}
                      recipe={recipe}
                      onClick={() =>
                        recipe
                          ? setEditing({
                              mode: "edit",
                              recipeId: recipe.id,
                              initial: recipeToFields(recipe),
                            })
                          : setEditing({
                              mode: "new",
                              initial: blankFields(weekStart, d),
                            })
                      }
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}

      {editing ? (
        <RecipeModal
          mode={editing.mode}
          recipeId={editing.mode === "edit" ? editing.recipeId : undefined}
          initial={editing.initial}
          categories={categories}
          fridgeItems={fridgeItems}
          onClose={() => setEditing(null)}
          onResult={(next, msg) => {
            if (next.length > 0) onRecipesChange(next);
            onToast(msg);
          }}
          onError={(msg) => onToast("Error: " + msg)}
          onOpenAddToGrocery={setAddingToGrocery}
        />
      ) : null}

      {addingToGrocery ? (
        <AddRecipeToGroceryModal
          recipeName={addingToGrocery.recipeName}
          ingredients={addingToGrocery.ingredients}
          defaultAddedBy={addingToGrocery.defaultAddedBy}
          fridgeItems={fridgeItems}
          onClose={() => setAddingToGrocery(null)}
          onAdded={(grocery, msg) => {
            onGroceryChange(grocery);
            onToast(msg);
          }}
          onError={(msg) => onToast("Error: " + msg)}
        />
      ) : null}

      {favoritesOpen ? (
        <FavoritesModal
          favorites={favorites}
          onClose={() => setFavoritesOpen(false)}
          onChange={setFavorites}
          onUse={useFavoriteAsTemplate}
          onToast={onToast}
          onError={(msg) => onToast("Error: " + msg)}
        />
      ) : null}
    </>
  );
}
