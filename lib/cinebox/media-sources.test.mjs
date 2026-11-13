import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPlaybackUrl,
  createMediaSource,
  encodingStatusFromCanplay,
  isMediaSource,
  normalizeEncodingStatus,
  normalizeFileCode,
  normalizePlaybackUrl,
  normalizeProvider,
  parseMediaSourceUrl,
  parseUqloadUrl,
  parseVidMolyUrl,
  playbackUrlForSource,
  selectPrimarySource,
  sourcesForEpisode,
  sourcesForTitle,
} from "./media-sources.mjs";

const code = "abc123def456";
const vidmolyCode = "vidmoly1234";

test("un fournisseur inconnu est refusé", () => {
  assert.equal(normalizeProvider("uqload"), "uqload");
  assert.equal(normalizeProvider("UQLOAD"), "uqload");
  assert.equal(normalizeProvider("vidmoly"), "vidmoly");
  assert.equal(normalizeProvider("VIDMOLY"), "vidmoly");
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
  assert.equal(buildPlaybackUrl(code), `https://uqload.vc/embed-${code}.html`);
  assert.equal(buildPlaybackUrl("invalide!"), null);
});

test("une URL Uqload est lue sans réseau", () => {
  assert.deepEqual(parseUqloadUrl(`https://uqload.vc/embed-${code}.html`), { provider: "uqload", fileCode: code, host: "uqload.vc" });
  assert.deepEqual(parseUqloadUrl(`https://uqload.to/embed-${code}.html`), { provider: "uqload", fileCode: code, host: "uqload.to" });
  assert.deepEqual(parseUqloadUrl(`https://www.uqload.com/${code}.html?utm_source=test`), { provider: "uqload", fileCode: code, host: "uqload.com" });
  assert.equal(parseUqloadUrl("https://example.com/video"), null);
  assert.equal(parseUqloadUrl("javascript:alert(1)"), null);
});

test("les anciens domaines Uqload sont normalisés vers uqload.vc à la lecture", () => {
  assert.equal(normalizePlaybackUrl(`https://uqload.to/embed-${code}.html`), `https://uqload.vc/embed-${code}.html`);
  assert.equal(normalizePlaybackUrl(`https://uqload.com/${code}.html?x=1`), `https://uqload.vc/embed-${code}.html`);
  assert.equal(normalizePlaybackUrl(`https://uqload.is/embed-${code}`), `https://uqload.vc/embed-${code}.html`);
  // Vidmoly hosts that serve the player directly are preserved.
  assert.equal(normalizePlaybackUrl(`https://vidmoly.org/embed-${vidmolyCode}.html`), `https://vidmoly.org/embed-${vidmolyCode}.html`);
  assert.equal(normalizePlaybackUrl(`https://vidmoly.biz/embed-${vidmolyCode}.html`), `https://vidmoly.biz/embed-${vidmolyCode}.html`);
  assert.equal(normalizePlaybackUrl(`https://vidmoly.net/embed-${vidmolyCode}.html`), `https://vidmoly.net/embed-${vidmolyCode}.html`);
  // `.me` redirects an embed URL to `embed-embed-…`: fall back to canonical.
  assert.equal(normalizePlaybackUrl(`https://vidmoly.me/embed-${vidmolyCode}.html`), `https://vidmoly.to/embed-${vidmolyCode}.html`);
  assert.equal(normalizePlaybackUrl(`https://vidmoly.com/embed-${vidmolyCode}.html`), `https://vidmoly.to/embed-${vidmolyCode}.html`);
  assert.equal(normalizePlaybackUrl("blob:https://cinebox.test/abc"), "blob:https://cinebox.test/abc");
  assert.equal(normalizePlaybackUrl("  "), null);
  assert.equal(normalizePlaybackUrl(null), null);
});

test("le statut d'encodage suit canplay et reste inconnu sans valeur", () => {
  assert.equal(encodingStatusFromCanplay(1), "ready");
  assert.equal(encodingStatusFromCanplay("1"), "ready");
  assert.equal(encodingStatusFromCanplay(0), "processing");
  assert.equal(encodingStatusFromCanplay("0"), "processing");
  assert.equal(encodingStatusFromCanplay(undefined), "pending");
  assert.equal(encodingStatusFromCanplay(null), "pending");
  assert.equal(encodingStatusFromCanplay(""), "pending");
  assert.equal(encodingStatusFromCanplay("inconnu"), "pending");
});

