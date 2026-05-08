# CLAUDE.md — Whale Signal Heatmap

> Real-time heatmap of Polymarket whale activity. Bun + Elysia + TimescaleDB.
> North star: "signals flowing and visible within 3 days, not 3 weeks".
> Repo: `Moonkeemoo/whale-signal-heatmap`.

## What this project does

Connects to Polymarket RTDS WebSocket firehose (every trade on the platform), matches against the full v1 corpus of 1504 watched wallets (no classification filter — heatmap surfaces raw activity, lets the data show which wallets actually move markets), enriches with market metadata via Gamma API, stores in PostgreSQL/TimescaleDB, and visualizes as a live heatmap (categories × 5-minute time slots). User sees where smart money is moving in real time.

Sibling project: `Moonkeemoo/oralab` (auto-trading bot). This project is read-only signals + visualization — no trade execution in MVP.

## Architecture (one screen)

```
External:        RTDS WS firehose · Gamma REST · CLOB REST (fallback)
Hetzner svc:     single Bun process (ingestor + API) · PostgreSQL+TimescaleDB · Caddy
Frontend:        Next.js 15 (App Router) + React 19 + Tailwind, Canvas heatmap, SSE for live updates
```

```
RTDS firehose ──▸ whale match ──▸ gamma enrich ──▸ batch insert ──▸ TimescaleDB
(no auth)         (in-memory Map)   (30s TTL cache)  (every 5s)       ↓
                                                                  continuous
                                                                  aggregates
                                                                      ↓
Browser ◂── SSE live push ◂── Elysia API ◂── signals_5min view
```

Full data source docs: `docs/handoff-polymarket-whale-feeds.md` (from oralab repo, commit d6ea7b9).

## Critical rules — top 7

| # | Rule | If violated |
|---|------|------------|
| SIG-1 | Use `@polymarket/real-time-data-client` SDK — never roll a raw `ws` client. SDK handles the on-wire ping/pong, autoReconnect, and the `subscribe({ subscriptions: [{ topic: "activity", type: "trades" }] })` envelope. Layer a warn-only DATA-silence watchdog on top to spot zombies (firehose silent for >45s). | Hand-rolled WS misses control-frame heartbeats and gets killed by a heartbeat watchdog; or sends the wrong subscribe shape and receives nothing |
| SIG-2 | Wallet/asset extraction must probe ALL aliases: wallet = `proxyWallet ?? proxy_wallet ?? user ?? maker ?? taker ?? address`; asset = `asset ?? asset_id ?? token_id ?? market`; condition = `conditionId ?? condition_id` | Missed signals — `proxyWallet` is the most common wallet field in production; `asset_id` is rare. Vanilla `event.user` / `event.asset_id` drops most trades |
| SIG-3 | Gamma `outcomes`/`outcomePrices` are JSON-strings — must `JSON.parse()` | Crash or garbage category data |
| SIG-3a | Gamma `/markets` does NOT return `tags` by default — must add `?include_tag=true`, otherwise every signal categorizes as "Other" | Heatmap rows all collapse into one bucket |
| SIG-4 | Dead-book filter: drop when `bid ≤ 0.02` | Nonsense price data from Polymarket placeholders |
| SIG-5 | `confidence` is the canonical trust signal — never recompute from `win_rate * hold_hours` | Zero for 99% of wallets (oralab bug d0e10c4). **Obsolete here** — this project doesn't carry confidence; kept as historical reference only |
| SIG-6 | Batch insert signals every 5s, not per-event | DB connection exhaustion under firehose load |
| SIG-7 | WS reconnect handled by the SDK (`autoReconnect: true`); on application-level resubscribe failure, restart the SDK client rather than reusing it | Fragmented state, missed subscriptions |

## Conventions

