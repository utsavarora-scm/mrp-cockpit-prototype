/**
 * The norms engine, checked against Brief Appendix A.1.
 *
 * A.1 is the demo's centrepiece and the only number in the product that a
 * viewer might arrive already knowing. It has to reproduce exactly — not
 * approximately, and not because the figures were typed in. Every value below
 * is computed from the same fourteen seeded receipts the Explain drawer lists.
 */

import { describe, expect, it } from 'vitest';

import { computeNorm, reconstructLeadTime, type LeadTimeObservation } from '../src/norms';

/**
 * The hero material's fourteen matched receipts, in the order they were
 * received. Interleaved long and short deliberately: sorted ascending, the six
 * most recent would all be short deliveries and any recency weighting would
 * erase the very finding the appendix rests on.
 */
const HERO_LEAD_TIMES = [64, 32, 62, 32, 61, 34, 55, 35, 55, 41, 51, 43, 50, 43] as const;

const PLANNING_DATE = '2026-08-30';

function heroObservations(): LeadTimeObservation[] {
  // 37 days apart, most recent first — the cadence the pack seeds.
  return HERO_LEAD_TIMES.map((days, index) => {
    const received = new Date(Date.parse(`${PLANNING_DATE}T00:00:00Z`) - (40 + index * 37) * 86_400_000);
    return {
      days,
      receivedOn: received.toISOString().slice(0, 10),
      poId: `POH-RM-PD-001-${String(index + 1).padStart(2, '0')}`,
      vendorId: 'V-IMP-01',
      isImport: true,
    };
  });
}

describe('norms engine — Brief A.1', () => {
  const leadTime = reconstructLeadTime(heroObservations(), { planningDate: PLANNING_DATE });

  it('reconstructs 47 days, varying by 11, from fourteen receipts', () => {
    expect(leadTime).not.toBeNull();
    expect(leadTime?.count).toBe(14);
    expect(leadTime?.mean).toBeCloseTo(47, 10);
    expect(leadTime?.stdDev).toBeCloseTo(11, 10);
    expect(leadTime?.confidence).toBe('HIGH');
    expect(leadTime?.basis).toBe('ITEM_VENDOR_PLANT');
  });

  it('leaves the sample alone when winsorising — P99 of fourteen points is the largest of them', () => {
    // Nearest-rank, deliberately. An interpolated P99 lands between the two
    // largest observations and would clip 64 to 63.7, moving the mean off 47.
    expect(leadTime?.winsorisedCount).toBe(0);
    expect(leadTime?.p95).toBe(64);
  });

  const norm = computeNorm({
    itemId: 'RM-PD-001',
    plantId: 'P1',
    serviceLevel: 0.975,
    dailyDemandMean: 42,
    dailyDemandStdDev: 9,
    leadTime: leadTime!,
    goodsReceiptProcessingDays: 2,
    standardCost: 95_000,
    maintainedStockDays: 45,
    maintainedStockQty: 121,
    campaignCycleDays: null,
    moq: 200,
    shelfLifeDays: 365,
    storageCapacity: 1_300,
  });

  it('sizes the naive buffer at 121 MT — about 2.9 days of cover', () => {
    expect(norm.naiveSafetyStockQty).toBeCloseTo(121, 0);
    expect(norm.naiveStockDays).toBeCloseTo(2.9, 1);
  });

  it('sizes the combined buffer at 914 MT — about 21.8 days of cover', () => {
    expect(norm.safetyStockQty).toBeCloseTo(914, 0);
    expect(norm.recommendedStockDays).toBeCloseTo(21.8, 1);
  });

  it('puts the two answers 7.6 times apart', () => {
    expect(norm.ratioToNaive).toBeCloseTo(7.554, 3);
  });

  it('attributes 98% of the buffer to lead-time variability, not demand', () => {
    expect(norm.demandTerm).toBeCloseTo(3_807, 0);
    expect(norm.leadTimeTerm).toBeCloseTo(213_444, 0);
    expect(norm.demandTerm + norm.leadTimeTerm).toBeCloseTo(217_251, 0);
    expect(norm.leadTimeShare).toBeCloseTo(0.9825, 4);
  });

  it('values the buffer at ₹8.7 crore at ₹95,000 a tonne', () => {
    expect(norm.safetyStockQty * 95_000).toBeCloseTo(86_800_000, -5);
  });

  it('leaves every constraint slack for this material', () => {
    // None of them should bind — if one starts to, the 914 on screen stops
    // being the formula's answer and the appendix quietly breaks.
    for (const constraint of norm.constraints) expect(constraint.binding).toBe(false);
    expect(norm.constrainedStockQty).toBeCloseTo(914, 0);
  });

  it('adds only the plant’s own handling time to the order window', () => {
    // Transit is already inside a reconstruction of receivedOn − orderedOn.
    // Adding it again would push every order date out by a fortnight.
    expect(norm.recommendedOrderDays).toBeCloseTo(49, 10);
    expect(norm.orderDaysComponents.transitIncludedInObserved).toBe(true);
  });

  it('prices the maintained norm as unprotected rather than excess', () => {
    expect(norm.excessCapital).toBe(0);
    expect(norm.unprotectedExposure).toBeGreaterThan(0);
    // A 121 MT buffer against a spread of 466 MT is breached roughly 40% of
    // the time — which is the argument, not the 914 on its own.
    expect(norm.stockoutProbability).toBeGreaterThan(0.3);
    expect(norm.stockoutProbability).toBeLessThan(0.5);
  });
});

