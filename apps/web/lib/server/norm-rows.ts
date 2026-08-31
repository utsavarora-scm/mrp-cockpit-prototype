/**
 * The Norm Review projection.
 *
 * One row per material with a recommendation, carrying enough for the row
 * expansion to show its whole working without a second request — the histogram,
 * the calculation with real values substituted, the binding constraints and the
 * receipts underneath. The expansion is the screen's hero, so making it wait on
 * a fetch would put a spinner in the middle of the 1:50 beat.
 */

import { planKey, type PlanningSnapshot } from '@repo/domain';
import type { NormConstraint, NormRecommendation } from '@repo/planning-engine';

import type { ConstraintView, NormRow, NormsQueryResult } from '../api-types';
import { categoryNorms } from './norms';
import { snapshotFor } from './planning-session';

const CONSTRAINT_LABEL: Record<NormConstraint['kind'], string> = {
  CAMPAIGN_CYCLE: 'Production campaign cycle',
  MOQ: 'Minimum order quantity',
  SHELF_LIFE: 'Shelf life',
  STORAGE: 'Plant storage',
};

export interface NormsQuery {
  search?: string;
  plant?: string;
  vendor?: string;
  abcClass?: string;
  /** 'excess' | 'exposure' — which side of the gap to show. */
  direction?: string;
  /** Only materials whose parameters are older than this many days. */
  staleDays?: number;
  limit?: number;
}

export function normRows(query: NormsQuery = {}, scenarioId = 'baseline'): NormsQueryResult {
  const norms = categoryNorms(scenarioId);
  const snapshot = snapshotFor();

  const items = new Map(snapshot.items.map((item) => [item.id, item]));
  const masters = new Map(snapshot.itemPlants.map((row) => [planKey(row.itemId, row.plantId), row]));
  const vendorNames = new Map(snapshot.vendors.map((vendor) => [vendor.id, vendor.name]));
  const primaryVendor = new Map(
    snapshot.itemVendors.filter((row) => row.isPrimary).map((row) => [planKey(row.itemId, row.plantId), row]),
  );

  const planningEpoch = Date.parse(`${snapshot.systemSnapshots[0]?.lastSyncAt.slice(0, 10) ?? '2026-08-30'}T00:00:00Z`);

  const all: NormRow[] = [];
  for (const [key, recommendation] of norms.recommendations) {
    const master = masters.get(key);
    const item = items.get(recommendation.itemId);
    if (!master || !item) continue;

    const vendor = primaryVendor.get(key);
    const maintainedQty = recommendation.maintainedStockQty;
    const direction = recommendation.excessCapital > 0 ? 'EXCESS' : 'EXPOSURE';

    all.push({
      itemId: recommendation.itemId,
      plantId: recommendation.plantId,
      description: item.description,
      baseUom: item.baseUom,
      abcClass: item.abcClass,
      vendorId: vendor?.vendorId ?? null,
      vendorName: vendor ? (vendorNames.get(vendor.vendorId) ?? null) : null,
      isImport: vendor?.isImport ?? false,
      paramsLastChangedOn: master.paramsLastChangedOn,

      maintainedOrderDays: master.maintainedOrderDays,
      recommendedOrderDays: recommendation.recommendedOrderDays,
      maintainedStockDays: master.maintainedStockDays,
      recommendedStockDays: recommendation.constrainedStockDays,
      stockDaysGap:
        master.maintainedStockDays === null ? null : recommendation.constrainedStockDays - master.maintainedStockDays,

      maintainedQty,
      recommendedQty: recommendation.constrainedStockQty,
      // Signed, so the table can sort one column and still separate the two
      // halves of the cockpit hero.
      valueImpact: direction === 'EXCESS' ? recommendation.excessCapital : -recommendation.unprotectedExposure,
      direction,
      confidence: recommendation.leadTime.confidence,

      calculation: {
        z: recommendation.z,
        serviceLevel: recommendation.serviceLevel,
        dailyDemandMean: recommendation.dailyDemandMean,
        dailyDemandStdDev: recommendation.dailyDemandStdDev,
        leadTimeMean: recommendation.leadTime.mean,
        leadTimeStdDev: recommendation.leadTime.stdDev,
        demandTerm: recommendation.demandTerm,
        leadTimeTerm: recommendation.leadTimeTerm,
        leadTimeShare: recommendation.leadTimeShare,
        naiveQty: recommendation.naiveSafetyStockQty,
        combinedQty: recommendation.safetyStockQty,
        ratio: recommendation.ratioToNaive,
      },
      constraints: recommendation.constraints.map(toConstraintView),
      observations: recommendation.leadTime.sample.map((row) => row.days),
      receipts: recommendation.leadTime.sample.map((row) => ({
        poId: row.poId,
        vendorId: row.vendorId,
        vendorName: vendorNames.get(row.vendorId) ?? null,
        orderedOn: '',
        promisedOn: '',
        receivedOn: row.receivedOn,
        qty: 0,
        actualLeadTimeDays: row.days,
      })),
      unmatchedCount: unmatchedFor(norms, recommendation),
    });
  }

  const filtered = all.filter((row) => {
    if (query.plant && row.plantId !== query.plant) return false;
    if (query.vendor && row.vendorId !== query.vendor) return false;
    if (query.abcClass && row.abcClass !== query.abcClass) return false;
    if (query.direction === 'excess' && row.direction !== 'EXCESS') return false;
    if (query.direction === 'exposure' && row.direction !== 'EXPOSURE') return false;
    if (query.staleDays !== undefined) {
      const age = (planningEpoch - Date.parse(`${row.paramsLastChangedOn}T00:00:00Z`)) / 86_400_000;
      if (age < query.staleDays) return false;
    }
    if (query.search) {
      const needle = query.search.toLowerCase();
      const haystack = `${row.itemId} ${row.description} ${row.vendorName ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  // Sorted by money, largest first, whichever side of the gap it falls on.
  filtered.sort((a, b) => Math.abs(b.valueImpact) - Math.abs(a.valueImpact));

  const usedVendors = new Map<string, string>();
  for (const row of all) {
    if (row.vendorId) usedVendors.set(row.vendorId, row.vendorName ?? row.vendorId);
  }

  return {
    rows: filtered.slice(0, query.limit ?? 200),
    total: filtered.length,
    excessCapital: filtered.reduce((sum, row) => sum + Math.max(0, row.valueImpact), 0),
    unprotectedExposure: filtered.reduce((sum, row) => sum + Math.max(0, -row.valueImpact), 0),
    elapsedMs: norms.elapsedMs,
    vendors: [...usedVendors.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function toConstraintView(constraint: NormConstraint): ConstraintView {
  const value =
    constraint.limitDays !== null
      ? `${constraint.limitDays.toFixed(1)} days`
      : constraint.limitQty !== null
        ? Math.round(constraint.limitQty).toLocaleString('en-IN')
        : '—';
  return {
    kind: constraint.kind,
    label: CONSTRAINT_LABEL[constraint.kind],
    binding: constraint.binding,
    value,
    note: constraint.note,
  };
}

function unmatchedFor(norms: ReturnType<typeof categoryNorms>, recommendation: NormRecommendation): number {
  let count = 0;
  for (const row of norms.adherence.unmatched) {
    if (row.receipt.itemId === recommendation.itemId && row.receipt.plantId === recommendation.plantId) count += 1;
  }
  return count;
}

/** Unused today, kept honest: the snapshot type the query closes over. */
export type NormsSnapshot = PlanningSnapshot;
