// Pulls candidate strike events on Russian oil facilities from the GDELT DOC
// 2.0 news API (no auth required) and inserts them into infra_strikes as
// origin='gdelt', verified=FALSE until a curator confirms (see
// verify-strike.ts). Article → candidate mapping is pure logic in
// ../gdelt-match.ts (unit-tested, no network).
//
// Strategy: one name-based query per point facility in oil_infra (name +
// name_local OR-grouped with strike vocabulary), title-filtered, collapsed to
// one candidate per facility per day. Any existing infra_strikes row for the
// same facility within ±1 day (curated / ACLED / earlier GDELT) wins — the
// candidate is then skipped, not merged.
//
// Run:
//   bun run load-gdelt-strikes        # window = last 7 days
//   bun run load-gdelt-strikes 14     # widen the window (max 30 days)
import { sql } from "../db.ts";
import { logger } from "../log.ts";
import {
  buildGdeltQuery,
  isStrikeArticle,
  mapGdeltArticle,
  type GdeltArticle,
  type GdeltCandidate,
} from "../gdelt-match.ts";

const GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const USER_AGENT = "oilfront/0.1 (research; non-commercial)";
// GDELT throttles per IP aggressively (429 + plain-text notice) and the ban
// window stretches well past the nominal "one request every 5 seconds" once
// tripped — verified live 2026-06-11 (a tripped IP kept 429ing for 20+ min).
// Generous spacing + Retry-After honoring + the consecutive-429 circuit
// breaker below keep a 69-facility weekly run polite and fail-fast.
const REQUEST_DELAY_MS = 7500;
const RETRY_BACKOFF_MS = 30000;
const THROTTLE_ABORT_AFTER = 5; // consecutive both-attempts-429 facilities
const FETCH_TIMEOUT_MS = 15000;
const MAX_TIMESPAN_DAYS = 30;
const MAX_SOURCE_URLS = 3;

interface FacilityRow {
  id: string;
  name: string;
  name_local: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Single fetch entry point — same hardening as server.ts handleVesselNews:
// non-200 and non-JSON (GDELT returns plain-text rate-limit notices and HTML
// error pages) are warned and treated as an empty article list so one bad
// facility never aborts a run. 429/timeout gets one retry after a backoff
// (honoring Retry-After when GDELT sends it). Returns null when BOTH attempts
// were throttled — the caller's circuit breaker counts those.
async function fetchGdeltArticles(facility: FacilityRow, timespanDays: number): Promise<GdeltArticle[] | null> {
  const query = buildGdeltQuery(facility.name, facility.name_local);
  const params = new URLSearchParams({
    query,
    mode: "artlist",
    format: "json",
    maxrecords: "10",
    sort: "datedesc",
    timespan: `${timespanDays}d`,
  });
  const url = `${GDELT_DOC_URL}?${params.toString()}`;

  for (let attempt = 0; ; attempt++) {
    const retryable = attempt === 0;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        logger.warn(
          { event: "gdelt_error", status: res.status, infra_id: facility.id, attempt },
          "GDELT fetch failed",
        );
        if (res.status === 429) {
          if (retryable) {
            const retryAfterSec = Number(res.headers.get("retry-after"));
            const backoffMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
              ? Math.min(retryAfterSec, 120) * 1000
              : RETRY_BACKOFF_MS;
            await sleep(backoffMs);
            continue;
          }
          return null; // both attempts throttled — feeds the circuit breaker
        }
        return [];
      }
      const text = await res.text();
      let data: { articles?: Array<Record<string, unknown>> } = {};
      try {
        data = JSON.parse(text) as typeof data;
      } catch {
        logger.warn(
          { event: "gdelt_non_json", infra_id: facility.id, sample: text.slice(0, 80) },
          "GDELT returned non-JSON",
        );
        return [];
      }
      return (data.articles ?? []).map((a) => ({
        url: String(a.url ?? ""),
        title: String(a.title ?? ""),
        seendate: String(a.seendate ?? ""),
        domain: a.domain == null ? undefined : String(a.domain),
      }));
    } catch (err) {
      logger.warn(
        { event: "gdelt_exception", err: String(err), infra_id: facility.id, attempt },
        "GDELT fetch threw",
      );
      if (retryable) {
        await sleep(RETRY_BACKOFF_MS);
        continue;
      }
      return [];
    }
  }
}

