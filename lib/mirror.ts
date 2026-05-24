import {
  listCategoriesRepo,
  listExpenseCategoriesRepo,
  listExpensesRepo,
  listFavoritesRepo,
  listGroceryRepo,
  listItemsRepo,
  listRecipesRepo,
} from "./repo";

/**
 * Push the current Postgres state to the Google Sheet mirror. Best-effort:
 * a failed mirror does not affect the user-facing response. Postgres remains
 * the source of truth — the sheet just goes stale until the next write.
 *
 * Designed to be called via Next.js `after()` so it runs after the response
 * has been sent.
 */
export async function mirrorToSheet(): Promise<void> {
  const url = process.env.GAS_API_URL;
  if (!url) {
    console.warn("[mirror] GAS_API_URL not set; skipping sheet mirror");
    return;
  }
  try {
    const [
      items,
      categories,
      grocery,
      recipes,
      favorites,
      expenses,
      expenseCategories,
    ] = await Promise.all([
      listItemsRepo(),
      listCategoriesRepo(),
      listGroceryRepo(),
      listRecipesRepo(),
      listFavoritesRepo(),
      listExpensesRepo(),
      listExpenseCategoriesRepo(),
    ]);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      redirect: "follow",
      body: JSON.stringify({
        action: "mirror",
        items,
        categories,
        grocery,
        recipes,
        favorites,
        expenses,
        expenseCategories,
      }),
    });
    if (!res.ok) {
      console.error("[mirror] HTTP " + res.status);
      return;
    }
    const data = (await res.json().catch(() => null)) as
      | { ok: boolean; error?: string }
      | null;
    if (!data?.ok) {
      console.error("[mirror] upstream:", data?.error || "unknown");
    }
  } catch (err) {
    console.error("[mirror] failed:", err);
  }
}
