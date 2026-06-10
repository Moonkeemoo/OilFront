# Oil Infrastructure + Tanker Attacks Map Layers — Design

**Date:** 2026-06-10
**Status:** Approved by product owner
**Scope:** Phase 1 of 3 (static reference layers). Phases 2–3 listed as future work only.

## Problem

The tracker shows *where sanctioned tankers are*, but not *why they are there*. Journalists
lack on-map context: which refineries produce the cargo, which pipelines feed which export
terminals, where oil is stored, and where Russia-linked tankers have been attacked. This
feature adds two reference layers — **Infra** (Russian oil infrastructure) and **Attacks**
(Russia-linked tanker incidents) — following the project's existing recon-data pattern.

## Product decisions (locked with owner)

1. **Role:** start with a static reference/context layer; AIS linkage and strike-status
   monitoring are later phases on the same data foundation.
2. **Coverage:** full Russian oil infrastructure (not just the export chain).
3. **Attacks scope:** Russia-linked incidents only (Ukrainian USV strikes, limpet-mine /
   unexplained explosions on shadow-fleet vessels, attacks on tankers in Russian ports).
   No Red Sea / Houthi / Hormuz incidents.
4. **Architecture:** established recon pattern — seed JSON → CLI loader → Postgres →
   cached API endpoint → Leaflet LayerGroup. No new frameworks, no build step.

## Data (must be REAL, every record cited)

All data is gathered by a research pass with cross-verification before implementation.
No synthetic/illustrative records may ship in these two files. Each record carries
`source_urls` (≥1, attacks ≥1 authoritative or 2 independent).

### `data/oil-infra.json`

| Kind | Count target | Fields |
|---|---|---|
| `refinery` | ~35–40 major refineries | name, lat/lon, capacity (Mt/yr and/or bbl/d), owner group, region, status, source_urls |
| `depot` / `terminal` | ~20–30 | name, lat/lon, operator (mostly Transneft subsidiaries), storage volume where known, role (export terminal / tank farm), source_urls |
| `pipeline` | trunk lines: Druzhba (N+S branches), BTS-1, BTS-2, ESPO-1, ESPO-2, CPC, Baku–Novorossiysk, product lines where data allows | name, commodity (crude/products), operator, capacity, simplified GeoJSON LineString geometry, source_urls |

