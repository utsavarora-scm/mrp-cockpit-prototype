/**
 * The four engines, run against the seeded pack rather than against fixtures.
 *
 * The unit tests in `planning-engine` prove each engine is correct on inputs
 * handed to it. This one proves the pack and the engines agree — that the
 * fourteen receipts the pack seeds are the fourteen the adherence engine
 * matches, that the distribution reconstructed from them is the one Brief A.1
 * reconstructs, and that the norm computed from *that* is 914 MT. Every link in
 * the chain the demo clicks through at 1:50.
 */

import { describe, expect, it } from 'vitest';
import {
  computeNorm,
  dailyDemandStdDev,
  demandStdDev,
  reconstructLeadTime,
  runAdherence,
  runMrp,
  type LeadTimeObservation,
} from '@repo/planning-engine';
import { planKey } from '@repo/domain';

import { getDataPack, HERO } from '../src/index';

const pack = getDataPack();
const snapshot = pack.generate();
const plan = runMrp(snapshot, pack.defaultOptions('baseline'));
const adherence = runAdherence({ receiptHistory: snapshot.receiptHistory, supply: snapshot.supply });

/** Matched receipts for one item-plant, as lead-time observations. */
function observationsFor(itemId: string, plantId: string): LeadTimeObservation[] {
  return adherence.matched
    .filter((row) => row.receipt.itemId === itemId && row.receipt.plantId === plantId)
    .map((row) => ({
      days: row.observedLeadTimeDays,
      receivedOn: row.receipt.receivedOn,
      poId: row.receipt.poId,
      vendorId: row.receipt.vendorId,
      isImport: true,
    }));
}

describe('adherence over the whole pack', () => {
  it('accounts for every receipt — matched or queued, never dropped', () => {
    expect(adherence.matched.length + adherence.unmatched.length).toBe(snapshot.receiptHistory.length);
  });

  it('leaves an unmatched queue with something actually in it', () => {
    // A queue that is always empty demonstrates nothing, and a feed that never
    // fails to match is a feed nobody has looked at.
    expect(adherence.unmatched.length).toBeGreaterThan(0);
    const share = adherence.unmatched.length / snapshot.receiptHistory.length;
    expect(share).toBeLessThan(0.1);
  });

  it('matches fourteen of the hero material’s seventeen receipts', () => {
    const seeded = snapshot.receiptHistory.filter((row) => row.itemId === HERO.itemId && row.plantId === HERO.plantId);
    const matched = observationsFor(HERO.itemId, HERO.plantId);
    const queued = adherence.unmatched.filter((row) => row.receipt.itemId === HERO.itemId);

    expect(seeded).toHaveLength(17);
    expect(matched).toHaveLength(14);
    expect(queued).toHaveLength(3);
  });
});

