/**
 * Class C — cross-system reconciliation.
 *
 * Three systems, three versions of the truth, and nobody owns the seam. Every
 * detector here works by diffing what SAP, Kinaxis and o9 each currently believe
 * about the same logical fact.
 *
 * This is the part of the product that none of the three systems can do for
 * itself, because each one is internally consistent and has no reason to doubt
 * the others.
 */

import {
  IMPACT_CONFIG,
  formatCurrency,
  formatDateShort,
  formatNumber,
  formatPercent,
  formatQty,
  planKey,
  type SystemSnapshot,
} from '@repo/domain';

import { ExceptionContext, narrate } from './context';
import { valueException, windowShare } from './impact';

type SystemId = 'SAP' | 'KINAXIS' | 'O9';

export function detectClassC(ctx: ExceptionContext): void {
  const bySystem = new Map<SystemId, SystemSnapshot>();
  for (const snapshot of ctx.snapshot.systemSnapshots) bySystem.set(snapshot.system, snapshot);

  detectStaleSync(ctx, bySystem);
  detectParameterDrift(ctx, bySystem);
  detectInventoryDivergence(ctx, bySystem);
  detectDemandDivergence(ctx, bySystem);
  detectPlanNotExecuted(ctx, bySystem);
}

// ---------------------------------------------------------------------------

function detectStaleSync(ctx: ExceptionContext, bySystem: Map<SystemId, SystemSnapshot>): void {
  for (const snapshot of bySystem.values()) {
    const hoursSinceSync = hoursBetween(snapshot.lastSyncAt, `${ctx.options.planningDate}T00:00:00Z`);
    if (hoursSinceSync <= snapshot.syncSlaHours) continue;

    ctx.emit({
      code: 'C5-STALE-SYNC',
      severity: hoursSinceSync > snapshot.syncSlaHours * 3 ? 'HIGH' : 'MEDIUM',
      itemId: '—',
      plantId: '—',
      bucketDay: 0,
      discriminator: snapshot.system,
      narrative: narrate([
        `The ${snapshot.system} feed last synchronised ${formatDateShort(snapshot.lastSyncAt.slice(0, 10))}, ${Math.round(hoursSinceSync)} hours ago against an SLA of ${snapshot.syncSlaHours}.`,
        `${formatNumber(snapshot.recordCount)} records are being planned against a position that is no longer current.`,
      ]),
      evidence: [
        {
          kind: 'RECORD',
          label: `${snapshot.system} last sync`,
          value: snapshot.lastSyncAt,
          detail: `SLA ${snapshot.syncSlaHours}h`,
          ref: { type: 'SYSTEM_SNAPSHOT', system: snapshot.system },
        },
        { kind: 'CALCULATION', label: 'Hours since sync', value: String(Math.round(hoursSinceSync)) },
        { kind: 'RECORD', label: 'Records in feed', value: formatNumber(snapshot.recordCount) },
      ],
      impact: valueException({
        probabilityOfMiss: 0,
        exposureRatio: 0,
        peggedDemand: [],
        excessQty: 0,
        obsolescenceQty: 0,
        expediteCost: hoursSinceSync * 50,
        standardCost: 0,
      }),
    });
  }
}

/**
 * C3 — the same item-plant carrying different planning parameters in different
 * systems. At scale this is the clearest evidence that the seam is unowned.
 */
