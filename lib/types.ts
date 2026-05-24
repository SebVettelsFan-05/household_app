export type Category = "Meat" | "Veggies" | "Other";

export const CATEGORIES: Category[] = ["Meat", "Veggies", "Other"];

export type Item = {
  id: string;
  name: string;
  quantity: number;
  expiry: string;
  added: string;
  category: Category;
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
