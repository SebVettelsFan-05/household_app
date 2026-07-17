"use client";

import { useEffect, useState } from "react";
import {
  addFavorite,
  addRecipe,
  deleteFavorite,
  deleteRecipe,
  scrapeRecipeFromUrl,
  updateRecipe,
} from "@/lib/client";
import {
  BUYERS,
  type CategoryDef,
  type FavoriteRecipe,
  type Recipe,
  type RecipeIngredient,
} from "@/lib/types";
import { DAY_LONG, shortDayLabel } from "@/lib/dates";
import { findFavoriteMatch, isFavoriteMatch } from "@/lib/favoriteMatch";
import IngredientList from "./IngredientList";

export type RecipeFields = {
  weekStart: string;
  day: number;
  assignedTo: string;
  name: string;
  link: string;
  description: string;
  ingredients: RecipeIngredient[];
};

type Props = {
  mode: "new" | "edit";
  recipeId?: string;
  initial: RecipeFields;
  categories: CategoryDef[];
  fridgeItems: import("@/lib/types").Item[];
  // The two weeks currently visible (this week, next week). The user can
  // move/place a recipe in either of these slots from inside the modal.
  weekOptions: { weekStart: string; label: string }[];
  // Lets the modal show the correct star state and route the toggle without
  // duplicating the matching logic that already lives in RecipesView.
  favorites: FavoriteRecipe[];
  onFavoritesChange: (favorites: FavoriteRecipe[]) => void;
  onClose: () => void;
  onResult: (recipes: Recipe[], toast: string) => void;
  onError: (msg: string) => void;
  escapeDisabled?: boolean;
  // Hands the in-memory ingredient state to the picker so it works for both
  // saved and draft recipes.
  onOpenAddToGrocery: (data: {
    recipeName: string;
    ingredients: RecipeIngredient[];
    defaultAddedBy: string;
    onCategoriesReviewed: (ingredients: RecipeIngredient[]) => void;
  }) => void;
};

