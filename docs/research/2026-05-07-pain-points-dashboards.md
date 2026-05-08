# Dashboard / data-product pain points — research dump 2026-05-07

Source: 3 parallel research agents (consumer/prosumer, B2B/professional, specialty/niche+UA).
Filter: each idea must show evidence of (1) real pain via cited URL/thread, (2) willingness to pay via competitor pricing or revenue, (3) accessible data source, (4) realistic for solo + Claude-Code build.

This doc is the artifact. The CLAUDE.md / synthesis lives in conversation.

---

## A. Consumer / prosumer (7 ideas)

### A1. Post-Trakt TV / Movie / Anime tracker з lifetime analytics
- **Дані**: Trakt API (free read), TMDB API, AniList GraphQL, Plex/Jellyfin webhooks, Netflix viewing history CSV, IMDb ratings export
- **Конкуренти**: Trakt VIP $60/yr (price doubled Feb 2025), Simkl VIP $25/yr, Letterboxd Pro $24/yr
- **Болить**: Trakt підняв VIP з $30 на $60 у Feb 2025 + обмежив free до 100 watchlist items. Backlash "low-key predatory". https://alternativeto.net/news/2025/2/trakt-tv-has-set-stricter-limits-for-free-users-and-raised-vip-subscription-prices-by-100-/ ; https://forums.trakt.tv/t/what-is-the-point-of-trakt-if-non-vip-has-no-tracking/87659
- **Платять**: Trakt: "rely entirely on VIP memberships". Letterboxd 17M+ users, Pro $24/yr.
- **Edge**: import Trakt CSV → красивий dashboard за $3-5/міс з фокусом на 10-20 років watch history, genre drift, actor co-occurrence
- **Cynical**: API-залежно, Trakt може закрити non-VIP API. Cap: $2-5k MRR

### A2. Multi-broker net-worth + tax-lot dashboard для EU/UA-investor
- **Дані**: Plaid (US), Tink/Salt Edge/TrueLayer (EU PSD2), CSV/PDF імпорт від IBKR, Trading 212, Wise, Revolut, Trade Republic, eToro
- **Конкуренти**: Monarch Money $14.99/міс, Copilot Money $8.99/міс (US-only), Kubera $150/yr, Snowball Analytics €7.99/міс
- **Болить**: EU/UA користувачі не покриті Monarch/Copilot; Plaid не покриває багато EU банків. https://www.openbankingtracker.com/api-aggregators/plaid/alternatives
- **Платять**: Monarch $12.6M revenue 2025, $75M Series B at $850M val. https://getlatka.com/companies/monarchmoney.com
- **Edge**: multi-currency / multi-jurisdiction / EU-aware; UA tax lot calc під 2026 закон
- **Cynical**: PSD2 connections ламаються, retention в personal finance — пекло (Mint мав 25M і помер). Cap $500-2k MRR

### A3. Lifetime audiophile listening (Spotify + Apple + Tidal + Last.fm + Plex)
- **Дані**: Spotify Extended History export, Apple Music export, Last.fm API, ListenBrainz, Tidal export, MusicBrainz
- **Конкуренти**: Stats.fm Plus $29/yr, rigtch.fm, volt.fm, Last.fm Pro $3/міс
- **Болить**: cross-service migration pain (Spotify→Tidal→Apple). Custom Tableau setups публікуються — signal of demand. https://limyansky.com/Exploring-My-Lifetime-Spotify-History/
- **Платять**: Stats.fm Plus існує. Last.fm Pro 18 років.
- **Edge**: 20-year horizon analytics + cross-service merge через MusicBrainz IDs. Spotify Wrapped — лише 12 місяців.
- **Cynical**: niche-of-a-niche, audiophiles платять <$30/yr. Cap $300-1.5k MRR

### A4. Endurance athlete training-load (cross-platform, не Strava-залежний)
- **Дані**: Garmin Connect API (OAuth via Developer Program), COROS API, .FIT files, Strava (rate-limited), Whoop, Oura
- **Конкуренти**: TrainingPeaks $19.99/міс, Intervals.icu (free + Patreon, ~160k athletes), Runalyze €4.99/міс
- **Болить**: Strava закрило Year-in-Sport за paywall 2024. Intervals.icu впирається в Strava rate limits. https://road.cc/content/news/strava-year-sport-now-only-subscribers-317425 ; https://www.trainerroad.com/forum/t/intervals-icu-hitting-strava-rate-limits-big-consequences-for-tr-users/81273
- **Платять**: TrainingPeaks profitable, hundreds of thousands paying. Intervals.icu solo dev живе на donations.
- **Edge**: modern UI + multi-sport (climbing, ski touring, ultra-running) де incumbents слабкі
- **Cynical**: Intervals.icu — solo dev 5 років вже там. Athletes platform-loyal. Garmin approval bottleneck. Cap $1-3k MRR

