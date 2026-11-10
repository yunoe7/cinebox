/**
 * Starts the real Cloudflare Pages Functions runtime for integration tests.
 *
 * `wrangler pages dev` compiles `functions/` exactly like Cloudflare Pages and
 * serves the static export from `out/`. The admin secrets are passed as
 * `--binding` arguments from fixed test-only values, so no `.dev.vars`,
 * `.env.local` or production secret is read or written.
 *
 * `out/` must come from `npm run build`; this script refuses to start without
 * it so a stale or missing export cannot silently be tested.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { hashAdminPassword } from "../lib/cinebox/admin-auth.mjs";
import {
  TEST_ADMIN_PASSWORD,
  TEST_SESSION_SECRET,
} from "../tests/integration/test-config.mjs";

const OUT_INDEX = path.resolve("out/index.html");
const WRANGLER_BIN = path.resolve("node_modules/wrangler/bin/wrangler.js");
const PORT = "3400";

if (!existsSync(OUT_INDEX)) {
  console.error(
    "out/index.html is missing. Run `npm run build` before the integration test.",
  );
  process.exit(1);
}
if (!existsSync(WRANGLER_BIN)) {
  console.error(
    "wrangler is not installed. Run `npm ci` before the integration test.",
  );
  process.exit(1);
}

// 100_000 iterations is the accepted minimum and keeps the test fast while
// exercising the exact PBKDF2 verifier format used in production.
const passwordHash = await hashAdminPassword(TEST_ADMIN_PASSWORD, {
  iterations: 100_000,
  salt: new Uint8Array(16),
});

const args = [
  WRANGLER_BIN,
  "pages",
  "dev",
  "out",
  "--port",
  PORT,
  "--ip",
  "127.0.0.1",
  "--local-protocol",
  "https",
  "--compatibility-date",
  "2024-01-01",
  "--show-interactive-dev-session=false",
  "--binding",
  `CINEBOX_ADMIN_PASSWORD_HASH=${passwordHash}`,
  "--binding",
  `CINEBOX_SESSION_SECRET=${TEST_SESSION_SECRET}`,
];

const child = spawn(process.execPath, args, {
  stdio: "inherit",
  env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
});

const shutdown = () => {
  if (!child.killed) child.kill();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
child.on("exit", (code) => process.exit(code ?? 0));
