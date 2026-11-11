import test from "node:test";
import assert from "node:assert/strict";
import {
  SHARED_CATALOG_MAX_ITEMS,
  SHARED_CATALOG_PAGE_SIZE,
  fetchSharedCatalogTitles,
  loadSharedCatalog,
  sharedCatalogItemToTitle,
} from "./shared-catalog.mjs";

const movieRow = {
  id: "tmdb:movie:10",
  kind: "movie",
  title: "Film partagé",
  overview: "Une description",
  releaseDate: "2024-05-01",
  posterPath: "/poster.jpg",
  backdropPath: "/backdrop.jpg",
  genres: ["Drame", "Aventure"],
  metadata: {
    tmdbId: 10,
    runtime: 120,
    voteAverage: 7.5,
    voteCount: 900,
    originalName: "Shared Movie",
    cast: ["Acteur A", "Acteur B"],
    directors: ["Réalisateur"],
    ageRating: "12",
    minAge: 12,
  },
};

test("sharedCatalogItemToTitle maps a movie to the local Title shape", () => {
  const title = sharedCatalogItemToTitle(movieRow);
  assert.equal(title.id, 10);
  assert.equal(title.kind, "Film");
  assert.equal(title.name, "Film partagé");
  assert.equal(title.year, 2024);
  assert.equal(title.poster, "https://image.tmdb.org/t/p/w500/poster.jpg");
  assert.equal(title.backdrop, "https://image.tmdb.org/t/p/w1280/backdrop.jpg");
  assert.equal(title.duration, "120 min");
  assert.equal(title.tmdbId, 10);
  assert.equal(title.sharedId, "tmdb:movie:10");
  assert.equal(title.source, "shared");
  assert.equal(title.minAge, 12);
  assert.equal(title.ageRating, "12");
  assert.equal(title.isAdult, false);
  assert.deepEqual(title.cast, ["Acteur A", "Acteur B"]);
});

test("sharedCatalogItemToTitle maps a series with seasons and episodes", () => {
  const title = sharedCatalogItemToTitle({
    id: "tmdb:series:73223",
    kind: "series",
    title: "Black Clover",
    overview: "",
    releaseDate: "2017-10-03",
    posterPath: null,
    backdropPath: null,
    genres: ["Animation"],
    metadata: { tmdbId: 73223, originalName: "ブラッククローバー" },
    seasons: [{
      number: 1,
      episodes: [
        { number: 1, title: "Les garçons de la campagne", thumbnailPath: "/still.jpg" },
        { number: 2, title: "Le serment" },
      ],
    }],
  });
  assert.equal(title.id, -73223);
  assert.equal(title.kind, "Série");
  assert.equal(title.originalName, "ブラッククローバー");
  assert.equal(title.totalSeasons, 1);
  assert.equal(title.totalEpisodes, 2);
  assert.equal(title.duration, "1 saison");
  assert.equal(title.minAge, undefined);
  assert.equal(title.isAdult, false);
  assert.equal(title.seasons?.[0].episodes[0].thumbnailUrl, "https://image.tmdb.org/t/p/w300/still.jpg");
});

test("sharedCatalogItemToTitle maps an unclassified adult flag to 18+", () => {
  const title = sharedCatalogItemToTitle({
    id: "tmdb:movie:99",
    kind: "movie",
    title: "Adulte",
    metadata: { tmdbId: 99, adult: true },
  });
  assert.equal(title.minAge, 18);
  assert.equal(title.isAdult, true);
});

test("sharedCatalogItemToTitle tolerates malformed rows", () => {
  const title = sharedCatalogItemToTitle({});
  assert.equal(title.name, "Titre sans nom");
  assert.equal(title.kind, "Film");
  assert.equal(title.source, "shared");
  assert.equal(title.sharedId, "");
});

test("sharedCatalogItemToTitle reads legacy metadata field names", () => {
  const title = sharedCatalogItemToTitle({
    id: "cinebox:1700000000000",
    kind: "movie",
    title: "Fiche historique",
    metadata: { rating: 8.1, director: "Réalisateur historique", duration: "95 min" },
  });
  assert.equal(title.rating, 8.1);
  assert.equal(title.director, "Réalisateur historique");
  assert.equal(title.duration, "95 min");
});

test("sharedCatalogItemToTitle keeps runtime authoritative over a conflicting duration", () => {
  const title = sharedCatalogItemToTitle({
    id: "tmdb:movie:11",
    kind: "movie",
    title: "Fiche mixte",
    metadata: {
      voteAverage: 7.5,
      rating: 9.9,
      directors: ["Canonique"],
      director: "Ancien",
      runtime: 120,
      duration: "90 min",
    },
  });
  assert.equal(title.rating, 7.5);
  assert.equal(title.director, "Canonique");
  assert.equal(title.duration, "120 min");
});

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
}