async function ensureColumns(): Promise<void> {
  // Matches db/migrate-add-strike-origin.sql (idempotent).
  await sql!`ALTER TABLE infra_strikes ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'curated'`;
  await sql!`ALTER TABLE infra_strikes ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT TRUE`;
}

async function main(): Promise<void> {
  if (!sql) {
    logger.error({ event: "no_db" }, "DATABASE_URL not set");
    process.exit(1);
  }

  const argDays = Number(process.argv[2] ?? "7");
  const timespanDays = Number.isFinite(argDays) && argDays >= 1 ? Math.min(Math.floor(argDays), MAX_TIMESPAN_DAYS) : 7;

  await ensureColumns();
  const facilities = (await sql`
    SELECT id, name, name_local FROM oil_infra WHERE lat IS NOT NULL
  `) as unknown as FacilityRow[];
  logger.info(
    { event: "gdelt_facilities", count: facilities.length, timespan_days: timespanDays },
    "facilities loaded",
  );

  let articlesSeen = 0;
  let strikeArticles = 0;
  let inserted = 0;
  let skippedExisting = 0;

  // Collapse to one candidate per (infra_id, occurred_on) per run — the id
  // already encodes that pair; first article wins, later duplicates only
  // contribute extra source links (up to MAX_SOURCE_URLS).
  const candidates = new Map<string, GdeltCandidate>();

  let consecutiveThrottled = 0;
  for (const [i, facility] of facilities.entries()) {
    if (i > 0) await sleep(REQUEST_DELAY_MS);
    const articles = await fetchGdeltArticles(facility, timespanDays);
    if (articles === null) {
      consecutiveThrottled++;
      if (consecutiveThrottled >= THROTTLE_ABORT_AFTER) {
        logger.error(
          { event: "gdelt_throttled_abort", processed: i + 1, remaining: facilities.length - i - 1 },
          "GDELT is rate-banning this IP — aborting run early; re-run after a cooldown (skip-existing makes re-runs additive)",
        );
        break;
      }
      continue;
    }
    consecutiveThrottled = 0;
    articlesSeen += articles.length;

    for (const a of articles) {
      if (!isStrikeArticle(a.title)) continue;
      strikeArticles++;
      const c = mapGdeltArticle(a, facility.id);
      if (!c) continue;

      const existing = candidates.get(c.id);
      const articleUrl = c.source_urls[0];
      if (existing && articleUrl) {
        if (existing.source_urls.length < MAX_SOURCE_URLS && !existing.source_urls.includes(articleUrl)) {
          existing.source_urls.push(articleUrl);
        }
      } else if (!existing) {
        candidates.set(c.id, c);
      }
    }
  }

  for (const c of candidates.values()) {
    // Any existing strike for this facility within ±1 day wins — curated rows,
    // ACLED candidates and previous GDELT runs all suppress this candidate.
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
          id, infra_id, occurred_on, weapon, summary, source_urls, raw, origin, verified
        ) VALUES (
          ${c.id}, ${c.infra_id}, ${c.occurred_on}, ${c.weapon}, ${c.summary},
          ${c.source_urls}::text[], ${sql.json(c.raw as Parameters<typeof sql.json>[0])},
          'gdelt', FALSE
        )
        ON CONFLICT (id) DO NOTHING
        -- candidates are immutable: curator promotes (verify-strike) or
        -- rejects (--reject); re-runs never overwrite an existing row.
      `;
      inserted += res.count;
    } catch (err) {
      logger.error({ event: "insert_error", err: String(err), id: c.id }, "gdelt strike insert failed");
    }
  }

  logger.info(
    {
      event: "gdelt_strikes_loaded",
      facilities_queried: facilities.length,
      articles_seen: articlesSeen,
      strike_articles: strikeArticles,
      candidates: candidates.size,
      inserted,
      skipped_existing: skippedExisting,
      timespan_days: timespanDays,
    },
    "GDELT strike candidates loaded",
  );
  await sql.end({ timeout: 5 });
}

void main();
