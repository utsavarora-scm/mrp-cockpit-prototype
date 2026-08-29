/**
 * `runMrp` — the entry point.
 *
 * Pure: no clock, no I/O, no framework. The planning date is injected, all
 * randomness lives upstream in the data pack, and the same snapshot always
 * produces the same plan. That is what makes the engine testable in front of
 * someone who wants to check the arithmetic.
 */

import {
  IMPACT_CONFIG,
  type BomLine,
  type DemandElement,
  type Item,
  type ItemPlant,
  type ItemPlantPlan,
  type ItemVendor,
  type MrpOptions,
  type MrpResult,
  type PlannedOrderExplanation,
  type PlanningException,
  type PlanningSnapshot,
  type Resolution,
  type StockPosition,
  type SupplyElement,
  planKey,
  toEpochDay,
  fromEpochDay,
} from '@repo/domain';

import { buildCalendars, FALLBACK_CALENDAR, WorkingCalendar } from './calendar';
import { consumeForecast } from './forecast-consumption';
import { assignLowLevelCodes } from './low-level-codes';
import {
  computeDaysOfCover,
  isPlanningActive,
  netItemPlant,
  type PlannedOrderDraft,
  type SupersededRequirement,
} from './netting';
import { buildPeggingGraph } from './pegging';
import { generateExceptions } from './exceptions/generate';
import { computeKpis } from './kpis';
import { buildResolutions } from './resolutions';
import { summariseObservedLeadTimes, type ObservedLeadTime } from './observed';

/** Everything the exception pass needs that is not already on MrpResult. */
export interface EngineIndex {
  itemById: Map<string, Item>;
  itemPlantByKey: Map<string, ItemPlant>;
  stockByKey: Map<string, StockPosition>;
  bomsByParent: Map<string, BomLine[]>;
  bomsByComponent: Map<string, BomLine[]>;
  vendorsByKey: Map<string, ItemVendor[]>;
  observedLeadTimes: Map<string, ObservedLeadTime>;
  demandById: Map<string, DemandElement>;
  supplyById: Map<string, SupplyElement>;
  demandByKey: Map<string, DemandElement[]>;
  supplyByKey: Map<string, SupplyElement[]>;
  calendars: Map<string, WorkingCalendar>;
  calendarForPlant: Map<string, WorkingCalendar>;
  ordersByKey: Map<string, PlannedOrderDraft[]>;
  supersededByKey: Map<string, SupersededRequirement[]>;
  planningEpochDay: number;
}

