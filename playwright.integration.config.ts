import { defineConfig } from "@playwright/test";

/**
 * Integration tests run against the real Cloudflare Pages Functions runtime
 * (`wrangler pages dev`), not `next dev` and not mocked routes. The server is
 * started by `scripts/start-integration-server.mjs`, which injects fixed
 * test-only secrets as Wrangler bindings.
 *
 * `out/` must be produced by `npm run build` first.
 */
export default defineConfig({
  testDir: "./tests/integration",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "https://127.0.0.1:3400",
    browserName: "chromium",
    headless: true,
    ignoreHTTPSErrors: true,
    storageState: { cookies: [], origins: [] },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/start-integration-server.mjs",
    url: "https://127.0.0.1:3400",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { CI: "1", WRANGLER_SEND_METRICS: "false" },
  },
});
