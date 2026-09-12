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
 * 1920x1080 and 2560x1400@1.5, in both themes. The phone shots are
 * viewport-only, plus a scrolled-to-bottom frame, because a full-page shot
 * of a phone screen hides exactly the thing that goes wrong on a phone.
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
// [0] and [1] are seeded through the API; [2] is typed into the add sheet.
const GROCERY_NAMES = [
  "Freshsmokechicken",
  "Freshsmokesoap",
  "Freshsmokerice",
];

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

/** Sunday anchor of the cooking week today falls in. */
function activeWeekStart(today: string): string {
  return addDaysYmd(today, -dowOf(today));
}

const TODAY = zonedYmd(new Date());
const WEEK_START = activeWeekStart(TODAY);
// The cooking week is Sunday through Saturday, so today always has a slot.
const TODAY_DAY = dowOf(TODAY);

/** "Sep 11" from a YYYY-MM-DD, mirroring `fmtTripDate` in lib/monthlyBills. */
function tripDateLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
  });
}

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
      [...GROCERY_NAMES, ITEM_NAME].some((n) =>
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
  // The settlement assertions assume no rent or recurring bills this month
  // (the local seed script fills them in; clear them so the suite is
  // independent of whatever the dev DB holds).
  await api.put("/api/settings/rent_alloc", { data: { value: { schedule: [], overrides: {} } } });
  await api.put("/api/settings/recurring_fixed", { data: { value: [] } });
  await api.put("/api/settings/recurring_variable", { data: { value: { lines: [], amounts: {} } } });

  await api.post("/api/grocery", {
    data: {
      name: GROCERY_NAMES[0],
      quantity: 500,
      category: "Meat",
      categoryReviewed: true,
      addedBy: "Arthur",
    },
  });
  await api.post("/api/grocery", {
    data: {
      name: GROCERY_NAMES[1],
      quantity: 300,
      category: "Other",
      categoryReviewed: true,
      addedBy: "Daniel",
    },
  });

  // Same name as the inventory fixture below, so the row carries the
  // "have 750g" warning chip on its meta line.
  await api.post("/api/grocery", {
    data: {
      name: ITEM_NAME,
      quantity: 200,
      category: "Dairy",
      categoryReviewed: true,
      addedBy: "Minh",
    },
  });

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

  await api.post("/api/items", {
    data: {
      name: ITEM_NAME,
      quantity: 750,
      expiry: addDaysYmd(TODAY, 1),
      category: "Dairy",
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

/**
 * Scroll to the very bottom. Twice, because the web fonts finish loading a
 * beat after first paint and the resulting reflow nudges the scroll position
 * back up.
 */
async function scrollToBottom(p: Page) {
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(400);
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(200);
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
  // The only way out of the fresh shell is the settings sheet.
  await page.getByRole("button", { name: "Household settings" }).first().click();
  await page
    .locator(".fresh-sheet")
    .getByRole("button", { name: "Classic", exact: true })
    .click();
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

test("home reads tonight's dinner, the money block and the open list", async () => {
  await gotoTab(page, "Home");

  const tonight = page.locator(".fresh-tonight");
  await expect(tonight.locator(".fresh-tonight-dish")).toHaveText(RECIPE_NAME);
  await expect(tonight.locator(".fresh-person-name")).toHaveText("Eli");
  await expect(tonight).toContainText("3 portions");
  await expect(tonight).toContainText("1 ingredient");

  // $90 over three diners, $30 over five: Daniel owes the house share only.
  const monthName = new Date().toLocaleString("en-US", { month: "long" });
  const money = page.locator(".fresh-card", { hasText: monthName }).first();
  await expect(
    money.locator(".fresh-money-row", { hasText: "Daniel" })
  ).toContainText("Send $6.00");
  await expect(
    money.locator(".fresh-money-row", { hasText: "Arthur" })
  ).toContainText("Withdraw");
  await expect(money.locator(".fresh-money-total")).toContainText(
    "Household total"
  );

  // Other rows may already be on the list, so check the count against what
  // the API actually holds rather than against the two rows seeded here.
  const grocery = await (await page.request.get("/api/grocery")).json();
  const openCount = (grocery.grocery ?? []).filter(
    (g: { done: boolean }) => !g.done
  ).length;
  expect(openCount).toBeGreaterThan(0);
  const toBuy = page.locator(".fresh-counter");
  await expect(toBuy).toHaveCount(1);
  await expect(toBuy.locator(".fresh-counter-num")).toHaveText(
    String(openCount)
  );
  await expect(toBuy).toContainText("Still to buy");
  // Up to four of the names, so the card says what is actually missing.
  await expect(toBuy.locator(".fresh-counter-names")).toBeVisible();

  const useSoon = page.locator(".fresh-card", { hasText: "Use soon" });
  await expect(useSoon).toContainText(ITEM_NAME);
  await expect(useSoon).toContainText("Expires tomorrow");
  // No owner disc: inventory is shared household food again.
  await expect(
    useSoon.locator(".fresh-row", { hasText: ITEM_NAME }).locator(".fresh-avatar")
  ).toHaveCount(0);
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
  await expect(row.locator(".fresh-split-tag").nth(0)).toHaveText("Meals 3");
  await expect(row.locator(".fresh-split-tag").nth(1)).toHaveText("Everyone");
  await expect(row.locator(".fresh-row-amount")).toHaveText("$120.00");
  // The payer reads as a disc plus a name.
  await expect(row.locator(".fresh-avatar")).toHaveText("A");

  const settlement = page.locator(".fresh-settlement-col");
  await expect(
    settlement.locator(".fresh-settle-row", { hasText: "Daniel" })
  ).toContainText("Send $6.00");
});

test("dismissing the sheet never activates what is under it", async () => {
  await gotoTab(page, "Expenses");
  const row = page.locator(".fresh-row", { hasText: "Costco" }).first();
  const rowBox = await row.boundingBox();
  expect(rowBox).not.toBeNull();

  await page.getByRole("button", { name: "Add expense" }).first().click();
  const sheetBox = await page.locator(".fresh-sheet").boundingBox();
  expect(sheetBox).not.toBeNull();

  // A point on the backdrop that sits directly over the expense row, but
  // clear of the centred dialog. If the click leaked through, the edit modal
  // would open behind the sheet.
  const x = rowBox!.x + 12;
  const y = rowBox!.y + rowBox!.height / 2;
  expect(x).toBeLessThan(sheetBox!.x);
  await page.mouse.click(x, y);

  await expect(page.locator(".fresh-sheet")).toHaveCount(0);
  await expect(page.locator(".modal-bg")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Receipts" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
});

test("the month segment renders the fresh month view", async () => {
  await page.getByRole("tab", { name: "Month" }).click();
  await expect(page.locator(".fresh-month")).toBeVisible();
  // No classic chrome leaks into it.
  await expect(page.locator(".monthly-card")).toHaveCount(0);
  // Personal receipt lines are gone from the model's copy.
  await expect(page.locator(".fresh-month")).not.toContainText(
    "Personal items"
  );
  await expect(
    page.locator(".fresh-month .fresh-settle-row", { hasText: "Daniel" })
  ).toContainText("Send $6.00");
  // Every store the month knows about is one expandable row.
  const costco = page
    .locator(".fresh-month .fresh-row", { hasText: "Costco" })
    .first();
  await expect(costco).toHaveAttribute("aria-expanded", "false");
  await costco.click();
  await expect(costco).toHaveAttribute("aria-expanded", "true");
  const trip = page.locator(".fresh-trip").first();
  await expect(trip).toBeVisible();
  // A trip is named by its date, the way the classic breakdown names it;
  // a receipt with no description says nothing rather than "Untitled".
  await expect(trip.locator(".fresh-trip-title")).toHaveText(tripDateLabel(TODAY));
  await expect(trip).not.toContainText("Untitled");
  await page.getByRole("tab", { name: "Receipts" }).click();
});

/** Name to signed cents, positive meaning "send to the joint account". */
async function freshSettlement(p: Page): Promise<Record<string, number>> {
  return p.locator(".fresh-month").evaluate((root) => {
    const out: Record<string, number> = {};
    for (const row of root.querySelectorAll(".fresh-settle-row")) {
      const name = row.querySelector(".fresh-settle-name")?.textContent ?? "";
      const amount = row.querySelector(".fresh-money-amount");
      const cents = Math.round(
        parseFloat((amount?.textContent ?? "").replace(/[^0-9.]/g, "") || "0") *
          100
      );
      if (!amount || amount.classList.contains("even")) continue;
      out[name] = amount.classList.contains("withdraw") ? -cents : cents;
    }
    return out;
  });
}

async function classicSettlement(p: Page): Promise<Record<string, number>> {
  return p.locator(".monthly-card").evaluate((root) => {
    const out: Record<string, number> = {};
    for (const group of root.querySelectorAll(".split-group")) {
      const sign = group.classList.contains("split-group-send") ? 1 : -1;
      for (const li of group.querySelectorAll("li")) {
        const name = li.querySelector(".split-name")?.textContent ?? "";
        const cents = Math.round(
          parseFloat(
            (li.querySelector(".split-amount")?.textContent ?? "").replace(
              /[^0-9.]/g,
              ""
            ) || "0"
          ) * 100
        );
        out[name] = sign * cents;
      }
    }
    return out;
  });
}

test("the fresh month and the classic breakdown settle to the same numbers", async () => {
  // A fixed bill fronted by one person (the household's Internet convention)
  // must credit that person in full even though the row no longer says so.
  await page.request.put("/api/settings/recurring_fixed", {
    data: {
      value: [
        {
          id: "fixed-mainstay-internet",
          name: "Internet",
          protected: true,
          paidBy: "Arthur",
          activeFrom: "2026-05",
          schedule: [{ from: "2026-05", cents: 8999 }],
          overrides: {},
        },
      ],
    },
  });
  await page.reload();
  await gotoTab(page, "Expenses");
  await page.getByRole("tab", { name: "Month" }).click();
  await page.locator(".fresh-month").waitFor();
  await page.locator(".fresh-month .fresh-settle-row").first().waitFor();
  const internetRow = page.locator(".fresh-month .fresh-bill-row", { hasText: "Internet" });
  await expect(internetRow).toBeVisible();
  await expect(internetRow).not.toContainText("Paid by");
  const arthur = page.locator(".fresh-month .fresh-settle-row", { hasText: "Arthur" });
  await arthur.click();
  // $120 receipt plus the $89.99 Internet bill fronted by Arthur.
  await expect(arthur.locator("xpath=..")).toContainText("Paid $209.99");
  await arthur.click();
  const fresh = await freshSettlement(page);
  expect(Object.keys(fresh).length).toBeGreaterThan(0);

  await page.evaluate(() => window.localStorage.setItem("hh_ui", "classic"));
  await page.reload();
  await page.locator(".wrap").waitFor();

  // While we are in the classic shell: its modal chrome must still be exactly
  // the markup it has always been, with no wrapper introduced by ModalFrame.
  await page.getByRole("button", { name: "Household settings" }).click();
  await page.locator(".modal-bg").waitFor();
  const chrome = await page.locator(".modal-bg").evaluate((el) => {
    const box = el.firstElementChild as HTMLElement;
    return {
      backdrop: el.className,
      backdropChildren: el.children.length,
      box: box.className,
      children: Array.from(box.children).map(
        (c) =>
          c.tagName.toLowerCase() +
          (c.className ? "." + String(c.className).split(" ").join(".") : "")
      ),
    };
  });
  expect(chrome).toEqual({
    backdrop: "modal-bg",
    backdropChildren: 1,
    box: "modal",
    children: ["h2", "div.field", "div.modal-actions"],
  });
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-bg")).toHaveCount(0);

  await page.locator(".tab-bar button", { hasText: "Expenses" }).click();
  await page.getByRole("button", { name: "Monthly", exact: true }).click();
  await page.locator(".monthly-card").waitFor();
  await page.locator(".split-card").waitFor();
  await expect(page.locator(".monthly-card")).not.toContainText(
    "Personal items"
  );
  const classic = await classicSettlement(page);
  expect(fresh).toEqual(classic);

  await page.request.put("/api/settings/recurring_fixed", { data: { value: [] } });
  await page.evaluate(() => window.localStorage.setItem("hh_ui", "fresh"));
  await page.reload();
  await expect(page.locator(".fresh")).toBeVisible();
});

test("dark mode and the classic look live in the settings sheet", async () => {
  await expect(page.locator(".fresh-top .theme-toggle")).toHaveCount(0);

  await page.getByRole("button", { name: "Household settings" }).first().click();
  const sheet = page.locator(".fresh-sheet");
  await expect(sheet).toBeVisible();

  await sheet.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await sheet.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await sheet.getByRole("button", { name: "Classic", exact: true }).click();
  await expect(page.locator(".wrap")).toBeVisible();
  expect(
    await page.evaluate(() => window.localStorage.getItem("hh_ui"))
  ).toBe("classic");

  // The classic settings modal keeps its own way back.
  await page.getByRole("button", { name: "Household settings" }).click();
  await page.getByRole("button", { name: "Try the new look" }).click();
  await expect(page.locator(".fresh")).toBeVisible();
});

test("the rail sits in the same place on every section", async () => {
  for (const width of [1280, 1920, 2560]) {
    await page.setViewportSize({ width, height: 1000 });
    const lefts: number[] = [];
    for (const label of [
      "Home",
      "Recipes",
      "Grocery",
      "Expenses",
      "Inventory",
      "Passwords",
    ]) {
      await gotoTab(page, label);
      await page.locator(".fresh-rail").waitFor();
      await page.waitForTimeout(150);
      lefts.push(
        await page
          .locator(".fresh-rail")
          .evaluate((el) => el.getBoundingClientRect().left)
      );
    }
    // Identical on every section, or the rail slides sideways as you browse.
    expect(new Set(lefts).size, `rail moved at ${width}px: ${lefts}`).toBe(1);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoTab(page, "Expenses");
});

test("the fresh list groups its rows under category headings", async () => {
  await gotoTab(page, "Grocery");
  // The seeded rows sit under the category they were filed in.
  const meat = page
    .locator(".fresh-section")
    .filter({ has: page.locator(".fresh-h2", { hasText: "Meat" }) });
  await expect(
    meat.locator(".fresh-row", { hasText: GROCERY_NAMES[0] })
  ).toHaveCount(1);
  // Each heading carries the category's colour dot.
  await expect(meat.locator(".fresh-cat-dot")).toBeVisible();
  // Nothing is tagged by pool any longer.
  await expect(page.locator(".fresh-pool-tag[data-pool=\"meals\"]")).toHaveCount(0);

  await page.getByRole("button", { name: "Add item" }).first().click();
  const sheet = page.locator(".fresh-sheet");
  await expect(sheet).toBeVisible();

  await sheet.locator("#g-name").fill(GROCERY_NAMES[2]);
  await sheet.locator("#g-qty").fill("250");
  await sheet
    .locator(".cat-pills")
    .getByRole("button", { name: "Pantry", exact: true })
    .click();
  // "Added by" is a row of person discs in the fresh shell, not a <select>.
  await sheet.locator(".fresh-chip-person", { hasText: "Eli" }).click();
  await sheet.getByRole("button", { name: "Add to list" }).click();
  await expect(page.locator(".fresh-sheet")).toHaveCount(0, {
    timeout: 15_000,
  });

  const pantry = page
    .locator(".fresh-section")
    .filter({ has: page.locator(".fresh-h2", { hasText: "Pantry" }) });
  const added = pantry.locator(".fresh-row", { hasText: GROCERY_NAMES[2] });
  await expect(added).toContainText("Eli");
  await expect(added.locator(".fresh-avatar")).toHaveText("E");
  await expect(added.locator(".fresh-row-qty")).toHaveText("250g");

  // The chip row is an additive filter like classic's: chips stack, a
  // second tap removes one, and All clears the set.
  await page.locator(".fresh-chip", { hasText: "Pantry" }).first().click();
  await expect(page.locator(".fresh-section .fresh-h2")).toHaveText(["Pantry"]);
  await page.locator(".fresh-chip", { hasText: "Meat" }).first().click();
  await expect(page.locator(".fresh-section .fresh-h2")).toHaveText(["Meat", "Pantry"]);
  await page.locator(".fresh-chip", { hasText: "Pantry" }).first().click();
  await expect(page.locator(".fresh-section .fresh-h2")).toHaveText(["Meat"]);
  await page.locator(".fresh-chip", { hasText: "All" }).first().click();
  await expect(page.locator(".fresh-chip", { hasText: "All" }).first()).toHaveAttribute("aria-pressed", "true");

  // The house already holds 750g of the milk fixture, and that warning rides
  // on the meta line as a chip rather than adding a third line to the row.
  const already = page.locator(".fresh-row", { hasText: ITEM_NAME }).first();
  await expect(already.locator(".fresh-row-warn")).toHaveText("have 750g in the inventory already");
  await expect(
    already.locator(".fresh-row-meta .fresh-row-warn")
  ).toHaveCount(1);
});

test("the inventory sorts without losing its category groups", async () => {
  await gotoTab(page, "Inventory");
  const groups = page.locator(".fresh-section .fresh-h2");
  await expect(groups.first()).toBeVisible();
  for (const label of ["Newest", "Qty", "Expiry", "A to Z"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(groups.first()).toBeVisible();
  }
});

test("the recipes tab tallies the cooks", async () => {
  await gotoTab(page, "Recipes");
  const week = page.locator(".fresh-week", { hasText: "This week" }).first();
  await expect(week.locator(".fresh-cook-tally")).toContainText("Eli 1");
  await expect(
    week.locator(".fresh-day-card", { hasText: RECIPE_NAME })
  ).toBeVisible();
  // Today is ringed on the strip and carries a filled dot in Eli's colour.
  await expect(week.locator(".fresh-strip-day.today")).toHaveCount(1);
  await expect(week.locator(".fresh-strip-dot.filled")).toHaveCount(1);
});

test("a Saturday dinner is a real slot in both shells", async () => {
  // The week is Sunday through Saturday; seed a Saturday in NEXT week so it
  // never collides with today's fixture recipe.
  const satWeek = addDaysYmd(WEEK_START, 7);
  const name = "Fresh Smoke Saturday Roast";
  const res = await page.request.post("/api/recipes", {
    data: { weekStart: satWeek, day: 6, assignedTo: "Minh", name, ingredients: [] },
  });
  expect(res.ok()).toBeTruthy();
  await page.reload();
  await gotoTab(page, "Recipes");
  const week = page.locator(".fresh-week", { hasText: "Next week" }).first();
  const card = week.locator(".fresh-day-card", { hasText: name });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Sat");
  // The reused classic modal must offer all seven days and show Saturday.
  await card.locator(".fresh-day-open, button").first().click();
  const daySelect = page.locator(".fresh-sheet select").nth(1);
  await expect(daySelect.locator("option")).toHaveCount(7);
  await expect(daySelect).toHaveValue("6");
  await page.keyboard.press("Escape");
  const list = await (await page.request.get("/api/recipes")).json();
  for (const r of list.recipes) {
    if (r.name === name) await page.request.delete(`/api/recipes/${encodeURIComponent(r.id)}`);
  }
});

/* ---------- phone geometry ---------- */

test("on a phone the FAB clears the last row and inputs do not zoom iOS", async () => {
  const context = await browserRef.newContext({
    viewport: { width: 390, height: 844 },
  });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("hh_ui", "fresh");
    } catch {
      /* ignore */
    }
  });
  const p = await context.newPage();
  await login(p);
  await gotoTab(p, "Grocery");
  await p.locator(".fresh-row").first().waitFor();
  await scrollToBottom(p);

  const fab = await p.locator(".fresh-fab").boundingBox();
  const rows = p.locator(".fresh-row");
  const lastRow = await rows.nth((await rows.count()) - 1).boundingBox();
  expect(fab).not.toBeNull();
  expect(lastRow).not.toBeNull();
  // Nothing tappable hides under the button.
  expect(lastRow!.y + lastRow!.height).toBeLessThanOrEqual(fab!.y);

  // The bottom nav is the last thing on screen. 56px plus whatever the
  // device reserves below it, which is nothing in a desktop browser: any
  // taller and Safari's own bottom bar eats the screen with it.
  const nav = await p.locator(".fresh-tabbar").boundingBox();
  expect(nav!.height).toBe(56);

  // More is settings + destinations only; the look lives in settings now.
  await p.locator(".fresh-tabbar button", { hasText: "More" }).first().click();
  await expect(p.locator(".fresh-more")).toBeVisible();
  await expect(p.locator(".fresh-more")).not.toContainText("Classic look");
  await expect(
    p.locator(".fresh-row", { hasText: "Household settings" })
  ).toContainText("Appearance, look and household preferences");

  // 16px inputs, or iOS zooms the page on focus.
  await gotoTab(p, "Expenses");
  await p.getByRole("button", { name: "Add expense" }).first().click();
  await p.locator("#fx-amount").waitFor();
  for (const sel of ["#fx-amount", "#fx-store", "#fx-date"]) {
    const size = await p
      .locator(sel)
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
  }
  await context.close();
});

test("no fresh screen overflows a narrow phone sideways", async () => {
  const context = await browserRef.newContext({
    viewport: { width: 390, height: 844 },
  });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("hh_ui", "fresh");
    } catch {
      /* ignore */
    }
  });
  const p = await context.newPage();
  await login(p);

  for (const label of [
    "Home",
    "Recipes",
    "Grocery",
    "Expenses",
    "More",
    "Inventory",
    "Passwords",
  ]) {
    await gotoTab(p, label);
    await p.locator(".fresh-main").waitFor();
    for (const width of [320, 360, 375, 390, 414]) {
      await p.setViewportSize({ width, height: 844 });
      await p.waitForTimeout(150);
      const size = await p.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        // Whatever is sticking out, so a failure names it.
        widest: (() => {
          const cw = document.documentElement.clientWidth;
          for (const el of document.querySelectorAll("*")) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            if (r.right > cw + 0.5) {
              return `${el.tagName.toLowerCase()}.${el.className} right=${r.right}`;
            }
          }
          return "";
        })(),
      }));
      expect(
        size.scrollWidth,
        `${label} at ${width}px overflows: ${size.widest}`
      ).toBe(size.clientWidth);
    }
    await p.setViewportSize({ width: 390, height: 844 });
  }

  await context.close();
});

