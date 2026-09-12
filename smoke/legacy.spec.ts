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
const HOUSEHOLD_TZ = "America/Toronto";
const RECIPE_NAME = "Smoke Green Curry";
const ITEM_NAME = "Smokeyogurt";
// The recipe's only ingredient. The suite hand-adds it to the grocery list
// first, then pushes the recipe onto the same row to prove they merge.
const INGREDIENT_NAME = "Coconut milk";

let page: Page;

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

async function login() {
  await page.goto("/");
  if (page.url().includes("/login")) {
    await typePassword(page, PASSWORD);
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