export function runMrp(snapshot: PlanningSnapshot, options: MrpOptions): MrpResult {
  const startedAt = performanceNow();
  const { planningDate, horizonDays } = options;
  const planningEpochDay = toEpochDay(planningDate);
  const buckets = horizonDays + 1;

  // ---- Indexes -----------------------------------------------------------
  const itemById = new Map(snapshot.items.map((item) => [item.id, item]));
  const itemPlantByKey = new Map(snapshot.itemPlants.map((ip) => [planKey(ip.itemId, ip.plantId), ip]));
  const stockByKey = new Map(snapshot.stock.map((s) => [planKey(s.itemId, s.plantId), s]));

  const bomsByParent = groupBy(snapshot.boms, (b) => planKey(b.parentItemId, b.plantId));
  const bomsByComponent = groupBy(snapshot.boms, (b) => planKey(b.componentItemId, b.plantId));
  const vendorsByKey = groupBy(snapshot.itemVendors, (v) => planKey(v.itemId, v.plantId));

  const calendars = buildCalendars(snapshot.calendars, planningDate, horizonDays);
  const fallbackCalendar = new WorkingCalendar(FALLBACK_CALENDAR, planningDate, horizonDays);
  const calendarForPlant = new Map<string, WorkingCalendar>();
  for (const plant of snapshot.plants) {
    calendarForPlant.set(plant.id, calendars.get(plant.calendarId) ?? fallbackCalendar);
  }

  const observedLeadTimes = summariseObservedLeadTimes(snapshot.receiptHistory);

  // A BOM line shapes the plan if it is valid anywhere inside the horizon.
  const horizonEndIso = fromEpochDay(planningEpochDay + horizonDays);
  const isBomActive = (bom: BomLine): boolean =>
    !bom.isAlternate && bom.validFrom <= horizonEndIso && bom.validTo >= planningDate;

  const { codes, order, circular } = assignLowLevelCodes(snapshot.itemPlants, snapshot.boms, isBomActive);

  // ---- Buffers -----------------------------------------------------------
  const plans = new Map<string, ItemPlantPlan>();
  for (const ip of snapshot.itemPlants) {
    const key = planKey(ip.itemId, ip.plantId);
    const stock = stockByKey.get(key);
    plans.set(key, {
      itemId: ip.itemId,
      plantId: ip.plantId,
      lowLevelCode: codes.get(key) ?? 0,
      openingStock: stock ? stock.unrestricted : 0,
      safetyStock: ip.safetyStock ?? 0,
      grossRequirements: new Float64Array(buckets),
      underlyingDemand: new Float64Array(buckets),
      scheduledReceipts: new Float64Array(buckets),
      plannedReceipts: new Float64Array(buckets),
      projectedAvailable: new Float64Array(buckets),
      projectedAvailableFeasible: new Float64Array(buckets),
      daysOfCover: new Float64Array(buckets),
    });
  }

  // ---- Seed scheduled receipts ------------------------------------------
  const supplyById = new Map<string, SupplyElement>();
  const supplyByKey = new Map<string, SupplyElement[]>();
  for (const element of snapshot.supply) {
    supplyById.set(element.id, element);
    pushInto(supplyByKey, planKey(element.itemId, element.plantId), element);
    const plan = plans.get(planKey(element.itemId, element.plantId));
    if (!plan) continue;
    // Past-due supply is pulled into the first bucket: it is still expected,
    // and pretending it arrives on its original date would overstate coverage.
    const day = clampDay(toEpochDay(element.dueDate) - planningEpochDay, 0, horizonDays);
    if (day === null) continue;
    plan.scheduledReceipts[day] = (plan.scheduledReceipts[day] as number) + element.qty;
  }

  // ---- Seed gross requirements ------------------------------------------
  const demandByKey = new Map<string, DemandElement[]>();
  for (const element of snapshot.demand) {
    if (element.type === 'SAFETY_STOCK') continue;
    pushInto(demandByKey, planKey(element.itemId, element.plantId), element);
  }

  const salesScratch = new Float64Array(buckets);
  const forecastScratch = new Float64Array(buckets);
  const coverScratch = new Float64Array(buckets);
  const forecastConsumed = new Map<string, number>();

  for (const [key, elements] of demandByKey) {
    const plan = plans.get(key);
    if (!plan) continue;
    salesScratch.fill(0);
    forecastScratch.fill(0);

    for (const element of elements) {
      const day = clampDay(toEpochDay(element.requiredDate) - planningEpochDay, 0, horizonDays);
      if (day === null) continue;
      if (element.type === 'SALES_ORDER') salesScratch[day] = (salesScratch[day] as number) + element.qty;
      else if (element.type === 'FORECAST') forecastScratch[day] = (forecastScratch[day] as number) + element.qty;
      else plan.grossRequirements[day] = (plan.grossRequirements[day] as number) + element.qty;
    }

    const consumed = consumeForecast(forecastScratch, salesScratch, options.forecastConsumption);
    if (consumed > 0) forecastConsumed.set(key, consumed);

    for (let day = 0; day < buckets; day += 1) {
      plan.grossRequirements[day] =
        (plan.grossRequirements[day] as number) + (salesScratch[day] as number) + (forecastScratch[day] as number);
    }
  }

  // ---- Underlying demand -------------------------------------------------
  // Independent demand exploded straight down the BOM, before any lead-time
  // offsetting or lot sizing. See ItemPlantPlan.underlyingDemand.
  buildUnderlyingDemand(plans, bomsByParent, itemPlantByKey, order, buckets);

  // ---- Explode already-released production orders ------------------------
  // Components consumed by work already on the shop floor are real demand; the
  // plan is wrong without them.
  const derivedDemand: DemandElement[] = [];
  for (const element of snapshot.supply) {
    if (element.type !== 'PRODUCTION_ORDER' || !element.isFirm) continue;
    explodeBom({
      parentItemId: element.itemId,
      plantId: element.plantId,
      qty: element.qty,
      atEpochDay: toEpochDay(element.releaseDate),
      parentSupplyElementId: element.id,
      bomsByParent,
      itemById,
      plans,
      derivedDemand,
      planningEpochDay,
      horizonDays,
    });
  }

  // ---- Level-by-level netting -------------------------------------------
  const allOrders: PlannedOrderDraft[] = [];
  const ordersByKey = new Map<string, PlannedOrderDraft[]>();
  const supersededByKey = new Map<string, SupersededRequirement[]>();
  const plannedOrders: SupplyElement[] = [];
  const orderExplanations = new Map<string, PlannedOrderExplanation[]>();

  for (const key of order) {
    const plan = plans.get(key);
    const itemPlant = itemPlantByKey.get(key);
    if (!plan || !itemPlant) continue;
    const item = itemById.get(itemPlant.itemId);
    if (!item) continue;

    // Phantoms are exploded through: no orders, no offset, demand passes
    // straight to the components in the same bucket.
    if (item.isPhantom) {
      for (let day = 0; day < buckets; day += 1) {
        const qty = plan.grossRequirements[day] as number;
        if (qty <= 0) continue;
        explodeBom({
          parentItemId: itemPlant.itemId,
          plantId: itemPlant.plantId,
          qty,
          atEpochDay: planningEpochDay + day,
          parentSupplyElementId: `PHANTOM-${key}-${day}`,
          bomsByParent,
          itemById,
          plans,
          derivedDemand,
          planningEpochDay,
          horizonDays,
        });
      }
      continue;
    }

    const calendar = calendarForPlant.get(itemPlant.plantId) ?? fallbackCalendar;
    const vendor = primaryVendor(vendorsByKey.get(key));
    const observed = observedLeadTimes.get(key);
    const effectiveLeadTimeDays = resolveLeadTime(itemPlant, vendor, observed, options.useActualLeadTimes);

    const result = netItemPlant({
      item,
      itemPlant,
      calendar,
      planningEpochDay,
      horizonDays,
      openingStock: plan.openingStock,
      grossRequirements: plan.grossRequirements,
      scheduledReceipts: plan.scheduledReceipts,
      plannedReceipts: plan.plannedReceipts,
      projectedAvailable: plan.projectedAvailable,
      projectedAvailableFeasible: plan.projectedAvailableFeasible,
      effectiveLeadTimeDays,
      moq: vendor?.moq ?? 0,
      incrementQty: vendor?.incrementQty ?? 0,
      vendorId: vendor?.vendorId ?? null,
      sourcePlantId: itemPlant.sourcePlantId,
    });

    if (result.orders.length > 0) ordersByKey.set(key, result.orders);
    if (result.superseded.length > 0) supersededByKey.set(key, result.superseded);

    // Keep the working, not just the answer. `threshold − netRequirement` is
    // the balance netting was topping up from, which is the figure a planner
    // asking "why this quantity?" actually wants to see.
    if (result.orders.length > 0) {
      orderExplanations.set(
        key,
        result.orders.map((draft) => ({
          itemId: draft.itemId,
          plantId: draft.plantId,
          qty: draft.qty,
          ruleQty: draft.ruleQty,
          netRequirement: draft.netRequirement,
          threshold: result.threshold,
          balanceBefore: result.threshold - draft.netRequirement,
          requirementDay: draft.receiptDay,
          receiptDate: fromEpochDay(draft.receiptEpochDay),
          releaseDate: fromEpochDay(draft.releaseEpochDay),
          isReleaseInPast: draft.isReleaseInPast,
          effectiveLeadTimeDays: draft.effectiveLeadTimeDays,
          totalOffsetDays: draft.totalOffsetDays,
        }))
      );
    }

    for (let index = 0; index < result.orders.length; index += 1) {
      const draft = result.orders[index] as PlannedOrderDraft;
      const orderId = `PLO-${itemPlant.itemId}-${itemPlant.plantId}-${draft.receiptDay}-${index}`;
      allOrders.push(draft);

      plannedOrders.push({
        id: orderId,
        type:
          itemPlant.procurementType === 'MAKE'
            ? 'PRODUCTION_ORDER'
            : itemPlant.procurementType === 'TRANSFER'
              ? 'STO'
              : 'PLANNED_ORDER',
        itemId: itemPlant.itemId,
        plantId: itemPlant.plantId,
        qty: draft.qty,
        dueDate: fromEpochDay(draft.receiptEpochDay),
        releaseDate: fromEpochDay(draft.clampedReleaseEpochDay),
        vendorId: draft.vendorId,
        sourcePlantId: draft.sourcePlantId,
        isFirm: false,
        sourceSystem: 'ENGINE',
      });

      if (itemPlant.procurementType === 'TRANSFER' && itemPlant.sourcePlantId) {
        // A transfer is demand at the sending plant on the day it must ship.
        addStoDemand({
          itemId: itemPlant.itemId,
          sourcePlantId: itemPlant.sourcePlantId,
          qty: draft.qty,
          atEpochDay: draft.clampedReleaseEpochDay,
          parentSupplyElementId: orderId,
          plans,
          derivedDemand,
          planningEpochDay,
          horizonDays,
        });
      } else {
        explodeBom({
          parentItemId: itemPlant.itemId,
          plantId: itemPlant.plantId,
          qty: draft.qty,
          atEpochDay: draft.clampedReleaseEpochDay,
          parentSupplyElementId: orderId,
          bomsByParent,
          itemById,
          plans,
          derivedDemand,
          planningEpochDay,
          horizonDays,
        });
      }
    }

    computeDaysOfCover(plan.projectedAvailable, plan.grossRequirements, plan.daysOfCover, coverScratch);
  }

  // ---- Pegging -----------------------------------------------------------
  const allDemand = [...snapshot.demand, ...derivedDemand];
  const demandById = new Map(allDemand.map((d) => [d.id, d]));
  const allSupply = [...snapshot.supply, ...plannedOrders];
  for (const element of plannedOrders) supplyById.set(element.id, element);

  const openingStockByKey = new Map<string, number>();
  for (const [key, plan] of plans) openingStockByKey.set(key, plan.openingStock);

  const pegging = buildPeggingGraph({
    demand: allDemand,
    supply: allSupply,
    openingStock: openingStockByKey,
    planningDate,
  });

  // ---- Exceptions, resolutions, KPIs ------------------------------------
  const index: EngineIndex = {
    itemById,
    itemPlantByKey,
    stockByKey,
    bomsByParent,
    bomsByComponent,
    vendorsByKey,
    observedLeadTimes,
    demandById,
    supplyById,
    demandByKey,
    supplyByKey,
    calendars,
    calendarForPlant,
    ordersByKey,
    supersededByKey,
    planningEpochDay,
  };

  const exceptions = generateExceptions({
    snapshot,
    options,
    plans,
    index,
    pegging,
    plannedOrders,
    derivedDemand,
    circular,
    forecastConsumed,
  });

  const resolutions = buildResolutions({ snapshot, options, plans, index, exceptions, pegging });

  const byException = new Map<string, Resolution[]>();
  for (const resolution of resolutions.values()) {
    const bucket = byException.get(resolution.exceptionId);
    if (bucket) bucket.push(resolution);
    else byException.set(resolution.exceptionId, [resolution]);
  }
  for (const exception of exceptions) {
    const own = byException.get(exception.id) ?? [];
    exception.resolutionIds = own.map((r) => r.id);
    exception.autoResolvable = isAutoResolvable(exception, own, itemById.get(exception.itemId));
  }

  const kpis = computeKpis({ snapshot, options, plans, exceptions, index });

  return {
    scenarioId: options.scenarioId,
    planningDate,
    horizonDays,
    elapsedMs: performanceNow() - startedAt,
    plans,
    plannedOrders,
    orderExplanations,
    derivedDemand,
    exceptions,
    resolutions,
    pegging,
    kpis,
    circularItemPlants: circular,
  };
}

