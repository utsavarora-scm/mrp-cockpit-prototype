/**
 * Buckets and fences.
 *
 * Two small modules that decide what a planner sees, so both are checked
 * against the properties that make them safe rather than against a snapshot of
 * their output. The bucketing rule that matters is that a flow sums and a level
 * does not; the fence rule that matters is that it is walked over working days
 * and computed twice.
 */

import { describe, expect, it } from 'vitest';
import { toEpochDay } from '@repo/domain';

import { bucketFlow, bucketLevel, bucketTrough, buildBuckets, bucketIndexOfDay } from '../src/buckets';
import { WorkingCalendar } from '../src/calendar';
import { computeFences, leadTimeChain, unreachableByDays, zoneOfDay } from '../src/fences';
import { itemPlant } from './fixtures';

const PLANNING_DATE = '2026-08-31';
const PLANNING_EPOCH = toEpochDay(PLANNING_DATE);

const SIX_DAY = new WorkingCalendar({ id: 'C', workingDays: [1, 2, 3, 4, 5, 6], holidays: [] }, PLANNING_DATE, 400);
const FIVE_DAY = new WorkingCalendar({ id: 'C', workingDays: [1, 2, 3, 4, 5], holidays: [] }, PLANNING_DATE, 400);

describe('buckets', () => {
  const buckets = buildBuckets(PLANNING_DATE, 182);

  it('buckets the execution window daily and everything beyond it weekly', () => {
    const daily = buckets.filter((bucket) => bucket.kind === 'DAY');
    expect(daily).toHaveLength(28);
    expect(daily.every((bucket) => bucket.zone === 'EXECUTION')).toBe(true);
    expect(buckets.slice(28).every((bucket) => bucket.kind === 'WEEK')).toBe(true);
  });

  it('covers every day of the horizon exactly once', () => {
    let expected = 0;
    for (const bucket of buckets) {
      expect(bucket.startDay).toBe(expected);
      expect(bucket.endDay).toBeGreaterThanOrEqual(bucket.startDay);
      expected = bucket.endDay + 1;
    }
    expect(expected).toBe(183);
  });

  it('aligns weekly buckets to real ISO weeks, not to multiples of seven days', () => {
    // A vendor asked for "week 40" means the calendar week, not "day 35 to 41".
    const weekly = buckets.filter((bucket) => bucket.kind === 'WEEK');
    for (const bucket of weekly.slice(1, -1)) {
      const dow = (((PLANNING_EPOCH + bucket.startDay + 4) % 7) + 7) % 7;
      expect(dow).toBe(1);
    }
  });

  it('marks the boundary where the bucket width changes', () => {
    const boundaries = buckets.filter((bucket) => bucket.startsZone);
    expect(boundaries.map((bucket) => bucket.zone)).toEqual(['EXECUTION', 'SCHEDULING', 'PROCUREMENT']);
  });

  it('sums a flow and takes the closing value of a level', () => {
    const series = new Float64Array(183).fill(10);
    const flows = bucketFlow(series, buckets);
    const levels = bucketLevel(series, buckets);

    const firstWeekly = buckets.find((bucket) => bucket.kind === 'WEEK') as (typeof buckets)[number];
    const width = firstWeekly.endDay - firstWeekly.startDay + 1;

    // The whole reason the two functions exist. Summing a stock balance across
    // a week reports several times the stock, and reports it confidently.
    expect(flows[firstWeekly.index]).toBe(10 * width);
    expect(levels[firstWeekly.index]).toBe(10);
  });

  it('finds the lowest point inside a bucket, which is where the trouble is', () => {
    const series = new Float64Array(183).fill(100);
    series[30] = -5;
    const index = bucketIndexOfDay(buckets, 30);
    expect(bucketTrough(series, buckets)[index]).toBe(-5);
    // A weekly closing balance would have shown 100 and hidden it entirely.
    expect(bucketLevel(series, buckets)[index]).toBe(100);
  });
});

