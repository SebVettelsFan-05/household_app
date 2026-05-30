import type {
  AddCategoryResponse,
  AddExpenseCategoryResponse,
  AddFavoriteResponse,
  AddResponse,
  ApiResponse,
  CategoryDef,
  DeleteCategoryResponse,
  DeleteExpenseCategoryResponse,
  Expense,
  ExpenseCategoryDef,
  ExpenseMutateResponse,
  FavoriteRecipe,
  FavoritesMutateResponse,
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
  UpdateCategoryResponse,
  UpdateExpenseCategoryResponse,
} from "./types";

async function parse<T>(res: Response): Promise<ApiResponse<T>> {
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

export async function updateItem(input: UpdateInput) {
  const res = await fetch("/api/items", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap(await parse<MutateResponse>(res));
}

export async function deleteItem(id: string) {
  const res = await fetch(`/api/items?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
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

export async function deleteCategory(name: string) {
  const res = await fetch(
    `/api/categories?name=${encodeURIComponent(name)}`,
    { method: "DELETE" }
  );
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
  store?: string;
  addedBy?: string;
  done?: boolean;
};

export async function updateGrocery(input: UpdateGroceryInput) {
  const res = await fetch("/api/grocery", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap(await parse<GroceryMutateResponse>(res));
}

export async function deleteGrocery(id: string) {
  const res = await fetch(`/api/grocery?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
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
};

export async function scrapeRecipeFromUrl(
  url: string
): Promise<ScrapeRecipeResponse> {
  const res = await fetch("/api/recipes/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
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

export type AddRecipeInput = {
  weekStart: string;
  day: number;
  assignedTo: string;
  name: string;
  link?: string;
  description?: string;
  ingredients: RecipeIngredient[];
};

export async function addRecipe(input: AddRecipeInput) {
  const res = await fetch("/api/recipes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap(await parse<RecipeMutateResponse>(res));
}

export async function updateRecipe(id: string, input: Partial<AddRecipeInput>) {
  const res = await fetch(`/api/recipes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap(await parse<RecipeMutateResponse>(res));
}

export async function deleteRecipe(id: string) {
  const res = await fetch(`/api/recipes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return unwrap(await parse<RecipeMutateResponse>(res));
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

export async function updateExpense(input: UpdateExpenseInput) {
  const res = await fetch("/api/expenses", {
    method: "PATCH",
    body: expenseToFormData(input),
  });
  return unwrap(await parse<ExpenseMutateResponse>(res));
}

export async function deleteExpense(id: string) {
  const res = await fetch(`/api/expenses?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return unwrap(await parse<ExpenseMutateResponse>(res));
}

export async function clearExpenses() {
  const res = await fetch("/api/expenses/clear", { method: "POST" });
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
  return unwrap(await parse<DeleteExpenseCategoryResponse>(res));
}

/* ----- household settings (shared monthly state) ----- */

// Shared rent + recurring bill state. Kept generic so adding another shared
// blob later is just an ALLOWED_KEYS append on the server.
export async function getSetting<T>(key: string): Promise<T | null> {
  const res = await fetch(`/api/settings/${encodeURIComponent(key)}`, {
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as
    | { ok: true; value: T | null }
    | { ok: false; error: string }
    | null;
  if (!body || !body.ok) {
    throw new Error(body && "error" in body ? body.error : "Failed to load setting");
  }
  return body.value;
}

export async function putSetting<T>(key: string, value: T): Promise<void> {
  const res = await fetch(`/api/settings/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
}