// ---------------------------------------------------------------------------

/**
 * Propagates independent demand down the bill of material in low-level-code
 * order, so each component sees the requirement rate its parents imply rather
 * than the batched releases the plan will eventually raise.
 *
 * Transfers propagate too: stock pulled to a distribution centre is demand at
 * the plant that ships it.
 */
function buildUnderlyingDemand(
  plans: Map<string, ItemPlantPlan>,
  bomsByParent: Map<string, BomLine[]>,
  itemPlantByKey: Map<string, ItemPlant>,
  order: string[],
  buckets: number
): void {
  for (const plan of plans.values()) plan.underlyingDemand.set(plan.grossRequirements);

  for (const key of order) {
    const plan = plans.get(key);
    if (!plan) continue;
    const source = plan.underlyingDemand;

    const itemPlant = itemPlantByKey.get(key);
    if (itemPlant?.procurementType === 'TRANSFER' && itemPlant.sourcePlantId) {
      const target = plans.get(planKey(itemPlant.itemId, itemPlant.sourcePlantId));
      if (target) {
        for (let day = 0; day < buckets; day += 1) {
          target.underlyingDemand[day] = (target.underlyingDemand[day] as number) + (source[day] as number);
        }
      }
      continue;
    }

    const lines = bomsByParent.get(key);
    if (!lines) continue;
    for (const line of lines) {
      if (line.isAlternate) continue;
      const target = plans.get(planKey(line.componentItemId, plan.plantId));
      if (!target) continue;
      const factor =
        line.qtyPer / (line.componentScrapPct > 0 && line.componentScrapPct < 1 ? 1 - line.componentScrapPct : 1);
      for (let day = 0; day < buckets; day += 1) {
        target.underlyingDemand[day] = (target.underlyingDemand[day] as number) + (source[day] as number) * factor;
      }
    }
  }
}

