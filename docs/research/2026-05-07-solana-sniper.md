# Solana memecoin sniper — research dump 2026-05-07

Source: 3 parallel research agents (web + GitHub + practitioner write-ups + live infra checks).
Pivot context: project moved off Polymarket 5-min binary scalping (see prior research dump same date) to Solana memecoin sniping after user reframed budget ($1k) and goal (asymmetric "ікси", not steady APY).

---

## Cold facts that change the strategy

1. **99.6% of pump.fun wallets never realize >$10k profit.** 49% of March 2026 traders red. Most "winners" are deployer-funded insiders, not retail snipers. [Cointelegraph / Dune], [GFM Review]
2. **Pre-bond / first-block sniping is rigged for retail.** >50% of tokens sniped in their creation block by deployer-funded "hub-and-spoke" wallet clusters with **87% win rate**. Solo bot can't compete in that race. [Bitget sniping study], [ChainCatcher]
3. **Only ~1.4% of pumpfun tokens graduate** (peak 2.01% March 2026, base 0.7–1.15%). Default to skepticism; the game is filtering 98.6% out cheaply. [Phemex], [Bitget]
4. **Pumpfun is back on top May 2026** — 91% of SOL token listings, ~23k new tokens/24h. LetsBONK collapsed (~3% share). Moonshot dead. Boop dead. [TheBlock]
5. **Pumpfun shipped a breaking program upgrade 2026-04-28** — buy instruction now 18 accounts incl. one of 8 BREAKING_FEE_RECIPIENTS. Any IDL or code from before this date is broken. [Allenhark]
6. **PumpSwap replaced Raydium for graduations (Mar 2025)** — pool created instantly at grad, no migration delay arb left. Trading fee 0.30% (0.20% LP + 0.05% protocol + 0.05% creator).
7. **Apr 28 2026: PUMP buyback dropped 100% → 50%** of revenue; $370M PUMP burned same day. Token holder dynamics changed.
8. **Jan 9 2026: pump.fun creator fee overhaul** — multi-wallet split (up to 10), tiered fees 0.05–0.95% market-cap dependent, transferable coin ownership.

---

## A. Edge math by stage

| Stage | Hit rate | Edge for solo $1k bot |
|---|---|---|
| Pre-bond, slot ≤100 | 87% WR for funded insiders | **Negative-EV** — we're racing funded clusters with private RPCs |
| Mid-curve (post-volume signal, pre-grad) | Untracked but only 1.4% reach grad | **Best risk-adjusted slot** with proper filters |
| Graduation snipe (PumpSwap migration window) | Mostly arbed away post-PumpSwap | Marginal — bots crowd the grad block |
| Post-grad consolidation (5–60 min after) | [unverified — no public quant study] | **Best for $1k retail**: less tip war, can size up, holder data legible |

**Decision: target mid-curve filtered + post-grad consolidation. Skip pre-bond races entirely.**

---

## B. The Moonshot war story (THE primary practitioner doc)

[Modern-Managed, Feb 2026 — `https://modern-managed.com/2026/02/building-a-solana-sniper-bot-in-3-days-an-ai-pair-programming-war-story/`]

Solo dev, AI-pair-programmed, 3-day build. Disclosed:
- Day 1: -44% with fast-but-unfiltered bot
- 14% of unfiltered positions returned **exactly 0 SOL** (rug tax)
- After adding 5 filters: WR 22% → 36%
- Final auto-sell ladder: **TP1 35% / TP2 100% / SL 15%**

**The 5 filters (steal verbatim as v1):**
1. Top-10 holder concentration ≤30%
2. ≥15 distinct holders
3. ≥$5k LP locked/burned
4. Market cap ≤$500k
5. Mint authority + freeze authority disabled

Plus the sixth filter cited universally (RugCheck-grade):
6. Bundler/sniper share in first 70 buyers below threshold (detect funded clusters)

Plus velocity confirmation:
7. 20–30s price sample before entry (skip vertical pumps that already exhausted)

---

## C. Open-source repos worth studying (port, don't depend)