Primary sources: Global Energy Monitor Global Oil Infrastructure Tracker (CC BY —
compatible with the project's "free public sources only" claim), Wikipedia/Wikidata,
CREA publications, OpenStreetMap. Licensing recorded per-source in methodology.

Pipeline geometry is *simplified* (journalistic context, not engineering precision);
vertex count kept low enough that the whole file stays well under ~1 MB.

### `data/tanker-attacks.json`

Russia-linked incidents 2022–2026, target ~30–60 events. Fields: id, occurred_on,
vessel_name, imo (nullable), lat/lon, location_precision (`exact`/`approx`/`port`),
attack_type (`usv_strike` | `limpet_mine` | `port_strike` | `explosion_unexplained`),
summary (1–3 sentences), source_urls. Known anchors: Ursa Major, Seajewel, Seacharm,
Koala, Vilamoura, Black Sea USV strikes, strikes on tankers in Russian ports.

## Backend

- **Migration `db/migrate-add-infra.sql`:** tables `oil_infra` (id TEXT PK, kind, name,
  lat, lon, geometry JSONB NULL, capacity fields, owner, region, status, source_urls
  TEXT[], raw JSONB, first_seen) and `tanker_attacks` (id TEXT PK, occurred_on DATE,
  vessel_name, imo BIGINT NULL, lat, lon, location_precision, attack_type, summary,
  source_urls TEXT[], raw JSONB, first_seen). Indexes: `oil_infra(kind)`,
  `tanker_attacks(imo)`, `tanker_attacks(occurred_on DESC)`. Idempotent
  (`CREATE TABLE IF NOT EXISTS`), same as other recon migrations.
- **Loaders `packages/api/src/cli/load-infra.ts` and `load-attacks.ts`:** copy the
  `load-cases.ts` template — normalize helpers, per-row upsert `ON CONFLICT (id) DO
  UPDATE`, raw JSONB retention, error-capped logging, optional file-path argv override.
  Registered in root `package.json` as `load-infra` / `load-attacks`.
- **Endpoints (in `packages/api/src/server.ts`):**
  - `GET /api/infra` — `?kind=` filter; cache 600 000 ms (same as `/api/zones`).
  - `GET /api/attacks` — `?range=`, `?imo=`, `?format=csv`; cache 300 000 ms. CSV export
    follows the researcher-endpoint convention (`maybeCsvOrJson`).
  - Both degrade gracefully (empty result + flag) when tables are missing, via the
    existing `reconTables()` check pattern.
- **Vessel detail enrichment:** `handleVesselDetail` additionally queries
  `tanker_attacks WHERE imo = $1`; response gains an `attacks` array.

## UI (`web/index.html`)

- Two new LayerGroups: `infraLayer`, `attacksLayer`; chips `Infra` and `Attacks` next to
  the existing Zones/STS/Clean chips; both default ON; state in `layerVisible`.
- **Markers:** refineries — square "factory" SVG icon; depots/terminals — cylinder icon;
  pipelines — `L.polyline` from GeoJSON coords, crude vs products distinguished by color
  (crude: solid amber-brown; products: dashed lighter); attacks — red burst/X icon.
  Infra markers scale down at zoom <5 (smaller icon size), so the global view stays
  readable; pipelines render at all zooms (thin lines).
- **Interaction:** click infra object → side panel card via new `renderInfraPanel()`:
  name, kind, capacity, owner/operator, region, status, source links. Click attack →
  side panel incident card via `renderAttackPanel()`: date, type, vessel name, summary,
  precision caveat, sources; if `imo` present, a button opens the existing vessel detail
  panel. Existing vessel panel gains an "Attacks" section (rendered like Cases) when
  the detail response contains incidents.
- **Legend:** timeline-strip legend extended with infra/attack symbols.
- **Load:** one fetch each at boot (`loadInfra()`, `loadAttacks()`); attacks refreshed
  every 10 min, infra not refreshed (static).

## Methodology + docs

- `web/methodology.html`: new section "Oil infrastructure & tanker-attack layers" —
  source-provenance table rows (GEM CC BY, Wikipedia/Wikidata, CREA, OSM, news sources
  for attacks), explicit caveats (at-sea attack coordinates approximate; refinery
  capacities differ between sources and over time; object status changes faster than
  the dataset; incident list is curated, not exhaustive), refresh cadence (infra:
  manual, quarterly; attacks: manual, ongoing curation).
- `README.md`: the two new loaders added to setup + weekly workflow sections.

## Error handling

- Loaders: per-row try/catch with capped error logging (existing pattern); invalid
  rows skipped, never abort the batch.
- API: missing tables → empty payload + `available: false`-style flag, UI hides chips'
  layers silently (no console errors).
- UI: fetch failures leave layers empty; no retry storms (single boot fetch).

## Testing / verification

- `bun run smoke` still passes.
- Loaders run against local TimescaleDB; row counts reported and spot-checked.
- `curl` checks: `/api/infra`, `/api/infra?kind=pipeline`, `/api/attacks`,
  `/api/attacks?format=csv`, `/api/vessel/{imo}` for a vessel with a known incident.
- Visual check: headless CDP screenshot of the map with both layers on; manual review.
- Data QA gate (before merge): every record has ≥1 source URL; coordinate sanity pass
  (objects fall inside expected region); attacks each have ≥2 independent or 1
  authoritative source.

## Future phases (out of scope now)

- **Phase 2 — AIS linkage:** join tanker port-calls/destinations to specific terminals
  and the pipelines feeding them (Primorsk→BTS, Kozmino→ESPO); terminal cards list
  currently-nearby tracked tankers.
- **Phase 3 — strike monitoring:** refinery/depot status (operational/damaged), strike
  dates from news (GDELT), digest integration.

The Phase-1 schema anticipates both: every infra object has a stable text id, pipeline
records may name the terminal they feed inside `raw` (`feeds_terminal`, optional, no DB
column needed yet), and `oil_infra.status` exists from day one.
