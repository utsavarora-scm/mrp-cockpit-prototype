/**
 * Class B — master data integrity.
 *
 * B7 and B8 are the sharpest detectors in the product. They find parameters that
 * were correct at go-live and have quietly stopped being true: a lead time that
 * says 21 days when the last six receipts averaged 38, a safety stock that has
 * not been recalculated since the demand profile changed.
 *
 * Every planning system in the stack trusts these numbers blindly, which is
 * exactly why nothing in the stack reports them. The label for the concept is
 * *master data decay*, and the UI says so explicitly.
 */

import {
  IMPACT_CONFIG,
  formatDateShort,
  formatDays,
  formatPercent,
  formatQty,
  planKey,
  toEpochDay,
  zScore,
  type EvidenceFact,
  type Item,
  type ItemPlantPlan,
} from '@repo/domain';

import { demandStdDev, reviewPeriodDays } from '../observed';
import { ExceptionContext, narrate } from './context';
import { valueException, windowShare } from './impact';

export function detectClassB(ctx: ExceptionContext): void {
  detectIncompleteMaster(ctx);
  detectNoSourceOfSupply(ctx);
  detectAbsentItems(ctx);
  detectOrphanItems(ctx);
  detectBomValidityGaps(ctx);
  detectEmptyPhantoms(ctx);
  detectLeadTimeDrift(ctx);
  detectSafetyStockMisalignment(ctx);
  detectUomInconsistency(ctx);
  detectDuplicateItems(ctx);
  detectCircularBoms(ctx);
}

/** Master data defects degrade rather than break the plan, so they share a probability. */
const DEFECT_PROBABILITY = IMPACT_CONFIG.probabilityOfMiss.masterDataDefect;

/** Below this, a mis-set safety stock is a rounding artefact rather than a finding. */
const MIN_MISALIGNMENT_VALUE = 1_500;

// ---------------------------------------------------------------------------

