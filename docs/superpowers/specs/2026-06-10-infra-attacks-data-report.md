# Data Sources & QA Report — Oil Infrastructure + Tanker Attacks Datasets

**Date:** 2026-06-10
**Files:** `data/oil-infra.json`, `data/tanker-attacks.json`
**Relates to:** `docs/superpowers/specs/2026-06-10-oil-infra-attacks-layer-design.md` (Phase 1 reference layers)
**Verdict:** Both files pass the design-spec QA gate (≥1 source URL per record, coordinate sanity, attacks ≥2 independent sources). 115 records kept, 1 dropped. Known gaps listed below; none are blocking for a Phase-1 reference layer, but several are worth a follow-up sweep.

---

## 1. Record counts

### `data/oil-infra.json` — 78 objects

| Kind | Count | Notes |
|---|---|---|
| `refinery` | 39 | Incl. 3 gas-condensate processors (Astrakhan GPZ, Surgut ZSK, Ust-Luga Novatek) — kept in `refinery` kind because they produce motor fuels |
| `terminal` | 15 | Baltic, Black Sea, Arctic, Pacific export terminals + Murmansk/Kola STS hub + occupied-Crimea Feodosia |
| `depot` | 13 | Transneft LPDS/pumping-station tank farms + Rosrezerv depots, biased toward drone-struck sites (by design) |
| `pipeline` | 11 | Druzhba N+S, BTS-1, BTS-2, CPC, Baku–Novorossiysk, ESPO-1, ESPO-2, ESPO–Daqing spur, Sever, Yug |

Status snapshot (volatile, see caveats): 37 `operational`, 31 `damaged`, 10 `unknown`.

### `data/tanker-attacks.json` — 37 incidents

| `attack_type` | Count |
|---|---|
| `usv_strike` | 13 |
| `port_strike` | 11 |
| `explosion_unexplained` | 8 |
| `limpet_mine` | 3 |
| `uav_strike` | 2 |

Date range **2023-08-05 → 2026-05-30** (2023: 1, 2024: 4, 2025: 19, 2026: 13). Location precision: 21 `approx`, 15 `port`, 1 `exact`. 5 records have `vessel_name: null` (unnamed vessels in port strikes), 9 have `imo: null` (ferries and unnamed vessels — expected, schema allows it).

**Totals: 115 records kept (78 + 37), 1 dropped (infra: 1, attacks: 0).**

---

## 2. Primary sources & licenses

