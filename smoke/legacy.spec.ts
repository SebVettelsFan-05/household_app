import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Legacy-UI smoke pass over the shared-kitchen flows, driven against the
 * local dev stack (`npm run dev:local`, app on :3100, house password "dev").
 *
 * The suite is serial and shares one page: each step builds on the one
 * before, and every step drops a screenshot in `smoke/out/` at both 1920x1080
 * and 390x844 so the rendering can actually be looked at.
 */

const OUT = path.join(__dirname, "out");
const DESKTOP = { width: 1920, height: 1080 };
const MOBILE = { width: 390, height: 844 };
const PASSWORD = "dev";

// Smallest thing that decodes as an image: a 1x1 PNG.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const RECEIPT_PATH = path.join(OUT, "receipt.png");
const RECIPE_NAME = "Smoke Green Curry";
const ITEM_NAME = "Smokeyogurt";

let page: Page;

/** Desktop + mobile screenshot of the current state. */
async function shot(name: string) {
  // `animations: "disabled"` finishes in-flight transitions first, so a chip
  // caught mid-fade doesn't make the screenshot lie about its state.
  const opts = { fullPage: true, animations: "disabled" as const };
  await page.setViewportSize(DESKTOP);
  await page.screenshot({ ...opts, path: path.join(OUT, `${name}-1920.png`) });
  await page.setViewportSize(MOBILE);
  await page.screenshot({ ...opts, path: path.join(OUT, `${name}-390.png`) });
  await page.setViewportSize(DESKTOP);
}

/** The bottom tab bar uses role="tab", so click it explicitly. */
async function gotoTab(label: string) {
  await page.locator(".tab-bar button").filter({ hasText: label }).click();
}

async function login() {
  await page.goto("/");
  if (page.url().includes("/login")) {
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /sign in|enter|continue/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  }
  await expect(page.getByRole("heading", { name: "Household" })).toBeVisible();
}

/**
 * Leftovers from an earlier run would change every settlement number, so the
 * suite clears exactly what it creates before it starts.
 */
async function resetFixtures() {
  const month = new Date().toISOString().slice(0, 7);

  const expenses = await page.request.get("/api/expenses");
  const eBody = await expenses.json();
  for (const e of eBody.expenses ?? []) {
    const when: string = e.occurredOn || e.added || "";
    if (when.startsWith(month)) {
      await page.request.delete(`/api/expenses?id=${encodeURIComponent(e.id)}`);
    }
  }

  const grocery = await page.request.get("/api/grocery");
  const gBody = await grocery.json();
  for (const g of gBody.grocery ?? []) {
    // "Chickens" merges with "Chicken" server-side, so clear the whole family
    // or a leftover row silently absorbs this run's add.
    if (String(g.name).toLowerCase().startsWith("chicken")) {
      await page.request.delete(`/api/grocery?id=${encodeURIComponent(g.id)}`);
    }
  }

  const recipes = await page.request.get("/api/recipes");
  const rBody = await recipes.json();
  for (const r of rBody.recipes ?? []) {
    if (r.noMeal || r.name === RECIPE_NAME) {
      await page.request.delete(`/api/recipes/${encodeURIComponent(r.id)}`);
    }
  }

  const items = await page.request.get("/api/items");
  const iBody = await items.json();
  for (const it of iBody.items ?? []) {
    if (String(it.name).toLowerCase().startsWith(ITEM_NAME.toLowerCase())) {
      await page.request.delete(`/api/items?id=${encodeURIComponent(it.id)}`);
    }
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(RECEIPT_PATH, TINY_PNG);
  page = await browser.newPage({ viewport: DESKTOP });
  // The app now ships two shells and defaults to the fresh one. This suite
  // is the classic pass, so pin the mode before any app script runs.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("hh_ui", "classic");
    } catch {
      /* ignore */
    }
  });
  await login();
  await resetFixtures();
  await page.reload();
});

test.afterAll(async () => {
  await page.close();
});

test("login lands on the household home", async () => {
  await expect(page.locator(".home-lede")).toBeVisible();
  await shot("01-home");
});

