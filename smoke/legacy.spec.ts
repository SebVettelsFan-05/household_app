import {
  expect,
  test,
  type Browser,
  type Dialog,
  type Page,
} from "@playwright/test";
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
const HOUSEHOLD_TZ = "America/Toronto";
const RECIPE_NAME = "Smoke Green Curry";
const ITEM_NAME = "Smokeyogurt";
// The recipe's only ingredient. The suite hand-adds it to the grocery list
// first, then pushes the recipe onto the same row to prove they merge.
const INGREDIENT_NAME = "Coconut milk";

let page: Page;
let browserRef: Browser;

/** Sunday anchor of the cooking week today falls in (mirrors lib/dates.ts). */
function activeWeekStart(): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: HOUSEHOLD_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = today.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() - utc.getUTCDay());
  return utc.toISOString().slice(0, 10);
}

const WEEK_START = activeWeekStart();

/** Today in the household timezone, as YYYY-MM-DD (mirrors `todayYmd`). */
const TODAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: HOUSEHOLD_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

/** The category the delete-confirm test creates and then removes. */
const USAGE_CATEGORY = "Smokecat";

/**
 * WCAG relative-luminance contrast between two rendered colors, as
 * `getComputedStyle` reports them ("rgb(a, b, c)").
 */
function contrastRatio(a: string, b: string): number {
  const lum = (color: string) => {
    const [r, g, bl] = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const chan = (v: number) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(bl);
  };
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

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

/**
 * Closing a modal takes its history entry back out, and the browser does that
 * a beat later. Wait for it before counting history entries, or a step that
 * pushes one lands before the pop and the pop eats the wrong entry.
 */
async function settleHistory() {
  await page.waitForFunction(
    () => (window.history.state?.hhLayer ?? null) === null
  );
}

/** The bottom tab bar uses role="tab", so click it explicitly. */
async function gotoTab(label: string) {
  await page.locator(".tab-bar button").filter({ hasText: label }).click();
}

/**
 * Fill the password so that React sees it. Filling before hydration sets the
 * DOM value with no change handler attached, and hydration then resets the
 * field, leaving Sign in disabled. Fill, wait for the button, refill once.
 */
async function typePassword(p: Page, password: string) {
  const input = p.locator('input[type="password"]');
  const button = p.getByRole("button", { name: /sign in|enter|continue/i });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await input.fill("");
    await input.fill(password);
    try {
      await expect(button).toBeEnabled({ timeout: 1500 });
      return;
    } catch {
      await p.waitForTimeout(300);
    }
  }
  await expect(button).toBeEnabled();
}

async function loginOn(p: Page) {
  await p.goto("/");
  if (p.url().includes("/login")) {
    await typePassword(p, PASSWORD);
    await p.getByRole("button", { name: /sign in|enter|continue/i }).click();
    await p.waitForURL((url) => !url.pathname.startsWith("/login"));
  }
  await expect(p.getByRole("heading", { name: "Household" })).toBeVisible();
}

