/**
 * The delivery schedule, checked against the worked example it was written for.
 *
 * The example is the sponsor's headline ask made concrete: a six-week campaign
 * for a packaging material where two constraints bind and the interesting one
 * is not the one anybody expects. Every figure below is the one the
 * requirements document works by hand, so a change to the scheduler that
 * quietly stops reproducing it fails here rather than in front of an audience.
 */

import { describe, expect, it } from 'vitest';
import { toEpochDay } from '@repo/domain';

import { buildDeliverySchedule, type DeliveryScheduleInput } from '../src/delivery-schedule';
import { WorkingCalendar } from '../src/calendar';

const PLANNING_DATE = '2026-08-31';
const PLANNING_EPOCH = toEpochDay(PLANNING_DATE);

/** Six working days a week — a plant that receives Monday to Saturday. */
const SIX_DAY = new WorkingCalendar({ id: 'CAL', workingDays: [1, 2, 3, 4, 5, 6], holidays: [] }, PLANNING_DATE, 400);

/**
 * The worked example, input for input.
 *
 * Opening 260,000; safety stock 100,000; the promotion's weekly requirement
 * across W37 to W42; a vendor that can make 250,000 a week but shuts for
 * maintenance in W39; and a plant that can only hold 320,000 empty bottles.
 */
function bottleCampaign(overrides: Partial<DeliveryScheduleInput> = {}): DeliveryScheduleInput {
  const requirements = new Float64Array(200);
  const weekly = [180_000, 210_000, 240_000, 240_000, 200_000, 180_000];
  // W37 starts seven days after the planning Monday.
  for (let week = 0; week < weekly.length; week += 1) {
    const perDay = (weekly[week] as number) / 7;
    for (let day = 0; day < 7; day += 1) requirements[7 + week * 7 + day] = perDay;
  }

  return {
    itemId: 'PM-88431',
    plantId: 'M014',
    vendorId: 'V-PKG-01',
    planningEpochDay: PLANNING_EPOCH,
    fromDay: 7,
    toDay: 48,
    grossRequirements: requirements,
    openingBalance: 260_000,
    safetyStock: 100_000,
    dailyDemandMean: 30_000,
    moq: 100_000,
    roundingValue: 10_000,
    maxLotSize: null,
    weeklyCapacity: 250_000,
    storageCapacity: 320_000,
    minGapDays: 4,
    transitDays: 2,
    earliestReceiptDay: 10,
    productionShutdownWeeks: ['2026-09-21'],
    plantCalendar: SIX_DAY,
    vendorCalendar: SIX_DAY,
    ...overrides,
  };
}

