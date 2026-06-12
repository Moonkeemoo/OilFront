// Confidence-engine rescore step (CLI `bun run rescore [days]`, default 180).
// Spec: docs/superpowers/specs/2026-06-12-auto-verification-design.md
//
// Thesis: replace the manual curator gate with a deterministic, self-correcting
// confidence engine. This thin DB step reads recent strikes, clusters the same
// real-world event across feeds (strike-cluster.ts), assembles explainable
// evidence + satellite corroboration (confidence.ts + fires-match.ts), scores
// each cluster into a tier, and writes tier/score/breakdown/evidence back to
// EVERY member row. It also maintains `verified = (tier = 'confirmed')` as a
// derived back-compat flag. Idempotent: re-running on unchanged data + the same
// asOfDate yields the same tiers.
//
// Grandfathering needs no special case: curated rows carry origin='curated', so
// buildEvidence sets trusted_manual=true → scoreStrike → 'confirmed'.
//
// Pure logic lives in the unit-tested modules; this file is db/network glue
// only (mirrors the fires-match.ts <-> load-firms-triggered.ts split).
//
// Run:
//   bun run rescore       # lookback window = last 180 days
//   bun run rescore 30    # narrow the window
import { sql } from "../db.ts";
import { logger } from "../log.ts";
import { fetchFirmsPoints } from "../firms-fetch.ts";
import { matchFiresToFacilities, type FacilityPoint, type FireAggregate } from "../fires-match.ts";
import { clusterStrikes, type StrikeInput } from "../strike-cluster.ts";
import { buildEvidence, scoreStrike, type Score } from "../confidence.ts";

const DEFAULT_DAYS = 180;
const MAX_DAYS = 3650; // ~10 y guard
const FIRMS_RADIUS_KM = 3;
const UPDATE_BATCH = 200; // member-row UPDATEs flushed per Promise.all batch

// Raw infra_strikes row shape we read for scoring. occurred_on is selected as
// ::text but postgres-js can still hand back a Date for DATE columns in some
// paths — normalize defensively to a YYYY-MM-DD string.
interface StrikeRow {
  id: string;
  infra_id: string;
  occurred_on: string;
  weapon: string | null;
  severity: string | null;
  summary: string | null;
  source_urls: string[] | null;
  origin: string | null;
}

