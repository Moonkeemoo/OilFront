-- Adds origin/verified columns to infra_strikes for the ACLED automated strike
-- feed: 'curated' rows come from data/infra-strikes.json (always verified),
-- 'acled' rows are inserted unverified by load-acled-strikes.ts and promoted
-- (or deleted) by the verify-strike curation CLI. Spec:
-- docs/superpowers/specs/2026-06-11-acled-strikes-feed-design.md
--
-- Idempotent. Run via:
--   docker compose exec -T postgres psql -U shadow -d shadow < db/migrate-add-strike-origin.sql
-- The loaders (load-infra-strikes.ts / load-acled-strikes.ts) also add these
-- columns via ensureTable, so a separate migration step is optional.

ALTER TABLE infra_strikes ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'curated';     -- 'curated' | 'acled'
ALTER TABLE infra_strikes ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT TRUE;     -- acled rows insert as FALSE
