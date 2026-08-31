/**
 * The scheduling engine, checked against Brief §6 Act 1.
 *
 * The demo's 2:10 beat: 2,520 MT of an imported palm derivative, and the
 * question SAP does not answer — by when, in how many drops, and which of them
 * is impossible. The five-line split and the seven-day infeasibility are both
 * *computed* here from the vendor and plant constraints; nothing is asserted
 * into the output.
 */

import { describe, expect, it } from 'vitest';
import { toEpochDay } from '@repo/domain';

import { WorkingCalendar } from '../src/calendar';
import { allocateAcrossVendors, scheduleOrder, type SchedulingInput } from '../src/scheduling';

const PLANNING_DATE = '2026-08-30';
const PLANNING_EPOCH = toEpochDay(PLANNING_DATE);

/**
 * A seven-day calendar with no holidays.
 *
 * Deliberate: it makes working-day arithmetic reduce to calendar arithmetic, so
 * the dates below are the Brief's own plain sums rather than an artefact of
 * where a weekend happened to fall. The five-day calendar is exercised
 * separately.
 */
const SEVEN_DAY = new WorkingCalendar(
  { id: 'SEVEN', workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] },
  PLANNING_DATE,
  400
);

/** The hero material's own constraints, as the pack seeds them. */
function heroInput(overrides: Partial<SchedulingInput> = {}): SchedulingInput {
  return {
    itemId: 'RM-PD-001',
    plantId: 'P1',
    vendorId: 'V-IMP-01',
    totalQty: 2_520,
    // Chosen so line 1's dispatch lands exactly seven days before the vendor
    // can ship: 24 days out, less 12 days of transit, against 19 days notice.
    firstUncoveredEpochDay: PLANNING_EPOCH + 24,
    dailyDemandMean: 42,
    safetyStockQty: 914,
    moq: 200,
    incrementQty: 20,
    maxShipmentQty: 600,
    storageCapacity: 1_300,
    dailyReceivingCapacity: 120,
    shelfLifeDays: 365,
    transitDays: 12,
    earliestDispatchDays: 19,
    planningEpochDay: PLANNING_EPOCH,
    plantCalendar: SEVEN_DAY,
    ...overrides,
  };
}

describe('scheduling engine — the Act 1 order', () => {
  const schedule = scheduleOrder(heroInput());

  it('splits 2,520 into five deliveries', () => {
    expect(schedule.lineCount).toBe(5);
    expect(schedule.lines).toHaveLength(5);
  });

  it('sizes them 500, 500, 500, 500, 520', () => {
    expect(schedule.lines.map((line) => line.qty)).toEqual([500, 500, 500, 500, 520]);
    // Whatever the rounding does, the lines have to sum to what was ordered.
    expect(schedule.lines.reduce((total, line) => total + line.qty, 0)).toBe(2_520);
  });

  it('is the shipment cap that forces the split, not storage', () => {
    const byKind = new Map(schedule.drivers.map((driver) => [driver.kind, driver]));
    expect(byKind.get('SHIPMENT_CAP')?.lines).toBe(5);
    expect(byKind.get('SHIPMENT_CAP')?.binding).toBe(true);
    // Storage would allow two deliveries of this size — it constrains what can
    // be on the ground at once, which is a different question.
    expect(byKind.get('STORAGE')?.lines).toBe(2);
    expect(byKind.get('STORAGE')?.binding).toBe(false);
    expect(byKind.get('SHELF_LIFE')?.lines).toBe(1);
  });

  it('keeps every line above the minimum order quantity', () => {
    for (const line of schedule.lines) expect(line.qty).toBeGreaterThanOrEqual(200);
    expect(schedule.belowMoq).toBe(false);
  });

  it('paces the deliveries at 11.9 days of cover each', () => {
    expect(schedule.lines[0]?.coverDays).toBeCloseTo(11.9, 1);
    const first = schedule.lines[0]?.requiredByEpochDay as number;
    const second = schedule.lines[1]?.requiredByEpochDay as number;
    expect(second - first).toBe(12);
  });

  it('flags line 1 as required seven days before the vendor can dispatch', () => {
    const first = schedule.lines[0];
    expect(first?.flags).toContain('INFEASIBLE_LINE');
    expect(first?.infeasibleByDays).toBe(7);
    expect(schedule.infeasibleLines).toBe(1);
  });

  it('does not silently push the impossible line out to a date that works', () => {
    // The whole point: it is emitted where it was needed, flagged, so the
    // planner can act. A schedule that quietly reschedules it is a schedule
    // nobody can plan against.
    expect(schedule.lines[0]?.requiredByEpochDay).toBe(PLANNING_EPOCH + 24);
    expect(schedule.lines[1]?.flags).toHaveLength(0);
  });

  it('flags storage as binding on peak on-hand, not on the line count', () => {
    // The behaviour, not the margin: the buffer plus one delivery exceeds the
    // space. Pinning the overage in MT would break every time the norm moves.
    expect(schedule.storageBinding).toBe(true);
    expect(schedule.peakOnHand).toBeGreaterThan(schedule.storageCapacity as number);
    expect(schedule.peakOnHand).toBe(914 + 520);
  });

  it('builds the rationale from the constraints that actually bound', () => {
    const { rationale } = schedule;
    expect(rationale).toContain('5 lines');
    expect(rationale).toContain('600');
    expect(rationale).toContain('11.9 days of cover');
    expect(rationale).toContain('Storage binds');
    expect(rationale).toContain('7 days before this vendor can dispatch');
  });
});

