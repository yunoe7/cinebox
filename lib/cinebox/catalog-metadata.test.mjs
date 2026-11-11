import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCatalogMetadata,
  normalizeDirectors,
  normalizeRuntime,
  resolveDirectors,
  resolveDurationLabel,
  resolveRuntime,
  resolveVoteAverage,
} from "./catalog-metadata.mjs";

const VIDEO_ID = "0123456789abcdef0123456789abcdef";

test("normalizes the local editor aliases to the canonical schema", () => {
  const metadata = normalizeCatalogMetadata({
    originalName: "Nom original",
    originalLanguage: "fr",
    productionCountries: ["France"],
    cast: ["Acteur A"],
    director: "Jane Doe",
    rating: 8.2,
    voteCount: 120,
    status: "Released",
    totalSeasons: 1,
    totalEpisodes: 8,
    collection: "Saga",
    duration: "1 h 45",
    ageRating: "12",
    minAge: 12,
    adult: false,
  });

  assert.equal(metadata.voteAverage, 8.2);
  assert.deepEqual(metadata.directors, ["Jane Doe"]);
  assert.equal(metadata.runtime, 105);
  assert.equal(metadata.duration, "1 h 45");
  assert.equal(metadata.rating, undefined);
  assert.equal(metadata.director, undefined);
  assert.equal(metadata.originalName, "Nom original");
  assert.deepEqual(metadata.productionCountries, ["France"]);
  assert.equal(metadata.ageRating, "12");
});

test("keeps the canonical Bunny/TMDB fields unchanged", () => {
  const metadata = normalizeCatalogMetadata({
    voteAverage: 7.5,
    voteCount: 900,
    runtime: 120,
    originalLanguage: "en",
    cast: [{ name: "Acteur A", character: "Rôle" }],
    directors: ["John Smith"],
    tmdbReviews: [{ author: "Critique", content: "Bien", rating: 8, createdAt: "2024-01-01" }],
    bunnyVideoId: VIDEO_ID,
  });

  assert.equal(metadata.voteAverage, 7.5);
  assert.equal(metadata.voteCount, 900);
  assert.equal(metadata.runtime, 120);
  assert.equal(metadata.duration, undefined);
  assert.deepEqual(metadata.directors, ["John Smith"]);
  assert.deepEqual(metadata.tmdbReviews, [{ author: "Critique", content: "Bien", rating: 8, createdAt: "2024-01-01" }]);
  assert.equal(metadata.bunnyVideoId, VIDEO_ID);
});

test("both publishing paths produce the same canonical values", () => {
  const local = normalizeCatalogMetadata({ rating: 8.4, director: "Same Director", duration: "2 h 05" });
  const bunny = normalizeCatalogMetadata({ voteAverage: 8.4, directors: ["Same Director"], runtime: 125 });

  assert.equal(local.voteAverage, bunny.voteAverage);
  assert.deepEqual(local.directors, bunny.directors);
  assert.equal(local.runtime, bunny.runtime);
});

test("canonical fields win over legacy aliases and aliases are removed", () => {
  const metadata = normalizeCatalogMetadata({
    voteAverage: 7.5,
    rating: 9.9,
    directors: ["Canonical Director"],
    director: "Legacy Director",
    runtime: 120,
    duration: "90 min",
  });

  assert.equal(metadata.voteAverage, 7.5);
  assert.deepEqual(metadata.directors, ["Canonical Director"]);
  assert.equal(metadata.runtime, 120);
  assert.equal(metadata.duration, "120 min");
  assert.equal(metadata.rating, undefined);
  assert.equal(metadata.director, undefined);
});

test("invalid canonical fields fall back to valid legacy aliases", () => {
  const metadata = normalizeCatalogMetadata({
    voteAverage: null,
    rating: 8.1,
    directors: [],
    director: "A; B",
    runtime: 0,
    duration: "95 min",
  });

  assert.equal(metadata.voteAverage, 8.1);
  assert.deepEqual(metadata.directors, ["A", "B"]);
  assert.equal(metadata.runtime, 95);
  assert.equal(metadata.duration, "95 min");
});

test("absent, null, empty and invalid values are omitted", () => {
  const empty = normalizeCatalogMetadata({
    voteAverage: null,
    rating: "",
    directors: [],
    director: "   ",
    runtime: null,
    duration: "",
  });
  assert.deepEqual(empty, {});

  const invalid = normalizeCatalogMetadata({
    voteAverage: 11,
    rating: -1,
    directors: [1, null, "  "],
    director: {},
    runtime: Number.NaN,
    duration: "2 saisons",
  });
  assert.equal(invalid.voteAverage, undefined);
  assert.equal(invalid.rating, undefined);
  assert.equal(invalid.directors, undefined);
  assert.equal(invalid.director, undefined);
  assert.equal(invalid.runtime, undefined);
  assert.equal(invalid.duration, "2 saisons");
});

