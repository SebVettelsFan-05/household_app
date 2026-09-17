import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Money-integrity smoke pass: the holes an adversarial audit of the bills
 * and the receipt editor found, each driven the way it was found — by
 * clicking. Runs against the local dev stack (`npm run dev:local`, app on
 * :3100, house password "dev").
 *
 * What is covered, and what breaks when it regresses:
 *
 * 1. A fixed bill added in one month could be added again from another,
 *    charging the household twice for one bill.
 * 2. "Stop from this month forward" on a utility left its amounts behind,
 *    and the line was rebuilt from them on the next load — active from the
 *    first month the app knows about.
 * 3. The same name in both lists was charged once from each.
 * 4. Two housemates saving the same month erased each other silently.
 * 5. A receipt naming somebody who has left could not be saved at all, and
 *    editing its custom split dropped them.
 *
 * The suite snapshots every household setting it touches and puts it back,
 * and deletes the receipts it files, so it can run in any order alongside
 * the other specs.
 */

const OUT = path.join(__dirname, "out", "money");
const PASSWORD = "dev";
const HOUSEHOLD_TZ = "America/Toronto";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const BILL_KEYS = ["recurring_fixed", "recurring_variable", "rent_alloc"] as const;
const LS_FIXED = "monthly_recurring_fixed_v3";
const LS_KEYS = [LS_FIXED, "monthly_recurring_variable_v3", "monthly_rent_alloc_v1"];

const PARKING = "Smoke Parking";
const CABLE = "Smoke Cable";
const HEATER = "Smoke Water Heater";
const HYDRO = "Smoke Hydro";
const VERSIONED = "Smoke Versioned";
/** A name the roster does not have: somebody who moved out. */
const DEPARTED = "Jordan";
const DEPARTED_STORE = "Smoke Departed";

let page: Page;
let browserRef: Browser;
/** The bill settings as this suite found them, restored in `afterAll`. */
const savedSettings: Record<string, unknown> = {};

/* ---------- month helpers (household time, as lib/dates.ts reads it) ---------- */

function zonedYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HOUSEHOLD_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "September 2026", the way `ymLabel` renders a month key. */
function monthKeyLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
}

const TODAY = zonedYmd(new Date());
const THIS_MONTH = TODAY.slice(0, 7);
const NEXT_MONTH = shiftMonthKey(THIS_MONTH, 1);

/* ---------- settings ---------- */

