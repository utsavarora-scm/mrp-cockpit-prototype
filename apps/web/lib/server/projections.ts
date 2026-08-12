/**
 * Projections — turning the in-memory plan into what a screen actually draws.
 *
 * The plan holds typed arrays, a pegging graph and the whole snapshot. None of
 * that belongs in a browser. Everything here narrows it to the smallest honest
 * view of the data a given screen needs.
 */

import { proposeWritebacks } from '@repo/adapters';
import {
  IMPACT_CONFIG,
  formatDays,
  formatQty,
  fromEpochDay,
  planKey,
  toEpochDay,
  type DemandElement,
  type ItemPlant,
  type MrpResult,
  type PlanningException,
  type PlanningSnapshot,
  type Resolution,
} from '@repo/domain';
import { compositeScore, reviewPeriodDays, demandStdDev, simulate } from '@repo/mrp-engine';

import type {
  AffectedOrder,
  BlastRadius,
  BlastRadiusEdge,
  BlastRadiusNode,
  CockpitSummary,
  ExceptionDetail,
  ExceptionQueryResult,
  ExceptionRow,
  FacetOption,
  ItemDetail,
  KpiDelta,
  ParameterHealth,
  ParetoPoint,
  ResolutionCard,
  SimulationDiff,
  TimePhasedRow,
  TraceLine,
} from '../api-types';
import { dataPack, planFor, planningOptions, previousKpis, snapshotFor } from './planning-session';

const PARETO_POINTS = 60;
const SPARKLINE_BUCKETS = 32;

// ---------------------------------------------------------------------------
// Cockpit
// ---------------------------------------------------------------------------

export function cockpitSummary(scenarioId: string): CockpitSummary {
  const plan = planFor(scenarioId);
  const previous = previousKpis();
  const pack = dataPack();

  const delta = (value: number, before: number | undefined): KpiDelta => ({
    value,
    delta: before === undefined ? null : value - before,
  });

  let cumulative = 0;
  const pareto: ParetoPoint[] = [];
  for (let index = 0; index < Math.min(PARETO_POINTS, plan.exceptions.length); index += 1) {
    const exception = plan.exceptions[index] as PlanningException;
    cumulative += exception.impactValue;
    pareto.push({
      rank: index + 1,
      impactValue: exception.impactValue,
      cumulativeShare: plan.kpis.totalExposure > 0 ? cumulative / plan.kpis.totalExposure : 0,
      code: exception.code,
      itemId: exception.itemId,
      plantId: exception.plantId,
    });
  }

  return {
    scenarioId,
    planningDate: pack.planningDate,
    horizonDays: pack.horizonDays,
    elapsedMs: plan.elapsedMs,
    exceptionCount: plan.kpis.exceptionCount,
    totalExposure: delta(plan.kpis.totalExposure, previous?.totalExposure),
    projectedFillRate: delta(plan.kpis.projectedFillRate, previous?.projectedFillRate),
    inventoryValue: delta(plan.kpis.inventoryValue, previous?.inventoryValue),
    daysOnHand: delta(plan.kpis.daysOnHand, previous?.daysOnHand),
    excessObsoleteExposure: delta(plan.kpis.excessObsoleteExposure, previous?.excessObsoleteExposure),
    expediteSpendMtd: delta(plan.kpis.expediteSpendMtd, previous?.expediteSpendMtd),
    autoResolvedPct: delta(plan.kpis.autoResolvedPct, previous?.autoResolvedPct),
    exceptionsToSeventyPercent: plan.kpis.exceptionsToSeventyPercent,
    seventyPercentHeadShare: plan.kpis.seventyPercentHeadShare,
    exceptionsByClass: plan.kpis.exceptionsByClass,
    exposureByClass: plan.kpis.exposureByClass,
    pareto,
    sparklines: buildKpiSparklines(plan),
  };
}

/**
 * Small series behind each KPI tile.
 *
 * Derived from the plan itself — exposure accumulating over the horizon, the
 * balance across the network — rather than from invented history, because there
 * is no history to invent from and a fabricated trend line is exactly the kind
 * of detail this audience checks.
 */
