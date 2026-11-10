import { defineConfig } from "@playwright/test";

/** Playwright launches its own Chromium context; storage state is deliberately empty. */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  // A single Next dev server cannot serve several browser workers reliably:
  // concurrent compilations cause 30s navigation timeouts. Keep e2e deterministic.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
    headless: true,
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    // A stale webpack cache can surface as a Next dev runtime overlay after edits.
    // Start every e2e run from a clean isolated cache.
    command: "node -e \"import('node:fs').then(({rmSync})=>rmSync('.next-e2e',{recursive:true,force:true}))\" && npm run dev -- --hostname 127.0.0.1 --port 3100",
    env: { NEXT_DIST_DIR: ".next-e2e" },
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
