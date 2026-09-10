"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addFavorite,
  addRecipe,
  deleteFavorite,
  deleteRecipe,
  listFavorites,
  listRecipes,
} from "@/lib/client";
import { cookCountsLabel } from "@/lib/cookCounts";
import {
  COOKING_DAYS,
  nextWeekStart,
  thisWeekStart,
} from "@/lib/dates";
import { useHouseholdToday } from "@/lib/useHouseholdToday";
import { findFavoriteMatch } from "@/lib/favoriteMatch";
import type { FavoriteRecipe, Recipe } from "@/lib/types";

/**
 * The behaviour behind the two-week dinner schedule: which weeks are in
 * view, when they roll over, the favorites star state, and the "no shared
 * meal" markers. Both shells render this very differently (a card grid in
 * the classic UI, day rows in the fresh one) but the rules are identical,
 * so they live here once.
 */
export function useRecipeWeeks({
  recipes,
  onRecipesChange,
  onToast,
}: {
  recipes: Recipe[];
  onRecipesChange: (next: Recipe[]) => void;
  onToast: (msg: string) => void;
}) {
  const [favorites, setFavorites] = useState<FavoriteRecipe[]>([]);
  const [favsLoaded, setFavsLoaded] = useState(false);
  const [favBusy, setFavBusy] = useState(false);
  const [markerBusy, setMarkerBusy] = useState(false);

  // "No shared meal" markers are recipe rows with no name or cook, so they
  // hold the slot and keep the day out of the cook counts.
  async function addNoMealMarker(weekStart: string, day: number) {
    if (markerBusy) return;
    setMarkerBusy(true);
    try {
      const res = await addRecipe({
        weekStart,
        day,
        assignedTo: "",
        name: "",
        ingredients: [],
        noMeal: true,
      });
      onRecipesChange(res.recipes);
      onToast("Marked as no shared meal");
    } catch (err) {
      onToast("Error: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setMarkerBusy(false);
    }
  }

  async function removeNoMealMarker(recipe: Recipe, then?: () => void) {
    if (markerBusy) return;
    setMarkerBusy(true);
    try {
      const res = await deleteRecipe(recipe.id);
      onRecipesChange(res.recipes);
      then?.();
    } catch (err) {
      onToast("Error: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setMarkerBusy(false);
    }
  }

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
          servings: recipe.servings > 0 ? recipe.servings : undefined,
        });
        setFavorites(res.favorites);
        onToast(`Saved "${recipe.name}" to favorites`);
      }
    } catch (err) {
      onToast("Error: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setFavBusy(false);
    }
  }

  /** Loads favorites on demand, for the modal's first open. */
  async function ensureFavorites() {
    if (favsLoaded) return;
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

  // Re-computed when `today` changes. A timer schedules itself for the next
  // household-timezone midnight so the week boundary advances live without a
  // refresh. At Friday 00:00 Toronto time, the completed Sun-Thu cooking week
  // drops into the archive and the upcoming Sunday becomes "this week".
  const today = useHouseholdToday();
  const week1 = useMemo(() => thisWeekStart(today), [today]);
  const week2 = useMemo(() => nextWeekStart(today), [today]);

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

  function weekCooks(weekStart: string): string {
    return cookCountsLabel(recipes.filter((r) => r.weekStart === weekStart));
  }

  return {
    today,
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
  };
}
