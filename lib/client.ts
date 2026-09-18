import type {
  AddCategoryResponse,
  AddExpenseCategoryResponse,
  AddFavoriteResponse,
  AddResponse,
  AddSharedAccountResponse,
  ApiResponse,
  CategoryDef,
  DeleteCategoryResponse,
  DeleteExpenseCategoryResponse,
  Expense,
  ExpenseCategoryDef,
  ExpenseMutateResponse,
  FavoriteRecipe,
  FavoritesMutateResponse,
  GetSharedAccountResponse,
  GroceryItem,
  GroceryMutateResponse,
  Item,
  ListCategoriesResponse,
  ListExpenseCategoriesResponse,
  ListExpensesResponse,
  ListFavoritesResponse,
  ListGroceryResponse,
  ListRecipesResponse,
  ListResponse,
  MutateResponse,
  Recipe,
  RecipeIngredient,
  RecipeMutateResponse,
  SharedAccount,
  SharedAccountField,
  SharedAccountsMutateResponse,
  UpdateCategoryResponse,
  UpdateExpenseCategoryResponse,
  ListSharedAccountsResponse,
  AllocationKind,
  MealGroup,
} from "./types";
import { isBuyer, MEAL_GROUP_KEY } from "./types";

/** What every caller sees when the session has expired under them. */
export const SIGNED_OUT_MESSAGE = "Signed out — taking you to the sign-in page";

/**
 * A 401 means the cookie expired or was revoked while the app was open. Left
 * alone it surfaces as "HTTP 401" on a screen still showing yesterday's data,
 * so send the browser to the sign-in page with the screen it was on in `next`
 * and throw, rather than letting the caller render a half-failure.
 *
 * The login page itself calls no API, but guard the redirect anyway so a
 * future 401 from there cannot start a reload loop.
 */
function signOutIfUnauthorized(res: Response): void {
  if (res.status !== 401) return;
  if (
    typeof window !== "undefined" &&
    !window.location.pathname.startsWith("/login")
  ) {
    const next =
      window.location.pathname + window.location.search + window.location.hash;
    window.location.replace(`/login?next=${encodeURIComponent(next)}`);
  }
  throw new Error(SIGNED_OUT_MESSAGE);
}

async function parse<T>(res: Response): Promise<ApiResponse<T>> {
  signOutIfUnauthorized(res);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // fall through
  }
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body && body.error
        ? String(body.error)
        : `HTTP ${res.status}`;
    return { ok: false, error: msg };
  }
  if (body && typeof body === "object") return body as ApiResponse<T>;
  return { ok: false, error: "Bad JSON from server" };
}

function unwrap<T>(r: ApiResponse<T>): T {
  if (!r.ok) throw new Error(r.error || "Unknown error");
  return r;
}

/**
 * What the UI says when an edit lands on a row somebody else deleted first.
 *
 * A row can disappear under an open modal: another housemate deletes it, or
 * the same delete is sent twice from two devices. The server answers 404 for
 * both. A *delete* that 404s has already got what it asked for, so every
 * delete helper below re-reads the list and returns it as a success — the
 * modal closes and the ghost row goes with it, instead of dead-ending on
 * "Error: Not found" with the row still on screen. A *patch* genuinely did
 * not happen, so it comes back flagged `gone`: the caller shows this message
 * and closes with the refreshed list rather than pretending it saved.
 */
export const ROW_GONE_MESSAGE = "This row was already removed";

/* ----- items ----- */

export async function listItems(): Promise<Item[]> {
  const res = await fetch("/api/items", { cache: "no-store" });
  return unwrap(await parse<ListResponse>(res)).items;
}

export type AddInput = {
  name: string;
  quantity: number;
  expiry?: string;
  category?: string;
  categoryReviewed?: boolean;
};

