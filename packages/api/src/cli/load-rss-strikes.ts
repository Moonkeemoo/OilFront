// RSS + Google News candidate strike detector for Russian oil infrastructure.
// No credentials required — uses public OSINT RSS feeds and the unauthenticated
// Google News RSS search endpoint. Inserts unverified candidates into
// infra_strikes as origin='rss', verified=FALSE until a curator confirms (see
// verify-strike.ts).
//
// Strategy:
//   1. Fetch a curated set of RU-war OSINT RSS feeds once each.
//   2. For facilities NOT already matched by the curated feeds this run,
//      query Google News RSS per-facility (paced, capped at MAX_GOOGLE_QUERIES).
//   3. Keyword-gate items (must mention strike/drone/fire/attack vocab).
//   4. Name-match each item to a facility (same normalization the gdelt loader
//      uses — names must appear in title + summary, case-insensitive).
//   5. Dedup against existing infra_strikes (±1 day) and insert survivors.
//
// Run:
//   bun run load-rss-strikes        # window = last 7 days
//   bun run load-rss-strikes 14     # widen the window (max 30 days)
import { sql } from "../db.ts";
import { logger } from "../log.ts";
import { parseRssItems, type RssItem } from "../rss-parse.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_AGENT = "oilfront/0.1 (research; non-commercial)";
const FETCH_TIMEOUT_MS = 15000;
const GOOGLE_QUERY_DELAY_MS = 1500; // pace Google News queries
const MAX_GOOGLE_QUERIES = 60; // cap total per-facility Google queries per run
const MAX_TIMESPAN_DAYS = 30;
const SUMMARY_MAX = 280;

/** Curated general OSINT RSS feeds — fetched once regardless of facility count. */
const CURATED_FEEDS: string[] = [
  "https://militarnyi.com/en/feed/",
  "https://kyivindependent.com/feed/",
  "https://euromaidanpress.com/feed/",
  "https://www.pravda.com.ua/eng/rss/",
];

/** Strike/fire/attack vocabulary — mirrors gdelt-match.ts STRIKE_KEYWORDS. */
const STRIKE_KEYWORDS = /\b(strike|drone|uav|attack|explosion|fire|hit|blaze|damaged|udar)\b|удар|атак|пожеж|пожар|бпла|дрон|вибух/i;
// Energy-infra + RU facility-class terms (added 2026-06-13) — mirrors
// gdelt-match.ts INFRA_KEYWORDS. Widens recall for the facility classes curated
// digging kept catching by hand: small oil depots, pipeline pumping stations
// (LPDS/NPS), seaports / marine terminals, gas processing plants (GPP). These
// ADD to the strike-signal vocabulary; an item still needs a strike OR infra
// phrase to pass the gate (isStrikeItem), so it does not match everything. Bare
// "refinery" is deliberately omitted (non-strike business news) — a real
// refinery strike already carries a strike-core word.
const INFRA_KEYWORDS =
  /\b(oil depot|fuel depot|tank farm|oil terminal|fuel terminal|sea ?port|pumping station|gas processing|fuel storage)\b|нефтебаз|нефтеперекачивающа|нефтеперекачивающе|лпдс|нпс|насосная станция|газоперерабатывающи|гпз|нефтеналивн|нефтетерминал|нефтепровод|топлив|резервуар|порт/i;

/** UAV vocabulary for weapon classification. */
const UAV_KEYWORDS = /drone|uav|бпла|дрон/i;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface FacilityRow {
  id: string;
  name: string;
  name_local: string | null;
}