export default function RecipeModal({
  mode,
  recipeId,
  initial,
  categories,
  fridgeItems,
  weekOptions,
  favorites,
  onFavoritesChange,
  onClose,
  onResult,
  onError,
  escapeDisabled = false,
  onOpenAddToGrocery,
}: Props) {
  const editing = mode === "edit";

  const [name, setName] = useState(initial.name);
  const [assignedTo, setAssignedTo] = useState(initial.assignedTo);
  const [link, setLink] = useState(initial.link);
  const [description, setDescription] = useState(initial.description);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>(
    initial.ingredients
  );
  const [day, setDay] = useState<number>(initial.day);
  const [weekStart, setWeekStart] = useState<string>(initial.weekStart);
  const [busy, setBusy] = useState(false);
  const [scraping, setScraping] = useState(false);

  async function fetchFromLink() {
    const trimmed = link.trim();
    if (!trimmed) {
      onError("Paste a recipe URL first");
      return;
    }
    setScraping(true);
    try {
      const data = await scrapeRecipeFromUrl(trimmed);
      // Only fill name/description if they're empty — don't overwrite what
      // the user already typed.
      if (!name.trim() && data.name) setName(data.name);
      if (!description.trim() && data.description) {
        setDescription(data.description);
      }
      if (data.ingredients.length > 0) {
        // Append rather than replace so a user mid-edit doesn't lose what
        // they've manually entered. Dedupe by case-insensitive name so a
        // second fetch (e.g. user re-pastes the URL) doesn't double up.
        setIngredients((prev) => {
          const seen = new Set(prev.map((p) => p.name.toLowerCase()));
          const next = [...prev];
          for (const ing of data.ingredients) {
            if (!seen.has(ing.name.toLowerCase())) {
              next.push(ing);
              seen.add(ing.name.toLowerCase());
            }
          }
          return next;
        });
      }
      const summary = `Fetched ${data.ingredients.length} ingredient${data.ingredients.length === 1 ? "" : "s"}`;
      onResult(
        [],
        data.hasApproximate
          ? `${summary} (some quantities are estimates — double-check)`
          : summary
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setScraping(false);
    }
  }

  useEffect(() => {
    if (escapeDisabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [escapeDisabled, onClose]);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      onError("Recipe name is required");
      return;
    }
    if (!assignedTo) {
      onError("Pick who's cooking");
      return;
    }
    setBusy(true);
    try {
      if (editing && recipeId) {
        const res = await updateRecipe(recipeId, {
          name: trimmed,
          assignedTo,
          link,
          description,
          ingredients,
          day,
          weekStart,
        });
        onResult(res.recipes, "Saved");
      } else {
        const res = await addRecipe({
          weekStart,
          day,
          assignedTo,
          name: trimmed,
          link: link || undefined,
          description: description || undefined,
          ingredients,
        });
        onResult(res.recipes, "Recipe added");
      }
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!recipeId) return;
    if (!confirm("Delete this recipe?")) return;
    setBusy(true);
    try {
      const res = await deleteRecipe(recipeId);
      onResult(res.recipes, "Deleted");
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Shared with the card star — same `name OR link` rule on both ends, so a
  // recipe that's already in favorites under a slightly different name still
  // shows ★ in both places.
  const isFavorited = isFavoriteMatch({ name, link }, favorites);

  async function toggleFavorite() {
    const trimmed = name.trim();
    if (!trimmed) {
      onError("Recipe needs a name to favorite");
      return;
    }
    setBusy(true);
    try {
      if (isFavorited) {
        const match = findFavoriteMatch({ name, link }, favorites);
        if (match) {
          const res = await deleteFavorite(match.id);
          onFavoritesChange(res.favorites);
          onResult([], `Removed "${trimmed}" from favorites`);
        }
      } else {
        const res = await addFavorite({
          name: trimmed,
          link: link || undefined,
          description: description || undefined,
          ingredients,
        });
        onFavoritesChange(res.favorites);
        onResult(
          [],
          res.existed
            ? `"${trimmed}" was already in favorites`
            : `Saved "${trimmed}" to favorites`
        );
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function addToGrocery() {
    if (ingredients.length === 0) {
      onError("Add some ingredients first");
      return;
    }
    onOpenAddToGrocery({
      recipeName: name.trim() || initial.name || "Recipe",
      ingredients,
      defaultAddedBy: assignedTo,
      onCategoriesReviewed: setIngredients,
    });
  }

  const label = weekStart ? shortDayLabel(weekStart, day) : DAY_LONG[day];

  return (
    <div
      className="modal-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal modal-wide">
        <div className="modal-header">
          <h2>{editing ? "Edit recipe" : "Add recipe"}</h2>
          <span className="modal-sub">{label}</span>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="r-week">Week</label>
            <select
              id="r-week"
              className="select"
              value={weekStart}
              onChange={(e) => setWeekStart(e.target.value)}
            >
              {weekOptions.map((opt) => (
                <option key={opt.weekStart} value={opt.weekStart}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="r-day">Day</label>
            <select
              id="r-day"
              className="select"
              value={day}
              onChange={(e) => setDay(Number(e.target.value))}
            >
              {[0, 1, 2, 3, 4].map((d) => (
                <option key={d} value={d}>
                  {DAY_LONG[d]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="r-who">Cook</label>
          <select
            id="r-who"
            className="select"
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
          >
            <option value="" disabled>
              Pick a cook…
            </option>
            {BUYERS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="r-name">Recipe name</label>
          <input
            id="r-name"
            type="text"
            placeholder="e.g. Thai green curry"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="r-link">Link (optional)</label>
          <div className="link-row">
            <input
              id="r-link"
              type="url"
              placeholder="https://…"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
            <button
              type="button"
              className="btn-secondary link-fetch"
              onClick={fetchFromLink}
              disabled={scraping || busy || !link.trim()}
              title="Pull ingredients from the link automatically"
            >
              {scraping ? "Fetching…" : "Fetch"}
            </button>
          </div>
        </div>

        <div className="field">
          <label htmlFor="r-desc">Description / notes (optional)</label>
          <textarea
            id="r-desc"
            className="textarea"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Method notes, tweaks, who likes what…"
          />
        </div>

        <div className="field">
          <label>Ingredients</label>
          <IngredientList
            value={ingredients}
            onChange={setIngredients}
            categories={categories}
            fridgeItems={fridgeItems}
          />
        </div>

        <div className="recipe-actions-row">
          <button
            type="button"
            className={`btn-secondary${isFavorited ? " is-favorited" : ""}`}
            onClick={toggleFavorite}
            disabled={busy || !name.trim()}
            aria-pressed={isFavorited}
            title={
              isFavorited
                ? "Remove this recipe from favorites"
                : "Save this recipe to favorites"
            }
          >
            {isFavorited ? "★ Favorited" : "☆ Favorite"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={addToGrocery}
            disabled={busy || ingredients.length === 0}
            title="Add ingredients to the grocery list"
          >
            Add to grocery
          </button>
        </div>

        <div className="modal-actions">
          {editing ? (
            <button
              type="button"
              className="btn-danger"
              onClick={del}
              disabled={busy}
            >
              Delete
            </button>
          ) : (
            <div />
          )}
          <div className="right">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ background: "var(--accent)", color: "white" }}
              onClick={save}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
