/**
 * The recovery pass — what can still be done about orders asked for in the past.
 *
 * The invariant that matters most is the first one: when the pass raises
 * nothing, its balance must equal the feasible balance exactly. That is what
 * proves it rolled fresh from opening stock rather than adjusting a series that
 * was already rolled, which would count every receipt and every requirement
 * twice.
 */

import { describe, expect, it } from 'vitest';

import { WorkingCalendar } from '../src/calendar';
import { netItemPlant } from '../src/netting';
import { planRecovery, type RecoveryInput } from '../src/recovery';
import { item, itemPlant, PLANNING_DATE } from './fixtures';
import { toEpochDay } from '@repo/domain';

const HORIZON = 120;
const PLANNING_EPOCH = toEpochDay(PLANNING_DATE);

const calendar = (): WorkingCalendar =>
  new WorkingCalendar({ id: 'C', workingDays: [1, 2, 3, 4, 5, 6], holidays: [] }, PLANNING_DATE, HORIZON + 60);

function series(fill = 0): Float64Array {
  return new Float64Array(HORIZON + 1).fill(fill);
}

/** A material with a long lead time, steady demand and nothing on order. */
function input(overrides: Partial<RecoveryInput> = {}): RecoveryInput {
  const master = itemPlant({
    itemId: 'RM-1',
    plantId: 'P1',
    leadTimeDays: 30,
    safetyStock: 100,
    lotSizeRule: 'LFL',
    minLotSize: null,
    roundingValue: null,
    maxLotSize: null,
    storageCapacity: null,
  });

  return {
    itemId: 'RM-1',
    plantId: 'P1',
    itemPlant: master,
    calendar: calendar(),
    planningEpochDay: PLANNING_EPOCH,
    horizonDays: HORIZON,
    openingStock: 200,
    standardCost: 100,
    grossRequirements: series(10),
    scheduledReceipts: series(),
    plannedReceipts: series(),
    infeasibleReceipts: series(),
    thresholdAt: () => 100,
    earliestFeasibleReceiptDay: 30,
    releaseDayFor: (receiptEpochDay: number) => receiptEpochDay - 30,
    moq: 0,
    incrementQty: 0,
    ceiling: {
      weeklyCapacity: null,
      storageCapacity: null,
      shelfLifeDays: null,
      maxLotSize: null,
      dailyDemandMean: 10,
    },
    shutdownMondays: new Set<string>(),
    unmetRequirements: [],
    ...overrides,
  };
}

describe('recovery — the balance contract', () => {
  it('equals the feasible balance exactly when it raises nothing', () => {
    // Covered for the whole horizon, so there is nothing to recover. The two
    // series must then be the same series: any difference is the fresh roll
    // double-counting demand or receipts.
    const gross = series(0);
    const result = planRecovery(input({ grossRequirements: gross, openingStock: 1_000 }));

    expect(result.orders).toEqual([]);
    let feasible = 1_000;
    for (let day = 0; day <= HORIZON; day += 1) {
      expect(result.projectedAvailableRecovered[day]).toBeCloseTo(feasible, 9);
    }
  });

  it('rolls booked and placeable supply in, and past-due supply out', () => {
    const scheduled = series(0);
    scheduled[5] = 500;
    const planned = series(0);
    planned[6] = 900;
    const infeasible = series(0);
    infeasible[6] = 900; // the whole planned receipt is unplaceable

    const result = planRecovery(
      input({
        openingStock: 1_000,
        grossRequirements: series(0),
        scheduledReceipts: scheduled,
        plannedReceipts: planned,
        infeasibleReceipts: infeasible,
      })
    );

    // 1,000 + 500 booked, and nothing from the unplaceable planned receipt.
    expect(result.projectedAvailableRecovered[10]).toBeCloseTo(1_500, 9);
  });
});

describe('recovery — what it proposes', () => {
  it('recalculates the quantity at the feasible date rather than copying it', () => {
    // The shortage is small at the original date and much larger by the time an
    // order could land, because demand keeps running. Copying the old quantity
    // forward would under-order.
    const result = planRecovery(input());
    expect(result.orders.length).toBeGreaterThan(0);

    const first = result.orders[0];
    expect(first?.receiptDay).toBe(30);
    // 200 on hand less 31 days of demand at 10 leaves −110, and the norm is
    // 100, so the gap at day 30 is 210 — not the 10 a day it was when the
    // shortage started. Demand kept running while nothing could be ordered, and
    // carrying the original quantity forward would under-order by twentyfold.
    expect(first?.qty).toBeCloseTo(210, 6);
  });

  it('never dates a recovery before the earliest feasible receipt', () => {
    const result = planRecovery(input({ earliestFeasibleReceiptDay: 45 }));
    for (const order of result.orders) expect(order.receiptDay).toBeGreaterThanOrEqual(45);
  });

  it('lands later under a longer lead time, as the measured scenario would', () => {
    const short = planRecovery(input({ earliestFeasibleReceiptDay: 30 }));
    const long = planRecovery(input({ earliestFeasibleReceiptDay: 44 }));
    expect((long.orders[0]?.receiptDay ?? 0) - (short.orders[0]?.receiptDay ?? 0)).toBe(14);
  });

  it('aggregates the unmet requirements one order stands in for', () => {
    const result = planRecovery(
      input({
        unmetRequirements: [
          { requirementId: 'RM-1@P1#2', day: 2 },
          { requirementId: 'RM-1@P1#8', day: 8 },
        ],
      })
    );
    // Both shortages precede the first feasible date, so one order covers both
    // rather than two proposals arriving for one problem.
    expect(result.orders[0]?.coversRequirementIds).toEqual(['RM-1@P1#2', 'RM-1@P1#8']);
  });

  it('counts what no order could reach as unavoidable', () => {
    const result = planRecovery(input());
    // Demand runs from day 0; nothing can land before day 30.
    expect(result.unavoidableQty).toBeGreaterThan(0);
  });
});