test("VidMoly est un fournisseur distinct avec sa propre URL dérivée", () => {
  assert.equal(buildPlaybackUrl(vidmolyCode, "vidmoly"), `https://vidmoly.to/embed-${vidmolyCode}.html`);
  assert.equal(buildPlaybackUrl(code, "vidmoly"), `https://vidmoly.to/embed-${code}.html`);
  assert.equal(buildPlaybackUrl(vidmolyCode, "inconnu"), null);
  assert.deepEqual(parseVidMolyUrl(`https://vidmoly.net/embed-${vidmolyCode}.html`), { provider: "vidmoly", fileCode: vidmolyCode, host: "vidmoly.net" });
  assert.deepEqual(parseMediaSourceUrl(`https://www.vidmoly.me/${vidmolyCode}.html`), { provider: "vidmoly", fileCode: vidmolyCode, host: "vidmoly.me" });
  assert.deepEqual(parseVidMolyUrl(`https://vidmoly.org/embed-${vidmolyCode}.html`), { provider: "vidmoly", fileCode: vidmolyCode, host: "vidmoly.org" });
  assert.deepEqual(parseVidMolyUrl(`https://vidmoly.biz/embed-${vidmolyCode}.html`), { provider: "vidmoly", fileCode: vidmolyCode, host: "vidmoly.biz" });
  assert.equal(parseVidMolyUrl(`https://vidmoly.cc/embed-${vidmolyCode}.html`), null);
  assert.equal(parseVidMolyUrl(`https://uqload.to/embed-${code}.html`), null);
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
    playbackUrl: `https://uqload.vc/embed-${code}.html`,
    quality: "1080p",
    encodingStatus: "ready",
    uploadedAt: "2026-01-02T03:04:05.000Z",
  });
  assert.equal(isMediaSource(source), true);
  assert.equal(playbackUrlForSource(source), `https://uqload.vc/embed-${code}.html`);
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
  assert.equal(source?.playbackUrl, `https://uqload.vc/embed-${code}.html`);
  assert.equal(source?.encodingStatus, "pending");
  assert.equal(source?.quality, null);
});

test("createMediaSource accepte VidMoly et infère le fournisseur depuis l’URL", () => {
  const explicit = createMediaSource({
    titleId: "tmdb:series:42",
    episodeId: "tmdb:series:42:s1:e2",
    provider: "vidmoly",
    fileCode: vidmolyCode,
    encodingStatus: "ready",
  });
  assert.equal(explicit?.provider, "vidmoly");
  assert.equal(explicit?.playbackUrl, `https://vidmoly.to/embed-${vidmolyCode}.html`);
  assert.equal(isMediaSource(explicit), true);

  const inferred = createMediaSource({ titleId: "tmdb:movie:550", playbackUrl: `https://vidmoly.net/embed-${vidmolyCode}.html` });
  assert.equal(inferred?.provider, "vidmoly");
  assert.equal(inferred?.fileCode, vidmolyCode);
  assert.equal(inferred?.playbackUrl, `https://vidmoly.net/embed-${vidmolyCode}.html`);

  // A user-provided Vidmoly embed host is preserved instead of rewritten.
  const org = createMediaSource({ titleId: "tmdb:movie:550", playbackUrl: `https://vidmoly.org/embed-${vidmolyCode}.html` });
  assert.equal(org?.provider, "vidmoly");
  assert.equal(org?.playbackUrl, `https://vidmoly.org/embed-${vidmolyCode}.html`);
  assert.equal(isMediaSource(org), true);
  assert.equal(playbackUrlForSource(org), `https://vidmoly.org/embed-${vidmolyCode}.html`);
});

test("createMediaSource refuse un fournisseur explicite incompatible avec l’URL", () => {
  assert.equal(createMediaSource({
    titleId: "tmdb:movie:550",
    provider: "uqload",
    playbackUrl: `https://vidmoly.to/embed-${vidmolyCode}.html`,
  }), null);
  assert.equal(createMediaSource({
    titleId: "tmdb:movie:550",
    provider: "vidmoly",
    playbackUrl: `https://uqload.to/embed-${code}.html`,
  }), null);
});

test("isMediaSource refuse une URL dérivée d’un autre fournisseur", () => {
  const source = createMediaSource({ titleId: "tmdb:movie:550", provider: "vidmoly", fileCode: vidmolyCode });
  assert.equal(isMediaSource(source), true);
  assert.equal(isMediaSource({ ...source, playbackUrl: `https://uqload.to/embed-${vidmolyCode}.html` }), false);
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

test("plusieurs sources de fournisseurs différents peuvent coexister", () => {
  const uqload = createMediaSource({ titleId: "movie-2", provider: "uqload", fileCode: "uqload00001", encodingStatus: "pending" });
  const vidmoly = createMediaSource({ titleId: "movie-2", provider: "vidmoly", fileCode: "vidmoly00001", encodingStatus: "ready" });
  const all = [uqload, vidmoly];

  assert.equal(sourcesForTitle(all, "movie-2").length, 2);
  assert.deepEqual(sourcesForTitle(all, "movie-2").map((source) => source.provider).sort(), ["uqload", "vidmoly"]);
  assert.equal(selectPrimarySource(all, { titleId: "movie-2" })?.provider, "vidmoly");
});
