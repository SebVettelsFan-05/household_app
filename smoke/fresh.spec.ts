import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Fresh-UI smoke pass, driven against the local dev stack
 * (`npm run dev:local`, app on :3100, house password "dev").
 *
 * Fixtures are seeded through the API rather than by clicking, so the
 * assertions are about what the fresh shell renders, not about whether the
 * classic forms still work; `legacy.spec.ts` covers that.
 *
 * Screenshots land in `smoke/out/fresh/` for every screen at 390x844,
 * 1920x1080 and 2560x1400@1.5, in both themes.
 */

const OUT = path.join(__dirname, "out", "fresh");
const PASSWORD = "dev";
const HOUSEHOLD_TZ = "America/Toronto";
const MEAL_GROUP = ["Arthur", "Eli", "Minh"];

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const RECEIPT_PATH = path.join(OUT, "receipt.png");

const RECIPE_NAME = "Fresh Smoke Laksa";
const ITEM_NAME = "Freshsmokemilk";
const GROCERY_NAMES = ["Freshsmokechicken", "Freshsmokesoap"];

let page: Page;
let browserRef: Browser;

/* ---------- household-time helpers (mirrors lib/dates.ts) ---------- */

function zonedYmd(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HOUSEHOLD_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return parts; // en-CA formats as YYYY-MM-DD
}

function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + n));
  return next.toISOString().slice(0, 10);
}

function dowOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Sunday anchor of the active cooking week, skipping the dead weekend. */
function activeWeekStart(today: string): string {
  const dow = dowOf(today);
  return addDaysYmd(today, dow >= 5 ? 7 - dow : -dow);
}

const TODAY = zonedYmd(new Date());
const WEEK_START = activeWeekStart(TODAY);
const TODAY_DAY = dowOf(TODAY) <= 4 ? dowOf(TODAY) : -1;

/* ---------- fixtures ---------- */

async function clearMonthExpenses(api: APIRequestContext) {
  const month = TODAY.slice(0, 7);
  const res = await api.get("/api/expenses");
  const body = await res.json();
  for (const e of body.expenses ?? []) {
    const when: string = e.occurredOn || e.added || "";
    if (when.startsWith(month)) {
      await api.delete(`/api/expenses?id=${encodeURIComponent(e.id)}`);
    }
  }
}

async function resetFixtures(api: APIRequestContext) {
  await clearMonthExpenses(api);

  const grocery = await (await api.get("/api/grocery")).json();
  for (const g of grocery.grocery ?? []) {
    if (
      GROCERY_NAMES.some((n) =>
        String(g.name).toLowerCase().startsWith(n.toLowerCase())
      )
    ) {
      await api.delete(`/api/grocery?id=${encodeURIComponent(g.id)}`);
    }
  }

  const recipes = await (await api.get("/api/recipes")).json();
  for (const r of recipes.recipes ?? []) {
    if (r.noMeal || r.name === RECIPE_NAME || r.weekStart === WEEK_START) {
      await api.delete(`/api/recipes/${encodeURIComponent(r.id)}`);
    }
  }

  const items = await (await api.get("/api/items")).json();
  for (const it of items.items ?? []) {
    if (String(it.name).toLowerCase().startsWith(ITEM_NAME.toLowerCase())) {
      await api.delete(`/api/items?id=${encodeURIComponent(it.id)}`);
    }
  }
}

async function seedFixtures(api: APIRequestContext) {
  await api.put("/api/settings/meal_group", {
    data: { value: { members: MEAL_GROUP } },
  });

  await api.post("/api/grocery", {
    data: {
      name: GROCERY_NAMES[0],
      quantity: 500,
      category: "Meat",
      addedBy: "Arthur",
      pool: "meals",
    },
  });
  await api.post("/api/grocery", {
    data: {
      name: GROCERY_NAMES[1],
      quantity: 300,
      category: "Other",
      addedBy: "Daniel",
      pool: "house",
    },
  });

  if (TODAY_DAY >= 0) {
    await api.post("/api/recipes", {
      data: {
        weekStart: WEEK_START,
        day: TODAY_DAY,
        assignedTo: "Eli",
        name: RECIPE_NAME,
        ingredients: [{ name: "Coconut milk", quantity: 400, category: "Pantry" }],
        servings: 4,
        portions: 3,
      },
    });
  }

  await api.post("/api/items", {
    data: {
      name: ITEM_NAME,
      quantity: 750,
      expiry: addDaysYmd(TODAY, 1),
      category: "Dairy",
      owner: "Minh",
    },
  });
}

