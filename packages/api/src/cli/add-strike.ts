// Manual-add channel (CLI). The ONE human workflow in the auto-verification
// system: inject a strike the user knows about that the feeds missed (recall).
// Mirrors the POST /api/strikes/manual handler in server.ts but writes the row
// DIRECTLY via sql (no HTTP) — same validation, same id scheme, same TRUSTED
// fields (origin='manual', tier 'confirmed'). The engine still owns precision:
// rescore reconciles this row idempotently and keeps it 'confirmed' (a
// trusted_manual row is immune to the Phase-1 keyword retraction).
//
// Spec: docs/superpowers/specs/2026-06-12-auto-verification-design.md
//
// Run:
//   bun run add-strike <infra_id> <YYYY-MM-DD> "<summary>" [url1] [url2] ...
//
// Example:
//   bun run add-strike ryazan-refinery 2026-06-10 "Drone strike, fire at CDU-6" https://kyivindependent.com/x
import { sql } from "../db.ts";
import { logger } from "../log.ts";

const WEAPONS = new Set(["uav", "missile", "sabotage", "unknown"]);
const SEVERITIES = new Set(["major", "moderate", "minor", "unknown"]);

function usage(): void {
  console.error('Usage: bun run add-strike <infra_id> <YYYY-MM-DD> "<summary>" [url1] [url2] ...');
  console.error("  infra_id    must exist in oil_infra");
  console.error("  YYYY-MM-DD  a real date, not in the future");
  console.error("  summary     required, non-empty (quote it)");
  console.error("  urls        optional http(s) source URLs (filtered; [] is fine)");
}

/** Real YYYY-MM-DD date that round-trips and is not after `today`. */
function isValidPastDate(s: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false;
  return s <= today;
}

/** Keep only well-formed http(s) URLs, deduped. [] is allowed. */
function cleanSourceUrls(input: string[]): string[] {
  const out: string[] = [];
  for (const u of input) {
    const s = u.trim();
    if (/^https?:\/\/\S+$/i.test(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const infra_id = (args[0] ?? "").trim();
  const occurred_on = (args[1] ?? "").trim();
  const summary = (args[2] ?? "").trim();
  const source_urls = cleanSourceUrls(args.slice(3));

  // --- argument validation (mirrors the endpoint) ---------------------------
  const today = new Date().toISOString().slice(0, 10);
  if (!infra_id || !occurred_on || !summary) {
    usage();
    process.exit(1);
  }
  if (!isValidPastDate(occurred_on, today)) {
    logger.error({ event: "add_strike_bad_date", occurred_on }, "occurred_on must be a real YYYY-MM-DD date not in the future");
    process.exit(1);
  }

  if (!sql) {
    logger.error({ event: "no_db" }, "DATABASE_URL not set");
    process.exit(1);
  }

  // Facility must exist.
  const exists = await sql`SELECT 1 FROM oil_infra WHERE id = ${infra_id} LIMIT 1`;
  if (exists.length === 0) {
    logger.error({ event: "add_strike_unknown_infra", infra_id }, "unknown infra_id (no such facility in oil_infra)");
    await sql.end({ timeout: 5 });
    process.exit(1);
  }

  // weapon/severity are CLI-fixed to the 'unknown' default (positional args are
  // id/date/summary/urls only); the HTTP endpoint accepts overrides. The enum
  // sets below are the shared source of truth for what the endpoint validates.
  const weapon = "unknown";
  const severity = "unknown";
  if (!WEAPONS.has(weapon) || !SEVERITIES.has(severity)) throw new Error("invalid default enum"); // unreachable; keeps sets referenced + documents the contract

  const id = `manual-${infra_id}-${occurred_on.replaceAll("-", "")}`;

  // Provisional trusted-confirmed fields — identical to the endpoint, so the row
  // shows correctly immediately and rescore keeps it 'confirmed' idempotently.
  const breakdown = { trusted_manual: true, manual_entry: true, reputable_count: source_urls.length };
  const evidence = {
    infra_id,
    occurred_on,
    sources: source_urls.map((url) => ({ url })),
    trusted_manual: true,
    origins: ["manual"],
  };

  try {
    const res = await sql`
      INSERT INTO infra_strikes (
        id, infra_id, occurred_on, weapon, severity, summary, source_urls,
        origin, verified, confidence_tier, confidence_score, score_breakdown, evidence
      ) VALUES (
        ${id}, ${infra_id}, ${occurred_on}, ${weapon}, ${severity}, ${summary}, ${source_urls}::text[],
        'manual', TRUE, 'confirmed', 50,
        ${sql.json(breakdown as Parameters<typeof sql.json>[0])},
        ${sql.json(evidence as Parameters<typeof sql.json>[0])}
      )
      ON CONFLICT (id) DO UPDATE SET
        occurred_on      = EXCLUDED.occurred_on,
        weapon           = EXCLUDED.weapon,
        severity         = EXCLUDED.severity,
        summary          = EXCLUDED.summary,
        source_urls      = EXCLUDED.source_urls,
        origin           = 'manual',
        verified         = TRUE,
        confidence_tier  = 'confirmed',
        confidence_score = EXCLUDED.confidence_score,
        score_breakdown  = EXCLUDED.score_breakdown,
        evidence         = EXCLUDED.evidence
    `;
    logger.info(
      { event: "add_strike", id, infra_id, occurred_on, sources: source_urls.length, affected: res.count, confidence_tier: "confirmed" },
      "manual strike added (trusted source)",
    );
  } catch (err) {
    logger.error({ event: "add_strike_error", id, err: String(err) }, "manual strike insert failed");
    await sql.end({ timeout: 5 });
    process.exit(1);
  }

  await sql.end({ timeout: 5 });
}

void main();