async function login() {
  await loginOn(page);
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
    const name = String(g.name).toLowerCase();
    if (name.startsWith("chicken") || name.startsWith("coconut")) {
      await page.request.delete(`/api/grocery?id=${encodeURIComponent(g.id)}`);
    }
  }

  // This week's slots have to start empty: the suite asserts the cook tally,
  // and anything already planned (the local seed, an earlier run) would add
  // cooks to it.
  const recipes = await page.request.get("/api/recipes");
  const rBody = await recipes.json();
  for (const r of rBody.recipes ?? []) {
    if (r.noMeal || r.name === RECIPE_NAME || r.weekStart === WEEK_START) {
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
  browserRef = browser;
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

test("a grocery row lands under its category, with no pool tag", async () => {
  await gotoTab("Grocery");
  await expect(page.getByRole("heading", { name: "Add to list" })).toBeVisible();

  await page.locator("#g-name").fill(INGREDIENT_NAME);
  await page.locator("#g-qty").fill("200");
  await page.locator(".cat-pills").getByRole("button", { name: "Pantry", exact: true }).click();
  await page.locator("#g-by").selectOption("Arthur");
  await page.getByRole("button", { name: "Add to list" }).click();

  const rows = page
    .locator(".grocery-row")
    .filter({ has: page.locator(".grocery-name", { hasText: INGREDIENT_NAME }) });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("For Arthur");

  // Grouped by item category, and the row carries no pool badge any more.
  const group = page
    .locator(".cat-group")
    .filter({ has: page.locator(".cat-group-name", { hasText: "Pantry" }) });
  await expect(
    group.locator(".grocery-name", { hasText: INGREDIENT_NAME })
  ).toHaveCount(1);
  await expect(page.locator(".pool-badge")).toHaveCount(0);
  await expect(page.locator(".pool-chips")).toHaveCount(0);
  await shot("06-grocery-category");
});

test("using a favorite opens the classic recipe editor filled in", async () => {
  const name = "Smoke Favorite Template";
  const created = await (
    await page.request.post("/api/favorites", {
      data: { name, link: "https://example.com/classic-template", servings: 4, ingredients: [] },
    })
  ).json();
  const fav = created.favorites.find((f: { name: string }) => f.name === name);
  try {
    await gotoTab("Recipes");
    await page.getByRole("button", { name: /Favorites/ }).first().click();
    await page.locator(".modal").filter({ hasText: name }).waitFor();
    await page
      .locator(".favorite-actions", { has: page.locator("xpath=..", { hasText: name }) })
      .first()
      .getByRole("button", { name: "Use" })
      .click();
    // The favorites modal closes and the editor opens in one commit; the
    // modal's history pop must not close the editor.
    await expect(page.locator("#r-name")).toHaveValue(name);
    await page.waitForTimeout(400);
    await expect(page.locator("#r-name")).toHaveValue(name);
    await page.goBack();
    await expect(page.locator("#r-name")).toHaveCount(0);
    await expect(page.locator(".tab.active")).toHaveText(/Recipes/);
  } finally {
    if (fav) await page.request.delete(`/api/favorites/${encodeURIComponent(fav.id)}`);
  }
});

test("Back closes a classic modal even after another modal closed itself", async () => {
  await gotoTab("Recipes");
  const archive = page.getByRole("button", { name: /Archive/ }).first();
  await archive.click();
  await page.locator(".modal-bg").waitFor();
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-bg")).toHaveCount(0);
  await archive.click();
  await page.locator(".modal-bg").waitFor();
  await page.goBack();
  await expect(page.locator(".modal-bg")).toHaveCount(0);
  await expect(page.locator(".tab.active")).toHaveText(/Recipes/);
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

  await page.locator(".ingredient-add .ingredient-name").fill(INGREDIENT_NAME);
  await page.locator(".ingredient-add .ingredient-qty").fill("500");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await shot("08-recipe-form");

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".recipe-card", { hasText: RECIPE_NAME })).toBeVisible();
  await expect(page.locator(".week-cooks").first()).toHaveText("Arthur 1");
  await shot("09-recipe-card");
});

test("a recipe push scales the weights and merges into the row already there", async () => {
  await page.locator(".recipe-card", { hasText: RECIPE_NAME }).click();
  await page.getByRole("button", { name: "Add to grocery" }).click();
  await expect(page.getByRole("heading", { name: "Add to grocery list" })).toBeVisible();

  await expect(page.locator(".scale-note")).toHaveText(
    "Scaled x0.6 for 3 of 5 servings"
  );
  // 500 g for 5 servings becomes 300 g for 3.
  await expect(page.locator(".ing-add-qty").first()).toHaveText("300g");
  await shot("10-recipe-grocery");

  await page.getByRole("button", { name: "Add 1 item" }).click();
  await expect(page.locator(".ing-add-list")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-bg")).toHaveCount(0);

  // One row, not two: the pushed ingredient tops up the hand-added row
  // (200 g + 300 g) instead of opening a second line for the same thing.
  await gotoTab("Grocery");
  const rows = page
    .locator(".grocery-row")
    .filter({ has: page.locator(".grocery-name", { hasText: INGREDIENT_NAME }) });
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator(".item-qty")).toHaveText("500g");
  await shot("10b-grocery-merged");
});