describe('Brief A.1, reconstructed end to end from the pack', () => {
  const observations = observationsFor(HERO.itemId, HERO.plantId);
  const leadTime = reconstructLeadTime(observations, { planningDate: pack.planningDate })!;

  const itemPlant = snapshot.itemPlants.find((row) => row.itemId === HERO.itemId && row.plantId === HERO.plantId)!;
  const item = snapshot.items.find((row) => row.id === HERO.itemId)!;
  const vendor = snapshot.itemVendors.find((row) => row.itemId === HERO.itemId && row.plantId === HERO.plantId)!;

  it('reconstructs 47 days varying by 11, from the pack’s own receipts', () => {
    expect(leadTime.count).toBe(14);
    expect(leadTime.mean).toBeCloseTo(47, 10);
    expect(leadTime.stdDev).toBeCloseTo(11, 10);
  });

  it('is planned on a maintained 45 days last touched in March 2024', () => {
    expect(itemPlant.leadTimeDays).toBe(45);
    expect(itemPlant.paramsLastChangedOn).toBe(HERO.paramsLastChangedOn);
  });

  const norm = computeNorm({
    itemId: HERO.itemId,
    plantId: HERO.plantId,
    serviceLevel: itemPlant.serviceLevelTarget,
    dailyDemandMean: HERO.dailyDemandMean,
    dailyDemandStdDev: HERO.dailyDemandStdDev,
    leadTime,
    goodsReceiptProcessingDays: itemPlant.grProcessingTimeDays,
    standardCost: item.standardCost,
    maintainedStockDays: itemPlant.maintainedStockDays,
    maintainedStockQty: itemPlant.safetyStock,
    campaignCycleDays: itemPlant.campaignCycleDays,
    moq: vendor.moq,
    shelfLifeDays: item.shelfLifeDays,
    storageCapacity: itemPlant.storageCapacity,
  });

  it('computes 121 naive against 914 combined — 7.6 times apart', () => {
    expect(norm.naiveSafetyStockQty).toBeCloseTo(121, 0);
    expect(norm.safetyStockQty).toBeCloseTo(914, 0);
    expect(norm.ratioToNaive).toBeCloseTo(7.554, 3);
    expect(norm.leadTimeShare).toBeCloseTo(0.9825, 4);
  });

  it('values that buffer at ₹8.7 crore', () => {
    expect(norm.safetyStockQty * item.standardCost).toBeCloseTo(86_800_000, -5);
  });

  it('agrees with the maintained norm the pack actually seeds', () => {
    // The 121 is not a constant typed into the pack alongside the receipts —
    // it is what the naive formula gives on this material's own numbers.
    expect(itemPlant.safetyStock).toBeCloseTo(norm.naiveSafetyStockQty, 0);
  });

  it('measures the daily demand spread the appendix uses, not a smoothed one', () => {
    // The app computes sigma_D from the demand series rather than from a
    // constant, so the series has to *be* 42 +/- 9. Smoothing it over a week
    // gives 3.2 instead, which quietly turns the 7.6x into 21x — both numbers
    // computed, only one of them right.
    const itemPlan = plan.plans.get(planKey(HERO.itemId, HERO.plantId))!;
    let total = 0;
    for (const value of itemPlan.underlyingDemand) total += value;
    const mean = total / itemPlan.underlyingDemand.length;

    expect(mean).toBeCloseTo(HERO.dailyDemandMean, 1);
    expect(dailyDemandStdDev(itemPlan.underlyingDemand)).toBeCloseTo(HERO.dailyDemandStdDev, 1);
    expect(demandStdDev(itemPlan.underlyingDemand)).toBeLessThan(5);
  });

  it('reproduces the ratio from the series rather than from the spec constants', () => {
    const itemPlan = plan.plans.get(planKey(HERO.itemId, HERO.plantId))!;
    let total = 0;
    for (const value of itemPlan.underlyingDemand) total += value;

    const fromSeries = computeNorm({
      itemId: HERO.itemId,
      plantId: HERO.plantId,
      serviceLevel: itemPlant.serviceLevelTarget,
      dailyDemandMean: total / itemPlan.underlyingDemand.length,
      dailyDemandStdDev: dailyDemandStdDev(itemPlan.underlyingDemand),
      leadTime,
      goodsReceiptProcessingDays: itemPlant.grProcessingTimeDays,
      standardCost: item.standardCost,
      maintainedStockDays: itemPlant.maintainedStockDays,
      maintainedStockQty: itemPlant.safetyStock,
      campaignCycleDays: itemPlant.campaignCycleDays,
      moq: vendor.moq,
      shelfLifeDays: item.shelfLifeDays,
      storageCapacity: itemPlant.storageCapacity,
    });

    // What the screen actually renders: 121 against 913, 7.6x apart.
    expect(fromSeries.naiveSafetyStockQty).toBeCloseTo(121, 0);
    expect(fromSeries.safetyStockQty).toBeCloseTo(913, 0);
    expect(fromSeries.ratioToNaive).toBeGreaterThan(7.4);
    expect(fromSeries.ratioToNaive).toBeLessThan(7.8);
  });

  it('names the receipts it was reconstructed from', () => {
    expect(leadTime.sample).toHaveLength(14);
    for (const observation of leadTime.sample) {
      expect(observation.poId).toMatch(/^POH-/);
      const source = snapshot.receiptHistory.find((row) => row.poId === observation.poId);
      expect(source).toBeDefined();
      expect(source?.matchedLineId).not.toBeNull();
    }
  });
});

