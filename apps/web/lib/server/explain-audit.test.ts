/**
 * A sweep, not a sample.
 *
 * Every defect found in this panel so far has been the drawer answering about
 * something other than the cell it was opened from — a different day, a
 * different series, the first of six orders, or the same quantity rounded a
 * second way. Each was found by opening one cell and reading it. This opens
 * every row of every bucket shape across a slice of the book and checks the
 * invariants that all of those violated.
 */

import { expect, test } from 'vitest';
import { explain, materialDetail } from './material';
import { runContext } from './context';

// Which arithmetic line is supposed to equal the grid cell the drawer was opened from.
const TOTAL_OF: Record<string, string> = {
  gross: 'Gross requirement',
  independent: 'Independent demand',
  dependent: 'From bill-of-material explosion',
  confirmed: 'Acknowledged by the vendor',
  committed: 'Ordered, not acknowledged',
  quarantine: 'of which clearing quality inspection',
  balanceBefore: 'Balance closing',
  balanceAfter: 'Balance closing',
  safetyStock: 'Safety stock',
  netRequirement: 'NET REQUIREMENT',
  plannedReceipt: 'PLANNED ORDER RECEIPT',
  cover: 'Days of cover',
};
const SUBROW = new Set(['lotSizing', 'release']);

test('every row explains the cell it was opened from, daily and weekly', () => {
  const ctx: any = runContext('baseline');
  const keys = [...(ctx.plan.plans.keys() as Iterable<string>)].slice(0, 60);

  const bad: string[] = [];
  let checked = 0;

  for (const key of keys) {
    const [itemId = '', plantId = ''] = key.split('@');
    const detail: any = materialDetail('baseline', itemId, plantId);
    if (!detail) continue;
    const buckets = detail.buckets;

    // weekly groups, the way the grid regroups them
    const weeks = new Map<string, number[]>();
    buckets.forEach((b: any, i: number) => {
      const list = weeks.get(b.week) ?? [];
      list.push(i);
      weeks.set(b.week, list);
    });

    const windows: Array<{ from: string; to: string; idx: number[] }> = [];
    for (const i of [0, 3, 21, 60, 91]) {
      if (buckets[i]) windows.push({ from: buckets[i].startDate, to: buckets[i].endDate, idx: [i] });
    }
    for (const wk of ['W36', 'W39', 'W43', 'W49']) {
      const idx = weeks.get(wk);
      if (idx && idx.length > 1) {
        const first = idx[0] as number;
        const last = idx[idx.length - 1] as number;
        windows.push({ from: buckets[first].startDate, to: buckets[last].endDate, idx });
      }
    }

    for (const row of detail.grid) {
      for (const w of windows) {
        const p: any = explain('baseline', itemId, plantId, { row: row.key, fromDate: w.from, toDate: w.to });
        if (!p) {
          bad.push(`${key} ${row.key} ${w.from}: null payload`);
          continue;
        }
        checked++;

        // 1. no broken numbers anywhere
        for (const l of p.arithmetic) {
          if (l.value !== null && !Number.isFinite(l.value))
            bad.push(`${key} ${row.key} ${w.from}: ${l.label} = ${l.value}`);
          if (typeof l.label !== 'string' || l.label.length === 0) bad.push(`${key} ${row.key} ${w.from}: empty label`);
        }
        if (typeof p.sentence !== 'string' || p.sentence.length < 10)
          bad.push(`${key} ${row.key} ${w.from}: bad sentence`);

        // 2. the drawer total agrees with the cell it was opened from
        const wanted = TOTAL_OF[row.key];
        if (wanted && !SUBROW.has(row.key)) {
          const cell =
            row.aggregate === 'SUM'
              ? w.idx.reduce((s, i) => s + (row.values[i] ?? 0), 0)
              : (row.values[w.idx[w.idx.length - 1] as number] ?? 0);
          const l = p.arithmetic.find((x: any) => x.label.startsWith(wanted));
          if (!l) bad.push(`${key} ${row.key} ${w.from}: no "${wanted}" line`);
          else if (Math.abs((l.value ?? 0) - cell) > 0.51) {
            bad.push(
              `${key} ${row.key} ${w.from}${w.idx.length > 1 ? '..wk' : ''}: cell ${Math.round(cell)} vs drawer ${Math.round(l.value)}`,
            );
          }
        }

        // 3. shares of a total are never negative
        for (const l of p.arithmetic) {
          if (/^(Independent demand|From bill-of-material explosion)/.test(l.label) && (l.value ?? 0) < -0.5) {
            bad.push(`${key} ${row.key} ${w.from}: negative share ${l.label}=${l.value}`);
          }
        }

        // 4. where both exist, the chain lands on the gross requirement shown
        const gr = p.arithmetic.find((x: any) => x.label.startsWith('Gross requirement'));
        if (gr && p.chain.length > 0) {
          const endQty = p.chain[p.chain.length - 1].resultQty;
          if (Math.abs(endQty - (gr.value ?? 0)) > 0.51) {
            bad.push(`${key} ${row.key} ${w.from}: chain ends ${Math.round(endQty)} vs gross ${Math.round(gr.value)}`);
          }
        }
      }
    }
  }

  expect(checked).toBeGreaterThan(3000);
  expect(bad.slice(0, 20)).toEqual([]);
});
