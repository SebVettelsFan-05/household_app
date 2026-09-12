import { expect, test } from "@playwright/test";

/**
 * Signed-out behaviour, driven against the local dev stack (`npm run
 * dev:local`, app on :3100, house password "dev").
 *
 * Runs in its own browser context so pulling the session cookie out from
 * under the app cannot disturb the two shell suites, which share one page.
 */

test("a 401 sends the browser to the sign-in page", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const p = await ctx.newPage();
  await p.goto("/");
  if (p.url().includes("/login")) {
    // Fill after hydration has attached the change handler, or the value is
    // reset and Sign in stays disabled.
    const input = p.locator('input[type="password"]');
    const button = p.getByRole("button", { name: /sign in|enter|continue/i });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await input.fill("");
      await input.fill("dev");
      try {
        await expect(button).toBeEnabled({ timeout: 1500 });
        break;
      } catch {
        await p.waitForTimeout(300);
      }
    }
    await button.click();
    await p.waitForURL((url) => !url.pathname.startsWith("/login"));
  }
  await p.locator(".fresh").waitFor();
  await p.locator(".fresh-rail button", { hasText: "Grocery" }).first().click();
  expect(new URL(p.url()).hash).toBe("#grocery");

  // The session goes away under the open app.
  await ctx.clearCookies();
  await p.getByRole("button", { name: /refresh/i }).first().click();

  // Not a stale screen with an "HTTP 401" toast on it: the sign-in page,
  // carrying the tab the user was on so they land back on it.
  await p.waitForURL(/\/login\?next=/, { timeout: 15_000 });
  expect(new URL(p.url()).searchParams.get("next")).toBe("/#grocery");
  await ctx.close();
});