function detectParameterDrift(ctx: ExceptionContext, bySystem: Map<SystemId, SystemSnapshot>): void {
  const sap = bySystem.get('SAP');
  const kinaxis = bySystem.get('KINAXIS');
  if (!sap || !kinaxis) return;

  const kinaxisByKey = new Map(kinaxis.itemPlantParams.map((p) => [planKey(p.itemId, p.plantId), p]));

  for (const sapParams of sap.itemPlantParams) {
    const key = planKey(sapParams.itemId, sapParams.plantId);
    const kinaxisParams = kinaxisByKey.get(key);
    if (!kinaxisParams) continue;

    const differences: string[] = [];
    if (sapParams.leadTimeDays !== kinaxisParams.leadTimeDays) {
      differences.push(
        `lead time ${describe(sapParams.leadTimeDays, 'd')} vs ${describe(kinaxisParams.leadTimeDays, 'd')}`
      );
    }
    if (!nearlyEqual(sapParams.safetyStock, kinaxisParams.safetyStock)) {
      differences.push(`safety stock ${describe(sapParams.safetyStock)} vs ${describe(kinaxisParams.safetyStock)}`);
    }
    if (sapParams.lotSizeRule !== kinaxisParams.lotSizeRule) {
      differences.push(`lot size rule ${sapParams.lotSizeRule ?? 'unset'} vs ${kinaxisParams.lotSizeRule ?? 'unset'}`);
    }
    if (differences.length === 0) continue;

    const item = ctx.item(sapParams.itemId);
    const plan = ctx.plans.get(key);
    const pegged = plan ? ctx.peggedDemandFor(sapParams.itemId, sapParams.plantId) : [];

    ctx.emit({
      code: 'C3-PARAMETER-DRIFT',
      severity: 'MEDIUM',
      itemId: sapParams.itemId,
      plantId: sapParams.plantId,
      bucketDay: -1,
      narrative: narrate([
        `SAP and Kinaxis hold different planning parameters for ${sapParams.itemId} at ${sapParams.plantId}: ${differences.join('; ')}.`,
        `Both systems plan confidently on their own copy, so the two plans diverge before anyone compares them.`,
      ]),
      evidence: [
        {
          kind: 'DIVERGENCE',
          label: 'SAP',
          value: `lead time ${describe(sapParams.leadTimeDays, 'd')}, safety stock ${describe(sapParams.safetyStock)}, rule ${sapParams.lotSizeRule ?? 'unset'}`,
          ref: { type: 'SYSTEM_SNAPSHOT', system: 'SAP' },
        },
        {
          kind: 'DIVERGENCE',
          label: 'Kinaxis',
          value: `lead time ${describe(kinaxisParams.leadTimeDays, 'd')}, safety stock ${describe(kinaxisParams.safetyStock)}, rule ${kinaxisParams.lotSizeRule ?? 'unset'}`,
          ref: { type: 'SYSTEM_SNAPSHOT', system: 'KINAXIS' },
        },
        { kind: 'CALCULATION', label: 'Fields disagreeing', value: String(differences.length) },
      ],
      impact: valueException({
        probabilityOfMiss: IMPACT_CONFIG.probabilityOfMiss.masterDataDefect,
        exposureRatio:
          Math.min(1, differences.length / 3) *
          0.3 *
          windowShare(30, ctx.horizonDays) *
          ctx.consequenceFactor(sapParams.itemId, sapParams.plantId),
        peggedDemand: pegged,
        excessQty: 0,
        obsolescenceQty: 0,
        expediteCost: 0,
        standardCost: item?.standardCost ?? 0,
      }),
      peggedDemand: pegged,
    });
  }
}

/**
 * C2 — Kinaxis on-hand disagreeing with SAP unrestricted. The usual cause is
 * blocked or quality-inspection stock that Kinaxis is not modelling, which means
 * the supply plan is built on a position that does not exist.
 */
