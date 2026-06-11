// Pure helper for the Impact page's monthly time-series (/api/impact).
// No Bun/Postgres deps so it stays unit-testable with `node --test`.

export interface MonthlyPoint {
  month: string; // "YYYY-MM"
  strikes: number;
  facilities: number;
}

// Fill gaps in a "YYYY-MM" → counts series so it runs continuously from `from`
// (a "YYYY-MM") through the month of `now` (defaults to current date), inserting
// zero-rows for any missing month. The DB GROUP BY only emits months that had at
// least one strike; this keeps the chart a continuous sequence with no holes.
export function fillMonthlySeries(
  rows: MonthlyPoint[],
  from: string,
  now: Date = new Date(),
): MonthlyPoint[] {
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const [fy, fm] = from.split("-").map((n) => parseInt(n, 10));
  const out: MonthlyPoint[] = [];
  let y = fy!;
  let m = fm!; // 1-12
  const endY = now.getUTCFullYear();
  const endM = now.getUTCMonth() + 1; // 1-12
  while (y < endY || (y === endY && m <= endM)) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(byMonth.get(key) ?? { month: key, strikes: 0, facilities: 0 });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
