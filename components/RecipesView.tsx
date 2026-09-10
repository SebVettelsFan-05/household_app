"use client";

import { useState } from "react";
import AddRecipeToGroceryModal from "@/components/AddRecipeToGroceryModal";
import FavoritesModal from "@/components/FavoritesModal";
import RecipeArchiveModal from "@/components/RecipeArchiveModal";
import RecipeCard from "@/components/RecipeCard";
import RecipeModal, { type RecipeFields } from "@/components/RecipeModal";
import { COOKING_DAYS } from "@/lib/dates";
import { isFavoriteMatch } from "@/lib/favoriteMatch";
import { useRecipeWeeks } from "@/lib/useRecipeWeeks";
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
  // Effective meal group, already falling back to everyone when unset.
  mealGroup: string[];
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

function blankFields(
  weekStart: string,
  day: number,
  portions: number
): RecipeFields {
  return {
    weekStart,
    day,
    assignedTo: "",
    name: "",
    link: "",
    description: "",
    ingredients: [],
    servings: 0,
    // New recipes assume the whole meal group is eating.
    portions,
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
    servings: r.servings ?? 0,
    portions: r.portions ?? 0,
  };
}

export default function RecipesView({
  recipes,
  categories,
  fridgeItems,
  mealGroup,
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
    servings: number;
    portions: number;
    onCategoriesReviewed: (ingredients: RecipeIngredient[]) => void;
  } | null>(null);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const {
    week1,
    week2,
    recipesByWeek,
    favorites,
    setFavorites,
    favBusy,
    ensureFavorites,
    toggleFavorite,
    markerBusy,
    addNoMealMarker,
    removeNoMealMarker,
    findFirstEmptySlot,
    weekCooks,
  } = useRecipeWeeks({ recipes, onRecipesChange, onToast });

  async function openFavorites() {
    setFavoritesOpen(true);
    await ensureFavorites();
  }

  function useFavoriteAsTemplate(template: {
    name: string;
    link: string;
    description: string;
    ingredients: FavoriteRecipe["ingredients"];
    servings: number;
  }) {
    setFavoritesOpen(false);
    const slot = findFirstEmptySlot();
    setEditing({
      mode: "new",
      initial: {
        ...blankFields(slot.weekStart, slot.day, mealGroup.length),
        name: template.name,
        link: template.link,
        description: template.description,
        ingredients: template.ingredients,
        servings: template.servings,
      },
    });
  }

  return (
    <>
      <div className="recipes-toolbar">
        <button type="button" className="btn-secondary" onClick={openFavorites}>
          ★ Favorites
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setArchiveOpen(true)}
        >
          ⌛ Archive
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
                {weekCooks(weekStart) ? (
                  <span className="week-cooks">{weekCooks(weekStart)}</span>
                ) : null}
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
                      favorited={
                        recipe
                          ? isFavoriteMatch(
                              { name: recipe.name, link: recipe.link },
                              favorites
                            )
                          : false
                      }
                      favBusy={favBusy}
                      onToggleFavorite={
                        recipe && !recipe.noMeal
                          ? () => toggleFavorite(recipe)
                          : undefined
                      }
                      busy={markerBusy}
                      onNoMeal={
                        recipe ? undefined : () => addNoMealMarker(weekStart, d)
                      }
                      onPlanMeal={
                        recipe?.noMeal
                          ? () =>
                              setEditing({
                                mode: "new",
                                initial: blankFields(
                                  weekStart,
                                  d,
                                  mealGroup.length
                                ),
                              })
                          : undefined
                      }
                      onClearNoMeal={
                        recipe?.noMeal
                          ? () => removeNoMealMarker(recipe)
                          : undefined
                      }
                      onClick={() =>
                        recipe
                          ? setEditing({
                              mode: "edit",
                              recipeId: recipe.id,
                              initial: recipeToFields(recipe),
                            })
                          : setEditing({
                              mode: "new",
                              initial: blankFields(
                                weekStart,
                                d,
                                mealGroup.length
                              ),
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
          mealGroup={mealGroup}
          weekOptions={[
            { weekStart: week1, label: "This week" },
            { weekStart: week2, label: "Next week" },
          ]}
          favorites={favorites}
          onFavoritesChange={setFavorites}
          onClose={() => setEditing(null)}
          onResult={(next, msg) => {
            if (next.length > 0) onRecipesChange(next);
            onToast(msg);
          }}
          onError={(msg) => onToast("Error: " + msg)}
          escapeDisabled={Boolean(addingToGrocery)}
          onOpenAddToGrocery={setAddingToGrocery}
        />
      ) : null}

      {addingToGrocery ? (
        <AddRecipeToGroceryModal
          recipeName={addingToGrocery.recipeName}
          ingredients={addingToGrocery.ingredients}
          categories={categories}
          defaultAddedBy={addingToGrocery.defaultAddedBy}
          servings={addingToGrocery.servings}
          portions={addingToGrocery.portions}
          fridgeItems={fridgeItems}
          onCategoriesReviewed={addingToGrocery.onCategoriesReviewed}
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

      {archiveOpen ? (
        <RecipeArchiveModal
          onClose={() => setArchiveOpen(false)}
          onError={(msg) => onToast("Error: " + msg)}
        />
      ) : null}
    </>
  );
}
