"use client";

import { useState } from "react";
import ModalFrame from "@/components/ModalFrame";
import PersonPicker from "@/components/PersonPicker";
import {
  addFavorite,
  addRecipe,
  deleteFavorite,
  deleteRecipe,
  moveRecipe,
  parseIngredientsFromText,
  ROW_GONE_MESSAGE,
  scrapeRecipeFromUrl,
  updateRecipe,
} from "@/lib/client";
import {
  type CategoryDef,
  type FavoriteRecipe,
  type Recipe,
  type RecipeIngredient,
} from "@/lib/types";
import { COOKING_DAYS, DAY_LONG, shortDayLabel } from "@/lib/dates";
import { findFavoriteMatch, isFavoriteMatch } from "@/lib/favoriteMatch";
import IngredientList from "./IngredientList";

/**
 * How the server turns down a day that is already planned. A save that hits
 * this is offered as a swap instead of dead-ending on the error.
 */
const SLOT_TAKEN = /already has a recipe/i;

/** How the dinner in the way is named in the confirm and the toast. */
function occupantLabel(occupant: Recipe | null): string {
  if (!occupant) return "the dinner already on that day";
  if (occupant.noMeal) return "the no-meal day";
  return `"${occupant.name}"`;
}

/** Reads a small count field. Blank or junk means "not set" (0). */
function countOf(text: string): number {
  const n = Math.round(Number(text.trim()));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export type RecipeFields = {
  weekStart: string;
  day: number;
  assignedTo: string;
  name: string;
  link: string;
  description: string;
  ingredients: RecipeIngredient[];
  // Servings the ingredient weights were written for (0 = unknown).
  servings: number;
  // Portions being cooked this time (0 = not set).
  portions: number;
};

type Props = {
  mode: "new" | "edit";
  recipeId?: string;
  initial: RecipeFields;
  categories: CategoryDef[];
  fridgeItems: import("@/lib/types").Item[];
  // Effective meal group, already falling back to everyone when unset.
  mealGroup: string[];
  // The two weeks currently visible (this week, next week). The user can
  // move/place a recipe in either of these slots from inside the modal.
  weekOptions: { weekStart: string; label: string }[];
  // Lets the modal show the correct star state and route the toggle without
  // duplicating the matching logic that already lives in RecipesView.
  favorites: FavoriteRecipe[];
  onFavoritesChange: (favorites: FavoriteRecipe[]) => void;
  onClose: () => void;
  /**
   * `recipes` is the household's new recipe list, or null when this result
   * is only a toast and the list has not changed. Deleting the last recipe
   * legitimately returns an empty list, so "empty" cannot mean "no change".
   */
  onResult: (recipes: Recipe[] | null, toast: string) => void;
  onError: (msg: string) => void;
  /**
   * What is already planned on a (week, day), so a refused day change can
   * name the dinner it collided with and offer to swap with it.
   */
  occupantAt?: (weekStart: string, day: number) => Recipe | null;
  // Hands the in-memory ingredient state to the picker so it works for both
  // saved and draft recipes.
  onOpenAddToGrocery: (data: {
    recipeName: string;
    ingredients: RecipeIngredient[];
    defaultAddedBy: string;
    servings: number;
    portions: number;
    onCategoriesReviewed: (ingredients: RecipeIngredient[]) => void;
  }) => void;
};

export default function RecipeModal({
  mode,
  recipeId,
  initial,
  categories,
  fridgeItems,
  mealGroup,
  weekOptions,
  favorites,
  onFavoritesChange,
  onClose,
  onResult,
  onError,
  occupantAt,
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
  const [servings, setServings] = useState<string>(
    initial.servings > 0 ? String(initial.servings) : ""
  );
  const [portions, setPortions] = useState<string>(
    initial.portions > 0 ? String(initial.portions) : ""
  );
  const [busy, setBusy] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasting, setPasting] = useState(false);

  // Append rather than replace so a user mid-edit doesn't lose what they've
  // manually entered. Dedupe by case-insensitive name so a second fetch
  // (e.g. user re-pastes the URL) doesn't double up.
  function mergeIngredients(incoming: RecipeIngredient[]) {
    if (incoming.length === 0) return;
    setIngredients((prev) => {
      const seen = new Set(prev.map((p) => p.name.toLowerCase()));
      const next = [...prev];
      for (const ing of incoming) {
        if (!seen.has(ing.name.toLowerCase())) {
          next.push(ing);
          seen.add(ing.name.toLowerCase());
        }
      }
      return next;
    });
  }

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
      // `servings` is newer than this client's response type — read it
      // defensively so an older API just leaves the field blank.
      const scraped = Number((data as { servings?: unknown }).servings ?? 0);
      if (!servings.trim() && Number.isFinite(scraped) && scraped > 0) {
        setServings(String(Math.round(scraped)));
      }
      mergeIngredients(data.ingredients);
      if (data.ingredients.length === 0) {
        // Page loaded but had no usable ingredient data — steer straight to
        // the manual fallback instead of a dead-end "0 ingredients" toast.
        setShowPaste(true);
        onResult(
          null,
          "No ingredients found on the page. Paste them below instead"
        );
        return;
      }
      const summary = `Fetched ${data.ingredients.length} ingredient${data.ingredients.length === 1 ? "" : "s"}`;
      onResult(
        null,
        data.hasApproximate
          ? `${summary} (some quantities are estimates, double-check)`
          : summary
      );
    } catch (err) {
      // Most scrape errors ("site is blocking…") point at the paste
      // fallback — open it so the fix is one paste away.
      setShowPaste(true);
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setScraping(false);
    }
  }

  async function parsePasted() {
    const trimmed = pasteText.trim();
    if (!trimmed) {
      onError("Paste some ingredients first");
      return;
    }
    setPasting(true);
    try {
      const data = await parseIngredientsFromText(trimmed);
      mergeIngredients(data.ingredients);
      setPasteText("");
      setShowPaste(false);
      const parts = [
        `Added ${data.ingredients.length} ingredient${data.ingredients.length === 1 ? "" : "s"}`,
      ];
      if (data.skipped > 0) {
        parts.push(`${data.skipped} line${data.skipped === 1 ? "" : "s"} skipped`);
      }
      if (data.hasApproximate) parts.push("some quantities are estimates, double-check");
      if (data.note) parts.push(data.note);
      onResult(null, parts.join(". "));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setPasting(false);
    }
  }

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
    const servingsNum = countOf(servings);
    const portionsNum = countOf(portions);
    setBusy(true);
    try {
      if (editing && recipeId) {
        const id = recipeId;
        const fields = {
          name: trimmed,
          assignedTo,
          link,
          description,
          ingredients,
          servings: servingsNum,
          portions: portionsNum,
        };

        // The typed edits go first, on the day the recipe still occupies: if
        // the swap then fails, what the user wrote is already saved and only
        // the day is left to retry. The other order would throw those edits
        // away if the save after a successful swap failed.
        const swapInto = async (occupant: Recipe | null) => {
          const saved = await updateRecipe(id, fields);
          if (saved.gone) {
            onResult(saved.recipes, ROW_GONE_MESSAGE);
            return;
          }
          const swapped = await moveRecipe(id, { weekStart, day });
          onResult(swapped.recipes, `Swapped with ${occupantLabel(occupant)}`);
        };

        const slotChanged =
          day !== initial.day || weekStart !== initial.weekStart;
        // What is already on the landing day decides how the day change is
        // written, and the client decides it because the server cannot: a
        // plain PATCH carrying the new day replaces whatever sits there, and
        // for a no-meal marker "replaces" means the marker is gone, with no
        // swap offered and nothing to undo. Only a free day may be saved that
        // way. A row that has drifted onto the landing day since the modal
        // opened but is this same recipe is not in anybody's way.
        const occupant = slotChanged
          ? (occupantAt?.(weekStart, day) ?? null)
          : null;
        const inTheWay = occupant && occupant.id !== id ? occupant : null;

        if (inTheWay) {
          // A planned dinner is a trade the user has to agree to. A marker is
          // not: it is not destroyed, it takes the day being vacated.
          if (
            !inTheWay.noMeal &&
            !confirm(`Swap with ${occupantLabel(inTheWay)}?`)
          ) {
            return;
          }
          await swapInto(inTheWay);
        } else {
          try {
            const res = await updateRecipe(id, { ...fields, day, weekStart });
            onResult(res.recipes, res.gone ? ROW_GONE_MESSAGE : "Saved");
          } catch (err) {
            // Safety net for a race: the day was free when this modal last
            // looked at the list and somebody planned it in the meantime.
            // The save was refused whole, so nothing has been written yet.
            const msg = err instanceof Error ? err.message : String(err);
            if (!slotChanged || !SLOT_TAKEN.test(msg)) throw err;
            const raced = occupantAt?.(weekStart, day) ?? null;
            if (!confirm(`Swap with ${occupantLabel(raced)}?`)) return;
            await swapInto(raced);
          }
        }
      } else {
        const res = await addRecipe({
          weekStart,
          day,
          assignedTo,
          name: trimmed,
          link: link || undefined,
          description: description || undefined,
          ingredients,
          servings: servingsNum,
          portions: portionsNum,
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
          onResult(null, `Removed "${trimmed}" from favorites`);
        }
      } else {
        const servingsNum = countOf(servings);
        const res = await addFavorite({
          name: trimmed,
          link: link || undefined,
          description: description || undefined,
          ingredients,
          // The ingredient weights are written for this many people; without
          // it the favorite can never be scaled when it is cooked again.
          servings: servingsNum > 0 ? servingsNum : undefined,
        });
        onFavoritesChange(res.favorites);
        onResult(
          null,
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
      servings: countOf(servings),
      portions: countOf(portions),
      onCategoriesReviewed: setIngredients,
    });
  }

  // Cooks come from the meal group, but an existing recipe's cook stays
  // selectable so editing it never silently reassigns the dinner.
  const cookOptions =
    !initial.assignedTo || mealGroup.includes(initial.assignedTo)
      ? mealGroup
      : [...mealGroup, initial.assignedTo];

  const label = weekStart ? shortDayLabel(weekStart, day) : DAY_LONG[day];

  return (
    <ModalFrame
      title={editing ? "Edit recipe" : "Add recipe"}
      subtitle={label}
      size="wide"
      onClose={onClose}
      actions={
        <>
          {editing ? (
            <button
              type="button"
              className="btn-danger"
              onClick={del}
              disabled={busy || scraping || pasting}
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
              className="btn-accent"
              onClick={save}
              disabled={busy || scraping || pasting}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      }
    >
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
            {COOKING_DAYS.map((d) => (
              <option key={d} value={d}>
                {DAY_LONG[d]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <PersonPicker
        id="r-who"
        label="Cook"
        value={assignedTo}
        onChange={setAssignedTo}
        emptyLabel="Pick a cook…"
        people={cookOptions}
      />

      <div className="field-row">
        <div className="field">
          <label htmlFor="r-servings">Recipe serves</label>
          <input
            id="r-servings"
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="e.g. 4"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="r-portions">Cooking for</label>
          <input
            id="r-portions"
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="e.g. 3"
            value={portions}
            onChange={(e) => setPortions(e.target.value)}
          />
        </div>
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
          <button
            type="button"
            className="btn-secondary link-fetch"
            onClick={() => setShowPaste((v) => !v)}
            disabled={scraping || busy}
            aria-expanded={showPaste}
            title="Paste an ingredient list copied from anywhere"
          >
            Paste
          </button>
        </div>
      </div>

      {showPaste ? (
        <div className="field">
          <label htmlFor="r-paste">
            Pasted ingredients (one per line)
          </label>
          <textarea
            id="r-paste"
            className="textarea"
            rows={5}
            placeholder={"2 tbsp olive oil\n500g chicken thighs\n1 large onion"}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <div className="link-row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn-secondary link-fetch"
              onClick={parsePasted}
              disabled={pasting || busy || !pasteText.trim()}
            >
              {pasting ? "Parsing…" : "Add to ingredients"}
            </button>
          </div>
        </div>
      ) : null}

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
          <span className="btn-emoji" aria-hidden="true">{isFavorited ? "★ " : "☆ "}</span>
          {isFavorited ? "Favorited" : "Favorite"}
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
    </ModalFrame>
  );
}
