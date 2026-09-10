"use client";

import { useEffect, useState } from "react";
import type { RecipeSlot } from "@/components/fresh/FreshApp";
import AddRecipeToGroceryModal from "@/components/AddRecipeToGroceryModal";
import FavoritesModal from "@/components/FavoritesModal";
import RecipeArchiveModal from "@/components/RecipeArchiveModal";
import RecipeModal, { type RecipeFields } from "@/components/RecipeModal";
import { cookCounts } from "@/lib/cookCounts";
import { COOKING_DAYS, shortDayLabel } from "@/lib/dates";
import type { FavoriteRecipe, Recipe, RecipeIngredient } from "@/lib/types";
import { useRecipeWeeks } from "@/lib/useRecipeWeeks";
import type { HouseholdData } from "@/lib/useHouseholdData";

type Props = {
  data: HouseholdData;
  mealGroup: string[];
  // A slot handed over from Home's "Plan dinner" action.
  openSlot: RecipeSlot | null;
  onOpenSlotHandled: () => void;
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default function FreshRecipes({
  data,
  mealGroup,
  openSlot,
  onOpenSlotHandled,
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
    ensureFavorites,
    markerBusy,
    addNoMealMarker,
    removeNoMealMarker,
    findFirstEmptySlot,
  } = useRecipeWeeks({
    recipes: data.recipes,
    onRecipesChange: data.setRecipes,
    onToast: data.showToast,
  });

  // Home hands over "plan tonight" by naming the slot; open it once and
  // let the parent clear the request so a later re-render doesn't reopen it.
  useEffect(() => {
    if (!openSlot) return;
    const existing = data.recipes.find(
      (r) => r.weekStart === openSlot.weekStart && r.day === openSlot.day
    );
    setEditing(
      existing
        ? {
            mode: "edit",
            recipeId: existing.id,
            initial: recipeToFields(existing),
          }
        : {
            mode: "new",
            initial: blankFields(
              openSlot.weekStart,
              openSlot.day,
              mealGroup.length
            ),
          }
    );
    onOpenSlotHandled();
    // Only the arrival of a new slot should open the modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSlot]);

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

  function dayParts(weekStart: string, day: number) {
    const [abbr, date] = shortDayLabel(weekStart, day).split(", ");
    return { abbr, date };
  }

  return (
    <>
      <div className="fresh-section-head">
        <span className="fresh-sub">Sunday to Thursday, two weeks ahead</span>
        <div className="fresh-btn-row">
          <button type="button" className="fresh-btn" onClick={openFavorites}>
            Favorites
          </button>
          <button
            type="button"
            className="fresh-btn"
            onClick={() => setArchiveOpen(true)}
          >
            Archive
          </button>
        </div>
      </div>

      {data.recipesLoading ? (
        <div>
          <div className="fresh-skel fresh-skel-row" />
          <div className="fresh-skel fresh-skel-row" />
          <div className="fresh-skel fresh-skel-row" />
        </div>
      ) : data.recipesError ? (
        <div className="fresh-error">
          Couldn&apos;t load recipes. {data.recipesError}
        </div>
      ) : (
        <div className="fresh-weeks">
          {[
            { label: "This week", weekStart: week1 },
            { label: "Next week", weekStart: week2 },
          ].map(({ label, weekStart }) => {
            const counts = cookCounts(
              data.recipes.filter((r) => r.weekStart === weekStart)
            );
            return (
              <section className="fresh-section" key={weekStart}>
                <div className="fresh-section-head">
                  <h2 className="fresh-h2">{label}</h2>
                  <div className="fresh-cook-tally">
                    {counts.length === 0 ? (
                      <span className="fresh-sub">No cooks yet</span>
                    ) : (
                      counts.map((c) => (
                        <span className="fresh-badge" key={c.name}>
                          {c.name} {c.count}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <div className="fresh-rows">
                  {COOKING_DAYS.map((d) => {
                    const recipe = recipesByWeek.get(weekStart)?.get(d) ?? null;
                    const { abbr, date } = dayParts(weekStart, d);
                    const dayCell = (
                      <span className="fresh-day-name">
                        <span className="fresh-day-abbr">{abbr}</span>
                        <span className="fresh-day-date">{date}</span>
                      </span>
                    );

                    if (recipe && recipe.noMeal) {
                      return (
                        <div className="fresh-day-row" key={`${weekStart}-${d}`}>
                          <span className="fresh-day-open">
                            {dayCell}
                            <span className="fresh-row-main">
                              <span className="fresh-row-title fresh-day-quiet">
                                No shared meal
                              </span>
                            </span>
                          </span>
                          <div className="fresh-day-actions">
                            <button
                              type="button"
                              className="fresh-btn fresh-btn-quiet"
                              disabled={markerBusy}
                              onClick={() =>
                                setEditing({
                                  mode: "new",
                                  initial: blankFields(
                                    weekStart,
                                    d,
                                    mealGroup.length
                                  ),
                                })
                              }
                            >
                              Plan a meal
                            </button>
                            <button
                              type="button"
                              className="fresh-btn fresh-btn-quiet"
                              disabled={markerBusy}
                              onClick={() => removeNoMealMarker(recipe)}
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                      );
                    }

                    if (!recipe) {
                      return (
                        <div className="fresh-day-row" key={`${weekStart}-${d}`}>
                          <button
                            type="button"
                            className="fresh-day-open"
                            onClick={() =>
                              setEditing({
                                mode: "new",
                                initial: blankFields(
                                  weekStart,
                                  d,
                                  mealGroup.length
                                ),
                              })
                            }
                          >
                            {dayCell}
                            <span className="fresh-row-main">
                              <span className="fresh-row-title fresh-day-quiet">
                                Add a meal
                              </span>
                            </span>
                          </button>
                          <div className="fresh-day-actions">
                            <button
                              type="button"
                              className="fresh-btn fresh-btn-quiet"
                              disabled={markerBusy}
                              onClick={() => addNoMealMarker(weekStart, d)}
                            >
                              No meal
                            </button>
                          </div>
                        </div>
                      );
                    }

                    const meta: string[] = [];
                    if (recipe.portions > 0) {
                      meta.push(`${recipe.portions} portions`);
                    }
                    if (recipe.ingredients.length > 0) {
                      meta.push(
                        `${recipe.ingredients.length} ingredient${recipe.ingredients.length === 1 ? "" : "s"}`
                      );
                    }

                    return (
                      <div className="fresh-day-row" key={`${weekStart}-${d}`}>
                        <button
                          type="button"
                          className="fresh-day-open"
                          onClick={() =>
                            setEditing({
                              mode: "edit",
                              recipeId: recipe.id,
                              initial: recipeToFields(recipe),
                            })
                          }
                        >
                          {dayCell}
                          <span className="fresh-avatar" aria-hidden="true">
                            {initials(recipe.assignedTo || "?")}
                          </span>
                          <span className="fresh-row-main">
                            <span className="fresh-row-title">{recipe.name}</span>
                            <span className="fresh-row-meta">
                              {recipe.assignedTo || "No cook"}
                              {meta.length > 0 ? ` · ${meta.join(", ")}` : ""}
                            </span>
                          </span>
                          <span className="fresh-row-note">›</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {editing ? (
        <RecipeModal
          mode={editing.mode}
          recipeId={editing.mode === "edit" ? editing.recipeId : undefined}
          initial={editing.initial}
          categories={data.categories}
          fridgeItems={data.items}
          mealGroup={mealGroup}
          weekOptions={[
            { weekStart: week1, label: "This week" },
            { weekStart: week2, label: "Next week" },
          ]}
          favorites={favorites}
          onFavoritesChange={setFavorites}
          onClose={() => setEditing(null)}
          onResult={(next, msg) => {
            if (next.length > 0) data.setRecipes(next);
            data.showToast(msg);
          }}
          onError={(msg) => data.showToast("Error: " + msg)}
          escapeDisabled={Boolean(addingToGrocery)}
          onOpenAddToGrocery={setAddingToGrocery}
        />
      ) : null}

      {addingToGrocery ? (
        <AddRecipeToGroceryModal
          recipeName={addingToGrocery.recipeName}
          ingredients={addingToGrocery.ingredients}
          categories={data.categories}
          defaultAddedBy={addingToGrocery.defaultAddedBy}
          servings={addingToGrocery.servings}
          portions={addingToGrocery.portions}
          fridgeItems={data.items}
          onCategoriesReviewed={addingToGrocery.onCategoriesReviewed}
          onClose={() => setAddingToGrocery(null)}
          onAdded={(grocery, msg) => {
            data.setGrocery(grocery);
            data.showToast(msg);
          }}
          onError={(msg) => data.showToast("Error: " + msg)}
        />
      ) : null}

      {favoritesOpen ? (
        <FavoritesModal
          favorites={favorites}
          onClose={() => setFavoritesOpen(false)}
          onChange={setFavorites}
          onUse={useFavoriteAsTemplate}
          onToast={data.showToast}
          onError={(msg) => data.showToast("Error: " + msg)}
        />
      ) : null}

      {archiveOpen ? (
        <RecipeArchiveModal
          onClose={() => setArchiveOpen(false)}
          onError={(msg) => data.showToast("Error: " + msg)}
        />
      ) : null}
    </>
  );
}