function detectIncompleteMaster(ctx: ExceptionContext): void {
  for (const [key, plan] of ctx.plans) {
    const itemPlant = ctx.index.itemPlantByKey.get(key);
    const item = ctx.item(plan.itemId);
    if (!itemPlant || !item || !itemPlant.isPlanningRelevant) continue;
    if (!carriesDemand(plan)) continue;

    const missing: string[] = [];
    if (itemPlant.mrpType === null) missing.push('MRP type');
    if (itemPlant.lotSizeRule === null) missing.push('lot size rule');
    if (itemPlant.leadTimeDays === null) missing.push('lead time');
    if (itemPlant.safetyStock === null) missing.push('safety stock');
    if (missing.length === 0) continue;

    const pegged = ctx.peggedDemandFor(plan.itemId, plan.plantId);
    ctx.emit({
      code: 'B1-INCOMPLETE-PLANNING-MASTER',
      severity: missing.length >= 3 ? 'HIGH' : 'MEDIUM',
      itemId: plan.itemId,
      plantId: plan.plantId,
      bucketDay: -1,
      narrative: narrate([
        `${plan.itemId} carries ${formatQty(totalDemand(plan), item.baseUom)} of demand at ${plan.plantId} with ${missing.length} planning ${missing.length === 1 ? 'parameter' : 'parameters'} unmaintained: ${missing.join(', ')}.`,
        `The engine falls back to defaults, which means the plan for this item is a guess rather than a calculation.`,
      ]),
      evidence: [
        {
          kind: 'PARAMETER',
          label: 'Unmaintained parameters',
          value: missing.join(', '),
          ref: { type: 'ITEM_PLANT', itemId: plan.itemId, plantId: plan.plantId },
        },
        { kind: 'CALCULATION', label: 'Demand in horizon', value: formatQty(totalDemand(plan), item.baseUom) },
        {
          kind: 'PARAMETER',
          label: 'Parameters last maintained',
          value: formatDateShort(itemPlant.paramsLastChangedOn),
        },
      ],
      impact: valueException({
        probabilityOfMiss: DEFECT_PROBABILITY,
        exposureRatio:
          Math.min(1, missing.length / 4) *
          windowShare(45, ctx.horizonDays) *
          ctx.consequenceFactor(plan.itemId, plan.plantId),
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

function detectNoSourceOfSupply(ctx: ExceptionContext): void {
  for (const [key, plan] of ctx.plans) {
    const itemPlant = ctx.index.itemPlantByKey.get(key);
    const item = ctx.item(plan.itemId);
    if (!itemPlant || !item || !itemPlant.isPlanningRelevant) continue;
    if (!carriesDemand(plan)) continue;

    const isMake = itemPlant.procurementType === 'MAKE';
    const isBuy = itemPlant.procurementType === 'BUY';
    const boms = ctx.index.bomsByParent.get(key) ?? [];
    const vendors = ctx.index.vendorsByKey.get(key) ?? [];

    const missingBom = isMake && boms.filter((b) => !b.isAlternate).length === 0;
    const missingVendor = isBuy && vendors.length === 0;
    if (!missingBom && !missingVendor) continue;

    const pegged = ctx.peggedDemandFor(plan.itemId, plan.plantId);
    ctx.emit({
      code: 'B2-NO-SOURCE-OF-SUPPLY',
      severity: 'HIGH',
      itemId: plan.itemId,
      plantId: plan.plantId,
      bucketDay: -1,
      narrative: narrate([
        missingBom
          ? `${plan.itemId} is set to be made at ${plan.plantId} but has no active bill of material, so nothing can be planned to produce it.`
          : `${plan.itemId} is set to be bought at ${plan.plantId} but has no purchasing source, so no requisition can be raised.`,
        `Demand of ${formatQty(totalDemand(plan), item.baseUom)} in the horizon has no route to supply.`,
      ]),
      evidence: [
        { kind: 'PARAMETER', label: 'Procurement type', value: itemPlant.procurementType ?? 'unmaintained' },
        {
          kind: 'RECORD',
          label: missingBom ? 'Active BOM lines' : 'Purchasing sources',
          value: '0',
          ref: missingBom
            ? { type: 'BOM', parentItemId: plan.itemId, plantId: plan.plantId }
            : { type: 'ITEM_PLANT', itemId: plan.itemId, plantId: plan.plantId },
        },
        { kind: 'CALCULATION', label: 'Unsourceable demand', value: formatQty(totalDemand(plan), item.baseUom) },
      ],
      impact: valueException({
        probabilityOfMiss: IMPACT_CONFIG.probabilityOfMiss.stockoutOutsideLeadTime,
        exposureRatio: 0.8 * windowShare(60, ctx.horizonDays) * ctx.consequenceFactor(plan.itemId, plan.plantId),
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

/**
 * B3 — an item carries demand in o9 or Kinaxis but has no planning master in
 * SAP. New product launches and seasonal SKUs that the supply model has never
 * heard of, so nothing downstream is planned for them at all.
 */
function detectAbsentItems(ctx: ExceptionContext): void {
  const seen = new Set<string>();

  for (const snapshot of ctx.snapshot.systemSnapshots) {
    if (snapshot.system === 'SAP') continue;
    for (const bucket of snapshot.demandBuckets) {
      const key = planKey(bucket.itemId, bucket.plantId);
      if (seen.has(key)) continue;
      if (ctx.index.itemPlantByKey.has(key)) continue;
      seen.add(key);

      const item = ctx.item(bucket.itemId);
      const forecastQty = snapshot.demandBuckets
        .filter((b) => b.itemId === bucket.itemId && b.plantId === bucket.plantId)
        .reduce((sum, b) => sum + b.qty, 0);

      // The cascade: components this item would have consumed are unplanned too.
      const components = (ctx.index.bomsByParent.get(key) ?? []).filter((b) => !b.isAlternate);
      const standardCost = item?.standardCost ?? 0;

      ctx.emit({
        code: 'B3-ABSENT-ITEM',
        severity: 'CRITICAL',
        itemId: bucket.itemId,
        plantId: bucket.plantId,
        bucketDay: -1,
        narrative: narrate([
          `${bucket.itemId} carries ${formatQty(forecastQty, item?.baseUom)} of demand in ${snapshot.system} at ${bucket.plantId} but has no planning master in SAP.`,
          `Nothing plans for it: no requirement, no order, no component demand.`,
          components.length > 0
            ? `${components.length} component${components.length === 1 ? '' : 's'} that would be consumed are unplanned as a result.`
            : `No bill of material exists yet either, so the cascade cannot even be sized.`,
        ]),
        evidence: [
          {
            kind: 'DIVERGENCE',
            label: `Demand in ${snapshot.system}`,
            value: formatQty(forecastQty, item?.baseUom),
            detail: `Across ${snapshot.demandBuckets.filter((b) => b.itemId === bucket.itemId).length} weekly buckets`,
            ref: { type: 'SYSTEM_SNAPSHOT', system: snapshot.system },
          },
          { kind: 'RECORD', label: 'SAP planning master', value: 'absent' },
          { kind: 'CALCULATION', label: 'Unplanned components', value: String(components.length) },
        ],
        impact: valueException({
          probabilityOfMiss: IMPACT_CONFIG.probabilityOfMiss.stockoutInsideLeadTime,
          exposureRatio: 1,
          peggedDemand: [],
          excessQty: 0,
          obsolescenceQty: 0,
          // No pegging exists precisely because the item is absent, so the
          // exposure is the demand's own value at standard cost.
          expediteCost: forecastQty * standardCost,
          standardCost,
        }),
      });
    }
  }
}

function detectOrphanItems(ctx: ExceptionContext): void {
  for (const [key, plan] of ctx.plans) {
    const item = ctx.item(plan.itemId);
    if (!item) continue;
    if (plan.openingStock <= 0) continue;
    if (totalDemand(plan) > 0) continue;

    const stock = ctx.index.stockByKey.get(key);
    const value = plan.openingStock * item.standardCost;
    if (value < 1000) continue;

    ctx.emit({
      code: 'B4-ORPHAN-ITEM',
      severity: 'LOW',
      itemId: plan.itemId,
      plantId: plan.plantId,
      bucketDay: -1,
      narrative: narrate([
        `${formatQty(plan.openingStock, item.baseUom)} of ${plan.itemId} sits at ${plan.plantId} with no demand and no consumption anywhere in the ${ctx.horizonDays}-day horizon.`,
        `At standard cost that is idle inventory, and an obsolescence candidate once the ${IMPACT_CONFIG.drift.orphanQuietDays}-day quiet window closes.`,
      ]),
      evidence: [
        { kind: 'RECORD', label: 'Unrestricted stock', value: formatQty(plan.openingStock, item.baseUom) },
        { kind: 'CALCULATION', label: 'Demand in horizon', value: formatQty(0, item.baseUom) },
        {
          kind: 'RECORD',
          label: 'Batches held',
          value: String(stock?.batches.length ?? 0),
          ref: { type: 'ITEM_PLANT', itemId: plan.itemId, plantId: plan.plantId },
        },
      ],
      impact: valueException({
        probabilityOfMiss: 0,
        exposureRatio: 0,
        peggedDemand: [],
        excessQty: plan.openingStock,
        obsolescenceQty: 0,
        expediteCost: 0,
        standardCost: item.standardCost,
      }),
    });
  }
}

function detectBomValidityGaps(ctx: ExceptionContext): void {
  const horizonEnd = ctx.dateOf(ctx.horizonDays);
  const byParent = new Map<string, { expiring: string; hasSuccessor: boolean }>();

  for (const bom of ctx.snapshot.boms) {
    if (bom.isAlternate) continue;
    const key = planKey(bom.parentItemId, bom.plantId);
    if (bom.validTo >= horizonEnd) {
      const entry = byParent.get(key);
      if (entry) entry.hasSuccessor = true;
      else byParent.set(key, { expiring: '', hasSuccessor: true });
      continue;
    }
    if (bom.validTo < ctx.options.planningDate) continue;
    const entry = byParent.get(key);
    if (!entry) byParent.set(key, { expiring: bom.validTo, hasSuccessor: false });
    else if (!entry.expiring || bom.validTo < entry.expiring) entry.expiring = bom.validTo;
  }

  for (const [key, entry] of byParent) {
    if (!entry.expiring || entry.hasSuccessor) continue;
    const plan = ctx.plans.get(key);
    const item = plan ? ctx.item(plan.itemId) : undefined;
    if (!plan || !item || !carriesDemand(plan)) continue;

    const expiryDay = daysFrom(ctx, entry.expiring);
    const demandAfter = sumFrom(plan.grossRequirements, expiryDay);
    if (demandAfter <= 0) continue;

    const pegged = ctx.peggedDemandFor(plan.itemId, plan.plantId);
    ctx.emit({
      code: 'B5-BOM-VALIDITY-GAP',
      severity: 'HIGH',
      itemId: plan.itemId,
      plantId: plan.plantId,
      bucketDay: expiryDay,
      narrative: narrate([
        `The active bill of material for ${plan.itemId} at ${plan.plantId} expires ${formatDateShort(entry.expiring)} with no successor recorded.`,
        `${formatQty(demandAfter, item.baseUom)} of demand falls after that date and would explode into nothing.`,
      ]),
      evidence: [
        {
          kind: 'RECORD',
          label: 'BOM valid to',
          value: formatDateShort(entry.expiring),
          detail: 'No successor version found',
          ref: { type: 'BOM', parentItemId: plan.itemId, plantId: plan.plantId },
        },
        { kind: 'CALCULATION', label: 'Demand after expiry', value: formatQty(demandAfter, item.baseUom) },
        { kind: 'CALCULATION', label: 'Days until expiry', value: formatDays(expiryDay) },
      ],
      impact: valueException({
        probabilityOfMiss: IMPACT_CONFIG.probabilityOfMiss.stockoutOutsideLeadTime,
        exposureRatio:
          Math.min(1, demandAfter / Math.max(1, totalDemand(plan))) *
          0.5 *
          ctx.consequenceFactor(plan.itemId, plan.plantId),
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

function detectEmptyPhantoms(ctx: ExceptionContext): void {
  for (const [key, plan] of ctx.plans) {
    const item = ctx.item(plan.itemId);
    if (!item || !item.isPhantom) continue;
    const boms = (ctx.index.bomsByParent.get(key) ?? []).filter((b) => !b.isAlternate);
    if (boms.length > 0) continue;
    if (!carriesDemand(plan)) continue;

    const pegged = ctx.peggedDemandFor(plan.itemId, plan.plantId);
    ctx.emit({
      code: 'B6-EMPTY-PHANTOM',
      severity: 'MEDIUM',
      itemId: plan.itemId,
      plantId: plan.plantId,
      bucketDay: -1,
      narrative: narrate([
        `${plan.itemId} is flagged as a phantom at ${plan.plantId}, so it is exploded through rather than planned — but it resolves to no components.`,
        `${formatQty(totalDemand(plan), item.baseUom)} of demand passes through it and disappears.`,
      ]),
      evidence: [
        { kind: 'PARAMETER', label: 'Phantom flag', value: 'set' },
        { kind: 'RECORD', label: 'Components resolved', value: '0' },
        { kind: 'CALCULATION', label: 'Demand passing through', value: formatQty(totalDemand(plan), item.baseUom) },
      ],
      impact: valueException({
        probabilityOfMiss: DEFECT_PROBABILITY,
        exposureRatio: 0.6 * windowShare(45, ctx.horizonDays) * ctx.consequenceFactor(plan.itemId, plan.plantId),
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

/**
 * B7 — lead time drift. The hero detector.
 *
 * Nothing in SAP or Kinaxis compares the maintained planned delivery time with
 * what suppliers have actually been doing. Both plan faithfully on a number that
 * stopped being true, and the resulting shortage looks like a demand problem.
 */
function detectLeadTimeDrift(ctx: ExceptionContext): void {
  for (const [key, observed] of ctx.index.observedLeadTimes) {
    if (observed.count < IMPACT_CONFIG.drift.leadTimeMinReceipts) continue;
    const itemPlant = ctx.index.itemPlantByKey.get(key);
    const plan = ctx.plans.get(key);
    if (!itemPlant || !plan || itemPlant.leadTimeDays === null) continue;
    const item = ctx.item(itemPlant.itemId);
    if (!item) continue;

    const maintained = itemPlant.leadTimeDays;
    if (maintained <= 0) continue;
    const drift = Math.abs(observed.averageDays - maintained) / maintained;
    if (drift <= IMPACT_CONFIG.drift.leadTimeDriftPct) continue;

    const gapDays = observed.averageDays - maintained;
    const pegged = ctx.peggedDemandFor(plan.itemId, plan.plantId);
    // Demand that would be exposed by planning the gap too short.
    const exposedQty = sumWindow(plan.grossRequirements, 0, Math.max(1, Math.round(Math.abs(gapDays))));

    const evidence: EvidenceFact[] = [
      {
        kind: 'PARAMETER',
        label: 'Maintained lead time',
        value: formatDays(maintained),
        detail: `Last changed ${formatDateShort(itemPlant.paramsLastChangedOn)}`,
        ref: { type: 'ITEM_PLANT', itemId: plan.itemId, plantId: plan.plantId },
      },
      {
        kind: 'OBSERVATION',
        label: 'Observed lead time',
        value: `${observed.averageDays.toFixed(1)} days`,
        detail: `σ ${observed.stdDevDays.toFixed(1)}d across the last ${observed.count} receipts from ${observed.vendorId}`,
        ref: { type: 'RECEIPT_HISTORY', itemId: plan.itemId, plantId: plan.plantId, vendorId: observed.vendorId },
      },
      {
        kind: 'CALCULATION',
        label: 'Drift',
        value: formatPercent(drift, 0),
        detail: `${gapDays > 0 ? '+' : ''}${gapDays.toFixed(1)} days`,
      },
      ...observed.sample.slice(0, 3).map(
        (receipt): EvidenceFact => ({
          kind: 'RECORD',
          label: `Receipt ${receipt.poId}`,
          value: `${receipt.actualLeadTimeDays} days`,
          detail: `Ordered ${formatDateShort(receipt.orderedOn)}, promised ${formatDateShort(receipt.promisedOn)}, received ${formatDateShort(receipt.receivedOn)}`,
          ref: { type: 'RECEIPT_HISTORY', itemId: plan.itemId, plantId: plan.plantId, vendorId: receipt.vendorId },
        })
      ),
    ];

    ctx.emit({
      code: 'B7-LEAD-TIME-DRIFT',
      severity: gapDays > 0 && drift > 0.5 ? 'CRITICAL' : 'HIGH',
      itemId: plan.itemId,
      plantId: plan.plantId,
      bucketDay: -1,
      narrative: narrate([
        `The maintained lead time for ${plan.itemId} at ${plan.plantId} is ${formatDays(maintained)}, last changed ${formatDateShort(itemPlant.paramsLastChangedOn)}.`,
        `The last ${observed.count} receipts from ${observed.vendorId} averaged ${observed.averageDays.toFixed(1)} days with a standard deviation of ${observed.stdDevDays.toFixed(1)}.`,
        gapDays > 0
          ? `Every order for this item is therefore released ${formatDays(gapDays)} too late, and both SAP and Kinaxis plan on the maintained figure without question.`
          : `Orders are released ${formatDays(Math.abs(gapDays))} earlier than necessary, holding inventory that is not yet needed.`,
      ]),
      evidence,
      impact: valueException({
        probabilityOfMiss: gapDays > 0 ? IMPACT_CONFIG.probabilityOfMiss.stockoutInsideLeadTime : 0,
        // Every replenishment cycle is planned on the wrong number, not just
        // one, so the window is a full cycle at the lead time actually observed.
        exposureRatio:
          gapDays > 0
            ? Math.min(1, drift) *
              windowShare(observed.averageDays, ctx.horizonDays) *
              ctx.consequenceFactor(plan.itemId, plan.plantId)
            : 0,
        peggedDemand: pegged,
        excessQty: gapDays < 0 ? exposedQty : 0,
        obsolescenceQty: 0,
        expediteCost: 0,
        standardCost: item.standardCost,
      }),
      peggedDemand: pegged,
    });
  }
}

/**
 * B8 — safety stock that no longer matches the demand it is supposed to buffer.
 *   calculated SS = z(serviceLevel) · σ(demand) · √leadTime
 */
function detectSafetyStockMisalignment(ctx: ExceptionContext): void {
  for (const [key, plan] of ctx.plans) {
    const itemPlant = ctx.index.itemPlantByKey.get(key);
    const item = ctx.item(plan.itemId);
    if (!itemPlant || !item || itemPlant.safetyStock === null || itemPlant.leadTimeDays === null) continue;
    if (!carriesDemand(plan)) continue;

    const maintained = itemPlant.safetyStock;
    const sigma = demandStdDev(plan.underlyingDemand, reviewPeriodDays(itemPlant.leadTimeDays));
    const z = zScore(itemPlant.serviceLevelTarget);
    const calculated = z * sigma * Math.sqrt(Math.max(itemPlant.leadTimeDays, 1));
    if (calculated <= 0 || maintained <= 0) continue;

    const misalignment = Math.abs(calculated - maintained) / maintained;
    if (misalignment <= IMPACT_CONFIG.drift.safetyStockMisalignPct) continue;

    // Percentage alone is not enough. On a slow-moving C item the correct buffer
    // may be a handful of units, where any rounding at all reads as a large
    // percentage error worth nothing at all in cash.
    if (Math.abs(calculated - maintained) * item.standardCost < MIN_MISALIGNMENT_VALUE) continue;

    const understated = calculated > maintained;
    const gap = Math.abs(calculated - maintained);
    const pegged = ctx.peggedDemandFor(plan.itemId, plan.plantId);

    ctx.emit({
      code: 'B8-SAFETY-STOCK-MISALIGNED',
      severity: understated && item.abcClass === 'A' ? 'HIGH' : 'MEDIUM',
      itemId: plan.itemId,
      plantId: plan.plantId,
      bucketDay: -1,
      narrative: narrate([
        `Maintained safety stock for ${plan.itemId} at ${plan.plantId} is ${formatQty(maintained, item.baseUom)}, last reviewed ${formatDateShort(itemPlant.paramsLastChangedOn)}.`,
        `Recalculating from the current demand profile — ${formatPercent(itemPlant.serviceLevelTarget, 0)} service level, daily σ of ${formatQty(sigma, item.baseUom)}, ${formatDays(itemPlant.leadTimeDays)} lead time — gives ${formatQty(calculated, item.baseUom)}.`,
        understated
          ? `The buffer is ${formatPercent(misalignment, 0)} too small for the variability it now faces.`
          : `The buffer is ${formatPercent(misalignment, 0)} larger than the demand pattern justifies, tying up working capital.`,
      ]),
      evidence: [
        {
          kind: 'PARAMETER',
          label: 'Maintained safety stock',
          value: formatQty(maintained, item.baseUom),
          detail: `Last changed ${formatDateShort(itemPlant.paramsLastChangedOn)}`,
          ref: { type: 'ITEM_PLANT', itemId: plan.itemId, plantId: plan.plantId },
        },
        {
          kind: 'CALCULATION',
          label: 'Calculated safety stock',
          value: formatQty(calculated, item.baseUom),
          detail: `z(${itemPlant.serviceLevelTarget.toFixed(2)}) = ${z.toFixed(2)} · σ ${formatQty(sigma, item.baseUom)} · √${itemPlant.leadTimeDays}`,
        },
        { kind: 'CALCULATION', label: 'Misalignment', value: formatPercent(misalignment, 0) },
      ],
      impact: valueException({
        probabilityOfMiss: understated ? DEFECT_PROBABILITY : 0,
        exposureRatio: understated
          ? Math.min(1, misalignment) *
            windowShare(itemPlant.leadTimeDays, ctx.horizonDays) *
            ctx.consequenceFactor(plan.itemId, plan.plantId)
          : 0,
        peggedDemand: pegged,
        excessQty: understated ? 0 : gap,
        obsolescenceQty: 0,
        expediteCost: 0,
        standardCost: item.standardCost,
      }),
      peggedDemand: pegged,
    });
  }
}

/**
 * B9 — a BOM quantity that implies a unit conversion nobody defined. Typically a
 * gram-per-kilogram mix-up, which is a 1,000× error hiding in plain sight.
 */
function detectUomInconsistency(ctx: ExceptionContext): void {
  for (const bom of ctx.snapshot.boms) {
    if (bom.isAlternate) continue;
    const parent = ctx.item(bom.parentItemId);
    const component = ctx.item(bom.componentItemId);
    if (!parent || !component) continue;
    if (parent.baseUom === component.baseUom) continue;

    // Cross-UoM lines are normal; an implausible magnitude is not.
    const implausible = bom.qtyPer > 5000 || (bom.qtyPer > 0 && bom.qtyPer < 0.0005);
    if (!implausible) continue;

    const plan = ctx.plans.get(planKey(bom.parentItemId, bom.plantId));
    if (!plan || !carriesDemand(plan)) continue;

    ctx.emit({
      code: 'B9-UOM-INCONSISTENCY',
      severity: 'MEDIUM',
      itemId: bom.componentItemId,
      plantId: bom.plantId,
      bucketDay: -1,
      discriminator: bom.parentItemId,
      narrative: narrate([
        `The BOM line from ${bom.parentItemId} to ${bom.componentItemId} at ${bom.plantId} consumes ${bom.qtyPer} ${component.baseUom} per ${parent.baseUom}.`,
        `No conversion between ${parent.baseUom} and ${component.baseUom} explains a factor of that size, so dependent demand for this component is off by orders of magnitude.`,
      ]),
      evidence: [
        {
          kind: 'RECORD',
          label: 'BOM quantity per',
          value: `${bom.qtyPer} ${component.baseUom} / ${parent.baseUom}`,
          ref: { type: 'BOM', parentItemId: bom.parentItemId, plantId: bom.plantId },
        },
        { kind: 'PARAMETER', label: 'Parent base UoM', value: parent.baseUom },
        { kind: 'PARAMETER', label: 'Component base UoM', value: component.baseUom },
      ],
      impact: valueException({
        probabilityOfMiss: DEFECT_PROBABILITY,
        exposureRatio: 0.4 * windowShare(30, ctx.horizonDays),
        peggedDemand: ctx.peggedDemandFor(bom.parentItemId, bom.plantId),
        excessQty: 0,
        obsolescenceQty: 0,
        expediteCost: 0,
        standardCost: component.standardCost,
      }),
    });
  }
}

/**
 * B10 — two item codes for the same physical thing. Detected on trigram
 * similarity of the description, with the same plant and base UoM required.
 */
function detectDuplicateItems(ctx: ExceptionContext): void {
  const byPlant = new Map<string, Item[]>();
  for (const plan of ctx.plans.values()) {
    const item = ctx.item(plan.itemId);
    if (!item) continue;
    const bucket = byPlant.get(plan.plantId);
    if (bucket) bucket.push(item);
    else byPlant.set(plan.plantId, [item]);
  }

  for (const [plantId, items] of byPlant) {
    // Bucketed by UoM and type so this stays well away from O(n²) on the full set.
    const buckets = new Map<string, Item[]>();
    for (const item of items) {
      const bucketKey = `${item.type}|${item.baseUom}`;
      const bucket = buckets.get(bucketKey);
      if (bucket) bucket.push(item);
      else buckets.set(bucketKey, [item]);
    }

    for (const bucket of buckets.values()) {
      const grams = bucket.map((item) => trigrams(item.description));
      for (let i = 0; i < bucket.length; i += 1) {
        for (let j = i + 1; j < bucket.length; j += 1) {
          const a = bucket[i] as Item;
          const b = bucket[j] as Item;

          // Two grades of the same material read alike but are priced apart.
          // Requiring the standard cost to match as well is what separates a
          // genuine duplicate code from a legitimate variant.
          const costGap = Math.abs(a.standardCost - b.standardCost) / Math.max(a.standardCost, b.standardCost, 1e-6);
          if (costGap > 0.005) continue;

          const similarity = diceCoefficient(grams[i] as Set<string>, grams[j] as Set<string>);
          if (similarity <= IMPACT_CONFIG.drift.duplicateSimilarity) continue;

          const planA = ctx.plans.get(planKey(a.id, plantId));
          const planB = ctx.plans.get(planKey(b.id, plantId));
          const strandedQty = (planA?.openingStock ?? 0) + (planB?.openingStock ?? 0);

          ctx.emit({
            code: 'B10-DUPLICATE-ITEM',
            severity: 'LOW',
            itemId: a.id,
            plantId,
            bucketDay: -1,
            discriminator: b.id,
            narrative: narrate([
              `${a.id} and ${b.id} at ${plantId} share the same base unit and a ${formatPercent(similarity, 0)} description match: "${a.description}" against "${b.description}".`,
              `Stock and demand are split across both codes, so neither planning position is complete.`,
            ]),
            evidence: [
              { kind: 'RECORD', label: a.id, value: a.description, detail: `Created ${formatDateShort(a.createdOn)}` },
              { kind: 'RECORD', label: b.id, value: b.description, detail: `Created ${formatDateShort(b.createdOn)}` },
              {
                kind: 'CALCULATION',
                label: 'Description similarity',
                value: formatPercent(similarity, 0),
                detail: 'Trigram Dice coefficient',
              },
              { kind: 'CALCULATION', label: 'Stock split across codes', value: formatQty(strandedQty, a.baseUom) },
            ],
            impact: valueException({
              probabilityOfMiss: 0,
              exposureRatio: 0,
              peggedDemand: [],
              excessQty: Math.min(planA?.openingStock ?? 0, planB?.openingStock ?? 0),
              obsolescenceQty: 0,
              expediteCost: 0,
              standardCost: a.standardCost,
            }),
          });
        }
      }
    }
  }
}

function detectCircularBoms(ctx: ExceptionContext): void {
  for (const key of ctx.circular) {
    const plan = ctx.plans.get(key);
    if (!plan) continue;
    const item = ctx.item(plan.itemId);
    if (!item) continue;

    ctx.emit({
      code: 'B-CIRCULAR-BOM',
      severity: 'HIGH',
      itemId: plan.itemId,
      plantId: plan.plantId,
      bucketDay: -1,
      narrative: narrate([
        `${plan.itemId} at ${plan.plantId} participates in a bill of material that references itself, directly or through a chain.`,
        `Level assignment cannot terminate for these items, so they are planned last and their dependent demand may be incomplete.`,
      ]),
      evidence: [
        {
          kind: 'RECORD',
          label: 'BOM cycle members',
          value: String(ctx.circular.length),
          ref: { type: 'BOM', parentItemId: plan.itemId, plantId: plan.plantId },
        },
      ],
      impact: valueException({
        probabilityOfMiss: DEFECT_PROBABILITY,
        exposureRatio: 0.3 * windowShare(30, ctx.horizonDays),
        peggedDemand: [],
        excessQty: 0,
        obsolescenceQty: 0,
        expediteCost: 0,
        standardCost: item.standardCost,
      }),
    });
  }
}

// ---------------------------------------------------------------------------

function carriesDemand(plan: ItemPlantPlan): boolean {
  for (let day = 0; day < plan.grossRequirements.length; day += 1) {
    if ((plan.grossRequirements[day] as number) > 0) return true;
  }
  return false;
}

function totalDemand(plan: ItemPlantPlan): number {
  let total = 0;
  for (let day = 0; day < plan.grossRequirements.length; day += 1) total += plan.grossRequirements[day] as number;
  return total;
}

function sumFrom(series: Float64Array, fromDay: number): number {
  let total = 0;
  for (let day = Math.max(0, fromDay); day < series.length; day += 1) total += series[day] as number;
  return total;
}

function sumWindow(series: Float64Array, from: number, to: number): number {
  let total = 0;
  const end = Math.min(to, series.length - 1);
  for (let day = Math.max(0, from); day <= end; day += 1) total += series[day] as number;
  return total;
}

function daysFrom(ctx: ExceptionContext, iso: string): number {
  return Math.max(0, Math.min(toEpochDay(iso) - ctx.planningEpochDay, ctx.horizonDays));
}

/** Character trigrams of a normalised description. */
function trigrams(text: string): Set<string> {
  const normalised = ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
  const set = new Set<string>();
  for (let i = 0; i + 3 <= normalised.length; i += 1) set.add(normalised.slice(i, i + 3));
  return set;
}

function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}
