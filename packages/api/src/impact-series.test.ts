// Unit tests for the Impact-page monthly-series gap-filler.
// Pure module (no Bun/Postgres deps) — runnable with: node --test packages/api/src/impact-series.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fillMonthlySeries } from "./impact-series.ts";

const NOW = new Date(Date.UTC(2026, 5, 11)); // 2026-06-11 (month index 5 = June)

test("fills missing months with zeros, preserves existing rows", () => {
  const rows = [
    { month: "2022-01", strikes: 2, facilities: 1 },
    { month: "2022-04", strikes: 5, facilities: 3 },
  ];
  const out = fillMonthlySeries(rows, "2022-01", new Date(Date.UTC(2022, 3, 1))); // through 2022-04
  assert.deepEqual(out, [
    { month: "2022-01", strikes: 2, facilities: 1 },
    { month: "2022-02", strikes: 0, facilities: 0 },
    { month: "2022-03", strikes: 0, facilities: 0 },
    { month: "2022-04", strikes: 5, facilities: 3 },
  ]);
});

test("series is continuous from 2022-01 through the current month", () => {
  const out = fillMonthlySeries([], "2022-01", NOW);
  // 2022-01 .. 2026-06 inclusive = 4 full years (48) + Jan..Jun 2026 (6) = 54
  assert.equal(out.length, 54);
  assert.equal(out[0]!.month, "2022-01");
  assert.equal(out[out.length - 1]!.month, "2026-06");
});

test("crosses year boundaries with zero-padded months", () => {
  const out = fillMonthlySeries([], "2022-11", new Date(Date.UTC(2023, 1, 1))); // through 2023-02
  assert.deepEqual(out.map((r) => r.month), ["2022-11", "2022-12", "2023-01", "2023-02"]);
});

test("single-month range returns exactly that month", () => {
  const out = fillMonthlySeries([{ month: "2024-03", strikes: 7, facilities: 4 }], "2024-03", new Date(Date.UTC(2024, 2, 15)));
  assert.deepEqual(out, [{ month: "2024-03", strikes: 7, facilities: 4 }]);
});
