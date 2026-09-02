/**
 * Netting — the back-schedule offset, and the one invariant that holds it to
 * the lead-time fence.
 *
 * The offset and the fence are computed by two different modules from the same
 * master data, and for a long time they disagreed: `leadTimeChain` treated
 * `leadTimeDays` as the complete release-to-available chain while netting added
 * goods-receipt processing on top of it again. Two days, on a material whose
 * entire story is that the fence sits ten weeks to the right of the breach.
 *
 * Nothing asserted they agreed, so nothing caught it. This does.
 */

import { describe, expect, it } from 'vitest';
import type { ItemVendor } from '@repo/domain';
import { addDays, planKey, toEpochDay } from '@repo/domain';

import { runMrp } from '../src/run-mrp';
import { alternateLeadTimeChain, computeFences, leadTimeChain } from '../src/fences';
import { WorkingCalendar } from '../src/calendar';
import { CONTINUOUS_CALENDAR, dailyDemand, item, itemPlant, options, PLANNING_DATE, snapshot, stock } from './fixtures';

const PLANNING_EPOCH = toEpochDay(PLANNING_DATE);

/** The import vendor of the worked example, whose intervals sum to 51 of the 90. */
function importVendor(overrides: Partial<ItemVendor> = {}): ItemVendor {
  return {
    itemId: 'RM-30114',
    plantId: 'P1',
    vendorId: 'V-IMP-01',
    isPrimary: true,
    leadTimeDays: 35,
    moq: 1_000,
    incrementQty: 250,
    unitPrice: 95_000,
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
    ...overrides,
  };
}

/** One bought material that breaches, so netting has something to back-schedule. */
function breachingSnapshot(master: Parameters<typeof itemPlant>[0], vendor: ItemVendor | null = importVendor()) {
  return snapshot({
    items: [item({ id: master.itemId })],
    itemPlants: [itemPlant(master)],
    vendors: vendor
      ? [
          {
            id: vendor.vendorId,
            name: 'Vendor',
            reliabilityScore: 0.9,
            calendarId: CONTINUOUS_CALENDAR.id,
            productionShutdownWeeks: [],
          },
        ]
      : [],
    itemVendors: vendor ? [{ ...vendor, itemId: master.itemId, plantId: master.plantId }] : [],
    stock: [stock(master.itemId, master.plantId, 100)],
    demand: dailyDemand(master.itemId, master.plantId, 40, 1, 25),
  });
}

describe('the back-schedule offset', () => {
  it('is the whole maintained chain, and counts goods receipt exactly once', () => {
    // 90 days, of which goods receipt is 2 and quality release 4 — both already
    // inside the maintained total, per the material master.
    const plan = runMrp(
      breachingSnapshot({
        itemId: 'RM-30114',
        plantId: 'P1',
        safetyStock: 500,
        leadTimeDays: 90,
        grProcessingTimeDays: 2,
        qaQuarantineDays: 4,
      }),
      options({ horizonDays: 40 })
    );

    const explanations = plan.orderExplanations.get(planKey('RM-30114', 'P1')) ?? [];
    expect(explanations.length).toBeGreaterThan(0);
    for (const order of explanations) {
      expect(order.totalOffsetDays).toBe(90);
      expect(order.effectiveLeadTimeDays).toBe(90);
    }
  });

  it('agrees with the lead-time fence, which is the invariant that was missing', () => {
    const master = itemPlant({
      itemId: 'RM-30114',
      plantId: 'P1',
      safetyStock: 500,
      leadTimeDays: 90,
      grProcessingTimeDays: 2,
      qaQuarantineDays: 4,
    });
    const plan = runMrp(breachingSnapshot(master), options({ horizonDays: 40 }));

    const chain = leadTimeChain(master, importVendor());
    const explanations = plan.orderExplanations.get(planKey('RM-30114', 'P1')) ?? [];
    for (const order of explanations) {
      expect(order.totalOffsetDays).toBe(chain.totalDays + master.safetyTimeDays);
    }
  });

  it('adds safety time, which is the one interval that sits outside the chain', () => {
    const master = itemPlant({
      itemId: 'RM-1',
      plantId: 'P1',
      safetyStock: 500,
      leadTimeDays: 30,
      grProcessingTimeDays: 2,
      qaQuarantineDays: 1,
      safetyTimeDays: 5,
    });
    const plan = runMrp(breachingSnapshot(master), options({ horizonDays: 40 }));

    const explanations = plan.orderExplanations.get(planKey('RM-1', 'P1')) ?? [];
    expect(explanations.length).toBeGreaterThan(0);
    for (const order of explanations) expect(order.totalOffsetDays).toBe(35);
  });

  it('walks calendar days for a bought material — a vessel sails through the weekend', () => {
    const master = itemPlant({
      itemId: 'RM-1',
      plantId: 'P1',
      safetyStock: 500,
      leadTimeDays: 20,
      procurementType: 'BUY',
    });
    const plan = runMrp(breachingSnapshot(master), options({ horizonDays: 40 }));

    const explanations = plan.orderExplanations.get(planKey('RM-1', 'P1')) ?? [];
    const first = explanations[0];
    expect(first).toBeDefined();
    // Twenty calendar days back from the receipt, on a seven-day calendar where
    // no snapping can occur. Working days would have reached three weeks further.
    const receiptDay = (first as (typeof explanations)[number]).requirementDay;
    expect(toEpochDay((first as (typeof explanations)[number]).releaseDate) - PLANNING_EPOCH).toBe(receiptDay - 20);
  });
});

describe('the alternate source', () => {
  const master = itemPlant({
    itemId: 'RM-30114',
    plantId: 'P1',
    leadTimeDays: 90,
    grProcessingTimeDays: 2,
    qaQuarantineDays: 4,
  });

  it('is summed from its own record, never from the primary‘s maintained total', () => {
    // A local alternate: 2 + 16 + 8 + 0, plus the plant's own 2 + 4.
    const local = importVendor({
      vendorId: 'V-LOC-01',
      isPrimary: false,
      leadTimeDays: 16,
      transitDays: 8,
      acknowledgementDays: 2,
      customsDays: 0,
      isImport: false,
    });

    expect(alternateLeadTimeChain(master, local).totalDays).toBe(32);
    // What the old path returned for the same vendor: the primary's 90, with
    // the alternate's intervals rearranged around it. The right answer to the
    // wrong question, and a comfortable way to promise a week nobody can reach.
    expect(leadTimeChain(master, local).totalDays).toBe(90);
  });

  it('draws a fence a planner can act on, two months left of the import', () => {
    const calendar = new WorkingCalendar(CONTINUOUS_CALENDAR, PLANNING_DATE, 182);
    const base = { planningEpochDay: PLANNING_EPOCH, calendar, measuredTotalDays: null, horizonDays: 182 };
    const local = importVendor({
      vendorId: 'V-LOC-01',
      isPrimary: false,
      leadTimeDays: 16,
      transitDays: 8,
      acknowledgementDays: 2,
      customsDays: 0,
    });

    const importFence = computeFences({
      ...base,
      maintainedChainDays: leadTimeChain(master, importVendor()).totalDays,
    });
    const localFence = computeFences({ ...base, maintainedChainDays: alternateLeadTimeChain(master, local).totalDays });

    expect(importFence.maintained.earliestReceiptDate).toBe(addDays(PLANNING_DATE, 90));
    expect(localFence.maintained.earliestReceiptDate).toBe(addDays(PLANNING_DATE, 32));
  });
});