test("meal group is set to Arthur, Eli and Minh", async () => {
  await page.getByRole("button", { name: "Household settings" }).click();
  await expect(page.getByRole("heading", { name: "Household" }).last()).toBeVisible();

  for (const name of ["Arthur", "Eli", "Minh"]) {
    const box = page
      .locator(".settings-person", { hasText: new RegExp(`^${name}$`) })
      .locator("input");
    if (!(await box.isChecked())) await box.check();
  }
  for (const name of ["Daniel", "Ibrahim"]) {
    const box = page
      .locator(".settings-person", { hasText: new RegExp(`^${name}$`) })
      .locator("input");
    if (await box.isChecked()) await box.uncheck();
  }
  await shot("02-meal-group");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".modal")).toHaveCount(0);

  const setting = await page.request.get("/api/settings/meal_group");
  expect(setting.ok()).toBeTruthy();
  const body = await setting.json();
  expect(body.value.members).toEqual(["Arthur", "Eli", "Minh"]);
});

test("a $120 receipt splits into Meals $90 and Everyone $30", async () => {
  await gotoTab("Expenses");
  await expect(page.getByRole("heading", { name: "Add expense" })).toBeVisible();

  await page.locator("#e-store").fill("Costco");
  await page.locator("#e-amount").fill("120.00");
  await page.locator("#e-by").selectOption("Arthur");

  // Line 1: the meal group's $90.
  const line1 = page.locator(".alloc-line").nth(0);
  await line1.getByRole("button", { name: "Meals" }).click();
  await line1.getByLabel("Amount for split line 1").fill("90.00");

  // Line 2: the house's $30.
  await page.getByRole("button", { name: "+ Split receipt" }).click();
  const line2 = page.locator(".alloc-line").nth(1);
  await line2.getByRole("button", { name: "Everyone" }).click();
  await line2.getByLabel("Amount for split line 2").fill("30.00");

  await expect(page.locator(".alloc-remainder")).toHaveText("Unallocated $0.00");
  await page.locator("#e-receipt").setInputFiles(RECEIPT_PATH);
  await shot("03-expense-form");

  await page.getByRole("button", { name: "Add expense" }).click();

  const row = page.locator(".item", { hasText: "Costco" }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.locator(".alloc-summary")).toHaveText(
    "Meals (3) $90.00 · Everyone $30.00"
  );
  await shot("04-expense-row");
});

test("the monthly settlement charges Daniel $6 and credits Arthur $120", async () => {
  await page.getByRole("button", { name: "Monthly", exact: true }).click();
  await expect(page.locator(".monthly-card")).toBeVisible();

  const daniel = page.locator(".split-group li", { hasText: "Daniel" }).first();
  await expect(daniel).toContainText("Share $6.00");
  const arthur = page.locator(".split-group li", { hasText: "Arthur" }).first();
  await expect(arthur).toContainText("Paid $120.00");

  // Expand the store group so the per-trip split summary is on screen too.
  await page.locator(".monthly-store-summary").first().click();
  await expect(
    page.locator(".monthly-trip-row .alloc-summary").first()
  ).toHaveText("Meals (3) $90.00 · Everyone $30.00");
  await shot("05-settlement");
});

test("the same name in two pools stays two grocery rows", async () => {
  await gotoTab("Grocery");
  await expect(page.getByRole("heading", { name: "Add to list" })).toBeVisible();

  const chickens = page
    .locator(".grocery-row")
    .filter({ has: page.locator(".grocery-name", { hasText: /^Chicken$/ }) });

  await page.locator("#g-name").fill("Chicken");
  await page.locator("#g-qty").fill("500");
  await page.locator(".pool-chips").getByRole("button", { name: "Meals" }).click();
  await page.locator("#g-by").selectOption("Arthur");
  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(chickens).toHaveCount(1);

  await page.locator("#g-name").fill("Chicken");
  await page.locator("#g-qty").fill("300");
  await page.locator(".pool-chips").getByRole("button", { name: "Personal" }).click();
  await page.locator("#g-by").selectOption("Eli");
  await page.getByRole("button", { name: "Add to list" }).click();

  // Two separate rows: the same name in two pools must not merge.
  await expect(chickens).toHaveCount(2);
  await expect(
    chickens.filter({ hasText: "For Arthur" }).locator(".pool-badge.meals")
  ).toHaveText("Meals");
  await expect(
    chickens.filter({ hasText: "For Eli" }).locator(".pool-badge.personal")
  ).toHaveText("Personal");
  await shot("06-grocery-pools");
});

