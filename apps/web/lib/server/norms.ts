/**
 * The norms layer — the engines' output, cached for the screens.
 *
 * Adherence and norms are pure and fast, but they read the whole receipt
 * history and every item-plant, so running them per request would recompute the
 * same answer for every tile on the cockpit. They are cached beside the plan
 * cache and dropped by the same reset.
 *
 * The one rule this file exists to enforce: **every screen reads the same
 * recommendation object.** The cockpit's hero figure, the Norm Review row and
 * the Material View rail are three renderings of one computation, not three
 * computations that happen to agree today.
 */

import {
  computeNorm,
  dailyDemandStdDev,
  reconstructLeadTime,
  runAdherence,
  type AdherenceResult,
  type LeadTimeObservation,
  type NormRecommendation,
} from '@repo/planning-engine';
import { planKey, type PlanningSnapshot } from '@repo/domain';

import { dataPack, planFor, session, snapshotFor } from './planning-session';

export interface CategoryNorms {
  adherence: AdherenceResult;
  /** Keyed by `itemId@plantId`. */
  recommendations: Map<string, NormRecommendation>;
  excessCapital: number;
  unprotectedExposure: number;
  materialsInExcess: number;
  materialsBelowNorm: number;
  elapsedMs: number;
}

const cache = new Map<string, { key: string; value: CategoryNorms }>();

/** Changes whenever anything the norms depend on has moved. */
function cacheKey(scenarioId: string): string {
  const state = session();
  return `${scenarioId}:${state.sequence}:${state.pack.id}`;
}

export function categoryNorms(scenarioId = 'baseline'): CategoryNorms {
  const key = cacheKey(scenarioId);
  const hit = cache.get(scenarioId);
  if (hit && hit.key === key) return hit.value;

  const value = compute(scenarioId);
  cache.set(scenarioId, { key, value });
  return value;
}

export function normFor(itemId: string, plantId: string, scenarioId = 'baseline'): NormRecommendation | null {
  return categoryNorms(scenarioId).recommendations.get(planKey(itemId, plantId)) ?? null;
}

export function clearNormsCache(): void {
  cache.clear();
}

/** Matched receipts for one item-plant, as lead-time observations. */
export function observationsFor(
  adherence: AdherenceResult,
  snapshot: PlanningSnapshot,
  itemId: string,
  plantId: string,
): LeadTimeObservation[] {
  const imports = new Set(
    snapshot.itemVendors.filter((row) => row.isImport).map((row) => `${row.itemId}@${row.plantId}@${row.vendorId}`),
  );
  return adherence.matched
    .filter((row) => row.receipt.itemId === itemId && row.receipt.plantId === plantId)
    .map((row) => ({
      days: row.observedLeadTimeDays,
      receivedOn: row.receipt.receivedOn,
      poId: row.receipt.poId,
      vendorId: row.receipt.vendorId,
      isImport: imports.has(`${itemId}@${plantId}@${row.receipt.vendorId}`),
    }));
}

function compute(scenarioId: string): CategoryNorms {
  const startedAt = performance.now();
  const snapshot = snapshotFor();
  const plan = planFor(scenarioId);
  const pack = dataPack();

  const adherence = runAdherence({ receiptHistory: snapshot.receiptHistory, supply: snapshot.supply });

  const items = new Map(snapshot.items.map((item) => [item.id, item]));
  const vendorFor = new Map(
    snapshot.itemVendors.filter((row) => row.isPrimary).map((row) => [`${row.itemId}@${row.plantId}`, row]),
  );

  const recommendations = new Map<string, NormRecommendation>();
  let excessCapital = 0;
  let unprotectedExposure = 0;
  let materialsInExcess = 0;
  let materialsBelowNorm = 0;

  for (const itemPlant of snapshot.itemPlants) {
    if (itemPlant.procurementType !== 'BUY') continue;
    const key = planKey(itemPlant.itemId, itemPlant.plantId);
    const itemPlan = plan.plans.get(key);
    const item = items.get(itemPlant.itemId);
    if (!itemPlan || !item) continue;

    const leadTime = reconstructLeadTime(observationsFor(adherence, snapshot, itemPlant.itemId, itemPlant.plantId), {
      planningDate: pack.planningDate,
    });
    // No recommendation without enough evidence to carry one. A norm proposed
    // off two receipts is exactly the kind of thing that loses the argument.
    if (!leadTime || leadTime.confidence !== 'HIGH') continue;

    let total = 0;
    for (const value of itemPlan.underlyingDemand) total += value;
    const dailyDemandMean = total / itemPlan.underlyingDemand.length;
    if (dailyDemandMean <= 0) continue;

    const vendor = vendorFor.get(`${itemPlant.itemId}@${itemPlant.plantId}`);
    const recommendation = computeNorm({
      itemId: itemPlant.itemId,
      plantId: itemPlant.plantId,
      serviceLevel: itemPlant.serviceLevelTarget,
      dailyDemandMean,
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
    });

    recommendations.set(key, recommendation);
    excessCapital += recommendation.excessCapital;
    unprotectedExposure += recommendation.unprotectedExposure;
    if (recommendation.excessCapital > 0) materialsInExcess += 1;
    if (recommendation.unprotectedExposure > 0) materialsBelowNorm += 1;
  }

  return {
    adherence,
    recommendations,
    excessCapital,
    unprotectedExposure,
    materialsInExcess,
    materialsBelowNorm,
    elapsedMs: performance.now() - startedAt,
  };
}
