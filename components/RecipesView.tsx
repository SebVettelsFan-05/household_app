"use client";

import { useEffect, useMemo, useState } from "react";
import AddRecipeToGroceryModal from "@/components/AddRecipeToGroceryModal";
import FavoritesModal from "@/components/FavoritesModal";
import RecipeArchiveModal from "@/components/RecipeArchiveModal";
import RecipeCard from "@/components/RecipeCard";
import RecipeModal, { type RecipeFields } from "@/components/RecipeModal";
import {
  addFavorite,
  deleteFavorite,
  listFavorites,
  listRecipes,
} from "@/lib/client";
import {
  COOKING_DAYS,
  msUntilNextLocalMidnight,
  nextWeekStart,
  thisWeekStart,
} from "@/lib/dates";
import { findFavoriteMatch, isFavoriteMatch } from "@/lib/favoriteMatch";
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
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteRecipe[]>([]);
  const [favsLoaded, setFavsLoaded] = useState(false);
  const [favBusy, setFavBusy] = useState(false);

  // Preload favorites on first mount so the star state on each card is
  // accurate from the first render — without it the cards would briefly show
  // unfavorited and then "snap" to favorited once the user opens the modal.
  useEffect(() => {
    if (favsLoaded) return;
    let cancelled = false;
    listFavorites()
      .then((data) => {
        if (cancelled) return;
        setFavorites(data);
        setFavsLoaded(true);
      })
      .catch(() => {
        // Silent — the modal will surface load errors on demand.
      });
    return () => {
      cancelled = true;
    };
  }, [favsLoaded]);

  async function toggleFavorite(recipe: Recipe) {
    if (favBusy) return;
    setFavBusy(true);
    try {
      // Match by name OR link, identical rule to the in-modal check, so the
      // card star and the modal button never disagree about the state.
      const match = findFavoriteMatch(
        { name: recipe.name, link: recipe.link },
        favorites
      );
      if (match) {
        const res = await deleteFavorite(match.id);
        setFavorites(res.favorites);
        onToast(`Removed "${recipe.name}" from favorites`);
      } else {
        const res = await addFavorite({
          name: recipe.name,
          link: recipe.link,
          description: recipe.description,
          ingredients: recipe.ingredients,
        });
        setFavorites(res.favorites);
        onToast(`Saved "${recipe.name}" to favorites`);
      }
    } catch (err) {
      onToast(
        "Error: " + (err instanceof Error ? err.message : String(err))
      );
    } finally {
      setFavBusy(false);
    }
  }

  // Re-computed when `today` changes. A timer schedules itself for the next
  // household-timezone midnight so the week boundary advances live without a
  // refresh. At Friday 00:00 Toronto time, the completed Sun-Thu cooking week
  // drops into the archive and the upcoming Sunday becomes "this week".
  const [today, setToday] = useState<Date>(() => new Date());
  const week1 = useMemo(() => thisWeekStart(today), [today]);
  const week2 = useMemo(() => nextWeekStart(today), [today]);

  useEffect(() => {
    const delay = msUntilNextLocalMidnight(today);
    const t = window.setTimeout(() => setToday(new Date()), delay);
    return () => window.clearTimeout(t);
  }, [today]);

  // Mobile and laptops aggressively suspend background tabs - the midnight
  // setTimeout above silently fails to fire across a sleep. Re-read the
  // clock whenever the tab regains visibility so a user opening the app
  // Sunday morning sees the rolled-over week even if their phone had been
  // asleep through the actual boundary.
  useEffect(() => {
    function refreshIfVisible() {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible") {
        setToday(new Date());
      }
    }
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("focus", refreshIfVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("focus", refreshIfVisible);
    };
  }, []);

  // When the week actually rolls over, refetch so the server-side window
  // (this/next week) returns the recipes for the new range. Skipped on the
  // first render so we don't double-fetch right after mount.
  const firstRender = useMemo(() => ({ v: true }), []);
  useEffect(() => {
    if (firstRender.v) {
      firstRender.v = false;
      return;
    }
    listRecipes()
      .then(onRecipesChange)
      .catch((err: unknown) => {
        onToast(
          "Error reloading recipes: " +
            (err instanceof Error ? err.message : String(err))
        );
      });
    // intentionally only depends on week1 — we want a refetch precisely when
    // the active window slides forward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week1]);

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

  // Walk this week and next, return the first empty (weekStart, day) — so
  // when the user picks a favorite, we drop it into the next free slot
  // instead of forcing them to overwrite Sunday.
  function findFirstEmptySlot(): { weekStart: string; day: number } {
    for (const weekStart of [week1, week2]) {
      const slots = recipesByWeek.get(weekStart);
      for (const d of COOKING_DAYS) {
        if (!slots?.has(d)) return { weekStart, day: d };
      }
    }
    return { weekStart: week1, day: 0 };
  }

  function useFavoriteAsTemplate(template: {
    name: string;
    link: string;
    description: string;
    ingredients: FavoriteRecipe["ingredients"];
  }) {
    setFavoritesOpen(false);
    const slot = findFirstEmptySlot();
    setEditing({
      mode: "new",
      initial: {
        weekStart: slot.weekStart,
        day: slot.day,
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
                        recipe ? () => toggleFavorite(recipe) : undefined
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

      {archiveOpen ? (
        <RecipeArchiveModal
          onClose={() => setArchiveOpen(false)}
          onError={(msg) => onToast("Error: " + msg)}
        />
      ) : null}
    </>
  );
}
