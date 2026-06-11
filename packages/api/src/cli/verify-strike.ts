// Curation CLI for ACLED strike candidates (origin='acled' rows in
// infra_strikes, inserted unverified by load-acled-strikes.ts).
// Spec: docs/superpowers/specs/2026-06-11-acled-strikes-feed-design.md
//
// Run:
//   bun run verify-strike acled-RUS12345            # promote: verified=TRUE
//   bun run verify-strike --reject acled-RUS12345   # delete the candidate
import { sql } from "../db.ts";
import { logger } from "../log.ts";

function usage(): void {
  console.error("Usage: bun run verify-strike <id>            promote an ACLED candidate (verified=TRUE)");
  console.error("       bun run verify-strike --reject <id>   delete an ACLED candidate");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const reject = args[0] === "--reject";
  const id = reject ? args[1] : args[0];
  if (!id) {
    usage();
    process.exit(1);
  }

  if (!sql) {
    logger.error({ event: "no_db" }, "DATABASE_URL not set");
    process.exit(1);
  }

  if (reject) {
    const res = await sql`DELETE FROM infra_strikes WHERE id = ${id} AND origin = 'acled'`;
    logger.info({ event: "strike_rejected", id, affected: res.count }, "ACLED candidate deleted");
  } else {
    const res = await sql`UPDATE infra_strikes SET verified = TRUE WHERE id = ${id} AND origin = 'acled'`;
    logger.info({ event: "strike_verified", id, affected: res.count }, "ACLED candidate verified");
  }
  await sql.end({ timeout: 5 });
}

void main();
