# Polyscalp — research dump 2026-05-07

Source: 3 parallel research agents (web + GitHub + community write-ups).
This doc is the artifact. Decisions / synthesis live in CLAUDE.md and ADRs.

---

## A. Product structure — Polymarket 5-min crypto binaries

**Markets**
- BTC, ETH, SOL, XRP — "Up or Down" binary, 5-min rolling windows, 24/7 (~288 windows/day/asset)
- Title pattern: `Bitcoin Up or Down - May 6, 3:55AM-4:00AM ET`
- URL: `polymarket.com/crypto/5M` (and `/15M`, `/hourly`); event slug `polymarket.com/event/bitcoin-up-or-down-{date}-{time}-et`
- Tags: `crypto` + `5M` / `15M` / `hourly` + per-asset
- 12 active 5M markets at sample time (BTC 33, ETH 21, SOL 13, XRP 11 across all tiers)

**Resolution**
- **Oracle: Chainlink Data Streams (sub-second pull) + Chainlink Automation for on-chain settlement**. Launched 13–14 Feb 2026. NOT UMA — UMA still used for non-deterministic markets only.
- **Mechanic: snapshot at boundary timestamps** (start vs end). Ties bias UP. NOT TWAP/VWAP.
- **Outage fallback: DRAW** — positions returned if Automation can't fetch a valid Data Streams report within grace window. [Inferred from 3rd-party reverse-engineering, blockeden.xyz/forum/.../786]
- **Settlement timing: ~2 min (~64 Polygon blocks) after window close**. No UMA dispute window applies.
- Auto-redeem available.

**Liquidity**
- ~$60M/day across 5-min crypto, ~67% of all crypto prediction volume. Cumulative >$2.3B.
- Per-window typical depth: $5K–$50K notional. Thin vs CEX BTC.
- Top-of-book spread: 1–3¢ on probability scale near 0.5; widens 5+¢ in last seconds and on tails. [inferred — no exact public data]
- Bots ≥55% of volume (Dune-sourced 2025–2026).
- Time-of-day: tracks BTC vol — concentrated US equity open/close + macro prints. Asia thinner. [inferred]

**Fees (post-Jan 2026)**
- **Crypto taker: feeRate 0.072** → effective = `C × 0.072 × p × (1−p)`. Peak ~1.8% notional at p=0.5. ~0.72% at p=0.9 / 0.1.
- Maker: zero fee + **20% rebate share daily** (vs 25% in non-crypto). $1 USDC min payout threshold.
- Round-trip taker at p=0.5 ≈ 3.6% — punishing for naive scalping.
- Fees charged in USDC at match time (post-Apr 28 V2 upgrade).

**CLOB v2 mechanics**
- SDK: `@polymarket/clob-client-v2` ≥ 1.0.2 (v1 broken 27 Apr 2026)
- Collateral: pUSD (was USDC.e pre-upgrade)
- Order types: GTC, GTD, FOK, FAK (= IOC equivalent). No native replace — cancel+place only.
- Tick: 0.01 / 0.001 / 0.0001 / 0.1 (per-market via `minimum_tick_size`). 5-min crypto typically **0.01 (1¢)**.
- Min order size: per-market via `minimum_order_size` on Gamma object. Reject code: `INVALID_ORDER_MIN_SIZE`.
- Bulk cancel: `DELETE /orders` (15/call), `DELETE /cancel-market-orders` per market.

**Rate limits (per API key, sliding)**
- `POST /order`: 3,500 / 10s burst, 36,000 / 10min sustained (~60/sec)
- `POST /orders` batch: 1,000 / 10s, 15,000 / 10min
- `DELETE /order`: 3,000 / 10s, 30,000 / 10min
- `DELETE /cancel-all`: 250 / 10s, 6,000 / 10min — kill-switch territory only
- `GET /book` / `/price` / `/midpoint`: 1,500 / 10s each
- General CLOB: 9,000 / 10s
- CF-throttled — overflows queued, not hard-rejected.
- **At 10–100 ord/min we use 0.03% of order budget. Rate limits are NOT a design constraint.**

---

## B. Open-source landscape + practitioner write-ups

**Repos worth studying**

