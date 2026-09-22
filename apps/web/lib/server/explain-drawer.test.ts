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
    const parts = payload!.arithmetic.filter((row) => row.label.startsWith('Release '));
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
    const past = line(rows, 'Release W35');
    expect(past?.value).toBeCloseTo(15633, 0);
    expect(line(rows, 'Release W36')?.value).toBeCloseTo(37160, 0);
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

  it('reconciles the net requirement row against the walk that sized it', () => {
    const rows = weekly('netRequirement')!.arithmetic;
    const required = line(rows, 'Required position')?.value ?? 0;
    const available = line(rows, 'Available position')?.value ?? 0;
    const net = line(rows, 'NET REQUIREMENT')?.value ?? 0;
    expect(net).toBeCloseTo(required - available, 0);
    expect(net).toBeCloseTo(52793, 0);
  });
});
