// FIRMS-triggered strike detection.
// Spec: docs/superpowers/specs/2026-06-11-firms-trigger-design.md
//
// Thesis: stop polling all ~69 facilities through GDELT (rate-bans, noise).
// Let the satellite point us. One cheap FIRMS call yields the handful of
// facilities with fresh thermal anomalies ("active", from fires-match). For
// each active facility that has NO known recent strike, run ONE targeted GDELT
// query. A strike-article there → a candidate the curator confirms. A facility
// that merely flares daily (no strike news) yields no candidate — the news
// query self-filters, so no per-facility flare baseline is needed in v1.
//
// Candidates land in infra_strikes as origin='firms-trigger', verified=FALSE
// until a curator runs verify-strike. The pure pieces (FIRMS parse + match,
// GDELT article mapping) are the already-unit-tested modules; this file is the
// network/db orchestration only.
//
// Run:
//   bun run load-firms-triggered        # GDELT window = last 3 days
//   bun run load-firms-triggered 7      # widen the window (max 30 days)
import { sql } from "../db.ts";
import { logger } from "../log.ts";
import { fetchFirmsPoints } from "../firms-fetch.ts";
import { matchFiresToFacilities, type FacilityPoint } from "../fires-match.ts";
import {
  buildGdeltQuery,
  isStrikeArticle,
  mapGdeltArticle,
  type GdeltArticle,
} from "../gdelt-match.ts";

const GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const USER_AGENT = "oilfront/0.1 (research; non-commercial)";
// GDELT throttles per IP aggressively (see load-gdelt-strikes.ts). Generous
// spacing + Retry-After honoring + the consecutive-429 circuit breaker keep a
// ~15-query triggered run polite and fail-fast.
const REQUEST_DELAY_MS = 7500;
const RETRY_BACKOFF_MS = 30000;
const THROTTLE_ABORT_AFTER = 5; // consecutive both-attempts-429 facilities
const FETCH_TIMEOUT_MS = 15000;
const MAX_TIMESPAN_DAYS = 30;
const SUMMARY_MAX = 280;

