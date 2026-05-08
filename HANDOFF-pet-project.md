# Handoff — Polymarket scalping bot pet project

A condensed transfer of everything I learned on **oralab** that you should reuse on the new bot. Goal: skip the 6-8 weeks of cleanups + rewrites we did here and ship correct from day one.

The bot is a separate piece — it consumes the same Polymarket data sources but the action is order placement, not visualisation. Different gotchas apply.

---

## 1. Project bootstrap (decisions to make day one)

### Stack — what worked well on oralab and would work on the bot

| Layer | Pick | Why |
|---|---|---|
| Runtime | **Bun** | Fast cold start, native fetch + WebSocket, drop-in TypeScript without ts-node. Matters more for a live bot than a web app. |
| API framework | **Elysia** | Native to Bun, type-safe, supports SSE + WS first-class. If you don't need an API on the bot, skip it. |
| DB | **PostgreSQL 16 + TimescaleDB** | Trades hypertable, automatic compression, retention policies. For a bot you'll want a `fills` / `orders` / `positions` table — same hypertable approach saves you from deciding when to delete old rows. |
| ORM | **Drizzle** for schema + raw `postgres` (postgres-js) for queries | Drizzle for migrations + typed schema, postgres-js for hot-path queries because it's faster and the SQL is more readable for analytical queries. |
| Frontend (if any) | Next.js 15 App Router | Only if the bot has a dashboard. For a headless bot, skip and just expose `/api/health` + `/api/positions`. |
| Hosting | **Hetzner CPX22** + native systemd, no Docker | $7/mo, fast disk, TimescaleDB native install. See `reference_prod_ssh.md` in oralab memory. |

### Skip these for now

- **Auth** — bot is single-user. Don't build a 5-provider auth flow for a personal scalper.
- **Frontend redesign** — pet project. Plain old `<table>` of positions is fine. Iterate on UX after the strategy makes money.
- **Rate limiting / CDN** — not exposed publicly.

### Repo layout

Bun workspaces monorepo (one `apps` + one `packages` if you want to share types between bot and dashboard; otherwise just one app):

```
packages/
  bot/                              ← the scalper
    src/
      index.ts                      ← entrypoint, wire deps
      config.ts                     ← all env vars typed + validated
      log.ts                        ← structured pino-style logger
      polymarket/
        rtds.ts                     ← trades firehose subscriber
        l2-book.ts                  ← order-book WS subscriber
        clob.ts                     ← CLOB v2 client wrapper
        gamma.ts                    ← market metadata fetcher (TTL cache)
      strategy/
        signals.ts                  ← when do we want to enter?
        risk.ts                     ← position sizing, kill switch, drawdown
      execution/
        executor.ts                 ← place / cancel / modify orders
        reconciler.ts               ← match local state to on-chain state
      state/
        positions.ts                ← in-mem + DB
        fills.ts                    ← write-through to signals_hourly
      api/                          ← optional — only if you want a dashboard
        index.ts
  shared/                           ← types if you split bot/dashboard
db/
  migrate.sql                       ← schema bootstrap
data/
  whale_corpus.json                 ← reuse from oralab if you want copy-trading
  strategies/                       ← per-strategy configs
docs/
  CLAUDE.md
  HANDOFF.md (this file)
  decisions/                        ← ADRs — one .md per major decision
```

**Why this shape:** I tried both (a) flat single-folder and (b) split-by-domain. (b) wins because trading bots have very distinct concerns (data ingestion vs strategy vs execution vs state vs risk), and you'll want to test them independently.

### CLAUDE.md template

Drop this file into the new repo's root. It primes the agent (me) on every conversation:

