"use client";

import type { Recipe } from "@/lib/types";
import { shortDayLabel } from "@/lib/dates";

type Props = {
  weekStart: string;
  day: number;
  recipe: Recipe | null;
  favorited?: boolean;
  favBusy?: boolean;
  onToggleFavorite?: () => void;
  onClick: () => void;
  // Marks the slot as having no shared dinner. Only on empty slots.
  onNoMeal?: () => void;
  // Marker actions: drop the marker and open a fresh recipe, or just drop it.
  onPlanMeal?: () => void;
  onClearNoMeal?: () => void;
  busy?: boolean;
};

export default function RecipeCard({
  weekStart,
  day,
  recipe,
  favorited,
  favBusy,
  onToggleFavorite,
  onClick,
  onNoMeal,
  onPlanMeal,
  onClearNoMeal,
  busy = false,
}: Props) {
  const label = shortDayLabel(weekStart, day);

  if (!recipe) {
    return (
      <div className="recipe-slot">
        <button
          type="button"
          className="recipe-card empty-slot"
          onClick={onClick}
        >
          <div className="recipe-day-label">{label}</div>
          <div className="recipe-empty-cta">+ Add recipe</div>
        </button>
        {onNoMeal ? (
          <div className="recipe-slot-actions">
            <button
              type="button"
              className="recipe-quiet-action"
              onClick={onNoMeal}
              disabled={busy}
            >
              No meal
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (recipe.noMeal) {
    return (
      <div className="recipe-slot">
        <div className="recipe-card no-meal-card">
          <div className="recipe-day-label">{label}</div>
          <div className="recipe-no-meal">No shared meal</div>
        </div>
        <div className="recipe-slot-actions">
          {onPlanMeal ? (
            <button
              type="button"
              className="recipe-quiet-action"
              onClick={onPlanMeal}
              disabled={busy}
            >
              Plan a meal
            </button>
          ) : null}
          {onClearNoMeal ? (
            <button
              type="button"
              className="recipe-quiet-action"
              onClick={onClearNoMeal}
              disabled={busy}
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="recipe-card-wrap">
      {/* div+role instead of <button> so the inner <a> stays valid HTML and
          actually navigates — nesting <a> in <button> silently blocks the
          click in most browsers. */}
      <div
        className="recipe-card"
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
      >
        <div className="recipe-card-head">
          <span className="recipe-day-label">{label}</span>
          <span className="recipe-cook">{recipe.assignedTo}</span>
        </div>
        <div className="recipe-name">{recipe.name}</div>
        {recipe.link ? (
          <div className="recipe-link" onClick={(e) => e.stopPropagation()}>
            <a href={recipe.link} target="_blank" rel="noopener noreferrer">
              {recipe.link.replace(/^https?:\/\//, "").slice(0, 60)}
            </a>
          </div>
        ) : null}
        {recipe.description ? (
          <div className="recipe-desc">{recipe.description}</div>
        ) : null}
        {recipe.ingredients.length > 0 ? (
          <div className="recipe-ingredients-summary">
            {recipe.ingredients.length} ingredient
            {recipe.ingredients.length === 1 ? "" : "s"}
          </div>
        ) : null}
      </div>
      {onToggleFavorite ? (
        <button
          type="button"
          className={`recipe-fav${favorited ? " on" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          disabled={favBusy}
          aria-pressed={favorited}
          aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
          title={favorited ? "Unfavorite" : "Favorite"}
        >
          {favorited ? "★" : "☆"}
        </button>
      ) : null}
    </div>
  );
}
