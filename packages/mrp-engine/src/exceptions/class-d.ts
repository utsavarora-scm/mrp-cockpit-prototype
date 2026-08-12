/**
 * Class D — feasibility.
 *
 * A plan can be arithmetically correct and still impossible: below a supplier's
 * minimum, beyond a line's capacity, or ordering more shelf life than the
 * material has. These detectors are what stop the plan being merely tidy.
 */

import {
  IMPACT_CONFIG,
  formatCurrency,
  formatDateShort,
  formatDays,
  formatNumber,
  formatQty,
  planKey,
  toEpochDay,
  type ItemRouting,
  type Resource,
} from '@repo/domain';

import { primaryVendor } from '../run-mrp';
import { ExceptionContext, narrate } from './context';
import { valueException, windowShare } from './impact';

export function detectClassD(ctx: ExceptionContext): void {
  detectVendorConstraints(ctx);
  detectCapacityOverload(ctx);
  detectShelfLifeViolations(ctx);
  detectLotSizeExcess(ctx);
}

// ---------------------------------------------------------------------------

function detectVendorConstraints(ctx: ExceptionContext): void {
  const reported = new Set<string>();

  for (const order of ctx.plannedOrders) {
    const key = planKey(order.itemId, order.plantId);
    if (reported.has(key)) continue;
    const vendors = ctx.index.vendorsByKey.get(key);
    const vendor = primaryVendor(vendors);
    if (!vendor) continue;
    const item = ctx.item(order.itemId);
    if (!item) continue;

    const belowMoq = vendor.moq > 0 && order.qty < vendor.moq - 1e-6;
    const overCapacity = vendor.dailyCapacity !== null && order.qty > vendor.dailyCapacity + 1e-6;
    if (!belowMoq && !overCapacity) continue;
    reported.add(key);

    const pegged = ctx.peggedDemandFor(order.itemId, order.plantId);
    const forcedExcess = belowMoq ? vendor.moq - order.qty : 0;
    const daysNeeded = overCapacity && vendor.dailyCapacity ? Math.ceil(order.qty / vendor.dailyCapacity) : 0;

    ctx.emit({
      code: 'D1-VENDOR-CONSTRAINT',
      severity: overCapacity ? 'HIGH' : 'LOW',
      itemId: order.itemId,
      plantId: order.plantId,
      bucketDay: dayOf(ctx, order.dueDate),
      narrative: belowMoq
        ? narrate([
            `The plan calls for ${formatQty(order.qty, item.baseUom)} of ${order.itemId} at ${order.plantId}, below ${vendor.vendorId}'s minimum order quantity of ${formatQty(vendor.moq, item.baseUom)}.`,
            `Placing the order means taking ${formatQty(forcedExcess, item.baseUom)} more than the plan needs, worth ${formatCurrency(forcedExcess * item.standardCost)}.`,
          ])
        : narrate([
            `The plan calls for ${formatQty(order.qty, item.baseUom)} of ${order.itemId} on ${formatDateShort(order.dueDate)}, against ${vendor.vendorId}'s daily capacity of ${formatQty(vendor.dailyCapacity ?? 0, item.baseUom)}.`,
            `The vendor would need ${formatDays(daysNeeded)} of full output to deliver it, so the receipt date is not achievable as planned.`,
          ]),
      evidence: [
        { kind: 'CALCULATION', label: 'Planned order quantity', value: formatQty(order.qty, item.baseUom) },
        {
          kind: 'PARAMETER',
          label: belowMoq ? 'Vendor minimum order quantity' : 'Vendor daily capacity',
          value: formatQty(belowMoq ? vendor.moq : (vendor.dailyCapacity ?? 0), item.baseUom),
          ref: { type: 'VENDOR', vendorId: vendor.vendorId },
        },
        belowMoq
          ? { kind: 'CALCULATION' as const, label: 'Forced excess', value: formatQty(forcedExcess, item.baseUom) }
          : { kind: 'CALCULATION' as const, label: 'Days of vendor output required', value: formatDays(daysNeeded) },
      ],
      impact: valueException({
        probabilityOfMiss: overCapacity ? IMPACT_CONFIG.probabilityOfMiss.feasibilityDefect : 0,
        exposureRatio: overCapacity
          ? 0.5 * windowShare(14, ctx.horizonDays) * ctx.consequenceFactor(order.itemId, order.plantId)
          : 0,
        peggedDemand: pegged,
        excessQty: forcedExcess,
        obsolescenceQty: 0,
        expediteCost: 0,
        standardCost: item.standardCost,
      }),
      peggedDemand: pegged,
    });
  }
}