interface ExplodeInput {
  parentItemId: string;
  plantId: string;
  qty: number;
  atEpochDay: number;
  parentSupplyElementId: string;
  bomsByParent: Map<string, BomLine[]>;
  itemById: Map<string, Item>;
  plans: Map<string, ItemPlantPlan>;
  derivedDemand: DemandElement[];
  planningEpochDay: number;
  horizonDays: number;
}

/**
 * One level of BOM explosion. Dependent demand lands on the parent's release
 * date — the day production actually starts consuming it — and carries
 * `parentSupplyElementId`, which is the pegging edge the blast radius follows.
 */
function explodeBom(input: ExplodeInput): void {
  const lines = input.bomsByParent.get(planKey(input.parentItemId, input.plantId));
  if (!lines || lines.length === 0) return;

  const atIso = fromEpochDay(input.atEpochDay);
  const day = clampDay(input.atEpochDay - input.planningEpochDay, 0, input.horizonDays);
  if (day === null) return;

  for (const line of lines) {
    if (line.isAlternate) continue;
    if (line.validFrom > atIso || line.validTo < atIso) continue;

    const yieldFactor = line.componentScrapPct > 0 && line.componentScrapPct < 1 ? 1 - line.componentScrapPct : 1;
    const componentQty = (input.qty * line.qtyPer) / yieldFactor;
    if (componentQty <= 0) continue;

    const componentKey = planKey(line.componentItemId, input.plantId);
    const componentPlan = input.plans.get(componentKey);
    if (!componentPlan) continue;

    componentPlan.grossRequirements[day] = (componentPlan.grossRequirements[day] as number) + componentQty;

    input.derivedDemand.push({
      id: `DEP-${input.parentSupplyElementId}-${line.componentItemId}`,
      type: 'DEPENDENT',
      itemId: line.componentItemId,
      plantId: input.plantId,
      qty: componentQty,
      requiredDate: fromEpochDay(input.planningEpochDay + day),
      customerId: null,
      channel: null,
      marginPerUnit: 0,
      pricePerUnit: 0,
      priority: 5,
      parentSupplyElementId: input.parentSupplyElementId,
      sourceSystem: 'ENGINE',
    });
  }
}