/** A matched RSS item ready for DB insertion. */
interface RssCandidate {
  id: string;           // "rss-<infra_id>-<YYYYMMDD>"
  infra_id: string;
  occurred_on: string;  // YYYY-MM-DD
  weapon: "uav" | "unknown";
  severity: "unknown";
  summary: string;      // trimmed title + "[auto: RSS <domain>]"
  source_urls: string[];
  raw: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extract the bare domain (host) from a URL, e.g. "kyivindependent.com". */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Normalize a facility name for case-insensitive substring matching: lowercase
 * and collapse whitespace. Mirrors the approach in gdelt-match.ts buildGdeltQuery.
 */
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Does this RSS item text contain a strike keyword or an energy-infra phrase? */
function isStrikeItem(item: RssItem): boolean {
  const text = `${item.title} ${item.summary}`;
  return STRIKE_KEYWORDS.test(text) || INFRA_KEYWORDS.test(text);
}

/**
 * Does item title or summary mention this facility?
 * Checks both name and name_local (when present).
 */
function matchesFacility(item: RssItem, facility: FacilityRow): boolean {
  const text = normalizeName(`${item.title} ${item.summary}`);
  if (text.includes(normalizeName(facility.name))) return true;
  if (facility.name_local && text.includes(normalizeName(facility.name_local))) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/**
 * Fetch an RSS/Atom feed URL. Returns parsed items on success, null on total
 * failure. Per-feed errors warn and return null — never throw.
 */
async function fetchFeed(url: string): Promise<RssItem[] | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, text/xml, */*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ event: "rss_feed_error", url, status: res.status }, "RSS feed returned non-200");
      return null;
    }
    const text = await res.text();
    return parseRssItems(text);
  } catch (err) {
    logger.warn({ event: "rss_feed_exception", url, err: String(err) }, "RSS feed fetch threw");
    return null;
  }
}

/**
 * Fetch the Google News RSS search for one facility.
 * Paced externally by the caller; per-call errors warn and return null.
 */
async function fetchGoogleNewsFeed(facility: FacilityRow): Promise<RssItem[] | null> {
  const q = encodeURIComponent(`${facility.name} (strike OR drone OR fire)`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
  return fetchFeed(url);
}

// ---------------------------------------------------------------------------
// Column guard
// ---------------------------------------------------------------------------

async function ensureColumns(): Promise<void> {
  // Matches db/migrate-add-strike-origin.sql (idempotent).
  await sql!`ALTER TABLE infra_strikes ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'curated'`;
  await sql!`ALTER TABLE infra_strikes ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT TRUE`;
  await sql!`ALTER TABLE infra_strikes ADD COLUMN IF NOT EXISTS severity TEXT`;
}

// ---------------------------------------------------------------------------
// Matching + candidate building
// ---------------------------------------------------------------------------

/**
 * Try to build a candidate from an RSS item matched to a facility.
 * Returns null when the item is filtered out (no strike keyword, wrong date
 * window, no parseable date).
 */
function buildCandidate(item: RssItem, facility: FacilityRow, cutoffDate: string): RssCandidate | null {
  if (!isStrikeItem(item)) return null;
  if (!item.pubDate) return null; // unparseable date → skip
  if (item.pubDate < cutoffDate) return null; // outside the lookback window

  const title = item.title.trim().slice(0, SUMMARY_MAX);
  const domain = domainOf(item.link);
  const summary = `${title} [auto: RSS ${domain}]`;
  const weapon: "uav" | "unknown" = UAV_KEYWORDS.test(item.title) || UAV_KEYWORDS.test(item.summary) ? "uav" : "unknown";
  const occurred_on = item.pubDate;                 // YYYY-MM-DD
  const dateCompact = occurred_on.replaceAll("-", "");

  return {
    id: `rss-${facility.id}-${dateCompact}`,
    infra_id: facility.id,
    occurred_on,
    weapon,
    severity: "unknown",
    summary,
    source_urls: [item.link],
    raw: { title: item.title, summary: item.summary, link: item.link, pubDate: item.pubDate, feed_domain: domain },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!sql) {
    logger.error({ event: "no_db" }, "DATABASE_URL not set");
    process.exit(1);
  }

  const argDays = Number(process.argv[2] ?? "7");
  const timespanDays =
    Number.isFinite(argDays) && argDays >= 1 ? Math.min(Math.floor(argDays), MAX_TIMESPAN_DAYS) : 7;

  // Cutoff date: items older than this are ignored.
  const cutoffDate = new Date(Date.now() - timespanDays * 86400000).toISOString().slice(0, 10);

  logger.info(
    { event: "rss_start", curated_feeds: CURATED_FEEDS.length, timespan_days: timespanDays, cutoff_date: cutoffDate },
    "RSS strike loader starting",
  );

  await ensureColumns();

  const facilities = (await sql`
    SELECT id, name, name_local FROM oil_infra WHERE lat IS NOT NULL
  `) as unknown as FacilityRow[];

  logger.info({ event: "rss_facilities", count: facilities.length }, "facilities loaded");

  // Map: candidate id → RssCandidate (first match wins; later matches add source URLs).
  const candidates = new Map<string, RssCandidate>();
  const MAX_SOURCE_URLS = 3;

  // Track which facility IDs were matched by curated feeds (for Google fallback).
  const matchedByFacilityId = new Set<string>();

  // ---------------------------------------------------------------------------
  // Step 1: curated OSINT feeds (fetched once each)
  // ---------------------------------------------------------------------------
  let curatedItemsSeen = 0;
  let curatedMatched = 0;

  for (const feedUrl of CURATED_FEEDS) {
    const items = await fetchFeed(feedUrl);
    if (!items) {
      logger.warn({ event: "rss_feed_skipped", url: feedUrl }, "curated feed skipped (error)");
      continue;
    }
    logger.info({ event: "rss_feed_fetched", url: feedUrl, items: items.length }, "curated feed fetched");
    curatedItemsSeen += items.length;

    for (const item of items) {
      for (const facility of facilities) {
        if (!matchesFacility(item, facility)) continue;
        const candidate = buildCandidate(item, facility, cutoffDate);
        if (!candidate) continue;

        curatedMatched++;
        matchedByFacilityId.add(facility.id);

        const existing = candidates.get(candidate.id);
        if (existing) {
          if (
            existing.source_urls.length < MAX_SOURCE_URLS &&
            !existing.source_urls.includes(item.link)
          ) {
            existing.source_urls.push(item.link);
          }
        } else {
          candidates.set(candidate.id, candidate);
        }
      }
    }
  }

  logger.info(
    {
      event: "rss_curated_done",
      items_seen: curatedItemsSeen,
      matched: curatedMatched,
      candidates_so_far: candidates.size,
      facilities_matched: matchedByFacilityId.size,
    },
    "curated feeds processed",
  );

  // ---------------------------------------------------------------------------
  // Step 2: Google News RSS per-facility fallback (unmatched facilities only)
  // ---------------------------------------------------------------------------
  const unmatchedFacilities = facilities.filter((f) => !matchedByFacilityId.has(f.id));
  const googleBatch = unmatchedFacilities.slice(0, MAX_GOOGLE_QUERIES);
  if (unmatchedFacilities.length > MAX_GOOGLE_QUERIES) {
    logger.info(
      {
        event: "rss_google_capped",
        unmatched: unmatchedFacilities.length,
        cap: MAX_GOOGLE_QUERIES,
        skipped: unmatchedFacilities.length - MAX_GOOGLE_QUERIES,
      },
      `Google News queries capped at MAX_GOOGLE_QUERIES=${MAX_GOOGLE_QUERIES}`,
    );
  }

  let googleItemsSeen = 0;
  let googleMatched = 0;

  for (const [i, facility] of googleBatch.entries()) {
    if (i > 0) await sleep(GOOGLE_QUERY_DELAY_MS);

    const items = await fetchGoogleNewsFeed(facility);
    if (!items) continue;
    googleItemsSeen += items.length;

    for (const item of items) {
      if (!matchesFacility(item, facility)) continue;
      const candidate = buildCandidate(item, facility, cutoffDate);
      if (!candidate) continue;

      googleMatched++;
      matchedByFacilityId.add(facility.id);

      const existing = candidates.get(candidate.id);
      if (existing) {
        if (
          existing.source_urls.length < MAX_SOURCE_URLS &&
          !existing.source_urls.includes(item.link)
        ) {
          existing.source_urls.push(item.link);
        }
      } else {
        candidates.set(candidate.id, candidate);
      }
    }
  }

  logger.info(
    {
      event: "rss_google_done",
      facilities_queried: googleBatch.length,
      items_seen: googleItemsSeen,
      matched: googleMatched,
      candidates_so_far: candidates.size,
    },
    "Google News per-facility queries done",
  );

  // ---------------------------------------------------------------------------
  // Step 3: dedup against existing strikes and insert survivors
  // ---------------------------------------------------------------------------
  let inserted = 0;
  let skippedExisting = 0;

  for (const c of candidates.values()) {
    // Any existing strike for this facility within ±1 day wins (same rule as
    // load-gdelt-strikes). Curated, ACLED, GDELT, FIRMS-trigger, and previous
    // RSS rows all suppress this candidate.
    const existing = await sql`
      SELECT 1 FROM infra_strikes
      WHERE infra_id = ${c.infra_id}
        AND occurred_on BETWEEN (${c.occurred_on}::date - 1) AND (${c.occurred_on}::date + 1)
    `;
    if (existing.length > 0) {
      skippedExisting++;
      continue;
    }

    try {
      const res = await sql`
        INSERT INTO infra_strikes (
          id, infra_id, occurred_on, weapon, severity, summary, source_urls, raw, origin, verified
        ) VALUES (
          ${c.id}, ${c.infra_id}, ${c.occurred_on}, ${c.weapon}, ${c.severity}, ${c.summary},
          ${c.source_urls}::text[], ${sql.json(c.raw as Parameters<typeof sql.json>[0])},
          'rss', FALSE
        )
        ON CONFLICT (id) DO NOTHING
        -- candidates are immutable: curator promotes (verify-strike) or
        -- rejects (--reject); re-runs never overwrite an existing row.
      `;
      inserted += res.count;
    } catch (err) {
      logger.error({ event: "insert_error", err: String(err), id: c.id }, "rss strike insert failed");
    }
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  logger.info(
    {
      event: "rss_strikes_loaded",
      facilities_total: facilities.length,
      curated_feeds: CURATED_FEEDS.length,
      curated_items_seen: curatedItemsSeen,
      curated_matched: curatedMatched,
      google_facilities_queried: googleBatch.length,
      google_items_seen: googleItemsSeen,
      google_matched: googleMatched,
      candidates: candidates.size,
      inserted,
      skipped_existing: skippedExisting,
      timespan_days: timespanDays,
    },
    "RSS strike candidates loaded",
  );

  await sql.end({ timeout: 5 });
}

void main();
