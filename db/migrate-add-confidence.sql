-- Adds the automated confidence-engine columns to infra_strikes (spec:
-- docs/superpowers/specs/2026-06-12-auto-verification-design.md). The engine
-- replaces the manual curator gate: instead of a human flipping `verified`, the
-- system clusters candidate+curated rows, scores each event deterministically,
-- and writes the resulting tier/score/breakdown/evidence here.
--
-- These four columns (confidence_tier / confidence_score / score_breakdown /
-- evidence) are WRITTEN by `bun run rescore` (packages/api/src/cli/rescore.ts),
-- which recomputes them every scheduler cycle (promote/demote/retract). They are
-- NOT set by the feed loaders.
--
-- The existing `verified BOOLEAN` column is kept as a DERIVED, back-compat flag:
-- rescore maintains `verified = (confidence_tier = 'confirmed')` so existing
-- endpoints/UI that read `verified` keep working while new UI reads the tier.
--
-- Idempotent. Run via:
--   docker compose exec -T postgres psql -U shadow -d shadow < db/migrate-add-confidence.sql
-- The rescore CLI also adds these columns via ensureColumns, so it
-- self-bootstraps even without applying this migration first.

ALTER TABLE infra_strikes
  ADD COLUMN IF NOT EXISTS confidence_tier  TEXT,     -- 'confirmed' | 'reported' | 'single' | 'stale' | 'retracted'
  ADD COLUMN IF NOT EXISTS confidence_score INTEGER,  -- numeric score, for ordering/tuning
  ADD COLUMN IF NOT EXISTS score_breakdown  JSONB,    -- which signals fired + weights ("why this tier")
  ADD COLUMN IF NOT EXISTS evidence         JSONB;    -- deduped sources / satellite / attribution / cluster members

CREATE INDEX IF NOT EXISTS infra_strikes_tier_idx ON infra_strikes (confidence_tier);
