// Loads CREA (Centre for Research on Energy and Clean Air) shadow-fleet
// revenue & insurance signals into the crea_vessels table, keyed on IMO.
//
// Source: CREA Russia Fossil Tracker (russiafossiltracker.com) + CREA Russia
// Sanctions Tracker (energyandcleanair.org/russia-sanction-tracker). These give,
// per oil-carrying vessel: a 'shadow fleet' classification, the insurer / P&I
// country (a key tell — legitimate Western P&I vs. opaque Russian cover),
// price-cap compliance, estimated voyage revenue, and the main buyer country.
//
// CREA's public API host (api.russiafossiltracker.com) returns JSON but its
// endpoint schema is undocumented/unstable, and the underlying seaborne data is
// licensed from Kpler. So — exactly like load-psc / load-cases — this loader
// reads a defined JSON shape that an operator exports/curates, and ships a small
// SYNTHETIC seed so the pipeline and UI render immediately. Replace the seed with
// a real CREA export before drawing conclusions.
//
// Run:
//   bun run load-crea                       # loads data/crea-shadow-fleet.seed.json
//   bun run load-crea path/to/crea.json     # loads a custom export

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "../db.ts";
import { logger } from "../log.ts";

const __dirname = join(fileURLToPath(import.meta.url), "..");
const DATA_DIR = join(__dirname, "..", "..", "..", "..", "data");
const DEFAULT_FILE = join(DATA_DIR, "crea-shadow-fleet.seed.json");

interface CreaRow {
  imo: number;
  vessel_name: string | null;
  shadow_fleet: boolean | null;
  insurer: string | null;
  insurer_country: string | null;
  pi_club: string | null;
  price_cap_compliant: boolean | null;
  voyages: number | null;
  est_revenue_usd: number | null;
  main_destination: string | null;
  last_voyage_on: string | null;
  source_url: string | null;
  raw: Record<string, unknown>;
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function toBool(v: unknown): boolean | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  if (["true", "yes", "1", "y"].includes(s)) return true;
  if (["false", "no", "0", "n"].includes(s)) return false;
  return null;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[, $]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function normalize(raw: Record<string, unknown>): CreaRow | null {
  const imo = toNum(raw.imo);
  if (imo === null || imo < 1000000 || imo > 9999999) return null;
  return {
    imo,
    vessel_name: toStr(raw.vessel_name ?? raw.name),
    shadow_fleet: toBool(raw.shadow_fleet),
    insurer: toStr(raw.insurer),
    insurer_country: toStr(raw.insurer_country),
    pi_club: toStr(raw.pi_club),
    price_cap_compliant: toBool(raw.price_cap_compliant),
    voyages: toNum(raw.voyages),
    est_revenue_usd: toNum(raw.est_revenue_usd),
    main_destination: toStr(raw.main_destination ?? raw.destination),
    last_voyage_on: toStr(raw.last_voyage_on),
    source_url: toStr(raw.source_url),
    raw,
  };
}

async function ensureTable(): Promise<void> {
  await sql!`
    CREATE TABLE IF NOT EXISTS crea_vessels (
      imo                 BIGINT PRIMARY KEY,
      vessel_name         TEXT,
      shadow_fleet        BOOLEAN,
      insurer             TEXT,
      insurer_country     TEXT,
      pi_club             TEXT,
      price_cap_compliant BOOLEAN,
      voyages             INTEGER,
      est_revenue_usd     NUMERIC,
      main_destination    TEXT,
      last_voyage_on      DATE,
      source_url          TEXT,
      raw                 JSONB,
      first_seen          TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql!`CREATE INDEX IF NOT EXISTS crea_shadow_idx ON crea_vessels (shadow_fleet) WHERE shadow_fleet`;
}

async function main(): Promise<void> {
  if (!sql) {
    logger.error({ event: "no_db" }, "DATABASE_URL not set");
    process.exit(1);
  }

  const file = process.argv[2] ?? DEFAULT_FILE;
  const text = await Bun.file(file).text();
  const parsed = JSON.parse(text) as { vessels?: Array<Record<string, unknown>> };
  const rows = (parsed.vessels ?? []).map(normalize).filter((r): r is CreaRow => r !== null);

  await ensureTable();
  logger.info({ event: "crea_parsed", file, count: rows.length }, "CREA vessels parsed");

  let inserted = 0;
  for (const r of rows) {
    try {
      await sql`
        INSERT INTO crea_vessels (
          imo, vessel_name, shadow_fleet, insurer, insurer_country, pi_club,
          price_cap_compliant, voyages, est_revenue_usd, main_destination,
          last_voyage_on, source_url, raw
        ) VALUES (
          ${r.imo}, ${r.vessel_name}, ${r.shadow_fleet}, ${r.insurer}, ${r.insurer_country}, ${r.pi_club},
          ${r.price_cap_compliant}, ${r.voyages}, ${r.est_revenue_usd}, ${r.main_destination},
          ${r.last_voyage_on}, ${r.source_url}, ${sql.json(r.raw as Parameters<typeof sql.json>[0])}
        )
        ON CONFLICT (imo) DO UPDATE SET
          vessel_name = EXCLUDED.vessel_name, shadow_fleet = EXCLUDED.shadow_fleet,
          insurer = EXCLUDED.insurer, insurer_country = EXCLUDED.insurer_country,
          pi_club = EXCLUDED.pi_club, price_cap_compliant = EXCLUDED.price_cap_compliant,
          voyages = EXCLUDED.voyages, est_revenue_usd = EXCLUDED.est_revenue_usd,
          main_destination = EXCLUDED.main_destination, last_voyage_on = EXCLUDED.last_voyage_on,
          source_url = EXCLUDED.source_url, raw = EXCLUDED.raw
      `;
      inserted++;
    } catch (err) {
      logger.error({ event: "insert_error", err: String(err), imo: r.imo }, "crea insert failed");
    }
  }

  logger.info({ event: "crea_loaded", inserted, total: rows.length }, "CREA vessels loaded");
  await sql.end({ timeout: 5 });
}

void main();
