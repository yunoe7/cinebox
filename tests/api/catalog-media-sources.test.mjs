import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../../functions/api/catalog/index.ts";

const TITLE = {
  id: "tmdb:movie:1",
  kind: "movie",
  title: "Film de test",
  overview: "",
  release_date: "2024-01-01",
  poster_path: null,
  backdrop_path: null,
  genres_json: "[]",
  metadata_json: "{}",
  updated_at: "2026-01-01 00:00:00",
  vip_exclusive: 0,
  vip_early_access: 0,
  public_at: null,
};

function makeCatalogEnv({ title = TITLE, episodes = [], sources = [] } = {}) {
  const calls = [];
  const env = {
    DB: {
      prepare(sql) {
        const call = { sql, values: [] };
        calls.push(call);
        return {
          bind(...values) { call.values = values; return this; },
          async first() { return /INSERT INTO account_rate_limits/.test(sql) ? { attempts: 1 } : null; },
          async all() {
            if (/COUNT\(\*\) AS titles/.test(sql)) {
              return { success: true, results: [{ titles: 1, films: 1, series: 0, videos: 0 }] };
            }
            if (/COUNT\(\*\) AS episodes/.test(sql)) {
              return { success: true, results: [{ episodes: episodes.length }] };
            }
            if (/FROM catalog_media_sources/.test(sql)) return { success: true, results: sources };
            if (/FROM catalog_episodes/.test(sql)) return { success: true, results: episodes };
            return { success: true, results: [title] };
          },
        };
      },
    },
  };
  return { env, calls };
}

const CODE = "abc123def456";

test("une ancienne URL uqload.to est servie en uqload.vc sans modifier D1", async () => {
  const legacy = `https://uqload.to/embed-${CODE}.html`;
  const source = {
    title_id: TITLE.id, episode_id: null, provider: "uqload", file_code: CODE,
    playback_url: legacy, encoding_status: "ready",
  };
  const { env, calls } = makeCatalogEnv({ sources: [source] });
  const response = await onRequestGet({ request: new Request("https://cinebox.test/api/catalog"), env });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.titles[0].videoUrl, `https://uqload.vc/embed-${CODE}.html`);
  // The stored value is never rewritten in place.
  assert.equal(source.playback_url, legacy);
  const sourceQuery = calls.find((call) => /FROM catalog_media_sources/.test(call.sql));
  assert.ok(sourceQuery, "a media source query must run");
  assert.match(sourceQuery.sql, /encoding_status/);
  assert.match(sourceQuery.sql, /ORDER BY CASE LOWER\(COALESCE\(encoding_status,''\)\)/);
  assert.match(sourceQuery.sql, /updated_at DESC, id DESC/);
});

test("une source en échec est ignorée au profit de la source prête", async () => {
  const failed = {
    title_id: TITLE.id, episode_id: null, provider: "uqload", file_code: "failed000001",
    playback_url: "https://uqload.vc/embed-failed000001.html", encoding_status: "failed",
  };
  const ready = {
    title_id: TITLE.id, episode_id: null, provider: "vidmoly", file_code: "ready0000001",
    playback_url: "https://vidmoly.to/embed-ready0000001.html", encoding_status: "ready",
  };
  const { env } = makeCatalogEnv({ sources: [failed, ready] });
  const response = await onRequestGet({ request: new Request("https://cinebox.test/api/catalog"), env });
  const body = await response.json();
  assert.equal(body.titles[0].videoUrl, "https://vidmoly.to/embed-ready0000001.html");
});

test("un titre dont toutes les sources ont échoué n'expose aucune URL de lecture", async () => {
  const failed = {
    title_id: TITLE.id, episode_id: null, provider: "uqload", file_code: "failed000001",
    playback_url: "https://uqload.vc/embed-failed000001.html", encoding_status: "FAILED",
  };
  const { env } = makeCatalogEnv({ sources: [failed] });
  const response = await onRequestGet({ request: new Request("https://cinebox.test/api/catalog"), env });
  const body = await response.json();
  assert.equal(body.titles[0].videoUrl, undefined);
});

test("une source sans URL stockée est reconstruite depuis son code", async () => {
  const source = {
    title_id: TITLE.id, episode_id: null, provider: "uqload", file_code: CODE,
    playback_url: null, encoding_status: "ready",
  };
  const { env } = makeCatalogEnv({ sources: [source] });
  const response = await onRequestGet({ request: new Request("https://cinebox.test/api/catalog"), env });
  const body = await response.json();
  assert.equal(body.titles[0].videoUrl, `https://uqload.vc/embed-${CODE}.html`);
});

test("une source Vidmoly .org est servie sur son hôte d'origine", async () => {
  const source = {
    title_id: TITLE.id, episode_id: null, provider: "vidmoly", file_code: CODE,
    playback_url: `https://vidmoly.org/embed-${CODE}.html`, encoding_status: "ready",
  };
  const { env } = makeCatalogEnv({ sources: [source] });
  const response = await onRequestGet({ request: new Request("https://cinebox.test/api/catalog"), env });
  const body = await response.json();
  assert.equal(body.titles[0].videoUrl, `https://vidmoly.org/embed-${CODE}.html`);
  assert.equal(source.playback_url, `https://vidmoly.org/embed-${CODE}.html`);
});

test("les sources d'épisode sont exposées sur l'épisode correspondant", async () => {
  const episode = {
    id: "ep-1", title_id: TITLE.id, season_number: 1, episode_number: 1,
    title: "Épisode 1", overview: "", duration_seconds: 1200,
    thumbnail_path: null, metadata_json: "{}",
  };
  const series = { ...TITLE, kind: "series", id: "tmdb:series:2" };
  const source = {
    title_id: series.id, episode_id: episode.id, provider: "uqload", file_code: CODE,
    playback_url: `https://uqload.is/embed-${CODE}.html`, encoding_status: "ready",
  };
  const { env } = makeCatalogEnv({ title: series, episodes: [{ ...episode, title_id: series.id }], sources: [source] });
  const response = await onRequestGet({ request: new Request("https://cinebox.test/api/catalog"), env });
  const body = await response.json();
  assert.equal(body.titles[0].videoUrl, undefined);
  assert.equal(body.titles[0].seasons[0].episodes[0].videoUrl, `https://uqload.vc/embed-${CODE}.html`);
});
