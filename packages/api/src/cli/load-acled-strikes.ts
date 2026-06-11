// Pulls candidate strike events on Russian oil facilities from the ACLED API
// and upserts them into infra_strikes as origin='acled', verified=FALSE until
// a curator confirms (see verify-strike.ts). Spatial join against oil_infra is
// pure logic in ../acled-match.ts (unit-tested, no network).
// Spec: docs/superpowers/specs/2026-06-11-acled-strikes-feed-design.md
//
// Credentials: ACLED_EMAIL / ACLED_PASSWORD in .env (free registered access at
// https://acleddata.com). Both optional — without them this loader logs
// acled_not_configured and exits 0.
//
// Licensing: ACLED terms forbid republishing raw data; events are stored
// internally and only our own aggregated rendering is shown, with attribution.
//
// Run:
//   bun run load-acled-strikes               # window = last 30 days
//   bun run load-acled-strikes 2026-01-01    # widen the window
import { sql } from "../db.ts";
import { env } from "../env.ts";
import { logger } from "../log.ts";
import {
  matchEventToFacility,
  mapAcledEvent,
  type AcledEvent,
  type FacilityPoint,
} from "../acled-match.ts";

const TOKEN_URL = "https://acleddata.com/oauth/token";
const READ_URL = "https://acleddata.com/api/acled/read";
const PAGE_LIMIT = 5000;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function fetchToken(): Promise<string | null> {
  const body = new URLSearchParams({
    username: env.ACLED_EMAIL!,
    password: env.ACLED_PASSWORD!,
    grant_type: "password",
    client_id: "acled",
    scope: "authenticated",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (res.status !== 200) {
    logger.error({ event: "acled_auth_failed", status: res.status }, "ACLED token request failed");
    return null;
  }
  const json = (await res.json()) as { access_token?: string };
  return json.access_token ?? null;
}

/** ACLED range param style: event_date={since}|{today} + event_date_where=BETWEEN. */
export function buildAcledUrl(since: string, today: string, page: number): string {
  const params = new URLSearchParams({
    _format: "json",
    country: "Russia",
    event_type: "Explosions/Remote violence",
    event_date: `${since}|${today}`,
    event_date_where: "BETWEEN",
    limit: String(PAGE_LIMIT),
    page: String(page),
  });
  return `${READ_URL}?${params.toString()}`;
}

// Single fetch entry point — if the live ACLED param syntax differs, fixing it
// here (buildAcledUrl) is a one-line change; the data array is response.data.
async function fetchAcledPage(token: string, since: string, page: number): Promise<AcledEvent[]> {
  const today = new Date().toISOString().slice(0, 10);
  const url = buildAcledUrl(since, today, page);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status !== 200) {
    logger.error({ event: "acled_read_failed", status: res.status, page }, "ACLED read failed");
    return [];
  }
  const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
  const rows = json.data ?? [];
  logger.info({ event: "acled_page", page, raw_count: rows.length }, "ACLED page fetched");
  return rows.map((r) => ({
    event_id_cnty: String(r.event_id_cnty ?? ""),
    event_date: String(r.event_date ?? ""),
    event_type: String(r.event_type ?? ""),
    sub_event_type: String(r.sub_event_type ?? ""),
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    notes: String(r.notes ?? ""),
    source: String(r.source ?? ""),
  }));
}

async function ensureColumns(): Promise<void> {
  // Matches db/migrate-add-strike-origin.sql (idempotent).
  await sql!`ALTER TABLE infra_strikes ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'curated'`;
  await sql!`ALTER TABLE infra_strikes ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT TRUE`;
}

async function main(): Promise<void> {
  if (!env.ACLED_EMAIL || !env.ACLED_PASSWORD) {
    logger.info({ event: "acled_not_configured" }, "ACLED_EMAIL/ACLED_PASSWORD not set — skipping");
    process.exit(0);
  }
  if (!sql) {
    logger.error({ event: "no_db" }, "DATABASE_URL not set");
    process.exit(1);
  }

  const since = process.argv[2] ?? isoDaysAgo(30);
  const token = await fetchToken();
  if (!token) {
    await sql.end({ timeout: 5 });
    process.exit(1);
  }

  await ensureColumns();
  const facilities = (await sql`
    SELECT id, kind, lat, lon FROM oil_infra WHERE lat IS NOT NULL
  `) as unknown as FacilityPoint[];
  logger.info({ event: "acled_facilities", count: facilities.length, since }, "facilities loaded");

  let fetched = 0;
  let matched = 0;
  let inserted = 0;
  let skippedCurated = 0;

  for (let page = 1; ; page++) {
    const events = await fetchAcledPage(token, since, page);
    fetched += events.length;

    for (const ev of events) {
      if (!ev.event_id_cnty || !Number.isFinite(ev.latitude) || !Number.isFinite(ev.longitude)) continue;
      const m = matchEventToFacility(ev, facilities);
      if (!m) continue;
      matched++;

      const c = mapAcledEvent(ev, m.facility.id);
      const curated = await sql`
        SELECT 1 FROM infra_strikes
        WHERE infra_id = ${c.infra_id} AND occurred_on = ${c.occurred_on} AND origin = 'curated'
      `;
      if (curated.length > 0) {
        skippedCurated++;
        continue;
      }

      try {
        await sql`
          INSERT INTO infra_strikes (
            id, infra_id, occurred_on, weapon, summary, source_urls, raw, origin, verified
          ) VALUES (
            ${c.id}, ${c.infra_id}, ${c.occurred_on}, ${c.weapon}, ${c.summary},
            ${c.source_urls}::text[], ${sql.json(c.raw as Parameters<typeof sql.json>[0])},
            'acled', FALSE
          )
          ON CONFLICT (id) DO UPDATE SET
            infra_id = EXCLUDED.infra_id, occurred_on = EXCLUDED.occurred_on,
            weapon = EXCLUDED.weapon, summary = EXCLUDED.summary,
            source_urls = EXCLUDED.source_urls, raw = EXCLUDED.raw,
            origin = EXCLUDED.origin
            -- verified intentionally NOT updated: re-runs refresh notes but
            -- must not undo a curator's verify-strike promotion.
        `;
        inserted++;
      } catch (err) {
        logger.error({ event: "insert_error", err: String(err), id: c.id }, "acled strike insert failed");
      }
    }

    if (events.length < PAGE_LIMIT) break;
  }

  logger.info(
    { event: "acled_strikes_loaded", fetched, matched, inserted, skipped_curated: skippedCurated, since },
    "ACLED strikes loaded",
  );
  await sql.end({ timeout: 5 });
}

void main();