describe('scheduling engine — constraints that change the answer', () => {
  it('needs no split when nothing forces one', () => {
    const schedule = scheduleOrder(
      heroInput({ totalQty: 400, maxShipmentQty: null, storageCapacity: null, dailyReceivingCapacity: null })
    );
    expect(schedule.lineCount).toBe(1);
    expect(schedule.rationale).toContain('nothing forces a split');
  });

  it('reduces the line count rather than ordering below the minimum', () => {
    // Five lines of 60 would each fall under a 200 MOQ, so the split collapses.
    const schedule = scheduleOrder(heroInput({ totalQty: 300, maxShipmentQty: 60 }));
    expect(schedule.lineCount).toBe(1);
    expect(schedule.belowMoq).toBe(false);
    expect(schedule.lines[0]?.qty).toBe(300);
  });

  it('flags an order that cannot reach the minimum at all', () => {
    const schedule = scheduleOrder(heroInput({ totalQty: 150 }));
    expect(schedule.belowMoq).toBe(true);
    expect(schedule.lines[0]?.flags).toContain('BELOW_MOQ');
    expect(schedule.rationale).toContain('pull demand forward or defer it');
  });

  it('lets the receiving rate force a split on its own', () => {
    const schedule = scheduleOrder(heroInput({ maxShipmentQty: null, dailyReceivingCapacity: 100 }));
    const receiving = schedule.drivers.find((driver) => driver.kind === 'RECEIVING');
    expect(receiving?.lines).toBe(6);
    expect(receiving?.binding).toBe(true);
    expect(schedule.lineCount).toBe(6);
  });

  it('never lands a delivery on a non-working day', () => {
    const fiveDay = new WorkingCalendar({ id: 'FIVE', workingDays: [1, 2, 3, 4, 5], holidays: [] }, PLANNING_DATE, 400);
    const schedule = scheduleOrder(heroInput({ plantCalendar: fiveDay }));
    for (const line of schedule.lines) {
      expect(fiveDay.isWorkingDay(line.requiredByEpochDay)).toBe(true);
    }
  });

  it('reports no infeasibility when the vendor has enough notice', () => {
    const schedule = scheduleOrder(heroInput({ firstUncoveredEpochDay: PLANNING_EPOCH + 60 }));
    expect(schedule.infeasibleLines).toBe(0);
    expect(schedule.rationale).not.toContain('before this vendor can dispatch');
  });
});

describe('scheduling engine — vendor allocation', () => {
  it('splits 60/40 onto each vendor’s own increment, preserving the total', () => {
    const allocated = allocateAcrossVendors(2_520, [
      { vendorId: 'V-IMP-02', allocationShare: 0.6, incrementQty: 20 },
      { vendorId: 'V-IMP-03', allocationShare: 0.4, incrementQty: 20 },
    ]);
    // A clean 60/40 is 1,512 and 1,008 — neither of which a vendor shipping in
    // 20 MT increments can actually deliver. Each lands on its own increment
    // and the total still comes to 2,520.
    expect(allocated).toEqual([
      { vendorId: 'V-IMP-02', qty: 1_520 },
      { vendorId: 'V-IMP-03', qty: 1_000 },
    ]);
    expect(allocated.reduce((total, row) => total + row.qty, 0)).toBe(2_520);
    for (const row of allocated) expect(row.qty % 20).toBe(0);
  });

  it('puts the rounding drift on the largest allocation, never on the total', () => {
    const allocated = allocateAcrossVendors(1_000, [
      { vendorId: 'A', allocationShare: 0.6, incrementQty: 30 },
      { vendorId: 'B', allocationShare: 0.4, incrementQty: 30 },
    ]);
    expect(allocated.reduce((total, row) => total + row.qty, 0)).toBe(1_000);
  });

  it('gives a single source the whole order', () => {
    expect(allocateAcrossVendors(500, [{ vendorId: 'V', allocationShare: 1, incrementQty: 20 }])).toEqual([
      { vendorId: 'V', qty: 500 },
    ]);
  });
});