| Repo | Lang | What |
|---|---|---|
| `Polymarket/poly-market-maker` | Py | Official MM, bands around midpoint, 30s sync, SIGTERM cancels all. Last release Feb 2023. No 5M support. |
| `warproxxx/poly-maker` | Py+JS | defiance_cr's MM. Author admits unprofitable post-2024. **Position-merger (matched YES/NO → USDC) is the gem.** Google-Sheets config. |
| `aulekator/Polymarket-BTC-15-Minute-Trading-Bot` | Py | 7-phase signal fusion (spike + sentiment + Coinbase/Binance divergence). $1 max/trade. WS auto-reconnect + rate limit. [unverified] ~75% win early runs. Built on Nautilus Trader. 221★. |
| `MrFadiAi/Polymarket-bot` | TS | 4 strats: Arb / DipArb (15m crypto) / Copy-trade / Direct. Tiered drawdown halts: 5/15/25/40% permanent. Dynamic sizing −20%/loss streak, +10%/win. `DRY_RUN` env gate. |
| `JonathanPetersonn/oracle-lag-sniper` | — | Chainlink lag exploit on 15m BTC/ETH/XRP/SOL. **DISABLED by GitHub Staff for ToS** — strongest single signal that this strategy actually works. |
| `Polymarket/agents` | Py | LLM + CLOB utilities — reference for order build/sign helpers. |
| `Polymarket/polymarket-subgraph` | — | Official subgraph manifest. Goldsky hosts production indexing. |
| `0-don/polymarket-wallet-recovery` | — | Exists because people lose access. Read before depositing. |

