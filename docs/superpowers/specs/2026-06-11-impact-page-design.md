# Impact page — economic/operational toll of the strike campaign

**Date:** 2026-06-11
**Status:** Approved (user; #4 permalink and #6 cron deferred).
**Thesis:** turn the strike data into the headline story journalists quote — how much
Russian refining the campaign has hit, over time — using ONLY real data we hold.

## Honesty constraints (define the whole design)
- **No revenue figures.** The CREA seed shipped with the repo is illustrative/synthetic.
  Inventing a "$X lost" number would break the project's every-record-cited ethos. The
  page reports **capacity / throughput exposure**, not money.
- **Exposure, not outage.** We have no facility-downtime data; a strike ≠ permanent
  offline. Every capacity figure is labelled "nameplate capacity at struck facilities —
  exposure, not measured outage."
- Numbers derive from `infra_strikes` ⋈ `oil_infra.capacity_mt_yr` only (real, cited).

## Page: `web/impact.html` (sibling of `web/digest.html`, same dark theme/header)
Served by the existing static handler; linked from the header impact tile in index.html
(the tile's click opens `/impact.html`). Sections:

1. **Headline cards** (reuse digest card style): total strikes (all-time + last 30/90d);
   distinct facilities struck (all-time / 90d); refining capacity at facilities struck in
   90d (Mt/yr) and its share of total mapped refining capacity; count satellite-corroborated
   (verified strikes that have a FIRMS match — if cheap; else omit).
2. **Monthly time-series** (inline SVG, styled like the index timeline strip): per calendar
   month 2022→now, two series — strikes count and distinct-facilities-struck — as bars;
   a thin line for cumulative distinct facilities ever hit. Hover tooltip per month.
3. **Top struck facilities** — table: facility, region, strikes, capacity (Mt/yr), last hit
   (relative). Top 15 by strike count. Facility name links to `/?i=<id>` (plain index for
   now; deep-link lands on the map — permalink wiring is #4, deferred, so just link to `/`).
4. **Breakdowns** — by weapon (uav/missile/unknown bars) and by region (top regions by
   strikes). Simple bar lists.
- All-data caveat footer + link back to map and to methodology.

## API: `GET /api/impact` (cache 300 000 ms, graceful `available:false`)
One endpoint returning everything the page needs, from `infra_strikes` + `oil_infra`:
```
{
  available: true,
  totals: { strikes_all, strikes_30d, strikes_90d,
            struck_all, struck_90d,
            capacity_struck_90d_mt_yr, total_refining_capacity_mt_yr, pct_capacity_struck_90d,
            corroborated },            // corroborated optional; 0 if not computed
  monthly: [ { month: "YYYY-MM", strikes, facilities } ],   // 2022-01 … current
  top_facilities: [ { id, name, region, kind, strikes, capacity_mt_yr, last_on } ],  // top 15
  by_weapon: [ { weapon, strikes } ],
  by_region: [ { region, strikes } ]    // top ~10, null region bucketed as "—"
}
```
Reuses `reconTables()` guard (needs `infra` + `strikes`). Pure SQL aggregation; no new
table. The existing `/api/strike-impact` tile endpoint stays; `/api/impact` is the richer
superset for the page (could later fold the tile onto it, but keep both for now — small).

## Architecture / testing
- No new DB objects, no migration. One handler + one route + one static page + one header
  link. Follows existing patterns (handler → withCache → route; static page served by
  `serveStatic`).
- The page is vanilla HTML+inline JS+inline SVG, matching digest.html (no build step).
- Verify: `bunx tsc --noEmit`; `bun run test` (62, unchanged — no pure-logic added, or add
  a tiny month-bucketing helper test if any non-trivial JS logic emerges); live `curl
  /api/impact` returns sane numbers (strikes_all=256, monthly array spanning 2022→2026,
  top_facilities led by Ilsky/Tuapse/Saratov); load `/impact.html` headless, confirm cards
  + SVG render, no console errors.
- Docs: README feature bullet + methodology note (Impact page = exposure not outage, no
  revenue). 

## Out of scope
Revenue/economic-dollar modelling; live-outage tracking; permalink deep-links (#4) and
scheduled auto-update (#6) — deferred per user.
