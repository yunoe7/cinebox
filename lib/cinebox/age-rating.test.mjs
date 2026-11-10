import test from "node:test";
import assert from "node:assert/strict";
import {
  displayAgeRating,
  isContentAllowedForAge,
  parseAgeRating,
  resolveContentMinAge,
} from "./age-rating.mjs";

test("parseAgeRating understands French and US certifications", () => {
  assert.equal(parseAgeRating("TP"), 0);
  assert.equal(parseAgeRating("Tous publics"), 0);
  assert.equal(parseAgeRating("12"), 12);
  assert.equal(parseAgeRating("-12"), 12);
  assert.equal(parseAgeRating("PG-13"), 13);
  assert.equal(parseAgeRating("TV-MA"), 18);
  assert.equal(parseAgeRating("NC-17"), 18);
});

test("parseAgeRating normalises accents, case and surrounding spaces", () => {
  assert.equal(parseAgeRating("  Tous Publics  "), 0);
  assert.equal(parseAgeRating("tv-pg"), 10);
  assert.equal(parseAgeRating("18+"), 18);
});

test("parseAgeRating rejects unknown and malformed values", () => {
  for (const value of [undefined, null, "", "inconnu", "abc", {}, [], -3, Number.NaN]) {
    assert.equal(parseAgeRating(value), null);
  }
});

test("resolveContentMinAge prefers explicit minAge then certification then adult", () => {
  assert.equal(resolveContentMinAge({ minAge: 7 }), 7);
  assert.equal(resolveContentMinAge({ ageRating: "12" }), 12);
  assert.equal(resolveContentMinAge({ contentRating: "TV-PG" }), 10);
  assert.equal(resolveContentMinAge({ adult: true }), 18);
  assert.equal(resolveContentMinAge({}), null);
  assert.equal(resolveContentMinAge(null), null);
});

test("isContentAllowedForAge is fail-closed for unclassified content", () => {
  assert.equal(isContentAllowedForAge({ minAge: 10 }, 10), true);
  assert.equal(isContentAllowedForAge({ minAge: 12 }, 10), false);
  assert.equal(isContentAllowedForAge({}, 10), false);
  assert.equal(isContentAllowedForAge({ adult: true }, 18), true);
  assert.equal(isContentAllowedForAge({ adult: true }, 10), false);
  assert.equal(isContentAllowedForAge({ minAge: 0 }, 0), true);
});

test("displayAgeRating keeps the original certification for display", () => {
  assert.equal(displayAgeRating({ ageRating: "TP" }), "TP");
  assert.equal(displayAgeRating({ minAge: 12 }), "12+");
  assert.equal(displayAgeRating({ minAge: 0 }), "Tous publics");
  assert.equal(displayAgeRating({}), "");
});