describe('norms across the category', () => {
  /** Every bought item-plant with enough history to carry a recommendation. */
  const recommendations = (() => {
    const results = [];
    for (const itemPlant of snapshot.itemPlants) {
      if (itemPlant.procurementType !== 'BUY') continue;
      const itemPlan = plan.plans.get(planKey(itemPlant.itemId, itemPlant.plantId));
      if (!itemPlan) continue;

      const observations = observationsFor(itemPlant.itemId, itemPlant.plantId);
      const leadTime = reconstructLeadTime(observations, { planningDate: pack.planningDate });
      if (!leadTime || leadTime.confidence !== 'HIGH') continue;

      const item = snapshot.items.find((row) => row.id === itemPlant.itemId);
      const vendor = snapshot.itemVendors.find(
        (row) => row.itemId === itemPlant.itemId && row.plantId === itemPlant.plantId
      );
      if (!item) continue;

      let total = 0;
      for (const value of itemPlan.underlyingDemand) total += value;
      const dailyMean = total / itemPlan.underlyingDemand.length;
      if (dailyMean <= 0) continue;

      results.push(
        computeNorm({
          itemId: itemPlant.itemId,
          plantId: itemPlant.plantId,
          serviceLevel: itemPlant.serviceLevelTarget,
          dailyDemandMean: dailyMean,
          dailyDemandStdDev: dailyDemandStdDev(itemPlan.underlyingDemand),
          leadTime,
          goodsReceiptProcessingDays: itemPlant.grProcessingTimeDays,
          standardCost: item.standardCost,
          maintainedStockDays: itemPlant.maintainedStockDays,
          maintainedStockQty: itemPlant.safetyStock,
          campaignCycleDays: itemPlant.campaignCycleDays,
          moq: vendor?.moq ?? null,
          shelfLifeDays: item.shelfLifeDays,
          storageCapacity: itemPlant.storageCapacity,
        })
      );
    }
    return results;
  })();

  it('produces a recommendation for a meaningful share of bought materials', () => {
    expect(recommendations.length).toBeGreaterThan(50);
  });

  it('finds both excess capital and unprotected exposure in the category', () => {
    // Both halves have to exist. A category that is only ever over-stocked or
    // only ever exposed is a category nobody would recognise — and the cockpit
    // leads with the pair, so an empty half is an empty hero.
    const excess = recommendations.reduce((total, row) => total + row.excessCapital, 0);
    const exposure = recommendations.reduce((total, row) => total + row.unprotectedExposure, 0);
    expect(excess).toBeGreaterThan(1e7);
    expect(exposure).toBeGreaterThan(1e7);
    // The band, not the figure. Pinning ₹7.1 Cr would break on every engine
    // improvement, and the point is that the gap is material, not that it is
    // exactly this.
    expect(excess + exposure).toBeGreaterThan(5e7);
    expect(excess + exposure).toBeLessThan(1.2e8);
  });

  it('is the packaging drift that carries the excess', () => {
    // Scenario 3: forty packaging materials maintained at 45 days against an
    // 18-day reality. This is what the cockpit's 0:00 number is made of, so if
    // it stops being the largest source the hero has lost its explanation.
    const byExcess = [...recommendations].sort((a, b) => b.excessCapital - a.excessCapital);
    const top = byExcess.slice(0, 10);
    for (const row of top) expect(row.itemId.startsWith('PM-')).toBe(true);
  });

  it('is the hero material that carries the exposure', () => {
    const byExposure = [...recommendations].sort((a, b) => b.unprotectedExposure - a.unprotectedExposure);
    expect(byExposure[0]?.itemId).toBe(HERO.itemId);
    const total = recommendations.reduce((sum, row) => sum + row.unprotectedExposure, 0);
    // One material carrying most of the category's exposure is the Act 1 story.
    expect((byExposure[0]?.unprotectedExposure ?? 0) / total).toBeGreaterThan(0.5);
  });

  it('records a binding constraint wherever the formula was overridden', () => {
    for (const row of recommendations) {
      const bound = row.constraints.some((constraint) => constraint.binding);
      if (Math.abs(row.constrainedStockQty - row.safetyStockQty) > 1) {
        expect(bound).toBe(true);
      }
    }
  });
});

describe('performance', () => {
  it('runs adherence over the whole category inside the budget', () => {
    // Best of three: turbo runs packages in parallel, so a single timing is a
    // measure of the machine's load as much as of the engine.
    let best = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const startedAt = performance.now();
      runAdherence({ receiptHistory: snapshot.receiptHistory, supply: snapshot.supply });
      best = Math.min(best, performance.now() - startedAt);
    }
    expect(best).toBeLessThan(2_000);
  });
});
