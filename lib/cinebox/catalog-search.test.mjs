import test from "node:test";
import assert from "node:assert/strict";
import {
  matchesTitleQuery,
  mergeCatalogTitles,
  normalizeSearchText,
  titleSearchText,
} from "./catalog-search.mjs";

const blackClover = {
  id: -73223,
  kind: "Série",
  name: "Black Clover",
  originalName: "ブラッククローバー",
  genre: "Animation",
  year: 2017,
  seasons: [{ number: 1, episodes: [{ title: "Les garçons de la campagne" }] }],
};

test("normalizeSearchText ignores case, accents and extra whitespace", () => {
  assert.equal(normalizeSearchText("  Amélie  Poulain "), "amelie poulain");
  assert.equal(normalizeSearchText("ÉTÉ"), "ete");
  assert.equal(normalizeSearchText("Black   Clover"), "black clover");
  assert.equal(normalizeSearchText(undefined), "");
});

test("titleSearchText includes original title, cast, genre and episodes", () => {
  const text = titleSearchText({
    name: "Le Voyage",
    originalName: "The Journey",
    genre: "Drame",
    cast: ["Anaïs"],
    seasons: [{ episodes: [{ title: "Le départ" }] }],
  });
  assert.match(text, /the journey/);
  assert.match(text, /drame/);
  assert.match(text, /anais/);
  assert.match(text, /le depart/);
});

test("matchesTitleQuery finds a title by original or French name", () => {
  assert.equal(matchesTitleQuery(blackClover, "black"), true);
  assert.equal(matchesTitleQuery(blackClover, "BLACK CLOVER"), true);
  assert.equal(matchesTitleQuery(blackClover, "  black   clover  "), true);
  assert.equal(matchesTitleQuery(blackClover, "ブラック"), true);
  assert.equal(matchesTitleQuery(blackClover, "campagne"), true);
  assert.equal(matchesTitleQuery(blackClover, "naruto"), false);
  assert.equal(matchesTitleQuery(blackClover, ""), true);
});

test("matchesTitleQuery is accent-insensitive in both directions", () => {
  const amelie = { id: 1, name: "Amélie Poulain", kind: "Film" };
  assert.equal(matchesTitleQuery(amelie, "amelie"), true);
  assert.equal(matchesTitleQuery(amelie, "AMÉLIE"), true);
});

test("mergeCatalogTitles keeps local titles first and deduplicates shared ids", () => {
  const local = [{ id: 1, kind: "Film", sharedId: "tmdb:movie:10", tmdbId: 10, name: "Local" }];
  const shared = [
    { id: 10, kind: "Film", sharedId: "tmdb:movie:10", tmdbId: 10, name: "Shared duplicate" },
    { id: 11, kind: "Film", sharedId: "tmdb:movie:11", tmdbId: 11, name: "Shared new" },
  ];
  const merged = mergeCatalogTitles(local, shared);
  assert.deepEqual(merged.map((item) => item.name), ["Local", "Shared new"]);
});

test("mergeCatalogTitles deduplicates the same TMDB id and kind", () => {
  const local = [{ id: 1, kind: "Série", tmdbId: 73223, name: "Black Clover (local)" }];
  const shared = [{ id: -73223, kind: "Série", tmdbId: 73223, name: "Black Clover (shared)" }];
  assert.deepEqual(mergeCatalogTitles(local, shared).map((item) => item.name), ["Black Clover (local)"]);
});

test("mergeCatalogTitles keeps a film and a series that share a TMDB id", () => {
  const local = [{ id: 1, kind: "Film", tmdbId: 42, name: "Film" }];
  const shared = [{ id: -42, kind: "Série", tmdbId: 42, name: "Série" }];
  assert.deepEqual(mergeCatalogTitles(local, shared).map((item) => item.kind), ["Film", "Série"]);
});

test("mergeCatalogTitles never lets two different items share a numeric id", () => {
  const local = [{ id: 7, kind: "Film", name: "Local 7" }];
  const shared = [{ id: 7, kind: "Film", name: "Shared 7" }];
  assert.deepEqual(mergeCatalogTitles(local, shared).map((item) => item.name), ["Local 7"]);
});

test("mergeCatalogTitles tolerates malformed inputs", () => {
  assert.deepEqual(mergeCatalogTitles(null, undefined), []);
  assert.deepEqual(mergeCatalogTitles([], []), []);
});