test("an inventory item lands in its category group, with no owner", async () => {
  await gotoTab("Inventory");
  await page.locator("#name").fill(ITEM_NAME);
  await page.locator("#qty").fill("500");
  await page.locator(".cat-pills").getByRole("button", { name: "Dairy", exact: true }).click();
  await page.getByRole("button", { name: "Add to inventory" }).click();

  const row = page.locator(".item", { hasText: ITEM_NAME });
  await expect(row).toHaveCount(1);
  // Nothing belongs to anybody any more: no owner badge, no owner picker.
  await expect(page.locator(".owner-badge")).toHaveCount(0);
  await expect(page.locator("#owner")).toHaveCount(0);

  const group = page
    .locator(".cat-group")
    .filter({ has: page.locator(".cat-group-name", { hasText: "Dairy" }) });
  await expect(group.locator(".item-name", { hasText: ITEM_NAME })).toHaveCount(1);
  await shot("11-inventory-category");
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

test("Escape over the classic edit modal closes only the lightbox", async () => {
  await gotoTab("Expenses");
  await page.getByRole("button", { name: "Current", exact: true }).click();
  await page.locator(".item", { hasText: "Costco" }).first().click();
  await expect(page.getByRole("heading", { name: "Edit expense" })).toBeVisible();

  await page.locator("#ee-desc").fill("Escape probe");
  await page.locator("#ee-receipt").setInputFiles(RECEIPT_PATH);
  await page.locator(".modal .receipt-preview img").click();
  await expect(page.locator(".receipt-lightbox")).toBeVisible();

  // The lightbox goes; the modal and everything typed into it stay.
  await page.keyboard.press("Escape");
  await expect(page.locator(".receipt-lightbox")).toHaveCount(0);
  await expect(page.locator(".modal-bg")).toHaveCount(1);
  await expect(page.locator("#ee-desc")).toHaveValue("Escape probe");

  // Nothing behind the modal is reachable by keyboard while it is open.
  for (let i = 0; i < 30; i += 1) await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() =>
      document.querySelector(".modal")?.contains(document.activeElement)
    )
  ).toBe(true);

  // Nothing is saved: the settlement asserted above must stay true.
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-bg")).toHaveCount(0);
});

test("closing a modal hands the keyboard back to whatever opened it", async () => {
  const gear = page.getByRole("button", { name: "Household settings" });
  await gear.evaluate((el) => el.setAttribute("data-probe", "opener"));
  await gear.click();
  await expect(page.locator(".modal-bg")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-bg")).toHaveCount(0);
  // The hand-back waits for the frame after the layer leaves the DOM, so
  // poll for it instead of reading focus the instant the modal is gone.
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("data-probe") === "opener"
  );

  // A lightbox opened from inside the modal hands focus back into the modal,
  // not out to the page behind it.
  await gotoTab("Expenses");
  await page.getByRole("button", { name: "Current", exact: true }).click();
  await page.locator(".item", { hasText: "Costco" }).first().click();
  await expect(page.getByRole("heading", { name: "Edit expense" })).toBeVisible();

  await page.locator("#ee-receipt").setInputFiles(RECEIPT_PATH);
  await page.locator("#ee-desc").click();
  await page.locator(".modal .receipt-preview img").click();
  await expect(page.locator(".receipt-lightbox")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator(".receipt-lightbox")).toHaveCount(0);
  await expect(page.locator(".modal-bg")).toHaveCount(1);
  // The thumbnail is a bare <img>, so opening the lightbox leaves focus on
  // the modal box itself; that is what the lightbox has to hand it back to.
  await page.waitForFunction(() =>
    String(document.activeElement?.className ?? "").includes("modal")
  );

  // Nothing is saved: the settlement asserted above must stay true.
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-bg")).toHaveCount(0);
  await settleHistory();
});