describe('the lead-time chain', () => {
  const vendor = {
    itemId: 'RM-30114',
    plantId: 'M014',
    vendorId: 'V-IMP-01',
    isPrimary: true,
    leadTimeDays: 35,
    moq: 1000,
    incrementQty: 250,
    unitPrice: 95000,
    dailyCapacity: null,
    expediteAvailable: false,
    expediteLeadTimeDays: null,
    expediteUnitPriceUplift: null,
    allocationShare: 1,
    maxShipmentQty: null,
    transitDays: 34,
    acknowledgementDays: 3,
    customsDays: 12,
    weeklyCapacity: null,
    minGapDays: 0,
    earliestDispatchDays: 38,
    isImport: true,
  };

  it('sums its intervals to the number the material master holds', () => {
    const master = itemPlant({
      itemId: 'RM-30114',
      plantId: 'M014',
      leadTimeDays: 90,
      grProcessingTimeDays: 2,
      qaQuarantineDays: 4,
    });
    const chain = leadTimeChain(master, vendor);
    expect(chain.totalDays).toBe(90);
    // Displayed components sum to the displayed total. Everywhere, always.
    expect(chain.intervals.reduce((sum, interval) => sum + interval.days, 0)).toBe(90);
  });

  it("does not mistake the vendor's quoted time for the whole chain", () => {
    const master = itemPlant({
      itemId: 'RM-30114',
      plantId: 'M014',
      leadTimeDays: 90,
      grProcessingTimeDays: 2,
      qaQuarantineDays: 4,
    });
    const chain = leadTimeChain(master, vendor);
    // The systematic understatement this module exists to prevent: 35 days is
    // what the vendor quotes, and 90 is what the plan has to net on.
    expect(chain.vendorQuotedDays).toBe(35);
    expect(chain.totalDays - chain.vendorQuotedDays).toBe(55);
  });

  it('gives every interval an owner, because a slip has four different fixes', () => {
    const master = itemPlant({ itemId: 'RM-30114', plantId: 'M014', leadTimeDays: 90, qaQuarantineDays: 4 });
    const owners = new Set(leadTimeChain(master, vendor).intervals.map((interval) => interval.owner));
    expect(owners.size).toBeGreaterThan(2);
    expect(owners.has('Vendor')).toBe(true);
    expect(owners.has('Sourcing')).toBe(true);
  });

  it('degrades to the material master alone when there is no approved source', () => {
    const master = itemPlant({ itemId: 'RM-1', plantId: 'M014', leadTimeDays: 20, grProcessingTimeDays: 1 });
    const chain = leadTimeChain(master, null);
    expect(chain.totalDays).toBe(20);
  });
});

describe('the fence', () => {
  const base = { planningEpochDay: PLANNING_EPOCH, calendar: SIX_DAY, horizonDays: 182 };

  it('walks working days rather than subtracting calendar ones', () => {
    const sixDay = computeFences({ ...base, maintainedChainDays: 12, measuredTotalDays: null });
    const fiveDay = computeFences({ ...base, calendar: FIVE_DAY, maintainedChainDays: 12, measuredTotalDays: null });
    // Twelve working days on a five-day week reaches further into the calendar
    // than twelve on a six-day week. A lead time that lands mid-shutdown is not
    // a lead time.
    expect(fiveDay.maintained.earliestReceiptDay).toBeGreaterThan(sixDay.maintained.earliestReceiptDay);
  });

  it('draws a second fence from what the receipts measured', () => {
    const fences = computeFences({ ...base, maintainedChainDays: 90, measuredTotalDays: 104 });
    expect(fences.measured).not.toBeNull();
    expect(fences.driftDays).toBe(14);
    // Fourteen days later, on a material where two weeks is a vessel.
    expect(fences.measured?.earliestReceiptDay).toBeGreaterThan(fences.maintained.earliestReceiptDay);
  });

  it('reports an absent measured fence as absent, never as the maintained one', () => {
    const fences = computeFences({ ...base, maintainedChainDays: 90, measuredTotalDays: null });
    expect(fences.measured).toBeNull();
    expect(fences.driftDays).toBeNull();
  });

  it('splits the horizon into frozen, firm and free', () => {
    const { maintained } = computeFences({ ...base, maintainedChainDays: 90, measuredTotalDays: null });
    expect(zoneOfDay(maintained, 0)).toBe('FROZEN');
    expect(zoneOfDay(maintained, maintained.earliestReceiptDay - 1)).toBe('FROZEN');
    expect(zoneOfDay(maintained, maintained.earliestReceiptDay)).toBe('FIRM');
    expect(zoneOfDay(maintained, maintained.firmUntilDay + 1)).toBe('FREE');
  });

  it('measures how far inside the frozen zone a shortage sits', () => {
    const { maintained } = computeFences({ ...base, maintainedChainDays: 90, measuredTotalDays: null });
    // The number that reframes the job from "raise three orders" to "choose
    // between the levers that can actually reach this".
    expect(unreachableByDays(maintained, 21)).toBeGreaterThan(0);
    expect(unreachableByDays(maintained, maintained.earliestReceiptDay + 5)).toBeLessThan(0);
  });
});