function detectInventoryDivergence(ctx: ExceptionContext, bySystem: Map<SystemId, SystemSnapshot>): void {
  const sap = bySystem.get('SAP');
  const kinaxis = bySystem.get('KINAXIS');
  if (!sap || !kinaxis) return;

  const sapByKey = new Map(sap.onHand.map((row) => [planKey(row.itemId, row.plantId), row.qty]));

  for (const row of kinaxis.onHand) {
    const key = planKey(row.itemId, row.plantId);
    const sapQty = sapByKey.get(key);
    if (sapQty === undefined) continue;

    const delta = row.qty - sapQty;
    const base = Math.max(Math.abs(sapQty), 1);
    if (Math.abs(delta) / base <= IMPACT_CONFIG.reconciliation.inventoryDivergencePct) continue;

    const item = ctx.item(row.itemId);
    if (!item) continue;
    const stock = ctx.index.stockByKey.get(key);
    const unavailable = stock ? stock.blocked + stock.qualityInspection : 0;
    const pegged = ctx.peggedDemandFor(row.itemId, row.plantId);

    const explained = unavailable > 0 && Math.abs(Math.abs(delta) - unavailable) / Math.max(unavailable, 1) < 0.15;

    ctx.emit({
      code: 'C2-INVENTORY-DIVERGENCE',
      severity: Math.abs(delta) * item.standardCost > 100_000 ? 'HIGH' : 'MEDIUM',
      itemId: row.itemId,
      plantId: row.plantId,
      bucketDay: 0,
      narrative: narrate([
        `Kinaxis plans ${row.itemId} at ${row.plantId} against ${formatQty(row.qty, item.baseUom)} on hand; SAP reports ${formatQty(sapQty, item.baseUom)} unrestricted.`,
        explained
          ? `The ${formatQty(Math.abs(delta), item.baseUom)} difference matches the ${formatQty(unavailable, item.baseUom)} currently blocked or in quality inspection — stock Kinaxis is treating as available.`
          : `The ${formatQty(Math.abs(delta), item.baseUom)} difference is not explained by blocked or inspection stock.`,
        `At standard cost the plan is built on ${formatCurrency(Math.abs(delta) * item.standardCost)} of inventory that may not be there.`,
      ]),
      evidence: [
        {
          kind: 'DIVERGENCE',
          label: 'Kinaxis on hand',
          value: formatQty(row.qty, item.baseUom),
          ref: { type: 'SYSTEM_SNAPSHOT', system: 'KINAXIS' },
        },
        {
          kind: 'DIVERGENCE',
          label: 'SAP unrestricted',
          value: formatQty(sapQty, item.baseUom),
          ref: { type: 'SYSTEM_SNAPSHOT', system: 'SAP' },
        },
        {
          kind: 'RECORD',
          label: 'Blocked + quality inspection',
          value: formatQty(unavailable, item.baseUom),
          detail: explained ? 'Accounts for the difference' : 'Does not account for the difference',
          ref: { type: 'ITEM_PLANT', itemId: row.itemId, plantId: row.plantId },
        },
        { kind: 'CALCULATION', label: 'Value at risk', value: formatCurrency(Math.abs(delta) * item.standardCost) },
      ],
      impact: valueException({
        probabilityOfMiss: delta > 0 ? IMPACT_CONFIG.probabilityOfMiss.stockoutOutsideLeadTime : 0,
        exposureRatio:
          delta > 0
            ? Math.min(1, Math.abs(delta) / base) *
              windowShare(30, ctx.horizonDays) *
              ctx.consequenceFactor(row.itemId, row.plantId)
            : 0,
        peggedDemand: pegged,
        excessQty: delta < 0 ? Math.abs(delta) : 0,
        obsolescenceQty: 0,
        expediteCost: 0,
        standardCost: item.standardCost,
      }),
      peggedDemand: pegged,
    });
  }
}

