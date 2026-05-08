# CLAUDE.md — polyscalp

> Personal data-product sandbox. Repo: `Moonkeemoo/polyscalp`.
> Name is historical (was Polymarket scalping); now hosts whatever the current focus is.

## Current focus (committed 2026-05-07)

**Russian Shadow-Fleet Tracker** — vessel risk dashboard surfacing dark-tanker activity for sanctions-aware buyers (compliance officers at trading houses, P&I marine insurers, Baltic port authorities, sanctions-beat journalists, NGOs).

**Scope explicitly**: "просто повозитись з цим" — exploratory hands-on play first. Build for learning + curiosity, ship a public free version as v0, evaluate commercial-product question AFTER first prototype runs.

## Why this won out (vs other ideas explored same day)

- **Structural tailwind 2-5 years**: EU Directive 2024/1126 (May 2025) made non-screening criminally exposed for SMB exporters; EU 17-19 sanctions packages added hundreds of vessels; Baltic cable incidents intensified Scandinavian/Baltic port-state-control.
- **UA context = genuine credibility edge** with Western buyers (especially journalists + Baltic authorities).
- **Mid-tier price gap** between Windward/Kpler enterprise ($50k+/yr) and free PDFs (KSE Russia Oil Tracker, Atlantic Council, S&P briefings). $299-999/mo niche has no obvious incumbent.
- **Data accessible**: AISStream.io free WebSocket firehose, OFAC SDN / EU consolidated / OFSI public lists, Equasis ownership free with registration.
- **Compounds with existing stack** (Bun + Postgres + TimescaleDB) from oralab + whale-heatmap pet projects.

Full pivot research: `docs/research/2026-05-07-pain-points-dashboards.md`. Prior plan archived: `docs/archive/CLAUDE-polymarket-2026-05-07.md`.

## Stack (inherited, not re-decided)

- **Runtime**: Bun + TypeScript strict
- **DB**: PostgreSQL 16 + TimescaleDB (vessel positions → natural hypertable)
- **ORM**: Drizzle for schema/migrations + `postgres` (postgres-js) for hot-path queries
- **API**: Elysia (Bun-native)
- **Frontend**: Next.js 15 + Tailwind, deck.gl or Leaflet for vessel map, Canvas for dense visualizations
- **Hosting**: Hetzner CPX22 Helsinki (already provisioned for prior pet projects)
- **Logging**: structured pino-style JSON
- **Platform UI in English; Claude ↔ Taras collaboration in Ukrainian**

## Data sources (planned ingestion)

| Source | Auth | Cost | Use |
|---|---|---|---|
| **AISStream.io** | API key (free) | Free WebSocket | Real-time vessel positions firehose |
| **OFAC SDN list** | None | Free CSV | Sanctioned vessel/operator/owner list |
| **EU Consolidated Financial Sanctions List** | None | Free XML | EU-listed vessels |
| **UK OFSI** | None | Free CSV | UK-listed vessels |
| **Equasis** | Account (free) | Free with registration | Vessel ownership / IMO registry |
| **MarineTraffic API** (backup) | API key | $500-2000/mo paid | Historical positions, gap-fill |
| **Spire AIS** (backup) | API key | Enterprise paid | Higher fidelity if needed |
| **Open Corporates / Sayari** (later) | API key | Paid | Shell ownership graph |

## Critical rules / things known about the domain

| # | Rule | Why |
|---|------|-----|
| ACC-1 | "Alleged" / "suspected" framing on every uncertain claim. Every vessel-risk score has cited methodology + source links. | Accuracy = lawsuit risk. Wrongly flagging legitimate vessel can trigger defamation suits. |
| ACC-2 | Conservative tagging: only call vessel "shadow-fleet" if there's at least one of (sanctioned ownership in chain, OFAC/OFSI/EU listed, OR known-bad-actor flag combinations). | Prevents false-positive cascades. |
| AIS-1 | AIS data is **not legal proof** — AIS can be spoofed, jammed, intentionally turned off. Treat as signal, not truth. | Standard maritime intel caveat. |
| AIS-2 | Use AISStream.io WebSocket + auto-reconnect + dual-heartbeat watchdog (silent >30s = restart). | Same WS-pattern as RTDS in heatmap repo. |
| METH-1 | Methodology document published publicly from day one. Sources, weights, update cadence, reasoning. | Credibility with journalists/buyers requires transparency. |
| TAX-1 | Trade records / billing schema must capture USD value at time of payment, even for free tier (in case it becomes paid). | UA tax 2026 reform: 18% PIT + 5% military levy on net realized; crypto-to-crypto possibly non-taxable. |

## Conventions (carried over from pet-project standards)

- TypeScript strict, no `any`, no implicit any, no unchecked indexes
- Discriminated unions for status types
- Pure functions for risk-scoring + classification logic
- All env vars in `.env`, validated at boot via Zod
- No `console.log` in production — structured logger only
- No magic numbers / thresholds — env-configurable
- Hetzner native, no Docker for the bot itself (Postgres in Docker is fine)

## Phase plan (lightweight)

| Phase | What | "Done" looks like |
|---|---|---|
| **P0 — повозитись** | Connect AISStream.io WS, ingest vessel positions into Postgres, render basic live map of currently-tracked sanctioned vessels (OFAC SDN cross-ref) | Public webpage with live-updating map; ~3-5 hours of Claude work |
| **P1 — methodology + risk score** | Define + implement vessel risk score (sanctioned ownership, flag-of-convenience pattern, AIS gap freq in suspect zones, age, classification, port-call patterns) | Each vessel has a score with explainability popup |
| **P2 — daily digest** | Email digest "Shadow Fleet Daily" — curated 5-10 events. Free tier with subscribe form. | First subscribers; >0 retained week-over-week |
| **P3 — go/no-go for paid** | Did P2 attract organic subscribers? Are journalists citing? Then decide: paid tier OR keep as portfolio piece | Decision documented; either Stripe + paid tier OR move on |

**P0 is the gate.** If P0 doesn't ship and feel fun, the rest doesn't matter.

## Maintenance triggers

Update this file when:
- Phase transition (P0 → P1, etc.)
- New data source added
- Stack change
- Methodology change

Skip for: bugfixes, UI tweaks.

## Memory triggers

Save into `.claude/projects/.../memory/` when learning:
- Domain facts about specific vessels / operators / sanctioned entities (project memory)
- Buyer interview insights (project memory)
- Methodology decisions with reasoning (project memory)
- Feedback from user about scope / direction (feedback memory)
