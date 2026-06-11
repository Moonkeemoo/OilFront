-- Adds the refining_outage table: point-in-time, source-cited external
-- estimates of Russian primary-refining capacity offline due to strikes
-- (Reuters / Bloomberg / CREA / S&P / Energy Aspects ...). These are OTHERS'
-- published numbers — NOT computed by us — and power the external-estimate
-- chart on the Impact page (web/impact.html) and outage_estimates in
-- /api/impact. Data: data/refining-outage.json (every row source-cited).
-- Spec: docs/superpowers/specs/2026-06-11-impact-methodology-design.md
--
-- Idempotent. Run via:
--   docker compose exec -T postgres psql -U shadow -d shadow < db/migrate-add-refining-outage.sql
-- The loader (load-refining-outage.ts) also creates this table on first run,
-- so a separate migration step is optional.

CREATE TABLE IF NOT EXISTS refining_outage (
  id          TEXT PRIMARY KEY,     -- ${as_of}-${source-slug}
  as_of       DATE NOT NULL,        -- date the estimate is published / valid for
  offline_kbd REAL,                 -- thousand barrels/day offline (nullable)
  offline_pct REAL,                 -- % of primary refining offline (nullable)
  metric      TEXT,                 -- 'kbd' | 'pct' (which figure the source led with)
  source      TEXT,                 -- Reuters | Bloomberg | CREA | S&P | EnergyAspects | ...
  source_url  TEXT,                 -- citation (required by the loader)
  note        TEXT,                 -- 1-line context
  raw         JSONB,
  first_seen  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS refining_outage_as_of_idx ON refining_outage (as_of);