test("Back walks the classic tabs and closes a modal without leaving", async () => {
  await settleHistory();
  await gotoTab("Home");
  await gotoTab("Grocery");
  expect(new URL(page.url()).hash).toBe("#grocery");
  await gotoTab("Recipes");
  expect(new URL(page.url()).hash).toBe("#recipes");

  // A reload lands on the tab the user was on, not back on Home.
  await page.reload();
  await expect(page.locator(".recipe-grid").first()).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Grocery" })).toBeVisible();

  // An open modal owns one entry of its own, so Back closes the modal and
  // leaves the app standing on the same tab.
  await page.getByRole("button", { name: "Household settings" }).click();
  await expect(page.locator(".modal-bg")).toHaveCount(1);
  await page.goBack();
  await expect(page.locator(".modal-bg")).toHaveCount(0);
  await expect(page.locator(".wrap")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Grocery" })).toBeVisible();

  // Closing it from the modal takes that entry back out again, so the next
  // Back is the tab move and not a second dismissal.
  await page.getByRole("button", { name: "Household settings" }).click();
  await expect(page.locator(".modal-bg")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-bg")).toHaveCount(0);
  await settleHistory();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Household" })).toBeVisible();
});

test("deleting a row somebody else already deleted closes cleanly", async () => {
  const ghost = "Smokeghostrice";
  await page.request.post("/api/items", {
    data: { name: ghost, quantity: 300, category: "Pantry" },
  });
  await page.reload();
  await gotoTab("Inventory");

  await page.locator(".item", { hasText: ghost }).first().click();
  await expect(page.getByRole("heading", { name: "Edit item" })).toBeVisible();

  // The row goes behind the modal's back — another housemate, another device.
  const items = await (await page.request.get("/api/items")).json();
  const row = (items.items ?? []).find(
    (i: { name: string }) => i.name === ghost
  );
  expect(row).toBeTruthy();
  await page.request.delete(`/api/items?id=${encodeURIComponent(row.id)}`);

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete" }).click();

  // The delete asked for what had already happened, so it counts as done.
  await expect(page.locator(".modal-bg")).toHaveCount(0);
  await expect(page.locator(".item", { hasText: ghost })).toHaveCount(0);
  await expect(page.locator(".toast")).not.toContainText("Error");
});

test("both classic date fields are capped at today", async () => {
  await gotoTab("Expenses");
  await page.getByRole("button", { name: "Current", exact: true }).click();
  await expect(page.locator("#e-date")).toHaveValue(TODAY);
  await expect(page.locator("#e-date")).toHaveAttribute("max", TODAY);

  await page.locator(".item", { hasText: "Costco" }).first().click();
  await expect(page.getByRole("heading", { name: "Edit expense" })).toBeVisible();
  await expect(page.locator("#ee-date")).toHaveAttribute("max", TODAY);

  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-bg")).toHaveCount(0);
  await settleHistory();
});

test("a category delete counts everything it is about to move", async () => {
  // The confirm used to count only the inventory rows this modal happened to
  // have loaded, so grocery rows and recipe ingredients were reassigned to
  // "Other" without anyone being told, and the grocery screen kept the group.
  await page.request.post("/api/categories", {
    data: { name: USAGE_CATEGORY, color: null },
  });
  await page.request.post("/api/items", {
    data: {
      name: "Smokecatitem",
      quantity: 1,
      category: USAGE_CATEGORY,
      categoryReviewed: true,
    },
  });
  await page.request.post("/api/grocery", {
    data: {
      name: "Smokecatgrocery",
      quantity: 1,
      category: USAGE_CATEGORY,
      categoryReviewed: true,
      addedBy: "Arthur",
    },
  });
  // Next week, so this week's cook tally is left alone.
  const nextWeek = new Date(Date.UTC(
    Number(WEEK_START.slice(0, 4)),
    Number(WEEK_START.slice(5, 7)) - 1,
    Number(WEEK_START.slice(8, 10)) + 7
  ))
    .toISOString()
    .slice(0, 10);
  await page.request.post("/api/recipes", {
    data: {
      weekStart: nextWeek,
      day: 3,
      assignedTo: "Eli",
      name: "Smokecat Stew",
      ingredients: [
        { name: "Smokecatspice", quantity: 10, category: USAGE_CATEGORY },
      ],
    },
  });

  await page.reload();
  await gotoTab("Grocery");
  await expect(
    page.locator(".cat-group-name", { hasText: USAGE_CATEGORY })
  ).toBeVisible();

  await page.getByRole("button", { name: "Manage" }).first().click();
  const row = page.locator(".cat-mgr-row", { hasText: USAGE_CATEGORY });
  await expect(row).toBeVisible();

  // First pass: read the confirm and walk away. The wording has to name every
  // kind of row that is about to move, not just the inventory ones.
  const message = new Promise<string>((resolve) => {
    page.once("dialog", (d) => {
      resolve(d.message());
      d.dismiss();
    });
  });
  await row.getByRole("button", { name: "Remove" }).click();
  expect(await message).toBe(
    `Delete "${USAGE_CATEGORY}"? 1 item, 1 grocery row and 1 recipe ingredient will move to "Other".`
  );
  await expect(row).toBeVisible();

  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "Remove" }).click();
  await expect(
    page.locator(".cat-mgr-row", { hasText: USAGE_CATEGORY })
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-bg")).toHaveCount(0);

  // No dead group left behind on the grocery screen, with no reload.
  await expect(
    page.locator(".cat-group-name", { hasText: USAGE_CATEGORY })
  ).toHaveCount(0);
  await expect(page.locator(".toast")).not.toContainText("Error");
  await settleHistory();

  // Clean up this test's rows.
  const grocery = await (await page.request.get("/api/grocery")).json();
  for (const g of grocery.grocery ?? []) {
    if (String(g.name).toLowerCase().startsWith("smokecat")) {
      await page.request.delete(`/api/grocery?id=${encodeURIComponent(g.id)}`);
    }
  }
  const items = await (await page.request.get("/api/items")).json();
  for (const it of items.items ?? []) {
    if (String(it.name).toLowerCase().startsWith("smokecat")) {
      await page.request.delete(`/api/items?id=${encodeURIComponent(it.id)}`);
    }
  }
  const recipes = await (await page.request.get("/api/recipes")).json();
  for (const r of recipes.recipes ?? []) {
    if (r.name === "Smokecat Stew") {
      await page.request.delete(`/api/recipes/${encodeURIComponent(r.id)}`);
    }
  }
  await page.reload();
  await expect(page.locator(".wrap")).toBeVisible();
});

test("the household settings modal is captured in both themes", async () => {
  await gotoTab("Home");
  await page.getByRole("button", { name: "Household settings" }).click();
  await expect(page.locator(".modal")).toBeVisible();
  await shot("13-settings-light");
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-bg")).toHaveCount(0);
  await settleHistory();

  // Dark is where a hard-coded white label on the accent button shows up, so
  // the Save button has to be readable in this frame. The header toggle
  // flips the theme in place — a reload would reopen the modal before the
  // household data is back and shoot an empty meal group.
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.getByRole("button", { name: "Household settings" }).click();
  await expect(page.locator(".modal")).toBeVisible();
  await shot("13-settings-dark");

  // Measured, not eyeballed: white on the dark theme's mint accent is
  // 2.37:1, which is unreadable and well under WCAG AA.
  const save = page.locator(".modal .btn-accent", { hasText: "Save" });
  const [ink, paper] = await save.evaluate((el) => {
    const cs = getComputedStyle(el);
    return [cs.color, cs.backgroundColor];
  });
  expect(contrastRatio(ink, paper)).toBeGreaterThan(4.5);
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-bg")).toHaveCount(0);

  await page.getByRole("button", { name: "Switch to light mode" }).click();
});

/* ---------- moving dinners ---------- */

type SmokeRecipe = {
  id: string;
  weekStart: string;
  day: number;
  assignedTo: string;
  name: string;
  description: string;
  noMeal: boolean;
};

const MOVE_A = "Smoke Bun cha";
const MOVE_B = "Smoke Congee";
const NEXT_WEEK_START = (() => {
  const [y, m, d] = WEEK_START.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
})();

async function recipeRows(p: Page): Promise<SmokeRecipe[]> {
  const body = await (await p.request.get("/api/recipes")).json();
  return body.recipes ?? [];
}

/**
 * Clears both visible weeks and plants exactly these rows. A row with no
 * name is a no-meal marker. The days are fixed numbers, never "today", so a
 * move test reads the same whichever day of the week it runs on.
 */
async function planWeeks(
  p: Page,
  rows: { weekStart?: string; day: number; name?: string; cook?: string }[]
) {
  for (const r of await recipeRows(p)) {
    await p.request.delete(`/api/recipes/${encodeURIComponent(r.id)}`);
  }
  for (const row of rows) {
    await p.request.post("/api/recipes", {
      data: {
        weekStart: row.weekStart ?? WEEK_START,
        day: row.day,
        assignedTo: row.cook ?? "",
        name: row.name ?? "",
        ingredients: [],
        noMeal: row.name ? undefined : true,
      },
    });
  }
}

/** "<week>/<day>" for a named dinner, straight from the API. */
async function slotOf(p: Page, name: string): Promise<string> {
  const row = (await recipeRows(p)).find((r) => r.name === name);
  return row ? `${row.weekStart}/${row.day}` : "gone";
}

/** The same, for the week's no-meal marker. */
async function markerSlot(p: Page): Promise<string> {
  const row = (await recipeRows(p)).find((r) => r.noMeal);
  return row ? `${row.weekStart}/${row.day}` : "gone";
}

/** The slot for one day of one week, whatever is (or is not) planned in it. */
function slot(weekStart: string, day: number) {
  return page.locator(
    `.recipe-move-host[data-week="${weekStart}"][data-day="${day}"]`
  );
}

test("a dinner moves to an empty day, and Undo puts it back", async () => {
  await planWeeks(page, [{ day: 0, name: MOVE_A, cook: "Eli" }]);
  await page.reload();
  await gotoTab("Recipes");

  await slot(WEEK_START, 0)
    .getByRole("button", { name: `Move ${MOVE_A}` })
    .click();
  await expect(page.locator(".recipe-move-bar")).toContainText(
    `Moving ${MOVE_A}`
  );
  await shot("14-move-pending");

  await slot(WEEK_START, 3)
    .getByRole("button", { name: /^Move to / })
    .click();
  await expect(slot(WEEK_START, 3).locator(".recipe-name")).toHaveText(MOVE_A);
  await expect(page.locator(".recipe-move-bar")).toHaveCount(0);
  await expect.poll(() => slotOf(page, MOVE_A)).toBe(`${WEEK_START}/3`);

  await page.locator(".toast.toast-action .toast-action-btn").click();
  await expect(slot(WEEK_START, 0).locator(".recipe-name")).toHaveText(MOVE_A);
  await expect.poll(() => slotOf(page, MOVE_A)).toBe(`${WEEK_START}/0`);
});

test("dropping a dinner on another day swaps them, cooks and all", async () => {
  await planWeeks(page, [
    { day: 0, name: MOVE_A, cook: "Eli" },
    { day: 2, name: MOVE_B, cook: "Minh" },
  ]);
  await page.reload();
  await gotoTab("Recipes");

  await slot(WEEK_START, 0)
    .getByRole("button", { name: `Move ${MOVE_A}` })
    .click();
  await slot(WEEK_START, 2)
    .getByRole("button", { name: /^Move to / })
    .click();

  // The cook travels with the dinner.
  await expect(slot(WEEK_START, 2).locator(".recipe-name")).toHaveText(MOVE_A);
  await expect(slot(WEEK_START, 2).locator(".recipe-cook")).toHaveText("Eli");
  await expect(slot(WEEK_START, 0).locator(".recipe-name")).toHaveText(MOVE_B);
  await expect(slot(WEEK_START, 0).locator(".recipe-cook")).toHaveText("Minh");
  await expect.poll(() => slotOf(page, MOVE_A)).toBe(`${WEEK_START}/2`);
  await expect.poll(() => slotOf(page, MOVE_B)).toBe(`${WEEK_START}/0`);
});

test("a dinner dropped on a no-meal day sends the marker to the day it left", async () => {
  await planWeeks(page, [{ day: 0, name: MOVE_A, cook: "Eli" }, { day: 4 }]);
  await page.reload();
  await gotoTab("Recipes");
  await expect(slot(WEEK_START, 4).locator(".no-meal-card")).toBeVisible();

  await slot(WEEK_START, 0)
    .getByRole("button", { name: `Move ${MOVE_A}` })
    .click();
  await slot(WEEK_START, 4)
    .getByRole("button", { name: /^Move to / })
    .click();

  await expect(slot(WEEK_START, 4).locator(".recipe-name")).toHaveText(MOVE_A);
  await expect(slot(WEEK_START, 0).locator(".no-meal-card")).toBeVisible();
  await expect.poll(() => slotOf(page, MOVE_A)).toBe(`${WEEK_START}/4`);
  await expect.poll(() => markerSlot(page)).toBe(`${WEEK_START}/0`);
});

test("a dinner moves into next week, and Escape drops a pending move", async () => {
  await planWeeks(page, [{ day: 0, name: MOVE_A, cook: "Eli" }]);
  await page.reload();
  await gotoTab("Recipes");

  // Escape first: the move is armed and then thrown away, and nothing has
  // been written when it is.
  await slot(WEEK_START, 0)
    .getByRole("button", { name: `Move ${MOVE_A}` })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".recipe-move-bar")).toHaveCount(0);
  await expect(page.locator(".recipe-move-target")).toHaveCount(0);
  await expect.poll(() => slotOf(page, MOVE_A)).toBe(`${WEEK_START}/0`);

  // Both weeks are on screen here, so next week is one tap away.
  await slot(WEEK_START, 0)
    .getByRole("button", { name: `Move ${MOVE_A}` })
    .click();
  await slot(NEXT_WEEK_START, 5)
    .getByRole("button", { name: /^Move to / })
    .click();
  await expect(slot(NEXT_WEEK_START, 5).locator(".recipe-name")).toHaveText(
    MOVE_A
  );
  await expect.poll(() => slotOf(page, MOVE_A)).toBe(`${NEXT_WEEK_START}/5`);
});

