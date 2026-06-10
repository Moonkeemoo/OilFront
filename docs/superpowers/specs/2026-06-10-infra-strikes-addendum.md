# Infra Strikes Addendum (Phase 3, first iteration)

**Date:** 2026-06-10. Extends `2026-06-10-oil-infra-attacks-layer-design.md` (Phase 3 was
"strike monitoring" — this delivers the curated-dataset part; live news/GDELT automation
stays future work).

## What

Per-event dataset of Ukrainian strikes on the oil facilities already in `data/oil-infra.json`,
surfaced in the existing Infra layer (no new map layer).

## Data

`data/infra-strikes.json` = `{"strikes": [...]}`; record: `id` (`YYYY-MM-DD-<infra_id>`),
`infra_id` (must match an `oil_infra.id`), `occurred_on` (real date), `weapon`
(`uav|missile|unknown`), `summary` (1-2 sentences, damage as reported), `source_urls`
(1 authoritative or 2+ independent). One record per facility per day. Produced by the same
research pattern as Phase 1 (per-region sweeps → adversarial verify → assemble), documented
in an addendum to the data report.

## Backend (mirror of the attacks pattern)

- `normalizeStrike`/`StrikeRow` in `packages/api/src/infra-normalize.ts` + tests
  (valid record; bad date rejected; unknown weapon→"unknown"; no sources rejected;
  missing infra_id rejected).
- `db/migrate-add-infra-strikes.sql`: `infra_strikes` (id TEXT PK, infra_id TEXT NOT NULL,
  occurred_on DATE NOT NULL, weapon TEXT, summary TEXT, source_urls TEXT[], raw JSONB,
  first_seen TIMESTAMPTZ DEFAULT NOW()); indexes on (infra_id) and (occurred_on DESC).
  Idempotent; loader also creates it.
- `load-infra-strikes.ts` + package.json script; `sql.json()` for raw (NOT stringify+::jsonb).
- `reconTables()` gains `strikes` flag (`public.infra_strikes`).
- `GET /api/infra-strikes` — `?infra_id=`, `?since=`, `?format=csv`; cache 600 000 ms;
  graceful degradation note. Shape `{count, results}` via `maybeCsvOrJson`.

## UI

- `loadInfra()` additionally fetches `/api/infra-strikes` and groups by `infra_id`
  (client-side join; both datasets are small and static).
- Struck facilities get a visual cue: red ring/badge on the infra icon + tooltip suffix
  "· N strikes".
- `openInfraPanel` gains a "💥 Strike history · N" section (date via `fmtDateUTC`, weapon
  label, summary, `sourceLinks`), newest first.
- Methodology: strikes mentioned in the infra/attacks section + source row (press reports)
  already covers it; add one cadence row. README: loader command + feature bullet sentence.

## Out of scope (still future)

Automated news monitoring, auto-status updates from strikes, digest integration.
