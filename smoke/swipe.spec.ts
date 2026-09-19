import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { REVEAL_WIDTH, deleteThreshold } from "../lib/swipe";

/**
 * Swipe-to-delete, driven against the local dev stack (`npm run dev:local`,
 * app on :3100, house password "dev").
 *
 * The phone passes use real CDP touch sequences rather than Playwright's
 * tap helper, because the whole point is what the pointer events do when a
 * finger drags: touchStart, several touchMoves, touchEnd. The desktop pass
 * does the same thing with the mouse.
 *
 * Screenshots land in `smoke/out/swipe/`.
 */

const OUT = path.join(__dirname, "out", "swipe");
const PASSWORD = "dev";

// Rows this suite makes and takes away again. Distinctive enough that a
// `hasText` filter can never land on somebody else's shopping.
const G_NAMES = ["Swipesmokeoats", "Swipesmokebeans", "Swipesmokeflour"];
const I_NAMES = ["Swipesmokeyogurt", "Swipesmokebutter"];

let browserRef: Browser;
let api: APIRequestContext;
let apiPage: Page;

/* ---------- fixtures ---------- */

async function clearFixtures(request: APIRequestContext) {
  const grocery = await (await request.get("/api/grocery")).json();
  for (const g of grocery.grocery ?? []) {
    if (G_NAMES.some((n) => String(g.name).toLowerCase() === n.toLowerCase())) {
      await request.delete(`/api/grocery?id=${encodeURIComponent(g.id)}`);
    }
  }
  const items = await (await request.get("/api/items")).json();
  for (const it of items.items ?? []) {
    if (I_NAMES.some((n) => String(it.name).toLowerCase() === n.toLowerCase())) {
      await request.delete(`/api/items?id=${encodeURIComponent(it.id)}`);
    }
  }
}

async function seedFixtures(request: APIRequestContext) {
  await clearFixtures(request);
  for (const [i, name] of G_NAMES.entries()) {
    await request.post("/api/grocery", {
      data: {
        name,
        quantity: 100 * (i + 1),
        category: "Pantry",
        categoryReviewed: true,
        store: "T&T",
        addedBy: "Arthur",
      },
    });
  }
  for (const [i, name] of I_NAMES.entries()) {
    await request.post("/api/items", {
      data: {
        name,
        quantity: 200 * (i + 1),
        category: "Dairy",
        categoryReviewed: true,
      },
    });
  }
}

/** The names currently on the shopping list, lower-cased. */
async function groceryNames(request: APIRequestContext): Promise<string[]> {
  const body = await (await request.get("/api/grocery")).json();
  return (body.grocery ?? []).map((g: { name: string }) =>
    g.name.toLowerCase()
  );
}

/* ---------- navigation ---------- */

async function typePassword(p: Page) {
  const input = p.locator('input[type="password"]');
  const button = p.getByRole("button", { name: /sign in|enter|continue/i });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await input.fill("");
    await input.fill(PASSWORD);
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
    await typePassword(p);
    await p.getByRole("button", { name: /sign in|enter|continue/i }).click();
    await p.waitForURL((url) => !url.pathname.startsWith("/login"));
  }
  await p.locator(".fresh, .wrap").first().waitFor();
  // Next's dev overlay parks a portal over the bottom-left corner.
  await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
}

type Look = "fresh" | "classic";

async function openApp(opts: {
  width: number;
  height: number;
  touch?: boolean;
  scale?: number;
  look?: Look;
  theme?: "light" | "dark";
}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browserRef.newContext({
    viewport: { width: opts.width, height: opts.height },
    hasTouch: opts.touch ?? false,
    deviceScaleFactor: opts.scale,
  });
  const look = opts.look ?? "fresh";
  const theme = opts.theme ?? "light";
  await context.addInitScript(
    ([ui, th]) => {
      try {
        window.localStorage.setItem("hh_ui", ui as string);
        window.localStorage.setItem("theme", th as string);
      } catch {
        /* ignore */
      }
    },
    [look, theme]
  );
  const page = await context.newPage();
  await login(page);
  return { context, page };
}

