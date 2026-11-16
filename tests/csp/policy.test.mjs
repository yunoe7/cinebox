import test from "node:test";
import assert from "node:assert/strict";
import { buildPolicy } from "../../scripts/generate-csp.mjs";

const policy = buildPolicy(["sha256-abc123"]);
const directives = new Map(
  policy.split(";").map((part) => {
    const [name, ...values] = part.trim().split(/\s+/);
    return [name.toLowerCase(), values];
  }),
);

test("frame-src autorise Uqload et Vidmoly sans Vidsrc", () => {
  const frame = directives.get("frame-src") || [];
  for (const origin of [
    "https://uqload.vc",
    "https://uqload.com",
    "https://uqload.is",
    "https://uqload.co",
    "https://vidmoly.to",
    "https://vidmoly.org",
    "https://vidmoly.biz",
    "https://vidmoly.net",
    "https://vidmoly.me",
    "https://vidmoly.com",
  ]) {
    assert.ok(frame.includes(origin), `frame-src must include ${origin}`);
  }
  assert.ok(!frame.includes("https://vidsrc.sh"), "frame-src must not allow the retired Vidsrc player");
  assert.ok(!frame.includes("*"), "frame-src must not use a wildcard");
  assert.ok(!frame.includes("https:"), "frame-src must not allow every HTTPS origin");
  assert.ok(!frame.includes("http:"), "frame-src must not allow plain HTTP");
});

test("la CSP conserve les verrous de sécurité existants", () => {
  assert.deepEqual(directives.get("object-src"), ["'none'"]);
  assert.deepEqual(directives.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(directives.get("base-uri"), ["'self'"]);
  assert.deepEqual(directives.get("form-action"), ["'self'"]);
  assert.equal(directives.get("default-src")?.[0], "'self'");
  assert.ok(!(directives.get("script-src") || []).includes("'unsafe-eval'"));
  assert.ok(!(directives.get("script-src") || []).includes("'unsafe-inline'"));
});