test("fetchSharedCatalogTitles paginates until a short page", async () => {
  const pages = [
    Array.from({ length: SHARED_CATALOG_PAGE_SIZE }, (_, index) => ({
      id: `tmdb:movie:${index + 1}`,
      kind: "movie",
      title: `Film ${index + 1}`,
      metadata: { tmdbId: index + 1 },
    })),
    [{
      id: "tmdb:movie:999",
      kind: "movie",
      title: "Dernier film",
      metadata: { tmdbId: 999 },
    }],
  ];
  const urls = [];
  let index = 0;
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return jsonResponse({ titles: pages[index++] || [] });
  };
  const titles = await fetchSharedCatalogTitles({ fetchImpl });
  assert.equal(titles.length, SHARED_CATALOG_PAGE_SIZE + 1);
  assert.equal(urls.length, 2);
  assert.match(urls[0], new RegExp(`limit=${SHARED_CATALOG_PAGE_SIZE}`));
  assert.match(urls[0], /offset=0/);
  assert.match(urls[1], new RegExp(`offset=${SHARED_CATALOG_PAGE_SIZE}`));
});

test("fetchSharedCatalogTitles forwards maxAge and stops on non-JSON responses", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return new Response("<html>Not found</html>", {
      status: 404,
      headers: { "content-type": "text/html" },
    });
  };
  const titles = await fetchSharedCatalogTitles({ maxAge: 10, fetchImpl });
  assert.deepEqual(titles, []);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /maxAge=10/);
});

test("fetchSharedCatalogTitles never exceeds the maximum item count", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse({
      titles: Array.from({ length: SHARED_CATALOG_PAGE_SIZE }, (_, index) => ({
        id: `tmdb:movie:${calls}-${index}`,
        kind: "movie",
        title: `Film ${calls}-${index}`,
        metadata: { tmdbId: calls * 1000 + index },
      })),
    });
  };
  const titles = await fetchSharedCatalogTitles({ fetchImpl });
  assert.equal(titles.length, SHARED_CATALOG_MAX_ITEMS);
  assert.equal(calls, SHARED_CATALOG_MAX_ITEMS / SHARED_CATALOG_PAGE_SIZE);
});

test("fetchSharedCatalogTitles survives a network failure", async () => {
  const titles = await fetchSharedCatalogTitles({
    fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.deepEqual(titles, []);
});

test("loadSharedCatalog reports a successful empty catalogue instead of an error", async () => {
  const result = await loadSharedCatalog({
    fetchImpl: async () => jsonResponse({ titles: [] }),
  });
  assert.equal(result.status, "success");
  assert.deepEqual(result.titles, []);
});

test("loadSharedCatalog distinguishes a network failure from an empty catalogue", async () => {
  const result = await loadSharedCatalog({
    fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.equal(result.status, "error");
  assert.equal(result.reason, "network");
  assert.deepEqual(result.titles, []);
});

test("loadSharedCatalog reports HTTP failures with their status", async () => {
  const result = await loadSharedCatalog({
    fetchImpl: async () => new Response("nope", { status: 503, headers: { "content-type": "application/json" } }),
  });
  assert.equal(result.status, "error");
  assert.equal(result.reason, "http");
  assert.equal(result.httpStatus, 503);
});

test("loadSharedCatalog rejects HTML, invalid JSON and malformed payloads", async () => {
  const html = await loadSharedCatalog({
    fetchImpl: async () => new Response("<html>Not found</html>", { status: 200, headers: { "content-type": "text/html" } }),
  });
  assert.equal(html.status, "error");
  assert.equal(html.reason, "invalid-response");

  const invalidJson = await loadSharedCatalog({
    fetchImpl: async () => new Response("{not json", { status: 200, headers: { "content-type": "application/json" } }),
  });
  assert.equal(invalidJson.status, "error");
  assert.equal(invalidJson.reason, "invalid-response");

  const malformed = await loadSharedCatalog({
    fetchImpl: async () => jsonResponse({ titles: "not-an-array" }),
  });
  assert.equal(malformed.status, "error");
  assert.equal(malformed.reason, "invalid-response");
});

test("loadSharedCatalog reports an aborted request without turning it into a failure", async () => {
  const controller = new AbortController();
  const result = await loadSharedCatalog({
    signal: controller.signal,
    fetchImpl: async () => {
      controller.abort();
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    },
  });
  assert.equal(result.status, "aborted");
  assert.equal(result.reason, "aborted");
});

test("loadSharedCatalog keeps the previous page when a later page fails", async () => {
  const firstPage = Array.from({ length: SHARED_CATALOG_PAGE_SIZE }, (_, index) => ({
    id: `tmdb:movie:${index + 1}`,
    kind: "movie",
    title: `Film ${index + 1}`,
    metadata: { tmdbId: index + 1 },
  }));
  let call = 0;
  const result = await loadSharedCatalog({
    fetchImpl: async () => {
      call += 1;
      if (call === 1) return jsonResponse({ titles: firstPage });
      throw new Error("offline");
    },
  });
  assert.equal(result.status, "error");
  assert.equal(result.reason, "network");
  assert.equal(result.titles.length, SHARED_CATALOG_PAGE_SIZE);
});