function detectCapacityOverload(ctx: ExceptionContext): void {
  const routingsByKey = new Map<string, ItemRouting>();
  for (const routing of ctx.snapshot.routings) routingsByKey.set(planKey(routing.itemId, routing.plantId), routing);

  const resourceById = new Map<string, Resource>();
  for (const resource of ctx.snapshot.resources) resourceById.set(resource.id, resource);

  /** resourceId → day → hours loaded. */
  const load = new Map<string, Map<number, number>>();
  const contributors = new Map<string, Set<string>>();

  for (const order of ctx.plannedOrders) {
    const routing = routingsByKey.get(planKey(order.itemId, order.plantId));
    if (!routing) continue;
    const day = dayOf(ctx, order.releaseDate);
    if (day < 0 || day > ctx.horizonDays) continue;

    const hours = order.qty * routing.hoursPerBaseUom;
    let byDay = load.get(routing.resourceId);
    if (!byDay) {
      byDay = new Map<number, number>();
      load.set(routing.resourceId, byDay);
    }
    byDay.set(day, (byDay.get(day) ?? 0) + hours);

    let items = contributors.get(`${routing.resourceId}|${day}`);
    if (!items) {
      items = new Set<string>();
      contributors.set(`${routing.resourceId}|${day}`, items);
    }
    items.add(order.itemId);
  }

  for (const [resourceId, byDay] of load) {
    const resource = resourceById.get(resourceId);
    if (!resource || resource.dailyCapacityHours <= 0) continue;

    // The worst single day is the exception; reporting all of them would swamp
    // the queue with one recurring problem.
    let worstDay = -1;
    let worstHours = 0;
    for (const [day, hours] of byDay) {
      if (hours > worstHours) {
        worstHours = hours;
        worstDay = day;
      }
    }
    if (worstDay < 0 || worstHours <= resource.dailyCapacityHours) continue;

    const overload = worstHours - resource.dailyCapacityHours;
    const items = contributors.get(`${resourceId}|${worstDay}`);

    ctx.emit({
      code: 'D2-CAPACITY-OVERLOAD',
      severity: overload / resource.dailyCapacityHours > 0.5 ? 'HIGH' : 'MEDIUM',
      itemId: '—',
      plantId: resource.plantId,
      bucketDay: worstDay,
      discriminator: resourceId,
      narrative: narrate([
        `${resource.name} at ${resource.plantId} is loaded to ${formatNumber(worstHours)} hours on day ${worstDay} (${formatDateShort(ctx.dateOf(worstDay))}) against a daily capacity of ${formatNumber(resource.dailyCapacityHours)}.`,
        `${items?.size ?? 0} planned orders release on that day, ${formatNumber(overload)} hours more than the line can run.`,
      ]),
      evidence: [
        { kind: 'CALCULATION', label: 'Planned load', value: `${formatNumber(worstHours)} h` },
        { kind: 'PARAMETER', label: 'Daily capacity', value: `${formatNumber(resource.dailyCapacityHours)} h` },
        {
          kind: 'CALCULATION',
          label: 'Overload',
          value: `${formatNumber(overload)} h`,
          detail: `${((overload / resource.dailyCapacityHours) * 100).toFixed(0)}% above capacity`,
        },
        { kind: 'RECORD', label: 'Items releasing that day', value: String(items?.size ?? 0) },
      ],
      impact: valueException({
        probabilityOfMiss: IMPACT_CONFIG.probabilityOfMiss.feasibilityDefect,
        exposureRatio: Math.min(1, overload / resource.dailyCapacityHours) * windowShare(7, ctx.horizonDays),
        peggedDemand: [],
        excessQty: 0,
        obsolescenceQty: 0,
        expediteCost: overload * 150,
        standardCost: 0,
      }),
    });
  }
}