interface StoDemandInput {
  itemId: string;
  sourcePlantId: string;
  qty: number;
  atEpochDay: number;
  parentSupplyElementId: string;
  plans: Map<string, ItemPlantPlan>;
  derivedDemand: DemandElement[];
  planningEpochDay: number;
  horizonDays: number;
}

function addStoDemand(input: StoDemandInput): void {
  const key = planKey(input.itemId, input.sourcePlantId);
  const plan = input.plans.get(key);
  if (!plan) return;
  const day = clampDay(input.atEpochDay - input.planningEpochDay, 0, input.horizonDays);
  if (day === null) return;

  plan.grossRequirements[day] = (plan.grossRequirements[day] as number) + input.qty;
  input.derivedDemand.push({
    id: `STO-${input.parentSupplyElementId}`,
    type: 'DEPENDENT',
    itemId: input.itemId,
    plantId: input.sourcePlantId,
    qty: input.qty,
    requiredDate: fromEpochDay(input.planningEpochDay + day),
    customerId: null,
    channel: null,
    marginPerUnit: 0,
    pricePerUnit: 0,
    priority: 5,
    parentSupplyElementId: input.parentSupplyElementId,
    sourceSystem: 'ENGINE',
  });
}

/**
 * Whether the autonomous agent may close this unattended.
 *
 * Every condition in the policy must hold. The list is deliberately narrow —
 * the point of the agent is to clear noise so planners see signal, not to make
 * consequential decisions on its own.
 */
