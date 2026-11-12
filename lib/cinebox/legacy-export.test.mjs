import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_EXPORT_FORMAT,
  LEGACY_EXPORT_NOTICE,
  buildLegacyExport,
  collectLegacyAssetReferences,
  extensionForMime,
  legacyAssetFilename,
  legacyExportFilename,
  safeFilename,
} from "./legacy-export.mjs";

const film = {
  id: 101,
  name: "Film local",
  kind: "Film",
  poster: "blob:poster",
  posterAssetKey: "101:poster:v:abc",
  backdropAssetKey: "101:backdrop:v:def",
  videoAssetKey: "101:video:v:ghi",
};

const series = {
  id: 202,
  name: "Série locale",
  kind: "Série",
  poster: "https://image.tmdb.org/p.jpg",
  seasons: [{
    number: 1,
    posterAssetKey: "202:season:1:poster",
    episodes: [
      { number: 1, title: "Pilote", videoAssetKey: "202:episode:1:1:v:x", thumbnailAssetKey: "202:episode:1:1:thumbnail:v:y" },
      { number: 2, title: "Suite" },
    ],
  }],
};

test("collectLegacyAssetReferences recense affiches, fonds, vidéos et épisodes", () => {
  const references = collectLegacyAssetReferences([film, series]);
  const keys = references.map((reference) => reference.key);
  assert.deepEqual(keys, [
    "101:poster:v:abc",
    "101:backdrop:v:def",
    "101:video:v:ghi",
    "202:season:1:poster",
    "202:episode:1:1:v:x",
    "202:episode:1:1:thumbnail:v:y",
    "202:episode:1:2",
    "202:episode:1:2:thumbnail",
  ]);
  const episode = references.find((reference) => reference.key === "202:episode:1:2");
  assert.deepEqual(episode?.episode, { season: 1, number: 2, title: "Suite" });
  assert.equal(episode?.label, "Vidéo S1 E2");
});

test("collectLegacyAssetReferences déduplique les clés et ignore les entrées invalides", () => {
  const duplicated = { ...film, backdropAssetKey: film.posterAssetKey };
  const references = collectLegacyAssetReferences([film, duplicated, null, "nope"]);
  assert.equal(references.filter((reference) => reference.key === "101:poster:v:abc").length, 1);
});

test("une affiche distante sans clé locale n’est pas exportée comme média", () => {
  const references = collectLegacyAssetReferences([series]);
  assert.equal(references.some((reference) => reference.key === "202:poster"), false);
});

test("buildLegacyExport produit un manifeste honnête et sans suppression", () => {
  const document = buildLegacyExport({
    titles: [film],
    exportedAt: "2026-02-03T04:05:06.000Z",
    assets: [
      { key: "101:poster:v:abc", status: "found", type: "image/png", size: 1234 },
      { key: "101:video:v:ghi", status: "missing" },
      { key: "101:backdrop:v:def", status: "unreadable" },
    ],
  });
  assert.equal(document.format, LEGACY_EXPORT_FORMAT);
  assert.equal(document.notice, LEGACY_EXPORT_NOTICE);
  assert.equal(document.exportedAt, "2026-02-03T04:05:06.000Z");
  assert.deepEqual(document.counts, { titles: 1, assets: 3, found: 1, missing: 1, unreadable: 1 });
  assert.deepEqual(document.titles, [film]);
  assert.match(document.notice, /aucune donnée locale/i);
});

test("les noms de fichiers sont explicites et sûrs", () => {
  assert.equal(legacyExportFilename("2026-02-03T04:05:06.000Z"), "cinebox-export-local-20260203-040506.json");
  assert.equal(safeFilename("Épisode: 1/2 * spécial"), "Episode-1-2-special");
  assert.equal(extensionForMime("video/webm"), "webm");
  assert.equal(extensionForMime("application/octet-stream"), null);
  assert.equal(legacyAssetFilename({ key: "101:poster:v:abc", type: "image/png" }, 0), "cinebox-media-001-101-poster-v-abc.png");
  assert.equal(legacyAssetFilename({ key: "clip.final.webm" }, 4), "cinebox-media-005-clip.final.webm");
});
