-- Adds the logistics_sites table: Russian rail and transport/storage
-- infrastructure that feeds the war effort (rail depots/junctions, bridges,
-- ammunition/weapons arsenals) relevant to the Ukraine war.
-- Powers the /api/logistics endpoint and the "Logistics" map layer in the UI.
-- Data: data/logistics-sites.json (curated, source-cited records).
-- Spec: docs/superpowers/specs/2026-06-14-logistics-layer-design.md
--
-- Idempotent. Run via:
--   docker compose exec -T postgres psql -U shadow -d shadow < db/migrate-add-logistics.sql
-- The loader (load-logistics.ts) also creates this table on first run,
-- so a separate migration step is optional.

CREATE TABLE IF NOT EXISTS logistics_sites (
  id          TEXT PRIMARY KEY,       -- stable kebab-case slug
  name        TEXT NOT NULL,
  name_local  TEXT,
  lat         REAL,
  lon         REAL,
  category    TEXT,                   -- 'rail-depot' | 'rail-junction' | 'bridge' | 'arsenal' | 'other'
  role        TEXT,
  operator    TEXT,
  region      TEXT,
  status      TEXT,                   -- 'operational' | 'damaged' | 'destroyed' | 'unknown'
  strikes     JSONB,                  -- array of LogisticsStrike objects
  notes       TEXT,
  source_urls TEXT[],
  raw         JSONB,
  first_seen  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS logistics_sites_category_idx ON logistics_sites (category);