describe('the ideal schedule — what the planner wants', () => {
  const result = buildDeliverySchedule(bottleCampaign());

  it('covers one delivery per week of the campaign', () => {
    expect(result.ideal).toHaveLength(6);
    expect(result.ideal.map((line) => line.week)).toEqual(['W37', 'W38', 'W39', 'W40', 'W41', 'W42']);
    expect(result.ideal.map((line) => line.line)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it('asks for exactly what each week needs to end on its buffer', () => {
    expect(result.ideal.map((line) => Math.round(line.qty))).toEqual([
      100_000, 130_000, 240_000, 240_000, 200_000, 180_000,
    ]);
    expect(Math.round(result.totals.ideal)).toBe(1_090_000);
  });

  it('separates the minimum-order top-up from the requirement that earned it', () => {
    const first = result.ideal[0];
    // Line 10 is 100,000 and not 20,000 because the minimum floors it. That
    // 80,000 is a lot-sizing addition, not a requirement, and a planner should
    // never have to work out which part of an order is need and which is rule.
    expect(Math.round(first?.needQty ?? 0)).toBe(20_000);
    expect(Math.round(first?.lotSizingAddition ?? 0)).toBe(80_000);
    expect(first?.lotSizingReason).toBe('MOQ');

    // Every later line is pure requirement.
    for (const line of result.ideal.slice(1)) expect(Math.round(line.lotSizingAddition)).toBe(0);
  });

  it('holds the buffer in every week, because nothing is constraining it', () => {
    expect(result.ideal.map((line) => Math.round(line.balanceAfter))).toEqual([
      180_000, 100_000, 100_000, 100_000, 100_000, 100_000,
    ]);
  });
});

describe('the committed schedule — what can actually be asked for', () => {
  const result = buildDeliverySchedule(bottleCampaign());
  const committed = result.committed;

  it('empties the closed week and finds the quantity elsewhere', () => {
    expect(Math.round(committed[2]?.qty ?? -1)).toBe(0);
    expect(committed[2]?.constraint).toBe('VENDOR_SHUTDOWN');
  });

  it('reproduces the worked schedule, line for line', () => {
    expect(committed.map((line) => Math.round(line.qty))).toEqual([240_000, 210_000, 0, 240_000, 220_000, 180_000]);
    expect(committed.map((line) => Math.round(line.balanceAfter))).toEqual([
      320_000, 320_000, 80_000, 80_000, 100_000, 100_000,
    ]);
  });

  it('moves not one unit more than the ideal schedule asked for', () => {
    // Conservation. A committed schedule that does not sum to the ideal one is
    // a schedule that has quietly decided something on the planner's behalf.
    expect(Math.round(result.totals.committed)).toBe(Math.round(result.totals.ideal));
    expect(Math.round(result.totals.delta)).toBe(0);
  });

  it('attributes every unit of difference to a named constraint', () => {
    for (const delta of result.deltas) {
      expect(delta.constraint).toBeTruthy();
      expect(delta.note.length).toBeGreaterThan(0);
    }
    const moved = result.deltas.reduce((sum, delta) => sum + Math.abs(delta.delta), 0);
    expect(moved).toBeGreaterThan(0);
  });

  it('dates every delivery to a day the plant can receive on', () => {
    for (const line of committed) {
      const dow = new Date(`${line.deliveryDate}T00:00:00Z`).getUTCDay();
      expect(dow).not.toBe(0);
    }
  });

  it('back-schedules a dispatch date over the vendor calendar', () => {
    for (const line of committed) expect(line.dispatchDate < line.deliveryDate).toBe(true);
  });
});

describe('the delta ledger — why the two differ', () => {
  const result = buildDeliverySchedule(bottleCampaign());

  it('names the warehouse, not the vendor, as the binding constraint', () => {
    // The beat the whole example exists for. The vendor could supply 250,000
    // in each week; the plant can hold 320,000 empty bottles. Getting this
    // backwards is the difference between a phone call to the wrong person and
    // a decision about floor space.
    const storage = result.constraints.find((row) => row.key === 'STORAGE_CAP');
    const capacity = result.constraints.find((row) => row.key === 'VENDOR_CAPACITY');
    expect(storage?.binding).toBe(true);
    expect(capacity?.binding).toBe(false);

    const ledger = result.ledger.join(' ');
    expect(ledger).toContain('not vendor capacity');
    expect(ledger).toContain('warehouse volumetric ceiling');
  });

  it('states the residual exposure rather than burying it', () => {
    expect(result.residual).not.toBeNull();
    expect(result.residual?.weeks).toEqual(['W39', 'W40']);
    expect(Math.round(result.residual?.shortfall ?? 0)).toBe(20_000);
    expect(result.residual?.recoveredIn).toBe('W41');
    // A dip into the buffer, not a stock-out. The difference matters enormously
    // and the two must never be reported as the same event.
    expect(result.residual?.stocksOut).toBe(false);
  });

  it('offers only levers the constraint set actually supports', () => {
    const options = result.options.join(' ');
    // The shutdown stops production, not dispatch — the kind of thing a planner
    // knows and a system usually does not.
    expect(options).toContain('shutdown stops production, not dispatch');
    expect(options).toContain('external floor space');
  });

  it('says so when no lot-sizing adjustment was needed on the committed lines', () => {
    const placed = result.committed.filter((line) => line.qty > 0);
    for (const line of placed) {
      expect(line.qty % 10_000).toBe(0);
      expect(line.qty).toBeGreaterThanOrEqual(100_000);
    }
  });
});

describe('when nothing binds', () => {
  const result = buildDeliverySchedule(
    bottleCampaign({ productionShutdownWeeks: [], weeklyCapacity: null, storageCapacity: null })
  );

  it('commits the ideal schedule unchanged, and says nothing moved', () => {
    expect(result.committed.map((line) => Math.round(line.qty))).toEqual(
      result.ideal.map((line) => Math.round(line.qty))
    );
    expect(result.deltas).toHaveLength(0);
    expect(result.residual).toBeNull();
    expect(result.ledger.join(' ')).toContain('holds the buffer in every week');
  });
});

describe('the lead-time fence', () => {
  it('flags a line required before a new order could arrive, and does not move it', () => {
    // Ninety days of lead time against a campaign that starts next week: the
    // first four lines are physically unreachable. Pushing them out to the
    // first date that works would be the one behaviour guaranteed to teach a
    // planner not to trust the schedule.
    const result = buildDeliverySchedule(bottleCampaign({ earliestReceiptDay: 90 }));
    const unreachable = result.committed.filter((line) => line.insideFence);
    expect(unreachable.length).toBeGreaterThan(0);
    expect(unreachable[0]?.unreachableByDays).toBeGreaterThan(0);
    // The dates are unchanged — the schedule still says when it was needed.
    const baseline = buildDeliverySchedule(bottleCampaign());
    expect(result.committed.map((line) => line.deliveryDate)).toEqual(
      baseline.committed.map((line) => line.deliveryDate)
    );
    expect(result.ledger.join(' ')).toContain('before a newly placed order could arrive');
  });
});

describe('a shutdown the schedule can absorb entirely', () => {
  it('recovers in one week rather than dribbling across three', () => {
    // Lift the ceiling and the whole displaced quantity fits in one earlier
    // week. Three small deliveries for one problem is three receipts and three
    // invoices, which is what the minimum-gap rule exists to prevent.
    const result = buildDeliverySchedule(bottleCampaign({ storageCapacity: 900_000, weeklyCapacity: 600_000 }));
    const touched = result.committed.filter((line) => line.delta !== 0 && line.qty > 0);
    expect(touched.length).toBeLessThanOrEqual(2);
    expect(Math.round(result.totals.delta)).toBe(0);
    expect(result.residual).toBeNull();
  });
});