/**
 * D3 — batch-level shelf life. A batch that expires before the date its pegged
 * demand consumes it is a write-off nobody has booked yet.
 */
function detectShelfLifeViolations(ctx: ExceptionContext): void {
  for (const stock of ctx.snapshot.stock) {
    const item = ctx.item(stock.itemId);
    if (!item || item.shelfLifeDays === null) continue;
    const plan = ctx.plans.get(planKey(stock.itemId, stock.plantId));
    if (!plan) continue;

    for (const batch of stock.batches) {
      if (!batch.expiryDate || batch.qty <= 0) continue;
      const expiryDay = toEpochDay(batch.expiryDate) - ctx.planningEpochDay;
      if (expiryDay > ctx.horizonDays) continue;

      // The day this batch's quantity would actually be consumed, FIFO.
      const consumptionDay = firstDayCumulativeDemandExceeds(plan.grossRequirements, batch.qty);
      if (consumptionDay < 0 || consumptionDay <= expiryDay) continue;

      const gap = consumptionDay - expiryDay;
      const pegged = ctx.peggedDemandFor(stock.itemId, stock.plantId);

      ctx.emit({
        code: 'D3-SHELF-LIFE-VIOLATION',
        severity: 'HIGH',
        itemId: stock.itemId,
        plantId: stock.plantId,
        bucketDay: expiryDay < 0 ? 0 : expiryDay,
        discriminator: batch.batchId,
        narrative: narrate([
          `Batch ${batch.batchId} holds ${formatQty(batch.qty, item.baseUom)} of ${stock.itemId} at ${stock.plantId} and expires ${formatDateShort(batch.expiryDate)}.`,
          `At the current consumption rate that quantity is not drawn down until day ${consumptionDay} (${formatDateShort(ctx.dateOf(consumptionDay))}), ${formatDays(gap)} after expiry.`,
          `Unless it is consumed earlier or reallocated, ${formatCurrency(batch.qty * item.standardCost)} is written off.`,
        ]),
        evidence: [
          {
            kind: 'RECORD',
            label: `Batch ${batch.batchId}`,
            value: formatQty(batch.qty, item.baseUom),
            detail: `Expires ${formatDateShort(batch.expiryDate)}`,
            ref: { type: 'ITEM_PLANT', itemId: stock.itemId, plantId: stock.plantId },
          },
          {
            kind: 'CALCULATION',
            label: 'Pegged consumption day',
            value: `day ${consumptionDay} · ${formatDateShort(ctx.dateOf(consumptionDay))}`,
          },
          { kind: 'CALCULATION', label: 'Days past expiry at consumption', value: formatDays(gap) },
          { kind: 'PARAMETER', label: 'Shelf life', value: formatDays(item.shelfLifeDays) },
        ],
        impact: valueException({
          probabilityOfMiss: 0,
          exposureRatio: 0,
          peggedDemand: pegged,
          excessQty: 0,
          obsolescenceQty: batch.qty,
          expediteCost: 0,
          standardCost: item.standardCost,
        }),
      });
    }
  }
}

/**
 * D4 — lot sizing that buys a year of stock to cover a week of demand. The
 * working-capital counterpart to a stockout, and usually invisible because no
 * service metric moves.
 */
