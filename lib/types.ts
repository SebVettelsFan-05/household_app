export type Category = string;

export const FALLBACK_CATEGORY: Category = "Other";

export type CategoryDef = {
  name: Category;
  color: string | null;
};

export type Item = {
  id: string;
  name: string;
  quantity: number;
  expiry: string;
  added: string;
  category: Category;
};

export const BUYERS = ["Minh", "Arthur", "Ibrahim", "Daniel", "Eli"] as const;
export type Buyer = (typeof BUYERS)[number];

export type GroceryItem = {
  id: string;
  name: string;
  quantity: number;
  category: Category;
  store: string;
  addedBy: string;
  done: boolean;
  added: string;
};

export type SortMode = "newest" | "name" | "quantity" | "expiry";
export type FilterCat = "all" | Category;

export type ApiOk<T = unknown> = { ok: true } & T;
export type ApiErr = { ok: false; error: string };
export type ApiResponse<T = unknown> = ApiOk<T> | ApiErr;

export type ListResponse = ApiOk<{ items: Item[] }>;
export type AddResponse = ApiOk<{
  items: Item[];
  merged?: boolean;
  mergedInto?: string;
  addedQty?: number;
}>;
export type MutateResponse = ApiOk<{ items: Item[] }>;

export type ListCategoriesResponse = ApiOk<{ categories: CategoryDef[] }>;
export type AddCategoryResponse = ApiOk<{
  categories: CategoryDef[];
  existed?: boolean;
}>;
export type UpdateCategoryResponse = ApiOk<{ categories: CategoryDef[] }>;
export type DeleteCategoryResponse = ApiOk<{
  categories: CategoryDef[];
  items: Item[];
  reassigned: number;
}>;

export type ListGroceryResponse = ApiOk<{ grocery: GroceryItem[] }>;
export type GroceryMutateResponse = ApiOk<{ grocery: GroceryItem[] }>;

export type RecipeIngredient = {
  name: string;
  quantity: number;
  category: Category;
};

export type Recipe = {
  id: string;
  weekStart: string;
  day: number;
  assignedTo: string;
  name: string;
  link: string;
  description: string;
  ingredients: RecipeIngredient[];
};

export type FavoriteRecipe = {
  id: string;
  name: string;
  link: string;
  description: string;
  ingredients: RecipeIngredient[];
};

export type ListRecipesResponse = ApiOk<{ recipes: Recipe[] }>;
export type RecipeMutateResponse = ApiOk<{ recipes: Recipe[] }>;
export type ListFavoritesResponse = ApiOk<{ favorites: FavoriteRecipe[] }>;
export type FavoritesMutateResponse = ApiOk<{ favorites: FavoriteRecipe[] }>;
