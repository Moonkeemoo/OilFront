// Pure matcher: NASA FIRMS thermal anomalies → per-facility aggregates.
// Conservative "active" flag suppresses single agricultural/flare pixels.
// No network. Reuses haversineNm from zones.ts.
import { haversineNm } from "./zones.ts";

export interface FirePoint { lat: number; lon: number; confidence: string; frp: number; acq_date: string; daynight: string; }
export interface FacilityPoint { id: string; lat: number; lon: number; }
export interface FireAggregate { count: number; max_frp: number; max_confidence: string; last_date: string; active: boolean; active_now: boolean; }

const NM_TO_KM = 1.852;
const CONF_RANK: Record<string, number> = { l: 0, n: 1, h: 2 };
const ACTIVE_FRP_THRESHOLD = 20;

// Subset of points within radiusKm of ANY facility — so the map draws thermal
// anomalies only inside oil-infrastructure zones, not the global agricultural /
// flare firehose (most FIRMS points over Russia are unrelated field fires).
export function filterNearFacilities(points: FirePoint[], facilities: FacilityPoint[], radiusKm = 5): FirePoint[] {
  return points.filter((p) =>
    facilities.some((f) => haversineNm(p.lat, p.lon, f.lat, f.lon) * NM_TO_KM <= radiusKm),
  );
}

// Returns the absolute day difference between two "YYYY-MM-DD" strings using UTC math.
function utcDaysBetween(a: string, b: string): number {
  const da = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const db = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.abs((da - db) / 86_400_000);
}

export function matchFiresToFacilities(points: FirePoint[], facilities: FacilityPoint[], radiusKm = 3, asOfDate?: string): Record<string, FireAggregate> {
  const out: Record<string, FireAggregate> = {};
  for (const p of points) {
    let best: FacilityPoint | null = null;
    let bestKm = Infinity;
    for (const f of facilities) {
      const km = haversineNm(p.lat, p.lon, f.lat, f.lon) * NM_TO_KM;
      if (km <= radiusKm && km < bestKm) { bestKm = km; best = f; }
    }
    if (!best) continue;
    const cur = out[best.id] ?? { count: 0, max_frp: 0, max_confidence: "l", last_date: "", active: false, active_now: false };
    cur.count += 1;
    if (p.frp > cur.max_frp) cur.max_frp = p.frp;
    if ((CONF_RANK[p.confidence] ?? 0) > (CONF_RANK[cur.max_confidence] ?? 0)) cur.max_confidence = p.confidence;
    if (p.acq_date > cur.last_date) cur.last_date = p.acq_date;
    out[best.id] = cur;
  }
  for (const id of Object.keys(out)) {
    const a = out[id]!;
    const goodConf = (CONF_RANK[a.max_confidence] ?? 0) >= 1; // nominal or high
    a.active = goodConf && (a.count >= 2 || a.max_frp >= ACTIVE_FRP_THRESHOLD);
    // active_now: heat must also be fresh (today or yesterday UTC). If asOfDate is
    // omitted (back-compat), fall back to active so existing callers are unchanged.
    a.active_now = asOfDate
      ? (a.active && utcDaysBetween(asOfDate, a.last_date) <= 1)
      : a.active;
  }
  return out;
}