/** Bottom tab bar on a phone, left rail on a wide screen. */
async function gotoTab(p: Page, look: Look, label: string) {
  if (look === "classic") {
    await p.locator(".tab-bar button").filter({ hasText: label }).click();
    return;
  }
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

/* ---------- gestures ---------- */

function rowOf(p: Page, name: string): Locator {
  return p.locator(".swipe-row").filter({ hasText: name }).first();
}

/**
 * Park the row about a third down the viewport, clear of the sticky top bar
 * and of the tab bar and FAB at the foot.
 */
async function bringIntoView(p: Page, row: Locator) {
  await row.scrollIntoViewIfNeeded();
  await row.evaluate((el) => {
    const r = el.getBoundingClientRect();
    window.scrollBy(0, r.top - window.innerHeight * 0.35);
  });
  await p.waitForTimeout(250);
}

/** Where a swipe on this row starts: left of centre, clear of the button. */
async function grabPoint(row: Locator): Promise<{ x: number; y: number }> {
  // The list is still settling for a moment after it first paints (web fonts
  // swap in, the rest of the shell's data lands), and a point measured before
  // a shift presses on whatever row has slid under it. Wait until the row has
  // stopped moving.
  await row.page().evaluate(() => document.fonts.ready.then(() => undefined));
  let box = await row.boundingBox();
  for (let still = 0, tries = 0; still < 3 && tries < 40; tries += 1) {
    await row.page().waitForTimeout(80);
    const next = await row.boundingBox();
    still = box && next && box.x === next.x && box.y === next.y ? still + 1 : 0;
    box = next;
  }
  if (!box) throw new Error("row has no box");
  return { x: box.x + Math.min(120, box.width / 3), y: box.y + box.height / 2 };
}

/** Steps a finger left by `distance`, without lifting it. */
async function touchDrag(
  cdp: CDPSession,
  from: { x: number; y: number },
  distance: number,
  axis: "x" | "y" = "x"
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from.x, y: from.y }],
  });
  const steps = 6;
  for (let i = 1; i <= steps; i += 1) {
    const travelled = (distance * i) / steps;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        axis === "x"
          ? { x: from.x - travelled, y: from.y }
          : { x: from.x, y: from.y - travelled },
      ],
    });
  }
}

/** How much further down the page can still scroll. */
function headroom(p: Page): Promise<number> {
  return p.evaluate(
    () =>
      document.documentElement.scrollHeight -
      window.innerHeight -
      window.scrollY
  );
}

async function touchEnd(cdp: CDPSession) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

async function touchSwipe(
  cdp: CDPSession,
  from: { x: number; y: number },
  distance: number,
  axis: "x" | "y" = "x"
) {
  await touchDrag(cdp, from, distance, axis);
  await touchEnd(cdp);
}

/** The same left drag with a mouse, for the desktop pass. */
async function mouseDrag(
  p: Page,
  from: { x: number; y: number },
  distance: number
) {
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  for (let i = 1; i <= 6; i += 1) {
    await p.mouse.move(from.x - (distance * i) / 6, from.y);
  }
}

/* ---------- suite ---------- */

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  browserRef = browser;
  fs.mkdirSync(OUT, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  apiPage = await context.newPage();
  await login(apiPage);
  api = apiPage.request;
  await seedFixtures(api);
});

test.afterAll(async () => {
  // Leave the dev database as this suite found it.
  await clearFixtures(api);
  await apiPage.close();
});

test("a short swipe reveals a 44px button inside the row", async () => {
  const { context, page } = await openApp({
    width: 390,
    height: 844,
    touch: true,
  });
  await gotoTab(page, "fresh", "Grocery");
  const row = rowOf(page, G_NAMES[0]);
  await row.waitFor();
  await bringIntoView(page, row);

  // Shut, the button is not on the page for the keyboard or a reader.
  const back = row.locator(".swipe-back");
  await expect(back).toHaveAttribute("inert", "");
  await expect(back).toHaveAttribute("aria-hidden", "true");
  await expect(row.locator(".swipe-delete")).toHaveAttribute("tabindex", "-1");

  const before = (await row.boundingBox())!;
  const cdp = await context.newCDPSession(page);
  await touchSwipe(cdp, await grabPoint(row), 100);
  await page.waitForTimeout(250);

  const after = (await row.boundingBox())!;
  // Revealing must not move or resize the row itself.
  expect(Math.abs(after.x - before.x)).toBeLessThan(1);
  expect(Math.abs(after.width - before.width)).toBeLessThan(1);

  const btn = row.locator(".swipe-delete");
  const bb = (await btn.boundingBox())!;
  expect(Math.round(bb.width)).toBe(44);
  expect(Math.round(bb.height)).toBe(44);
  // Inside the row, and 10px in from its trailing edge.
  expect(bb.x).toBeGreaterThanOrEqual(after.x);
  expect(after.x + after.width - (bb.x + bb.width)).toBeCloseTo(10, 0);
  expect(bb.y).toBeGreaterThanOrEqual(after.y - 1);
  expect(bb.y + bb.height).toBeLessThanOrEqual(after.y + after.height + 1);

  // The row is pulled back by exactly the reveal width and no further.
  const front = (await row.locator(".swipe-front").boundingBox())!;
  expect(after.x - front.x).toBeCloseTo(REVEAL_WIDTH, 0);

  // Open, it is a real button again.
  await expect(btn).toHaveAttribute("aria-label", `Delete ${G_NAMES[0]}`);
  await expect(btn).toHaveAttribute("tabindex", "0");
  await expect(back).not.toHaveAttribute("inert", /.*/);
  await expect(back).not.toHaveAttribute("aria-hidden", /.*/);
  await page.screenshot({ path: path.join(OUT, "fresh-revealed-390.png") });
  await context.close();
});