function buildKpiSparklines(plan: MrpResult): Record<string, number[]> {
  const buckets = 24;
  const exposureByBucket = new Array<number>(buckets).fill(0);
  const horizon = plan.horizonDays;

  for (const exception of plan.exceptions) {
    if (exception.bucketDay < 0) continue;
    const bucket = Math.min(buckets - 1, Math.floor((exception.bucketDay / horizon) * buckets));
    exposureByBucket[bucket] = (exposureByBucket[bucket] as number) + exception.impactValue;
  }

  const coverByBucket = new Array<number>(buckets).fill(0);
  let counted = 0;
  for (const itemPlan of plan.plans.values()) {
    counted += 1;
    for (let bucket = 0; bucket < buckets; bucket += 1) {
      const day = Math.floor((bucket / buckets) * horizon);
      coverByBucket[bucket] = (coverByBucket[bucket] as number) + (itemPlan.daysOfCover[day] as number);
    }
  }
  if (counted > 0)
    for (let bucket = 0; bucket < buckets; bucket += 1)
      coverByBucket[bucket] = (coverByBucket[bucket] as number) / counted;

  return { exposure: exposureByBucket, cover: coverByBucket };
}

// ---------------------------------------------------------------------------
// Exception queue
// ---------------------------------------------------------------------------

