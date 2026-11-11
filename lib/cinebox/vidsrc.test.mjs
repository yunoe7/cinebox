import test from "node:test";
import assert from "node:assert/strict";
import { buildVidsrcEmbedUrl, buildVidsrcInfoUrl, parseVidsrcPlayerEvent } from "./vidsrc.mjs";

test("construit les URLs de films et épisodes avec paramètres sûrs", () => {
  assert.equal(buildVidsrcEmbedUrl({ kind: "movie", id: 68721, startAt: 300 }), "https://vidsrc.sh/embed/movie/68721?ds_lang=fr&startAt=300");
  assert.equal(buildVidsrcEmbedUrl({ kind: "tv", id: "tt0944947", season: 1, episode: 2, autonext: true }), "https://vidsrc.sh/embed/tv/tt0944947/1/2?ds_lang=fr&autonext=1");
  assert.equal(buildVidsrcEmbedUrl({ kind: "tv", id: 1399 }), "https://vidsrc.sh/embed/tv/1399?ds_lang=fr");
});
test("rejette les identifiants et épisodes invalides", () => {
  assert.throws(() => buildVidsrcEmbedUrl({ kind: "movie", id: "../evil" }));
  assert.throws(() => buildVidsrcEmbedUrl({ kind: "tv", id: 1399, season: 1 }));
});
test("construit les endpoints info", () => {
  assert.equal(buildVidsrcInfoUrl({ kind: "movie", id: 68721 }), "https://vidsrc.sh/info/movie/68721.json");
  assert.equal(buildVidsrcInfoUrl({ kind: "tv", id: 1399, season: 1, episode: 2 }), "https://vidsrc.sh/info/tv/1399/1/2.json");
});
test("accepte uniquement les événements provenant du bon iframe et de l'origine Vidsrc", () => {
  const frame = {};
  const valid = { origin: "https://vidsrc.sh", source: frame, data: { type: "PLAYER_EVENT", data: { player_info: { mediaType: "movie", tmdb: "68721" }, player_status: "playing", player_progress: 10, player_duration: 100 } } };
  assert.deepEqual(parseVidsrcPlayerEvent(valid, frame, { mediaType: "movie", id: "68721" }), { status: "playing", progress: 10, duration: 100, season: null, episode: null });
  assert.equal(parseVidsrcPlayerEvent({ ...valid, origin: "https://evil.example" }, frame), null);
  assert.equal(parseVidsrcPlayerEvent({ ...valid, source: {} }, frame), null);
  assert.equal(parseVidsrcPlayerEvent({ ...valid, data: { ...valid.data, data: { ...valid.data.data, player_progress: -1 } } }, frame), null);
});
