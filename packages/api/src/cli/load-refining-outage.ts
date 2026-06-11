// Loads external, source-cited estimates of Russian primary-refining capacity
// offline due to strikes into the refining_outage table.
//
// Source: data/refining-outage.json — point-in-time published estimates
// (Reuters / Bloomberg / CREA / S&P / Energy Aspects ...). These are OTHERS'
// numbers, not computed by us; every row must carry a source_url. Powers the
// external-estimate chart on the Impact page and outage_estimates in
// /api/impact. Spec:
// docs/superpowers/specs/2026-06-11-impact-methodology-design.md
//
// Run:
//   bun run load-refining-outage                       # loads data/refining-outage.json
//   bun run load-refining-outage path/to/outage.json   # loads a custom file

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "../db.ts";
import { logger } from "../log.ts";

const __dirname = join(fileURLToPath(import.meta.url), "..");
const DATA_DIR = join(__dirname, "..", "..", "..", "..", "data");
const DEFAULT_FILE = join(DATA_DIR, "refining-outage.json");

interface OutageRow {
  id: string;
  as_of: string;
  offline_kbd: number | null;
  offline_pct: number | null;
  metric: string | null;
  source: string | null;
  source_url: string;
  note: string | null;
  raw: Record<string, unknown>;
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** YYYY-MM-DD that survives a UTC round-trip (rejects e.g. 2023-13-45), else null. */
function toIsoDate(v: unknown): string | null {
  const s = toStr(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return s;
}

function isHttpUrl(v: unknown): string | null {
  const s = toStr(v);
  return s && /^https?:\/\//i.test(s) ? s : null;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "src";
}

// Skip rows without an as_of and a citable source_url. id defaults to
// `${as_of}-${source-slug}`. metric defaults from whichever figure is present.
function normalizeOutage(raw: Record<string, unknown>): OutageRow | null {
  const as_of = toIsoDate(raw.as_of);
  if (!as_of) return null;

  const source_url = isHttpUrl(raw.source_url);
  if (!source_url) return null;

  const offline_kbd = toNum(raw.offline_kbd);
  const offline_pct = toNum(raw.offline_pct);
  const source = toStr(raw.source);

  const metricRaw = toStr(raw.metric);
  const metric =
    metricRaw === "kbd" || metricRaw === "pct"
      ? metricRaw
      : offline_kbd !== null
        ? "kbd"
        : offline_pct !== null
          ? "pct"
          : null;

  const id = toStr(raw.id) ?? `${as_of}-${slug(source ?? "src")}`;

  return {
    id,
    as_of,
    offline_kbd,
    offline_pct,
    metric,
    source,
    source_url,
    note: toStr(raw.note),
    raw,
  };
}

async function ensureTable(): Promise<void> {
  await sql!`
    CREATE TABLE IF NOT EXISTS refining_outage (
      id          TEXT PRIMARY KEY,
      as_of       DATE NOT NULL,
      offline_kbd REAL,
      offline_pct REAL,
      metric      TEXT,
      source      TEXT,
      source_url  TEXT,
      note        TEXT,
      raw         JSONB,
      first_seen  TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql!`CREATE INDEX IF NOT EXISTS refining_outage_as_of_idx ON refining_outage (as_of)`;
}

async function main(): Promise<void> {
  if (!sql) {
    logger.error({ event: "no_db" }, "DATABASE_URL not set");
    process.exit(1);
  }

  const file = process.argv[2] ?? DEFAULT_FILE;
  const text = await Bun.file(file).text();
  const parsed = JSON.parse(text) as { estimates?: Array<Record<string, unknown>> };
  const rows = (parsed.estimates ?? [])
    .map(normalizeOutage)
    .filter((r): r is OutageRow => r !== null);
  const skipped = (parsed.estimates ?? []).length - rows.length;

  await ensureTable();
  logger.info({ event: "outage_parsed", file, count: rows.length, skipped }, "outage estimates parsed");

  let inserted = 0;
  for (const r of rows) {
    try {
      await sql`
        INSERT INTO refining_outage (
          id, as_of, offline_kbd, offline_pct, metric, source, source_url, note, raw
        ) VALUES (
          ${r.id}, ${r.as_of}, ${r.offline_kbd}, ${r.offline_pct}, ${r.metric},
          ${r.source}, ${r.source_url}, ${r.note},
          ${sql.json(r.raw as Parameters<typeof sql.json>[0])}
        )
        ON CONFLICT (id) DO UPDATE SET
          as_of = EXCLUDED.as_of, offline_kbd = EXCLUDED.offline_kbd,
          offline_pct = EXCLUDED.offline_pct, metric = EXCLUDED.metric,
          source = EXCLUDED.source, source_url = EXCLUDED.source_url,
          note = EXCLUDED.note, raw = EXCLUDED.raw
      `;
      inserted++;
    } catch (err) {
      logger.error({ event: "insert_error", err: String(err), id: r.id }, "outage insert failed");
    }
  }

  logger.info({ event: "outage_loaded", inserted, total: rows.length, skipped }, "outage estimates loaded");
  await sql.end({ timeout: 5 });
}

void main();