test("a slot can be marked as no shared meal", async () => {
  await gotoTab("Recipes");
  await expect(page.locator(".recipe-grid").first()).toBeVisible();

  await page.getByRole("button", { name: "No meal" }).first().click();
  const marker = page.locator(".no-meal-card").first();
  await expect(marker).toBeVisible();
  await expect(marker).toContainText("No shared meal");
  await expect(
    page.getByRole("button", { name: "Plan a meal" }).first()
  ).toBeVisible();
  await shot("07-no-meal");
});

test("a recipe records its cook, servings and portions", async () => {
  await gotoTab("Recipes");
  // Sunday holds the marker from the previous step, so take Monday.
  await page.getByRole("button", { name: "+ Add recipe" }).first().click();
  await expect(page.getByRole("heading", { name: "Add recipe" })).toBeVisible();

  // Only the meal group can be picked as cook (plus the blank prompt).
  await expect(page.locator("#r-who option")).toHaveText([
    "Pick a cook…",
    "Arthur",
    "Eli",
    "Minh",
  ]);
  await page.locator("#r-who").selectOption("Arthur");
  await page.locator("#r-name").fill(RECIPE_NAME);
  await page.locator("#r-servings").fill("5");
  await page.locator("#r-portions").fill("3");

  await page.locator(".ingredient-add .ingredient-name").fill("Coconut milk");
  await page.locator(".ingredient-add .ingredient-qty").fill("500");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await shot("08-recipe-form");

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".recipe-card", { hasText: RECIPE_NAME })).toBeVisible();
  await expect(page.locator(".week-cooks").first()).toHaveText("Arthur 1");
  await shot("09-recipe-card");
});

test("pushing a recipe to the grocery list scales the weights", async () => {
  await page.locator(".recipe-card", { hasText: RECIPE_NAME }).click();
  await page.getByRole("button", { name: "Add to grocery" }).click();
  await expect(page.getByRole("heading", { name: "Add to grocery list" })).toBeVisible();

  await expect(page.locator(".scale-note")).toHaveText(
    "Scaled x0.6 for 3 of 5 servings"
  );
  // 500 g for 5 servings becomes 300 g for 3.
  await expect(page.locator(".ing-add-qty").first()).toHaveText("300g");
  await expect(
    page.locator(".pool-chips .pool-chip.active")
  ).toHaveText("Meals");
  await shot("10-recipe-grocery");

  // Escape closes the grocery picker first, then the recipe modal behind it.
  await page.keyboard.press("Escape");
  await expect(page.locator(".ing-add-list")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-bg")).toHaveCount(0);
});

test("an inventory item can belong to one person", async () => {
  await gotoTab("Inventory");
  await page.locator("#name").fill(ITEM_NAME);
  await page.locator("#qty").fill("500");
  await page.locator("#owner").selectOption("Eli");
  await page.getByRole("button", { name: "Add to inventory" }).click();

  const row = page.locator(".item", { hasText: ITEM_NAME });
  await expect(row).toHaveCount(1);
  await expect(row.locator(".owner-badge")).toHaveText("Eli's");

  await page.locator(".filter-row").first().getByRole("button", { name: "Shared" }).click();
  await expect(row).toHaveCount(0);
  await page.locator(".filter-row").first().getByRole("button", { name: "Personal" }).click();
  await expect(row).toHaveCount(1);
  await shot("11-inventory-owner");
});

test("the edit modal seeds the saved split", async () => {
  await gotoTab("Expenses");
  await page.getByRole("button", { name: "Current", exact: true }).click();
  await page.locator(".item", { hasText: "Costco" }).first().click();
  await expect(page.getByRole("heading", { name: "Edit expense" })).toBeVisible();

  const lines = page.locator(".modal .alloc-line");
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0).locator(".alloc-chip.active")).toHaveText("Meals");
  await expect(lines.nth(0).getByLabel("Amount for split line 1")).toHaveValue(
    "90.00"
  );
  await expect(lines.nth(1).locator(".alloc-chip.active")).toHaveText("Everyone");

  // Custom reveals per-member checkboxes.
  await lines.nth(1).getByRole("button", { name: "Custom" }).click();
  await expect(lines.nth(1).locator(".alloc-member")).toHaveCount(5);
  await shot("12-expense-edit");

  // Nothing is saved: the settlement asserted above must stay true.
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-bg")).toHaveCount(0);
});