test("scrolling the page shuts an open row", async () => {
  const { context, page } = await openApp({
    width: 390,
    height: 844,
    touch: true,
  });
  await gotoTab(page, "fresh", "Grocery");
  const row = rowOf(page, G_NAMES[0]);
  await row.waitFor();
  await bringIntoView(page, row);

  const cdp = await context.newCDPSession(page);
  await touchSwipe(cdp, await grabPoint(row), 100);
  await expect(row).toHaveClass(/is-active/);

  // Whichever way the page can still go: the seeded list is short.
  const dir = (await headroom(page)) > 120 ? 1 : -1;
  // A nudge is not enough; moving on up or down the page is.
  await page.evaluate((d) => window.scrollBy(0, 10 * d), dir);
  await page.waitForTimeout(200);
  await expect(row).toHaveClass(/is-active/);
  await page.evaluate((d) => window.scrollBy(0, 80 * d), dir);
  await expect(row).not.toHaveClass(/is-active/);
  await context.close();
});

test("the revealed button deletes the row, and Undo brings it back", async () => {
  const { context, page } = await openApp({
    width: 390,
    height: 844,
    touch: true,
  });
  const deletes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "DELETE" && r.url().includes("/api/grocery")) {
      deletes.push(r.url());
    }
  });
  await gotoTab(page, "fresh", "Grocery");
  const row = rowOf(page, G_NAMES[0]);
  await row.waitFor();
  await bringIntoView(page, row);

  const cdp = await context.newCDPSession(page);
  await touchSwipe(cdp, await grabPoint(row), 100);
  await page.waitForTimeout(200);
  await row.locator(".swipe-delete").click();

  await expect(rowOf(page, G_NAMES[0])).toHaveCount(0);
  expect(deletes.length).toBe(1);
  await expect
    .poll(() => groceryNames(api))
    .not.toContain(G_NAMES[0].toLowerCase());

  const toast = page.locator(".toast.toast-action");
  await expect(toast).toContainText(`Deleted ${G_NAMES[0]}`);
  await toast.getByRole("button", { name: "Undo" }).click();

  await expect
    .poll(() => groceryNames(api))
    .toContain(G_NAMES[0].toLowerCase());
  await expect(rowOf(page, G_NAMES[0])).toHaveCount(1);
  await context.close();
});

test("a swipe past the threshold deletes on release", async () => {
  const { context, page } = await openApp({
    width: 390,
    height: 844,
    touch: true,
  });
  await gotoTab(page, "fresh", "Grocery");
  const row = rowOf(page, G_NAMES[1]);
  await row.waitFor();
  await bringIntoView(page, row);

  const box = (await row.boundingBox())!;
  const past = deleteThreshold(box.width) + 25;
  const cdp = await context.newCDPSession(page);
  await touchDrag(cdp, await grabPoint(row), past);
  await page.waitForTimeout(200);

  // Held past the threshold: the whole strip is red and the button has
  // grown and travelled out with the row's trailing edge.
  await expect(row).toHaveClass(/is-armed/);
  const armed = (await row.locator(".swipe-delete").boundingBox())!;
  // Armed is said with colour, not size: the button stays a 44px circle (a
  // grown one was clipped flat on the shortest rows) and turns white.
  expect(Math.round(armed.width)).toBe(44);
  await expect(row.locator(".swipe-delete")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)"
  );
  const front = (await row.locator(".swipe-front").boundingBox())!;
  const trailing = front.x + front.width;
  expect(armed.x).toBeGreaterThan(trailing);
  expect(armed.x - trailing).toBeLessThan(20);
  // The red never leaves the row.
  const back = (await row.locator(".swipe-back").boundingBox())!;
  expect(back.x).toBeCloseTo(box.x, 0);
  expect(back.width).toBeCloseTo(box.width, 0);
  await page.screenshot({ path: path.join(OUT, "fresh-armed-390.png") });

  await touchEnd(cdp);
  await expect(rowOf(page, G_NAMES[1])).toHaveCount(0);
  await expect
    .poll(() => groceryNames(api))
    .not.toContain(G_NAMES[1].toLowerCase());

  const toast = page.locator(".toast.toast-action");
  await expect(toast).toContainText(`Deleted ${G_NAMES[1]}`);
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(() => groceryNames(api))
    .toContain(G_NAMES[1].toLowerCase());
  await context.close();
});

test("dragging back under the threshold disarms before release", async () => {
  const { context, page } = await openApp({
    width: 390,
    height: 844,
    touch: true,
  });
  await gotoTab(page, "fresh", "Grocery");
  const row = rowOf(page, G_NAMES[2]);
  await row.waitFor();
  await bringIntoView(page, row);

  const box = (await row.boundingBox())!;
  const from = await grabPoint(row);
  const cdp = await context.newCDPSession(page);
  await touchDrag(cdp, from, deleteThreshold(box.width) + 25);
  await expect(row).toHaveClass(/is-armed/);
  // Back to inside the reveal strip without lifting.
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: from.x - 70, y: from.y }],
  });
  await expect(row).not.toHaveClass(/is-armed/);
  await touchEnd(cdp);

  // It snaps open rather than deleting.
  await expect(rowOf(page, G_NAMES[2])).toHaveCount(1);
  await expect(row.locator(".swipe-delete")).toBeVisible();
  await context.close();
});

