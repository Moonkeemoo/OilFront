# Map marker redesign — neutral icons + status color + clustering (design)

**Date:** 2026-06-12
**Status:** Approved (user picked Concept B's structure with refinements after a 3-concept visual review).
**Problem (user):** the map is a rainbow — color encodes facility TYPE (4 infra + 9 military colors), so the signal that matters (struck / burning) drowns; near-identical red shades blend; markers overlap into mush; struck/burning conflict in color+icon.

## Decision
Keep the project's CURRENT icon SHAPES (they're informative) but stop coloring them by type; move color onto STATUS; group dense markers via clustering; keep + update the legend.

## Scope
ONLY the facility markers — infra (refinery/depot/terminal/petrochemical) + military (shield, 9 categories). **Out of scope:** vessels (color = risk bucket) and FIRMS thermal anomalies (orange = heat) keep their current colors — that's status/risk, not type-rainbow. Attacks (red star), zones, STS, chain unchanged.

## Changes (all in web/index.html)
1. **Neutralize type color.** Replace `INFRA_COLORS`/`MIL_COLORS` lookups with ONE muted neutral base (`MARKER_NEUTRAL`, a desaturated slate ~`#7a8696`). Keep the existing shapes in `infraIcon` (refinery factory, depot tank, petrochemical hexagon, terminal diamond) and `militaryIcon` (shield). Not-struck markers render neutral at slightly reduced opacity so they recede. Shape alone now carries type.
2. **Status as a ring (the loud channel).** Replace the small corner badge dot with a RED STATUS RING encircling the whole glyph, in 3 DISCRETE recency steps (no blended gradient): ≤7d bright `#ff3b30` (+ soft glow), ≤30d mid `#c0392b`, >30d dim `#7d2a25`. Drive it from the existing `freshnessBadge` recency computation (adapt it to return a ring step instead of a corner-dot color). Not-struck = no ring.
3. **Burning = the single loudest treatment.** When `burning` (strike + live FIRMS `active_now` within ±1d): an ANIMATED amber pulsing ring (CSS keyframes) and the marker lifted onto a dedicated top Leaflet pane (`map.createPane`, high z-index) so it is never buried under neighbors. Drop the current red-dot + 🔥-emoji combo that conflicts (a small 🔥 centered is OK only if it doesn't clash with the amber ring — implementer's call, keep it clean and unmistakable).
4. **Clustering.** Add Leaflet.markercluster (CDN: unpkg `leaflet.markercluster` 1.5.x css+js, same CDN pattern as Leaflet). Convert `infraLayer` and `militaryLayer` to `L.markerClusterGroup` — **separate groups** so the infra/military toggle chips keep working independently (accepts that an infra-cluster and a military-cluster can sit near each other — still far better than today). Tune `maxClusterRadius` (~50), `showCoverageOnHover:false`, `spiderfyOnMaxZoom:true`. Custom `iconCreateFunction`: a count bubble colored by the WORST status among children — any burning child → amber pulsing bubble; else any struck child → red bubble (recency step of the freshest struck child); else → neutral slate bubble. Markers must carry their status (struck/burning/recency) in `marker.options` (or a side map) so the cluster fn can read children. Preserve the existing zoom-reskin sizing intent (or let markercluster handle density and keep a fixed sensible icon size).
5. **Legend (kept + rewritten).** The user explicitly wants the legend. Update the `#tl-legend` block: replace the 4 per-type COLOR swatches with small SHAPE glyphs (factory=refinery, tank=depot, hexagon=petrochemical, diamond=terminal, shield=military) labelled by type; add STATUS entries — neutral = no recorded strike, red ring (show the 3-step brightness) = struck (brighter = fresher), amber pulse = burning now, count bubble = grouped facilities. Keep the existing vessel / tanker-attack / thermal-anomaly entries (those colors stay).

## Keep working
Tooltips, the confidence tier chips, click→panel, freshness/`active_now` burning logic, the feed panel, the chain overlay, zoom behavior. Toggling infra/military chips still shows/hides the (now clustered) groups.

## Verify
- `npx tsc --noEmit -p packages/api/tsconfig.json` exit 0; `npm test` green (160 — UI change, no unit-test impact, don't break).
- `node --check` on the extracted `<script>` body.
- Headless screenshots (Edge/Chrome, ~9s virtual-time for tiles): overview over European Russia (`#54,45,5`) → expect calm neutral map with count bubbles colored by status, no overlap mush; zoom into Volga (`#55,49,7`) → shapes legible in neutral, struck = red rings in clear steps, burning = amber pulse on top. Confirm no console errors, infra/military toggles still hide their clusters.
- Compare before/after; send the user a screenshot.

## Cleanup
Remove the throwaway `web/mockups/` directory once the real map is updated.

## Out of scope
Neutralizing vessels/fires; a marker-cluster spider UX beyond defaults; mobile-specific marker sizing.