export interface ExceptionFilters {
  plant?: string[];
  exceptionClass?: string[];
  itemType?: string[];
  abcClass?: string[];
  plannerCode?: string[];
  timeToImpact?: string[];
  autoResolvableOnly?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export function queryExceptions(scenarioId: string, filters: ExceptionFilters): ExceptionQueryResult {
  const plan = planFor(scenarioId);
  const snapshot = snapshotFor(scenarioId);
  const context = buildRowContext(plan, snapshot);

  const all = plan.exceptions.map((exception) => toRow(exception, plan, context));
  const matched = all.filter((row) => matches(row, filters));

  const limit = filters.limit ?? 200;
  const offset = filters.offset ?? 0;

  return {
    rows: matched.slice(offset, offset + limit),
    total: matched.length,
    filteredExposure: matched.reduce((sum, row) => sum + row.impactValue, 0),
    // Facets count against everything except their own dimension, so selecting
    // one plant does not make every other plant read zero.
    facets: {
      plant: facet(all, filters, 'plant', (row) => row.plantId),
      exceptionClass: facet(all, filters, 'exceptionClass', (row) => row.exceptionClass, classLabel),
      itemType: facet(all, filters, 'itemType', (row) => row.itemType),
      abcClass: facet(all, filters, 'abcClass', (row) => row.abcClass),
      plannerCode: facet(all, filters, 'plannerCode', (row) => row.plannerCode ?? '—'),
      timeToImpact: facet(all, filters, 'timeToImpact', timeBucketOf, timeBucketLabel),
    },
  };
}

interface RowContext {
  itemById: Map<string, PlanningSnapshot['items'][number]>;
  itemPlantByKey: Map<string, ItemPlant>;
  resolutions: Map<string, Resolution>;
  planningEpochDay: number;
}

function buildRowContext(plan: MrpResult, snapshot: PlanningSnapshot): RowContext {
  return {
    itemById: new Map(snapshot.items.map((item) => [item.id, item])),
    itemPlantByKey: new Map(snapshot.itemPlants.map((record) => [planKey(record.itemId, record.plantId), record])),
    resolutions: plan.resolutions,
    planningEpochDay: toEpochDay(plan.planningDate),
  };
}

function toRow(exception: PlanningException, plan: MrpResult, context: RowContext): ExceptionRow {
  const item = context.itemById.get(exception.itemId);
  const master = context.itemPlantByKey.get(planKey(exception.itemId, exception.plantId));
  const itemPlan = plan.plans.get(planKey(exception.itemId, exception.plantId));

  const best = exception.resolutionIds
    .map((id) => context.resolutions.get(id))
    .filter((resolution): resolution is Resolution => Boolean(resolution))
    .sort((a, b) => compositeScore(b) - compositeScore(a))[0];

  return {
    id: exception.id,
    code: exception.code,
    exceptionClass: exception.exceptionClass,
    severity: exception.severity,
    impactValue: exception.impactValue,
    itemId: exception.itemId,
    itemDescription: item?.description ?? '—',
    itemType: item?.type ?? '—',
    plantId: exception.plantId,
    abcClass: item?.abcClass ?? '—',
    xyzClass: item?.xyzClass ?? '—',
    plannerCode: master?.plannerCode ?? null,
    bucketDay: exception.bucketDay,
    needDate: exception.bucketDay >= 0 ? fromEpochDay(context.planningEpochDay + exception.bucketDay) : null,
    daysToImpact: exception.bucketDay >= 0 ? exception.bucketDay : null,
    peggedFgCount: exception.peggedFgCount,
    narrative: exception.narrative,
    bestResolutionLabel: best?.label ?? null,
    bestResolutionConfidence: best?.confidence ?? null,
    autoResolvable: exception.autoResolvable,
    sparkline: itemPlan ? downsample(itemPlan.projectedAvailableFeasible, SPARKLINE_BUCKETS) : [],
  };
}

function matches(row: ExceptionRow, filters: ExceptionFilters): boolean {
  if (filters.plant?.length && !filters.plant.includes(row.plantId)) return false;
  if (filters.exceptionClass?.length && !filters.exceptionClass.includes(row.exceptionClass)) return false;
  if (filters.itemType?.length && !filters.itemType.includes(row.itemType)) return false;
  if (filters.abcClass?.length && !filters.abcClass.includes(row.abcClass)) return false;
  if (filters.plannerCode?.length && !filters.plannerCode.includes(row.plannerCode ?? '—')) return false;
  if (filters.timeToImpact?.length && !filters.timeToImpact.includes(timeBucketOf(row))) return false;
  if (filters.autoResolvableOnly && !row.autoResolvable) return false;
  if (filters.search) {
    const needle = filters.search.toLowerCase();
    const haystack = `${row.itemId} ${row.itemDescription} ${row.code} ${row.plantId}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function facet(
  all: ExceptionRow[],
  filters: ExceptionFilters,
  dimension: keyof ExceptionFilters,
  valueOf: (row: ExceptionRow) => string,
  labelOf: (value: string) => string = (value) => value,
): FacetOption[] {
  const withoutOwn: ExceptionFilters = { ...filters, [dimension]: undefined };
  const counts = new Map<string, number>();
  for (const row of all) {
    if (!matches(row, withoutOwn)) continue;
    const value = valueOf(row);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: labelOf(value), count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.value < b.value ? -1 : 1));
}

function timeBucketOf(row: ExceptionRow): string {
  if (row.daysToImpact === null) return 'none';
  if (row.daysToImpact <= 7) return 'week';
  if (row.daysToImpact <= 30) return 'month';
  if (row.daysToImpact <= 90) return 'quarter';
  return 'later';
}

function timeBucketLabel(value: string): string {
  const labels: Record<string, string> = {
    week: 'Within 7 days',
    month: 'Within 30 days',
    quarter: 'Within 90 days',
    later: 'Beyond 90 days',
    none: 'Not time-phased',
  };
  return labels[value] ?? value;
}

function classLabel(value: string): string {
  const labels: Record<string, string> = {
    A: 'A · Supply continuity',
    B: 'B · Master data',
    C: 'C · Cross-system',
    D: 'D · Feasibility',
  };
  return labels[value] ?? value;
}

// ---------------------------------------------------------------------------
// Exception detail
// ---------------------------------------------------------------------------

export function exceptionDetail(scenarioId: string, exceptionId: string): ExceptionDetail | null {
  const plan = planFor(scenarioId);
  const snapshot = snapshotFor(scenarioId);
  const exception = plan.exceptions.find((entry) => entry.id === exceptionId);
  if (!exception) return null;

  const context = buildRowContext(plan, snapshot);
  const resolutions = exception.resolutionIds
    .map((id) => plan.resolutions.get(id))
    .filter((resolution): resolution is Resolution => Boolean(resolution))
    .map(
      (resolution): ResolutionCard => ({
        id: resolution.id,
        type: resolution.type,
        label: resolution.label,
        rationale: resolution.rationale,
        estimatedCost: resolution.estimatedCost,
        estimatedServiceImpact: resolution.estimatedServiceImpact,
        estimatedInventoryImpact: resolution.estimatedInventoryImpact,
        leadTimeToEffect: resolution.leadTimeToEffect,
        confidence: resolution.confidence,
        writebackTargets: resolution.writebackTargets,
        score: compositeScore(resolution),
      }),
    )
    .sort((a, b) => b.score - a.score);

  return {
    row: toRow(exception, plan, context),
    impact: exception.impact,
    trace: exception.evidence.map(
      (fact): TraceLine => ({
        label: fact.label,
        value: fact.value,
        detail: fact.detail,
        kind: fact.kind,
        link:
          fact.ref?.type === 'ITEM_PLANT'
            ? { type: 'ITEM', itemId: fact.ref.itemId, plantId: fact.ref.plantId }
            : fact.ref?.type === 'SYSTEM_SNAPSHOT'
              ? { type: 'SYSTEM', system: fact.ref.system }
              : undefined,
      }),
    ),
    resolutions,
    peggedDemandCount: exception.peggedDemandIds.length,
  };
}

// ---------------------------------------------------------------------------
// Item 360
// ---------------------------------------------------------------------------

export function itemDetail(scenarioId: string, itemId: string, plantId: string): ItemDetail | null {
  const plan = planFor(scenarioId);
  const snapshot = snapshotFor(scenarioId);
  const key = planKey(itemId, plantId);
  const itemPlan = plan.plans.get(key);
  const item = snapshot.items.find((entry) => entry.id === itemId);
  const master = snapshot.itemPlants.find((entry) => entry.itemId === itemId && entry.plantId === plantId);
  if (!itemPlan || !item || !master) return null;

  const planningEpochDay = toEpochDay(plan.planningDate);
  const dates = Array.from({ length: plan.horizonDays + 1 }, (_, day) => fromEpochDay(planningEpochDay + day));
  const stock = snapshot.stock.find((entry) => entry.itemId === itemId && entry.plantId === plantId);
  const context = buildRowContext(plan, snapshot);

  const demandByType = splitDemandByType(snapshot, plan, itemId, plantId, planningEpochDay, plan.horizonDays);
  const supplyRows = splitSupply(snapshot, itemId, plantId, planningEpochDay, plan.horizonDays);

  const grid: TimePhasedRow[] = [
    {
      key: 'gross',
      label: 'Gross requirements',
      values: Array.from(itemPlan.grossRequirements),
      children: demandByType,
    },
    {
      key: 'scheduled',
      label: 'Scheduled receipts',
      values: Array.from(itemPlan.scheduledReceipts),
      children: supplyRows,
      editable: true,
    },
    { key: 'planned', label: 'Planned receipts', values: Array.from(itemPlan.plannedReceipts) },
    { key: 'pab', label: 'Projected available', values: Array.from(itemPlan.projectedAvailable), emphasis: 'BALANCE' },
    {
      key: 'pab-feasible',
      label: 'Projected available — orderable supply only',
      values: Array.from(itemPlan.projectedAvailableFeasible),
      emphasis: 'BALANCE',
    },
    {
      key: 'safety',
      label: 'Safety stock',
      values: new Array(plan.horizonDays + 1).fill(itemPlan.safetyStock),
      emphasis: 'THRESHOLD',
    },
    { key: 'cover', label: 'Days of cover', values: Array.from(itemPlan.daysOfCover) },
  ];

  const exceptions = plan.exceptions
    .filter((exception) => exception.itemId === itemId && exception.plantId === plantId)
    .map((exception) => toRow(exception, plan, context));

  return {
    itemId,
    plantId,
    description: item.description,
    itemType: item.type,
    baseUom: item.baseUom,
    abcClass: item.abcClass,
    xyzClass: item.xyzClass,
    standardCost: item.standardCost,
    plannerCode: master.plannerCode,
    procurementType: master.procurementType,
    lowLevelCode: itemPlan.lowLevelCode,
    stock: {
      unrestricted: stock?.unrestricted ?? 0,
      blocked: stock?.blocked ?? 0,
      qualityInspection: stock?.qualityInspection ?? 0,
      inTransit: stock?.inTransit ?? 0,
    },
    safetyStock: itemPlan.safetyStock,
    dates,
    grossRequirements: Array.from(itemPlan.grossRequirements),
    scheduledReceipts: Array.from(itemPlan.scheduledReceipts),
    plannedReceipts: Array.from(itemPlan.plannedReceipts),
    projectedAvailable: Array.from(itemPlan.projectedAvailable),
    projectedAvailableFeasible: Array.from(itemPlan.projectedAvailableFeasible),
    daysOfCover: Array.from(itemPlan.daysOfCover),
    grid,
    parameters: parameterHealth(master, item, itemPlan, snapshot),
    exceptions,
    healthScore: healthScoreFor(master, snapshot, itemId, plantId),
  };
}

function splitDemandByType(
  snapshot: PlanningSnapshot,
  plan: MrpResult,
  itemId: string,
  plantId: string,
  planningEpochDay: number,
  horizonDays: number,
): TimePhasedRow[] {
  const buckets = horizonDays + 1;
  const byType = new Map<string, Float64Array>();

  const add = (element: DemandElement) => {
    if (element.itemId !== itemId || element.plantId !== plantId) return;
    const day = toEpochDay(element.requiredDate) - planningEpochDay;
    if (day < 0 || day > horizonDays) return;
    const label = `${element.type} · ${element.sourceSystem}`;
    let series = byType.get(label);
    if (!series) {
      series = new Float64Array(buckets);
      byType.set(label, series);
    }
    series[day] = (series[day] as number) + element.qty;
  };

  for (const element of snapshot.demand) add(element);
  for (const element of plan.derivedDemand) add(element);

  return [...byType.entries()]
    .map(([label, series]) => ({ key: `demand-${label}`, label: humanise(label), values: Array.from(series) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function splitSupply(
  snapshot: PlanningSnapshot,
  itemId: string,
  plantId: string,
  planningEpochDay: number,
  horizonDays: number,
): TimePhasedRow[] {
  return snapshot.supply
    .filter((element) => element.itemId === itemId && element.plantId === plantId)
    .map((element) => {
      const values = new Array<number>(horizonDays + 1).fill(0);
      const day = Math.max(0, Math.min(toEpochDay(element.dueDate) - planningEpochDay, horizonDays));
      values[day] = element.qty;
      return {
        key: `supply-${element.id}`,
        label: `${element.id} · ${element.type.replace('_', ' ').toLowerCase()}${element.isFirm ? ' · firm' : ''}`,
        values,
        editable: true,
      } satisfies TimePhasedRow;
    });
}

/**
 * The parameter health rail. Green where the maintained value still matches
 * observation, amber where it has drifted with both figures shown side by side,
 * red where it was never maintained at all.
 */
function parameterHealth(
  master: ItemPlant,
  item: PlanningSnapshot['items'][number],
  itemPlan: MrpResult['plans'] extends Map<string, infer T> ? T : never,
  snapshot: PlanningSnapshot,
): ParameterHealth[] {
  const receipts = snapshot.receiptHistory.filter(
    (receipt) => receipt.itemId === master.itemId && receipt.plantId === master.plantId,
  );
  const observedLeadTime =
    receipts.length > 0
      ? receipts.slice(0, 6).reduce((sum, receipt) => sum + receipt.actualLeadTimeDays, 0) /
        Math.min(receipts.length, 6)
      : null;

  const sigma = demandStdDev(itemPlan.underlyingDemand, reviewPeriodDays(master.leadTimeDays));
  const calculatedSafetyStock =
    master.leadTimeDays !== null
      ? zFor(master.serviceLevelTarget) * sigma * Math.sqrt(Math.max(master.leadTimeDays, 1))
      : null;

  const staleAfter = IMPACT_CONFIG.paramFreshnessDays;
  const ageDays =
    toEpochDay(snapshot.systemSnapshots[0]?.lastSyncAt.slice(0, 10) ?? master.paramsLastChangedOn) -
    toEpochDay(master.paramsLastChangedOn);

  const rows: ParameterHealth[] = [
    {
      field: 'leadTimeDays',
      label: 'Planned delivery time',
      maintained: master.leadTimeDays === null ? 'not maintained' : formatDays(master.leadTimeDays),
      observed: observedLeadTime === null ? null : `${observedLeadTime.toFixed(1)} days observed`,
      status:
        master.leadTimeDays === null
          ? 'MISSING'
          : observedLeadTime !== null &&
              Math.abs(observedLeadTime - master.leadTimeDays) / Math.max(master.leadTimeDays, 1) >
                IMPACT_CONFIG.drift.leadTimeDriftPct
            ? 'DRIFTED'
            : 'FRESH',
      note: receipts.length > 0 ? `Across the last ${Math.min(receipts.length, 6)} receipts` : null,
    },
    {
      field: 'safetyStock',
      label: 'Safety stock',
      maintained: master.safetyStock === null ? 'not maintained' : formatQty(master.safetyStock, item.baseUom),
      observed: calculatedSafetyStock === null ? null : `${formatQty(calculatedSafetyStock, item.baseUom)} calculated`,
      status:
        master.safetyStock === null
          ? 'MISSING'
          : calculatedSafetyStock !== null &&
              Math.abs(calculatedSafetyStock - master.safetyStock) / Math.max(master.safetyStock, 1) >
                IMPACT_CONFIG.drift.safetyStockMisalignPct
            ? 'DRIFTED'
            : 'FRESH',
      note: `z(${master.serviceLevelTarget.toFixed(2)}) · σ ${formatQty(sigma, item.baseUom)} · √lead time`,
    },
    field('mrpType', 'MRP type', master.mrpType),
    field('lotSizeRule', 'Lot sizing procedure', master.lotSizeRule),
    field('fixedLotSize', 'Fixed lot size', master.fixedLotSize, item.baseUom),
    field('minLotSize', 'Minimum lot size', master.minLotSize, item.baseUom),
    field('maxLotSize', 'Maximum lot size', master.maxLotSize, item.baseUom),
    field('roundingValue', 'Rounding value', master.roundingValue, item.baseUom),
    field('periodsOfSupplyDays', 'Periods of supply', master.periodsOfSupplyDays),
    field('reorderPoint', 'Reorder point', master.reorderPoint, item.baseUom),
    field('grProcessingTimeDays', 'GR processing time', master.grProcessingTimeDays),
    field('safetyTimeDays', 'Safety time', master.safetyTimeDays),
    field('scrapPct', 'Assembly scrap', master.scrapPct),
    field('serviceLevelTarget', 'Service level target', master.serviceLevelTarget),
    {
      field: 'paramsLastChangedOn',
      label: 'Last maintained',
      maintained: master.paramsLastChangedOn,
      observed: null,
      status: ageDays > staleAfter ? 'DRIFTED' : 'FRESH',
      note: ageDays > staleAfter ? `${Math.round(ageDays / 365)} years old` : null,
    },
  ];

  return rows;
}

function field(name: string, label: string, value: string | number | null, uom?: string): ParameterHealth {
  return {
    field: name,
    label,
    maintained: value === null ? 'not maintained' : typeof value === 'number' ? formatQty(value, uom) : String(value),
    observed: null,
    status: value === null ? 'MISSING' : 'FRESH',
    note: null,
  };
}

/** Standard normal inverse, mirroring the engine's own. */
function zFor(serviceLevel: number): number {
  // Kept local rather than imported so this file has no reason to reach into
  // engine internals; the engine's own copy is the one the plan uses.
  const table: Array<[number, number]> = [
    [0.9, 1.2816],
    [0.92, 1.4051],
    [0.95, 1.6449],
    [0.96, 1.7507],
    [0.97, 1.8808],
    [0.98, 2.0537],
    [0.99, 2.3263],
  ];
  let closest = table[0] as [number, number];
  for (const entry of table) {
    if (Math.abs(entry[0] - serviceLevel) < Math.abs(closest[0] - serviceLevel)) closest = entry;
  }
  return closest[1];
}

/**
 * Master data health, 0–100: completeness, freshness, and consistency with the
 * other systems. The weights are in `IMPACT_CONFIG` so the formula can be shown
 * rather than asserted.
 */
export function healthScoreFor(master: ItemPlant, snapshot: PlanningSnapshot, itemId: string, plantId: string): number {
  const weights = IMPACT_CONFIG.healthWeights;

  const required = [
    master.mrpType,
    master.procurementType,
    master.lotSizeRule,
    master.leadTimeDays,
    master.safetyStock,
  ];
  const completeness = required.filter((value) => value !== null).length / required.length;

  const sap = snapshot.systemSnapshots.find((entry) => entry.system === 'SAP');
  const ageDays =
    toEpochDay(sap?.lastSyncAt.slice(0, 10) ?? master.paramsLastChangedOn) - toEpochDay(master.paramsLastChangedOn);
  const freshness = Math.max(0, 1 - ageDays / (IMPACT_CONFIG.paramFreshnessDays * 3));

  const kinaxis = snapshot.systemSnapshots.find((entry) => entry.system === 'KINAXIS');
  const kinaxisRow = kinaxis?.itemPlantParams.find((row) => row.itemId === itemId && row.plantId === plantId);
  let consistency = 1;
  if (kinaxisRow) {
    let mismatches = 0;
    if (kinaxisRow.leadTimeDays !== master.leadTimeDays) mismatches += 1;
    if (kinaxisRow.safetyStock !== master.safetyStock) mismatches += 1;
    if (kinaxisRow.lotSizeRule !== master.lotSizeRule) mismatches += 1;
    consistency = 1 - mismatches / 3;
  }

  return Math.round(
    (completeness * weights.completeness + freshness * weights.freshness + consistency * weights.consistency) * 100,
  );
}

// ---------------------------------------------------------------------------
// Blast radius
// ---------------------------------------------------------------------------

export function blastRadius(scenarioId: string, exceptionId: string): BlastRadius | null {
  const plan = planFor(scenarioId);
  const snapshot = snapshotFor(scenarioId);
  const exception = plan.exceptions.find((entry) => entry.id === exceptionId);
  if (!exception) return null;

  const itemById = new Map(snapshot.items.map((item) => [item.id, item]));
  const customerById = new Map(snapshot.customers.map((customer) => [customer.id, customer]));
  const demandById = new Map<string, DemandElement>();
  for (const element of snapshot.demand) demandById.set(element.id, element);

  const pegged = exception.peggedDemandIds
    .map((id) => demandById.get(id))
    .filter((element): element is DemandElement => Boolean(element));

  const nodes: BlastRadiusNode[] = [];
  const edges: BlastRadiusEdge[] = [];
  const rootItem = itemById.get(exception.itemId);

  const rootId = `item:${exception.itemId}`;
  nodes.push({
    id: rootId,
    kind: 'COMPONENT',
    label: exception.itemId,
    sublabel: rootItem?.description ?? '',
    valueAtRisk: exception.impactValue,
    level: 0,
  });

  // Group the pegged demand by finished item, then list the orders behind it.
  const byFinishedItem = new Map<string, DemandElement[]>();
  for (const element of pegged) {
    const bucket = byFinishedItem.get(element.itemId);
    if (bucket) bucket.push(element);
    else byFinishedItem.set(element.itemId, [element]);
  }

  const orders: AffectedOrder[] = [];
  let totalValue = 0;
  let totalMargin = 0;
  const keyAccounts = new Set<string>();

  for (const [finishedItemId, elements] of byFinishedItem) {
    const finished = itemById.get(finishedItemId);
    const value = elements.reduce((sum, element) => sum + element.qty * element.pricePerUnit, 0);
    const margin = elements.reduce((sum, element) => sum + element.qty * element.marginPerUnit, 0);
    totalValue += value;
    totalMargin += margin;

    const finishedNodeId = `item:${finishedItemId}`;
    nodes.push({
      id: finishedNodeId,
      kind: 'FINISHED',
      label: finishedItemId,
      sublabel: finished?.description ?? '',
      valueAtRisk: value,
      level: 1,
    });
    edges.push({
      id: `${rootId}->${finishedNodeId}`,
      source: rootId,
      target: finishedNodeId,
      qty: elements.reduce((sum, element) => sum + element.qty, 0),
    });

    // Forecast is rolled up per finished item; committed orders stay individual,
    // because a named account with a promised date is a different conversation
    // from a forecast line and the panel should not blur the two.
    let forecastQty = 0;
    let forecastLineValue = 0;
    let forecastMargin = 0;
    let forecastDate = '';

    for (const element of elements) {
      const lineValue = element.qty * element.pricePerUnit;

      if (element.type !== 'SALES_ORDER' || !element.customerId) {
        forecastQty += element.qty;
        forecastLineValue += lineValue;
        forecastMargin += element.qty * element.marginPerUnit;
        if (!forecastDate || element.requiredDate < forecastDate) forecastDate = element.requiredDate;
        continue;
      }

      const customer = customerById.get(element.customerId);
      if (customer?.isKeyAccount) keyAccounts.add(customer.id);

      const orderNodeId = `order:${element.id}`;
      nodes.push({
        id: orderNodeId,
        kind: 'ORDER',
        label: customer?.name ?? element.customerId,
        sublabel: `${element.channel ?? ''} · ${element.requiredDate}`,
        valueAtRisk: lineValue,
        level: 2,
      });
      edges.push({
        id: `${finishedNodeId}->${orderNodeId}`,
        source: finishedNodeId,
        target: orderNodeId,
        qty: element.qty,
      });

      orders.push({
        id: element.id,
        kind: 'COMMITTED',
        customerName: customer?.name ?? element.customerId,
        channel: element.channel,
        itemId: finishedItemId,
        itemDescription: finished?.description ?? '',
        qty: element.qty,
        value: lineValue,
        marginValue: element.qty * element.marginPerUnit,
        requiredDate: element.requiredDate,
        isKeyAccount: customer?.isKeyAccount ?? false,
      });
    }

    if (forecastQty > 0) {
      orders.push({
        id: `forecast:${finishedItemId}`,
        kind: 'FORECAST',
        customerName: 'Forecast demand',
        channel: null,
        itemId: finishedItemId,
        itemDescription: finished?.description ?? '',
        qty: forecastQty,
        value: forecastLineValue,
        marginValue: forecastMargin,
        requiredDate: forecastDate,
        isKeyAccount: false,
      });
    }
  }

  // Committed first, then forecast; value-ranked within each.
  orders.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'COMMITTED' ? -1 : 1) : b.value - a.value));

  return {
    rootItemId: exception.itemId,
    rootPlantId: exception.plantId,
    nodes,
    edges,
    orders,
    finishedGoodsCount: byFinishedItem.size,
    totalValueAtRisk: totalValue,
    totalMarginAtRisk: totalMargin,
    committedValue: orders.filter((order) => order.kind === 'COMMITTED').reduce((sum, order) => sum + order.value, 0),
    forecastValue: orders.filter((order) => order.kind === 'FORECAST').reduce((sum, order) => sum + order.value, 0),
    committedOrderCount: orders.filter((order) => order.kind === 'COMMITTED').length,
    keyAccountCount: keyAccounts.size,
  };
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export function simulateResolution(
  scenarioId: string,
  exceptionId: string,
  resolutionId: string,
): SimulationDiff | null {
  const plan = planFor(scenarioId);
  const exception = plan.exceptions.find((entry) => entry.id === exceptionId);
  const resolution = plan.resolutions.get(resolutionId);
  if (!exception || !resolution) return null;

  const options = planningOptions(scenarioId);
  const before = snapshotFor(scenarioId);
  const result = simulate(before, plan, resolution.mutations, options);

  const key = planKey(exception.itemId, exception.plantId);
  const beforePlan = plan.plans.get(key);
  const afterPlan = result.plan.plans.get(key);
  const planningEpochDay = toEpochDay(plan.planningDate);

  const brief = (entry: PlanningException) => ({
    id: entry.id,
    code: entry.code,
    itemId: entry.itemId,
    plantId: entry.plantId,
    impactValue: entry.impactValue,
    narrative: entry.narrative,
  });

  return {
    resolutionId,
    resolutionLabel: resolution.label,
    elapsedMs: result.plan.elapsedMs,
    resolved: result.diff.resolved.slice(0, 40).map(brief),
    created: result.diff.created.slice(0, 40).map(brief),
    unchanged: result.diff.unchanged,
    kpiDelta: result.diff.kpiDelta,
    before: beforePlan ? downsample(beforePlan.projectedAvailableFeasible, 60) : [],
    after: afterPlan ? downsample(afterPlan.projectedAvailableFeasible, 60) : [],
    dates: sampleDates(planningEpochDay, plan.horizonDays, 60),
    writebacks: proposeWritebacks(resolution.mutations, plan.planningDate).map((payload) => ({
      system: payload.system,
      method: payload.method,
      endpoint: payload.endpoint,
      description: payload.description,
      body: payload.body,
    })),
  };
}

// ---------------------------------------------------------------------------

function downsample(series: Float64Array, buckets: number): number[] {
  const step = Math.max(1, Math.floor(series.length / buckets));
  const out: number[] = [];
  for (let index = 0; index < series.length; index += step) out.push(Math.round((series[index] as number) * 100) / 100);
  return out;
}

function sampleDates(planningEpochDay: number, horizonDays: number, buckets: number): string[] {
  const step = Math.max(1, Math.floor((horizonDays + 1) / buckets));
  const out: string[] = [];
  for (let day = 0; day <= horizonDays; day += step) out.push(fromEpochDay(planningEpochDay + day));
  return out;
}

function humanise(label: string): string {
  return label
    .split(' · ')
    .map((part) =>
      part
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/^\w/, (character) => character.toUpperCase()),
    )
    .join(' · ');
}