test("a swipe released short of the snap leaves the row shut", async () => {
  const { context, page } = await openApp({
    width: 390,
    height: 844,
    touch: true,
  });
  await gotoTab(page, "fresh", "Grocery");
  const row = rowOf(page, G_NAMES[0]);
  await row.waitFor();
  await bringIntoView(page, row);
  const box = (await row.boundingBox())!;

  const cdp = await context.newCDPSession(page);
  await touchSwipe(cdp, await grabPoint(row), 20);
  await page.waitForTimeout(250);

  const front = (await row.locator(".swipe-front").boundingBox())!;
  expect(front.x).toBeCloseTo(box.x, 0);
  await expect(row).not.toHaveClass(/is-active/);
  // And the swipe never became a tap on the row underneath.
  await expect(page.locator(".modal, .fresh-sheet")).toHaveCount(0);
  await context.close();
});

test("a drag down the page scrolls it and reveals nothing", async () => {
  const { context, page } = await openApp({
    width: 390,
    height: 844,
    touch: true,
  });
  await gotoTab(page, "fresh", "Grocery");
  const row = rowOf(page, G_NAMES[0]);
  await row.waitFor();
  await bringIntoView(page, row);
  const startY = await page.evaluate(() => window.scrollY);
  // Drag whichever way the page can still go: the seeded list is short.
  const down = (await headroom(page)) > 120;

  const cdp = await context.newCDPSession(page);
  await touchSwipe(cdp, await grabPoint(row), down ? 160 : -160, "y");
  await page.waitForTimeout(300);

  const movedBy = Math.abs((await page.evaluate(() => window.scrollY)) - startY);
  expect(movedBy).toBeGreaterThan(50);
  await expect(page.locator(".swipe-row.is-active")).toHaveCount(0);
  await expect(page.locator(".modal, .fresh-sheet")).toHaveCount(0);
  await context.close();
});

test("tapping an open row shuts it and does nothing else", async () => {
  const { context, page } = await openApp({
    width: 390,
    height: 844,
    touch: true,
  });
  await gotoTab(page, "fresh", "Grocery");
  const row = rowOf(page, G_NAMES[0]);
  await row.waitFor();
  await bringIntoView(page, row);
  const check = row.locator(".fresh-check");
  const pressedBefore = await check.getAttribute("aria-pressed");

  const cdp = await context.newCDPSession(page);
  await touchSwipe(cdp, await grabPoint(row), 100);
  await expect(row).toHaveClass(/is-active/);

  // Tap the row front, on the part that opens the edit sheet.
  const front = (await row.locator(".swipe-front").boundingBox())!;
  await page.mouse.click(front.x + front.width * 0.4, front.y + front.height / 2);
  await page.waitForTimeout(250);

  await expect(row).not.toHaveClass(/is-active/);
  await expect(page.locator(".modal, .fresh-sheet")).toHaveCount(0);
  expect(await check.getAttribute("aria-pressed")).toBe(pressedBefore);
  await context.close();
});

test("an open row is shut again by swiping it back to the right", async () => {
  const { context, page } = await openApp({
    width: 390,
    height: 844,
    touch: true,
  });
  await gotoTab(page, "fresh", "Grocery");
  const row = rowOf(page, G_NAMES[0]);
  await row.waitFor();
  await bringIntoView(page, row);
  const box = (await row.boundingBox())!;

  const cdp = await context.newCDPSession(page);
  await touchSwipe(cdp, await grabPoint(row), 100);
  await expect(row).toHaveClass(/is-active/);

  await touchSwipe(cdp, await grabPoint(row), -80);
  await page.waitForTimeout(250);
  await expect(row).not.toHaveClass(/is-active/);
  const front = (await row.locator(".swipe-front").boundingBox())!;
  expect(front.x).toBeCloseTo(box.x, 0);

  // And a right drag on a shut row does nothing at all: no rubber band.
  await touchSwipe(cdp, await grabPoint(row), -80);
  await page.waitForTimeout(250);
  expect((await row.locator(".swipe-front").boundingBox())!.x).toBeCloseTo(
    box.x,
    0
  );
  await expect(page.locator(".modal, .fresh-sheet")).toHaveCount(0);
  await context.close();
});

test("a second finger on the same row is ignored", async () => {
  const { context, page } = await openApp({
    width: 390,
    height: 844,
    touch: true,
  });
  await gotoTab(page, "fresh", "Grocery");
  const row = rowOf(page, G_NAMES[0]);
  await row.waitFor();
  await bringIntoView(page, row);
  const box = (await row.boundingBox())!;
  const a = await grabPoint(row);
  const b = { x: a.x + 60, y: a.y };

  // One finger rests on the row; a second lands on it and drags far enough
  // left to delete. The gesture belongs to the first finger, which has not
  // moved, so nothing happens at all.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: a.x, y: a.y, id: 1 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: a.x, y: a.y, id: 1 },
      { x: b.x, y: b.y, id: 2 },
    ],
  });
  const far = deleteThreshold(box.width) + 25;
  for (let i = 1; i <= 6; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: a.x, y: a.y, id: 1 },
        { x: b.x - (far * i) / 6, y: b.y, id: 2 },
      ],
    });
  }
  await expect(row).not.toHaveClass(/is-armed/);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [{ x: a.x, y: a.y, id: 1 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.waitForTimeout(400);

  await expect(row).not.toHaveClass(/is-active/);
  expect((await row.locator(".swipe-front").boundingBox())!.x).toBeCloseTo(
    box.x,
    0
  );
  await expect
    .poll(() => groceryNames(api))
    .toContain(G_NAMES[0].toLowerCase());
  await context.close();
});