export async function addItem(input: AddInput) {
  const res = await fetch("/api/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap(await parse<AddResponse>(res));
}

export type UpdateInput = AddInput & { id: string };

export async function updateItem(
  input: UpdateInput
): Promise<MutateResponse & { gone?: true }> {
  const res = await fetch("/api/items", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 404) return { ok: true, items: await listItems(), gone: true };
  return unwrap(await parse<MutateResponse>(res));
}

export async function deleteItem(id: string) {
  const res = await fetch(`/api/items?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (res.status === 404) return { ok: true as const, items: await listItems() };
  return unwrap(await parse<MutateResponse>(res));
}

/* ----- categories ----- */

export async function listCategories(): Promise<CategoryDef[]> {
  const res = await fetch("/api/categories", { cache: "no-store" });
  return unwrap(await parse<ListCategoriesResponse>(res)).categories;
}

export async function addCategory(name: string, color?: string | null) {
  const res = await fetch("/api/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color: color ?? null }),
  });
  return unwrap(await parse<AddCategoryResponse>(res));
}

export async function updateCategoryColor(name: string, color: string | null) {
  const res = await fetch("/api/categories", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color }),
  });
  return unwrap(await parse<UpdateCategoryResponse>(res));
}

/**
 * How much of the database a category is holding up. Read before the delete
 * confirm, because the modal only knows about the inventory rows it has
 * loaded — the grocery list and the recipe ingredient lists are reassigned
 * too, and used to be deleted without warning.
 */
export type CategoryUsage = {
  items: number;
  grocery: number;
  recipeIngredients: number;
  favoriteIngredients: number;
};

export async function getCategoryUsage(name: string): Promise<CategoryUsage> {
  const res = await fetch(
    `/api/categories/usage?name=${encodeURIComponent(name)}`,
    { cache: "no-store" }
  );
  return unwrap(await parse<{ usage: CategoryUsage }>(res)).usage;
}

export async function deleteCategory(name: string) {
  const res = await fetch(
    `/api/categories?name=${encodeURIComponent(name)}`,
    { method: "DELETE" }
  );
  if (res.status === 404) {
    return {
      ok: true as const,
      categories: await listCategories(),
      items: await listItems(),
      reassigned: 0,
    };
  }
  return unwrap(await parse<DeleteCategoryResponse>(res));
}

/* ----- grocery ----- */

export async function listGrocery(): Promise<GroceryItem[]> {
  const res = await fetch("/api/grocery", { cache: "no-store" });
  return unwrap(await parse<ListGroceryResponse>(res)).grocery;
}

export type AddGroceryInput = {
  name: string;
  quantity: number;
  category?: string;
  categoryReviewed?: boolean;
  store?: string;
  addedBy: string;
};

export async function addGrocery(input: AddGroceryInput) {
  const res = await fetch("/api/grocery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap(await parse<GroceryMutateResponse>(res));
}

export type UpdateGroceryInput = {
  id: string;
  name?: string;
  quantity?: number;
  category?: string;
  categoryReviewed?: boolean;
  store?: string;
  addedBy?: string;
  done?: boolean;
};

export async function updateGrocery(
  input: UpdateGroceryInput
): Promise<GroceryMutateResponse & { gone?: true }> {
  const res = await fetch("/api/grocery", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 404) {
    return { ok: true, grocery: await listGrocery(), gone: true };
  }
  return unwrap(await parse<GroceryMutateResponse>(res));
}

export async function deleteGrocery(id: string) {
  const res = await fetch(`/api/grocery?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (res.status === 404) {
    return { ok: true as const, grocery: await listGrocery() };
  }
  return unwrap(await parse<GroceryMutateResponse>(res));
}

export async function clearGrocery() {
  const res = await fetch("/api/grocery/clear", { method: "POST" });
  return unwrap(await parse<GroceryMutateResponse>(res));
}

type MoveDoneResponse = {
  ok: true;
  items: Item[];
  grocery: GroceryItem[];
  moved: number;
};

export async function moveDoneGroceryToInventory(): Promise<{
  items: Item[];
  grocery: GroceryItem[];
  moved: number;
}> {
  const res = await fetch("/api/grocery/move-done", { method: "POST" });
  signOutIfUnauthorized(res);
  const body = (await res.json().catch(() => null)) as
    | MoveDoneResponse
    | { ok: false; error: string }
    | null;
  if (!body || !body.ok) {
    throw new Error(
      (body && !body.ok && body.error) ||
        `Failed to move items (HTTP ${res.status})`
    );
  }
  return { items: body.items, grocery: body.grocery, moved: body.moved };
}

export type BulkGroceryInput = {
  items: Array<{
    name: string;
    quantity: number;
    category?: string;
    categoryReviewed?: boolean;
    store?: string;
    addedBy: string;
  }>;
};

export async function bulkAddGrocery(input: BulkGroceryInput) {
  const res = await fetch("/api/grocery/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap(await parse<GroceryMutateResponse>(res));
}

/* ----- recipes ----- */

export async function listRecipes(): Promise<Recipe[]> {
  const res = await fetch("/api/recipes", { cache: "no-store" });
  return unwrap(await parse<ListRecipesResponse>(res)).recipes;
}

export async function listArchivedRecipes(): Promise<Recipe[]> {
  const res = await fetch("/api/recipes/archive", { cache: "no-store" });
  return unwrap(await parse<ListRecipesResponse>(res)).recipes;
}

export type ProductScan = {
  name: string;
  brand: string;
  quantityGrams: number;
  category: string;
  barcode: string;
};

/**
 * Hits the Open Food Facts proxy. Returns null when the product isn't in
 * the database — caller falls back to plain manual entry.
 */
export async function lookupProductByBarcode(
  barcode: string
): Promise<ProductScan | null> {
  const res = await fetch(
    `/api/products/lookup?barcode=${encodeURIComponent(barcode)}`,
    { cache: "no-store" }
  );
  signOutIfUnauthorized(res);
  const body = (await res.json().catch(() => null)) as
    | { ok: true; product: ProductScan | null }
    | { ok: false; error: string }
    | null;
  if (!body || !body.ok) return null;
  return body.product;
}

export type ScrapeRecipeResponse = {
  name: string;
  description: string;
  ingredients: RecipeIngredient[];
  hasApproximate: boolean;
  // Base servings from the site's recipeYield; 0 when it didn't say.
  servings: number;
  // Which extraction strategy found the recipe ("json-ld", "microdata", …).
  source?: string;
};

export async function scrapeRecipeFromUrl(
  url: string
): Promise<ScrapeRecipeResponse> {
  const res = await fetch("/api/recipes/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  signOutIfUnauthorized(res);
  const body = (await res.json().catch(() => null)) as
    | (ScrapeRecipeResponse & { ok: true })
    | { ok: false; error: string }
    | null;
  if (!body || !body.ok) {
    throw new Error(
      (body && !body.ok && body.error) || `Failed to fetch recipe (HTTP ${res.status})`
    );
  }
  return body;
}

export type ParseIngredientsResponse = {
  ingredients: RecipeIngredient[];
  skipped: number;
  hasApproximate: boolean;
  // Set when the paste was longer than the server reads.
  note?: string;
};

/**
 * Server-side parse + categorize for a pasted ingredient list — the manual
 * fallback when a site blocks the URL scraper.
 */
export async function parseIngredientsFromText(
  text: string
): Promise<ParseIngredientsResponse> {
  const res = await fetch("/api/recipes/parse-ingredients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  signOutIfUnauthorized(res);
  const body = (await res.json().catch(() => null)) as
    | (ParseIngredientsResponse & { ok: true })
    | { ok: false; error: string }
    | null;
  if (!body || !body.ok) {
    throw new Error(
      (body && !body.ok && body.error) ||
        `Failed to parse ingredients (HTTP ${res.status})`
    );
  }
  return body;
}

export type AddRecipeInput = {
  weekStart: string;
  day: number;
  assignedTo: string;
  name: string;
  link?: string;
  description?: string;
  ingredients: RecipeIngredient[];
  servings?: number;
  portions?: number;
  // A "no shared meal" marker: name/assignedTo/ingredients may be empty.
  noMeal?: boolean;
};

export async function addRecipe(input: AddRecipeInput) {
  const res = await fetch("/api/recipes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap(await parse<RecipeMutateResponse>(res));
}

export async function updateRecipe(
  id: string,
  input: Partial<AddRecipeInput>
): Promise<RecipeMutateResponse & { gone?: true }> {
  const res = await fetch(`/api/recipes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 404) {
    return { ok: true, recipes: await listRecipes(), gone: true };
  }
  return unwrap(await parse<RecipeMutateResponse>(res));
}

export async function deleteRecipe(id: string) {
  const res = await fetch(`/api/recipes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (res.status === 404) {
    return { ok: true as const, recipes: await listRecipes() };
  }
  return unwrap(await parse<RecipeMutateResponse>(res));
}

/** A (week, day) slot a recipe can sit in. */
export type MoveTarget = { weekStart: string; day: number };

export type MoveRecipeResponse = RecipeMutateResponse & {
  /**
   * The slot the moved row came from. Posting it straight back reverses the
   * move, and a swap too: the old day now holds whatever the row traded with.
   */
  undo: { id: string; weekStart: string; day: number };
};

/**
 * Moves a dinner (or a no-meal marker) to another day. An empty target is a
 * plain move; a taken one swaps the two rows, cooks and all.
 */
export async function moveRecipe(id: string, target: MoveTarget) {
  const res = await fetch("/api/recipes/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, weekStart: target.weekStart, day: target.day }),
  });
  return unwrap(await parse<MoveRecipeResponse>(res));
}

/* ----- favorites ----- */

export async function listFavorites(): Promise<FavoriteRecipe[]> {
  const res = await fetch("/api/favorites", { cache: "no-store" });
  return unwrap(await parse<ListFavoritesResponse>(res)).favorites;
}

export async function addFavorite(input: {
  name: string;
  link?: string;
  description?: string;
  ingredients: RecipeIngredient[];
  servings?: number;
}) {
  const res = await fetch("/api/favorites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap(await parse<AddFavoriteResponse>(res));
}

export async function deleteFavorite(id: string) {
  const res = await fetch(`/api/favorites/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (res.status === 404) {
    return { ok: true as const, favorites: await listFavorites() };
  }
  return unwrap(await parse<FavoritesMutateResponse>(res));
}

/* ----- expenses ----- */

export async function listExpenses(): Promise<Expense[]> {
  const res = await fetch("/api/expenses", { cache: "no-store" });
  return unwrap(await parse<ListExpensesResponse>(res)).expenses;
}

export type AddExpenseInput = {
  amountCents: number;
  store?: string;
  paidBy: string;
  occurredOn?: string;
  description?: string;
  // Required on add. Omit `splitAmong` on house/meals lines to let the
  // server snapshot the current roster / meal group; send it to keep an
  // existing snapshot when editing.
  allocations?: Array<{
    kind: AllocationKind;
    amountCents: number;
    splitAmong?: string[];
  }>;
  // Required at the API level. Made optional in the type so the form can
  // also call this in places that haven't wired a receipt yet (legacy
  // tests); the server returns a 400 if the file is missing.
  receipt?: { blob: Blob; filename: string };
};

function expenseToFormData(
  input: Partial<AddExpenseInput> & { id?: string }
): FormData {
  const fd = new FormData();
  if (input.id !== undefined) fd.append("id", input.id);
  if (input.amountCents !== undefined)
    fd.append("amountCents", String(input.amountCents));
  if (input.store !== undefined) fd.append("store", input.store);
  if (input.paidBy !== undefined) fd.append("paidBy", input.paidBy);
  if (input.occurredOn !== undefined)
    fd.append("occurredOn", input.occurredOn);
  if (input.description !== undefined)
    fd.append("description", input.description);
  if (input.allocations !== undefined)
    fd.append("allocations", JSON.stringify(input.allocations));
  if (input.receipt) {
    fd.append("receipt", input.receipt.blob, input.receipt.filename);
  }
  return fd;
}

export async function addExpense(input: AddExpenseInput) {
  // Always multipart so the receipt field travels alongside the metadata.
  // Don't set Content-Type manually — the browser fills in the boundary.
  const res = await fetch("/api/expenses", {
    method: "POST",
    body: expenseToFormData(input),
  });
  return unwrap(await parse<ExpenseMutateResponse>(res));
}

export type UpdateExpenseInput = Partial<AddExpenseInput> & { id: string };

export async function updateExpense(
  input: UpdateExpenseInput
): Promise<ExpenseMutateResponse & { gone?: true }> {
  const res = await fetch("/api/expenses", {
    method: "PATCH",
    body: expenseToFormData(input),
  });
  if (res.status === 404) {
    return { ok: true, expenses: await listExpenses(), gone: true };
  }
  return unwrap(await parse<ExpenseMutateResponse>(res));
}

export async function deleteExpense(id: string) {
  const res = await fetch(`/api/expenses?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (res.status === 404) {
    return { ok: true as const, expenses: await listExpenses() };
  }
  return unwrap(await parse<ExpenseMutateResponse>(res));
}

/* ----- expense categories ----- */

export async function listExpenseCategories(): Promise<ExpenseCategoryDef[]> {
  const res = await fetch("/api/expense-categories", { cache: "no-store" });
  return unwrap(await parse<ListExpenseCategoriesResponse>(res))
    .expenseCategories;
}

export async function addExpenseCategory(
  name: string,
  color?: string | null
) {
  const res = await fetch("/api/expense-categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color: color ?? null }),
  });
  return unwrap(await parse<AddExpenseCategoryResponse>(res));
}

export async function updateExpenseCategoryColor(
  name: string,
  color: string | null
) {
  const res = await fetch("/api/expense-categories", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color }),
  });
  return unwrap(await parse<UpdateExpenseCategoryResponse>(res));
}

export async function deleteExpenseCategory(name: string) {
  const res = await fetch(
    `/api/expense-categories?name=${encodeURIComponent(name)}`,
    { method: "DELETE" }
  );
  if (res.status === 404) {
    return {
      ok: true as const,
      expenseCategories: await listExpenseCategories(),
      expenses: await listExpenses(),
      reassigned: 0,
    };
  }
  return unwrap(await parse<DeleteExpenseCategoryResponse>(res));
}

/* ----- shared passwords / accounts ----- */

export async function listSharedAccounts(): Promise<SharedAccount[]> {
  const res = await fetch("/api/shared-accounts", { cache: "no-store" });
  return unwrap(await parse<ListSharedAccountsResponse>(res)).accounts;
}

export async function getSharedAccount(id: string): Promise<SharedAccount> {
  const res = await fetch(`/api/shared-accounts/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  return unwrap(await parse<GetSharedAccountResponse>(res)).account;
}

export type AddSharedAccountInput = {
  name: string;
  fields?: SharedAccountField[];
};

export async function addSharedAccount(input: AddSharedAccountInput) {
  const res = await fetch("/api/shared-accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap(await parse<AddSharedAccountResponse>(res));
}

export type UpdateSharedAccountInput = {
  id: string;
  name?: string;
  fields?: SharedAccountField[];
};

export async function updateSharedAccount(
  input: UpdateSharedAccountInput
): Promise<SharedAccountsMutateResponse & { gone?: true }> {
  const res = await fetch("/api/shared-accounts", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 404) {
    return { ok: true, accounts: await listSharedAccounts(), gone: true };
  }
  return unwrap(await parse<SharedAccountsMutateResponse>(res));
}

export async function deleteSharedAccount(id: string) {
  const res = await fetch(`/api/shared-accounts?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (res.status === 404) {
    return { ok: true as const, accounts: await listSharedAccounts() };
  }
  return unwrap(await parse<SharedAccountsMutateResponse>(res));
}

/* ----- household settings (shared monthly state) ----- */

// Shared rent + recurring bill state. Kept generic so adding another shared
// blob later is just an ALLOWED_KEYS append on the server.
/** A setting plus the version stamp a later write can check itself against. */
export type VersionedSetting<T> = {
  value: T | null;
  /** ISO timestamp of the stored row, or null when there is no row yet. */
  updatedAt: string | null;
};

/**
 * Thrown by `putSetting` when the stored row has moved on since the version
 * the caller sent: somebody else saved over the same key. Carries what the
 * server now holds so the caller can show their version instead of silently
 * keeping its own.
 */
export class SettingConflictError extends Error {
  readonly value: unknown;
  readonly updatedAt: string | null;

  constructor(message: string, value: unknown, updatedAt: string | null) {
    super(message);
    this.name = "SettingConflictError";
    this.value = value;
    this.updatedAt = updatedAt;
  }
}

function asIso(raw: unknown): string | null {
  return typeof raw === "string" && raw ? raw : null;
}

export async function getSettingWithVersion<T>(
  key: string
): Promise<VersionedSetting<T>> {
  const res = await fetch(`/api/settings/${encodeURIComponent(key)}`, {
    cache: "no-store",
  });
  signOutIfUnauthorized(res);
  const body = (await res.json().catch(() => null)) as
    | { ok: true; value: T | null; updatedAt?: unknown }
    | { ok: false; error: string }
    | null;
  if (!body || !body.ok) {
    throw new Error(body && "error" in body ? body.error : "Failed to load setting");
  }
  return { value: body.value, updatedAt: asIso(body.updatedAt) };
}

export async function getSetting<T>(key: string): Promise<T | null> {
  return (await getSettingWithVersion<T>(key)).value;
}

/** Current meal group. Empty list means "everyone" (legacy behaviour). */
export async function getMealGroup(): Promise<MealGroup> {
  const v = await getSetting<MealGroup>(MEAL_GROUP_KEY);
  const members = Array.isArray(v?.members)
    ? v!.members.map(String).filter(isBuyer)
    : [];
  return { members };
}

export async function putMealGroup(group: MealGroup): Promise<void> {
  await putSetting(MEAL_GROUP_KEY, { members: group.members.filter(isBuyer) });
}

/**
 * Writes a setting. Pass `expectedUpdatedAt` (the version the value was read
 * at, or null when there was no row) to make the write conditional: the
 * server answers 409 if the row has changed since, and this throws
 * `SettingConflictError` carrying the current row. Omitting it — what the
 * seed script and the meal group do — writes unconditionally, last write
 * wins.
 *
 * Returns the row's new version when the server reports one, so the next
 * conditional write from this device checks against its own last write
 * rather than conflicting with it.
 */
export async function putSetting<T>(
  key: string,
  value: T,
  expectedUpdatedAt?: string | null
): Promise<{ updatedAt: string | null }> {
  const res = await fetch(`/api/settings/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      expectedUpdatedAt === undefined ? { value } : { value, expectedUpdatedAt }
    ),
  });
  signOutIfUnauthorized(res);
  const body = (await res.json().catch(() => null)) as
    | { error?: string; value?: unknown; updatedAt?: unknown }
    | null;
  if (res.status === 409) {
    throw new SettingConflictError(
      body?.error || "This setting was changed somewhere else",
      body?.value ?? null,
      asIso(body?.updatedAt)
    );
  }
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return { updatedAt: asIso(body?.updatedAt) };
}
