// Pure ACLED event → oil_infra facility matching and strike-candidate mapping.
// Spec: docs/superpowers/specs/2026-06-11-acled-strikes-feed-design.md
//
// Matching rule: nearest point facility (pipelines skipped) within maxKm (10 km
// default) by haversine; accepted only if the distance is ≤ 3 km OR the event
// notes look oil-related — ACLED geocodes to city centroids, so the keyword
// check carries most of the precision.
//
// No Bun/Postgres deps — unit-testable with node --test.

import { haversineNm } from "./zones.ts";

const NM_TO_KM = 1.852;
const OIL_KEYWORDS = /refinery|oil depot|fuel|НПЗ|нефтебаз|oil terminal|petroleum/i;
const UAV_KEYWORDS = /drone|uav|бпла/i;
const SUMMARY_MAX = 300;

export interface AcledEvent {
  event_id_cnty: string;
  event_date: string; // "YYYY-MM-DD"
  event_type: string;
  sub_event_type: string;
  latitude: number;
  longitude: number;
  notes: string;
  source: string;
}

export interface FacilityPoint {
  id: string;
  kind: string;
  lat: number;
  lon: number;
}

export interface StrikeCandidate {
  id: string; // "acled-<event_id_cnty>"
  infra_id: string;
  occurred_on: string;
  weapon: "uav" | "unknown";
  summary: string;
  source_urls: string[];
  raw: Record<string, unknown>;
}

/**
 * Nearest non-pipeline facility within maxKm of the event, accepted only when
 * distance ≤ 3 km or the notes mention an oil-related keyword. Null otherwise.
 */
export function matchEventToFacility(
  ev: AcledEvent,
  facilities: FacilityPoint[],
  maxKm = 10,
): { facility: FacilityPoint; distanceKm: number } | null {
  let best: { facility: FacilityPoint; distanceKm: number } | null = null;
  for (const f of facilities) {
    if (f.kind === "pipeline") continue;
    const distanceKm = haversineNm(ev.latitude, ev.longitude, f.lat, f.lon) * NM_TO_KM;
    if (distanceKm > maxKm) continue;
    if (!best || distanceKm < best.distanceKm) best = { facility: f, distanceKm };
  }
  if (!best) return null;
  if (best.distanceKm <= 3 || OIL_KEYWORDS.test(ev.notes)) return best;
  return null;
}

/** Maps a matched ACLED event to an infra_strikes candidate row. */
export function mapAcledEvent(ev: AcledEvent, infraId: string): StrikeCandidate {
  const notes = ev.notes.trim();
  const base = notes.length > SUMMARY_MAX ? notes.slice(0, SUMMARY_MAX) : notes;
  return {
    id: `acled-${ev.event_id_cnty}`,
    infra_id: infraId,
    occurred_on: ev.event_date,
    weapon: UAV_KEYWORDS.test(ev.notes) ? "uav" : "unknown",
    summary: `${base} [auto: ACLED]`,
    source_urls: ["https://acleddata.com"],
    raw: { ...ev },
  };
}