- **TypeScript strict** — no `any`, no implicit any, no unchecked indexes
- **Discriminated unions** for status types — never bare string status
- **Pure functions where possible** — categorization, color calculation, aggregation must be pure
- **PostgreSQL + Drizzle** — never JSON files for state, never in-memory-only for persistent data
- **Bun runtime** — use native Bun APIs where available (fetch, WebSocket client for simple cases)
- **`@polymarket/real-time-data-client` SDK for RTDS** — never raw `ws`. The SDK handles WS protocol pings, autoReconnect, and the subscribe envelope (`{ subscriptions: [{ topic: "activity", type: "trades" }] }`). Layer a warn-only DATA-silence watchdog on top
- **Elysia for API** — type-safe, native SSE support, fastest on Bun
- **Canvas for heatmap rendering** — not DOM cells. 500+ cells at drill-down level = DOM too slow. Canvas single-pass < 16ms
- **Platform UI in English; Claude ↔ Taras collaboration in Ukrainian**
- **No trade execution in MVP** — read-only signals. Execution lives in oralab
- **All env vars in `.env`** — no hardcoded URLs, thresholds, or TTLs in code. See `.env.example`

## Architectural discipline

Two big avoidable refactors so far. To prevent the third:

1. **Extract a primitive by the 3rd duplicate, not the 5th.** Drawer/sheet chrome was copy-pasted 5 times before consolidation (~250 LOC of dup). When you find yourself ABOUT to copy a structural pattern (modal/drawer/popover/skeleton/etc.) for the third time, stop and extract it (`<Drawer>`, `useFoo()`). One session of refactor < N sessions of inconsistency drift.
2. **Sketch hierarchies before encoding flat enums.** "WHALES" was added to `Mode` enum first (LIVE/PATTERN/MACRO/WHALES); the user's actual mental model was `Subject (TRADES vs WHALES) × Mode (LIVE/PATTERN/MACRO)`. Migrating ~10 files later took a full session. Before adding a top-level enum value, ask: would two orthogonal enums fit better than one big mixed one? If the user describes a hierarchy in plain language ("WHO → HOW → WHEN → WHAT"), encode that hierarchy in the state shape, don't flatten it.
3. **State in a 700+ LOC component → hook.** When `useState` count climbs past ~5 and the component is already large, extract a custom hook (`useUrlFilters`, `useDrawerState`). Re-running the component every state change vs. an isolated hook makes the diff radically clearer too.
4. **Fit the existing types before stretching them.** "This is mostly like a `HeatmapCell` but with extra fields" → either extend the type with optional fields used only in the new path, or alias as a different name. Don't silently add new optional fields on a shared type without comment.
5. **Naming consistency is free leverage.** "subject" vs "kind" vs "type" — pick one for the same concept and use it everywhere. Inconsistent vocab makes greps miss.

These don't apply to bugfixes / small enhancements. They apply when adding a feature that touches 3+ files.

## Polymarket data sources

### RTDS firehose (primary — whale detection)
- `wss://ws-live-data.polymarket.com` — no auth
- Subscribe: `{ "type": "trades" }` — server pushes every trade, no reply
- Ping: empty string every 20s + random 0-5s jitter
- Event: `{ asset_id, condition_id, size, price, side, user, timestamp, transaction_hash, title }`

### Gamma API (market metadata enrichment)
- `https://gamma-api.polymarket.com/markets?clob_token_ids={asset_id}` — no auth
- Cache: 30s TTL. Category from `tags[].label`
- Gotcha: `outcomes`/`outcomePrices` are JSON-encoded strings, not arrays

### REST book (fallback only)
- `https://clob.polymarket.com/book?token_id={asset_id}` — cache 500ms
- Gotcha: bids array sometimes UNSORTED — sort by price desc

### Production gotchas (all 8, from oralab v2 handoff)
1. RTDS subscribe = just `{ "type": "trades" }`, nothing else
2. Market WS (if added later): MUST include `custom_feature_enabled: true` or silent failure
3. `asset_id` field inconsistency — always fallback (SIG-2)
4. Dead-book `bid ≤ 0.02` = Polymarket placeholder (SIG-4)
5. Dual heartbeat watchdogs required (SIG-1)
6. CLOB v1 SDK broken since 2026-04-27 — must `@polymarket/clob-client-v2` 1.0.2+
7. Gamma JSON-string fields (SIG-3)
8. `/book` REST ~500ms latency — cache aggressively

