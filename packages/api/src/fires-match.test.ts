import { test } from "node:test";
import assert from "node:assert/strict";
import { matchFiresToFacilities, filterNearFacilities, type FirePoint, type FacilityPoint } from "./fires-match.ts";

const FAC: FacilityPoint[] = [
  { id: "ryazan-refinery", lat: 54.56, lon: 39.79 },
  { id: "tuapse-refinery", lat: 44.10, lon: 39.07 },
];
function fp(lat: number, lon: number, conf: string, frp: number, date = "2026-06-10"): FirePoint {
  return { lat, lon, confidence: conf, frp, acq_date: date, daynight: "D" };
}

test("filterNearFacilities keeps only points within radius of a facility", () => {
  const near = filterNearFacilities([fp(54.56, 39.79, "h", 10), fp(20, 20, "h", 10)], FAC, 5);
  assert.equal(near.length, 1);
  assert.equal(near[0]!.lat, 54.56);
});
test("point within radius attaches to nearest facility", () => {
  const m = matchFiresToFacilities([fp(54.561, 39.791, "h", 12)], FAC, 3);
  assert.equal(m["ryazan-refinery"]!.count, 1);
  assert.equal(m["tuapse-refinery"], undefined);
});
test("point beyond radius is dropped", () => {
  const m = matchFiresToFacilities([fp(55.5, 40.5, "h", 12)], FAC, 3);
  assert.deepEqual(m, {});
});
test("aggregates count, max_frp, max_confidence, last_date", () => {
  const m = matchFiresToFacilities([fp(54.56, 39.79, "n", 5, "2026-06-08"), fp(54.561, 39.79, "h", 30, "2026-06-10")], FAC, 3);
  const a = m["ryazan-refinery"]!;
  assert.equal(a.count, 2); assert.equal(a.max_frp, 30); assert.equal(a.max_confidence, "h"); assert.equal(a.last_date, "2026-06-10");
});
test("active flag: single low-confidence pixel is NOT active", () => {
  const m = matchFiresToFacilities([fp(54.56, 39.79, "l", 2)], FAC, 3);
  assert.equal(m["ryazan-refinery"]!.active, false);
});
test("active flag: two nominal+ detections IS active", () => {
  const m = matchFiresToFacilities([fp(54.56, 39.79, "n", 4), fp(54.561, 39.79, "n", 4)], FAC, 3);
  assert.equal(m["ryazan-refinery"]!.active, true);
});
test("active flag: single high-FRP high-confidence detection IS active", () => {
  const m = matchFiresToFacilities([fp(54.56, 39.79, "h", 50)], FAC, 3);
  assert.equal(m["ryazan-refinery"]!.active, true);
});

// active_now freshness tests
const AS_OF = "2026-06-12";
function threePixels(date: string): FirePoint[] {
  return [fp(54.56, 39.79, "n", 5, date), fp(54.561, 39.79, "n", 5, date), fp(54.562, 39.79, "n", 5, date)];
}
test("active_now: last_date == asOfDate (today) → true", () => {
  const m = matchFiresToFacilities(threePixels(AS_OF), FAC, 3, AS_OF);
  const a = m["ryazan-refinery"]!;
  assert.equal(a.active, true);
  assert.equal(a.active_now, true);
});
test("active_now: last_date == asOfDate-1 (yesterday) → true", () => {
  const m = matchFiresToFacilities(threePixels("2026-06-11"), FAC, 3, AS_OF);
  const a = m["ryazan-refinery"]!;
  assert.equal(a.active, true);
  assert.equal(a.active_now, true);
});
test("active_now: last_date == asOfDate-3 (still in 3-day window, active true) → active_now FALSE", () => {
  const m = matchFiresToFacilities(threePixels("2026-06-09"), FAC, 3, AS_OF);
  const a = m["ryazan-refinery"]!;
  assert.equal(a.active, true);
  assert.equal(a.active_now, false);
});
test("active_now: facility below active threshold → active_now false", () => {
  // single low-confidence pixel: active=false, so active_now must also be false
  const m = matchFiresToFacilities([fp(54.56, 39.79, "l", 2, AS_OF)], FAC, 3, AS_OF);
  const a = m["ryazan-refinery"]!;
  assert.equal(a.active, false);
  assert.equal(a.active_now, false);
});
test("active_now: omitting asOfDate → active_now === active (back-compat)", () => {
  // active case
  const m1 = matchFiresToFacilities(threePixels("2026-06-09"), FAC, 3);
  assert.equal(m1["ryazan-refinery"]!.active_now, m1["ryazan-refinery"]!.active);
  // inactive case
  const m2 = matchFiresToFacilities([fp(54.56, 39.79, "l", 2)], FAC, 3);
  assert.equal(m2["ryazan-refinery"]!.active_now, m2["ryazan-refinery"]!.active);
});