```markdown
# CLAUDE.md — <project name>

> One-line goal.
> Repo: `<github>/<repo>`.

## What this project does
<2-3 paragraphs. Concrete. "Connects to Polymarket CLOB v2, runs a market-making strategy on tennis match markets with bid-ask spread > 5%, places limit orders on both sides, manages inventory risk via kill switch.">

## Critical rules — top N
| # | Rule | If violated |
|---|------|------------|
| EXEC-1 | Use @polymarket/clob-client-v2 1.0.2+, not v1 (broken since 2026-04-27) | Order placement silently fails |
| EXEC-2 | Always include `custom_feature_enabled: true` in market WS subscribe | Silent failure, no L2 data |
| EXEC-3 | Idempotency: every order must carry a client-generated UUID | Double-fill on retries |
| EXEC-4 | Reconcile every 30s — local state vs CLOB book vs chain | Drift means real money lost |
| EXEC-5 | Hard kill-switch on drawdown > X% | Strategy bug = unbounded loss |
| EXEC-6 | Paper-trade mode on every PR — never deploy untested | obvious |
| EXEC-7 | Position cap per market + total cap | One bug at L3 cascades |
| (copy SIG-1..SIG-4 from oralab CLAUDE.md for shared Polymarket gotchas) |

## Conventions
- TypeScript strict, no `any`
- Discriminated unions for OrderStatus / FillKind / PositionSide
- All env in `.env`, validated at boot via Zod
- Every SQL on the hot path → batched
- Every external HTTP call → TTL cache + retry with exponential backoff
- `currency: "USD"` everywhere; never raw `number` for money — use a `UsdAmount` branded type

## No-go list
- No `console.log` in production
- No magic numbers (every threshold = env var)
- No silent fallbacks ("default to 0 on parse error" hides bugs)
- No copy-paste between strategies — extract on 2nd, not 3rd

## Phase plan
| Phase | Status |
|---|---|
| MVP — paper trading vs live RTDS | |
| v1.1 — single live order on testnet | |
| v1.2 — first live position with $10 cap | |
| v1.3 — full strategy + dashboard | |

## Reference implementations
- `Moonkeemoo/oraheatmap` — RTDS subscriber + gamma cache + hypertable schema
- (not the v1 `oralab` — see `feedback_oralab_caveat`)
```

The level of detail here pays for itself in 2 weeks.

---

## 2. Polymarket-specific knowledge — transfers as-is

### Data sources you already know

```
RTDS firehose       wss://ws-live-data.polymarket.com    no auth, every trade
Gamma metadata      https://gamma-api.polymarket.com     no auth, market info
CLOB book REST      https://clob.polymarket.com/book     fallback only
CLOB WS L2 book     wss://ws-subscriptions-clob.polymarket.com   per-market depth
CLOB v2 trading     SDK @polymarket/clob-client-v2       requires wallet signature
```

### The 8 production gotchas (all still apply)

1. **RTDS subscribe shape** is just `{ "type": "trades" }`, nothing else.
2. **Market book WS** MUST include `custom_feature_enabled: true` or you get silent failure (no errors, no data).
3. **`asset_id` field inconsistency** — always `asset ?? asset_id ?? token_id ?? market`.
4. **Dead-book filter** — drop when `bid ≤ 0.02`. Polymarket placeholders.
5. **Dual heartbeat watchdogs** required — server-side ping isn't enough; layer a "no-DATA-for-45s" warn-only watchdog so zombie connections get caught.
6. **CLOB v1 broken since 2026-04-27** — must use `@polymarket/clob-client-v2` 1.0.2+.
7. **Gamma JSON-string fields** — `outcomes` and `outcomePrices` are stringified JSON, must `JSON.parse()`.
8. **`/book` REST latency ~500ms** — cache aggressively if you fall back from WS.

Worth memorising as **EXEC-1..EXEC-8** in your project's CLAUDE.md too.

### Things you DON'T need to relearn — copy from oralab

- `packages/api/src/ingestor.ts` — RTDS WS client wiring with the `@polymarket/real-time-data-client` SDK and dual heartbeat watchdog.
- `packages/api/src/gamma-cache.ts` — Gamma fetch + 30s TTL cache + JSON-string parse.
- `data/whale_corpus.json` — if your strategy uses smart-money copy-trading, the 10k-address watchlist is already curated weekly.
- `db/migrate.sql` — TimescaleDB hypertable + compression + retention pattern. Adapt the column set for `fills`, `orders`, `positions`.