## Whale corpus

**It's a watchlist, not a profile DB.** Flat list of lowercase addresses we want to catch trades from. No classification, no confidence, no metrics — neither in the corpus, nor in `Set<string>` we load it into, nor on `signals` rows.

**Source (current):** Polymarket's official `/v1/leaderboard` API. We harvest top-**200** by `PNL` `ALL`-time for each leaderboard category we care about (POLITICS, SPORTS, CRYPTO, CULTURE, MENTIONS, WEATHER, ECONOMICS, FINANCE, TECH), dedupe across categories, and write the result to `data/whale_corpus.json` (~600-1000 unique addresses). Bonus: `data/whale_aliases.json` carries Polymarket username, X handle, verified badge, and per-category PNL/VOL/rank for each whale — not yet wired into UI but available for tooltips/profile pages later.

**Refresh policy:** weekly. Manually for now via `bun run packages/api/scripts/refresh-corpus.ts`; weekly cron is a v1.1 task. Each refresh REPLACES the corpus (does not merge with previous) so the watchlist stays focused on currently-leading traders. Followed by `TRUNCATE signals, whale_positions, processed_resolutions` to start clean.

**Historical:** v1 archive `output/_local_backup_1777785223/wallet_profiles.json` from `Moonkeemoo/ora-et-labora` (1504 wallets) was the bootstrap source. Replaced 2026-05-03 — see `feedback_oralab_caveat.md` (oralab project was stopped; its classification was unreliable).

`whale-corpus.ts` loads `whale_corpus.json` into `Set<string>` at startup. Match = `set.has(trade.user.toLowerCase())`. That's the entire whale logic.

