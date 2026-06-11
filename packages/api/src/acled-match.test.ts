// Unit tests for the pure ACLED event → facility matching/mapping logic.
// Pure module (no Bun/Postgres deps) — runnable with: node --test packages/api/src/acled-match.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchEventToFacility, mapAcledEvent, type AcledEvent, type FacilityPoint } from "./acled-match.ts";

// At lat ~55, 1 degree of latitude ≈ 111.195 km, so:
//   delta 0.0180° ≈ 2.0 km, delta 0.0450° ≈ 5.0 km, delta 0.1080° ≈ 12.0 km
const REFINERY: FacilityPoint = { id: "ryazan-refinery", kind: "refinery", lat: 55.0, lon: 39.0 };
const DEPOT: FacilityPoint = { id: "ryazan-depot", kind: "depot", lat: 55.05, lon: 39.0 };
const PIPELINE: FacilityPoint = { id: "druzhba", kind: "pipeline", lat: 55.0, lon: 39.0 };

function makeEvent(overrides: Partial<AcledEvent> = {}): AcledEvent {
  return {
    event_id_cnty: "RUS12345",
    event_date: "2026-06-01",
    event_type: "Explosions/Remote violence",
    sub_event_type: "Air/drone strike",
    latitude: 55.0,
    longitude: 39.0,
    notes: "An explosion was reported in the city.",
    source: "Astra",
    ...overrides,
  };
}

test("nearest of two facilities is chosen", () => {
  const ev = makeEvent({ latitude: 55.001 }); // ~0.11 km from refinery, ~5.4 km from depot
  const m = matchEventToFacility(ev, [DEPOT, REFINERY]);
  assert.ok(m);
  assert.equal(m.facility.id, "ryazan-refinery");
  assert.ok(m.distanceKm < 0.2);
});

test("pipelines are skipped even when nearest", () => {
  const ev = makeEvent({ latitude: 55.0 }); // 0 km from pipeline
  const m = matchEventToFacility(ev, [PIPELINE]);
  assert.equal(m, null);
  // and a farther point facility still wins over a co-located pipeline
  const m2 = matchEventToFacility(makeEvent({ latitude: 55.001 }), [PIPELINE, REFINERY]);
  assert.ok(m2);
  assert.equal(m2.facility.id, "ryazan-refinery");
});

test("event farther than 10 km matches nothing", () => {
  const ev = makeEvent({ latitude: 55.108, notes: "Drones struck the oil refinery." }); // ~12 km
  assert.equal(matchEventToFacility(ev, [REFINERY]), null);
});

test("5 km away WITHOUT an oil keyword in notes → null", () => {
  const ev = makeEvent({ latitude: 55.045, notes: "An explosion was heard near the city." }); // ~5 km
  assert.equal(matchEventToFacility(ev, [REFINERY]), null);
});

test("5 km away WITH an oil keyword in notes → match", () => {
  const ev = makeEvent({ latitude: 55.045, notes: "Drones attacked the oil refinery overnight." });
  const m = matchEventToFacility(ev, [REFINERY]);
  assert.ok(m);
  assert.equal(m.facility.id, "ryazan-refinery");
  assert.ok(m.distanceKm > 3 && m.distanceKm <= 10);
});

test("cyrillic keyword НПЗ also satisfies the oil-keyword rule", () => {
  const ev = makeEvent({ latitude: 55.045, notes: "Беспилотники атаковали НПЗ ночью." });
  const m = matchEventToFacility(ev, [REFINERY]);
  assert.ok(m);
  assert.equal(m.facility.id, "ryazan-refinery");
});

test("within 3 km without any keyword → match (proximity alone suffices)", () => {
  const ev = makeEvent({ latitude: 55.018, notes: "An explosion was heard." }); // ~2 km
  const m = matchEventToFacility(ev, [REFINERY]);
  assert.ok(m);
  assert.equal(m.facility.id, "ryazan-refinery");
  assert.ok(m.distanceKm <= 3);
});

test("weapon maps to uav when notes mention drone/UAV/БпЛА, else unknown", () => {
  assert.equal(mapAcledEvent(makeEvent({ notes: "A drone struck the depot." }), "ryazan-depot").weapon, "uav");
  assert.equal(mapAcledEvent(makeEvent({ notes: "UAV attack on fuel storage." }), "ryazan-depot").weapon, "uav");
  assert.equal(mapAcledEvent(makeEvent({ notes: "Атака БпЛА на нефтебазу." }), "ryazan-depot").weapon, "uav");
  assert.equal(mapAcledEvent(makeEvent({ notes: "An explosion damaged the depot." }), "ryazan-depot").weapon, "unknown");
});

test("summary is trimmed to 300 chars and suffixed with [auto: ACLED]", () => {
  const longNotes = "x".repeat(400);
  const c = mapAcledEvent(makeEvent({ notes: longNotes }), "ryazan-refinery");
  assert.equal(c.summary, "x".repeat(300) + " [auto: ACLED]");
  const short = mapAcledEvent(makeEvent({ notes: "  Short note.  " }), "ryazan-refinery");
  assert.equal(short.summary, "Short note. [auto: ACLED]");
});

test("candidate id is prefixed with acled- and fields map through", () => {
  const ev = makeEvent({ event_id_cnty: "RUS99999", event_date: "2026-05-30" });
  const c = mapAcledEvent(ev, "ryazan-refinery");
  assert.equal(c.id, "acled-RUS99999");
  assert.equal(c.infra_id, "ryazan-refinery");
  assert.equal(c.occurred_on, "2026-05-30");
  assert.deepEqual(c.source_urls, ["https://acleddata.com"]);
  assert.equal(c.raw.source, "Astra"); // original ACLED source string preserved in raw
});