test("a mouse drag swaps two dinners", async () => {
  await planWeeks(page, [
    { day: 0, name: MOVE_A, cook: "Eli" },
    { day: 2, name: MOVE_B, cook: "Minh" },
  ]);
  await page.reload();
  await gotoTab("Recipes");

  const handle = slot(WEEK_START, 0).getByRole("button", {
    name: `Move ${MOVE_A}`,
  });
  const from = await handle.boundingBox();
  if (!from) throw new Error("no grab handle");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Past the 6px the mouse sensor waits for: this is a drag, not a tap.
  await page.mouse.move(
    from.x + from.width / 2 + 12,
    from.y + from.height / 2 + 12,
    { steps: 4 }
  );
  await expect(page.locator(".recipe-move-ghost")).toHaveText(MOVE_A);

  const target = await slot(WEEK_START, 2).boundingBox();
  if (!target) throw new Error("no target day");
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height / 2,
    { steps: 8 }
  );
  await expect(slot(WEEK_START, 2)).toHaveClass(/is-over/);
  // Viewport only, deliberately: a full-page shot resizes the page, and a
  // resize is exactly what dnd-kit cancels a drag on.
  await page.screenshot({ path: path.join(OUT, "14b-dragging-1920.png") });
  await page.mouse.up();

  await expect.poll(() => slotOf(page, MOVE_A)).toBe(`${WEEK_START}/2`);
  await expect.poll(() => slotOf(page, MOVE_B)).toBe(`${WEEK_START}/0`);
});

