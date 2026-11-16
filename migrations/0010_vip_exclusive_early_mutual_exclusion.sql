-- Additive only: enforce at the database level that a title cannot be both
-- VIP-exclusive and an early-access premiere. The application already validates
-- this, but the constraint protects against direct D1 writes and drift.
--
-- SQLite cannot ALTER TABLE to add a CHECK constraint, so triggers are used.
-- They are safe to apply on an existing database: they do not rewrite rows and
-- do not touch data. Existing inconsistent rows (if any) must be fixed first
-- via /api/admin/vip-audit before applying this migration.

CREATE TRIGGER IF NOT EXISTS catalog_titles_vip_flags_insert
BEFORE INSERT ON catalog_titles
WHEN NEW.vip_exclusive = 1 AND NEW.vip_early_access = 1
BEGIN
  SELECT RAISE(ABORT, 'vip_exclusive and vip_early_access are mutually exclusive');
END;

CREATE TRIGGER IF NOT EXISTS catalog_titles_vip_flags_update
BEFORE UPDATE OF vip_exclusive, vip_early_access ON catalog_titles
WHEN NEW.vip_exclusive = 1 AND NEW.vip_early_access = 1
BEGIN
  SELECT RAISE(ABORT, 'vip_exclusive and vip_early_access are mutually exclusive');
END;