**Common red flags across the field**: zero unit tests on strategy logic, .env credential storage, no idempotent order placement, no formal kill switch beyond SIGTERM, mixing manual + bot-managed positions on same proxy (caused tezlee's losses).

**Hidden gems to borrow**
- poly-maker: matched YES/NO → USDC merger (saves slippage on inventory unwind)
- aulekator: WS auto-reconnect + Redis sim/live flip (no restart)
- MrFadiAi: tiered drawdown halts (5/15/25/40%)

**Practitioner findings**
- **defiance_cr** — peak $700–800/day on $10k cap. Dual-sided posting → ~3× rewards vs single-sided. Only 3–4 serious LPs at peak. Shut down because rewards "decreased significantly" post-election.
- **tezlee** — net **zero** profit forking poly-maker. Wiped by: (a) volatile markets where hedging couldn't keep up, (b) bad position snapshots mixing manual + bot trades, (c) hedging too slow on news.
- **Benjamin-Cup (5m crypto)** — [unverified] 55–60% win rate. Edge: "15–20% of windows resolve based on movement in final 10s." Recommends Kelly sizing, skip <$1k volume markets. (Note: cites stale fee number — actual taker is 7.2%, not 0–2%.)
- **QuantVPS HFT analysis** — average arb opportunity duration **2.7s in 2026** (was 12.3s in 2024); 73% of arb captured by sub-100ms bots; Alchemy/Infura free tiers explicitly "too slow" for HFT.
- **Beyond-Simple-Arb 2026** — [unverified] examples ($1,247 profit / $10k MM in 3 weeks). Calls dedicated Polygon RPC essential, -5% daily drawdown circuit-breaker as standard.
- **Domer interview** — manual, ~10k predictions, $2.5M+ net. Quote: "*prediction markets are basically slow motion poker hands where you can out-research your opponents*". NOT a quoter. Don't copy-trade.

**Strategy convergence across multiple sources**
1. **T-10s sniper window** — book reprice latency on Polymarket ~55s avg; Chainlink Data Streams sub-second. Sleep until T-30s..T-10s, then hit the side BTC clearly indicates. Same conclusion in Archetapp gist + Benjamin-Cup post + the disabled oracle-lag-sniper.
2. **Window-delta dominates TA noise** — current price vs window-open delta ≈ 5–7× weight of RSI/EMA/momentum/vol-surge combined. Most failed bots over-rely on TA noise.
3. **Naive YES/NO sum-to-1 arb is dead on liquid 5m** — opportunity ~2.7s, captured 73% by sub-100ms. Need >2.5–3% gross spread to clear costs; gone except illiquid alts.

**Named operator wallets (public)**
- Theo4 (`0x5668...55839`) — 14 trades/year, $22M PnL [unverified], concentrated discretionary. Not a quoter.
- Domer / @ImJustKen — manual, $300M+ volume.
- defiance_cr — only public MM operator who open-sourced; lineage of poly-maker forks.
- "CemeterySun" — $36.6M cumulative MM volume per 3rd-party.
- "OpenClaw" — commercial, [unverified] $115K/week per user.
- No public Dune dashboard segments quoters specifically — would need own RTDS sample to map them.

**Adjacent infra**
- **Subgraph**: Goldsky hosts Polymarket production. Mirror product → webhooks, direct SQL. Preferred over TheGraph hosted for trading bots.
- **RPC**: free Alchemy/Infura too slow for HFT per QuantVPS. Paid Alchemy/QuickNode "Build" tier table stakes if competing on latency.
- **Reference price**: Chainlink Data Streams power resolution; reading them off-chain pre-settlement is awkward → bots cross-reference Coinbase + Binance WS as a *proxy* for the Chainlink feed.
- **Wallet quirk**: proxy = Gnosis-Safe-derived single-signer on Polygon. EOA can be rotated via Safe `swapOwner` without losing positions.

---

## C. Latency / infra — measured

**Polymarket runs on AWS `eu-west-2` (London) behind Cloudflare anycast**. RTDS, CLOB, Gamma — all `*.polymarket.com`.

**Live measurements from Hetzner CPX22 Helsinki (n=10):**
| Endpoint | TCP | TLS | TTFB warm | CF PoP |
|---|---|---|---|---|
| `clob.polymarket.com` | 7–28ms | 39–62ms | **105–198ms** | KBP / VIE |
| `ws-live-data.polymarket.com` | 6–28ms | 39–127ms | 106–294ms | KBP / VIE |

**Community-corroborated RTT to CLOB**
| Origin | RTT |
|---|---|
| Dublin / London (AWS eu-west-2 same-AZ) | <1 ms |
| Frankfurt / Amsterdam | 8–12 ms |
| **Helsinki (us)** | 20–35 ms raw, ~110 ms TTFB warm |
| US-East (Ashburn) | 70–80 ms |
| Tokyo | 200–250 ms |

**Order-cycle budget Helsinki, warm keep-alive**
| Stage | Budget |
|---|---|
| RTDS delta → process | 5–10 ms |
| EIP-712 sign (viem, local account) | **1–3 ms** |
| HMAC-SHA256 L2 | <0.5 ms |
| HTTP POST `/order` (warm HTTP/2) | **80–150 ms** |
| Polygon settlement | 2–5 s — irrelevant for next-order decisions |

**p50 sign-to-ack ≈ 120ms; p99 ≈ 250ms.** Polygon block 2–2.3s, deterministic finality post-Heimdall v2.

**Decisions**

1. **Stay on Hetzner CPX22 Helsinki.** At 10–100 ord/min we are nowhere near rate limits and the 80–100ms gain from London colocation is meaningless to a directional 5-min binary scalper (signal-to-fill window measured in seconds, not ms). Spend the move-budget on signal logic.
2. **Next step if we outgrow**: Hetzner Falkenstein FSN1 (~12ms to London, same provider, no ops change). AWS `eu-west-2` only if making/queue-priority becomes the strategy.
3. **NJ / us-east-1 is WORSE than Helsinki** for Polymarket — counterintuitive but real (70–80ms NY→London).
4. **Local Polygon RPC: not worth it.** Use Alchemy free + dRPC failover. We touch chain only for reconcile + balance reads, <10 calls/min.

**Signing & keys**
- Env file + restrictive systemd unit + LUKS is reasonable for $1k-equity scale.
- **AWS KMS is WRONG for hot-path signing** — adds 10–30ms RPC overhead per sign. Threshold for KMS: >$25k or multi-user.
- systemd hardening: `ProtectSystem=strict`, `ProtectHome=true`, `NoNewPrivileges=true`, `EnvironmentFile=/etc/polyscalp/.env` (mode 600).
- **Disaster recovery: rotate trading EOA via Safe `swapOwner`** — positions + USDC stay put, signer changes. Document this now.
- **API key derivation**: derive once via `client.deriveApiKey()`, persist `(apiKey, secret, passphrase)` in Postgres encrypted at rest, reuse forever. Also persist the nonce — if you lose creds AND nonce, unrecoverable.

**Pre-signed order pool — DO NOT DO THIS on CLOB v2**. v2 commits a millisecond timestamp into the signed payload (replaced the v1 nonce that caused ghost fills). Pre-signing saves <3ms vs 100ms network — false economy. Same for pre-signed cancels.

**Order placement & cancel**
- **No replace endpoint.** Cancel + place only.
- **Batch cancel**: `DELETE /orders` (up to 15/call, 1k/10s burst). Single RTT.
- **Cancel-all by market**: kill-switch only (1,500 / 10min sustained).
- **User WS channel**: yes — pushes `PLACEMENT`, `UPDATE` (partial fill), `CANCELLATION`, trades. **Use this; do not REST-poll own orders** (saves 100ms/poll).

**Pre-flight monitoring (must-have before live)**
1. Sign-to-ack latency p50/p95/p99 per endpoint. Alert p99 > 500ms for 5min.
2. CLOB error rate by code (`INVALID_SIGNATURE`, `INSUFFICIENT_BALANCE`, `MARKET_NOT_FOUND`, 429).
3. WS connection state — uptime, last-message-age (RTDS silent >2s, user channel >30s = warn).
4. Reconcile drift count — alert any non-zero for >2 ticks.
5. USDC balance + open exposure (refreshed each reconcile).
6. Realized + unrealized PnL, intraday drawdown — warn -2%, halt -5% via halt.flag.
7. Fill latency (placed → first fill). Tail divergence = leading indicator of stale book.
8. Polygon RPC health (block lag, p99).
9. Idempotency UUID collision counter (must be flat 0).
10. halt.flag presence (loud + visible).

**OTEL on Bun**: `@opentelemetry/sdk-node` works on Bun ≥1.1. Local OpenObserve / SigNoz on the Hetzner box, OTLP/HTTP, zero egress. Sample 1.0 for trade events, 0.01 for hot-path book updates.

**Risk gotchas**
- **No MEV / sandwich on signed orders** — EIP-712 over TLS to matcher, not broadcast to public mempool. The on-chain `matchOrders` tx is from Polymarket's relayer, limit prices already constrain.
- **USDC = native Polygon PoS (`0x3c499c...`), NOT USDC.e and NOT zkEVM USDC.** Hardcode the contract address as a constant; assert balance reads against it. Bots have lost funds bridging to wrong network.
- **RPC failover**: rank 3 RPCs (Alchemy / QuickNode / dRPC), 1.5s timeout, `Promise.any` across 2 for reads. Mark sick on 3 consecutive timeouts; 60s cooldown.

---

## Open questions to resolve before P0

1. Microbench: viem vs ethers `signTypedData` on Bun (no public number). Target <3ms.
2. Microbench: Coinbase WS feed lag vs Chainlink Data Stream — is "our proxy" provably faster than the 55s avg book reprice on Polymarket?
3. Live RTDS sample (2 weeks): what fraction of fills happen in last 30s of window? Validate T-10s thesis empirically.
4. Map of competing maker wallets via RTDS — who already quotes deep edges on each asset/window-tier?
5. Window-DRAW historical rate — how often does Chainlink fail to deliver a valid report? (Pricing in tail risk.)
6. Per-market `minimum_order_size` and `minimum_tick_size` map for BTC/ETH/SOL/XRP × 5M/15M.

---

## Sources (curated)

Product / fees:
- https://docs.polymarket.com/quickstart/introduction/rate-limits
- https://docs.polymarket.com/developers/CLOB/orders/create-order
- https://docs.polymarket.com/developers/market-makers/maker-rebates-program
- https://help.polymarket.com/en/articles/14762452-polymarket-exchange-upgrade-april-28-2026
- https://www.cryptotimes.io/2026/02/14/polymarket-launches-5-minute-crypto-trades-via-chainlink/
- https://blockeden.xyz/forum/t/deep-dive-how-chainlink-data-streams-power-polymarkets-5-minute-settlement-oracle-architecture-for-high-frequency-prediction-markets/786
- https://medium.com/coinmonks/polymarket-just-changed-its-fees-heres-what-bot-traders-need-to-know-c11132e55d5c

Practitioner / open-source:
- https://news.polymarket.com/p/automated-market-making-on-polymarket (defiance_cr)
- https://tezlee.substack.com/p/i-cloned-a-polymarket-market-making (post-mortem)
- https://medium.com/@benjamin.bigdev/...db8efcb5c196 (5-min edges)
- https://www.quantvps.com/blog/polymarket-hft-traders-use-ai-arbitrage-mispricing
- https://medium.com/illumination/beyond-simple-arbitrage-4-polymarket-strategies-bots-actually-profit-from-in-2026-ddacc92c5b4f
- https://www.onchaintimes.com/a-chat-with-domer-the-1-trader-on-polymarket/
- https://github.com/warproxxx/poly-maker
- https://github.com/aulekator/Polymarket-BTC-15-Minute-Trading-Bot
- https://github.com/MrFadiAi/Polymarket-bot
- https://gist.github.com/Archetapp/7680adabc48f812a561ca79d73cbac69

Latency / infra:
- https://newyorkcityservers.com/blog/polymarket-server-location-latency-guide
- https://www.quantvps.com/blog/how-latency-impacts-polymarket-trading-performance
- https://docs.polymarket.com/developers/CLOB/websocket/user-channel
- https://docs.polymarket.com/developers/proxy-wallet
- https://medium.com/@gemQueenx/polymarket-upgrades-what-you-need-to-know-about-pusd-and-clob-v2-e91cbbfccb8a
- https://polygon.technology/blog/faster-finality-with-the-aalborg-upgrade-for-polygon-proof-of-stake-network