describe('recovery — committability', () => {
  it('excludes a candidate the vendor cannot make, and names the constraint', () => {
    const result = planRecovery(
      input({
        grossRequirements: series(400),
        ceiling: {
          weeklyCapacity: 5,
          storageCapacity: null,
          shelfLifeDays: null,
          maxLotSize: null,
          dailyDemandMean: 400,
        },
      })
    );

    expect(result.orders).toEqual([]);
    expect(result.blocked.length).toBeGreaterThan(0);
    expect(result.blocked[0]?.blockedBy).toBe('VENDOR_CAPACITY');
    // And the exposure it failed to cover is residual, not recovered.
    expect(result.residualQty).toBeGreaterThan(0);
    expect(result.recoverableQty).toBe(0);
  });

  it('keeps a blocked candidate out of the recovered balance', () => {
    const blocked = planRecovery(
      input({
        grossRequirements: series(400),
        ceiling: {
          weeklyCapacity: 5,
          storageCapacity: null,
          shelfLifeDays: null,
          maxLotSize: null,
          dailyDemandMean: 400,
        },
      })
    );
    // A blocked candidate that still topped up the balance would report the
    // exposure it failed to cover as recovered.
    expect(blocked.projectedAvailableRecovered[HORIZON]).toBeLessThan(0);
  });

  it('refuses every week when the vendor plant is shut', () => {
    const allMondays = new Set<string>();
    for (let day = -7; day <= HORIZON + 7; day += 1) {
      const date = new Date((PLANNING_EPOCH + day) * 86_400_000);
      const monday = new Date(date);
      monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      allMondays.add(monday.toISOString().slice(0, 10));
    }

    const result = planRecovery(input({ shutdownMondays: allMondays }));
    expect(result.orders).toEqual([]);
    expect(result.blocked[0]?.blockedBy).toBe('VENDOR_SHUTDOWN');
  });
});

describe('recovery — against the netting walk it follows', () => {
  it('starts where netting says the fence is, under this run‘s lead time', () => {
    const master = itemPlant({
      itemId: 'RM-1',
      plantId: 'P1',
      leadTimeDays: 30,
      safetyStock: 100,
      lotSizeRule: 'LFL',
      minLotSize: null,
      roundingValue: null,
      maxLotSize: null,
    });
    const gross = series(10);

    const netted = netItemPlant({
      item: item({ id: 'RM-1' }),
      itemPlant: master,
      calendar: calendar(),
      planningEpochDay: PLANNING_EPOCH,
      horizonDays: HORIZON,
      openingStock: 1_000,
      grossRequirements: gross,
      scheduledReceipts: series(),
      plannedReceipts: series(),
      projectedAvailable: series(),
      projectedAvailableFeasible: series(),
      effectiveLeadTimeDays: 30,
      moq: 0,
      incrementQty: 0,
      vendorId: null,
      sourcePlantId: null,
    });

    // Netting and recovery must agree about the first date an order can land,
    // or a proposal is dated to a day nobody can hit.
    expect(netted.earliestFeasibleReceiptDay).toBeGreaterThan(0);
    const result = planRecovery(input({ earliestFeasibleReceiptDay: netted.earliestFeasibleReceiptDay }));
    for (const order of result.orders) {
      expect(order.receiptDay).toBeGreaterThanOrEqual(netted.earliestFeasibleReceiptDay);
    }
  });
});

describe('recovery — measures a planner can check', () => {
  it('does not refuse an order for a maximum lot that lot sizing already split', () => {
    // The split satisfies the maximum lot by construction. Checking the unsplit
    // total against it refused every recovery on any material whose requirement
    // exceeds one lot — which reported the hero as 0 MT recoverable.
    const result = planRecovery(
      input({
        itemPlant: itemPlant({
          itemId: 'RM-1',
          plantId: 'P1',
          leadTimeDays: 30,
          safetyStock: 100,
          lotSizeRule: 'LFL',
          minLotSize: null,
          roundingValue: null,
          maxLotSize: 50,
        }),
        ceiling: {
          weeklyCapacity: null,
          storageCapacity: null,
          shelfLifeDays: null,
          maxLotSize: 50,
          dailyDemandMean: 10,
        },
      })
    );

    expect(result.blocked).toEqual([]);
    expect(result.orders.length).toBeGreaterThan(0);
    for (const slice of result.orders[0]?.slices ?? []) expect(slice).toBeLessThanOrEqual(50);
  });

  it('reports recoverable and residual on one base, so they subtract', () => {
    const result = planRecovery(input());
    // The two together are the worst shortfall the feasible curve ever reaches;
    // neither is a sum of per-day top-ups, and neither exceeds it.
    expect(result.recoverableQty).toBeGreaterThanOrEqual(0);
    expect(result.residualQty).toBeGreaterThanOrEqual(0);
    expect(result.recoverableQty + result.residualQty).toBeGreaterThan(0);
  });

  it('closes everything past the fence, and nothing before it', () => {
    const result = planRecovery(input());
    // Lot-for-lot with no ceilings tops every day past the fence back to the
    // norm, so what is left standing is exactly the hole inside the fence —
    // which no order was ever going to reach.
    expect(result.residualQty).toBeCloseTo(result.unavoidableQty, 6);
    expect(result.recoverableQty).toBeGreaterThan(0);
  });
});
