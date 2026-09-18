"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DndContext, DragOverlay, useDroppable } from "@dnd-kit/core";
import type { RecipeSlot } from "@/components/fresh/FreshApp";
import { Avatar, personColor } from "@/components/fresh/people";
import {
  IconArchive,
  IconLink,
  IconMove,
  IconStar,
} from "@/components/fresh/icons";
import AddRecipeToGroceryModal from "@/components/AddRecipeToGroceryModal";
import FavoritesModal from "@/components/FavoritesModal";
import MoveHandle from "@/components/MoveHandle";
import RecipeArchiveModal from "@/components/RecipeArchiveModal";
import RecipeModal, { type RecipeFields } from "@/components/RecipeModal";
import { cookCounts } from "@/lib/cookCounts";
import {
  COOKING_DAYS,
  DAY_LONG,
  addDays,
  parseYmd,
  shortDayLabel,
  todayCookingDay,
} from "@/lib/dates";
import { useHouseholdToday } from "@/lib/useHouseholdToday";
import type { FavoriteRecipe, Recipe, RecipeIngredient } from "@/lib/types";
import { useRecipeWeeks } from "@/lib/useRecipeWeeks";
import {
  dishLabel,
  moveCollisionDetection,
  slotDropId,
  stripDropId,
  useMoveSensors,
  useRecipeMoves,
  type MoveTarget,
} from "@/lib/useRecipeMoves";
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

type GroceryPush = {
  recipeName: string;
  ingredients: RecipeIngredient[];
  defaultAddedBy: string;
  servings: number;
  portions: number;
  onCategoriesReviewed: (ingredients: RecipeIngredient[]) => void;
};

/** S M T W T F S, one letter per column of the week strip. */
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"] as const;

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

function dateNumber(weekStart: string, day: number): number {
  return addDays(parseYmd(weekStart), day).getDate();
}

/** What a day is to a move in progress: nothing, the card being moved, or a landing place. */
type MoveState = "idle" | "moving" | "target";

/**
 * One day of the list, wrapped so a move can land on it. While another card
 * is in the air the whole day is covered by a single button, which is what
 * makes it one tap target for a finger and one stop for the keyboard.
 */
function DaySlot({
  weekStart,
  day,
  state,
  onDrop,
  children,
}: {
  weekStart: string;
  day: number;
  state: MoveState;
  onDrop: () => void;
  children: ReactNode;
}) {
  // Registered whether or not a move is in progress: dnd-kit measures the
  // droppables when the drag starts, and one that was disabled at that
  // moment never gets a rect, so nothing could be dropped on it.
  const { setNodeRef, isOver } = useDroppable({
    id: slotDropId(weekStart, day),
    data: { weekStart, day },
  });
  return (
    <div
      ref={setNodeRef}
      data-week={weekStart}
      data-day={day}
      className={`fresh-day-slot${state === "moving" ? " is-moving" : ""}${
        state === "target" ? " is-target" : ""
      }${isOver ? " is-over" : ""}`}
    >
      {children}
      {state === "target" ? (
        <button
          type="button"
          className="fresh-move-target"
          onClick={onDrop}
          aria-label={`Move to ${shortDayLabel(weekStart, day)}`}
        />
      ) : null}
    </div>
  );
}

/** One cell of the 7-day strip, and a drop target while a card is in the air. */
function StripDay({
  variant,
  weekStart,
  day,
  isToday,
  planned,
  noMeal,
  target,
  onSelect,
}: {
  variant: "phone" | "column";
  weekStart: string;
  day: number;
  isToday: boolean;
  planned: Recipe | null;
  noMeal: boolean;
  target: boolean;
  onSelect: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: stripDropId(variant, weekStart, day),
    data: { weekStart, day },
  });
  const label = `${DAY_LONG[day]} ${dateNumber(weekStart, day)}`;
  return (
    <button
      ref={setNodeRef}
      type="button"
      data-week={weekStart}
      data-day={day}
      className={`fresh-strip-day${isToday ? " today" : ""}${
        target ? " is-target" : ""
      }${isOver ? " is-over" : ""}`}
      onClick={onSelect}
      aria-label={target ? `Move to ${label}` : label}
    >
      <span className="fresh-strip-letter">{DAY_LETTERS[day]}</span>
      <span className="fresh-strip-num">{dateNumber(weekStart, day)}</span>
      <span
        className={`fresh-strip-dot${planned ? " filled" : noMeal ? " hollow" : ""}`}
        style={
          planned ? { background: personColor(planned.assignedTo) } : undefined
        }
      />
    </button>
  );
}