test("the arrow keys walk a dinner across the grid and Space drops it", async () => {
  await planWeeks(page, [{ day: 0, name: MOVE_A, cook: "Eli" }]);
  await page.reload();
  await gotoTab("Recipes");

  await page.evaluate(() => window.scrollTo(0, 0));
  await slot(WEEK_START, 0)
    .getByRole("button", { name: `Move ${MOVE_A}` })
    .focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".recipe-move-ghost")).toHaveText(MOVE_A);
  // dnd-kit measures the days it can land on a frame or two after the drag
  // starts, and an arrow key pressed before that has nothing to step to.
  await page.waitForTimeout(200);
  // The classic grid is two columns wide, so right is Monday and down is
  // Tuesday, the card under Sunday.
  await page.keyboard.press("ArrowRight");
  await expect(slot(WEEK_START, 1)).toHaveClass(/is-over/);
  await page.keyboard.press("ArrowDown");
  await expect(slot(WEEK_START, 3)).toHaveClass(/is-over/);
  await page.keyboard.press("Space");
  await expect.poll(() => slotOf(page, MOVE_A)).toBe(`${WEEK_START}/3`);
});

test("the editor offers a swap when the day it is moved to is taken", async () => {
  await planWeeks(page, [
    { day: 0, name: MOVE_A, cook: "Eli" },
    { day: 2, name: MOVE_B, cook: "Minh" },
  ]);
  await page.reload();
  await gotoTab("Recipes");

  await slot(WEEK_START, 0).locator(".recipe-card").click();
  await expect(page.getByRole("heading", { name: "Edit recipe" })).toBeVisible();
  // A field edit rides along with the day change: it must survive the swap.
  await page.locator("#r-desc").fill("Swapped in the editor");
  await page.locator("#r-day").selectOption("2");

  let asked = "";
  page.once("dialog", (d) => {
    asked = d.message();
    void d.accept();
  });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".modal-bg")).toHaveCount(0);
  expect(asked).toBe(`Swap with "${MOVE_B}"?`);

  await expect.poll(() => slotOf(page, MOVE_A)).toBe(`${WEEK_START}/2`);
  await expect.poll(() => slotOf(page, MOVE_B)).toBe(`${WEEK_START}/0`);
  await expect
    .poll(async () =>
      (await recipeRows(page)).find((r) => r.name === MOVE_A)?.description
    )
    .toBe("Swapped in the editor");
});