describe('norms engine — recency weighting', () => {
  it('moves the mean when weighting is turned on, and says so', () => {
    const unweighted = reconstructLeadTime(heroObservations(), { planningDate: PLANNING_DATE });
    const weighted = reconstructLeadTime(heroObservations(), { planningDate: PLANNING_DATE, halfLifeDays: 90 });

    expect(unweighted?.mean).toBeCloseTo(47, 10);
    // This is exactly why the default is unweighted: at a 90-day half-life
    // across an 18-month sample the reconstruction drifts off the figure a
    // planner can add up from the receipts on screen.
    expect(weighted?.mean).toBeGreaterThan(48);
    expect(weighted?.halfLifeDays).toBe(90);
    expect(unweighted?.halfLifeDays).toBeNull();
  });

  it('shortens the half-life to weight recent receipts harder', () => {
    const ninety = reconstructLeadTime(heroObservations(), { planningDate: PLANNING_DATE, halfLifeDays: 90 });
    const thirty = reconstructLeadTime(heroObservations(), { planningDate: PLANNING_DATE, halfLifeDays: 30 });
    // The most recent receipt took 64 days, so weighting harder pulls up.
    expect(thirty?.mean).toBeGreaterThan(ninety?.mean as number);
  });
});

describe('norms engine — constraints', () => {
  const leadTime = reconstructLeadTime(heroObservations(), { planningDate: PLANNING_DATE })!;

  const base = {
    itemId: 'X',
    plantId: 'P1',
    serviceLevel: 0.975,
    dailyDemandMean: 42,
    dailyDemandStdDev: 9,
    leadTime,
    goodsReceiptProcessingDays: 2,
    standardCost: 95_000,
    maintainedStockDays: 45,
    maintainedStockQty: 121,
    campaignCycleDays: null,
    moq: null,
    shelfLifeDays: null,
    storageCapacity: null,
  };

  it('caps the norm at what the plant can hold, and records that it did', () => {
    const norm = computeNorm({ ...base, storageCapacity: 500 });
    const storage = norm.constraints.find((row) => row.kind === 'STORAGE');
    expect(storage?.binding).toBe(true);
    expect(norm.constrainedStockQty).toBe(500);
    // The formula's own answer survives alongside the capped one.
    expect(norm.safetyStockQty).toBeCloseTo(914, 0);
  });

  it('floors the norm at the campaign cycle', () => {
    const norm = computeNorm({ ...base, campaignCycleDays: 40 });
    expect(norm.constraints.find((row) => row.kind === 'CAMPAIGN_CYCLE')?.binding).toBe(true);
    expect(norm.constrainedStockDays).toBe(40);
  });

  it('does not let a short shelf life be overridden by the formula', () => {
    const norm = computeNorm({ ...base, shelfLifeDays: 80 });
    const shelf = norm.constraints.find((row) => row.kind === 'SHELF_LIFE');
    expect(shelf?.binding).toBe(true);
    expect(norm.constrainedStockDays).toBeLessThan(norm.recommendedStockDays);
  });

  it('prices a maintained norm above the computed one as excess capital', () => {
    const norm = computeNorm({ ...base, maintainedStockQty: 2_000 });
    expect(norm.excessCapital).toBeCloseTo((2_000 - norm.constrainedStockQty) * 95_000, 0);
    expect(norm.unprotectedExposure).toBe(0);
  });
});

describe('norms engine — fallback and thin samples', () => {
  it('marks a sample below six receipts as low confidence', () => {
    const thin = reconstructLeadTime(heroObservations().slice(0, 4), { planningDate: PLANNING_DATE });
    expect(thin?.count).toBe(4);
    expect(thin?.confidence).toBe('LOW');
  });

  it('returns null when there is no history at all', () => {
    expect(reconstructLeadTime([], { planningDate: PLANNING_DATE })).toBeNull();
  });
});
