// Streaming loader for the GUR "War & Sanctions" dataset (Defence Intelligence of
// Ukraine), consumed via its daily OpenSanctions mirror `ua_war_sanctions`.
//
// Why the mirror and not the portal: war-sanctions.gur.gov.ua exposes a structured
// API, but its docs/endpoints sit behind Cloudflare (HTTP 403 to non-browser
// clients). OpenSanctions republishes the same dataset every day as clean,
// licensed FollowTheMoney NDJSON — so we ingest that.
//
// What this adds on top of the OFAC/OpenSanctions-maritime feeds we already load:
//   • Vessel Masters (captains)        → Person entities (full name, DOB, TIN, citizenship)
//   • Ship owners / commercial / safety managers, with IMO company numbers
//   • The explicit GUR shadow-fleet / AIS-shutdown designations
//   • The ownership/relation edges linking all of the above to each vessel,
//     which flow straight into the existing vessel-detail ownership graph.
//
// Shape is identical to load-ownership.ts (same `entities` / `entity_relations`
// tables, same upsert), just pointed at a ~32 MB dataset instead of the 321 MB
// global sanctions graph. Idempotent — safe to re-run daily.
//
// Run: bun run load-war-sanctions

import { sql } from "../db.ts";
import { logger } from "../log.ts";

const URL = "https://data.opensanctions.org/datasets/latest/ua_war_sanctions/entities.ftm.json";
const BATCH_SIZE = 1000;
const PROGRESS_EVERY = 10_000;

const SUBJECT_SCHEMAS = new Set([
  "Vessel", "Company", "Organization", "Person", "LegalEntity",
  "PublicBody", "Asset", "Airplane", "Vehicle", "Address", "Sanction",
]);

const RELATION_SCHEMAS = new Set([
  "Ownership", "Directorship", "Membership", "UnknownLink",
  "Family", "Associate", "Employment", "Representation", "Identification",
]);

const SYNTHETIC_OWNER_PROPS = ["owner", "operator", "charterer", "crsContractor", "parent", "controller", "master"];

interface FtMEntity {
  id: string;
  schema: string;
  caption: string;
  datasets?: string[];
  topics?: string[];
  properties?: Record<string, unknown[]>;
}

interface EntityRow {
  id: string;
  schema_type: string;
  caption: string;
  countries: string[];
  imo: number | null;
  topics: string[];
  datasets: string[];
  url: string | null;
  properties: string;
}

interface RelationRow {
  id: string;
  rel_type: string;
  src_id: string;
  dst_id: string;
  role: string | null;
  percentage: number | null;
  start_date: string | null;
  end_date: string | null;
  properties: string;
}

function firstStr(v: unknown[] | undefined): string | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const s = v[0];
  return typeof s === "string" ? s : null;
}

function arrStr(v: unknown[] | undefined): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function toEntityRow(e: FtMEntity): EntityRow {
  const props = e.properties ?? {};
  const imoRaw = firstStr(props.imoNumber);
  const imoClean = imoRaw ? imoRaw.replace(/^IMO/i, "").trim() : null;
  const imo = imoClean && /^\d{6,8}$/.test(imoClean) ? parseInt(imoClean, 10) : null;
  return {
    id: e.id,
    schema_type: e.schema,
    caption: e.caption ?? "",
    countries: arrStr(props.country).concat(arrStr(props.jurisdiction)).concat(arrStr(props.nationality)),
    imo,
    topics: e.topics ?? [],
    datasets: e.datasets ?? [],
    url: `https://www.opensanctions.org/entities/${e.id}/`,
    properties: JSON.stringify(props),
  };
}

function parsePct(s: string | null): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}

// FtM dates are partial-precision ("2017", "2017-04", "2017-04-15"). Postgres DATE
// needs a full date, so pad missing month/day to 01. Returns null if unparseable.
function normDate(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return null;
  return `${m[1]}-${m[2] ?? "01"}-${m[3] ?? "01"}`;
}

