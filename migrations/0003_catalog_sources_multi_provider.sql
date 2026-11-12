-- LOT 7.5 audit: allow several remote media providers on the same source table.
--
-- `0002_catalog_sources.sql` only accepted `provider = 'uqload'`. This
-- migration is additive in behaviour: it rebuilds `catalog_media_sources` with
-- an extended CHECK constraint and copies every existing row unchanged. No
-- row is deleted, no `media_assets` row is touched and no upload is performed.
--
-- SQLite cannot alter a CHECK constraint in place, so the table is rebuilt.
-- `catalog_media_sources` only has outgoing foreign keys to `catalog_titles`
-- and `catalog_episodes`; dropping and recreating it does not affect any other
-- table. Indexes are recreated with their original names.
--
-- Association rules remain unchanged:
-- - a film or a video is associated through `title_id` with `episode_id = NULL`;
-- - a series episode is associated through both `title_id` and `episode_id`.
--
-- `playback_url` must be derived from `file_code` and `provider` by
-- `lib/cinebox/media-sources.mjs`; arbitrary URLs are rejected by the helper.

PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS catalog_media_sources_next;

CREATE TABLE catalog_media_sources_next (
  id TEXT PRIMARY KEY,
  title_id TEXT NOT NULL REFERENCES catalog_titles(id) ON DELETE CASCADE,
  episode_id TEXT REFERENCES catalog_episodes(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('uqload', 'vidmoly')),
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

INSERT INTO catalog_media_sources_next (
  id, title_id, episode_id, provider, file_code, video_id, playback_url,
  quality, encoding_status, uploaded_at, created_at, updated_at
)
SELECT
  id, title_id, episode_id, provider, file_code, video_id, playback_url,
  quality, encoding_status, uploaded_at, created_at, updated_at
FROM catalog_media_sources;

DROP TABLE catalog_media_sources;

ALTER TABLE catalog_media_sources_next RENAME TO catalog_media_sources;

CREATE INDEX IF NOT EXISTS idx_media_sources_title
  ON catalog_media_sources(title_id, episode_id);
CREATE INDEX IF NOT EXISTS idx_media_sources_episode
  ON catalog_media_sources(episode_id);
CREATE INDEX IF NOT EXISTS idx_media_sources_status
  ON catalog_media_sources(encoding_status, uploaded_at DESC);