/** The seeded receipt: $90 to the meal group, $30 to the whole house. */
async function seedSplitExpense(api: APIRequestContext) {
  const res = await api.post("/api/expenses", {
    multipart: {
      amountCents: "12000",
      store: "Costco",
      paidBy: "Arthur",
      occurredOn: TODAY,
      allocations: JSON.stringify([
        { kind: "meals", amountCents: 9000 },
        { kind: "house", amountCents: 3000 },
      ]),
      receipt: {
        name: "receipt.png",
        mimeType: "image/png",
        buffer: TINY_PNG,
      },
    },
  });
  expect(res.ok()).toBeTruthy();
}

/* ---------- navigation ---------- */

async function login(p: Page) {
  await p.goto("/");
  if (p.url().includes("/login")) {
    await p.locator('input[type="password"]').fill(PASSWORD);
    await p.getByRole("button", { name: /sign in|enter|continue/i }).click();
    await p.waitForURL((url) => !url.pathname.startsWith("/login"));
  }
  await p.locator(".fresh, .wrap").first().waitFor();
  // Next's dev overlay parks a portal in the bottom-left corner, right on
  // top of the phone tab bar. It is not part of the app.
  await p.addStyleTag({
    content: "nextjs-portal{display:none!important}",
  });
}

/** Rail on desktop, bottom tab bar on phones. */
async function gotoTab(p: Page, label: string) {
  const width = p.viewportSize()?.width ?? 1920;
  if (width >= 720) {
    await p.locator(".fresh-rail button", { hasText: label }).first().click();
    return;
  }
  const phoneTabs = ["Home", "Grocery", "Recipes", "Expenses", "More"];
  if (phoneTabs.includes(label)) {
    await p.locator(".fresh-tabbar button", { hasText: label }).first().click();
    return;
  }
  await p.locator(".fresh-tabbar button", { hasText: "More" }).first().click();
  await p.locator(".fresh-row", { hasText: label }).first().click();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  browserRef = browser;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(RECEIPT_PATH, TINY_PNG);
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await login(page);
  await resetFixtures(page.request);
  await seedFixtures(page.request);
  await seedSplitExpense(page.request);
  await page.reload();
});

test.afterAll(async () => {
  // Leave the dev database as this suite found it: the classic suite runs
  // next in the same process and counts cooks, rows and receipts.
  await resetFixtures(page.request);
  await page.close();
});

test("a device with no stored choice lands on the fresh shell", async () => {
  await expect(page.locator(".fresh")).toBeVisible();
  await expect(page.locator(".fresh-rail")).toBeVisible();
  const stored = await page.evaluate(() =>
    window.localStorage.getItem("hh_ui")
  );
  // Nothing is written until the user actually picks a look.
  expect(stored).toBeNull();
});

test("the look switches to classic and back, and sticks", async () => {
  await page.locator(".fresh-rail button", { hasText: "Classic look" }).click();
  await expect(page.locator(".wrap")).toBeVisible();
  await expect(page.locator(".tab-bar")).toBeVisible();
  expect(
    await page.evaluate(() => window.localStorage.getItem("hh_ui"))
  ).toBe("classic");

  await page.reload();
  await expect(page.locator(".wrap")).toBeVisible();

  await page.getByRole("button", { name: "Household settings" }).click();
  await page.getByRole("button", { name: "Try the new look" }).click();
  await expect(page.locator(".fresh")).toBeVisible();
  expect(
    await page.evaluate(() => window.localStorage.getItem("hh_ui"))
  ).toBe("fresh");

  await page.reload();
  await expect(page.locator(".fresh")).toBeVisible();
});