function toRelationRow(e: FtMEntity): RelationRow | null {
  const p = e.properties ?? {};
  let src: string | null = null;
  let dst: string | null = null;
  switch (e.schema) {
    case "Ownership": src = firstStr(p.owner); dst = firstStr(p.asset); break;
    case "Directorship": src = firstStr(p.director); dst = firstStr(p.organization); break;
    case "Membership": src = firstStr(p.member); dst = firstStr(p.organization); break;
    case "Family": src = firstStr(p.person); dst = firstStr(p.relative); break;
    case "Associate": src = firstStr(p.person); dst = firstStr(p.associate); break;
    case "Employment": src = firstStr(p.employee); dst = firstStr(p.employer); break;
    case "Representation": src = firstStr(p.agent); dst = firstStr(p.client); break;
    case "UnknownLink": src = firstStr(p.subject); dst = firstStr(p.object); break;
  }
  if (!src || !dst) return null;
  return {
    id: e.id,
    rel_type: e.schema,
    src_id: src,
    dst_id: dst,
    role: firstStr(p.role),
    percentage: parsePct(firstStr(p.percentage)),
    start_date: normDate(firstStr(p.startDate)),
    end_date: normDate(firstStr(p.endDate)),
    properties: JSON.stringify(p),
  };
}

function synthesizeRelations(e: FtMEntity): RelationRow[] {
  const p = e.properties ?? {};
  const out: RelationRow[] = [];
  for (const prop of SYNTHETIC_OWNER_PROPS) {
    const refs = arrStr(p[prop]);
    let i = 0;
    for (const ref of refs) {
      if (!ref.match(/^[a-zA-Z0-9._:\-]+$/) || ref.length < 4) continue;
      out.push({
        id: `${e.id}-syn-${prop}-${i}`,
        rel_type: prop === "master" || prop === "operator" || prop === "charterer" || prop === "crsContractor" ? "UnknownLink" : "Ownership",
        src_id: ref,
        dst_id: e.id,
        role: prop,
        percentage: null,
        start_date: null,
        end_date: null,
        properties: JSON.stringify({ synthesized_from: [prop] }),
      });
      i++;
    }
  }
  return out;
}

async function ensureSchema(): Promise<void> {
  if (!sql) throw new Error("no DB");
  // Tables shared with load-ownership.ts; CREATE IF NOT EXISTS keeps this loader
  // usable standalone (idempotent).
  await sql`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY, schema_type TEXT NOT NULL, caption TEXT NOT NULL,
      countries TEXT[], imo BIGINT, topics TEXT[], datasets TEXT[], url TEXT,
      properties JSONB, first_seen TIMESTAMPTZ DEFAULT NOW(), last_updated TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS entity_relations (
      id TEXT PRIMARY KEY, rel_type TEXT NOT NULL, src_id TEXT NOT NULL, dst_id TEXT NOT NULL,
      role TEXT, percentage REAL, start_date DATE, end_date DATE,
      properties JSONB, first_seen TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS entities_imo_idx    ON entities (imo) WHERE imo IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS entities_schema_idx ON entities (schema_type)`;
  await sql`CREATE INDEX IF NOT EXISTS rel_src_idx         ON entity_relations (src_id)`;
  await sql`CREATE INDEX IF NOT EXISTS rel_dst_idx         ON entity_relations (dst_id)`;
  await sql`CREATE INDEX IF NOT EXISTS rel_type_idx        ON entity_relations (rel_type)`;
}

async function flushEntities(rows: EntityRow[]): Promise<void> {
  if (!sql || rows.length === 0) return;
  const payload = sql.json(rows as unknown as Parameters<typeof sql.json>[0]);
  await sql`
    INSERT INTO entities (id, schema_type, caption, countries, imo, topics, datasets, url, properties)
    SELECT id, schema_type, caption, countries, imo, topics, datasets, url, properties::jsonb
    FROM jsonb_to_recordset(${payload}::jsonb) AS t(
      id text, schema_type text, caption text, countries text[],
      imo bigint, topics text[], datasets text[], url text, properties text
    )
    ON CONFLICT (id) DO UPDATE SET
      schema_type = EXCLUDED.schema_type, caption = EXCLUDED.caption,
      countries = EXCLUDED.countries, imo = COALESCE(EXCLUDED.imo, entities.imo),
      topics = EXCLUDED.topics,
      datasets = (SELECT ARRAY(SELECT DISTINCT unnest(entities.datasets || EXCLUDED.datasets))),
      url = EXCLUDED.url, properties = EXCLUDED.properties, last_updated = NOW()
  `;
}

