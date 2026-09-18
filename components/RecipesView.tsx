"use client";

import { useState, type ReactNode } from "react";
import { DndContext, DragOverlay, useDroppable } from "@dnd-kit/core";
import AddRecipeToGroceryModal from "@/components/AddRecipeToGroceryModal";
import FavoritesModal from "@/components/FavoritesModal";
import MoveHandle from "@/components/MoveHandle";
import RecipeArchiveModal from "@/components/RecipeArchiveModal";
import RecipeCard, { type Props as RecipeCardProps } from "@/components/RecipeCard";
import RecipeModal, { type RecipeFields } from "@/components/RecipeModal";
import type { ToastAction } from "@/components/Toast";
import { COOKING_DAYS } from "@/lib/dates";
import { isFavoriteMatch } from "@/lib/favoriteMatch";
import { useRecipeWeeks } from "@/lib/useRecipeWeeks";
import {
  dishLabel,
  moveCollisionDetection,
  slotDropId,
  useMoveSensors,
  useRecipeMoves,
  type MoveTarget,
} from "@/lib/useRecipeMoves";
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
  /** The shell's one toast slot; an action turns it into the Undo toast. */
  onToast: (msg: string, action?: ToastAction) => void;
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

/** What a day is to a move in progress: nothing, the card being moved, or a landing place. */
type MoveState = "idle" | "moving" | "target";

/**
 * A card that can also be dropped on. The droppable hook has to live in its
 * own component: there is one per day, and hooks cannot be called in a loop.
 */
function SlotCard({
  state,
  onDrop,
  handle,
  ...card
}: RecipeCardProps & {
  state: MoveState;
  onDrop: () => void;
  handle: ReactNode;
}) {
  // Registered whether or not a move is in progress: dnd-kit measures the
  // droppables when the drag starts, and one that was disabled at that
  // moment never gets a rect, so nothing could be dropped on it.
  const { setNodeRef, isOver } = useDroppable({
    id: slotDropId(card.weekStart, card.day),
    data: { weekStart: card.weekStart, day: card.day },
  });
  return (
    <RecipeCard
      {...card}
      move={{
        dropRef: setNodeRef,
        isOver,
        isMoving: state === "moving",
        isTarget: state === "target",
        onDrop,
        handle,
      }}
    />
  );
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

  const moves = useRecipeMoves({ recipes, onRecipesChange, onToast });
  const sensors = useMoveSensors();

  /** How a day reads while a card is in the air. */
  function moveState(weekStart: string, day: number): MoveState {
    if (!moves.moving) return "idle";
    return moves.moving.weekStart === weekStart && moves.moving.day === day
      ? "moving"
      : "target";
  }

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
    <DndContext
      sensors={sensors}
      collisionDetection={moveCollisionDetection}
      onDragStart={(e) => moves.startDrag(String(e.active.id))}
      onDragCancel={moves.cancel}
      onDragEnd={(e) => {
        const target = e.over?.data.current as MoveTarget | undefined;
        if (target) moves.moveTo(String(e.active.id), target);
        else moves.cancel();
      }}
    >
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

      {moves.moving && !moves.dragging ? (
        <div className="recipe-move-bar">
          <span>Moving {dishLabel(moves.moving)}, tap a day</span>
          <button
            type="button"
            className="btn-secondary"
            onClick={moves.cancel}
          >
            Cancel
          </button>
        </div>
      ) : null}

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
                    <SlotCard
                      key={`${weekStart}-${d}`}
                      state={moveState(weekStart, d)}
                      onDrop={() => moves.dropOn({ weekStart, day: d })}
                      handle={
                        recipe ? (
                          <MoveHandle
                            id={recipe.id}
                            slot={{ weekStart, day: d }}
                            label={recipe.noMeal ? "Move" : `Move ${recipe.name}`}
                            className="recipe-move-handle"
                            disabled={moves.busy}
                            onPick={() => moves.pickUp(recipe.id)}
                          >
                            <span aria-hidden="true">⠿</span>
                          </MoveHandle>
                        ) : null
                      }
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
            if (next) onRecipesChange(next);
            onToast(msg);
          }}
          onError={(msg) => onToast("Error: " + msg)}
          onOpenAddToGrocery={setAddingToGrocery}
          occupantAt={(weekStart, day) =>
            recipesByWeek.get(weekStart)?.get(day) ?? null
          }
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

      <DragOverlay dropAnimation={null}>
        {moves.moving ? (
          <div className="recipe-move-ghost">{dishLabel(moves.moving)}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