export function isAutoResolvable(
  exception: PlanningException,
  resolutions: Resolution[],
  item: Item | undefined
): boolean {
  const policy = IMPACT_CONFIG.agentPolicy;
  if (exception.impactValue >= policy.maxImpactValue) return false;
  if (!item || !(policy.allowedAbcClasses as readonly string[]).includes(item.abcClass)) return false;
  if (!(policy.allowedExceptionCodes as readonly string[]).includes(exception.code)) return false;

  return resolutions.some(
    (resolution) =>
      resolution.confidence > policy.minConfidence &&
      (policy.allowedResolutionTypes as readonly string[]).includes(resolution.type)
  );
}

export function primaryVendor(vendors: ItemVendor[] | undefined): ItemVendor | null {
  if (!vendors || vendors.length === 0) return null;
  const primary = vendors.find((v) => v.isPrimary);
  return primary ?? (vendors[0] as ItemVendor);
}

/**
 * Which lead time the plan actually uses.
 *
 * `useActualLeadTimes` is the switch behind the whole master-data-decay story:
 * flip it and the plan is rebuilt on what suppliers have really been doing
 * rather than on the number someone maintained years ago.
 */
export function resolveLeadTime(
  itemPlant: ItemPlant,
  vendor: ItemVendor | null,
  observed: ObservedLeadTime | undefined,
  useActual: boolean
): number {
  if (useActual && observed && observed.count > 0) return observed.averageDays;
  if (itemPlant.leadTimeDays !== null) return itemPlant.leadTimeDays;
  if (vendor) return vendor.leadTimeDays;
  return 0;
}

function clampDay(day: number, min: number, max: number): number | null {
  if (day > max) return null;
  return day < min ? min : day;
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}

function pushInto<T>(map: Map<string, T[]>, key: string, value: T): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

/**
 * Elapsed-time source. `performance.now()` is a monotonic duration counter, not
 * a wall clock, so it cannot leak into plan output and break determinism — the
 * engine's purity constraint is about `Date.now()` reaching the plan, which it
 * never does here.
 */
function performanceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

export { isPlanningActive };