---

## 3. Trading-bot-specific concerns (new ground beyond oralab)

### CLOB v2 client setup

```ts
import { ClobClient, Chain } from "@polymarket/clob-client-v2";

const client = new ClobClient(
  process.env.CLOB_HOST!,           // https://clob.polymarket.com
  Chain.POLYGON,
  signer,                            // ethers.Wallet
  apiKey                             // derive via client.deriveApiKey() once, persist
);
```

The wallet is the EOA that signs orders. It does NOT need to hold positions — Polymarket uses a proxy contract. Fund the proxy, not the EOA.

### L2 order book vs RTDS trades

- **RTDS trades** = "what just happened". Use it for signal detection, copy-trading.
- **L2 order book** = "what's currently available to fill against". Use it for execution. Sub it per-market only when you have an active position or are evaluating one — subbing all 10k+ markets at once will drown you in events.

### Idempotency is non-negotiable

Every order placement carries a client-generated UUID. If the network blips and you don't see the response, retry with the SAME UUID. Polymarket's CLOB will dedupe. Without this you double-fill on every flaky connection.

### Reconciliation loop

Every 30s:
1. Fetch open orders from CLOB.
2. Compare to local state.
3. If CLOB has an order you don't track → cancel it (orphan).
4. If you track an order CLOB doesn't have → mark filled or expired.
5. If positions don't match → log loud, alert.

This catches: process restart with in-flight orders, partial-fill confusion, stale replicas after deploy.

### Risk gates (hard-coded, not strategy-tunable)

- **Total exposure cap** — sum of (size × price) across all open positions ≤ $X.
- **Per-market cap** — single market ≤ $Y.
- **Drawdown stop** — realized PnL drops > Z% in 1h → liquidate all + halt.
- **Kill switch endpoint** — `POST /api/halt` flips a flag, executor sees it, cancels everything, exits run loop. You'll thank yourself the first 3am bug.
- **Paper-trade fallback** — `BOT_MODE=paper` env var. All execute calls become local-only. Use this for >90% of dev work. Never let a strategy run in `live` mode without 24h+ in `paper` first.

### What to log (structured, JSON, every event)

```
{ts, level, event, strategyId, marketId, orderId, side, size, price, ...details}
```

Events I'd instrument from day one: `signal_fired`, `order_placed`, `order_cancelled`, `order_rejected`, `partial_fill`, `full_fill`, `position_opened`, `position_closed`, `pnl_realised`, `risk_breach`, `kill_triggered`, `reconcile_drift`. Each with enough context to reconstruct what happened without DB access.

---

## 4. Engineering principles I've internalised on oralab

These transferred from session-after-session of mistakes. Apply from day one and you skip them.

### Architecture-first, not code-first

Before coding a new feature that touches 3+ files:
1. **Sketch the hierarchy.** Are there orthogonal dimensions? Subject (TRADES/WHALES) × Mode (LIVE/PATTERN/MACRO) is two dimensions, not one big enum. We learned the hard way — added "WHALES" to a flat `Mode` enum, then migrated 10 files when it turned out the user wanted a hierarchy.
2. **Will this be the 3rd duplicate of a pattern?** Extract the primitive NOW, not after the 5th. (Drawer chrome was duplicated 5× before we made `<Drawer>`.)
3. **Will the new state be touched in 3+ places?** Extract a hook now. (`useUrlFilters`, `useWatchlist` — both retroactively pulled out of 700+ line components.)
4. **Does the new shape fit existing types?** If you're about to add "this is mostly like X but with extra fields", extend X with optional fields used by the new path, OR alias as a different name. Don't silently bloat shared types.

### Naming consistency is free leverage

Pick one term per concept, use it everywhere. We had `subject` / `kind` / `type` for different things at different places — every grep missed half the call sites.

### Extract handler modules when route handlers grow past 500 LOC

