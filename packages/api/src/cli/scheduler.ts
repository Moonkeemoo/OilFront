// Scheduler CLI entry — mirrors the ingest.ts → ingestor.ts pairing.
// Long-lived process: runs RSS/FIRMS-trigger/GDELT loaders on staggered intervals.
//
// Run:  bun run scheduler
//
// Requires:
//   DATABASE_URL — Postgres must be up (loaders each open+close their own connection)
//   FIRMS_MAP_KEY — optional; the FIRMS-triggered feed is skipped and logged if absent

import { logger } from "../log.ts";
import { startScheduler } from "../scheduler.ts";

const firmsEnabled = !!process.env.FIRMS_MAP_KEY;

if (!firmsEnabled) {
  logger.info(
    { event: "scheduler_firms_disabled" },
    "FIRMS_MAP_KEY not set — FIRMS-triggered feed will be skipped; set the key to enable it",
  );
}

startScheduler({ firmsEnabled });
