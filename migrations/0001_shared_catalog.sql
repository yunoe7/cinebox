PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  discord_user_id TEXT UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_allowlist (
  discord_user_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS catalog_titles (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('movie', 'series', 'video')),
  title TEXT NOT NULL,
  overview TEXT NOT NULL DEFAULT '',
  release_date TEXT,
  poster_path TEXT,
  backdrop_path TEXT,
  genres_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS catalog_episodes (
  id TEXT PRIMARY KEY,
  title_id TEXT NOT NULL REFERENCES catalog_titles(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL CHECK (season_number >= 0),
  episode_number INTEGER NOT NULL CHECK (episode_number >= 0),
  title TEXT NOT NULL,
  overview TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER,
  stream_uid TEXT,
  thumbnail_path TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(title_id, season_number, episode_number)
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  title_id TEXT REFERENCES catalog_titles(id) ON DELETE CASCADE,
  episode_id TEXT REFERENCES catalog_episodes(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('cloudflare_stream', 'r2')),
  provider_uid TEXT NOT NULL,
  original_filename TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'error', 'deleted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((title_id IS NOT NULL) OR (episode_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS user_favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id TEXT NOT NULL REFERENCES catalog_titles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, title_id)
);

CREATE TABLE IF NOT EXISTS user_progress (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id TEXT NOT NULL REFERENCES catalog_titles(id) ON DELETE CASCADE,
  episode_id TEXT REFERENCES catalog_episodes(id) ON DELETE CASCADE,
  current_seconds REAL NOT NULL DEFAULT 0 CHECK (current_seconds >= 0),
  duration_seconds REAL,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_progress_unique
  ON user_progress(user_id, title_id, ifnull(episode_id, ''));
CREATE INDEX IF NOT EXISTS idx_catalog_published_kind
  ON catalog_titles(published, kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_title_order
  ON catalog_episodes(title_id, season_number, episode_number);
CREATE INDEX IF NOT EXISTS idx_media_provider_uid
  ON media_assets(provider, provider_uid);
CREATE INDEX IF NOT EXISTS idx_progress_user_updated
  ON user_progress(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS watch_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id TEXT NOT NULL REFERENCES catalog_titles(id) ON DELETE CASCADE,
  episode_id TEXT REFERENCES catalog_episodes(id) ON DELETE SET NULL,
  watched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_history_user_date
  ON watch_history(user_id, watched_at DESC);
