import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPlaybackUrl,
  createMediaSource,
  isMediaSource,
  normalizeEncodingStatus,
  normalizeFileCode,
  normalizeProvider,
  parseUqloadUrl,
  playbackUrlForSource,
  selectPrimarySource,
  sourcesForEpisode,
  sourcesForTitle,
} from "./media-sources.mjs";

const code = "abc123def456";

test("un fournisseur inconnu est refusé", () => {
  assert.equal(normalizeProvider("uqload"), "uqload");
  assert.equal(normalizeProvider("UQLOAD"), "uqload");
  assert.equal(normalizeProvider("bunny"), null);
  assert.equal(normalizeProvider(undefined), null);
});

test("un code fichier Uqload valide est normalisé", () => {
  assert.equal(normalizeFileCode(code), code);
  assert.equal(normalizeFileCode(`${code}.html`), code);
  assert.equal(normalizeFileCode("trop court"), null);
  assert.equal(normalizeFileCode("abc/../def"), null);
});

test("l’URL de lecture est dérivée du code, jamais inventée", () => {
  assert.equal(buildPlaybackUrl(code), `https://uqload.to/embed-${code}.html`);
  assert.equal(buildPlaybackUrl("invalide!"), null);
});

test("une URL Uqload est lue sans réseau", () => {
  assert.deepEqual(parseUqloadUrl(`https://uqload.to/embed-${code}.html`), { provider: "uqload", fileCode: code });
  assert.deepEqual(parseUqloadUrl(`https://www.uqload.com/${code}.html`), { provider: "uqload", fileCode: code });
  assert.equal(parseUqloadUrl("https://example.com/video"), null);
  assert.equal(parseUqloadUrl("javascript:alert(1)"), null);
});

test("createMediaSource normalise une source de film", () => {
  const source = createMediaSource({
    title_id: "tmdb:movie:550",
    file_code: code,
    playback_url: "https://evil.example/embed",
    quality: "1080p",
    encoding_status: "READY",
    uploaded_at: "2026-01-02T03:04:05Z",
  });
  assert.deepEqual(source, {
    titleId: "tmdb:movie:550",
    episodeId: null,
    provider: "uqload",
    fileCode: code,
    videoId: code,
    playbackUrl: `https://uqload.to/embed-${code}.html`,
    quality: "1080p",
    encodingStatus: "ready",
    uploadedAt: "2026-01-02T03:04:05.000Z",
  });
  assert.equal(isMediaSource(source), true);
  assert.equal(playbackUrlForSource(source), `https://uqload.to/embed-${code}.html`);
});

test("createMediaSource refuse une source incomplète", () => {
  assert.equal(createMediaSource({ file_code: code }), null);
  assert.equal(createMediaSource({ title_id: "tmdb:movie:550" }), null);
  assert.equal(createMediaSource({ title_id: "tmdb:movie:550", file_code: "bad code" }), null);
  assert.equal(createMediaSource(null), null);
});

test("createMediaSource accepte une URL Uqload comme source de code", () => {
  const source = createMediaSource({ titleId: "cinebox:1", playbackUrl: `https://uqload.to/${code}.html` });
  assert.equal(source?.fileCode, code);
  assert.equal(source?.encodingStatus, "pending");
  assert.equal(source?.quality, null);
});

test("le statut d’encodage retombe sur pending", () => {
  assert.equal(normalizeEncodingStatus("processing"), "processing");
  assert.equal(normalizeEncodingStatus("ready"), "ready");
  assert.equal(normalizeEncodingStatus("inconnu"), "pending");
  assert.equal(normalizeEncodingStatus(undefined), "pending");
});

test("les sources sont associées au film ou à l’épisode", () => {
  const movie = createMediaSource({ titleId: "movie-1", fileCode: code, encodingStatus: "ready" });
  const episodeOne = createMediaSource({ titleId: "series-1", episodeId: "s1e1", fileCode: "episode00001", encodingStatus: "pending" });
  const episodeTwo = createMediaSource({ titleId: "series-1", episodeId: "s1e2", fileCode: "episode00002", encodingStatus: "failed" });
  const all = [movie, episodeOne, episodeTwo];

  assert.deepEqual(sourcesForTitle(all, "movie-1").map((source) => source.fileCode), [code]);
  assert.deepEqual(sourcesForEpisode(all, "series-1", "s1e1").map((source) => source.fileCode), ["episode00001"]);
  assert.deepEqual(sourcesForEpisode(all, "series-1", "s1e2").map((source) => source.fileCode), ["episode00002"]);
});

test("selectPrimarySource préfère une source prête et ignore les échecs", () => {
  const pending = createMediaSource({ titleId: "movie-1", fileCode: "pending0001", encodingStatus: "pending" });
  const ready = createMediaSource({ titleId: "movie-1", fileCode: "ready00001", encodingStatus: "ready" });
  const failed = createMediaSource({ titleId: "movie-1", fileCode: "failed0001", encodingStatus: "failed" });

  assert.equal(selectPrimarySource([pending, failed, ready], { titleId: "movie-1" })?.fileCode, "ready00001");
  assert.equal(selectPrimarySource([failed], { titleId: "movie-1" }), null);
  assert.equal(selectPrimarySource([pending, ready], { titleId: "movie-1", episodeId: "s1e1" }), null);
});