test("swiping a second row shuts the first", async () => {
  const { context, page } = await openApp({
    width: 390,
    height: 844,
    touch: true,
  });
  await gotoTab(page, "fresh", "Grocery");
  const first = rowOf(page, G_NAMES[0]);
  const second = rowOf(page, G_NAMES[1]);
  await first.waitFor();
  await bringIntoView(page, first);

  const cdp = await context.newCDPSession(page);
  await touchSwipe(cdp, await grabPoint(first), 100);
  await expect(first).toHaveClass(/is-active/);

  await touchSwipe(cdp, await grabPoint(second), 100);
  await page.waitForTimeout(250);
  await expect(second).toHaveClass(/is-active/);
  await expect(first).not.toHaveClass(/is-active/);
  await expect(page.locator(".swipe-row.is-active")).toHaveCount(1);
  await context.close();
});

test("a plain tap still edits and the check circle still ticks", async () => {
  const { context, page } = await openApp({
    width: 390,
    height: 844,
    touch: true,
  });
  await gotoTab(page, "fresh", "Grocery");
  const row = rowOf(page, G_NAMES[2]);
  await row.waitFor();
  await bringIntoView(page, row);

  // In the fresh look ModalFrame draws the editor as a bottom sheet.
  await row.locator(".fresh-row-main").click();
  await expect(page.locator(".fresh-sheet")).toBeVisible();
  await expect(page.locator(".fresh-sheet")).toContainText("Edit grocery item");
  await page.keyboard.press("Escape");
  await expect(page.locator(".fresh-sheet")).toHaveCount(0);

  const check = row.locator(".fresh-check");
  await expect(check).toHaveAttribute("aria-pressed", "false");
  await check.click();
  await expect(check).toHaveAttribute("aria-pressed", "true");
  // Back to where it was: the Bought section swipes too, and the next test
  // expects this row on the open list.
  await row.locator(".fresh-check").click();
  await expect(rowOf(page, G_NAMES[2]).locator(".fresh-check")).toHaveAttribute(
    "aria-pressed",
    "false"
  );
  await context.close();
});

test("a bought row swipes like any other", async () => {
  const { context, page } = await openApp({
    width: 390,
    height: 844,
    touch: true,
  });
  await gotoTab(page, "fresh", "Grocery");
  const row = rowOf(page, G_NAMES[2]);
  await row.waitFor();
  await bringIntoView(page, row);
  await row.locator(".fresh-check").click();

  const bought = page
    .locator(".fresh-section", { hasText: "Bought" })
    .locator(".swipe-row")
    .filter({ hasText: G_NAMES[2] })
    .first();
  await bought.waitFor();
  await bringIntoView(page, bought);
  const cdp = await context.newCDPSession(page);
  await touchSwipe(cdp, await grabPoint(bought), 100);
  await expect(bought.locator(".swipe-delete")).toBeVisible();

  await bought.locator(".swipe-delete").click();
  await expect
    .poll(() => groceryNames(api))
    .not.toContain(G_NAMES[2].toLowerCase());
  const toast = page.locator(".toast.toast-action");
  await expect(toast).toContainText(`Deleted ${G_NAMES[2]}`);
  await toast.getByRole("button", { name: "Undo" }).click();

  // Undo puts it back, still ticked off.
  await expect
    .poll(async () => {
      const body = await (await api.get("/api/grocery")).json();
      const back = (body.grocery ?? []).find(
        (g: { name: string }) =>
          g.name.toLowerCase() === G_NAMES[2].toLowerCase()
      );
      return back ? back.done : null;
    })
    .toBe(true);
  await context.close();
});

test("the inventory swipes too, and Undo restores the row", async () => {
  const { context, page } = await openApp({
    width: 390,
    height: 844,
    touch: true,
  });
  await gotoTab(page, "fresh", "Inventory");
  const row = rowOf(page, I_NAMES[0]);
  await row.waitFor();
  await bringIntoView(page, row);

  const cdp = await context.newCDPSession(page);
  await touchSwipe(cdp, await grabPoint(row), 100);
  const btn = row.locator(".swipe-delete");
  const bb = (await btn.boundingBox())!;
  expect(Math.round(bb.width)).toBe(44);
  await btn.click();

  await expect(rowOf(page, I_NAMES[0])).toHaveCount(0);
  const toast = page.locator(".toast.toast-action");
  await expect(toast).toContainText(`Deleted ${I_NAMES[0]}`);
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(rowOf(page, I_NAMES[0])).toHaveCount(1);
  // Quantity and category survive the round trip.
  await expect
    .poll(async () => {
      const body = await (await api.get("/api/items")).json();
      const back = (body.items ?? []).find(
        (i: { name: string }) => i.name.toLowerCase() === I_NAMES[0].toLowerCase()
      );
      return back ? `${back.quantity}/${back.category}` : null;
    })
    .toBe("200/Dairy");
  await context.close();
});

