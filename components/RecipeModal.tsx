"use client";

import { useEffect, useState } from "react";
import {
  addFavorite,
  addRecipe,
  deleteRecipe,
  updateRecipe,
} from "@/lib/client";
import {
  BUYERS,
  type CategoryDef,
  type Recipe,
  type RecipeIngredient,
} from "@/lib/types";
import { DAY_LONG, shortDayLabel } from "@/lib/dates";
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
  onClose: () => void;
  onResult: (recipes: Recipe[], toast: string) => void;
  onError: (msg: string) => void;
  // Add-to-grocery only works on a saved recipe — modal asks the caller to
  // open the picker with the *current* (in-memory) state.
  onOpenAddToGrocery: (current: Recipe) => void;
};

export default function RecipeModal({
  mode,
  recipeId,
  initial,
  categories,
  onClose,
  onResult,
  onError,
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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
          weekStart: initial.weekStart,
        });
        onResult(res.recipes, "Saved");
      } else {
        const res = await addRecipe({
          weekStart: initial.weekStart,
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

  async function favorite() {
    const trimmed = name.trim();
    if (!trimmed) {
      onError("Recipe needs a name to favorite");
      return;
    }
    setBusy(true);
    try {
      await addFavorite({
        name: trimmed,
        link: link || undefined,
        description: description || undefined,
        ingredients,
      });
      onResult([], `Saved "${trimmed}" to favorites`);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function addToGrocery() {
    if (!recipeId) {
      onError("Save the recipe first, then add ingredients to the list");
      return;
    }
    if (ingredients.length === 0) {
      onError("Add some ingredients first");
      return;
    }
    onOpenAddToGrocery({
      id: recipeId,
      weekStart: initial.weekStart,
      day,
      assignedTo,
      name: name.trim() || initial.name,
      link,
      description,
      ingredients,
    });
  }

  const label = initial.weekStart
    ? shortDayLabel(initial.weekStart, day)
    : DAY_LONG[day];

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
          <input
            id="r-link"
            type="url"
            placeholder="https://…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
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
          />
        </div>

        <div className="recipe-actions-row">
          <button
            type="button"
            className="btn-secondary"
            onClick={favorite}
            disabled={busy || !name.trim()}
            title="Save this recipe to favorites"
          >
            ★ Favorite
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={addToGrocery}
            disabled={busy || ingredients.length === 0 || !editing}
            title={
              editing
                ? "Add ingredients to the grocery list"
                : "Save the recipe first"
            }
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
