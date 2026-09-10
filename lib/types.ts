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
  categoryReviewed: boolean;
  // Member name when the item is somebody's personal food; "" when shared.
  owner: string;
};

export const BUYERS = ["Arthur", "Daniel", "Eli", "Ibrahim", "Minh"] as const;
export type Buyer = (typeof BUYERS)[number];

export function isBuyer(name: string): name is Buyer {
  return (BUYERS as readonly string[]).includes(name);
}

/**
 * Which pool a grocery request belongs to. Drives merge scoping on add,
 * the default expense split when the trip is logged, and the owner an item
 * gets when it moves into inventory.
 */
export const GROCERY_POOLS = ["house", "meals", "personal"] as const;
export type GroceryPool = (typeof GROCERY_POOLS)[number];

/** Current meal-sharing members. Stored under household_settings.meal_group. */
export type MealGroup = { members: string[] };
export const MEAL_GROUP_KEY = "meal_group";

export type GroceryItem = {
  id: string;
  name: string;
  quantity: number;
  category: Category;
  categoryReviewed: boolean;
  store: string;
  addedBy: string;
  pool: GroceryPool;
  done: boolean;
  added: string;
};

export type SortMode = "newest" | "name" | "quantity" | "expiry";

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
  categoryReviewed?: boolean;
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
  // Base servings the ingredient grams were written for (0 = unknown).
  servings: number;
  // How many portions are being cooked this time (0 = not set).
  portions: number;
  // True marks a day with no shared dinner. Name/cook/ingredients are empty.
  noMeal: boolean;
};

export type FavoriteRecipe = {
  id: string;
  name: string;
  link: string;
  description: string;
  ingredients: RecipeIngredient[];
  servings: number;
};

export type ListRecipesResponse = ApiOk<{ recipes: Recipe[] }>;
export type RecipeMutateResponse = ApiOk<{ recipes: Recipe[] }>;
export type ListFavoritesResponse = ApiOk<{ favorites: FavoriteRecipe[] }>;
export type FavoritesMutateResponse = ApiOk<{ favorites: FavoriteRecipe[] }>;
export type AddFavoriteResponse = ApiOk<{
  favorites: FavoriteRecipe[];
  existed?: boolean;
}>;

export const ALLOCATION_KINDS = ["house", "meals", "personal", "custom"] as const;
export type AllocationKind = (typeof ALLOCATION_KINDS)[number];

/**
 * One line of a receipt: how much, and who it was for. `splitAmong` is a
 * snapshot of member names taken when the expense was saved, so changing
 * the meal group later never rewrites a settled month. `personal` lines
 * are the payer's own items on a shared receipt: `splitAmong` is empty and
 * the line is excluded from settlement.
 */
export type ExpenseAllocation = {
  kind: AllocationKind;
  amountCents: number;
  splitAmong: string[];
};

export type Expense = {
  id: string;
  name: string;
  amountCents: number;
  category: Category;
  store: string;
  paidBy: string;
  // Always at least one line; sums to amountCents. Legacy rows come back as
  // a single "house" line over all members.
  allocations: ExpenseAllocation[];
  // YYYY-MM-DD — the date the user said the expense happened. Falls back to
  // `added` when missing (legacy rows).
  occurredOn: string;
  // Optional free-text qualifier shown next to the store in the monthly view
  // (e.g. "Gas" → "Costco (Gas)"). Also used as a secondary grouping key.
  description: string;
  // Receipt attachment metadata. All three are empty strings when no receipt
  // is on file (legacy rows pre-feature, or rows the upload errored on).
  receiptUrl: string;
  receiptFileId: string;
  receiptMime: string;
  added: string;
};

export type ExpenseCategoryDef = {
  name: Category;
  color: string | null;
};

export type SharedFieldKind = "text" | "password" | "image";

export type SharedAccountField = {
  id: string;
  label: string;
  kind: SharedFieldKind;
  value: string;
  filename?: string;
  mimeType?: string;
};

export type SharedAccount = {
  id: string;
  name: string;
  fields: SharedAccountField[];
  createdAt: string;
  updatedAt: string;
};

export type ListExpensesResponse = ApiOk<{ expenses: Expense[] }>;
export type ExpenseMutateResponse = ApiOk<{ expenses: Expense[] }>;
export type ListExpenseCategoriesResponse = ApiOk<{
  expenseCategories: ExpenseCategoryDef[];
}>;
export type AddExpenseCategoryResponse = ApiOk<{
  expenseCategories: ExpenseCategoryDef[];
  existed?: boolean;
}>;
export type UpdateExpenseCategoryResponse = ApiOk<{
  expenseCategories: ExpenseCategoryDef[];
}>;
export type DeleteExpenseCategoryResponse = ApiOk<{
  expenseCategories: ExpenseCategoryDef[];
  expenses: Expense[];
  reassigned: number;
}>;
export type ListSharedAccountsResponse = ApiOk<{
  accounts: SharedAccount[];
}>;
export type AddSharedAccountResponse = ApiOk<{
  accounts: SharedAccount[];
  account: SharedAccount;
}>;
export type GetSharedAccountResponse = ApiOk<{
  account: SharedAccount;
}>;
export type SharedAccountsMutateResponse = ApiOk<{
  accounts: SharedAccount[];
}>;
