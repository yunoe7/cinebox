-- Rate limits for member authentication endpoints.
-- Additive only; expired rows are periodically eligible for cleanup.
CREATE TABLE IF NOT EXISTS account_rate_limits (
  rate_key TEXT NOT NULL,
  window_start TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (rate_key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_account_rate_limits_expiry
  ON account_rate_limits(expires_at);
