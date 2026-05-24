export type Category = string;

export const FALLBACK_CATEGORY: Category = "Other";

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

export type ListCategoriesResponse = ApiOk<{ categories: Category[] }>;
export type AddCategoryResponse = ApiOk<{
  categories: Category[];
  existed?: boolean;
}>;
export type DeleteCategoryResponse = ApiOk<{
  categories: Category[];
  items: Item[];
  reassigned: number;
}>;
