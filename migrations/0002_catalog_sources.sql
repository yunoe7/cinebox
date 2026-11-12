-- LOT 8 preparation: remote media sources (Uqload).
--
-- This migration is additive. It does not modify `0001_shared_catalog.sql`,
-- `media_assets`, `stream_uid` or any existing row. No upload is performed by
-- this schema: it only describes where a playable remote file will live once
-- the future Uqload flow has produced it.
--
-- Association rules:
-- - a film or a video is associated through `title_id` with `episode_id = NULL`;
-- - a series episode is associated through both `title_id` and `episode_id`.
--
-- `playback_url` must be derived from `file_code` by
-- `lib/cinebox/media-sources.mjs`; arbitrary URLs are rejected by the helper.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS catalog_media_sources (
  id TEXT PRIMARY KEY,
  title_id TEXT NOT NULL REFERENCES catalog_titles(id) ON DELETE CASCADE,
  episode_id TEXT REFERENCES catalog_episodes(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('uqload')),
  file_code TEXT NOT NULL CHECK (length(file_code) BETWEEN 6 AND 64),
  video_id TEXT,
  playback_url TEXT NOT NULL CHECK (playback_url LIKE 'https://%'),
  quality TEXT,
  encoding_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (encoding_status IN ('pending', 'processing', 'ready', 'failed')),
  uploaded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, file_code)
);

CREATE INDEX IF NOT EXISTS idx_media_sources_title
  ON catalog_media_sources(title_id, episode_id);
CREATE INDEX IF NOT EXISTS idx_media_sources_episode
  ON catalog_media_sources(episode_id);
CREATE INDEX IF NOT EXISTS idx_media_sources_status
  ON catalog_media_sources(encoding_status, uploaded_at DESC);