test("every month renders at the same width on a wide screen", async () => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoTab(page, "Expenses");
  await page.getByRole("tab", { name: "Month" }).click();
  await page.locator(".fresh-month").waitFor();

  const widths: number[] = [];
  const labels: string[] = [];
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(400);
    labels.push((await page.locator(".fresh-month-label").textContent()) ?? "");
    widths.push(
      await page
        .locator(".fresh-month")
        .evaluate((el) => el.getBoundingClientRect().width)
    );
    await page.getByRole("button", { name: "Previous month" }).click();
  }
  // A month with no receipts must not shrink to its own content.
  expect(new Set(widths).size, `month width changed: ${labels} ${widths}`).toBe(
    1
  );
  await page.getByRole("tab", { name: "Receipts" }).click();
});

/* ---------- screenshots ---------- */

/**
 * 360px is the narrow end of the phones this house actually carries, and it
 * is where the shell used to run off the side of the screen. Light only:
 * these four frames are about fit and density, not colour.
 */
test("the four busiest screens are captured at 360 wide", async () => {
  const context = await browserRef.newContext({
    viewport: { width: 360, height: 800 },
  });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("hh_ui", "fresh");
      window.localStorage.setItem("theme", "light");
    } catch {
      /* ignore */
    }
  });
  const p = await context.newPage();
  await login(p);

  for (const label of ["Home", "Recipes", "Grocery", "Expenses"]) {
    await gotoTab(p, label);
    await p.locator(".fresh-main").waitFor();
    if (label === "Expenses") {
      await p.getByRole("tab", { name: "Month" }).click();
      await p.locator(".fresh-month").waitFor();
    }
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(400);
    const file = label === "Expenses" ? "expenses-month" : label.toLowerCase();
    await p.screenshot({
      animations: "disabled",
      path: path.join(OUT, `${file}-light-360.png`),
    });
    await scrollToBottom(p);
    await p.screenshot({
      animations: "disabled",
      path: path.join(OUT, `${file}-bottom-light-360.png`),
    });
  }

  await context.close();
});