Pattern from oralab refactor: each big route handler (`handleTradesSubject`, `handleWhalesSubject`, `fetchCellStats`, `fetchHighlights`, etc.) is a focused module that takes `{ sql, params }` and returns a typed result. The route stays a thin wrapper for cache + headers.

For a bot: `runMarketMakerStrategy({ market, book, position }) → { actions, newState }` style. Pure functions where possible.

### Don't stack heavy DB queries

The whales-subject /api/heatmap branch already did 90d aggregation; adding two more full-window scans tipped 12d/12w over Caddy's 60s timeout → 502. Lesson: derive what you can from data already in memory; only hit the DB again when truly needed; if you must, scope tight (`= ANY($addrs::text[])`, never a full corpus scan).

For a bot: don't query positions table on every tick. Cache the position state, write through to DB on every fill, read from cache for hot paths.

### postgres-js Date gotcha

Pass timestamps as ISO strings + `::timestamptz` cast. Passing JS `Date` through nested template-literal sql fragments throws `Received an instance of Date`. Bit me three times before I memorised it.

### Default to no comments in code

Only write a comment when the WHY is non-obvious — a hidden constraint, a workaround for a specific bug, behaviour that would surprise a reader. Never explain WHAT the code does (well-named identifiers do that). Never reference the current task / fix / issue number — that rots fast.

The exception: a one-line "tradeoff" comment when you made a non-obvious choice (e.g. "Skip the cache here — payload is user-specific and would collide across users").

---

## 5. Tooling — how to work efficiently with me

### Skills you should reach for

- **brainstorming** before writing-plans before executing-plans — for any feature touching 3+ files. Skipping the brainstorm step is the #1 reason we ended up with 5 copies of drawer chrome.
- **test-driven-development** — for pure functions (strategy logic, risk gates, order matching). Trading code WITHOUT tests is a foot-cannon. Specifically:
  - `signals.ts` — every "should fire signal" rule has a unit test.
  - `risk.ts` — every gate (total cap, per-market cap, drawdown) has a unit test.
  - `executor.ts` — paper-trade mode IS the unit test environment.
- **systematic-debugging** — when an order doesn't behave as expected, follow the chain: did signal fire → did risk gate pass → did executor get called → did CLOB acknowledge → did fill arrive? Don't jump to conclusions.
- **verification-before-completion** — before claiming any task done:
  1. typecheck passes
  2. tests pass
  3. paper-trade mode runs an entire session without errors
  4. metric (e.g. PnL ledger, fill count) actually moves the way you expected

### Memory system — keep it lean from day one

I run a per-project memory at `.claude/projects/<repo-path>/memory/`. Folder is auto-created. You should let me write to it freely.

What goes in:
- **`feedback_*`** — guidance you've given me that I should keep applying ("don't mock the DB in tests"; "always quote money as branded type"). Save reasons too.
- **`project_*`** — non-obvious facts about the project ("CLOB API key was provisioned via X on Y date"; "kill switch lives at /api/halt and triggers state file at /var/lib/bot/halt.flag").
- **`reference_*`** — pointers to external systems (CLOB docs URL, your wallet address, the staging vs prod chain split).

What does NOT go in: code patterns (derivable from current files), git history (use git), debug logs, or anything that rots quickly.

`MEMORY.md` is an index — one line per memory file, max 200 lines total because it auto-loads into context every conversation.

### Task tracking

Use TaskCreate for any work that's 3+ steps. Status: `pending → in_progress → completed`. Don't use it for trivial single-edit fixes.

### Autonomous-push convention

If you want me to push to origin without asking each time, save a feedback memory like `feedback_autonomous_push.md` saying so. Destructive ops (force-push, branch delete) still require confirmation.

---

## 6. Production deployment — what worked on oralab

### Hetzner native, no Docker

Why: 4× faster cold start, way less memory overhead, simpler debugging via journalctl. The Docker tax for a small project isn't worth it.

```
# /etc/systemd/system/bot.service
[Unit]
Description=Polymarket scalper
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=bot
WorkingDirectory=/home/bot/polymarket-bot
EnvironmentFile=/home/bot/polymarket-bot/.env
ExecStart=/home/bot/.bun/bin/bun run packages/bot/src/index.ts
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
MemoryMax=1G

[Install]
WantedBy=multi-user.target
```