/** C1 — o9 forecast, Kinaxis demand and SAP planned independent requirements disagreeing. */
function detectDemandDivergence(ctx: ExceptionContext, bySystem: Map<SystemId, SystemSnapshot>): void {
  const o9 = bySystem.get('O9');
  const kinaxis = bySystem.get('KINAXIS');
  const sap = bySystem.get('SAP');
  if (!o9 || !kinaxis || !sap) return;

  const index = (snapshot: SystemSnapshot) => {
    const map = new Map<string, number>();
    for (const bucket of snapshot.demandBuckets) {
      const key = `${bucket.itemId}|${bucket.plantId}|${bucket.weekStart}`;
      map.set(key, (map.get(key) ?? 0) + bucket.qty);
    }
    return map;
  };

  const kinaxisIndex = index(kinaxis);
  const sapIndex = index(sap);
  const seen = new Set<string>();

  for (const bucket of o9.demandBuckets) {
    const key = `${bucket.itemId}|${bucket.plantId}|${bucket.weekStart}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const o9Qty = bucket.qty;
    const kinaxisQty = kinaxisIndex.get(key);
    const sapQty = sapIndex.get(key);
    if (kinaxisQty === undefined || sapQty === undefined) continue;

    const values = [o9Qty, kinaxisQty, sapQty];
    const max = Math.max(...values);
    const min = Math.min(...values);
    if (max <= 0) continue;
    const spread = (max - min) / max;
    if (spread <= IMPACT_CONFIG.reconciliation.demandDivergencePct) continue;

    const item = ctx.item(bucket.itemId);
    if (!item) continue;
    const pegged = ctx.peggedDemandFor(bucket.itemId, bucket.plantId);

    ctx.emit({
      code: 'C1-DEMAND-DIVERGENCE',
      severity: spread > 0.2 ? 'HIGH' : 'MEDIUM',
      itemId: bucket.itemId,
      plantId: bucket.plantId,
      bucketDay: 0,
      discriminator: bucket.weekStart,
      narrative: narrate([
        `For the week of ${formatDateShort(bucket.weekStart)}, ${bucket.itemId} at ${bucket.plantId} is forecast at ${formatQty(o9Qty, item.baseUom)} in o9, ${formatQty(kinaxisQty, item.baseUom)} in Kinaxis and ${formatQty(sapQty, item.baseUom)} in SAP.`,
        `That is a ${formatPercent(spread, 0)} spread on a single week of a single item, and each system is planning to its own figure.`,
      ]),
      evidence: [
        {
          kind: 'DIVERGENCE',
          label: 'o9 consensus forecast',
          value: formatQty(o9Qty, item.baseUom),
          ref: { type: 'SYSTEM_SNAPSHOT', system: 'O9' },
        },
        {
          kind: 'DIVERGENCE',
          label: 'Kinaxis demand',
          value: formatQty(kinaxisQty, item.baseUom),
          ref: { type: 'SYSTEM_SNAPSHOT', system: 'KINAXIS' },
        },
        {
          kind: 'DIVERGENCE',
          label: 'SAP planned independent requirement',
          value: formatQty(sapQty, item.baseUom),
          ref: { type: 'SYSTEM_SNAPSHOT', system: 'SAP' },
        },
        {
          kind: 'CALCULATION',
          label: 'Spread',
          value: formatPercent(spread, 1),
          detail: `${formatQty(max - min, item.baseUom)} between highest and lowest`,
        },
      ],
      impact: valueException({
        probabilityOfMiss: IMPACT_CONFIG.probabilityOfMiss.masterDataDefect,
        // A single week's disagreement exposes a single week of demand.
        exposureRatio: Math.min(1, spread) * windowShare(7, ctx.horizonDays),
        peggedDemand: pegged,
        excessQty: 0,
        obsolescenceQty: 0,
        expediteCost: 0,
        standardCost: item.standardCost,
      }),
      peggedDemand: pegged,
    });
  }
}

/** C4 — a Kinaxis planned order that never became anything in SAP. */
function detectPlanNotExecuted(ctx: ExceptionContext, bySystem: Map<SystemId, SystemSnapshot>): void {
  const sap = bySystem.get('SAP');
  const kinaxis = bySystem.get('KINAXIS');
  if (!sap || !kinaxis) return;

  const sapOrders = new Set(sap.plannedOrders.map((order) => `${order.itemId}|${order.plantId}|${order.dueDate}`));
  const planningInstant = `${ctx.options.planningDate}T00:00:00Z`;

  for (const order of kinaxis.plannedOrders) {
    const signature = `${order.itemId}|${order.plantId}|${order.dueDate}`;
    if (sapOrders.has(signature)) continue;

    const ageHours = hoursBetween(order.createdAt, planningInstant);
    if (ageHours < IMPACT_CONFIG.reconciliation.planNotExecutedHours) continue;

    const item = ctx.item(order.itemId);
    if (!item) continue;
    const pegged = ctx.peggedDemandFor(order.itemId, order.plantId);

    ctx.emit({
      code: 'C4-PLAN-NOT-EXECUTED',
      severity: 'HIGH',
      itemId: order.itemId,
      plantId: order.plantId,
      bucketDay: 0,
      discriminator: order.dueDate,
      narrative: narrate([
        `Kinaxis planned ${formatQty(order.qty, item.baseUom)} of ${order.itemId} at ${order.plantId} for ${formatDateShort(order.dueDate)}, created ${Math.round(ageHours)} hours ago.`,
        `No matching planned order or purchase requisition exists in SAP, so the plan was made but never handed to execution.`,
      ]),
      evidence: [
        {
          kind: 'RECORD',
          label: 'Kinaxis planned order',
          value: `${formatQty(order.qty, item.baseUom)} due ${formatDateShort(order.dueDate)}`,
          detail: `Created ${order.createdAt}`,
          ref: { type: 'SYSTEM_SNAPSHOT', system: 'KINAXIS' },
        },
        { kind: 'RECORD', label: 'SAP counterpart', value: 'none', ref: { type: 'SYSTEM_SNAPSHOT', system: 'SAP' } },
        {
          kind: 'CALCULATION',
          label: 'Age',
          value: `${Math.round(ageHours)}h`,
          detail: `Threshold ${IMPACT_CONFIG.reconciliation.planNotExecutedHours}h`,
        },
      ],
      impact: valueException({
        probabilityOfMiss: IMPACT_CONFIG.probabilityOfMiss.stockoutOutsideLeadTime,
        exposureRatio: 0.5 * windowShare(21, ctx.horizonDays) * ctx.consequenceFactor(order.itemId, order.plantId),
        peggedDemand: pegged,
        excessQty: 0,
        obsolescenceQty: 0,
        expediteCost: order.qty * item.standardCost * 0.05,
        standardCost: item.standardCost,
      }),
      peggedDemand: pegged,
    });
  }
}

// ---------------------------------------------------------------------------

function hoursBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 3_600_000;
}

function describe(value: number | null, suffix = ''): string {
  return value === null ? 'unset' : `${formatNumber(value)}${suffix}`;
}

function nearlyEqual(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  const base = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / base < 0.01;
}
