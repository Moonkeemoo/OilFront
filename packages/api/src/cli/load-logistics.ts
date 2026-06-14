// Loads the Russian logistics/transport sites reference layer into the
// logistics_sites table.
//
// Source: data/logistics-sites.json — curated records (rail depots/junctions,
// bridges, ammunition/weapons arsenals) compiled from open-source intelligence
// with source URLs. Provenance and QA:
// docs/superpowers/specs/2026-06-14-logistics-layer-design.md
//
// Run:
//   bun run load-logistics                       # loads data/logistics-sites.json
//   bun run load-logistics path/to/sites.json    # loads a custom file

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "../db.ts";
import { logger } from "../log.ts";
import { normalizeLogisticsSite, type LogisticsSite } from "../logistics-normalize.ts";

const __dirname = join(fileURLToPath(import.meta.url), "..");
const DATA_DIR = join(__dirname, "..", "..", "..", "..", "data");
const DEFAULT_FILE = join(DATA_DIR, "logistics-sites.json");

async function ensureTable(): Promise<void> {
  await sql!`
    CREATE TABLE IF NOT EXISTS logistics_sites (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      name_local  TEXT,
      lat         REAL,
      lon         REAL,
      category    TEXT,
      role        TEXT,
      operator    TEXT,
      region      TEXT,
      status      TEXT,
      strikes     JSONB,
      notes       TEXT,
      source_urls TEXT[],
      raw         JSONB,
      first_seen  TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql!`CREATE INDEX IF NOT EXISTS logistics_sites_category_idx ON logistics_sites (category)`;
}

async function main(): Promise<void> {
  if (!sql) {
    logger.error({ event: "no_db" }, "DATABASE_URL not set");
    process.exit(1);
  }

  const file = process.argv[2] ?? DEFAULT_FILE;
  if (!(await Bun.file(file).exists())) {
    // The seed file may not exist yet (curated separately) — don't crash.
    logger.info({ event: "logistics_no_file", file }, "logistics-sites.json absent — nothing to load");
    await sql.end({ timeout: 5 });
    process.exit(0);
  }

  const text = await Bun.file(file).text();
  const parsed = JSON.parse(text) as { sites?: Array<Record<string, unknown>> };
  const rows = (parsed.sites ?? []).map(normalizeLogisticsSite).filter((r): r is LogisticsSite => r !== null);
  const skipped = (parsed.sites ?? []).length - rows.length;

  await ensureTable();
  logger.info({ event: "logistics_parsed", file, count: rows.length, skipped }, "logistics sites parsed");

  let inserted = 0;
  for (const r of rows) {
    try {
      await sql`
        INSERT INTO logistics_sites (
          id, name, name_local, lat, lon, category, role, operator,
          region, status, strikes, notes, source_urls, raw
        ) VALUES (
          ${r.id}, ${r.name}, ${r.name_local}, ${r.lat}, ${r.lon},
          ${r.category}, ${r.role}, ${r.operator},
          ${r.region}, ${r.status},
          ${sql.json(r.strikes as unknown as Parameters<typeof sql.json>[0])},
          ${r.notes}, ${r.source_urls}::text[],
          ${sql.json(r.raw as Parameters<typeof sql.json>[0])}
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, name_local = EXCLUDED.name_local,
          lat = EXCLUDED.lat, lon = EXCLUDED.lon,
          category = EXCLUDED.category, role = EXCLUDED.role,
          operator = EXCLUDED.operator, region = EXCLUDED.region,
          status = EXCLUDED.status, strikes = EXCLUDED.strikes,
          notes = EXCLUDED.notes, source_urls = EXCLUDED.source_urls,
          raw = EXCLUDED.raw
      `;
      inserted++;
    } catch (err) {
      logger.error({ event: "insert_error", err: String(err), id: r.id }, "logistics site insert failed");
    }
  }

  logger.info({ event: "logistics_loaded", inserted, total: rows.length, skipped }, "logistics sites loaded");
  await sql.end({ timeout: 5 });
}

void main();
