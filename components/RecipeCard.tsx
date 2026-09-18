"use client";

import type { ReactNode } from "react";
import type { Recipe } from "@/lib/types";
import { shortDayLabel } from "@/lib/dates";

/**
 * Everything this card needs to take part in a move: where to drop, whether
 * it is the card in the air or a day that could take it, and the grab handle
 * itself (owned by the view, which holds the drag context).
 */
export type RecipeMove = {
  dropRef: (el: HTMLElement | null) => void;
  isOver: boolean;
  isMoving: boolean;
  isTarget: boolean;
  onDrop: () => void;
  handle: ReactNode;
};

export type Props = {
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
  move?: RecipeMove;
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
  move,
}: Props) {
  const label = shortDayLabel(weekStart, day);

  // New class names only: the cards themselves are untouched, so the classic
  // look is the same one it always was when nothing is being moved.
  const hostClass = (base: string) =>
    `${base} recipe-move-host${move?.isMoving ? " is-moving" : ""}${
      move?.isTarget ? " is-target" : ""
    }${move?.isOver ? " is-over" : ""}`;

  // While another card is in the air, the whole slot is one button: one tap
  // target for a finger, one stop for the keyboard, and the click can never
  // reach what it covers.
  const dropTarget = move?.isTarget ? (
    <button
      type="button"
      className="recipe-move-target"
      onClick={move.onDrop}
      aria-label={`Move to ${label}`}
    />
  ) : null;

  if (!recipe) {
    return (
      <div
        className={hostClass("recipe-slot")}
        ref={move?.dropRef}
        data-week={weekStart}
        data-day={day}
      >
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
        {dropTarget}
      </div>
    );
  }

  if (recipe.noMeal) {
    return (
      <div
        className={hostClass("recipe-slot")}
        ref={move?.dropRef}
        data-week={weekStart}
        data-day={day}
      >
        {move?.handle}
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
        {dropTarget}
      </div>
    );
  }

  return (
    <div
      className={hostClass("recipe-card-wrap")}
      ref={move?.dropRef}
      data-week={weekStart}
      data-day={day}
    >
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
      {move?.handle}
      {dropTarget}
    </div>
  );
}
