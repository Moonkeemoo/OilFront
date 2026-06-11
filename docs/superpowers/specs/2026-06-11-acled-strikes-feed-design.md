# ACLED Automated Strike Feed — Design

**Date:** 2026-06-11
**Status:** Approved direction (agreed 2026-06-10); extends the infra-strikes addendum.
**Goal:** keep `infra_strikes` fresh automatically: pull candidate strike events on our
81 mapped facilities from the ACLED API, spatially joined to `oil_infra`, marked
`auto`/unverified until a curator confirms.

## Source

ACLED API (free registered access). Auth: OAuth password grant — POST
`https://acleddata.com/oauth/token` (`username`=email, `password`, `grant_type=password`,
`client_id=acled`) → 24h bearer token. Data: `https://acleddata.com/api/acled/read?_format=json`
filtered to Russia, event_type `Explosions/Remote violence`, date window. Credentials come
from `.env`: `ACLED_EMAIL`, `ACLED_PASSWORD` (both optional — everything degrades
gracefully without them). Licensing: ACLED terms forbid republishing raw data; we store
events internally and show only our own aggregated rendering with attribution — an
attribution line goes into methodology + the strike entry chip links to acleddata.com.

## Matching (spatial join)

For each ACLED event: candidate facilities = point objects in `oil_infra`
(refinery/depot/terminal — pipelines skipped in v1) within **10 km** haversine of the
event coordinates. If ≥1 match: take the nearest. Additionally require the event `notes`
to look oil-related (`refinery|oil depot|fuel|НПЗ|нефтебаз|oil terminal|petroleum`, case-
insensitive) OR distance ≤ 3 km — refineries are big and ACLED geocodes to city centroids,
so the keyword check carries most of the precision. No match → event dropped.

## Storage

`infra_strikes` gains two columns (idempotent migration `db/migrate-add-strike-origin.sql`
+ loaders' ensureTable updated):

- `origin TEXT NOT NULL DEFAULT 'curated'` — `'curated' | 'acled'`
- `verified BOOLEAN NOT NULL DEFAULT TRUE` — ACLED rows insert as `FALSE`

ACLED row mapping: id `acled-<event_id_cnty>`, `infra_id` from the join, `occurred_on` =
event_date, `weapon` = 'uav' when notes mention drone/UAV else 'unknown', `summary` =
trimmed ACLED notes (≤300 chars) + " [auto: ACLED]", `source_urls` =
["https://acleddata.com"] (raw source string kept in `raw`). Skip insert when a curated
record already exists for the same `infra_id` + `occurred_on` (the curated dataset wins);
plain upsert by id otherwise (re-runs refresh notes).

## Loader + curation CLI

- `packages/api/src/cli/load-acled-strikes.ts` (`bun run load-acled-strikes [since]`):
  default window = last 30 days (arg `2026-01-01` widens). No creds → logs
  `acled_not_configured` and exits 0. Token fetch → paged reads (limit=5000) → match →
  upsert. Logs: events fetched, matched, inserted, skipped-as-curated.
- `packages/api/src/cli/verify-strike.ts` (`bun run verify-strike <id|--reject id>`):
  curator promotes (`verified=true`, origin stays 'acled') or deletes a candidate.
- Pure logic (`matchEventToFacility`, `mapAcledEvent`) lives in
  `packages/api/src/acled-match.ts` — unit-tested with fixture events (no network).

## API / UI

- `/api/infra-strikes` SELECT gains `origin, verified`; optional `?verified=true|false`
  filter. Cache drops to 300 000 ms (feed is no longer fully static).
- UI strike entries: unverified rows get an amber `auto · unverified` chip (reuses
  `strikeChip`) and sit in the same numbered list; tooltip counter counts only verified
  rows, panel section shows both.
- Methodology: ACLED added to the source-provenance table (free registered, attribution
  required, no raw republication) + cadence row (weekly `load-acled-strikes`).
- README: .env keys, loader + verify commands, weekly cadence line.

## Out of scope (v1)

GDELT freshness signal, auto-status updates of facilities, scheduled cron (documented as
manual weekly command; Windows Task Scheduler snippet in README is a nice-to-have).
