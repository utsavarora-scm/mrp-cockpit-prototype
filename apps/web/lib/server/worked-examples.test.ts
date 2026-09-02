/**
 * The two worked examples, asserted where the screens actually read them.
 *
 * Everything below goes through `materialDetail` and `scheduleBuilder` — the
 * same functions the routes call — rather than through a hand-built fixture.
 * That distinction is the whole point of this file: the packaging hero's unit
 * test opened on the 260,000 pieces the PRD states while the app opened on
 * 300,837, because the fixture was right and the data reaching it was not.
 * A test that cannot see that gap is not testing the demo.
 *
 * Where a figure differs from the PRD's printed table it is stated here with
 * the reason, and the tolerance is on the *input* rather than the arithmetic:
 * the requirement is a computed quantity three bill-of-material levels below a
 * daily demand that rounds to whole units, so it lands within a few tonnes of
 * the illustrative number rather than exactly on it. What must be exact is that
 * every row foots against every other — which is §15's actual criterion, and
 * which is asserted absolutely.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { HERO_PM, HERO_RM } from '@repo/data-packs';

import { explain, materialDetail } from './material';
import { scheduleBuilder } from './schedule';
import { resetDemo } from './planning-session';
import type { GridRow, MaterialDetail } from '../api-types';

/**
 * Tonnes of slack on a requirement exploded through three levels of a BOM.
 *
 * The oil's requirement is what every soap bar pulls through a shared noodle,
 * and the other bars are seeded rather than pinned, so the pinned ramp carries
 * the residual and lands within a few tonnes of the printed table. The
 * packaging hero has no such tolerance — see below.
 */
const MT = 5;

let oil: MaterialDetail;

beforeAll(() => {
  resetDemo();
  oil = materialDetail('baseline', HERO_RM.itemId, HERO_RM.plantId) as MaterialDetail;
  expect(oil).not.toBeNull();
});

/** A grid row by key, collapsed to the eight weeks the worked example covers. */
function weeks(detail: MaterialDetail, key: string): number[] {
  const row = detail.grid.find((entry) => entry.key === key) as GridRow;
  expect(row, `grid row ${key}`).toBeDefined();

  const byWeek = new Map<string, number[]>();
  const order: string[] = [];
  for (const bucket of detail.buckets) {
    if (!byWeek.has(bucket.week)) {
      byWeek.set(bucket.week, []);
      order.push(bucket.week);
    }
    (byWeek.get(bucket.week) as number[]).push(bucket.index);
  }

  return order.slice(0, 8).map((week) => {
    const indexes = byWeek.get(week) as number[];
    return row.aggregate === 'SUM'
      ? Math.round(indexes.reduce((sum, index) => sum + (row.values[index] ?? 0), 0))
      : Math.round(row.values[indexes[indexes.length - 1] as number] ?? 0);
  });
}

/** The status word each of the first eight weeks ends on. */
function weeklyStatus(detail: MaterialDetail): string[] {
  const seen = new Map<string, string>();
  const order: string[] = [];
  for (const bucket of detail.buckets) {
    if (!seen.has(bucket.week)) order.push(bucket.week);
    seen.set(bucket.week, bucket.status);
  }
  return order.slice(0, 8).map((week) => seen.get(week) as string);
}