### Deploy ritual

```bash
ssh bot@your-host "cd ~/polymarket-bot && git pull --ff-only origin main && bun install && sudo systemctl restart bot && sudo journalctl -u bot -n 20 --no-pager"
```

The last command shows recent logs so you see the boot succeeded BEFORE you `Ctrl+C`.

### Database backups (do this from day one, not after)

```bash
# /etc/cron.daily/backup-bot-db
#!/bin/bash
pg_dump bot_db | gzip > /var/backups/bot/bot_db_$(date +%Y%m%d).sql.gz
find /var/backups/bot -mtime +14 -delete
```

Plus rsync the directory to a second box or S3 weekly. Automated PG backups was my biggest oralab regret (still TODO).

### Kill switch

```bash
# Manual halt — flips state file the bot polls every loop iteration
ssh bot@host "touch /var/lib/bot/halt.flag"
```

Bot reads it on every signal-loop iteration, exits gracefully if set. Survives process restarts. No code path in the bot bypasses this check.

---

## 7. What I'd do differently knowing what I know now

If I were starting oralab today:

1. **Sketch Subject × Mode hierarchy on day one**, not after 6 weeks of organic growth. Same lesson applies to bot: are there orthogonal dimensions you'll be tempted to flatten into one enum? (Strategy × Market-type × Risk-mode? Pre-trade × Live × Post-trade? Sketch first.)
2. **Extract `<Drawer>`, `useUrlFilters`, `useWatchlist` -class primitives at duplicate #2**, not duplicate #5.
3. **Make `topLeftCell` / slot-based layout primitives from the first design pass**. Mid-flight grid restructuring (when WhaleSetToggle had to land in the time row) cost a session.
4. **Write critical-rules table BEFORE first PR**, not after the third "wait why isn't this working" debug session.
5. **Wire structured analytics from day one** — even if it's just `INSERT INTO events VALUES (...)`. You'll ALWAYS regret not having "what was the bot doing at exactly the moment X happened" replayable data.
6. **Decide on units once and brand them**: `UsdAmount`, `BasisPoints`, `Probability` (0..1, not %), `OrderSize`. Trading code with raw `number`s for everything is where bugs hide.
7. **Paper-trade mode from PR #1**, not added retrofit.

---

## 8. First-week checklist for the new bot

- [ ] Repo created with the layout above
- [ ] CLAUDE.md filled in (use the template)
- [ ] `.env.example` with every var the bot will need
- [ ] PostgreSQL + TimescaleDB installed locally; `db/migrate.sql` applied
- [ ] `@polymarket/clob-client-v2` + `@polymarket/real-time-data-client` installed
- [ ] Wallet generated, EOA funded with $5 testnet for first live test (don't skip testnet)
- [ ] CLOB API key derived + persisted in 1Password / pass / vault
- [ ] Paper-trade mode wired before any executor code runs
- [ ] Risk gates wired before any place-order code runs
- [ ] Kill-switch endpoint + state-file pattern implemented
- [ ] systemd service file + deploy ritual written
- [ ] First feedback memory saved telling me "always paper-trade before live"
- [ ] First test running before second feature is built

---

## Reference: oralab files worth copy-pasting from

- `packages/api/src/ingestor.ts` — RTDS subscriber + heartbeat
- `packages/api/src/gamma-cache.ts` — TTL cache + JSON-string parse
- `packages/api/src/db.ts` — Drizzle + postgres-js dual-driver wiring
- `packages/api/src/log.ts` — structured JSON logger
- `packages/api/src/ttl-cache.ts` — generic in-process LRU+TTL
- `packages/api/src/auth-jwt.ts` — only if you ever expose a dashboard
- `db/migrate.sql` (signals hypertable section) — pattern for `fills`, `orders` tables

Adapt, don't transplant. Each file has oralab assumptions baked in.