function ymd(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

async function ensureColumns(): Promise<void> {
  // Idempotent — mirrors db/migrate-add-confidence.sql so rescore self-bootstraps
  // even when the migration hasn't been applied yet.
  await sql!`ALTER TABLE infra_strikes ADD COLUMN IF NOT EXISTS confidence_tier TEXT`;
  await sql!`ALTER TABLE infra_strikes ADD COLUMN IF NOT EXISTS confidence_score INTEGER`;
  await sql!`ALTER TABLE infra_strikes ADD COLUMN IF NOT EXISTS score_breakdown JSONB`;
  await sql!`ALTER TABLE infra_strikes ADD COLUMN IF NOT EXISTS evidence JSONB`;
  await sql!`CREATE INDEX IF NOT EXISTS infra_strikes_tier_idx ON infra_strikes (confidence_tier)`;
}

async function main(): Promise<void> {
  if (!sql) {
    logger.error({ event: "no_db" }, "DATABASE_URL not set");
    process.exit(1);
  }
  // Narrowed non-null handle so the closures below (Promise.all) keep the type.
  const db = sql;

  const startMs = Date.now();
  const argDays = Number(process.argv[2] ?? String(DEFAULT_DAYS));
  const days =
    Number.isFinite(argDays) && argDays >= 1 ? Math.min(Math.floor(argDays), MAX_DAYS) : DEFAULT_DAYS;

  // The ONE clock read for the whole run — passed verbatim into the pure engine
  // so satellite freshness + stale demotion are computed against a single
  // as-of date (mirrors fires-match's asOfDate contract).
  const todayUTC = new Date().toISOString().slice(0, 10);

  await ensureColumns();

  // Candidate rows in the lookback window. occurred_on::text keeps it a string.
  const rawRows = (await db`
    SELECT id, infra_id, occurred_on::text AS occurred_on, weapon, severity, summary, source_urls, origin
    FROM infra_strikes
    WHERE occurred_on >= (CURRENT_DATE - ${days}::integer)
  `) as unknown as StrikeRow[];

  const rows: StrikeInput[] = rawRows.map((r) => ({
    id: r.id,
    infra_id: r.infra_id,
    occurred_on: ymd(r.occurred_on),
    weapon: r.weapon ?? "",
    severity: r.severity ?? "",
    summary: r.summary ?? "",
    source_urls: r.source_urls ?? [],
    origin: r.origin ?? "curated",
  }));

  // Facilities for the FIRMS spatial match.
  const facilities = (await db`
    SELECT id, lat, lon FROM oil_infra WHERE lat IS NOT NULL
  `) as unknown as FacilityPoint[];

  // Satellite step — optional, degrades gracefully like the feed loaders. With a
  // key we get the per-facility FIRMS aggregate (active_now = fresh heat);
  // without one every cluster scores satellite=null.
  const key = process.env.FIRMS_MAP_KEY;
  let firesMap: Record<string, FireAggregate> = {};
  if (key) {
    const points = await fetchFirmsPoints(key);
    firesMap = matchFiresToFacilities(points, facilities, FIRMS_RADIUS_KM, todayUTC);
  } else {
    logger.info({ event: "firms_skipped" }, "FIRMS_MAP_KEY not set — satellite signal null for all clusters");
  }

  logger.info(
    {
      event: "rescore_start",
      days,
      rows: rows.length,
      facilities: facilities.length,
      firms_enabled: !!key,
    },
    "rescore: clustering + scoring strikes",
  );

  // Cluster the same event across feeds, then score each cluster once and fan
  // the result out to all of its member rows.
  const clusters = clusterStrikes(rows);

  const tierCounts: Record<Score["tier"], number> = {
    confirmed: 0,
    reported: 0,
    single: 0,
    stale: 0,
    retracted: 0,
  };

  // Build the per-member update payloads first (pure), then flush in batches.
  interface Update {
    tier: Score["tier"];
    score: number;
    breakdown: Record<string, unknown>;
    evidence: Record<string, unknown>;
    member_ids: string[];
  }
  const updates: Update[] = [];

  for (const cluster of clusters) {
    const fires = firesMap[cluster.infra_id] ?? null;
    const ev = buildEvidence(cluster, fires, todayUTC);
    const { tier, score, breakdown } = scoreStrike(ev, todayUTC);
    tierCounts[tier] += 1;
    updates.push({
      tier,
      score,
      breakdown,
      evidence: ev as unknown as Record<string, unknown>,
      member_ids: cluster.member_ids,
    });
  }

  let rowsUpdated = 0;
  for (let i = 0; i < updates.length; i += UPDATE_BATCH) {
    const batch = updates.slice(i, i + UPDATE_BATCH);
    const results = await Promise.all(
      batch.map(
        (u) => db`
          UPDATE infra_strikes
          SET confidence_tier = ${u.tier},
              confidence_score = ${u.score},
              score_breakdown = ${db.json(u.breakdown as Parameters<typeof db.json>[0])},
              evidence = ${db.json(u.evidence as Parameters<typeof db.json>[0])},
              verified = ${u.tier === "confirmed"}
          WHERE id = ANY(${u.member_ids}::text[])
        `,
      ),
    );
    for (const r of results) rowsUpdated += r.count;
  }

  logger.info({ event: "rescore_histogram", ...tierCounts }, "tier histogram");
  logger.info(
    {
      event: "rescore_done",
      clusters: clusters.length,
      rows_updated: rowsUpdated,
      ...tierCounts,
      durationMs: Date.now() - startMs,
    },
    "rescore complete",
  );

  await db.end({ timeout: 5 });
}

void main();
