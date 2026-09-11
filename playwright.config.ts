import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke suite for the legacy UI. Points at the local dev stack
 * (`npm run dev:local` — app on :3100, house password "dev"), which is
 * deliberately not started here: the server is long-lived and shared with
 * whatever else is running against it.
 */
export default defineConfig({
  testDir: "./smoke",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    viewport: { width: 1920, height: 1080 },
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } },
    },
  ],
});