test("the editor moves a dinner onto a marker day rather than deleting it", async () => {
  await planWeeks(page, [{ day: 0, name: MOVE_A, cook: "Eli" }, { day: 1 }]);
  await page.reload();
  await gotoTab("Recipes");

  // Nothing may be asked: a marker is not a dinner the user has to agree to
  // trade with, and it is not destroyed either — it takes the vacated day.
  let asked = "";
  const onDialog = (d: Dialog) => {
    asked = d.message();
    void d.accept();
  };
  page.on("dialog", onDialog);

  await slot(WEEK_START, 0).locator(".recipe-card").click();
  await expect(page.getByRole("heading", { name: "Edit recipe" })).toBeVisible();
  // A field edit rides along with the day change: it must survive the move.
  await page.locator("#r-desc").fill("Moved onto the marker");
  await page.locator("#r-day").selectOption("1");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".modal-bg")).toHaveCount(0);
  page.off("dialog", onDialog);
  expect(asked).toBe("");

  await expect(slot(WEEK_START, 1).locator(".recipe-name")).toHaveText(MOVE_A);
  await expect(slot(WEEK_START, 0).locator(".no-meal-card")).toBeVisible();
  await expect.poll(() => slotOf(page, MOVE_A)).toBe(`${WEEK_START}/1`);
  await expect.poll(() => markerSlot(page)).toBe(`${WEEK_START}/0`);
  await expect
    .poll(async () =>
      (await recipeRows(page)).find((r) => r.name === MOVE_A)?.description
    )
    .toBe("Moved onto the marker");
});

