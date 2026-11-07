import test from "node:test";
import assert from "node:assert/strict";
import { displayTmdbRating, normalizeTmdbRating } from "./tmdb-rating.mjs";

test("preserves the full decimal precision of TMDB ratings", () => {
  assert.equal(normalizeTmdbRating(8.479), 8.479);
});

test("accepts the inclusive TMDB rating bounds", () => {
  assert.equal(normalizeTmdbRating(0), 0);
  assert.equal(normalizeTmdbRating(10), 10);
});

test("rejects absent, malformed, non-finite, and out-of-range ratings", () => {
  for (const value of [undefined, null, "8.479", Number.NaN, Infinity, -0.1, 10.1]) {
    assert.equal(normalizeTmdbRating(value), undefined);
    assert.equal(displayTmdbRating(value), "—");
  }
});
