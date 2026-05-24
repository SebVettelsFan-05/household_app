import type {
  AddResponse,
  ApiResponse,
  Item,
  ListResponse,
  MutateResponse,
} from "./types";

async function parse<T>(res: Response): Promise<ApiResponse<T>> {
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  try {
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return { ok: false, error: "Bad JSON from server" };
  }
}

function unwrap<T>(r: ApiResponse<T>): T {
  if (!r.ok) throw new Error(r.error || "Unknown error");
  return r;
}

export async function listItems(): Promise<Item[]> {
  const res = await fetch("/api/items", { cache: "no-store" });
  const data = unwrap(await parse<ListResponse>(res));
  return data.items;
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
