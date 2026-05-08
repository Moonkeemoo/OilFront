# CLAUDE.md — polyscalp

> Polymarket scalping bot. Bun + TypeScript + CLOB v2.
> North stars: **"correct from day one"** (skip the 6-8 weeks of cleanups oralab needed) + **"paper-trade is the default, live is the exception"**.
> Repo: `Moonkeemoo/polyscalp`.

## What this project does

Single-user, headless scalping bot on Polymarket. Subscribes to RTDS firehose for signal detection and per-market L2 books for execution context. Places limit orders via `@polymarket/clob-client-v2`, manages inventory via pure-function risk gates, reconciles local state vs CLOB+chain every 30s. Strategy entrypoint is pure: `decideAction({ market, book, position, signals }) → Actions[]`. Closure only on confirmed CLOB fill or chain-side resolution.

P0 = paper-trade only on live RTDS. P1 = single live order on testnet, $5. P2 = first live position, $10 cap. P3 = full strategy + minimal dashboard.

Sibling projects (read-only references, NOT runtime deps):
- `Moonkeemoo/oralab` — sports-focused auto-trader (whale copy + filters + decide_exit). Source for: `ingestor.ts`, `gamma-cache.ts`, `db.ts`, `migrate.sql` patterns.
- `Moonkeemoo/whale-signal-heatmap` (oraheatmap) — RTDS heatmap + whale corpus refresh script + TimescaleDB schema patterns.

## Architecture (one screen)

```
External:    RTDS WS firehose · CLOB WS L2 (per-market) · CLOB v2 SDK · Gamma REST · Polygon RPC
Hetzner:     single Bun process (signals → strategy → executor → reconciler) · PostgreSQL+TimescaleDB · systemd
Optional:    /api/health + /api/positions + /api/halt (Elysia, only if dashboard)
```

```
RTDS firehose ─┐
               ├─▸ signals.ts (pure) ─▸ risk.ts (pure gates) ─▸ executor.ts ─▸ CLOB v2
L2 book WS  ───┤                                                     │
Gamma cache ───┘                                                     ▼
                                                              fills hypertable
                                                                     ▼
                                              reconciler.ts (every 30s) ◂─▸ CLOB orders + chain
```

Full bootstrap context: `HANDOFF-pet-project.md` (transferred lessons from oralab).

## Critical rules — top 12

Numbered for greppability. **EXEC-** = order/wallet correctness · **SIG-** = Polymarket data gotchas · **INV-** = live-trading invariants.

| # | Rule | If violated |
|---|------|------------|
| EXEC-1 | Use `@polymarket/clob-client-v2` 1.0.2+. CLOB v1 broken since 2026-04-27. | Order placement silently fails. |
| EXEC-2 | Every order carries a client-generated UUID; retries reuse the same UUID. | Double-fill on flaky network. |
| EXEC-3 | Reconcile every 30s — local state vs CLOB orders vs chain fills. Cancel orphans, mark missing-locally as filled. | Drift = real money lost. |
| EXEC-4 | Hard kill-switch reads a state file (`/var/lib/polyscalp/halt.flag`) on every loop iteration. No code path bypasses it. | Cannot stop a runaway strategy at 3am. |
| EXEC-5 | `BOT_MODE=paper` is default. Switching to `live` requires ≥24h clean paper-trade run on the same code. | Untested strategy hits real funds. |
| EXEC-6 | Risk gates (total cap, per-market cap, drawdown) are env-driven, evaluated BEFORE every order, hardcoded outside strategy code. | Strategy bug = unbounded loss. |
| EXEC-7 | Closure only on confirmed CLOB fill OR market resolution. Never close locally on timeout. | Orphan position. |
| SIG-1 | Use `@polymarket/real-time-data-client` SDK for RTDS — never raw `ws`. Subscribe shape: `{ subscriptions: [{ topic: "activity", type: "trades" }] }`. Layer warn-only DATA-silence watchdog (>45s = zombie). | Hand-rolled WS misses ping/pong; wrong subscribe shape = no data. |
| SIG-2 | Wallet/asset extraction probes ALL aliases: wallet = `proxyWallet ?? proxy_wallet ?? user ?? maker ?? taker ?? address`; asset = `asset ?? asset_id ?? token_id ?? market`; condition = `conditionId ?? condition_id`. | Most signals dropped — vanilla `event.user` misses production payloads. |
| SIG-3 | Market book WS subscribe MUST include `custom_feature_enabled: true`. | Silent failure: no errors, no L2 data. |
| SIG-4 | Gamma `outcomes` / `outcomePrices` are JSON-string fields — must `JSON.parse()`. Add `?include_tag=true` to `/markets` for category. | Crashes / "Other" category for everything. |
| SIG-5 | Dead-book filter: drop quotes where `bid ≤ 0.02`. Polymarket placeholders. | Garbage prices feed strategy. |
| INV-1 | Mark-staleness gate before any SL/TP/exit decision. If feed stale (>N seconds), no action. | False SL on stale data. |
| INV-2 | Bounded ops everywhere: timeout + retry + idempotent. No unbounded `await`. | Bot stuck silently. |