(SIG-5 in the critical-rules table is obsolete in this project — we don't carry confidence at all. Kept the row only as a reference to the v1 lesson.)

## Project structure

Bun workspaces monorepo:

```
packages/
├── api/                          — Bun + Elysia: ingestor + REST + SSE
│   ├── src/
│   │   ├── index.ts              — entrypoint: start ingestor + API
│   │   ├── ingestor.ts           — RTDS WS → match → enrich → batch insert
│   │   ├── whale-corpus.ts       — load addresses from data/whale_corpus.json into Set<string>
│   │   ├── gamma-cache.ts        — market metadata with TTL cache
│   │   ├── db.ts                 — Drizzle + postgres connection
│   │   ├── schema.ts             — Drizzle schema (signals hypertable)
│   │   ├── api.ts                — Elysia: GET /api/heatmap + GET /api/stream (SSE)
│   │   └── categorize.ts         — gamma tags → category mapping (pure function)
│   └── Dockerfile
└── web/                          — Next.js 15 (App Router) + React 19 + Tailwind + shadcn
    ├── src/app/                  — pages
    ├── src/components/heatmap/   — Canvas heatmap renderer + controls
    ├── src/hooks/                — useHeatmapData, useSse
    ├── src/lib/                  — api client, color scales
    └── Dockerfile

data/
├── whale_corpus.json             — flat array of lowercase addresses (the watchlist; refreshed weekly via scripts/refresh-corpus.ts)
├── whale_aliases.json            — { addr: { alias, xHandle, verified, sources } } from Polymarket leaderboard (UI hookup = v1.1)
└── wallet_profiles_v1.json       — historical v1 archive snapshot (offline; no code reads it)

db/
└── migrate.sql                   — TimescaleDB schema + continuous aggregates + compression + retention
```

## Heatmap view modes — LIVE (MVP) vs PATTERN (v1.1)

The UI exposes a toggle next to the metric selector: `[LIVE] [PATTERN]`. LIVE is the default and the only mode in MVP. PATTERN ships in v1.1 once the DB has accumulated ≥7 days of signals.

**LIVE — sliding window.** Each cell = real signals in a specific time slot. Slots scroll left as time advances. "What is happening right now" — actionable. Implemented in `packages/api/src/heatmap-query.ts` (`time_bucket('5 minutes', ts)` for 1h window). Time scale selector adds 24h × 1h and 7d × 1d slots later.

**PATTERN — cyclical overlay.** Each cell = `AVG(metric)` for a recurring time slot across the lookback range. "Hour 15:00" cell shows the average across ALL 15:00 hours in the last 7/14/30 days. Daily pattern = 24 columns (hours 00–23); weekly pattern = 7 columns (Mon–Sun). Reveals patterns like "Crypto whales fire at 14:00–16:00 UTC" or "Sports weekends are dead". Powered by the existing `signals_hourly` continuous aggregate — no new ingestion code, just a different `GROUP BY EXTRACT(hour FROM bucket)`. UI subtitle: "Середній патерн за останні 7 днів". Tooltip must show avg + min/max + sample-count.

Don't refactor `heatmap-query.ts` to be mode-aware in MVP — add `pattern-query.ts` separately when v1.1 lands.

## Phase plan (one screen)

| Phase | What | Status |
|---|---|---|
| **MVP** | RTDS ingestor + whale match + gamma enrich + TimescaleDB + API + Next.js heatmap UI in **LIVE** mode (4 ranges × 12 buckets) | ✅ shipped |
| **v1.1** | `whale_aliases.json` in UI · **PATTERN mode** (HOUR 12×2h + DOW 7d) · weekly cron for `refresh-corpus.ts` | ⚙️ aliases + PATTERN done; cron pending |
| **v1.2** | Drill-down: category → subcategory · breadcrumb · top markets in tooltip · market name → Polymarket link with referral | ✅ shipped |
| **v1.2.1** | Tooltip lock-on-click for side-by-side compare · rich KPI hover popovers with category/subcategory breakdowns · real-time TimescaleDB aggregation | ✅ shipped |
| **v1.3** | PATTERN drill · tooltip-overlap fix · ingest-side filter for composite "0xADDR-TS" wallets | ✅ shipped |
| **v1.4** | **Whale profiles** (click whale → side panel: positions, recent trades, per-cat PnL, alias + Polymarket link) | ✅ shipped |
| **v1.5** | **Auth foundation** — Auth.js v5, soft-gate on filters/modes/drill, 5 providers (SIWE/MetaMask, Email magic link via Resend, GitHub, Discord, Telegram). Email auto-links GitHub + Discord by verified email. SIWE and Telegram remain standalone accounts (no shared identifier with email — see v1.6). Default view 24h × volume; metric tabs locked too. Top-markets list in cell tooltip gated. | ✅ shipped |
| **v1.6** | **Account linking / unify multiple sign-ins** — currently a user who logs in with MetaMask AND email AND Telegram ends up with 3 separate `auth_users` rows. Profile page exposing connected providers + "Link this method to my account" flow that adds a row to `auth_accounts` instead of creating a new user. Optional admin tool to consolidate already-split accounts. Re-evaluate Passkey provider when Auth.js v5 ships stable WebAuthn. | not started |
| **v1.7 — Crypto monetization (web)** | **Paid Pro tier on web via on-chain payment** — USDC on Polygon (gas <$0.01, same chain as Polymarket so users already hold it). Receive-address contract with `Paid(user, amount, expires)` event; backend listener writes `paid_until` to `auth_users`. Frontend "Upgrade" button uses wagmi/viem to call `transfer()` on USDC contract, then polls `/api/me` for plan flip. ~99% take-rate, no chargebacks. Web-only; TG users will pay via Stars/TON in v2.0. **Tier structure + pricing decided 2026-05-04, see below**: three tiers (Free anon · Free auth · Pro) with monthly/annual SKUs. | not started |
| **v2.0 — Telegram bundle** | **Mobile-responsive UI** (Heatmap cramps below 768px today) · **Telegram WebApp** wrapper (full UI inside TG, identity from initData) · **TG alerts** for large signals · **Monetization** with two payment rails inside the mini-app: **Telegram Stars** (1-tap in-app via `payments.sendStarsForm`, ~55–65% net after Apple/Google + TG cut, best conversion — the default for non-crypto users) and **Telegram TON** (via TonConnect SDK, 2-tap, ~99% net, no app-store cut — surface as "Pay with TON" for power users). Web users keep the existing crypto/SIWE rail untouched. Designed and shipped together — alerts need TG push, monetization fits TG-native flows, mobile work is on critical path for in-TG UX. | not started |
| **v2.1+** | Trade execution via CLOB v2 (belongs to oralab) · mark-to-market PnL on open positions · weekly cron for `refresh-corpus.ts` · DKIM/DMARC tightening (`p=quarantine`) once email volume justifies | not started |

## Monetization plan (recorded 2026-05-04, not yet implemented)

Three-tier structure picked on 2026-05-04 brainstorm. Holds for v1.7 (crypto)
and v2.0 (TG Stars + TON). Apply the SAME gate matrix across all payment rails.

### Tier matrix

| Feature | Free (anon) | Free (auth) | **Pro ($9/mo or $79/yr)** |
|---|---|---|---|
| LIVE 1h × volume L1 | ✅ | ✅ | ✅ |
| All ranges (1h/24h/12d/12w) | ❌ | ✅ | ✅ |
| All metrics (PNL, VOLUME, СИГНАЛИ, WIN RATE) | ❌ | ✅ | ✅ |
| PATTERN mode (HOUR + DOW) | ❌ | ✅ | ✅ |
| Drill **L1 → L2** (subcategories) | ❌ | ✅ | ✅ |
| Drag-to-reorder (persisted) | ❌ | ✅ | ✅ |
| Top markets in tooltip | ❌ | ✅ | ✅ |
| SSE live ticker | ❌ | ✅ | ✅ |
| Whale drawer (basic) | ❌ | ✅ | ✅ |
| **Drill L3 (per-market)** | ❌ | ❌ | ✅ |
| **Top whales in cell** + click-to-drawer | ❌ | ❌ | ✅ |
| **Market probability chart** in L3 tooltip | ❌ | ❌ | ✅ |
| **PATTERN cycle histogram** (locked tooltip) | ❌ | ❌ | ✅ |
| **WHALES metric** (convergence) | ❌ | ❌ | ✅ |
| Telegram alerts on N+ whale convergence | n/a | n/a | ✅ (v2.0) |
| Hot Picks / Receipts page | n/a | n/a | ✅ (TBD) |
| Realized-PnL leaderboard on our window | n/a | n/a | ✅ (TBD) |

### Always-free (brand / trust / retention hooks — never gate)

- **Public whale leaderboard** (when built) — shareable on X, drives signups
- **Receipts page** (last week's signals + how they resolved) — trust hook for Pro conversion; gating it kills credibility
- **Live ticker SSE** — sticky retention; cheap server-side

### Pricing rationale

- **$9/mo or $79/yr** (~$6.58/mo annual = save 27%)
- Anchored vs Polymarket position size ($50–200 typical) → "less than one trade"
- Telegram DEX-whale-tracker bots charge $25–50; we're newer/less battle-tested → priced below
- $9 reads as a "real tool" (vs $4.99 = "weekend project"), psychologically right size
- One paid tier, not multi-Pro tiers — cleaner mental model. Add tiers only when free Pro upgrades hit a real ceiling

### Conversion levers when shipping

- **7-day Pro trial** for new auth users — must-have, see SaaS norm
- Annual paid users get a "Founder" badge on chip (small ego nudge)
- "Sign in to see N top whales / probability chart / PATTERN history" CTAs already wired in tooltip — same pattern extends to "Upgrade to see L3 drill"

### Open question deferred

L3 drill fully Pro vs. soft-Pro (L3 structure visible, but per-cell whales + chart locked). Decide closer to ship date based on Free-auth retention data — if users plateau at L2 we know L3 is the right gate. If they bounce because L2 feels shallow, soften L3 access and gate the deep-insight widgets only.

## Ideas backlog (not scheduled)

Captured here so they don't get lost — promote into a versioned phase row when ready to ship.

- **Convergence threshold filter** — needs a fine-grained time bucket to be meaningful. Tried it on top of the existing 5m/30m/1d/7d ranges and removed it: an absolute "≥N whales" threshold isn't comparable across bucket sizes (10 whales in 5min vs 10 whales in 7d are completely different signals). The right unlock is a **dedicated 12-minute timeline** (e.g. 60 buckets of 12s each, or 12 buckets of 1min each) where "≥N unique whales in this slot" actually means simultaneous convergence. Until that range exists, the WHALES metric stands on color intensity (per-grid normalisation) which is comparable WITHIN a view.
- **Anti-consensus / contrarian flag** — surface a single elite whale going *against* a forming consensus (one of the top realized-PnL whales sells while 5+ others buy). Once realized-PnL leaderboard is in place this becomes a one-line query.
- **Biggest wins history + realized-PnL leaderboard** — page listing top realized winning trades from `processed_resolutions` (whale bought YES@$0.40, resolved $1.00, +$84k). Plus a whale leaderboard ranked by realized PnL on **our window** (7d/30d/90d), distinct from Polymarket's all-time PNL — answers "is this whale in form right now?" rather than "was this whale ever good?". Same data unlocks "Receipts" page (last week's signals + how they resolved) which is the trust hook for converting hamster-tier users to paid. Requires no new ingestion — just SQL over `signals × processed_resolutions`.
- **Sports two-team versus layout** — for sports markets shaped like "Team A vs Team B" (NFL, NBA, esports), render BOTH team icons in tooltip top-markets and L3 row labels (e.g. Fnatic logo + "vs" + Team Vitality logo, Polymarket-style). Backend: detect via subcategory (Sports tags + " vs " in question) and resolve per-team logos — Polymarket's gamma doesn't expose team-level icons (confirmed 2026-05-04: every NBA/EPL market we sampled returns the same generic event thumbnail across all sub-markets). Tried initials-in-circles fallback and reverted — read as fake icons rather than team identification. Path forward: curated `name → logoUrl` map for top leagues (NBA 30 + NFL 32 + MLB 30 + EPL 20 + UCL ~30 ≈ 150 entries) using ESPN CDN. Stays single-icon until that data lands.
- **Product analytics** — instrument the dashboard so we know what users actually do (which ranges/metrics get the most clicks, drill-down depth distribution, hover→click conversion on cells, time-on-app, whale-drawer open rate, sign-in conversion funnel, where Pro-gated CTAs get clicked). Drives the monetization plan: which Free-auth features matter, where Pro tier ceilings actually are, which features deserve more polish vs. quiet retirement. Privacy-respecting first-party analytics preferred (PostHog self-hosted, Plausible, or simple roll-our-own to TimescaleDB so events sit alongside signals). Avoid GA4 — fingerprinting + GDPR friction don't fit a tool that already requires sign-in. Decide instrumentation scope before wiring, otherwise we end up with noise: start with ~10 named events (auth_signin, range_changed, metric_changed, drill_open, whale_drawer_open, market_link_click, sse_connected, login_modal_shown, upgrade_cta_click, signup_completed). Add session-replay only if it earns its keep — heatmap UX is mostly already legible from event traces.
- **Landing page (pre-app design pass)** — `/` is currently a placeholder route in front of the app at `/app`. Replace it with a real conversion-focused landing built via Claude design loop: hero with live-data hook (e.g. animated heatmap snippet, "$X tracked from N whales in last 24h"), feature pillars (LIVE / PATTERN / drill / whale profiles), Pro tier CTA, social proof once we have signups, FAQ. Should sell the product to a cold visitor who landed from X/Reddit, not just describe it. Performance budget: static-rendered, <100KB JS, no SSE. Coordinates with the always-free public leaderboard idea (#receipts) which is the trust-hook content surface.
- **Visual highlights / live activity layer** — surfaces big trades and convergence on the dashboard as floating left-side plaques (`WHALE BUY · $1.5k Theo4 · Bitcoin Up/Down`, `🐋×N converging`). Tried 2026-05-04 and reverted: data was visibly lagging on the user side, the metric-aware logic landed too noisy at quiet hours and not at all at peak hours, and per-metric thresholds (volume / pnl) needed more dialled-in scope rules than P95/P99/P99.9 alone gave us. **Working backend pieces to revive:** materialised view `signal_thresholds` (P95/P99/P99.9 per scope per metric, hourly cron refresh), `scope-thresholds.ts` lookup module (parent-fallback walk, MIN_SAMPLE_N=50), per-signal magnitude tag in SSE wire shape. **What needs more work:** (a) anchor positioning that doesn't fight the row layout when many plaques fire near each other, (b) per-metric semantics that survive metric switches without spamming convergences, (c) a clean way to throttle without users complaining "I haven't seen one yet" during quiet hours — maybe a "recent highlights feed" sidebar instead of in-grid plaques, (d) avoid creating a second EventSource that burns the per-origin SSE budget. Implementation plan + tradeoffs are in the git history (commits `feat(live-activity)…`, `fix(plaque)…`, `feat(thresholds): P99.9…`). Picking it back up = re-add the materialised view, restore the SSE magnitude tag, build a less intrusive presentation.

## MVP scope (locked) — historical

The MVP shipped includes everything in the table's first row plus pieces from v1.1/v1.2 that landed early. Drill-down + KPI popovers + market links are all live on https://oralab.xyz. Out-of-MVP scope (Telegram, monetization, auth, trade exec) is tracked in v2.x rows above.

## Running

```bash
bun install
docker compose up db -d                   # TimescaleDB
bun run db:migrate                         # apply schema
bun run dev                                # ingestor + API (watch mode)

# Full stack (production)
docker compose up -d                       # db + app + caddy

# Logs
docker compose logs -f app
```

## Static checks

```bash
bun run typecheck                          # tsc --noEmit (strict)
bun test                                   # vitest
bun test --coverage                        # coverage report
```

## Tooling — how to work on this project

### Skills (use reflexively)
- `brainstorming` → `writing-plans` → `executing-plans` — for new features only
- `test-driven-development` — always for pure functions (`categorize.ts`, aggregation logic)
- `systematic-debugging` — when WS connection issues or data anomalies appear
- `verification-before-completion` — before claiming any task done:
  1. Does `bun run typecheck` pass?
  2. Do tests pass?
  3. Is the ingestor actually receiving signals? (check logs)
  4. Does `/api/heatmap` return real data?

### Before writing code
1. Read this file fully
2. Read `docs/handoff-polymarket-whale-feeds.md` in oralab repo for endpoint details
3. Check `.env.example` for all configurable values
4. Understand the critical rules table — especially SIG-1 (dual heartbeat) and SIG-5 (confidence field)

### Code quality gates
- No `console.log` in production — use structured logger
- Every WS event handler must have try/catch — one bad parse must not crash the ingestor
- Batch DB inserts — never insert per-event
- Cache gamma responses — never fetch per-event
- All thresholds from env vars — never hardcode timeouts, intervals, TTLs

## Reference implementations

Copy patterns from `Moonkeemoo/oralab` production code:
- `src/feed/rtds_feed.ts` — RTDS subscriber (the starting point for `ingestor.ts`)
- `src/feed/market_book_ws.ts` (444 LOC) — dual heartbeat + zombie detection + dead-book filter
- `src/api/gamma.ts` — gamma metadata fetch + JSON-string parse
- `src/api/book.ts` — REST `/book` with TTL cache

## Maintenance triggers

Update this file when:
- New data source or WS connection added
- New critical rule discovered
- New API endpoint added
- Convention or stack change
- Phase transition

Skip for: bugfixes, tests, UI tweaks, style changes.
