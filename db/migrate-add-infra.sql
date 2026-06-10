-- Adds reference layers: Russian oil infrastructure + Russia-linked tanker attacks.
-- Powers the /api/infra and /api/attacks endpoints and the "Infra" / "Attacks"
-- map layers in the UI. Data: data/oil-infra.json, data/tanker-attacks.json
-- (real, cited records — see docs/superpowers/specs/2026-06-10-infra-attacks-data-report.md).
--
-- Idempotent. Run via:
--   docker compose exec -T postgres psql -U shadow -d shadow -f /tmp/migrate-add-infra.sql
-- The loaders (load-infra.ts / load-attacks.ts) also create these tables on first
-- run, so a separate migration step is optional.

-- Oil infrastructure: refineries, depots/tank farms, marine export terminals,
-- trunk pipelines (geometry = simplified GeoJSON LineString/MultiLineString).
CREATE TABLE IF NOT EXISTS oil_infra (
  id               TEXT PRIMARY KEY,      -- stable kebab-case slug
  kind             TEXT NOT NULL,         -- 'refinery' | 'depot' | 'terminal' | 'pipeline'
  name             TEXT NOT NULL,
  name_local       TEXT,
  lat              REAL,                  -- NULL for pipelines
  lon              REAL,
  geometry         JSONB,                 -- pipelines only
  commodity        TEXT,                  -- 'crude' | 'products' (pipelines)
  capacity_mt_yr   REAL,                  -- refineries: refining capacity, Mt/yr
  capacity_bbl_d   REAL,
  storage_m3       REAL,                  -- depots/terminals
  throughput_mt_yr REAL,                  -- pipelines/terminals
  owner            TEXT,
  operator         TEXT,
  region           TEXT,
  status           TEXT,                  -- 'operational' | 'damaged' | 'unknown'
  notes            TEXT,
  source_urls      TEXT[],
  raw              JSONB,
  first_seen       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS oil_infra_kind_name_idx ON oil_infra (kind, name);

-- Russia-linked attacks on tankers (USV strikes, limpet mines, port strikes,
-- unexplained explosions). imo links incidents to vessel detail panels.
CREATE TABLE IF NOT EXISTS tanker_attacks (
  id                 TEXT PRIMARY KEY,    -- YYYY-MM-DD-slug
  occurred_on        DATE NOT NULL,
  vessel_name        TEXT,
  imo                BIGINT,
  lat                REAL NOT NULL,
  lon                REAL NOT NULL,
  location_precision TEXT,                -- 'exact' | 'approx' | 'port'
  attack_type        TEXT NOT NULL,       -- 'usv_strike' | 'limpet_mine' | 'port_strike' | 'explosion_unexplained'
  summary            TEXT,
  source_urls        TEXT[],
  raw                JSONB,
  first_seen         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS attacks_imo_idx         ON tanker_attacks (imo) WHERE imo IS NOT NULL;
CREATE INDEX IF NOT EXISTS attacks_occurred_on_idx ON tanker_attacks (occurred_on DESC);