async function readSetting(api: APIRequestContext, key: string): Promise<unknown> {
  const res = await api.get(`/api/settings/${key}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).value;
}

async function storedJson(api: APIRequestContext, key: string): Promise<string> {
  return JSON.stringify(await readSetting(api, key));
}

/** How many stored fixed bills carry this name. Polled: a save is a push. */
async function countStored(name: string): Promise<number> {
  const rows = (await readSetting(page.request, "recurring_fixed")) as Array<{
    name: string;
  }>;
  return rows.filter((r) => r.name === name).length;
}

async function writeSetting(api: APIRequestContext, key: string, value: unknown) {
  const res = await api.put(`/api/settings/${key}`, { data: { value } });
  expect(res.ok()).toBeTruthy();
}

/**
 * The bills, as of a known state: the backend row, this device's cache and
 * the open page. The cache has to go too — it deliberately wins over an
 * empty backend row, so clearing the row alone leaves the dev seed's numbers
 * on screen.
 */
async function resetBills(
  p: Page,
  opts: { fixed?: unknown; variable?: unknown } = {}
) {
  await writeSetting(p.request, "recurring_fixed", opts.fixed ?? []);
  await writeSetting(
    p.request,
    "recurring_variable",
    opts.variable ?? { lines: [], amounts: {} }
  );
  await writeSetting(p.request, "rent_alloc", { schedule: [], overrides: {} });
  await p.evaluate((keys) => {
    for (const key of keys) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
  }, LS_KEYS);
  await p.reload();
}

/* ---------- navigation ---------- */

/**
 * Fill the password so React sees it: filling before hydration sets the DOM
 * value with no handler attached and hydration resets the field.
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

async function login(p: Page) {
  await p.goto("/");
  if (p.url().includes("/login")) {
    await typePassword(p, PASSWORD);
    await p.getByRole("button", { name: /sign in|enter|continue/i }).click();
    await p.waitForURL((url) => !url.pathname.startsWith("/login"));
  }
  await p.locator(".fresh, .wrap").first().waitFor();
  // Next's dev overlay parks a portal over the corner of the app.
  await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
}

async function openMonth(p: Page) {
  await p.locator(".fresh-rail button", { hasText: "Expenses" }).first().click();
  await p.getByRole("tab", { name: "Month" }).click();
  await p.locator(".fresh-month").waitFor();
}

/** Walks the month arrows to `key`. This suite only ever visits two. */
async function goToMonth(p: Page, key: string) {
  const label = p.locator(".fresh-month-label");
  const want = monthKeyLabel(key);
  const forward = key === NEXT_MONTH;
  for (let hops = 0; hops < 4; hops += 1) {
    const shown = ((await label.textContent()) ?? "").trim();
    if (shown === want) return;
    await p
      .getByRole("button", { name: forward ? "Next month" : "Previous month" })
      .click();
    await expect(label).not.toHaveText(shown);
  }
  await expect(label).toHaveText(want);
}

/* ---------- the two bill sections ---------- */

function card(p: Page, heading: "Fixed bills" | "Utilities") {
  return p
    .locator(".fresh-month .fresh-card")
    .filter({ has: p.locator(".fresh-h2", { hasText: heading }) })
    .first();
}

function sectionTotal(p: Page, heading: "Fixed bills" | "Utilities") {
  return card(p, heading).locator(".fresh-sub .fresh-num");
}

function billRow(p: Page, heading: "Fixed bills" | "Utilities", name: string) {
  return card(p, heading).locator(".fresh-bill-row").filter({ hasText: name });
}

async function addFixed(p: Page, name: string, amount: string) {
  await p.getByLabel("New fixed bill name").fill(name);
  await p.getByLabel("New fixed bill amount").fill(amount);
  await card(p, "Fixed bills").getByRole("button", { name: "Add" }).click();
}

async function addUtility(p: Page, name: string, amount: string) {
  await p.getByLabel("New variable bill name").fill(name);
  await p.getByLabel("New variable bill amount").fill(amount);
  await card(p, "Utilities").getByRole("button", { name: "Add" }).click();
}

async function setAmount(p: Page, label: string, text: string) {
  const field = p.getByLabel(label);
  await field.fill(text);
  await field.blur();
}

/* ---------- direct SQL, for data the API is right to refuse ---------- */

/**
 * A receipt can only name household members, so a snapshot with a departed
 * name cannot be created through the API at all — not on add (refused) and
 * not on edit (the row has to already name them). The row is written
 * straight into Postgres instead, which is exactly how such rows exist in
 * production: the name was a member when the receipt was filed.
 */
function psql(sql: string) {
  execFileSync(
    "docker",
    ["exec", "household-dev-pg", "psql", "-U", "dev", "-d", "household_dev", "-c", sql],
    { stdio: "pipe" }
  );
}

/** The same sheet on Arthur's screen geometry, for the record. */
async function captureAt2560(store: string, file: string) {
  const context = await browserRef.newContext({
    viewport: { width: 2560, height: 1400 },
    deviceScaleFactor: 1.5,
  });
  try {
    const p = await context.newPage();
    await login(p);
    await p.locator(".fresh-rail button", { hasText: "Expenses" }).first().click();
    await p.getByRole("tab", { name: "Receipts" }).click();
    await p.locator(".fresh-row", { hasText: store }).first().click();
    await p.locator(".fresh-sheet").waitFor();
    await p.screenshot({
      animations: "disabled",
      path: path.join(OUT, `${file}.png`),
    });
  } finally {
    await context.close();
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  browserRef = browser;
  fs.mkdirSync(OUT, { recursive: true });
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await login(page);
  for (const key of BILL_KEYS) {
    savedSettings[key] = await readSetting(page.request, key);
  }
});

test.afterAll(async () => {
  for (const key of BILL_KEYS) {
    const empty =
      key === "recurring_fixed"
        ? []
        : key === "recurring_variable"
          ? { lines: [], amounts: {} }
          : { schedule: [], overrides: {} };
    const saved = savedSettings[key];
    // A row that predates the shape rules (duplicate bill names, say) is
    // refused on the way back in; leave the key empty rather than failing
    // the whole suite in teardown.
    const res = await page.request.put(`/api/settings/${key}`, {
      data: { value: saved ?? empty },
    });
    if (!res.ok()) await writeSetting(page.request, key, empty);
  }
  await page.close();
});

/* ---------- 1. duplicate fixed bills ---------- */

test("a bill added next month cannot be added again from this one", async () => {
  await resetBills(page);
  await openMonth(page);

  await goToMonth(page, NEXT_MONTH);
  await addFixed(page, PARKING, "50.00");
  await expect(billRow(page, "Fixed bills", PARKING)).toHaveCount(1);
  await expect(sectionTotal(page, "Fixed bills")).toHaveText("$50.00");

  // This month shows nothing: the bill starts later. That invisibility is
  // exactly what let it be added a second time.
  await goToMonth(page, THIS_MONTH);
  await expect(billRow(page, "Fixed bills", PARKING)).toHaveCount(0);

  await addFixed(page, "smoke parking", "50.00");
  await expect(page.locator(".toast")).toHaveText(
    `${PARKING} is already a fixed bill, from ${monthKeyLabel(NEXT_MONTH)}`
  );
  await expect(billRow(page, "Fixed bills", PARKING)).toHaveCount(0);

  // One row at $50 next month, not two at $100.
  await goToMonth(page, NEXT_MONTH);
  await expect(billRow(page, "Fixed bills", PARKING)).toHaveCount(1);
  await expect(sectionTotal(page, "Fixed bills")).toHaveText("$50.00");
  await expect.poll(() => countStored(PARKING)).toBe(1);
});

test("a list that already holds duplicates is charged once after loading", async () => {
  // The bad data the old editor produced, straight into this device's cache:
  // the same bill twice, each with its own start month.
  await writeSetting(page.request, "recurring_fixed", []);
  await page.evaluate(
    ([key, rows]) => window.localStorage.setItem(key, rows),
    [
      LS_FIXED,
      JSON.stringify([
        {
          id: "fixed-smoke-parking-a",
          name: PARKING,
          activeFrom: NEXT_MONTH,
          schedule: [{ from: NEXT_MONTH, cents: 50_00 }],
          overrides: {},
        },
        {
          id: "fixed-smoke-parking-b",
          name: PARKING,
          activeFrom: THIS_MONTH,
          schedule: [{ from: THIS_MONTH, cents: 50_00 }],
          overrides: {},
        },
      ]),
    ] as const
  );
  await page.reload();
  await openMonth(page);

  await expect(billRow(page, "Fixed bills", PARKING)).toHaveCount(1);
  await expect(sectionTotal(page, "Fixed bills")).toHaveText("$50.00");
  await goToMonth(page, NEXT_MONTH);
  await expect(billRow(page, "Fixed bills", PARKING)).toHaveCount(1);
  await expect(sectionTotal(page, "Fixed bills")).toHaveText("$50.00");

  // The healed list is what gets pushed up, so the duplicate is gone for
  // every other device too.
  await expect.poll(() => countStored(PARKING)).toBe(1);
});

/* ---------- 2. stopping a variable utility ---------- */

test("stopping a utility takes its amounts with it, for good", async () => {
  await resetBills(page);
  await openMonth(page);

  await addUtility(page, HYDRO, "30.00");
  await expect(billRow(page, "Utilities", HYDRO)).toHaveCount(1);
  await expect(sectionTotal(page, "Utilities")).toHaveText("$30.00");

  // Next month inherits the line; give it an amount of its own so this
  // month becomes history the retirement has to keep.
  await goToMonth(page, NEXT_MONTH);
  await setAmount(page, `${HYDRO} amount`, "40.00");
  await expect(sectionTotal(page, "Utilities")).toHaveText("$40.00");

  await page
    .getByRole("button", { name: `Stop ${HYDRO} from this month forward` })
    .click();
  await expect(billRow(page, "Utilities", HYDRO)).toHaveCount(0);
  await expect(sectionTotal(page, "Utilities")).toHaveText("$0.00");

  // The month it really was billed in still has it.
  await goToMonth(page, THIS_MONTH);
  await expect(billRow(page, "Utilities", HYDRO)).toHaveCount(1);
  await expect(sectionTotal(page, "Utilities")).toHaveText("$30.00");

  // And the removal survives a reload — which is where the line used to
  // come back from, rebuilt out of the amounts nobody cleared.
  await expect
    .poll(() => storedJson(page.request, "recurring_variable"))
    .toContain("inactiveFrom");
  await page.reload();
  await openMonth(page);
  await expect(billRow(page, "Utilities", HYDRO)).toHaveCount(1);
  await expect(sectionTotal(page, "Utilities")).toHaveText("$30.00");
  await goToMonth(page, NEXT_MONTH);
  await expect(billRow(page, "Utilities", HYDRO)).toHaveCount(0);
  await expect(sectionTotal(page, "Utilities")).toHaveText("$0.00");

  // Stopping it in its first month leaves nothing behind at all.
  await goToMonth(page, THIS_MONTH);
  await page
    .getByRole("button", { name: `Stop ${HYDRO} from this month forward` })
    .click();
  await expect(billRow(page, "Utilities", HYDRO)).toHaveCount(0);
  await expect(sectionTotal(page, "Utilities")).toHaveText("$0.00");
  await expect
    .poll(() => storedJson(page.request, "recurring_variable"))
    .not.toContain(HYDRO);

  await page.reload();
  await openMonth(page);
  await expect(billRow(page, "Utilities", HYDRO)).toHaveCount(0);
  await expect(sectionTotal(page, "Utilities")).toHaveText("$0.00");
});

/* ---------- 3. one name, two lists ---------- */

test("a name cannot be a fixed bill and a utility at the same time", async () => {
  await resetBills(page);
  await openMonth(page);

  await addFixed(page, CABLE, "20.00");
  await expect(billRow(page, "Fixed bills", CABLE)).toHaveCount(1);
  await addUtility(page, "smoke cable", "12.00");
  await expect(page.locator(".toast")).toHaveText(
    `${CABLE} is already a fixed bill, from ${monthKeyLabel(THIS_MONTH)}`
  );
  await expect(billRow(page, "Utilities", CABLE)).toHaveCount(0);

  await addUtility(page, HEATER, "10.00");
  await expect(billRow(page, "Utilities", HEATER)).toHaveCount(1);
  await addFixed(page, "SMOKE WATER HEATER", "10.00");
  await expect(page.locator(".toast")).toHaveText(
    `${HEATER} is already a variable utility, from ${monthKeyLabel(THIS_MONTH)}`
  );
  await expect(billRow(page, "Fixed bills", HEATER)).toHaveCount(0);

  // Neither list grew, so neither amount is charged twice.
  await expect(sectionTotal(page, "Fixed bills")).toHaveText("$20.00");
  await expect(sectionTotal(page, "Utilities")).toHaveText("$10.00");
});

/* ---------- 4. two housemates, one month ---------- */

test("the month waits for the shared bills before it can be edited", async () => {
  await writeSetting(page.request, "recurring_fixed", [
    {
      id: "fixed-smoke-versioned",
      name: VERSIONED,
      schedule: [{ from: THIS_MONTH, cents: 20_00 }],
      overrides: {},
    },
  ]);
  await writeSetting(page.request, "recurring_variable", { lines: [], amounts: {} });

  // Hold the read of the bills, so the window where the screen has nothing
  // but this device's cache is wide enough to click in. An edit made then
  // has no version to save against: it would go to this device only, and the
  // load landing afterwards would overwrite it without a word.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/settings/recurring_fixed", async (route) => {
    if (route.request().method() === "GET") await held;
    await route.continue().catch(() => {
      /* the page navigated away from the held request */
    });
  });
  try {
    // The device's cache, so the screen has numbers to show meanwhile —
    // which is exactly what makes the fields look editable.
    await page.evaluate(
      ([key, rows]) => window.localStorage.setItem(key, rows),
      [
        LS_FIXED,
        JSON.stringify([
          {
            id: "fixed-smoke-versioned",
            name: VERSIONED,
            activeFrom: THIS_MONTH,
            schedule: [{ from: THIS_MONTH, cents: 20_00 }],
            overrides: {},
          },
        ]),
      ] as const
    );
    await page.reload();
    await openMonth(page);
    await expect(page.getByLabel(`${VERSIONED} amount`)).toHaveValue("20.00");
    await expect(page.getByLabel(`${VERSIONED} amount`)).toBeDisabled();
    await expect(page.getByLabel("New fixed bill name")).toHaveCount(0);

    release();
    await expect(page.getByLabel("New fixed bill name")).toBeVisible();
    await expect(page.getByLabel(`${VERSIONED} amount`)).toBeEnabled();

    // And once they are loaded, an edit reaches the household.
    await setAmount(page, `${VERSIONED} amount`, "45.00");
    await expect
      .poll(() => storedJson(page.request, "recurring_fixed"))
      .toContain("4500");
  } finally {
    release();
    await page.unroute("**/api/settings/recurring_fixed");
  }
});

test("two edits inside one round trip do not conflict with each other", async () => {
  await resetBills(page);
  await openMonth(page);
  await addFixed(page, CABLE, "20.00");
  await expect(billRow(page, "Fixed bills", CABLE)).toHaveCount(1);

  // Hold every settings write for half a second, so the second edit is
  // certainly made before the first one has been answered. Versioned writes
  // have to queue behind each other here; sending both against the version
  // from before the first would make this device conflict with itself and
  // throw away what the user just typed.
  await page.route("**/api/settings/**", async (route) => {
    if (route.request().method() === "PUT") {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await route.continue();
  });
  try {
    await setAmount(page, `${CABLE} amount`, "30.00");
    await addFixed(page, HEATER, "10.00");

    await expect(billRow(page, "Fixed bills", HEATER)).toHaveCount(1);
    await expect(page.locator(".toast")).not.toHaveText(
      "Someone else changed the bills; showing their version"
    );
    // Both edits landed: neither was lost to the other.
    await expect
      .poll(() => storedJson(page.request, "recurring_fixed"))
      .toContain("1000");
    expect(await storedJson(page.request, "recurring_fixed")).toContain("3000");
    await expect(page.getByLabel(`${CABLE} amount`)).toHaveValue("30.00");
  } finally {
    await page.unroute("**/api/settings/**");
  }
});

test("the second housemate to save sees the first one's bills", async () => {
  await writeSetting(page.request, "recurring_fixed", [
    {
      id: "fixed-smoke-versioned",
      name: VERSIONED,
      schedule: [{ from: THIS_MONTH, cents: 20_00 }],
      overrides: {},
    },
  ]);
  await writeSetting(page.request, "recurring_variable", { lines: [], amounts: {} });

  const contexts: BrowserContext[] = [];
  try {
    const pages: Page[] = [];
    for (let i = 0; i < 2; i += 1) {
      const context = await browserRef.newContext({
        viewport: { width: 1920, height: 1080 },
      });
      contexts.push(context);
      const p = await context.newPage();
      pages.push(p);
      await login(p);
      await openMonth(p);
      // Both devices read the same version of the bills before either edits.
      await expect(p.getByLabel(`${VERSIONED} amount`)).toHaveValue("20.00");
    }
    const [first, second] = pages;

    await setAmount(first, `${VERSIONED} amount`, "50.00");
    await expect(first.getByLabel(`${VERSIONED} amount`)).toHaveValue("50.00");
    await expect.poll(() => storedJson(first.request, "recurring_fixed")).toContain("5000");

    // The second save is built on the version the first one replaced.
    await setAmount(second, `${VERSIONED} amount`, "70.00");
    await expect(second.locator(".toast")).toHaveText(
      "Someone else changed the bills; showing their version"
    );
    await expect(second.getByLabel(`${VERSIONED} amount`)).toHaveValue("50.00");
    // And it did not land: $70 is nowhere, on either screen or in the row.
    expect(await storedJson(second.request, "recurring_fixed")).not.toContain("7000");
    await expect(first.getByLabel(`${VERSIONED} amount`)).toHaveValue("50.00");

    // The second housemate can now save on top of what they were shown,
    // rather than being stuck conflicting with themselves.
    await setAmount(second, `${VERSIONED} amount`, "60.00");
    await expect.poll(() => storedJson(second.request, "recurring_fixed")).toContain("6000");
    await expect(second.getByLabel(`${VERSIONED} amount`)).toHaveValue("60.00");
  } finally {
    for (const context of contexts) await context.close();
  }
});

/* ---------- 5. a receipt naming somebody who left ---------- */

test("a receipt naming a departed housemate still edits and keeps them", async () => {
  const res = await page.request.post("/api/expenses", {
    multipart: {
      amountCents: "3000",
      store: DEPARTED_STORE,
      paidBy: "Arthur",
      occurredOn: TODAY,
      allocations: JSON.stringify([
        { kind: "custom", amountCents: 3000, splitAmong: ["Eli"] },
      ]),
      receipt: { name: "receipt.png", mimeType: "image/png", buffer: TINY_PNG },
    },
  });
  expect(res.ok()).toBeTruthy();
  const filed = (await res.json()).expenses.find(
    (e: { store: string; amountCents: number }) =>
      e.store === DEPARTED_STORE && e.amountCents === 3000
  );
  expect(filed).toBeTruthy();

  try {
    psql(
      `update expenses set allocations = '${JSON.stringify([
        { kind: "custom", amountCents: 3000, splitAmong: ["Eli", DEPARTED] },
      ])}'::jsonb where id = '${filed.id}'`
    );

    await page.reload();
    await page.locator(".fresh-rail button", { hasText: "Expenses" }).first().click();
    await page.getByRole("tab", { name: "Receipts" }).click();
    await page.locator(".fresh-row", { hasText: DEPARTED_STORE }).first().click();
    const sheet = page.locator(".fresh-sheet");
    await expect(sheet).toBeVisible();

    // The departed name is on the line, so the split list offers it, checked.
    const split = sheet.getByRole("group", { name: "Who split line 1 covers" });
    const departedChip = split.locator(".fresh-chip-person", { hasText: DEPARTED });
    await expect(departedChip).toHaveAttribute("aria-pressed", "true");

    // Editing somebody else must not take them off it.
    await split.locator(".fresh-chip-person", { hasText: "Minh" }).click();
    await expect(departedChip).toHaveAttribute("aria-pressed", "true");

    // A chip list with an extra name in it is exactly what a code-reading
    // review cannot judge, so both geometries get a frame of it.
    await page.screenshot({
      animations: "disabled",
      path: path.join(OUT, "departed-split-1920.png"),
    });
    await captureAt2560(DEPARTED_STORE, "departed-split-2560");

    // And the save goes through: it used to fail its own pre-flight check
    // with "Unknown household member".
    await sheet
      .locator(".fresh-sheet-actions")
      .getByRole("button", { name: "Save" })
      .click();
    await expect(page.locator(".toast")).toHaveText("Saved");
    await expect(page.locator(".fresh-sheet")).toHaveCount(0);

    const after = await (await page.request.get("/api/expenses")).json();
    const row = after.expenses.find((e: { id: string }) => e.id === filed.id);
    expect(row.allocations[0].splitAmong).toEqual(["Eli", "Minh", DEPARTED]);
  } finally {
    await page.request.delete(`/api/expenses?id=${encodeURIComponent(filed.id)}`);
  }
});