| Source | Used for | License / terms |
|---|---|---|
| Global Energy Monitor wiki (gem.wiki, Global Oil Infrastructure Tracker) | Exact coordinates + capacities for major refineries (19 citations) | **CC BY 4.0** — attribution required; compatible with the project's "free public sources only" claim |
| Russian Wikipedia (incl. the refining-industry registry article) | Refinery registry cross-check, local names, history, ownership (77 citations) | **CC BY-SA 4.0** |
| English Wikipedia (List of oil refineries + object articles) | Cross-check sweep (56 citations) | **CC BY-SA 4.0** |
| Wikidata | Stable entity IDs / coordinate cross-check (34 citations) | **CC0** |
| OpenStreetMap / Nominatim | Plant-polygon coordinates where GEM lacks them (noted per record) | **ODbL 1.0** — attribution required; share-alike applies to derived databases |
| News/OSINT (Kyiv Independent, Moscow Times, Militarnyi, Euromaidan Press, Ukrainska Pravda, maritime-executive, gCaptain, Lloyd's List, Bloomberg, Reuters via aggregators, united24media, H.I. Sutton/Covert Shores, Naval News, etc.) | Strike/damage status of infra; all attack incidents | Facts cited by URL only; no licensed text reproduced. Multiple outlets per claim |
| Company/official (Rosneft, Transneft, Lukoil, Novatek, CPC, OTEKO sites; war-sanctions.gur.gov.ua) | Capacity/ownership confirmation; sanction status | Public corporate/government pages, cited for facts |
| Security-industry advisories (Ambrey, Dryad, Skuld, EOS Risk) | Limpet-mine attribution for 2025 Mediterranean blast series | Public advisories, cited for facts |

URL counts per record: infra min 2 / max 7; attacks min 3 / max 7 — every attack exceeds the spec's "≥2 independent or 1 authoritative" bar.

---

## 3. Verification methodology

1. **Multi-sweep assembly.** Independent research sweeps per kind (refineries; terminals/depots; pipelines; attack incidents), each from a different anchor source set (GEM tracker vs ru-Wikipedia registry vs en-Wikipedia list vs news/OSINT timelines). Sweeps were then reconciled record-by-record.
2. **Cross-sweep reconciliation, recorded in-data.** Where sweeps disagreed, the discrepancy and the chosen value are documented in `notes` (e.g. Antipinsky 9.0 vs 7.5 Mt/yr; TANECO 15.3 vs 8.7 pre/post-expansion; Surgut ZSK 8 vs 4 Mt/yr; Slavyansk ECO 5.2 vs 3.99; Tuapse 12.0 vs 9.03; Ust-Luga Novatek coordinates moved ~6 km after the depot/terminal sweep was merged with the refinery sweep record).
3. **Adversarial fact-check pass.** A second pass challenged ownership chains (e.g. Antipinsky's SOCAR episode reduced to the documented 9.6% brief minority; Mari refinery's bankruptcy receivership), status claims (strike damage accepted only with credible reporting; "unknown" used where operating level is unverifiable), and coordinates (city-level vs plant-polygon precision flagged per record in `notes`).
4. **Outcome:** 1 infra record failed verification and was dropped rather than shipped with weak sourcing; 0 attack records dropped. One near-duplicate (Novatek Ust-Luga complex appearing in two sweeps) was **merged**, not double-counted.

---

## 4. Validation results (mechanical QA)

Checks run programmatically against both files on 2026-06-10:

| Check | Result |
|---|---|
| Every record has ≥1 `source_urls` entry | **PASS** — 0 missing in both files (infra min 2, attacks min 3) |
| Duplicate IDs | **PASS** — none in either file |
| Infra point coordinates within 40–75N / 19–180E | **PASS** — all 67 point objects in bounds |
| Pipeline geometries within bounds | **PASS with explained exceptions** — 8 vertices west of 19E, all on the two Druzhba branches: northern branch ends at Schwedt, Germany (14.28E) via Płock/Adamowo; southern branch ends at Bratislava (17.16E) and Százhalombatta (18.91E). These are real cross-border delivery legs, not errors. CPC's Kazakh leg (Tengiz, 53.4E / ~46N) and the ESPO Daqing spur (China, to 46.6N / 125.4E) stay inside the configured bounds |
| Attack coordinates valid lat/lon | **PASS** — all 37 in valid ranges; westernmost are genuinely western incidents (Ursa Major 36.46N/−0.89E Alborán Sea; Mersin 14.65N/−17.45E off Dakar) |
| Pipelines: `lat`/`lon` null + GeoJSON geometry present | As designed — all 11 pipelines carry `LineString`/`MultiLineString` (11–30 vertices each, simplified); loaders/UI must tolerate null point coords for `kind=pipeline` |
| Spot-check of ~20 coordinates against known locations (Kapotnya, Kozmino, Varandey, Yuzhnaya Ozereyevka, Ceyhan, Savona, Tobruk, Port Kavkaz, Inebolu offset, etc.) | **PASS** — all plausible |

---

## 5. Dropped-record summary

| File | Kept | Dropped | Reason |
|---|---|---|---|
| `oil-infra.json` | 78 | **1** | Failed the adversarial fact-check / sourcing gate (could not be verified to the "every record cited, no synthetic data" standard) |
| `tanker-attacks.json` | 37 | **0** | — |
| **Total** | **115** | **1** | |

Additionally one infra record was merged (Novatek Ust-Luga appeared in both the refinery and terminal sweeps) — a dedup, not a drop.

---

## 6. Completeness critique — known gaps & missing objects

Acting as adversarial completeness critic. None of these invalidate Phase 1, but they are the obvious next additions.

### 6.1 Infra — missing well-known objects

**Depots (most significant gaps):**
- **Proletarsk / "Kavkaz" oil depot (Rostov Oblast)** — the August 2024 strike caused one of the most widely reported multi-week tank-farm fires of the entire campaign. Its absence is the single most glaring infra gap.
- **Port Kavkaz oil-products transshipment terminal** — struck by Neptune missiles in May 2024; the attacks dataset itself references "the oil terminal at Port Kavkaz" (record `2024-05-30-kavkaz-port-ferries`), but no corresponding infra object exists. Internal inconsistency.
- **Kropotkinskaya CPC pump station** — struck Feb 2025; mentioned in the notes of `cpc-pipeline` and `kavkazskaya-oil-transshipment` but not a standalone object, even though smaller LPDS are.
- Azov / Rostov-on-Don port oil depots (struck June 2024), Adler/Sochi fuel depot (struck 2025), Novozybkov Druzhba pumping station — second-tier but reported strike targets.

**Pipelines:**
- **Kuibyshev (Samara)–Tikhoretsk crude trunk** — referenced by *three* shipped depot records (Samara LPDS, Krasny Yar, Tikhoretsk) as the line they sit on, yet absent as a pipeline object. Internal inconsistency, same pattern as Port Kavkaz.
- **Atyrau–Samara** (Kazakh transit into Transneft) and **Surgut–Polotsk / Kholmogory–Klin** northern trunks (referenced in the Lazarevo LPDS note) — acceptable under "trunk lines where data allows" but worth adding for network completeness.
- MNPP product-pipeline network beyond Sever/Yug (e.g. Ryazan–Moscow ring, Ufa product lines feeding `stalnoy-kon-lpds`).

**Refineries:**
- Coverage of plants ≥1.3 Mt/yr appears complete against the ru-Wikipedia registry and GEM. Borderline omissions: **Pervy Zavod (Kaluga Oblast, ~1.1 Mt/yr, drone-struck June 2024)**, VPK-Oil (Novosibirsk mini-cluster), and the historic but idle Mendeleev/Konstantinovsky refinery (Yaroslavl). All below the implicit capacity cutoff — fine if the cutoff is documented in methodology.
- **Purovsky condensate plant (Novatek, ~12 Mt/yr)** — the upstream feeder of the shipped Ust-Luga Novatek complex; notable absence in the condensate chain.

**Terminals:**
- Prirazlomnaya platform direct offloading (Arctic), Arkhangelsk (Talagi) and Kaliningrad product terminals, Vanino — minor, defensible omissions for an export-focused layer.

### 6.2 Attacks — missing widely-reported incidents

- **~3 May 2026 Primorsk vessel strikes:** a source already cited in the dataset (maritime-executive, "Ukraine hits two tankers at Novorossiysk **and three vessels at Primorsk**") indicates a same-night Primorsk component that has no record. The Novorossiysk half is recorded (`2026-05-03-novorossiysk-two-tankers`); the Primorsk half is missing — strongest single attack-data gap.
- **No 2022 records** although the design scope says 2022–2026. If scope = attacks *on Russia-linked vessels*, this is correct (the campaign effectively starts with SIG, Aug 2023) — but then the spec's date range should be corrected, or the scope note made explicit. Early-2022 Russian attacks on merchant shipping off Ukraine (Millennial Spirit, Helt, Banglar Samriddhi) are out of scope as currently defined.
- Deliberate, defensible exclusions worth documenting in methodology: Olenegorsky Gornyak USV strike (Aug 2023 — naval vessel, not merchant); Volgoneft-212/239 Kerch Strait fuel-oil spill (Dec 2024 — storm accident, not attack); seizures/detentions (Eagle S, Boracay) — not kinetic attacks.
- Freshness: the newest attack record is 2026-05-30, while infra notes reference events up to 8 June 2026 (Grushovaya fire) — the attacks file is ~10 days staler than the infra file; any early-June 2026 vessel incidents would be missing.

---

## 7. Caveats

1. **Status volatility.** `status` (operational/damaged/unknown) changes faster than any manual refresh cadence; 31 objects are marked damaged as of early June 2026. Treat as a snapshot, not live state (Phase 3 will address this).
2. **Capacity figures are contested.** Russian refinery capacities differ across GEM, ru-Wikipedia, en-Wikipedia and company sites (design vs nameplate vs post-expansion). Chosen values and the discarded alternatives are recorded per-record in `notes` — keep that convention.
3. **Coordinate precision is heterogeneous.** Mix of GEM-exact, OSM plant polygons, and city/settlement-level approximations (flagged in `notes`, e.g. Anzhersk, Nizhnevartovsk, Usinsk, most depots). Offshore terminals (Varandey, Arctic Gate, CPC SPM) are approximate by nature.
4. **At-sea attack coordinates are mostly `approx`** (21/37) — derived from "N nm off X" reporting; only 1 record is `exact`. The UI must surface the `location_precision` caveat (already in the design).
5. **Pipeline geometry is simplified** (11–30 vertices, tens-of-km accuracy, journalistic context only) and several routes cross borders (EU, Kazakhstan, China) — bounding-box checks and map styling must not assume Russia-only extents.
6. **Not all attack records are oil tankers.** ~10 of 37 involve rail ferries, cargo ships, or gas carriers (each flagged "Non-tanker" in its summary). Correct under the "Russia-linked incidents" scope, but the layer label "tanker attacks" slightly overstates; methodology page should say "Russia-linked vessel incidents".
7. **Curated, not exhaustive.** Both files are curated reference sets: depots are intentionally biased toward strike-relevant sites, attacks toward verifiable incidents. The gaps in §6 are the backlog for the next manual refresh (infra: quarterly; attacks: ongoing).
8. **Licensing obligations.** GEM (CC BY), Wikipedia (CC BY-SA) and OSM (ODbL) all require attribution — the methodology page must name them; ODbL share-alike should be kept in mind if the seed JSONs are ever redistributed as a standalone database.

---

## Gap-fill addendum (2026-06-10)

Verified gap-fill merge closing the top items from §6. **4 records added, 0 dropped/skipped.** New totals: `oil-infra.json` 81 objects (39 refineries, 16 terminals, 14 depots, 12 pipelines), `tanker-attacks.json` 38 incidents.

**Added to `oil-infra.json` (3):**
- `proletarsk-kavkaz-oil-depot` (depot) — Rosrezerv "Kavkaz" tank farm, Proletarsk; closes the §6.1 "most glaring infra gap" (Aug 2024 16-day fire).
- `port-kavkaz-oil-ferry-terminal` (terminal) — Port Kavkaz oil-products/rail-ferry hub; resolves the internal inconsistency with attack records `2024-05-30-kavkaz-port-ferries`, `2024-07-23-slavyanin-kavkaz`, `2024-08-22-conro-trader-kavkaz`, `2026-03-13-avangard-kerch`, `2026-04-06-slavyanin-kerch`.
- `kuibyshev-tikhoretsk-pipeline` (pipeline) — Transneft crude trunk referenced by the Samara LPDS, Krasny Yar and Tikhoretsk depot records; resolves that internal inconsistency.

**Added to `tanker-attacks.json` (1):**
- `2026-05-03-primorsk-vessels` (port_strike) — the missing Primorsk half of the 3 May 2026 operation; complements the existing `2026-05-03-novorossiysk-two-tankers` record (not a duplicate: different port, different vessels).

**Skipped/dropped:** none — all 4 candidate records passed schema validation (field sets, enums, coordinate ranges, ≥2 source URLs, no duplicate ids, no vessel+date overlap with existing records).

**Scope note (explicit):** the attacks dataset covers incidents that are attacks **on Russia-linked vessels**. No such incidents were documented in 2022 — the campaign effectively begins with the SIG strike, and the earliest documented incident in the file is `2023-08-05-sig`. The absence of 2022 records is therefore correct, not a gap; the design spec's "2022–2026" date range should be read as the monitoring window, not the incident range. Early-2022 Russian attacks on merchant shipping off Ukraine (Millennial Spirit, Helt, Banglar Samriddhi) remain out of scope as currently defined.