test("home reads tonight's dinner, the settlement and the open list", async () => {
  await gotoTab(page, "Home");
  const tonight = page.locator(".fresh-card").first();

  if (TODAY_DAY >= 0) {
    await expect(tonight.locator(".fresh-tonight-dish")).toHaveText(
      RECIPE_NAME
    );
    await expect(tonight).toContainText("Eli is cooking");
    await expect(tonight).toContainText("3 portions");
  } else {
    await expect(tonight).toContainText("No dinner slot today");
  }

  // $90 over three diners, $30 over five: Daniel owes the house share only.
  const settlement = page.locator(".fresh-card", { hasText: "This month" });
  await expect(
    settlement.locator(".fresh-settle-row", { hasText: "Daniel" })
  ).toContainText("Send $6.00");
  await expect(
    settlement.locator(".fresh-settle-row", { hasText: "Arthur" })
  ).toContainText("Withdraw");

  // Other rows may already be on the list, so check the counts against what
  // the API actually holds rather than against the two rows seeded here.
  const grocery = await (await page.request.get("/api/grocery")).json();
  const openByPool = new Map<string, number>([
    ["meals", 0],
    ["house", 0],
    ["personal", 0],
  ]);
  for (const g of grocery.grocery ?? []) {
    if (g.done) continue;
    const pool = g.pool ?? "house";
    openByPool.set(pool, (openByPool.get(pool) ?? 0) + 1);
  }
  const list = page.locator(".fresh-card", { hasText: "Still to buy" });
  for (const [pool, label] of [
    ["meals", "Meals"],
    ["house", "House"],
    ["personal", "Personal"],
  ] as const) {
    const n = openByPool.get(pool) ?? 0;
    await expect(
      list.locator(".fresh-settle-row", { hasText: label })
    ).toContainText(`${n} item${n === 1 ? "" : "s"}`);
  }
  expect(openByPool.get("meals")).toBeGreaterThan(0);
  expect(openByPool.get("house")).toBeGreaterThan(0);

  const expiring = page.locator(".fresh-card", { hasText: "Expiring soon" });
  await expect(expiring).toContainText(ITEM_NAME);
  await expect(expiring).toContainText("Expires tomorrow");
});

test("an expense added through the fresh sheet settles Daniel at $6.00", async () => {
  // Start from an empty month so the only receipt is the one typed here.
  await clearMonthExpenses(page.request);
  await page.reload();
  await gotoTab(page, "Expenses");

  await page.getByRole("button", { name: "Add expense" }).click();
  const sheet = page.locator(".fresh-sheet");
  await expect(sheet).toBeVisible();

  await sheet.locator("#fx-amount").fill("120.00");
  await sheet.locator(".fresh-chip", { hasText: "Arthur" }).click();

  const line1 = sheet.locator(".alloc-line").nth(0);
  await line1.getByRole("button", { name: "Meals" }).click();
  await line1.getByLabel("Amount for split line 1").fill("90.00");

  await sheet.getByRole("button", { name: "+ Split receipt" }).click();
  const line2 = sheet.locator(".alloc-line").nth(1);
  await line2.getByRole("button", { name: "Everyone" }).click();
  await line2.getByLabel("Amount for split line 2").fill("30.00");
  await expect(sheet.locator(".alloc-remainder")).toHaveText(
    "Unallocated $0.00"
  );

  await sheet.locator("#fx-store").fill("Costco");
  await sheet.locator("#fx-receipt").setInputFiles(RECEIPT_PATH);
  await sheet
    .locator(".fresh-sheet-actions")
    .getByRole("button", { name: "Add expense" })
    .click();

  await expect(page.locator(".fresh-sheet")).toHaveCount(0, {
    timeout: 20_000,
  });

  const row = page.locator(".fresh-row", { hasText: "Costco" }).first();
  await expect(row).toBeVisible();
  await expect(row.locator(".alloc-summary")).toHaveText(
    "Meals (3) $90.00 · Everyone $30.00"
  );

  const settlement = page.locator(".fresh-settlement-col");
  await expect(
    settlement.locator(".fresh-settle-row", { hasText: "Daniel" })
  ).toContainText("Send $6.00");
});