### A5. Frequent-flyer / loyalty-points lifetime для EU travelers
- **Дані**: AwardWallet API/scrape, IMAP email parsing, airline CSV exports
- **Конкуренти**: AwardWallet $49.99/yr (815k users), TripIt Pro $49/yr
- **Болить**: AA, Delta активно блокують AwardWallet. UI 2008-style. https://onemileatatime.com/guides/awardwallet/
- **Платять**: AwardWallet ~$2.5M ARR ballpark (50k×$49.99)
- **Edge**: modern UI + email-parser passive ingestion + EU programs + redemption value calc
- **Cynical**: TAM крихітний (50-200k EU points hackers), 20-year incumbent lock-in. Cap $200-1k MRR

### A6. Reading lifetime (Kindle + Goodreads + StoryGraph + Audible + Libby)
- **Дані**: Kindle highlights scrape, Goodreads CSV, StoryGraph CSV, Audible scrape, Libby, Open Library API
- **Конкуренти**: StoryGraph Plus $4.99/міс, Bookly Pro $4.99/міс, Readwise $9.99/міс
- **Болить**: Goodreads stagnant (Amazon ignores). https://www.creativerly.com/there-is-still-the-need-for-a-better-goodreads-alternative/
- **Платять**: StoryGraph 2M+ users, Readwise $1M+ ARR [unverified]
- **Edge**: audio + ebook + physical unification + Kindle/Audible highlights в одному knowledge base
- **Cynical**: StoryGraph well-funded growing. Goodreads має inertia. Cap $300-1k MRR

### A7. Quantified-self aggregator (Health + Oura + Whoop + Garmin + CGM + Bearable)
- **Дані**: Apple Health XML export, Oura API v2, Whoop API (partner approval), Garmin Health, Withings, Dexcom Linkup, Bearable export
- **Конкуренти**: Exist.io $6/міс, Bearable $34.99/yr, Heads Up Health $13.99/міс
- **Болить**: Bearable "Expose API" — top user request. https://changemap.co/bearable-/bearable-roadmap/task/4105-expose-api/ ; https://forum.quantifiedself.com/t/personal-dashboards-for-self-tracking-data/8202
- **Платять**: Exist.io solo-ish 10+ років, $57/yr. Whoop/Oura millions × $200-300/yr.
- **Edge**: multi-year correlation engine (HRV vs alcohol with 36h lag, sleep efficiency vs season) + bring-your-own-data
- **Cynical**: Exist.io 10 років не unicorn — це cap. Apple душить third-party Health. Cap $500-2.5k MRR

---

## B. B2B / professional (7 ideas)

### B1. LLM Cost & Spend Allocation для multi-model teams (рекомендація #1 у B2B)
- **Дані**: OpenAI Usage API, Anthropic Admin/Usage API, OpenRouter activity export, Vertex billing → BigQuery, Bedrock CloudWatch + Cost Explorer
- **Конкуренти**: Helicone $25-99, Langfuse Cloud $29-199 (acquired by ClickHouse Jan 2026), LangSmith $39/seat
- **Болить**: OpenRouter "easy to overspend"; pricing data not summarized in dashboard. https://github.com/lobehub/lobehub/issues/13785
- **Платять**: $25-199/mo bracket validated. ACV $300-2,400.
- **Edge**: Helicone/Langfuse — proxies, потребують code instrumentation. Solo CFO who got $40k Anthropic bill хоче billing-API-only rollup, без SDK install.
- **Cynical**: ClickHouse commodify це. Buyer = finance, не dev → breaks bottom-up motion.

### B2. PR Review Bottleneck Dashboard для IC engineers + tech leads
- **Дані**: GitHub REST + GraphQL OAuth (5,000 req/hr authenticated)
- **Конкуренти**: LinearB (enterprise sales), Swarmia $19/contributor, Jellyfish $100k+/yr
- **Болить**: GitHub native не показує review turnaround. https://github.com/orgs/community/discussions/13037 ; LinearB "clones repos, security concerns". https://www.gitrecap.com/blog/best-dora-metrics-tools
- **Платять**: $19 × 10 contributors = $190/mo per team. Bottom-up sale to tech lead with credit card.
- **Edge**: skip DORA-buzzwords. Slack/email weekly "your team's review health". Read-only OAuth — no clones.
- **Cynical**: Graphite $52M Series B даєіс це безкоштовно. GitHub може ship native. Cap $5-15k MRR.