test("the classic look swipes the same way", async () => {
  const { context, page } = await openApp({
    width: 390,
    height: 844,
    touch: true,
    look: "classic",
  });
  await expect(page.locator(".wrap")).toBeVisible();
  await gotoTab(page, "classic", "Grocery");
  const row = rowOf(page, G_NAMES[0]);
  await row.waitFor();
  await bringIntoView(page, row);

  const box = (await row.boundingBox())!;
  const cdp = await context.newCDPSession(page);
  await touchSwipe(cdp, await grabPoint(row), 100);
  await page.waitForTimeout(250);

  const btn = row.locator(".swipe-delete");
  const bb = (await btn.boundingBox())!;
  expect(Math.round(bb.width)).toBe(44);
  expect(box.x + box.width - (bb.x + bb.width)).toBeCloseTo(10, 0);
  await page.screenshot({ path: path.join(OUT, "classic-revealed-390.png") });

  // And the armed state, held.
  await touchDrag(cdp, await grabPoint(row), deleteThreshold(box.width) + 25);
  await page.waitForTimeout(200);
  await expect(row).toHaveClass(/is-armed/);
  await page.screenshot({ path: path.join(OUT, "classic-armed-390.png") });
  await touchEnd(cdp);

  await expect(rowOf(page, G_NAMES[0])).toHaveCount(0);
  const toast = page.locator(".toast.toast-action");
  await expect(toast).toContainText(`Deleted ${G_NAMES[0]}`);
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(() => groceryNames(api))
    .toContain(G_NAMES[0].toLowerCase());

  // A plain tap on a classic row still opens its editor.
  const back = rowOf(page, G_NAMES[0]);
  await back.waitFor();
  await bringIntoView(page, back);
  await back.locator(".grocery-row-body").click();
  await expect(page.locator(".modal")).toContainText("Edit grocery item");
  await context.close();
});

test("the classic inventory swipes without changing how a row looks", async () => {
  const { context, page } = await openApp({
    width: 390,
    height: 844,
    touch: true,
    look: "classic",
  });
  await gotoTab(page, "classic", "Inventory");
  const row = rowOf(page, I_NAMES[1]);
  await row.waitFor();
  await bringIntoView(page, row);

  // The card inside the wrapper still fills it exactly, corners and all.
  const box = (await row.boundingBox())!;
  const card = (await row.locator(".item").boundingBox())!;
  expect(card.x).toBeCloseTo(box.x, 0);
  expect(card.width).toBeCloseTo(box.width, 0);
  expect(await row.evaluate((el) => getComputedStyle(el).borderRadius)).toBe(
    "12px"
  );
  expect(
    await row.locator(".swipe-back").evaluate((el) => getComputedStyle(el).borderRadius)
  ).toBe("12px");

  const cdp = await context.newCDPSession(page);
  await touchSwipe(cdp, await grabPoint(row), 100);
  await row.locator(".swipe-delete").click();
  await expect(rowOf(page, I_NAMES[1])).toHaveCount(0);
  const toast = page.locator(".toast.toast-action");
  await expect(toast).toContainText(`Deleted ${I_NAMES[1]}`);
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(rowOf(page, I_NAMES[1])).toHaveCount(1);
  await context.close();
});

test("a mouse drag does the same on a desktop screen", async () => {
  const { context, page } = await openApp({ width: 1920, height: 1080 });
  await gotoTab(page, "fresh", "Grocery");
  const row = rowOf(page, G_NAMES[1]);
  await row.waitFor();
  await bringIntoView(page, row);
  const box = (await row.boundingBox())!;

  // Short of the snap: nothing happens, and no edit sheet opens.
  await mouseDrag(page, await grabPoint(row), 20);
  await page.mouse.up();
  await page.waitForTimeout(200);
  await expect(row).not.toHaveClass(/is-active/);
  await expect(page.locator(".modal")).toHaveCount(0);

  // Far enough to snap open.
  await mouseDrag(page, await grabPoint(row), 100);
  await page.mouse.up();
  await page.waitForTimeout(250);
  const btn = row.locator(".swipe-delete");
  const bb = (await btn.boundingBox())!;
  expect(Math.round(bb.width)).toBe(44);
  expect(box.x + box.width - (bb.x + bb.width)).toBeCloseTo(10, 0);
  await page.screenshot({
    path: path.join(OUT, "fresh-revealed-1920.png"),
    clip: { x: 0, y: 0, width: 1920, height: 900 },
  });

  // Escape shuts it again without touching anything else.
  await page.keyboard.press("Escape");
  await expect(row).not.toHaveClass(/is-active/);

  // A long drag deletes on release.
  await mouseDrag(page, await grabPoint(row), deleteThreshold(box.width) + 25);
  await expect(row).toHaveClass(/is-armed/);
  await page.mouse.up();
  await expect(rowOf(page, G_NAMES[1])).toHaveCount(0);
  const toast = page.locator(".toast.toast-action");
  await expect(toast).toContainText(`Deleted ${G_NAMES[1]}`);
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(() => groceryNames(api))
    .toContain(G_NAMES[1].toLowerCase());
  await context.close();
});