test("dismissing the sheet never activates what is under it", async () => {
  await gotoTab(page, "Expenses");
  await page.getByRole("button", { name: "Add expense" }).first().click();
  await expect(page.locator(".fresh-sheet")).toBeVisible();

  // A point on the backdrop that sits directly over the expense list. If the
  // click leaked through, the edit modal would open behind the sheet.
  await page.mouse.click(900, 120);

  await expect(page.locator(".fresh-sheet")).toHaveCount(0);
  await expect(page.locator(".modal-bg")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Current" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
});

test("the month segment still shows the classic breakdown", async () => {
  await page.getByRole("tab", { name: "Month" }).click();
  await expect(page.locator(".monthly-card")).toBeVisible();
  await expect(
    page.locator(".split-group li", { hasText: "Daniel" }).first()
  ).toContainText("Share $6.00");
  await page.getByRole("tab", { name: "Current" }).click();
});

test("a grocery row can be added to the meals pool from the fresh shell", async () => {
  await gotoTab(page, "Grocery");
  await page.getByRole("button", { name: "Add to list" }).first().click();
  const sheet = page.locator(".fresh-sheet");
  await expect(sheet).toBeVisible();

  await sheet.locator("#g-name").fill("Freshsmokesoap");
  await sheet.locator("#g-qty").fill("250");
  await sheet.locator(".pool-chips").getByRole("button", { name: "Meals" }).click();
  await sheet.locator("#g-by").selectOption("Eli");
  await sheet.getByRole("button", { name: "Add to list" }).click();
  await expect(page.locator(".fresh-sheet")).toHaveCount(0, {
    timeout: 15_000,
  });

  const meals = page.locator(".fresh-section", { hasText: "Meals" }).first();
  await expect(
    meals.locator(".fresh-row", { hasText: "Freshsmokesoap" })
  ).toContainText("For Eli");
});

test("the recipes tab tallies the cooks", async () => {
  await gotoTab(page, "Recipes");
  const week = page.locator(".fresh-section", { hasText: "This week" }).first();
  if (TODAY_DAY >= 0) {
    await expect(week.locator(".fresh-cook-tally")).toContainText("Eli 1");
    await expect(week.locator(".fresh-day-row", { hasText: RECIPE_NAME })).toBeVisible();
  } else {
    await expect(week.locator(".fresh-cook-tally")).toContainText("No cooks yet");
  }
});

/* ---------- screenshots ---------- */

const VIEWPORTS = [
  { name: "390", width: 390, height: 844, dsf: 1 },
  { name: "1920", width: 1920, height: 1080, dsf: 1 },
  { name: "2560", width: 2560, height: 1400, dsf: 1.5 },
];

const SCREENS: { file: string; tab: string; phoneOnly?: boolean }[] = [
  { file: "home", tab: "Home" },
  { file: "grocery", tab: "Grocery" },
  { file: "recipes", tab: "Recipes" },
  { file: "expenses", tab: "Expenses" },
  { file: "inventory", tab: "Inventory" },
  { file: "passwords", tab: "Passwords" },
  { file: "more", tab: "More", phoneOnly: true },
];

test("every fresh screen is captured in both themes and all three sizes", async () => {
  test.setTimeout(240_000);
  for (const theme of ["light", "dark"] as const) {
    for (const vp of VIEWPORTS) {
      const context = await browserRef.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.dsf,
      });
      await context.addInitScript(
        ([t]) => {
          try {
            window.localStorage.setItem("theme", t as string);
            window.localStorage.setItem("hh_ui", "fresh");
          } catch {
            /* ignore */
          }
        },
        [theme]
      );
      const p = await context.newPage();
      await login(p);
      await expect(p.locator(".fresh")).toBeVisible();

      for (const screen of SCREENS) {
        if (screen.phoneOnly && vp.width >= 720) continue;
        await gotoTab(p, screen.tab);
        await p.waitForTimeout(250);
        await p.screenshot({
          fullPage: true,
          animations: "disabled",
          path: path.join(OUT, `${screen.file}-${theme}-${vp.name}.png`),
        });
        if (screen.file === "expenses") {
          await p.getByRole("tab", { name: "Month" }).click();
          await p.locator(".monthly-card").waitFor();
          await p.waitForTimeout(250);
          await p.screenshot({
            fullPage: true,
            animations: "disabled",
            path: path.join(OUT, `expenses-month-${theme}-${vp.name}.png`),
          });
          await p.getByRole("tab", { name: "Current" }).click();
        }
      }

      // The add sheet is a screen of its own.
      await gotoTab(p, "Expenses");
      await p.getByRole("button", { name: "Add expense" }).first().click();
      await p.locator(".fresh-sheet").waitFor();
      await p.waitForTimeout(250);
      await p.screenshot({
        animations: "disabled",
        path: path.join(OUT, `expense-sheet-${theme}-${vp.name}.png`),
      });

      await context.close();
    }
  }
});