test("the moving hint floats over the grid instead of pushing it down", async () => {
  await planWeeks(page, [{ day: 0, name: MOVE_A, cook: "Eli" }]);
  await page.reload();
  await gotoTab("Recipes");

  const row = slot(WEEK_START, 3);
  const rowTop = () => row.evaluate((el) => el.getBoundingClientRect().top);
  const before = await rowTop();

  await slot(WEEK_START, 0)
    .getByRole("button", { name: `Move ${MOVE_A}` })
    .click();
  await expect(page.locator(".recipe-move-bar")).toBeVisible();
  // The day the pointer was already aimed at has not moved under it.
  expect(await rowTop()).toBe(before);

  // An overlay covers whatever it is over, so the grid is scrolled past it;
  // what may never be covered is the first card, which is the one under the
  // hand that just picked a dinner up.
  const clear = await page.evaluate(() => {
    const bar = document
      .querySelector(".recipe-move-bar")!
      .getBoundingClientRect();
    const first = document
      .querySelector(".recipe-move-host")!
      .getBoundingClientRect();
    return first.bottom <= bar.top || first.top >= bar.bottom;
  });
  expect(clear).toBe(true);

  await page
    .locator(".recipe-move-bar")
    .getByRole("button", { name: "Cancel" })
    .click();
  expect(await rowTop()).toBe(before);
});

test("a move and the action after it share the one toast", async () => {
  await planWeeks(page, [{ day: 0, name: MOVE_A, cook: "Eli" }]);
  await page.reload();
  await gotoTab("Recipes");

  await slot(WEEK_START, 0)
    .getByRole("button", { name: `Move ${MOVE_A}` })
    .click();
  await slot(WEEK_START, 3)
    .getByRole("button", { name: /^Move to / })
    .click();
  await expect(page.locator(".toast.toast-action")).toContainText("Undo");
  expect(await page.locator(".toast").count()).toBe(1);

  // The next plain toast takes that same slot over; it never stacks on it.
  await slot(WEEK_START, 5)
    .getByRole("button", { name: "No meal" })
    .click();
  await expect(page.locator(".toast")).toContainText("Marked as no shared meal");
  expect(await page.locator(".toast").count()).toBe(1);
  await expect(page.locator(".toast-action-btn")).toHaveCount(0);
});

test("on a phone a swipe from a grab handle scrolls, and a hold drags", async () => {
  await planWeeks(page, [
    { day: 0, name: MOVE_A, cook: "Eli" },
    { day: 2, name: MOVE_B, cook: "Minh" },
    { day: 4, name: "Smoke Filler", cook: "Arthur" },
    { day: 5, name: "Smoke Filler Two", cook: "Arthur" },
  ]);
  const context = await browserRef.newContext({
    viewport: MOBILE,
    hasTouch: true,
  });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("hh_ui", "classic");
    } catch {
      /* ignore */
    }
  });
  const phone = await context.newPage();
  await loginOn(phone);
  await phone.locator(".tab-bar button").filter({ hasText: "Recipes" }).click();
  const cdp = await context.newCDPSession(phone);

  const phoneSlot = (day: number) =>
    phone.locator(
      `.recipe-move-host[data-week="${WEEK_START}"][data-day="${day}"]`
    );
  const handle = phoneSlot(0).getByRole("button", { name: `Move ${MOVE_A}` });
  const box = await handle.boundingBox();
  if (!box) throw new Error("no grab handle");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  // A flick up from the handle is a scroll, not a drag.
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (const dy of [12, 40, 90, 150]) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - dy }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(phone.locator(".recipe-move-ghost")).toHaveCount(0);
  await expect(phone.locator(".recipe-move-bar")).toHaveCount(0);
  expect(await phone.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  // Holding still for the delay, and only then moving, is a drag.
  await phone.evaluate(() => window.scrollTo(0, 0));
  await phone.waitForTimeout(200);
  const held = await handle.boundingBox();
  if (!held) throw new Error("no grab handle");
  const hx = held.x + held.width / 2;
  const hy = held.y + held.height / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: hx, y: hy }],
  });
  await phone.waitForTimeout(320);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: hx, y: hy + 4 }],
  });
  await expect(phone.locator(".recipe-move-ghost")).toHaveText(MOVE_A);
  const target = await phoneSlot(2).boundingBox();
  if (!target) throw new Error("no target day");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: target.x + target.width / 2, y: target.y + target.height / 2 },
    ],
  });
  await expect(phoneSlot(2)).toHaveClass(/is-over/);
  await phone.screenshot({ path: path.join(OUT, "14c-dragging-390.png") });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });

  await expect.poll(() => slotOf(page, MOVE_A)).toBe(`${WEEK_START}/2`);
  await expect.poll(() => slotOf(page, MOVE_B)).toBe(`${WEEK_START}/0`);
  await context.close();

  // Leave the week as this suite found it.
  await planWeeks(page, []);
  await page.reload();
});
