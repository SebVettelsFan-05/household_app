import type {
  AddCategoryResponse,
  AddResponse,
  ApiResponse,
  CategoryDef,
  DeleteCategoryResponse,
  GroceryItem,
  GroceryMutateResponse,
  Item,
  ListCategoriesResponse,
  ListGroceryResponse,
  ListResponse,
  MutateResponse,
  UpdateCategoryResponse,
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
