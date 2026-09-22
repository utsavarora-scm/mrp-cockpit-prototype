/**
 * The drawer has to explain the cell it was opened from.
 *
 * Every number in the panel is read next to the grid row it came from, so a
 * block that quotes a different total than the cell above it is worse than no
 * block at all: it teaches the reader that the two disagree and leaves them to
 * guess which is wrong.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { explain, materialDetail } from './material';
import { resetDemo } from './planning-session';

const W36 = { fromDate: '2026-08-31', toDate: '2026-09-06' };
const ITEM = { itemId: 'FG-10074', plantId: 'M014' };

const line = (rows: Array<{ label: string; value: number | null }>, label: string) =>
  rows.find((row) => row.label.startsWith(label));

const weekly = (row: string) => explain('baseline', ITEM.itemId, ITEM.plantId, { row, ...W36 });

describe('the explain drawer', () => {
  beforeEach(() => {
    resetDemo();
  });

  it('totals a week of planned receipts, rather than explaining the first of them', () => {
    // Six receipts land in W36 and the cell sums them. Handing that cell the
    // first order explained 6,656 EA under a total of 52,793 EA, and the row
    // beside it disagreed with its own drawer.
    const payload = weekly('plannedReceipt');
    expect(payload).not.toBeNull();

    const total = line(payload!.arithmetic, 'PLANNED ORDER RECEIPT');
    expect(total?.value).toBeCloseTo(52793, 0);

    // And the components foot to it, which is what the panel promises.
    const parts = payload!.arithmetic.filter((row) => row.label.startsWith('Of which released in '));
    expect(parts).toHaveLength(2);
    expect(parts.reduce((sum, row) => sum + (row.value ?? 0), 0)).toBeCloseTo(52793, 0);
  });

  it('agrees with the grid cell it was opened from', () => {
    const detail = materialDetail('baseline', ITEM.itemId, ITEM.plantId);
    const row = detail!.grid.find((entry) => entry.key === 'plannedReceipt');
    // The daily buckets making up W36, summed the way the weekly grid sums them.
    const cell = row!.values.slice(0, 6).reduce((sum, value) => sum + (value ?? 0), 0);

    const total = line(weekly('plannedReceipt')!.arithmetic, 'PLANNED ORDER RECEIPT');
    expect(total?.value).toBeCloseTo(cell, 0);
  });

  it('splits a week by release week, and prices what can no longer be placed', () => {
    const rows = weekly('plannedReceipt')!.arithmetic;

    // Two of the six had to go out in W35, which is behind us.
    const past = line(rows, 'Of which released in W35');
    expect(past?.value).toBeCloseTo(15633, 0);
    expect(line(rows, 'Of which released in W36')?.value).toBeCloseTo(37160, 0);
    expect(line(rows, 'of which cannot be placed in time')?.value).toBeCloseTo(15633, 0);
  });

  it('says how much is late, not how many orders are', () => {
    // The parcel count is a property of how wide the bucket is, so the sentence
    // is written in the quantity, which is not.
    const sentence = weekly('plannedReceipt')!.sentence;
    expect(sentence).toContain('52,793');
    expect(sentence).toContain('15,633');
    expect(sentence).not.toMatch(/\b(two|six) orders\b/);
  });

  it('dates the earliest achievable receipt inside the bucket, not on one order', () => {
    const rows = weekly('plannedReceipt')!.arithmetic;
    const earliest = rows.find((row) => row.label.startsWith('EARLIEST ACHIEVABLE'));
    // Two days of lead time from a Monday planning date, over the working calendar.
    expect(earliest?.label).toContain('Wed 02 Sept');
  });

  it('keeps the whole single-order working on a daily cell', () => {
    // The detail is not lost, it moves one click deeper.
    const daily = explain('baseline', ITEM.itemId, ITEM.plantId, {
      row: 'plannedReceipt',
      fromDate: '2026-09-02',
    });
    const rows = daily!.arithmetic;
    expect(line(rows, 'NET REQUIREMENT')?.value).toBeCloseTo(9910, 0);
    expect(line(rows, 'PLANNED ORDER RECEIPT')?.value).toBeCloseTo(9910, 0);
    expect(rows.some((row) => row.label.startsWith('REQUIRED RELEASE'))).toBe(true);
  });

  it('carries a parcel count on every release annotation, for the weekly merge', () => {
    const detail = materialDetail('baseline', ITEM.itemId, ITEM.plantId);
    const release = detail!.grid.find((entry) => entry.key === 'release');
    const annotated = (release!.cells ?? []).flat();
    expect(annotated.length).toBeGreaterThan(0);
    for (const cell of annotated) expect(cell.parcels).toBe(1);
  });

  it('splits demand the way the grid splits it, not against a smoothed series', () => {
    // RM-30112 is a raw material: it has no independent demand at all, and
    // every kilo of it is exploded from the parents that consume it. The block
    // used to read `underlyingDemand` — the whole requirement re-exploded with
    // no lead-time offsetting — call it the independent share, and infer the
    // dependent share as the remainder, which reported 89 MT from the
    // production schedule and −1 MT from the bill of material.
    const payload = explain('baseline', 'RM-30112', 'M014', { row: 'dependent', fromDate: '2026-09-21' });
    const rows = payload!.arithmetic;

    expect(line(rows, 'Independent demand')?.value).toBe(0);
    expect(line(rows, 'From bill-of-material explosion')?.value).toBeCloseTo(88, 0);
    expect(line(rows, 'Gross requirement')?.value).toBeCloseTo(88, 0);

    // Whatever else is true, a share of a total is never negative.
    const bom = line(rows, 'From bill-of-material explosion')?.value ?? 0;
    expect(bom).toBeGreaterThanOrEqual(0);
  });

  it('walks the chain to the cell it was opened from, not to some other day', () => {
    // No order lands on 21 Sept, and the walk used to fall back to the
    // material's first recommendation anywhere in the horizon — deriving
    // 136 MT, dated 19 October, under a cell reading 88 MT.
    const payload = explain('baseline', 'RM-30112', 'M014', { row: 'dependent', fromDate: '2026-09-21' });
    const chain = payload!.chain;
    expect(chain.length).toBeGreaterThan(0);

    const gross = line(payload!.arithmetic, 'Gross requirement')?.value ?? 0;
    expect(chain[chain.length - 1]?.resultQty).toBeCloseTo(gross, 0);
  });

  it('introduces a cell with no order by that cell, not by a recommendation elsewhere', () => {
    const sentence = explain('baseline', 'RM-30112', 'M014', {
      row: 'dependent',
      fromDate: '2026-09-21',
    })!.sentence;

    expect(sentence).toContain('Mon 21 Sept');
    expect(sentence).toContain('88 MT');
    // The 19 October recommendation is still pointed at, as what comes next —
    // it just no longer opens a sentence about a day four weeks earlier.
    expect(sentence).not.toMatch(/^Order /);
  });

  it('still leads with the recommendation on a day that has one', () => {
    const sentence = explain('baseline', 'RM-30112', 'M014', { row: 'gross', fromDate: '2026-10-19' })!.sentence;
    expect(sentence).toMatch(/^Order 250 MT/);
  });

  it('reads need first, rule second, order last', () => {
    const payload = explain('baseline', 'PM-88467', 'M014', {
      row: 'plannedReceipt',
      fromDate: '2026-11-30',
      toDate: '2026-12-06',
    });
    const rows = payload!.arithmetic;

    const gross = line(rows, 'Gross requirement')?.value ?? 0;
    const net = line(rows, 'NET REQUIREMENT')?.value ?? 0;
    const total = line(rows, 'PLANNED ORDER RECEIPT')?.value ?? 0;

    expect(gross).toBeCloseTo(206496, 0);
    expect(net).toBeCloseTo(36214, 0);
    expect(total).toBeCloseTo(600000, 0);

    // The order comes before its consequence, and the consequence does not
    // pretend to be an operand.
    const netAt = rows.findIndex((row) => row.label.startsWith('NET REQUIREMENT'));
    const totalAt = rows.findIndex((row) => row.label.startsWith('PLANNED ORDER RECEIPT'));
    const closesAt = rows.findIndex((row) => row.label.startsWith('Closes W49'));
    expect(netAt).toBeLessThan(totalAt);
    expect(closesAt).toBeGreaterThan(totalAt);
    expect(rows[closesAt]?.operator).toBe('');

    expect(payload!.chain[payload!.chain.length - 1]?.resultQty).toBeCloseTo(gross, 0);
  });

  it('adds up the days that actually went under', () => {
    // A bucket subtracts once, charging all its demand against the balance
    // entering it; the walk only tops up on a day the position closes below
    // its norm. W45 is 587 MT short on that one-shot subtraction and raises
    // 75 MT, because one day in it goes under. The days are the explanation —
    // two earlier passes used a derived bridging term instead, and neither
    // meant anything to read.
    const payload = explain('baseline', 'RM-30130', 'M014', {
      row: 'netRequirement',
      fromDate: '2026-11-02',
      toDate: '2026-11-08',
    });
    const rows = payload!.arithmetic;

    const day = line(rows, 'Wed 04 Nov');
    expect(day?.value).toBeCloseTo(75, 0);
    expect(line(rows, 'NET REQUIREMENT')?.value).toBeCloseTo(75, 0);

    // No derived bridge survives.
    expect(rows.some((row) => row.label.includes('shape of the bucket'))).toBe(false);
    expect(rows.some((row) => row.label.startsWith('Left uncovered'))).toBe(false);

    // And the sentence is about the net requirement, not about a 2,050 MT
    // order the block never derives.
    expect(payload!.sentence).toContain('75 MT');
    expect(payload!.sentence).not.toContain('2,050');
  });

  it('names the rule that actually bound, and foots to the order', () => {
    // 75 MT of need becomes 2,050 MT through a 16-day period of supply and a
    // 25 MT vendor increment. The block used to call the whole overshoot "the
    // minimum, the rounding value and the maximum lot" — and the minimum had
    // not bound at all.
    const rows = explain('baseline', 'RM-30130', 'M014', {
      row: 'plannedReceipt',
      fromDate: '2026-11-02',
      toDate: '2026-11-08',
    })!.arithmetic;

    const net = line(rows, 'NET REQUIREMENT')?.value ?? 0;
    const poq = line(rows, 'Period of supply')?.value ?? 0;
    const increment = line(rows, 'Vendor increment')?.value ?? 0;
    const total = line(rows, 'PLANNED ORDER RECEIPT')?.value ?? 0;

    expect(net).toBeCloseTo(75, 0);
    expect(poq).toBeCloseTo(1958, 0);
    expect(increment).toBeCloseTo(17, 0);
    expect(net + poq + increment).toBeCloseTo(total, 0);
    expect(total).toBeCloseTo(2050, 0);
  });

  it('says a bucket opening past the fence is reachable throughout', () => {
    // W49 opens 30 November; the 21-day fence cleared in September. The date
    // shown is the bucket's own first day, so the note must not claim it is
    // "21 days from today".
    const rows = explain('baseline', 'PM-88467', 'M014', {
      row: 'plannedReceipt',
      fromDate: '2026-11-30',
      toDate: '2026-12-06',
    })!.arithmetic;

    const earliest = rows.find((row) => row.label.startsWith('EARLIEST ACHIEVABLE'));
    expect(earliest?.label).toContain('Mon 30 Nov');
    expect(earliest?.source).toContain('opens after the fence');
  });

  it('sums a bucket the way the grid sums it, rounding included', () => {
    // RM-30130 in W37: three days of 211.27, 183.43 and 127.98. The grid rounds
    // each day before the client adds them, so the row reads 211 + 183 + 128 =
    // 522. The drawer summed the raw series and rounded once, and said 523.
    const rows = explain('baseline', 'RM-30130', 'M014', {
      row: 'balanceBefore',
      fromDate: '2026-09-07',
      toDate: '2026-09-13',
    })!.arithmetic;

    expect(line(rows, 'Gross requirement')?.value).toBe(522);
  });

  it('explains a daily cell the run proposes nothing in', () => {
    // This used to fall through to the material-level fallback and answer a
    // cell reading 0 EA with a horizon-wide lowest balance of −494,507 EA.
    const payload = explain('baseline', 'FG-10002', 'M014', {
      row: 'plannedReceipt',
      fromDate: '2026-08-31',
    });
    const rows = payload!.arithmetic;

    expect(line(rows, 'PLANNED ORDER RECEIPT')?.value).toBe(0);
    expect(rows.some((row) => row.label.startsWith('Lowest projected balance'))).toBe(false);
  });

  it('reconciles the net requirement row against the walk that sized it', () => {
    const rows = weekly('netRequirement')!.arithmetic;
    const required = line(rows, 'Required position')?.value ?? 0;
    const available = line(rows, 'Available position')?.value ?? 0;
    const net = line(rows, 'NET REQUIREMENT')?.value ?? 0;
    expect(net).toBeCloseTo(required - available, 0);
    expect(net).toBeCloseTo(52793, 0);
  });
});
