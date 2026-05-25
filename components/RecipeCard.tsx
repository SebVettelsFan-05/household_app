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
};

export default function RecipeCard({
  weekStart,
  day,
  recipe,
  favorited,
  favBusy,
  onToggleFavorite,
  onClick,
}: Props) {
  const label = shortDayLabel(weekStart, day);

  if (!recipe) {
    return (
      <button type="button" className="recipe-card empty-slot" onClick={onClick}>
        <div className="recipe-day-label">{label}</div>
        <div className="recipe-empty-cta">+ Add recipe</div>
      </button>
    );
  }

  return (
    <div className="recipe-card-wrap">
      <button type="button" className="recipe-card" onClick={onClick}>
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
      </button>
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
