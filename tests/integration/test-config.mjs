/**
 * Fixed, non-secret credentials for the local Wrangler integration test.
 *
 * These values only exist in the test process and in the isolated local
 * Wrangler instance. They are never read from `.env.local`, never sent to
 * Cloudflare, and must never be reused in production.
 */
export const TEST_ADMIN_PASSWORD = "integration-test-password-2026";
export const TEST_SESSION_SECRET =
  "integration-test-session-secret-0123456789abcdef";
export const TEST_ORIGIN = "https://127.0.0.1:3400";
