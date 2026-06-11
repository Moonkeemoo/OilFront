import { test } from "node:test";
import assert from "node:assert/strict";
import { matchFiresToFacilities, type FirePoint, type FacilityPoint } from "./fires-match.ts";

const FAC: FacilityPoint[] = [
  { id: "ryazan-refinery", lat: 54.56, lon: 39.79 },
  { id: "tuapse-refinery", lat: 44.10, lon: 39.07 },
];
function fp(lat: number, lon: number, conf: string, frp: number, date = "2026-06-10"): FirePoint {
  return { lat, lon, confidence: conf, frp, acq_date: date, daynight: "D" };
}

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