| Repo | Lang | What to take |
|---|---|---|
| [chainstacklabs/pumpfun-bonkfun-bot](https://github.com/chainstacklabs/pumpfun-bonkfun-bot) | Python | **Top recommendation for filter logic.** No 3rd-party APIs, direct on-chain. PumpSwap-aware. Port to TS. |
| [D3AD-E/Solana-sniper-bot](https://github.com/D3AD-E/Solana-sniper-bot) | TS/Node | Best TS speed reference: 5ms tx build+send, 4-provider fanout |
| [1fge/pump-fun-sniper-bot/bonding-curve.go](https://github.com/1fge/pump-fun-sniper-bot/blob/main/bonding-curve.go) | Go | Canonical bonding-curve math — port directly |
| [moonbot777/Rust-GRPC-Pumpfun-Sniper-Bot](https://github.com/moonbot777/Rust-GRPC-Pumpfun-Sniper-Bot) | Rust | gRPC + Jito + MEV protection reference architecture |
| [pio-ne-er/Solana-pumpfun-sniper](https://github.com/pio-ne-er/Solana-pumpfun-sniper) | TS | Yellowstone gRPC + Jito, recently updated |
| [rubpy gist — bonding-curve state](https://gist.github.com/rubpy/6c57e9d12acd4b6ed84e9f205372631d) | — | Canonical fetch+price formula |
| [degenfrends/solana-rugchecker](https://github.com/degenfrends/solana-rugchecker) | — | Reference rug-check implementation |

**Universal red flags**: no tests, hardcoded RPC keys, READMEs shilling paid versions, abandoned demos meant to drive Telegram-DM sales. **Treat all as reference. Do not run their compiled binaries.**

---

## D. Stack — locked decisions

| Layer | Pick | Why |
|---|---|---|
| Runtime | **Bun** | Already in our stack; cold-start 8–15ms; ed25519/base58/Borsh bottom out in native libs anyway — language doesn't matter for those |
| Solana SDK | **`@solana/kit`** (web3.js v2) | GA'd 2025, ~10× faster keypair/sign/verify, ~200ms faster confirmation in Helius tests, tree-shakeable |
| Pumpfun client | **Codama-generated** from post-2026-04-28 IDL OR hand-rolled instructions | `@coral-xyz/anchor` does NOT support Kit/v2 — don't use it |
| Bundles / MEV | **`jito-ts`** + Helius Sender (auto-fans tx to Jito + staked-RPC + validators) | jito-ts is official, last touched Nov 2025, runs on Bun via Node-compat |
| RPC | **Helius Developer $49/mo** (Enhanced WebSockets + Sender) | Skip $499 Business gRPC tier until proven edge |
| Anti-rug | **RugCheck.xyz API** + Helius DAS for direct authority checks + GoPlus as second opinion | RugCheck-native to Solana, holder distribution + LP locks + insider clustering |
| DB | **PostgreSQL + TimescaleDB** | Already in stack; needed for tax records anyway |
| Hosting | **Hetzner CPX22 Helsinki** (stay) | HEL→Helius/QuickNode FRA PoP ~25–35ms; sufficient for filter-based sniping |
| Wallet | **Single hot keypair**, env file mode 600, systemd-hardened, 5-min sweep to cold | Squads/MPC overkill at $1k; latency cost makes them unsuitable for snipe path anyway |

**What we're NOT doing in v1 (deliberately):**
- ❌ gRPC Yellowstone ($499 Business tier or self-host) — only justified if first-block strategy
- ❌ Self-hosted Solana RPC ($240–1200/mo opex)
- ❌ Move to Frankfurt — only if first-block becomes the play
- ❌ Multi-wallet rotation — overhead without payoff at this scale
- ❌ Squads multisig — relevant ≥$10–25k float
- ❌ Racing tip auctions on viral launches (medians 0.5–1.2 SOL, tail 3–4 SOL — that's our entire bankroll)

---

## E. Cost reality

| Item | Monthly |
|---|---|
| Hetzner CPX22 HEL | $8 |
| Helius Developer | $49 |
| **Fixed** | **$57** |
| Operational SOL float (gas + reserve) | 0.3–0.5 SOL one-time (~$60–100 at $200/SOL) |
| Jito tips @ 5 trades/day × 0.005 SOL avg | ~$150 |
| Jito tips @ 20 trades/day × 0.005 SOL avg | ~$600 |

**Realistic monthly burn before any trade revenue: $200–700.** Tips dominate fixed costs by 3–10×.

Break-even at 5 trades/day: $207/mo total burn → need ~$10/trade net average → 1% gain on $1k bankroll per trade. Doable IFF win-rate × avg-win > losses.

**The bot is a tip-pump until it proves edge.** Strongly recommend a 2–4 week paper-trade phase before turning on live tips.

---

## F. Risk gates (locked, port from Moonshot + adapt)

- **Max position per snipe: 5% of bankroll** ($50 on $1k initial)
- **Daily drawdown halt: -15%** (write halt.flag, exit gracefully, manual review required to resume)
- **Heat circuit breaker: cut size 20% per consecutive loss; halt on win-rate <15% over rolling 20 trades**
- **Auto-sell ladder: TP1 sells 50% at +35%, TP2 sells remaining at +100%, SL hard-exits at -15%**
- **Per-day tip budget: 0.05 SOL/day cap** (gate the bot's own spending, not just position sizing)
- **Skip if any rug-check flag fails** — no override, no manual bypass

---

## G. Ukraine tax frame (resident)

- **2026 framework**: 18% PIT + 5% military levy = **23% effective on net realized gains**, declared by May 1 in Electronic Cabinet annual return.
- **Crypto-to-crypto trades currently proposed as non-taxable event** — only fiat off-ramp is taxable on net. This is favorable: SOL ↔ memecoin swaps don't trigger tax events under current draft.
- 10% amnesty rate for pre-law assets sold within 2026.
- **Records bot must capture from day 1 (every trade)**: timestamp, signature, mint in/out, amounts (raw token + decimals), USD/UAH price at execution (Helius tx-level price or CoinGecko snapshot), tx fee + Jito tip, wallet.
- **No Ukraine-specific tooling**; Koinly/CoinTracking ingest Solana but pumpfun bonding-curve trades require manual reconciliation. Build the schema right from day 1 to avoid that pain.

---

## H. The honest take on $1k → ікси

- **Aggregate: 0.4% of pumpfun wallets realize >$10k.** That's the base rate.
- The plausible alpha left for solo retail is **filtered post-bond / post-grad consolidation entries** with strong holder-distribution + dev-history filters where you're not racing funded insiders.
- **Reproducing the GMGN feature set as a private bot is feasible** — RugCheck + Helius DAS + wallet-watch via WebSocket. The 1% per-trade saved vs GMGN compounds on $1k bankroll.
- **Realistic lottery 10×: yes** — single-trade lottery on a graduated token is achievable with the right filters.
- **Realistic 10× of bankroll: low base rate.** Plan position sizing assuming each individual bet is a ~5% lottery ticket and bankroll survives streaks.
- **Single biggest determinant of success at this scale = filter quality, not latency.** That's what Moonshot's data proves and what every credible practitioner write-up agrees on.

---

## Sources (consolidated)

Ecosystem:
- https://www.theblock.co/post/365737/pump-fun-reclaims-letsbonk
- https://www.tradingview.com/news/cryptonews:0779cffe8094b
- https://www.bitget.com/news/detail/12560605208670
- https://www.bitget.com/news/detail/12560604803448 (insider sniping study)
- https://www.chaincatcher.com/en/article/2185070
- https://phemex.com/news/article/pumpfun-meme-coin-graduation-rate-hits-201-highest-since-july-2025-66961
- https://www.coindesk.com/markets/2026/04/29/pump-fun-burns-36-of-pump-supply-in-usd370-million-wipe-locks-50-revenue-into-ongoing-buybacks
- https://pump.fun/docs/fees
- https://www.gfmreview.com/crypto/pump-fun-data-shows-49-of-march-traders-in-the-red-as-platform-locks-fees
- https://cointelegraph.com/news/pump-fun-crypto-traders-majority-do-not-realize-profits-dune-data
- https://www.theblock.co/post/384975/pump-fun-overhauls-creator-fees-token-launches-highest-daily-september
- https://allenhark.com/blog/pumpfun-create-instruction-discriminator
- https://www.kaggle.com/datasets/dremovd/pump-fun-graduation-february-2025
- https://dune.com/jondar/pumpfun

Practitioner / OSS:
- https://modern-managed.com/2026/02/building-a-solana-sniper-bot-in-3-days-an-ai-pair-programming-war-story/ (THE doc)
- https://github.com/chainstacklabs/pumpfun-bonkfun-bot
- https://github.com/D3AD-E/Solana-sniper-bot
- https://github.com/1fge/pump-fun-sniper-bot
- https://github.com/moonbot777/Rust-GRPC-Pumpfun-Sniper-Bot
- https://github.com/pio-ne-er/Solana-pumpfun-sniper
- https://gist.github.com/rubpy/6c57e9d12acd4b6ed84e9f205372631d
- https://github.com/degenfrends/solana-rugchecker
- https://yavorovych.medium.com/how-to-build-a-solana-sniper-bot-and-why-90-fail-the-infra-hack-that-wins-0cbfbbf76a8d
- https://medium.com/@buildwithbhavya/the-math-behind-pump-fun-b58fdb30ed77
- https://rugcheck.xyz/

Infra:
- https://www.helius.dev/pricing
- https://www.helius.dev/docs/grpc
- https://www.helius.dev/blog/laserstream-websockets
- https://www.helius.dev/sender
- https://www.helius.dev/blog/priority-fees-understanding-solanas-transaction-fee-mechanics
- https://github.com/jito-labs/jito-ts
- https://github.com/anza-xyz/kit
- https://www.anza.xyz/blog/solana-web3-js-2-release
- https://blog.triton.one/intro-to-the-new-solana-kit-formerly-web3-js-2/
- https://blog.quicknode.com/solana-mev-economics-jito-bundles-liquid-staking-guide/
- https://medium.com/@ramasheshan8/jito-tips-the-underground-highway-of-solana-transactions-d839bd74ad9d
- https://dev.to/gerus_team/mev-protection-on-solana-in-2026-jito-bundles-astralane-and-what-actually-works-3gbc

Tax:
- https://blog.mexc.com/crypto-tax/ukraine-crypto-tax-system-rates-reporting-rules/
- https://itukraine.org.ua/en/new-rules-for-cryptocurrency-how-virtual-assets-will-be-taxed-in-ukraine/
- https://www.ey.com/en_ua/it-tax-law-digest/the-draft-law-on-the-taxation-of-income-from-virtual-assets-approved-by-the-parliamentary-committee