/* ---------- the layers around the gesture ---------- */

async function desktop() {
  return openApp({ width: 1920, height: 1080, touch: false });
}

async function revealWithMouse(page: Page, row: Locator) {
  await mouseDrag(page, await grabPoint(row), 100);
  await page.mouse.up();
  await expect(row).toHaveClass(/is-active/);
}

test("with a row open, tapping another row only shuts the open one", async () => {
  const { context, page } = await desktop();
  await gotoTab(page, "fresh", "Grocery");
  const first = rowOf(page, G_NAMES[0]);
  const second = rowOf(page, G_NAMES[1]);
  await first.waitFor();
  await revealWithMouse(page, first);

  await second.locator(".fresh-row-main").click();
  await expect(page.locator(".swipe-row.is-active")).toHaveCount(0);
  await expect(page.locator(".modal, .fresh-sheet")).toHaveCount(0);

  // The tap after that is an ordinary tap again.
  await second.locator(".fresh-row-main").click();
  await expect(page.locator(".fresh-sheet")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".fresh-sheet")).toHaveCount(0);
  await context.close();
});

test("one Escape closes a sheet and leaves the open row alone, the next shuts the row", async () => {
  const { context, page } = await desktop();
  await gotoTab(page, "fresh", "Grocery");
  const row = rowOf(page, G_NAMES[0]);
  await row.waitFor();
  await revealWithMouse(page, row);

  await page.getByRole("button", { name: /add item/i }).click();
  await expect(page.locator(".fresh-sheet")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".fresh-sheet")).toHaveCount(0);
  await expect(row).toHaveClass(/is-active/);

  await page.keyboard.press("Escape");
  await expect(row).not.toHaveClass(/is-active/);
  await context.close();
});

test("the phone's Back button shuts an open row without leaving the tab", async () => {
  const { context, page } = await desktop();
  await gotoTab(page, "fresh", "Grocery");
  const row = rowOf(page, G_NAMES[0]);
  await row.waitFor();
  await revealWithMouse(page, row);
  const url = page.url();

  await page.goBack();
  await expect(row).not.toHaveClass(/is-active/);
  expect(page.url()).toBe(url);
  await expect(row).toBeVisible();
  await context.close();
});

test("a refused delete puts back its own row and never one deleted after it", async () => {
  const { context, page } = await desktop();
  await gotoTab(page, "fresh", "Grocery");
  const slow = rowOf(page, G_NAMES[0]);
  const quick = rowOf(page, G_NAMES[1]);
  await slow.waitFor();

  const listed = await (await api.get("/api/grocery")).json();
  const slowId = listed.grocery.find(
    (g: { name: string }) => g.name.toLowerCase() === G_NAMES[0].toLowerCase()
  ).id as string;
  await page.route("**/api/grocery?id=*", async (route) => {
    if (route.request().method() === "DELETE" && route.request().url().includes(slowId)) {
      await new Promise((r) => setTimeout(r, 1200));
      await route.fulfill({ status: 500, json: { error: "Something went wrong" } });
    } else {
      await route.continue();
    }
  });

  await mouseDrag(page, await grabPoint(slow), 260);
  await page.mouse.up();
  await expect(slow).toHaveCount(0);
  await mouseDrag(page, await grabPoint(quick), 260);
  await page.mouse.up();
  await expect(quick).toHaveCount(0);

  // The refusal lands last. Its row returns, shut; the other stays gone, on
  // the page as on the server.
  await expect(rowOf(page, G_NAMES[0])).toHaveCount(1);
  await expect(rowOf(page, G_NAMES[0])).not.toHaveClass(/is-active/);
  await expect(page.locator(".toast")).toContainText("Error");
  await expect(rowOf(page, G_NAMES[1])).toHaveCount(0);
  const names = await groceryNames(api);
  expect(names).toContain(G_NAMES[0].toLowerCase());
  expect(names).not.toContain(G_NAMES[1].toLowerCase());

  await page.unroute("**/api/grocery?id=*");
  await seedFixtures(api);
  await context.close();
});