test("a numeric duration becomes runtime minutes", () => {
  const metadata = normalizeCatalogMetadata({ duration: 95 });
  assert.equal(metadata.runtime, 95);
  assert.equal(metadata.duration, "95 min");
});

test("duration parsing accepts common human formats and rejects noise", () => {
  assert.equal(normalizeRuntime(95), 95);
  assert.equal(normalizeRuntime("95"), 95);
  assert.equal(normalizeRuntime("95 min"), 95);
  assert.equal(normalizeRuntime("1 h 45"), 105);
  assert.equal(normalizeRuntime("1h45"), 105);
  assert.equal(normalizeRuntime("2 h"), 120);
  assert.equal(normalizeRuntime("1:45"), 105);

  for (const value of [0, -1, Number.NaN, Infinity, "", "Non renseigné", "2 saisons", "1 h 75", "abc"]) {
    assert.equal(normalizeRuntime(value), undefined, String(value));
  }
});

test("directors are trimmed, split, deduplicated and capped", () => {
  assert.deepEqual(normalizeDirectors(" A, B ; A "), ["A", "B"]);
  assert.deepEqual(normalizeDirectors(["A", " A ", "", 3, "B"]), ["A", "B"]);
  assert.deepEqual(normalizeDirectors(Array.from({ length: 20 }, (_, index) => `D${index}`)).length, 10);
});

test("normalization is idempotent", () => {
  const cases = [
    normalizeCatalogMetadata({ rating: 8.2, director: "Jane Doe", duration: "1 h 45" }),
    normalizeCatalogMetadata({ voteAverage: 7.5, directors: ["John"], runtime: 120 }),
    normalizeCatalogMetadata({ voteAverage: 7.5, rating: 9.9, directors: ["A"], director: "B", runtime: 120, duration: "90 min" }),
    normalizeCatalogMetadata({ duration: 95 }),
    normalizeCatalogMetadata({}),
  ];

  for (const metadata of cases) {
    assert.deepEqual(normalizeCatalogMetadata(metadata), metadata);
  }
});

test("preserves Bunny, TMDB and unrelated metadata", () => {
  const metadata = normalizeCatalogMetadata({
    bunnyVideoId: VIDEO_ID,
    bunnyLibraryId: "library-id",
    tmdbId: 42,
    tmdbReviews: [{ author: "A", content: "B" }],
    cast: [{ name: "A", character: "B" }],
    originalName: "Original",
    originalLanguage: "en",
    productionCountries: ["US"],
    status: "Released",
    totalSeasons: 2,
    totalEpisodes: 16,
    collection: "Collection",
    ageRating: "12",
    minAge: 12,
    adult: false,
    voteCount: 100,
  });

  assert.equal(metadata.bunnyVideoId, VIDEO_ID);
  assert.equal(metadata.bunnyLibraryId, "library-id");
  assert.equal(metadata.tmdbId, 42);
  assert.deepEqual(metadata.tmdbReviews, [{ author: "A", content: "B" }]);
  assert.deepEqual(metadata.cast, [{ name: "A", character: "B" }]);
  assert.equal(metadata.originalName, "Original");
  assert.equal(metadata.originalLanguage, "en");
  assert.deepEqual(metadata.productionCountries, ["US"]);
  assert.equal(metadata.status, "Released");
  assert.equal(metadata.totalSeasons, 2);
  assert.equal(metadata.totalEpisodes, 16);
  assert.equal(metadata.collection, "Collection");
  assert.equal(metadata.ageRating, "12");
  assert.equal(metadata.minAge, 12);
  assert.equal(metadata.adult, false);
  assert.equal(metadata.voteCount, 100);
});

test("read helpers keep legacy rows readable and prefer canonical values", () => {
  assert.equal(resolveVoteAverage({ rating: 8.1 }), 8.1);
  assert.equal(resolveVoteAverage({ voteAverage: 7.5, rating: 9.9 }), 7.5);
  assert.equal(resolveVoteAverage({ voteAverage: 0 }), 0);

  assert.deepEqual(resolveDirectors({ director: "Legacy, Other" }), ["Legacy", "Other"]);
  assert.deepEqual(resolveDirectors({ directors: ["Canonical"], director: "Legacy" }), ["Canonical"]);

  assert.equal(resolveRuntime({ duration: "95 min" }), 95);
  assert.equal(resolveRuntime({ duration: 90 }), 90);
  assert.equal(resolveRuntime({ runtime: 120, duration: "90 min" }), 120);
  assert.equal(resolveRuntime({ duration: "2 saisons" }), undefined);

  assert.equal(resolveDurationLabel({ duration: "95 min" }), "95 min");
  assert.equal(resolveDurationLabel({ runtime: 120 }), "120 min");
  assert.equal(resolveDurationLabel({ runtime: 105, duration: "1 h 45" }), "1 h 45");
  assert.equal(resolveDurationLabel({ runtime: 120, duration: "90 min" }), "120 min");
  assert.equal(resolveDurationLabel({ duration: "2 saisons" }), "2 saisons");
  assert.equal(resolveDurationLabel({}), "");
});