async function flushRelations(rows: RelationRow[]): Promise<void> {
  if (!sql || rows.length === 0) return;
  const payload = sql.json(rows as unknown as Parameters<typeof sql.json>[0]);
  await sql`
    INSERT INTO entity_relations (id, rel_type, src_id, dst_id, role, percentage, start_date, end_date, properties)
    SELECT id, rel_type, src_id, dst_id, role, percentage, start_date, end_date, properties::jsonb
    FROM jsonb_to_recordset(${payload}::jsonb) AS t(
      id text, rel_type text, src_id text, dst_id text, role text,
      percentage real, start_date date, end_date date, properties text
    )
    ON CONFLICT (id) DO UPDATE SET
      rel_type = EXCLUDED.rel_type, src_id = EXCLUDED.src_id, dst_id = EXCLUDED.dst_id,
      role = EXCLUDED.role, percentage = EXCLUDED.percentage,
      start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, properties = EXCLUDED.properties
  `;
}

async function main(): Promise<void> {
  if (!sql) {
    logger.error({ event: "no_db" }, "DATABASE_URL not set");
    process.exit(1);
  }
  await ensureSchema();

  logger.info({ event: "fetch", url: URL }, "downloading GUR War & Sanctions FtM (ua_war_sanctions, ~32MB)");
  const res = await fetch(URL);
  if (!res.ok || !res.body) {
    logger.error({ event: "fetch_failed", status: res.status }, "fetch failed");
    process.exit(1);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let entitiesBatch: EntityRow[] = [];
  let relationsBatch: RelationRow[] = [];
  const stats = {
    total: 0, subjects: 0, relations_explicit: 0, relations_synthesized: 0,
    skipped_other: 0, parse_errors: 0, vessels: 0, companies: 0, masters: 0,
  };
  const startTs = Date.now();

  async function processLine(line: string): Promise<void> {
    if (!line.trim()) return;
    let e: FtMEntity;
    try { e = JSON.parse(line) as FtMEntity; } catch { stats.parse_errors++; return; }

    stats.total++;
    if (e.schema === "Vessel") stats.vessels++;
    else if (e.schema === "Company" || e.schema === "Organization") stats.companies++;
    else if (e.schema === "Person") stats.masters++;

    if (RELATION_SCHEMAS.has(e.schema)) {
      const rel = toRelationRow(e);
      if (rel) { relationsBatch.push(rel); stats.relations_explicit++; }
    } else if (SUBJECT_SCHEMAS.has(e.schema)) {
      entitiesBatch.push(toEntityRow(e));
      stats.subjects++;
      const synth = synthesizeRelations(e);
      relationsBatch.push(...synth);
      stats.relations_synthesized += synth.length;
    } else {
      stats.skipped_other++;
    }

    if (entitiesBatch.length >= BATCH_SIZE) { await flushEntities(entitiesBatch); entitiesBatch = []; }
    if (relationsBatch.length >= BATCH_SIZE) { await flushRelations(relationsBatch); relationsBatch = []; }

    if (stats.total % PROGRESS_EVERY === 0) {
      const elapsedS = (Date.now() - startTs) / 1000;
      logger.info({ event: "progress", lines: stats.total, rate: Math.round(stats.total / elapsedS), ...stats }, "ingest progress");
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      await processLine(line);
    }
  }
  if (buf.length > 0) await processLine(buf);
  await flushEntities(entitiesBatch);
  await flushRelations(relationsBatch);

  const elapsedS = (Date.now() - startTs) / 1000;
  logger.info({ event: "loaded", elapsedS: elapsedS.toFixed(1), ...stats }, "GUR War & Sanctions ingest complete");
  await sql.end({ timeout: 5 });
}

void main();