### B3. PagerDuty Refugee — On-Call Cost & Schedule Audit для SMB
- **Дані**: PagerDuty REST API, Opsgenie, Better Stack, Slack, Google Calendar
- **Конкуренти**: PagerDuty $21-41/seat, All Quiet "10x cheaper", Squadcast $9/user
- **Болить**: "Per-user cost is the primary blocker, every new hire becomes a pricing conversation". https://www.onpage.com/pagerduty-pricing-is-it-worth-it-and-whats-the-alternative/
- **Платять**: $99/mo audit pays itself ("cut 3 unused $41 seats = $1,476/yr").
- **Edge**: не replace PagerDuty, а sit on top — хто burning out, schedule fairness, alert noise per service.
- **Cynical**: ToS-fragile, churn at migration moment. Narrow wedge.

### B4. Shopify Profit & Ad-Spend Reconciliation для solo operators (<$1M GMV)
- **Дані**: Shopify Admin API OAuth, Meta Marketing API, Google Ads, TikTok Ads, Klaviyo. Shopify App Store distribution.
- **Конкуренти**: Lifetimely (acquired by AMP), BeProfit, TrueProfit. $30-200/mo.
- **Болить**: "Subscription costs stacking up — Shopify $30 plus apps reaching $1,000+ cumulative". https://www.indiehackers.com/post/e-commerce/shopify-just-gave-us-15-viable-shopify-app-ideas-that-we-can-build-WpNiv16g5YP4JCO9lrwi
- **Платять**: $30-200/mo established band. App Store solves billing/taxes (Ukraine-payment-friction solved!).
- **Edge**: dropship/POD niche where COGS variable per-order, not static per-SKU. Або TikTok Shop reconciliation.
- **Cynical**: App Store discoverability brutal, Triple Whale $118M funded, Shopify може ship native profit analytics і вбити сегмент.

### B5. Cold Email Deliverability Health Dashboard
- **Дані**: Google Postmaster API, Microsoft SNDS, MX/SPF/DKIM/DMARC scanning, Smartlead/Instantly export
- **Конкуренти**: MailReach, Warmup Inbox $15+, GlockApps, Smartlead $39-174
- **Болить**: Mailforge tested 21 cold-email tools, only 3 actually kept emails in inbox. https://www.mailforge.ai/blog/cold-email-infrastructure-tools
- **Платять**: $15-99/mo bracket. Operators run 50+ domains, pay per-domain visibility.
- **Edge**: pure deliverability dashboard — НЕ warmup, НЕ sending. "Are my 47 domains healthy this morning?"
- **Cynical**: dirty buyers (spammers), Stripe scrutiny, vertical може collapse якщо Google/MS tighten 2026. Bet against the wind.

### B6. Federal Docket + State Court Monitor для solo / small-firm lawyers
- **Дані**: PACER ($0.10/page), CourtListener/RECAP (free API), state court RSS, scraping
- **Конкуренти**: Docket Alarm, PacerMonitor, CourtAlert ~$2.75/lookup or $12/mo per case
- **Болить**: PACER fees systemic complaint. https://fixthecourt.com/freepacer/ ; https://www.docketalarm.com/blog/2024/9/27/Managing-Your-PACER-Fees-More-Effectively...
- **Платять**: solo attorneys $50-300/mo for case-monitoring. ROI direct.
- **Edge**: RECAP first, PACER fallback only when needed, з running PACER-fee meter (transparency).
- **Cynical**: Lawyers slow buyers, suspicious of foreign vendors, demand US-business-hours support. "Solo Ukrainian" raises malpractice red flags.

### B7. AWS / GCP Cost Anomaly + Tag Hygiene для SMB / AI startups
- **Дані**: AWS Cost Explorer API ($0.01/req), CUR to S3, GCP Billing → BigQuery, read-only IAM
- **Конкуренти**: Vantage $30/mo, CloudZero/nOps/Finout enterprise
- **Болить**: "$10k/month AWS bills that should be $1-2k". https://dev.to/hoangleitvn/12-hidden-aws-costs-that-silently-drain-your-budget-46f2
- **Платять**: ROI direct ("found you $4k/mo waste, give us $99/mo")
- **Edge**: AI-startup angle — GPU spot lifecycle, Bedrock per-prompt costs, idle SageMaker endpoints
- **Cynical**: Vantage $150M, CloudZero $100M+, AWS keeps shipping native tooling. Best as feature inside B1.

---

## C. Specialty / niche / UA-context (7 ideas)

