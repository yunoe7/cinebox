import { defineConfig } from "@playwright/test";

/**
 * CSP smoke tests run against the static export served by Wrangler, not
 * `next dev`. The `out/` directory must be produced by `npm run build` so
 * `_headers` contains the hashes for this exact build.
 */
export default defineConfig({
  testDir: "./tests/csp",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3300",
    browserName: "chromium",
    headless: true,
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npx wrangler pages dev out --port 3300 --ip 127.0.0.1 --local-protocol http --compatibility-date=2024-01-01",
    url: "http://127.0.0.1:3300",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { CI: "1", WRANGLER_SEND_METRICS: "false" },
  },
});