function detectLotSizeExcess(ctx: ExceptionContext): void {
  const reported = new Set<string>();

  for (const order of ctx.plannedOrders) {
    const key = planKey(order.itemId, order.plantId);
    if (reported.has(key)) continue;
    const plan = ctx.plans.get(key);
    const item = ctx.item(order.itemId);
    const itemPlant = ctx.index.itemPlantByKey.get(key);
    if (!plan || !item || !itemPlant) continue;

    const dailyDemand = averageDailyDemand(plan.grossRequirements);
    if (dailyDemand <= 0) continue;
    const coverDays = order.qty / dailyDemand;
    if (coverDays <= IMPACT_CONFIG.lotSizeExcessCoverDays) continue;
    reported.add(key);

    const excessQty = Math.max(0, order.qty - dailyDemand * IMPACT_CONFIG.excessCoverThresholdDays);
    const carrying = excessQty * item.standardCost * IMPACT_CONFIG.holdingRate * (coverDays / 365);

    ctx.emit({
      code: 'D4-LOT-SIZE-INDUCED-EXCESS',
      severity: excessQty * item.standardCost > 250_000 ? 'HIGH' : 'MEDIUM',
      itemId: order.itemId,
      plantId: order.plantId,
      bucketDay: dayOf(ctx, order.dueDate),
      narrative: narrate([
        `The ${itemPlant.lotSizeRule ?? 'lot-for-lot'} rule on ${order.itemId} at ${order.plantId} produces an order of ${formatQty(order.qty, item.baseUom)} against demand of ${formatQty(dailyDemand, item.baseUom)} per day.`,
        `That is ${formatDays(coverDays)} of cover from a single order, ${formatQty(excessQty, item.baseUom)} beyond the ${IMPACT_CONFIG.excessCoverThresholdDays}-day threshold.`,
        `It ties up ${formatCurrency(excessQty * item.standardCost)} of working capital and about ${formatCurrency(carrying)} in carrying cost.`,
      ]),
      evidence: [
        {
          kind: 'PARAMETER',
          label: 'Lot size rule',
          value: itemPlant.lotSizeRule ?? 'unset',
          detail:
            itemPlant.lotSizeRule === 'FOQ' && itemPlant.fixedLotSize
              ? `Fixed lot size ${formatQty(itemPlant.fixedLotSize, item.baseUom)}`
              : undefined,
          ref: { type: 'ITEM_PLANT', itemId: order.itemId, plantId: order.plantId },
        },
        { kind: 'CALCULATION', label: 'Order quantity', value: formatQty(order.qty, item.baseUom) },
        { kind: 'CALCULATION', label: 'Average daily demand', value: formatQty(dailyDemand, item.baseUom) },
        { kind: 'CALCULATION', label: 'Days of cover produced', value: formatDays(coverDays) },
        { kind: 'CALCULATION', label: 'Working capital tied up', value: formatCurrency(excessQty * item.standardCost) },
      ],
      impact: valueException({
        probabilityOfMiss: 0,
        exposureRatio: 0,
        peggedDemand: [],
        excessQty,
        obsolescenceQty: item.shelfLifeDays !== null && coverDays > item.shelfLifeDays ? excessQty * 0.5 : 0,
        expediteCost: carrying,
        standardCost: item.standardCost,
      }),
    });
  }
}

// ---------------------------------------------------------------------------

function averageDailyDemand(series: Float64Array): number {
  let total = 0;
  for (let day = 0; day < series.length; day += 1) total += series[day] as number;
  return series.length > 0 ? total / series.length : 0;
}

function firstDayCumulativeDemandExceeds(series: Float64Array, qty: number): number {
  let running = 0;
  for (let day = 0; day < series.length; day += 1) {
    running += series[day] as number;
    if (running >= qty) return day;
  }
  return -1;
}

function dayOf(ctx: ExceptionContext, iso: string): number {
  return Math.max(0, Math.min(toEpochDay(iso) - ctx.planningEpochDay, ctx.horizonDays));
}
