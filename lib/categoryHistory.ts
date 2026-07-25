/**
 * Server-side helper that assembles the weighted category history used to
 * auto-categorize incoming ingredient names. Shared by the recipe scrape
 * route and the paste-ingredients route so both make identical guesses.
 *
 * Weighting: explicitly reviewed inventory/grocery labels carry the most
 * trust; legacy/automatic stored labels are weaker; saved recipe categories
 * are weakest because they may have originated from this same auto-guesser.
 */

import {
  storedCategoryWeight,
  type CategoryHistoryEntry,
} from "./guessCategory";
import {
  listCategoriesRepo,
  listFavoritesRepo,
  listGroceryRepo,
  listItemsRepo,
  listRecipesRepo,
} from "./repo";

export type CategoryContext = {
  history: CategoryHistoryEntry[];
  validCategories: string[];
};

export async function loadCategoryContext(): Promise<CategoryContext> {
  const [items, grocery, recipes, favorites, categoryDefs] = await Promise.all([
    listItemsRepo(),
    listGroceryRepo(),
    listRecipesRepo(),
    listFavoritesRepo(),
    listCategoriesRepo(),
  ]);

  const history: CategoryHistoryEntry[] = [];
  for (const it of items) {
    history.push({
      name: it.name,
      category: it.category,
      weight: storedCategoryWeight(it.categoryReviewed),
    });
  }
  for (const g of grocery) {
    history.push({
      name: g.name,
      category: g.category,
      weight: storedCategoryWeight(g.categoryReviewed),
    });
  }
  for (const r of recipes) {
    for (const ing of r.ingredients) {
      history.push({
        name: ing.name,
        category: ing.category,
        weight: ing.categoryReviewed ? 1.5 : 0.25,
      });
    }
  }
  for (const f of favorites) {
    for (const ing of f.ingredients) {
      history.push({
        name: ing.name,
        category: ing.category,
        weight: ing.categoryReviewed ? 1.5 : 0.25,
      });
    }
  }

  // Deterministic order so equal-weight conflicts resolve the same way on
  // every request regardless of row-return order.
  history.sort(
    (a, b) =>
      (b.weight ?? 1) - (a.weight ?? 1) ||
      a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
      a.category.localeCompare(b.category, "en", { sensitivity: "base" })
  );

  return { history, validCategories: categoryDefs.map((c) => c.name) };
}
