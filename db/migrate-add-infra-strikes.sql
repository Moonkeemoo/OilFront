-- Adds the infra_strikes table: per-event Ukrainian strikes on the oil
-- facilities in oil_infra (infra_id references oil_infra.id). Powers the
-- /api/infra-strikes endpoint and the strike-history section of the Infra
-- layer. Data: data/infra-strikes.json (real, cited records — see
-- docs/superpowers/specs/2026-06-10-infra-strikes-addendum.md).
--
-- Idempotent. Run via:
--   docker compose exec -T postgres psql -U shadow -d shadow -f /tmp/migrate-add-infra-strikes.sql
-- The loader (load-infra-strikes.ts) also creates this table on first run,
-- so a separate migration step is optional.

CREATE TABLE IF NOT EXISTS infra_strikes (
  id          TEXT PRIMARY KEY,     -- YYYY-MM-DD-<infra_id>
  infra_id    TEXT NOT NULL,        -- matches oil_infra.id
  occurred_on DATE NOT NULL,
  weapon      TEXT,                 -- 'uav' | 'missile' | 'unknown'
  summary     TEXT,
  source_urls TEXT[],
  raw         JSONB,
  first_seen  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS infra_strikes_infra_idx       ON infra_strikes (infra_id);
CREATE INDEX IF NOT EXISTS infra_strikes_occurred_on_idx ON infra_strikes (occurred_on DESC);