Adapt or extend, but don't drop these without an ADR.

## Conventions

- **TypeScript strict** — no `any`, no implicit any, no unchecked indexes
- **Discriminated unions** for `OrderStatus` / `FillKind` / `PositionSide` / `Action` — never bare string status
- **Pure functions** for `signals.ts`, `risk.ts`, strategy core. `decideAction` MUST be pure and unit-tested
- **Branded money types** — `UsdAmount`, `BasisPoints`, `Probability` (0..1, not %), `OrderSize`. Never raw `number` for money
- **Bun runtime** — native fetch + WebSocket where simple; SDK clients where they exist
- **PostgreSQL + TimescaleDB** for hypertables (`fills`, `orders`, `positions_snapshot`)
- **Drizzle for schema/migrations + `postgres` (postgres-js) for hot-path queries** — Drizzle-typed SQL is too verbose for analytical queries
- **Env validated at boot via Zod** — no env reads sprinkled through code
- **Structured JSON logger** (pino-style) — fields: `{ts, level, event, strategyId, marketId, orderId, side, size, price, ...}`
- **No JSON files for state** — DB is the single source of truth (whale_corpus.json is the only allowed exception, it's a watchlist not state)
- **Platform UI in English; Claude ↔ Taras collaboration in Ukrainian**
- **No Docker** — Hetzner native + systemd. 4× faster cold start, less memory, journalctl debugging

## No-go list

- No `console.log` in production — structured logger only
- No magic numbers — every threshold (cap, drawdown, TTL, timeout) is env var, validated at boot
- No silent fallbacks — `parseFloat(x) || 0` hides bugs; throw or branch explicitly
- No copy-paste between strategies / handlers — extract on duplicate #2, not #5 (see Architectural discipline)
- No `--no-verify` on git, no skipping pre-commit hooks
- No live-mode order without ≥24h paper-trade on the same code

## Architectural discipline (lessons paid for in oralab + heatmap)

Apply when adding a feature that touches **3+ files**. Skip for bugfixes / single-file tweaks.

1. **Sketch hierarchies before encoding flat enums.** Are there orthogonal dimensions? Strategy × Market-type × Risk-mode = three axes, not one big enum. The "WHALES added to flat Mode enum" mistake cost a full session of migration on heatmap. If the user describes a hierarchy in plain language ("WHO → HOW → WHEN → WHAT"), encode that hierarchy in state shape.
2. **Extract a primitive by the 3rd duplicate, not the 5th.** Drawer chrome was copy-pasted 5× before consolidation (~250 LOC dup). When about to copy a structural pattern for the 3rd time — stop, extract.
3. **State in a 700+ LOC component → hook.** When `useState` count climbs past ~5 in a large component, extract a custom hook. (Frontend rule — only relevant if dashboard ships.)
4. **Fit existing types before stretching.** "This is mostly like X with extra fields" → either extend X with optional fields used only by the new path, or alias as a different name. Don't silently bloat shared types.
5. **Naming consistency is free leverage.** Pick one term per concept (`subject`, `kind`, `type` were all used for different things on heatmap → grep missed half the call sites). One term, everywhere.
6. **Don't stack heavy DB queries on hot paths.** Cache position state in memory; write through to DB on every fill; read from cache on every tick. Full corpus scans on every loop iteration = OOM.
7. **`postgres-js` Date gotcha** — pass timestamps as ISO strings + `::timestamptz` cast. Passing JS `Date` through nested template-literal sql fragments throws `Received an instance of Date`.

## Polymarket data sources

### RTDS firehose (primary — signal detection)
- `wss://ws-live-data.polymarket.com` — no auth, every trade, no reply expected
- Use the SDK (`@polymarket/real-time-data-client`), not raw `ws` — see SIG-1
- Layer warn-only data-silence watchdog (>45s = zombie, restart client)

### CLOB WS L2 book (per-market — execution context)
- `wss://ws-subscriptions-clob.polymarket.com`
- Subscribe per-market only when active position OR evaluating one. Subbing 10k+ markets = drown
- MUST include `custom_feature_enabled: true` (SIG-3)

### Gamma metadata (market info — categorization, outcomes)
- `https://gamma-api.polymarket.com/markets?clob_token_ids={asset_id}&include_tag=true`
- 30s TTL cache. `outcomes` / `outcomePrices` are JSON-strings (SIG-4)

### CLOB book REST (fallback only)
- `https://clob.polymarket.com/book?token_id={asset_id}` — ~500ms latency, cache 500ms
- Bids array sometimes UNSORTED — sort by price desc

### CLOB v2 trading (order placement)
- SDK: `@polymarket/clob-client-v2` 1.0.2+ (EXEC-1)
- EOA signer signs orders; proxy contract holds positions. Fund the proxy, not the EOA
- Derive API key once via `client.deriveApiKey()`, persist (1Password / pass / vault)
- No `builder` field on orders — Builder Program registration unavailable to us

## Project structure

```
packages/
├── bot/
│   ├── src/
│   │   ├── index.ts                — entrypoint: wire deps, start loops
│   │   ├── config.ts               — env vars typed + Zod-validated at boot
│   │   ├── log.ts                  — structured pino-style logger
│   │   ├── polymarket/
│   │   │   ├── rtds.ts             — trades firehose subscriber + watchdog
│   │   │   ├── l2-book.ts          — per-market depth subscriber
│   │   │   ├── clob.ts             — CLOB v2 client wrapper + idempotency UUIDs
│   │   │   └── gamma.ts            — market metadata fetcher (TTL cache)
│   │   ├── strategy/
│   │   │   ├── signals.ts          — pure: when do we want to enter?
│   │   │   ├── risk.ts             — pure: position sizing, kill switch, drawdown gates
│   │   │   └── decide.ts           — pure: decideAction({ … }) → Actions[]
│   │   ├── execution/
│   │   │   ├── executor.ts         — place / cancel / modify orders (paper or live)
│   │   │   └── reconciler.ts       — match local state to CLOB + chain every 30s
│   │   ├── state/
│   │   │   ├── positions.ts        — in-mem cache + write-through to DB
│   │   │   └── fills.ts            — append-only fills hypertable writer
│   │   └── api/                    — optional: /api/health, /api/positions, /api/halt
│   └── …
└── shared/                         — types if dashboard splits out

db/
└── migrate.sql                     — TimescaleDB hypertable + compression + retention

data/
├── whale_corpus.json               — optional: lowercase addresses for copy-trade strategies
└── strategies/                     — per-strategy configs (JSON, env-overridable)

docs/
├── HANDOFF-pet-project.md          — bootstrap source-of-truth (transferred from oralab)
└── decisions/                      — ADRs, one .md per major decision
```

## Phase plan

| Phase | What | Hard gate to next |
|---|---|---|
| **P0** | Scaffold + RTDS + Gamma + DB schema + paper-trade executor + risk gates wired BEFORE any strategy code | Paper-trade run produces `signal_fired → order_placed (paper) → simulated_fill` events for ≥24h clean |
| **P1** | First live order on testnet, $5 max, single market | Order places + fills + reconciles + cancel works end-to-end |
| **P2** | First live mainnet position, $10 cap, kill switch tested | 7 days clean reconcile, no drift, kill switch fired+recovered once intentionally |
| **P3** | Full strategy + minimal dashboard (`/api/positions` + `/api/halt`) | Realized PnL ledger matches chain truth ±$0.01 |
| **P4+** | Multi-strategy + analytics + monetization (out of scope until P3 stable) | — |

## Risk gates (hardcoded, NOT strategy-tunable)

All values from env, validated at boot:
- `RISK_TOTAL_EXPOSURE_USD` — sum of (size × price) across open positions ≤ this
- `RISK_PER_MARKET_USD` — single market ≤ this
- `RISK_DRAWDOWN_HOURLY_PCT` — realized PnL drops > this in 1h → liquidate all + halt
- `RISK_MAX_OPEN_ORDERS` — total open orders cap (prevents runaway placement loops)
- `RISK_MARK_STALENESS_S` — refuse SL/TP if mark is older than this (INV-1)
- `BOT_MODE` — `paper` (default) | `live` (requires explicit override)

`risk.ts` evaluates ALL gates before every action. Single failure = no action + log `risk_breach`. No strategy can override.

## Running

```bash
bun install
docker compose up -d db                  # TimescaleDB only — bot itself runs native
bun run db:migrate                       # apply schema
cp .env.example .env                     # fill in: CLOB_HOST, signer key, API key, all RISK_* vars
bun run dev                              # ingestor + strategy + executor (paper mode by default)

# Static checks
bun run typecheck                        # tsc --noEmit (strict)
bun test                                 # vitest
bun test --coverage                      # 95%+ on src/strategy/*.ts

# Production deploy
ssh bot@$HOST "cd ~/polyscalp && git pull --ff-only origin main && bun install && sudo systemctl restart polyscalp && sudo journalctl -u polyscalp -n 20 --no-pager"

# Manual halt
ssh bot@$HOST "touch /var/lib/polyscalp/halt.flag"
```

## Tooling — how we work

### Skills (use reflexively)
- `brainstorming` → `writing-plans` → `executing-plans` — for new features touching 3+ files
- `test-driven-development` — ALWAYS for `signals.ts`, `risk.ts`, `decide.ts`. Trading code without tests is a foot-cannon
- `systematic-debugging` — when an order misbehaves: signal fired? → risk passed? → executor called? → CLOB ack? → fill arrived? Don't jump to conclusions
- `verification-before-completion` — before claiming any task done:
  1. `bun run typecheck` passes
  2. `bun test` passes (incl. new tests for the changed code)
  3. Paper-trade run completes ≥1 strategy loop without errors
  4. The metric you expected to move (PnL ledger, fill count, position count) actually moved that way

### Code quality gates (CI / local pre-push)
- typecheck strict, no `@ts-ignore` without an ADR reference
- vitest coverage 95%+ on `src/strategy/*.ts` (pure functions)
- biome lint clean
- No `console.log`, no hardcoded thresholds, no raw `number` for money

### Tests by layer
- **Pure functions** (`signals`, `risk`, `decide`) — full unit + property-based (`fast-check`)
- **Polymarket clients** (`rtds`, `clob`, `gamma`) — integration tests with recorded fixtures, no live calls in CI
- **Executor** — paper mode IS the test environment; live tested only via testnet $5 in P1

## Memory triggers

Save into `.claude/projects/.../memory/` when learning:
- **`feedback_*`** — guidance to keep applying (e.g. "always paper-trade ≥24h before live"; "never mock postgres in integration tests"). Include WHY.
- **`project_*`** — non-obvious facts (CLOB API key provisioning date; kill switch path; testnet wallet address; deploy ritual specifics).
- **`reference_*`** — pointers to external systems (CLOB docs URL; signer wallet address; staging vs prod chain split).

Skip: code patterns (read the file), git history (`git log`), debug-session recipes.

## Maintenance triggers

Update this file when:
- New top-level package or directory added
- New critical rule discovered (also: write an ADR in `docs/decisions/`)
- Convention or stack change
- Phase transition (mark gate met)
- New external data source or SDK added

Skip for: bugfixes, tests, dashboard-only tweaks.

## Reference implementations (copy patterns, don't transplant)

From `Moonkeemoo/oralab`:
- `src/feed/rtds_feed.ts` — RTDS subscriber starting point
- `src/feed/market_book_ws.ts` — dual heartbeat + zombie detection + dead-book filter
- `src/api/gamma.ts` — gamma fetch + JSON-string parse
- `src/api/book.ts` — REST `/book` with TTL cache

From `Moonkeemoo/whale-signal-heatmap` (oraheatmap):
- `packages/api/src/ingestor.ts` — RTDS via SDK + dual heartbeat
- `packages/api/src/gamma-cache.ts` — TTL cache + JSON-string parse
- `packages/api/src/db.ts` — Drizzle + postgres-js dual-driver wiring
- `packages/api/src/log.ts` — structured JSON logger
- `db/migrate.sql` (signals hypertable) — pattern for `fills` / `orders`

Each file has source-project assumptions baked in. Adapt to bot needs (e.g. `signals` table → `fills` table; read-mostly → write-mostly).
