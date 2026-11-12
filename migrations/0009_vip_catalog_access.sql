ALTER TABLE catalog_titles ADD COLUMN vip_exclusive INTEGER NOT NULL DEFAULT 0 CHECK (vip_exclusive IN (0, 1));
ALTER TABLE catalog_titles ADD COLUMN vip_early_access INTEGER NOT NULL DEFAULT 0 CHECK (vip_early_access IN (0, 1));
ALTER TABLE catalog_titles ADD COLUMN public_at TEXT;

CREATE INDEX IF NOT EXISTS idx_catalog_vip_release
  ON catalog_titles(published, vip_exclusive, vip_early_access, public_at);