describe('hero A — RM-30114, the grid the demo reads row by row', () => {
  it('opens on the stock and the buffer the material master holds', () => {
    expect(oil.grid.find((row) => row.key === 'safetyStock')?.values[0]).toBe(HERO_RM.safetyStock);
    expect(weeks(oil, 'gross')[0]).toBeCloseTo(HERO_RM.weeklyRequirement[0], -1);
  });

  it('rises through the pre-summer build the PRD states', () => {
    // The pinned series, less what the other soap bars pull through the shared
    // noodle. Within a few tonnes of the printed table at every week.
    const gross = weeks(oil, 'gross');
    HERO_RM.weeklyRequirement.forEach((target, index) => {
      expect(Math.abs((gross[index] as number) - target), `W${36 + index}: ${gross[index]} vs ${target}`).toBeLessThan(
        MT,
      );
    });
  });

  it('nets the open order against its delivery lines, not one header date', () => {
    // W37 is the quality release, W38 and W41 the two lines of PO 4700221.
    // Read against the header date alone, all 2,300 MT would land in W41 and
    // three weeks would look covered that are not.
    // Rows 4 and 5 are the whole of scheduled receipts; row 6 re-states the
    // part of them still in quality inspection, so adding it counts it twice.
    const receipts = weeks(oil, 'confirmed').map((value, index) => value + (weeks(oil, 'committed')[index] as number));
    expect(receipts[1]).toBe(HERO_RM.quarantineQty);
    expect(weeks(oil, 'quarantine')[1]).toBe(HERO_RM.quarantineQty);
    expect(receipts[2]).toBe(HERO_RM.openPoLines[0].qty);
    expect(receipts[5]).toBe(HERO_RM.openPoLines[1].qty);
    expect(receipts[3]).toBe(0);
    expect(receipts[4]).toBe(0);
  });

  it('falls through safety stock in W39 and goes negative in W42', () => {
    const balance = weeks(oil, 'balanceBefore');
    const safetyStock = HERO_RM.safetyStock;

    expect(balance.findIndex((value) => value < safetyStock)).toBe(3);
    expect(balance.findIndex((value) => value < 0)).toBe(6);
    expect(weeklyStatus(oil).slice(3, 7)).toEqual(['BREACH', 'BREACH', 'BREACH', 'STOCK_OUT']);
  });

  it('raises the requirement in W39 — the order a later, unconfirmed line used to erase', () => {
    // (800 + 1,400) − (2,080 + 0) = 120 in the PRD. The app nets the same
    // arithmetic on a requirement a few tonnes away from the printed one.
    const netRequirement = weeks(oil, 'netRequirement');
    expect(netRequirement[3]).toBeGreaterThan(100);
    expect(netRequirement[3]).toBeLessThan(140);
    expect(netRequirement.slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('orders 1,000 MT because the vessel parcel is 1,000, not because 120 is needed', () => {
    expect(weeks(oil, 'plannedReceipt')[3]).toBe(1_000);
    expect(weeks(oil, 'plannedReceipt')[4]).toBe(1_000);

    // Need and rule, never merged: the addition is what the minimum parcel put
    // on top of the shortfall.
    const requirement = weeks(oil, 'netRequirement')[3] as number;
    expect(weeks(oil, 'lotSizing')[3]).toBe(1_000 - requirement);
  });

  it('says the W39 order needed releasing in W26, under the week it is needed', () => {
    const row = oil.grid.find((entry) => entry.key === 'release') as GridRow;
    expect(row.cells).toBeDefined();

    const w39 = oil.buckets.filter((bucket) => bucket.week === 'W39').map((bucket) => bucket.index);
    const annotations = w39.flatMap((index) => row.cells?.[index] ?? []);

    expect(annotations.length).toBeGreaterThan(0);
    for (const cell of annotations) {
      expect(cell.releaseWeek).toBe('W26');
      expect(cell.tone).toBe('PAST');
      expect(cell.weeksLate).toBeGreaterThanOrEqual(9);
    }
  });

  it('cannot be fixed by ordering — the order it proposes needed placing in June', () => {
    expect(oil.recommendation).not.toBeNull();
    const recommendation = oil.recommendation as NonNullable<typeof oil.recommendation>;

    expect(recommendation.qty).toBe(1_000);
    expect(recommendation.receiptWeek).toBe('W39');
    expect(recommendation.releaseWeek).toBe('W26');
    expect(recommendation.isReleaseInPast).toBe(true);
    expect(recommendation.weeksLate).toBeGreaterThanOrEqual(9);
    expect(recommendation.leadTimeDays).toBe(HERO_RM.maintainedLeadTimeDays);
  });

  it('draws the fence ten weeks right of the breach', () => {
    expect(oil.fences.maintained.earliestReceiptWeek).toBe('W49');
    expect(oil.fences.measured?.earliestReceiptWeek).toBe('W51');
  });

  it('shows the plan its own orders would produce, and the one they cannot', () => {
    // Row 13 counts every proposal, including the unplaceable ones — which is
    // what makes it the PRD's "if everything proposed is actually done".
    const after = weeks(oil, 'balanceAfter');
    const safetyStock = HERO_RM.safetyStock;
    for (const value of after.slice(0, 8)) expect(value).toBeGreaterThan(safetyStock);

    // And the honest counterpart still goes negative, because none of those
    // orders can be placed. Both facts on one screen is the point.
    expect(oil.buckets.some((bucket) => bucket.balanceAfterPlaceable < 0)).toBe(true);
  });

  it('foots: every row reconciles to the one above it, exactly', () => {
    const gross = weeks(oil, 'gross');
    const receipts = weeks(oil, 'confirmed').map((value, index) => value + (weeks(oil, 'committed')[index] as number));
    const before = weeks(oil, 'balanceBefore');
    const planned = weeks(oil, 'plannedReceipt');
    const after = weeks(oil, 'balanceAfter');

    // Displayed components sum to displayed totals. Everywhere, always.
    let opening: number = HERO_RM.openingStock;
    for (let week = 0; week < 8; week += 1) {
      const closing = opening + (receipts[week] as number) - (gross[week] as number);
      expect(Math.abs(closing - (before[week] as number)), `balance before, week ${week}`).toBeLessThanOrEqual(1);
      opening = before[week] as number;
    }

    let openingAfter: number = HERO_RM.openingStock;
    for (let week = 0; week < 8; week += 1) {
      const closing = openingAfter + (receipts[week] as number) + (planned[week] as number) - (gross[week] as number);
      expect(Math.abs(closing - (after[week] as number)), `balance after, week ${week}`).toBeLessThanOrEqual(1);
      openingAfter = after[week] as number;
    }

    // Row 9 against rows 10 and 11: what was needed, plus what a rule added.
    const requirement = weeks(oil, 'netRequirement');
    const lotSizing = weeks(oil, 'lotSizing');
    for (let week = 0; week < 8; week += 1) {
      if ((planned[week] as number) === 0) continue;
      expect((requirement[week] as number) + (lotSizing[week] as number)).toBe(planned[week]);
    }
  });
});

describe('hero B — PM-88431, the schedule the builder is built on', () => {
  it('opens the campaign on the position the worked example states', () => {
    const view = scheduleBuilder('baseline', HERO_PM.itemId, HERO_PM.plantId);
    expect(view).not.toBeNull();
    expect((view as NonNullable<typeof view>).openingBalance).toBe(260_000);
    expect((view as NonNullable<typeof view>).safetyStock).toBe(HERO_PM.safetyStock);
    expect((view as NonNullable<typeof view>).window.fromWeek).toBe('W37');
  });

  it('wants six deliveries totalling 1,090,000 — the statement of need', () => {
    const view = scheduleBuilder('baseline', HERO_PM.itemId, HERO_PM.plantId) as NonNullable<
      ReturnType<typeof scheduleBuilder>
    >;
    const ideal = view.lines.slice(0, 6).map((line) => line.idealQty);

    expect(ideal).toHaveLength(6);
    // Line 10 is 100,000 rather than 20,000 because the minimum call-off floors
    // it. That +80,000 is a lot-sizing addition, not a requirement.
    expect(ideal).toEqual([100_000, 130_000, 240_000, 240_000, 200_000, 180_000]);
    expect(view.lines[0]?.lotSizingAddition).toBe(80_000);
    expect(ideal.reduce((sum, qty) => sum + qty, 0)).toBe(1_090_000);
  });

  it('commits what the warehouse can actually hold, and names it', () => {
    const view = scheduleBuilder('baseline', HERO_PM.itemId, HERO_PM.plantId) as NonNullable<
      ReturnType<typeof scheduleBuilder>
    >;

    // The PRD's committed column, cell for cell.
    expect(view.lines.map((line) => line.committedQty)).toEqual([240_000, 210_000, 0, 240_000, 220_000, 180_000]);
    expect(view.lines.map((line) => line.delta)).toEqual([140_000, 80_000, -240_000, 0, 20_000, 0]);
    expect(view.lines.map((line) => line.balanceAfter)).toEqual([320_000, 320_000, 80_000, 80_000, 100_000, 100_000]);

    // The vendor could supply 250,000 in each of W37 and W38. The plant can
    // hold 320,000 of this item at once. That gap is the finding.
    const storage = view.constraints.find((row) => row.key === 'STORAGE_CAP');
    expect(storage?.binding).toBe(true);
    expect(storage?.value).toBe(HERO_PM.storageCapacity);

    const vendorCapacity = view.constraints.find((row) => row.key === 'VENDOR_CAPACITY');
    expect(vendorCapacity?.binding).toBe(false);

    expect(view.ledger.join(' ')).toMatch(/warehouse|storage/i);
  });

  it('moves the shutdown week out and says why', () => {
    const view = scheduleBuilder('baseline', HERO_PM.itemId, HERO_PM.plantId) as NonNullable<
      ReturnType<typeof scheduleBuilder>
    >;
    const shutdown = view.lines.find((line) => line.week === 'W39');
    expect(shutdown?.committedQty).toBe(0);
    expect(shutdown?.constraint).toBe('VENDOR_SHUTDOWN');
  });

  it('keeps the two schedules footing — constraints move quantity, they do not delete it', () => {
    const view = scheduleBuilder('baseline', HERO_PM.itemId, HERO_PM.plantId) as NonNullable<
      ReturnType<typeof scheduleBuilder>
    >;
    expect(view.totals.ideal).toBe(view.totals.committed);
    expect(view.totals.delta).toBe(0);

    // And every line's delta is the difference it claims to be.
    for (const line of view.lines) {
      expect(Math.abs(line.committedQty - line.idealQty - line.delta)).toBeLessThanOrEqual(1);
    }
  });

  it('states the residual honestly: below the buffer, never stocked out', () => {
    const view = scheduleBuilder('baseline', HERO_PM.itemId, HERO_PM.plantId) as NonNullable<
      ReturnType<typeof scheduleBuilder>
    >;
    expect(view.residual).not.toBeNull();
    const residual = view.residual as NonNullable<typeof view.residual>;

    expect(residual.shortfall).toBe(20_000);
    expect(residual.shortfallDays).toBeLessThan(1);
    expect(residual.stocksOut).toBe(false);
    expect(residual.weeks).toContain('W39');
  });
});

describe('explain — every number, and every block that foots', () => {
  it('opens on the cell it was asked about, not on the material', () => {
    const w39 = oil.buckets.find((bucket) => bucket.week === 'W39');
    expect(w39).toBeDefined();

    const cell = explain('baseline', HERO_RM.itemId, HERO_RM.plantId, {
      row: 'netRequirement',
      fromDate: (w39 as NonNullable<typeof w39>).startDate,
      toDate: oil.buckets.filter((bucket) => bucket.week === 'W39').slice(-1)[0]?.endDate,
    });

    expect(cell?.anchor?.row).toBe('netRequirement');
    expect(cell?.anchor?.week).toBe('W39');
    expect(cell?.arithmetic.some((line) => line.label === 'NET REQUIREMENT')).toBe(true);
  });

  it('explains a different row differently, which is the whole point', () => {
    const w39 = oil.buckets.find((bucket) => bucket.week === 'W39') as NonNullable<(typeof oil.buckets)[number]>;
    const labels = (row: string): string[] =>
      (explain('baseline', HERO_RM.itemId, HERO_RM.plantId, { row, fromDate: w39.startDate })?.arithmetic ?? []).map(
        (line) => line.label,
      );

    expect(labels('gross')).not.toEqual(labels('balanceBefore'));
    expect(labels('cover')).not.toEqual(labels('netRequirement'));
    expect(labels('safetyStock').join(' ')).toMatch(/Safety stock/);
  });

  it('foots: every block‘s operands sum to the total it states', () => {
    // §15's correctness criterion, as a test. The arithmetic used to print a
    // literal `+0` for scheduled receipts under a heading promising exactly
    // this, which is the kind of thing that loses a room.
    const payload = explain('baseline', HERO_RM.itemId, HERO_RM.plantId);
    expect(payload).not.toBeNull();

    let running: number | null = null;
    for (const line of (payload as NonNullable<typeof payload>).arithmetic) {
      if (line.value === null) continue;
      if (line.operator === '') {
        running = line.value;
        continue;
      }
      if (line.operator === '+') running = (running ?? 0) + line.value;
      if (line.operator === '−') running = (running ?? 0) - line.value;
      if (line.operator === '=') {
        expect(Math.abs((running ?? 0) - line.value), `${line.label}: ${running} vs ${line.value}`).toBeLessThanOrEqual(
          1,
        );
        running = line.value;
      }
    }
  });

  it('names who last touched every parameter, not only when', () => {
    const payload = explain('baseline', HERO_RM.itemId, HERO_RM.plantId) as NonNullable<ReturnType<typeof explain>>;
    expect(payload.provenance.length).toBeGreaterThan(0);
    for (const row of payload.provenance) {
      expect(row.changedBy.length, `${row.field} has no owner`).toBeGreaterThan(0);
      expect(row.lastChangedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