export default function FreshRecipes({
  data,
  mealGroup,
  openSlot,
  onOpenSlotHandled,
}: Props) {
  const [editing, setEditing] = useState<EditingState>(null);
  const [addingToGrocery, setAddingToGrocery] = useState<GroceryPush | null>(
    null
  );
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [activeWeek, setActiveWeek] = useState<0 | 1>(0);

  const today = useHouseholdToday();

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

  const moves = useRecipeMoves({
    recipes: data.recipes,
    onRecipesChange: data.setRecipes,
    onToast: data.showToast,
  });
  const sensors = useMoveSensors();

  /** How a day reads while a card is in the air. */
  function moveState(weekStart: string, day: number): MoveState {
    if (!moves.moving) return "idle";
    return moves.moving.weekStart === weekStart && moves.moving.day === day
      ? "moving"
      : "target";
  }

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

  function openSlotEditor(weekStart: string, day: number) {
    const existing = recipesByWeek.get(weekStart)?.get(day) ?? null;
    setEditing(
      existing && !existing.noMeal
        ? {
            mode: "edit",
            recipeId: existing.id,
            initial: recipeToFields(existing),
          }
        : { mode: "new", initial: blankFields(weekStart, day, mealGroup.length) }
    );
  }

  const weeks = [
    { label: "This week", weekStart: week1 },
    { label: "Next week", weekStart: week2 },
  ] as const;

  function weekStrip(weekStart: string, variant: "phone" | "column") {
    const todayIdx = todayCookingDay(weekStart, today);
    return (
      <div className={`fresh-strip fresh-strip-${variant}`}>
        {COOKING_DAYS.map((d) => {
          const recipe = recipesByWeek.get(weekStart)?.get(d) ?? null;
          const planned = recipe && !recipe.noMeal ? recipe : null;
          const target = moveState(weekStart, d) === "target";
          return (
            <StripDay
              key={d}
              variant={variant}
              weekStart={weekStart}
              day={d}
              isToday={d === todayIdx}
              planned={planned}
              noMeal={Boolean(recipe && recipe.noMeal)}
              target={target}
              onSelect={() =>
                target
                  ? moves.dropOn({ weekStart, day: d })
                  : openSlotEditor(weekStart, d)
              }
            />
          );
        })}
      </div>
    );
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
      <div className="fresh-seg fresh-seg-weeks" role="tablist" aria-label="Week">
        {weeks.map((w, i) => (
          <button
            key={w.weekStart}
            type="button"
            role="tab"
            aria-selected={activeWeek === i}
            className={`fresh-seg-btn${activeWeek === i ? " active" : ""}`}
            onClick={() => setActiveWeek(i as 0 | 1)}
          >
            {w.label}
          </button>
        ))}
      </div>

      {weekStrip(weeks[activeWeek].weekStart, "phone")}

      <div className="fresh-btn-row fresh-recipes-tools">
        <button type="button" className="fresh-btn" onClick={openFavorites}>
          <IconStar size={18} />
          Favorites
        </button>
        <button
          type="button"
          className="fresh-btn"
          onClick={() => setArchiveOpen(true)}
        >
          <IconArchive size={18} />
          Archive
        </button>
      </div>

      {moves.moving && !moves.dragging ? (
        <div className="fresh-move-bar">
          <span className="fresh-move-bar-text">
            Moving {dishLabel(moves.moving)}, tap a day
          </span>
          <button
            type="button"
            className="fresh-move-cancel"
            onClick={moves.cancel}
          >
            Cancel
          </button>
        </div>
      ) : null}

      {data.recipesLoading ? (
        <div>
          <div className="fresh-skel fresh-skel-card" />
          <div className="fresh-skel fresh-skel-card" />
        </div>
      ) : data.recipesError ? (
        <div className="fresh-error">
          Couldn&apos;t load recipes. {data.recipesError}
        </div>
      ) : (
        <div className="fresh-weeks">
          {weeks.map(({ label, weekStart }, i) => {
            const counts = cookCounts(
              data.recipes.filter((r) => r.weekStart === weekStart)
            );
            return (
              <section
                className="fresh-week"
                data-active={activeWeek === i}
                key={weekStart}
              >
                <div className="fresh-week-head">
                  <h2 className="fresh-h2">{label}</h2>
                  <div className="fresh-cook-tally">
                    {counts.length === 0 ? (
                      <span className="fresh-sub">No cooks yet</span>
                    ) : (
                      counts.map((c) => (
                        <span className="fresh-tally" key={c.name}>
                          <Avatar name={c.name} size={26} />
                          <span className="fresh-tally-count">{c.count}</span>
                          <span className="sr-only">
                            {c.name} {c.count}
                          </span>
                        </span>
                      ))
                    )}
                  </div>
                </div>

                {weekStrip(weekStart, "column")}

                <div className="fresh-days">
                  {COOKING_DAYS.map((d) => {
                    const recipe = recipesByWeek.get(weekStart)?.get(d) ?? null;
                    const [abbr, date] = shortDayLabel(weekStart, d).split(", ");
                    const key = `${weekStart}-${d}`;

                    const state = moveState(weekStart, d);
                    const slot = (content: ReactNode) => (
                      <DaySlot
                        key={key}
                        weekStart={weekStart}
                        day={d}
                        state={state}
                        onDrop={() => moves.dropOn({ weekStart, day: d })}
                      >
                        {content}
                      </DaySlot>
                    );

                    if (recipe && recipe.noMeal) {
                      return slot(
                        <div className="fresh-day-off">
                          <span className="fresh-day-when">
                            {abbr} {date}
                          </span>
                          <span className="fresh-day-off-text">
                            No dinner
                          </span>
                          <MoveHandle
                            id={recipe.id}
                            slot={{ weekStart, day: d }}
                            label="Move"
                            className="fresh-move-handle"
                            disabled={moves.busy}
                            onPick={() => moves.pickUp(recipe.id)}
                          >
                            <IconMove size={18} />
                          </MoveHandle>
                          <button
                            type="button"
                            className="fresh-text-btn"
                            onClick={() => openSlotEditor(weekStart, d)}
                          >
                            Plan
                          </button>
                          <button
                            type="button"
                            className="fresh-text-btn"
                            disabled={markerBusy}
                            onClick={() => removeNoMealMarker(recipe)}
                          >
                            Clear
                          </button>
                        </div>
                      );
                    }

                    if (!recipe) {
                      return slot(
                        <div className="fresh-day-empty">
                          <button
                            type="button"
                            className="fresh-day-add"
                            onClick={() => openSlotEditor(weekStart, d)}
                          >
                            <span className="fresh-day-when">
                              {abbr} {date}
                            </span>
                            <span className="fresh-day-add-text">
                              Add dinner
                            </span>
                          </button>
                          <button
                            type="button"
                            className="fresh-text-btn"
                            disabled={markerBusy}
                            onClick={() => addNoMealMarker(weekStart, d)}
                          >
                            No meal
                          </button>
                        </div>
                      );
                    }

                    return slot(
                      <article
                        className="fresh-day-card"
                        style={{
                          ["--cook" as string]: personColor(recipe.assignedTo),
                        }}
                      >
                        <button
                          type="button"
                          className="fresh-day-card-tap"
                          onClick={() =>
                            setEditing({
                              mode: "edit",
                              recipeId: recipe.id,
                              initial: recipeToFields(recipe),
                            })
                          }
                        >
                          <span className="fresh-day-when">
                            {abbr} {date}
                          </span>
                          <span className="fresh-day-dish">{recipe.name}</span>
                          <span className="fresh-day-meta">
                            {recipe.assignedTo ? (
                              <span className="fresh-person">
                                <Avatar name={recipe.assignedTo} size={24} />
                                <span className="fresh-person-name">
                                  {recipe.assignedTo}
                                </span>
                              </span>
                            ) : (
                              <span className="fresh-row-note">No cook</span>
                            )}
                            {recipe.portions > 0 ? (
                              <span className="fresh-pill-note">
                                {recipe.portions} portions
                              </span>
                            ) : null}
                            {recipe.ingredients.length > 0 ? (
                              <span className="fresh-pill-note">
                                {recipe.ingredients.length} ingredient
                                {recipe.ingredients.length === 1 ? "" : "s"}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        <MoveHandle
                          id={recipe.id}
                          slot={{ weekStart, day: d }}
                          label={`Move ${recipe.name}`}
                          className="fresh-move-handle"
                          disabled={moves.busy}
                          onPick={() => moves.pickUp(recipe.id)}
                        >
                          <IconMove size={18} />
                        </MoveHandle>
                        {recipe.link ? (
                          <div className="fresh-day-card-actions">
                            <a
                              className="fresh-day-card-link"
                              href={recipe.link}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <IconLink size={16} />
                              <span className="fresh-day-card-link-text">
                                {recipe.link.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48)}
                              </span>
                            </a>
                          </div>
                        ) : null}
                      </article>
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
            if (next) data.setRecipes(next);
            data.showToast(msg);
          }}
          onError={(msg) => data.showToast("Error: " + msg)}
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

      {/* Nothing here may depend on a transition: the overlay is a plain
          absolutely positioned copy that dnd-kit repositions per frame. */}
      <DragOverlay dropAnimation={null}>
        {moves.moving ? (
          <div className="fresh-move-ghost">{dishLabel(moves.moving)}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