// oil_infra row with the local name needed for the GDELT query and the
// lat/lon needed for the FIRMS spatial match. FacilityPoint (fires-match) is
// {id,lat,lon}; we extend it with the names.
interface FacilityRow extends FacilityPoint {
  name: string;
  name_local: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Targeted GDELT lookup for ONE facility — mirrors load-gdelt-strikes'
// fetchGdeltArticles: non-200/non-JSON warned and treated as empty so one bad
// facility never aborts a run; 429/timeout gets one retry after a backoff
// (honoring Retry-After when present). Returns null when BOTH attempts were
// throttled — the caller's circuit breaker counts those.
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

// Pick the newest strike-looking article from a facility's GDELT results.
// fetchGdeltArticles already requests sort=datedesc, so the first match is the
// newest, but we scan all to be robust against ordering.
function newestStrikeArticle(articles: GdeltArticle[]): GdeltArticle | null {
  let best: GdeltArticle | null = null;
  for (const a of articles) {
    if (!isStrikeArticle(a.title)) continue;
    if (!best || a.seendate > best.seendate) best = a;
  }
  return best;
}

async function main(): Promise<void> {
  const key = process.env.FIRMS_MAP_KEY;
  if (!key) {
    logger.info({ event: "firms_trigger_no_key" }, "FIRMS_MAP_KEY not set — skipping");
    process.exit(0);
  }
  if (!sql) {
    logger.error({ event: "no_db" }, "DATABASE_URL not set");
    process.exit(1);
  }

  const argDays = Number(process.argv[2] ?? "3");
  const timespanDays = Number.isFinite(argDays) && argDays >= 1 ? Math.min(Math.floor(argDays), MAX_TIMESPAN_DAYS) : 3;

  await ensureColumns();
  const facilities = (await sql`
    SELECT id, name, name_local, lat, lon FROM oil_infra WHERE lat IS NOT NULL
  `) as unknown as FacilityRow[];

  // Satellite step: one cheap FIRMS call, conservative match → active set.
  const points = await fetchFirmsPoints(key);
  const aggregates = matchFiresToFacilities(points, facilities, 3);
  const byId = new Map(facilities.map((f) => [f.id, f]));
  const active = Object.entries(aggregates)
    .filter(([, agg]) => agg.active)
    .map(([id, agg]) => ({ facility: byId.get(id)!, agg }))
    .filter((x) => x.facility);

  logger.info(
    { event: "firms_trigger_active", scanned: points.length, active_facilities: active.length, timespan_days: timespanDays },
    "FIRMS active facilities computed",
  );

  let queried = 0;
  let skippedKnown = 0;
  let candidatesInserted = 0;
  let consecutiveThrottled = 0;

  for (const { facility, agg } of active) {
    // Known-strike suppression: a strike already on record within ±2 days of
    // the anomaly date means this heat is already explained — no GDELT query.
    const known = await sql`
      SELECT 1 FROM infra_strikes
      WHERE infra_id = ${facility.id}
        AND occurred_on BETWEEN (${agg.last_date}::date - 2) AND (${agg.last_date}::date + 2)
    `;
    if (known.length > 0) {
      skippedKnown++;
      continue;
    }

    // Pace before each network query except the first one we actually send.
    if (queried > 0) await sleep(REQUEST_DELAY_MS);
    const articles = await fetchGdeltArticles(facility, timespanDays);
    queried++;
    if (articles === null) {
      consecutiveThrottled++;
      if (consecutiveThrottled >= THROTTLE_ABORT_AFTER) {
        logger.error(
          { event: "gdelt_throttled_abort", queried, candidates_inserted: candidatesInserted },
          "GDELT is rate-banning this IP — aborting run early; re-run after a cooldown (skip-existing makes re-runs additive)",
        );
        break;
      }
      continue;
    }
    consecutiveThrottled = 0;

    const article = newestStrikeArticle(articles);
    if (!article) continue;
    const mapped = mapGdeltArticle(article, facility.id);
    if (!mapped) continue;

    // A curated row for this facility within ±1 day wins — never shadow a
    // human-confirmed strike with an auto candidate.
    const curated = await sql`
      SELECT 1 FROM infra_strikes
      WHERE infra_id = ${facility.id}
        AND occurred_on BETWEEN (${mapped.occurred_on}::date - 1) AND (${mapped.occurred_on}::date + 1)
        AND origin = 'curated'
    `;
    if (curated.length > 0) continue;

    const baseTitle = article.title.trim().slice(0, SUMMARY_MAX);
    const summary = `${baseTitle} [auto: FIRMS→GDELT]`;
    const id = `firms-${facility.id}-${mapped.occurred_on}`;
    const raw = {
      firms: { count: agg.count, max_frp: agg.max_frp, last_date: agg.last_date },
      article: { ...article },
    };

    try {
      const res = await sql`
        INSERT INTO infra_strikes (
          id, infra_id, occurred_on, weapon, summary, source_urls, raw, origin, verified
        ) VALUES (
          ${id}, ${facility.id}, ${mapped.occurred_on}, ${mapped.weapon}, ${summary},
          ${[article.url]}::text[], ${sql.json(raw as Parameters<typeof sql.json>[0])},
          'firms-trigger', FALSE
        )
        ON CONFLICT (id) DO NOTHING
        -- candidates are immutable: curator promotes (verify-strike) or
        -- rejects (--reject); re-runs never overwrite an existing row.
      `;
      candidatesInserted += res.count;
    } catch (err) {
      logger.error({ event: "insert_error", err: String(err), id }, "firms-trigger strike insert failed");
    }
  }

  logger.info(
    {
      event: "firms_trigger_loaded",
      active_facilities: active.length,
      skipped_known_strike: skippedKnown,
      queried,
      candidates_inserted: candidatesInserted,
      timespan_days: timespanDays,
    },
    "FIRMS-triggered strike candidates loaded",
  );
  await sql.end({ timeout: 5 });
}

void main();
