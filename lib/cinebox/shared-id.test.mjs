import test from "node:test";
import assert from "node:assert/strict";
import {
  isSharedTitleId,
  resolvePublishId,
  resolveSharedId,
  sharedNumericId,
  tmdbIdFromSharedId,
} from "./shared-id.mjs";

test("un film et une série avec le même identifiant TMDB restent distincts", () => {
  const movie = sharedNumericId({ id: "tmdb:movie:123", kind: "movie", tmdbId: 123 });
  const series = sharedNumericId({ id: "tmdb:series:123", kind: "series", tmdbId: 123 });
  assert.equal(movie, 123);
  assert.equal(series, -123);
  assert.notEqual(movie, series);
});

test("l'identifiant numérique d'un film reste inchangé pour la compatibilité", () => {
  assert.equal(sharedNumericId({ id: "tmdb:movie:42", kind: "movie", tmdbId: 42 }), 42);
});

test("les vidéos TMDB utilisent un espace numérique séparé", () => {
  const video = sharedNumericId({ id: "tmdb:video:7", kind: "video", tmdbId: 7 });
  assert.ok(video < -1_000_000_000_000);
  assert.notEqual(video, sharedNumericId({ id: "tmdb:series:7", kind: "series", tmdbId: 7 }));
});

test("un identifiant cinebox conserve exactement l'identifiant local", () => {
  assert.equal(sharedNumericId({ id: "cinebox:1700000000000", kind: "movie" }), 1700000000000);
});

test("un identifiant cinebox reste prioritaire même si des métadonnées TMDB existent", () => {
  assert.equal(sharedNumericId({ id: "cinebox:1700000000000", kind: "series", tmdbId: 999 }), 1700000000000);
});

test("un identifiant inconnu produit un nombre stable et non nul", () => {
  const first = sharedNumericId({ id: "legacy:abc" });
  const second = sharedNumericId({ id: "legacy:abc" });
  assert.equal(first, second);
  assert.notEqual(first, 0);
  assert.ok(Number.isSafeInteger(first));
});

test("la résolution d'un nouvel identifiant partagé privilégie TMDB", () => {
  assert.equal(resolveSharedId({ tmdbId: 7, kind: "Film", localId: 1700000000000 }), "tmdb:movie:7");
  assert.equal(resolveSharedId({ tmdbId: 7, kind: "Série", localId: 1700000000000 }), "tmdb:series:7");
});

test("un titre local non TMDB est publié sous cinebox:<id>", () => {
  assert.equal(resolveSharedId({ kind: "Film", localId: 1700000000000 }), "cinebox:1700000000000");
});

test("l'édition d'un titre TMDB republie le même identifiant", () => {
  const original = resolveSharedId({ tmdbId: 42, kind: "Série", localId: 1700000000000 });
  const edited = resolveSharedId({
    tmdbId: 42,
    kind: "Série",
    localId: 1700000000000,
    existingSharedId: original,
  });
  assert.equal(edited, "tmdb:series:42");
  assert.equal(edited, original);
});

test("un titre TMDB historique sans sharedId retrouve son identifiant stable", () => {
  assert.equal(
    resolveSharedId({ tmdbId: 42, kind: "Film", localId: 1700000000000, existingSharedId: undefined }),
    "tmdb:movie:42",
  );
});

test("un titre déjà publié sous cinebox conserve son identité lors d'un ajout TMDB", () => {
  assert.equal(
    resolveSharedId({
      tmdbId: 42,
      kind: "Film",
      localId: 1700000000000,
      existingSharedId: "cinebox:1700000000000",
    }),
    "cinebox:1700000000000",
  );
});

test("un changement de type TMDB suit le nouveau type", () => {
  assert.equal(
    resolveSharedId({ tmdbId: 42, kind: "Série", existingSharedId: "tmdb:movie:42" }),
    "tmdb:series:42",
  );
});

test("la publication dérive l'identifiant depuis tmdbId quand aucun id n'est fourni", () => {
  assert.equal(resolvePublishId({ kind: "series", tmdbId: 42 }), "tmdb:series:42");
  assert.equal(resolvePublishId({ kind: "movie", tmdbId: 42 }), "tmdb:movie:42");
});

test("la publication refuse un identifiant dont le type ne correspond pas", () => {
  assert.equal(resolvePublishId({ id: "tmdb:movie:42", kind: "series", tmdbId: 42 }), "");
});

test("la publication refuse un identifiant TMDB incohérent avec tmdbId", () => {
  assert.equal(resolvePublishId({ id: "tmdb:movie:42", kind: "movie", tmdbId: 43 }), "");
});

test("la publication accepte un identifiant cohérent", () => {
  assert.equal(resolvePublishId({ id: "tmdb:movie:42", kind: "movie", tmdbId: 42 }), "tmdb:movie:42");
});

test("la publication conserve un identifiant cinebox explicite", () => {
  assert.equal(
    resolvePublishId({ id: "cinebox:1700000000000", kind: "movie", tmdbId: 42 }),
    "cinebox:1700000000000",
  );
});

test("la publication refuse un type inconnu ou un identifiant absent", () => {
  assert.equal(resolvePublishId({ kind: "private", tmdbId: 42 }), "");
  assert.equal(resolvePublishId({ kind: "movie" }), "");
  assert.equal(resolvePublishId({ id: "not-an-id", kind: "movie" }), "");
});

test("les helpers d'identification restent stricts", () => {
  assert.equal(isSharedTitleId("tmdb:movie:1"), true);
  assert.equal(isSharedTitleId("tmdb:series:1"), true);
  assert.equal(isSharedTitleId("cinebox:1"), true);
  assert.equal(isSharedTitleId("tmdb:person:1"), false);
  assert.equal(tmdbIdFromSharedId("tmdb:series:77"), 77);
  assert.equal(tmdbIdFromSharedId("cinebox:77"), undefined);
});