### C1. Sanctions-Aware Counterparty Screening для EU SMB exporters
- **Дані**: OpenSanctions API (pay-as-you-go), EU Consolidated, UK OFSI, OFAC SDN, YouControl/Opendatabot, EU VIES VAT
- **Конкуренти**: ComplyAdvantage / World-Check enterprise $20K+/yr; sanctions.io $99-999/mo
- **Болить**: EU Directive 2024/1126 forced harmonised sanctions enforcement by May 2025, dropping criminal exposure on SMB exporters. https://eu-sanctions-compliance-helpdesk.europa.eu/index_en
- **Платять**: $99-500/mo per SMB seat hittable. Target German Mittelstand €5-50M.
- **Edge**: screening + ongoing monitoring + audit-trail PDF при €149/mo з EU data residency.
- **Cynical**: OpenSanctions itself — many built on top. False-positive tuning unglamorous. Compliance = year-long sales cycle.

### C2. Russian Shadow-Fleet Ship Tracker (EU buyers)
- **Дані**: AISStream.io (free WebSocket), MarineTraffic API, Equasis, OFAC SDN vessels, EU/UK OFSI, flag-of-convenience registries
- **Конкуренти**: Windward $50K+/yr, Kpler enterprise, Pole Star, Lloyd's List. Bottom: KSE Russia Oil Tracker (free).
- **Болить**: Shadow fleet ~271 Tier-1 tankers, ~6% global capacity. Compliance teams need vessel-level scoring legacy tools price out. https://www.spglobal.com/market-intelligence/.../shadow-fleet-formation-operation
- **Платять**: $200-500/mo per analyst seat normal in maritime intel.
- **Edge**: UA credibility + UA labour cost. "Shadow-Fleet Daily" + AIS-gap detection + ownership-shell-graph at $299/mo.
- **Cynical**: Windward will out-engineer on AIS. Real moat = curated incident reports = caps at ~100 customers. If peace deal lands, TAM halves overnight. Cap $20-40k MRR lifestyle.

