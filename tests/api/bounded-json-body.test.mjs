import test from "node:test";
import assert from "node:assert/strict";
import { readJsonBody } from "../../functions/_lib/account-auth.ts";

test("reads valid JSON below the configured byte limit", async () => {
  const request = new Request("https://cinebox.test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "account-1" }),
  });
  const result = await readJsonBody(request, 1024);
  assert.deepEqual(result, { ok: true, value: { userId: "account-1" } });
});

test("rejects a body whose declared Content-Length exceeds the limit", async () => {
  const request = new Request("https://cinebox.test/api", {
    method: "POST",
    headers: { "content-length": "2048" },
    body: "{}",
  });
  assert.deepEqual(await readJsonBody(request, 1024), { ok: false, reason: "too-large" });
});

test("enforces the limit against streamed bytes even when Content-Length is absent", async () => {
  const request = new Request("https://cinebox.test/api", {
    method: "POST",
    body: JSON.stringify({ value: "x".repeat(2048) }),
  });
  assert.deepEqual(await readJsonBody(request, 128), { ok: false, reason: "too-large" });
});

test("rejects malformed JSON", async () => {
  const request = new Request("https://cinebox.test/api", { method: "POST", body: "{broken" });
  assert.deepEqual(await readJsonBody(request, 1024), { ok: false, reason: "invalid-json" });
});

test("rejects non-UTF-8 request bodies", async () => {
  const request = new Request("https://cinebox.test/api", {
    method: "POST",
    body: new Uint8Array([0xc3, 0x28]),
  });
  assert.deepEqual(await readJsonBody(request, 1024), { ok: false, reason: "invalid-json" });
});