test("Undo pressed twice restores the row once", async () => {
  const { context, page } = await desktop();
  await gotoTab(page, "fresh", "Grocery");
  const row = rowOf(page, G_NAMES[1]);
  await row.waitFor();
  await page.route("**/api/grocery", async (route) => {
    if (route.request().method() === "POST") {
      await new Promise((r) => setTimeout(r, 800));
    }
    await route.continue();
  });

  await mouseDrag(page, await grabPoint(row), 260);
  await page.mouse.up();
  const undo = page.locator(".toast.toast-action").getByRole("button", { name: "Undo" });
  await undo.click();
  await undo.click({ timeout: 500 }).catch(() => undefined);

  await expect(rowOf(page, G_NAMES[1])).toHaveCount(1);
  const after = await (await api.get("/api/grocery")).json();
  const restored = after.grocery.filter(
    (g: { name: string }) => g.name.toLowerCase() === G_NAMES[1].toLowerCase()
  );
  expect(restored.length).toBe(1);
  expect(restored[0].quantity).toBe(200);
  await page.unroute("**/api/grocery");
  await context.close();
});

test("deleting from the keyboard keeps the focus in the list", async () => {
  const { context, page } = await desktop();
  await gotoTab(page, "fresh", "Grocery");
  const row = rowOf(page, G_NAMES[2]);
  await row.waitFor();
  await revealWithMouse(page, row);

  await row.locator(".swipe-delete").focus();
  await page.keyboard.press("Enter");
  await expect(rowOf(page, G_NAMES[2])).toHaveCount(0);
  const inList = await page.evaluate(
    () => Boolean(document.activeElement?.closest(".swipe-row"))
  );
  expect(inList).toBe(true);
  await seedFixtures(api);
  await context.close();
});

test("an armed button on the shortest row is still a whole circle", async () => {
  const { context, page } = await openApp({ width: 390, height: 844, touch: true });
  await gotoTab(page, "fresh", "Inventory");
  const row = rowOf(page, I_NAMES[0]);
  await row.waitFor();
  await bringIntoView(page, row);
  const cdp = await context.newCDPSession(page);
  const from = await grabPoint(row);
  await touchDrag(cdp, from, 200, "x");
  await expect(row).toHaveClass(/is-armed/);
  const rowBox = (await row.boundingBox())!;
  const btn = (await row.locator(".swipe-delete").boundingBox())!;
  expect(btn.y).toBeGreaterThanOrEqual(rowBox.y);
  expect(btn.y + btn.height).toBeLessThanOrEqual(rowBox.y + rowBox.height);
  // Let go back at rest so nothing is deleted.
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: from.x, y: from.y }],
  });
  await touchEnd(cdp);
  await expect(rowOf(page, I_NAMES[0])).toHaveCount(1);
  await context.close();
});

test("the revealed row is captured in dark mode and at 2560 at 1.5", async () => {
  const dark = await openApp({
    width: 390,
    height: 844,
    touch: true,
    theme: "dark",
  });
  await gotoTab(dark.page, "fresh", "Grocery");
  const darkRow = rowOf(dark.page, G_NAMES[0]);
  await darkRow.waitFor();
  await bringIntoView(dark.page, darkRow);
  const darkCdp = await dark.context.newCDPSession(dark.page);
  await touchSwipe(darkCdp, await grabPoint(darkRow), 100);
  await dark.page.waitForTimeout(250);
  await expect(darkRow.locator(".swipe-delete")).toBeVisible();
  await dark.page.screenshot({
    path: path.join(OUT, "fresh-revealed-390-dark.png"),
  });

  const darkBox = (await darkRow.boundingBox())!;
  await touchDrag(
    darkCdp,
    await grabPoint(darkRow),
    deleteThreshold(darkBox.width) + 25
  );
  await dark.page.waitForTimeout(200);
  await expect(darkRow).toHaveClass(/is-armed/);
  await dark.page.screenshot({
    path: path.join(OUT, "fresh-armed-390-dark.png"),
  });
  await touchEnd(darkCdp);
  await expect(rowOf(dark.page, G_NAMES[0])).toHaveCount(0);
  await dark.page
    .locator(".toast.toast-action")
    .getByRole("button", { name: "Undo" })
    .click();
  await expect
    .poll(() => groceryNames(api))
    .toContain(G_NAMES[0].toLowerCase());
  await dark.context.close();

  const wide = await openApp({ width: 2560, height: 1400, scale: 1.5 });
  await gotoTab(wide.page, "fresh", "Grocery");
  const wideRow = rowOf(wide.page, G_NAMES[0]);
  await wideRow.waitFor();
  await bringIntoView(wide.page, wideRow);
  const wideBox = (await wideRow.boundingBox())!;
  await mouseDrag(wide.page, await grabPoint(wideRow), 100);
  await wide.page.mouse.up();
  await wide.page.waitForTimeout(250);
  const wideBtn = (await wideRow.locator(".swipe-delete").boundingBox())!;
  expect(Math.round(wideBtn.width)).toBe(44);
  expect(
    wideBox.x + wideBox.width - (wideBtn.x + wideBtn.width)
  ).toBeCloseTo(10, 0);
  await wide.page.screenshot({
    path: path.join(OUT, "fresh-revealed-2560.png"),
    clip: { x: 0, y: 0, width: 2560, height: 1000 },
  });
  await wide.context.close();
});