### C3. Ukraine Reconstruction Pipeline Intel для Western contractors
- **Дані**: DREAM platform (https://dream.gov.ua/en) — open API, 12,596 projects $42.5B; Prozorro tender API; Agency for Restoration; State Treasury; EBRD/EIB/World Bank URTF; YouControl
- **Конкуренти**: Excel + Telegram channel. DREAM is gov UX, not sales-intel. KSE/CES publish PDFs.
- **Болить**: Western EPC contractors / equipment vendors can't read UA Prozorro, miss tenders, can't price counterparty risk. https://www.rusi.org/explore-our-research/publications/commentary/funding-ukraines-reconstruction-who-will-be-accountable-integrity
- **Платять**: "GovWin for Ukraine" at €299-999/mo. GovWin IQ itself $5-25k/yr.
- **Edge**: UA-language data + Western buyer UI + sanctions/PEP overlay on contractors.
- **Cynical**: $$ deployment slower than every conference deck claims. Buyers won't pay until they win. Cap: few hundred firms total.

### C4. CSRD/VSME Reporting для sub-1000-employee companies
- **Дані**: EFRAG VSME XBRL Taxonomy (free Digital Template May 2025), GHG Protocol factors, EU ETS prices via EEX, national emission factors (DEFRA, Umweltbundesamt)
- **Конкуренти**: Novisto €50K/yr, Greenstone £18K/yr, Coolset, Sweep, Persefoni — over-built for VSME tier
- **Болить**: Dec 2025 Omnibus I narrowed mandatory CSRD до 1000+/€450M, але pushed everyone smaller into "voluntary" VSME під bank/customer pressure. https://www.coolset.com/academy/best-esg-reporting-software-tools
- **Платять**: €99-399/mo gap. Десятки тисяч EU SMEs in tier.
- **Edge**: VSME-only, EU-hosted, 5 languages. Pre-fill from accounting (Datev/sage exports).
- **Cynical**: ESG software graveyard — 100+ tools, brutal CAC, audit firms (KPMG/Deloitte) bundle reporting and crowd out. SMEs do bare minimum в Excel.

### C5. Voice-AI Agent Observability (Vapi/Retell)
- **Дані**: Vapi/Retell webhooks, Twilio call records, OpenAI/Deepgram/ElevenLabs usage. Customer's own keys.
- **Конкуренти**: Cekura, LangSmith ($39/seat), Helicone ($25), Langfuse (50K events free) — none voice-native
- **Болить**: Vapi 5-invoice fee structure mocked, "support non-existent and docs extremely poor". https://www.dialora.ai/blog/vapi-ai-reviews ; https://www.retellai.com/blog/vapi-ai-review
- **Платять**: $50-300/mo per voice-agent project. Voice-AI startups well-funded 2025-26.
- **Edge**: audio-waveform-aware traces (TTS-stutter, ASR-hallucination, barge-in latency), LLM-judge per call.
- **Cynical**: Every YC W25/S25 cohort startup. Vapi/Retell will ship native analytics. Self-hosted Langfuse 80% good free.

### C6. Battery-Storage Arbitrage Optimiser для Octopus Agile / Tibber prosumers
- **Дані**: Octopus Agile API (free 30-min wholesale), Tibber GraphQL (free), ENTSO-E Transparency, Solcast (solar forecast), battery vendors (GivEnergy, Solax, Tesla via tessie/unofficial)
- **Конкуренти**: Predbat (open-source HA addon, free, very technical), GivEnergy Eco Mode, agilebuddy.uk
- **Болить**: Need Home Assistant + Predbat + node-red just to do arbitrage; non-developers can't replicate. https://forum.aqara.com/t/energy-arbitrage-automating-savings-with-tibber-and-evcc/229414
- **Платять**: £5-15/mo per household. UK Agile users 250k+ households. 0.5% conversion meaningful.
- **Edge**: hosted, no HA required, push notifs "charge tonight 02:30-04:30", annual savings PDF.
- **Cynical**: Hardware vendor APIs break constantly, Tesla API a nightmare. Octopus може ship native.

### C7. Amazon FBA Reimbursement Auditor (post-March-2025 regime)
- **Дані**: Amazon SP-API (free for sellers, OAuth, per-seller token); FBA Inventory/Shipments/Returns/Adjustments reports
- **Конкуренти**: GETIDA (15-25% commission), Seller Investigators (25%), RefundPros (25%), Carbon6
- **Болить**: Amazon Mar 31 2025 rule shifted reimbursement to manufacturing-cost basis, slashing payouts and breaking GETIDA economic model. https://www.bellavix.com/amazons-2025-reimbursement-policy-overhaul-what-sellers-need-to-know-and-how-to-respond/
- **Платять**: $49-199/mo flat fee beats 25% commission for any seller >$30K/mo revenue.
- **Edge**: flat fee + manufacturing-cost cost-basis manager + auto-formatted dispute templates. UA dev cost = sustainable at $49 entry.
- **Cynical**: Amazon will keep automating reimbursement detection eroding value over 3 years. Carbon6 well-funded shipping into gap. 2-4 year window, not forever business.

---

## Cross-cutting themes

**Patterns across 21 ideas:**

1. **AI-era niches that didn't exist 18 months ago** (B1 LLM cost, C5 voice obs) — best WTP per seat, but most crowded and incumbents move fast.
2. **Platform-refugee plays** — established tools alienating users (Trakt+100%, PagerDuty $41/seat, Strava paywall, Goodreads stagnation, GETIDA model break). Predictable trigger pattern: incumbent raises price → backlash → switching window.
3. **Multi-vendor unification** — siloed data is universal pain (multi-broker A2, wearables A7, listening A3, reading A6, training A4). All have proven WTP but retention and PSD2-fragility kill 50% of attempts.
4. **Sanctions / compliance** (C1 EU sanctions, C2 shadow fleet, C3 reconstruction) — UA context is genuine edge. EU Directive 2024/1126 + reconstruction $$ are once-in-decade structural triggers.
5. **Niche professional segments paying $$$** (B6 lawyers, C7 FBA sellers, C1 SMB compliance) — high WTP per seat but B2B sales motion is brutal for solo Ukrainian.

**Realistic ceilings** (compiled from agent verdicts):
- Consumer: $300-3k MRR most ideas
- B2B: $5-25k MRR before incumbent ships free
- Specialty: $10-50k MRR if niche stays niche

**Best pain × payment ratio** (across all 21):
1. **B1 LLM Cost rollup** — billing-API only, $25-199 validated band, AI-era timing
2. **C1 Sanctions screening for SMB** — EU Directive 2024/1126 enforcement triggers structural demand
3. **C7 Amazon FBA Reimbursement** — Mar 2025 rule change creates clean window
4. **A1 Post-Trakt** — clearest immediate pain signal, low technical risk
5. **C3 UA Reconstruction Pipeline** — UA context goldmine if you can stomach 12-month sales cycle

**Worst pain × payment ratio (skip):**
- A5 Frequent-flyer (TAM tiny + 20-yr incumbent)
- A6 Reading lifetime (StoryGraph won)
- B7 AWS Cost Anomaly (incumbents too capitalized)
- C4 CSRD/VSME (audit firm graveyard)