const VIEWPORTS = [
  { name: "390", width: 390, height: 844, dsf: 1 },
  { name: "1920", width: 1920, height: 1080, dsf: 1 },
  { name: "2560", width: 2560, height: 1400, dsf: 1.5 },
];

const SCREENS: { file: string; tab: string; phoneOnly?: boolean }[] = [
  { file: "home", tab: "Home" },
  { file: "recipes", tab: "Recipes" },
  { file: "grocery", tab: "Grocery" },
  { file: "expenses", tab: "Expenses" },
  { file: "inventory", tab: "Inventory" },
  { file: "passwords", tab: "Passwords" },
  { file: "more", tab: "More", phoneOnly: true },
];

test("every fresh screen is captured in both themes and all three sizes", async () => {
  test.setTimeout(300_000);
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

      const shot = async (file: string) => {
        await p.waitForTimeout(200);
        await p.screenshot({
          animations: "disabled",
          path: path.join(OUT, `${file}-${theme}-${vp.name}.png`),
        });
      };

      for (const screen of SCREENS) {
        if (screen.phoneOnly && vp.width >= 720) continue;
        await gotoTab(p, screen.tab);
        await p.evaluate(() => window.scrollTo(0, 0));
        await shot(screen.file);
        // Long screens hide their worst half below the fold on a phone.
        if (vp.width < 720) {
          const scrollable = await p.evaluate(
            () => document.body.scrollHeight > window.innerHeight + 40
          );
          if (scrollable) {
            await scrollToBottom(p);
            await shot(`${screen.file}-bottom`);
            await p.evaluate(() => window.scrollTo(0, 0));
          }
        }
        if (screen.file === "expenses") {
          await p.getByRole("tab", { name: "Month" }).click();
          await p.locator(".fresh-month").waitFor();
          await p.waitForTimeout(500);
          await shot("expenses-month");
          if (vp.width < 720) {
            await scrollToBottom(p);
            await shot("expenses-month-bottom");
            await p.evaluate(() => window.scrollTo(0, 0));
          }
          await p.getByRole("tab", { name: "Receipts" }).click();
        }
        if (screen.file === "recipes") {
          const card = p.locator(".fresh-day-card").first();
          if (await card.count()) {
            await card.scrollIntoViewIfNeeded();
            await shot("recipe-days");
          }
        }
      }

      // Every sheet is a screen of its own.
      await gotoTab(p, "Expenses");
      await p.getByRole("button", { name: "Add expense" }).first().click();
      await p.locator(".fresh-sheet").waitFor();
      await shot("expense-sheet");
      await p.locator("#fx-amount").focus();
      await shot("expense-sheet-focus");
      await p.keyboard.press("Escape");

      await gotoTab(p, "Grocery");
      await p.getByRole("button", { name: "Add item" }).first().click();
      await p.locator(".fresh-sheet").waitFor();
      await shot("grocery-sheet");
      await p
        .locator(".fresh-sheet-body")
        .evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await p.waitForTimeout(300);
      await shot("grocery-sheet-bottom");
      await p.keyboard.press("Escape");

      await gotoTab(p, "Inventory");
      await p.getByRole("button", { name: "Add item" }).first().click();
      await p.locator(".fresh-sheet").waitFor();
      await shot("inventory-sheet");
      await p.keyboard.press("Escape");

      await p
        .getByRole("button", { name: "Household settings" })
        .first()
        .click();
      await p.locator(".fresh-sheet").waitFor();
      await shot("settings-sheet");
      await p.keyboard.press("Escape");

      await gotoTab(p, "Expenses");
      const anyRow = p.locator(".fresh-row").first();
      if (await anyRow.count()) {
        await anyRow.click();
        await p.locator(".fresh-sheet").waitFor();
        await shot("edit-expense-sheet");
        await p.keyboard.press("Escape");
      }

      await context.close();
    }
  }
});
