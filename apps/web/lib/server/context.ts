/**
 * The planning context — one assembled view of a run, shared by every screen.
 *
 * Each projection needs the same handful of derived facts: which vendor
 * supplies a material, where its lead-time fence sits, which of its open lines
 * anybody has actually acknowledged, what its receipts measured, and which
 * other material codes carry the same chemistry. Deriving those independently
 * in six places is how two screens come to disagree about which week is safe.
 *
 * Built once per run and cached against it, so a re-plan invalidates it and
 * nothing else has to remember to.
 */

import { getDataPack, HERO_RM, type PlanChange } from '@repo/data-packs';
import {
  planKey,
  toEpochDay,
  tierOfLine,
  type DeliveryLine,
  type ItemPlant,
  type ItemPlantPlan,
  type ItemVendor,
  type MrpResult,
  type PlanningSnapshot,
  type SupplyElement,
} from '@repo/domain';
import {
  buildBuckets,
  buildCalendars,
  computeFences,
  FALLBACK_CALENDAR,
  leadTimeChain,
  WorkingCalendar,
  type Bucket,
  type CategorySibling,
  type FenceSet,
  type HorizontalSibling,
  type LeadTimeChain,
  type MaterialContext,
  type OpenLineContext,
} from '@repo/planning-engine';

import { changesSinceLastRun, planFor, snapshotFor } from './planning-session';

/** Receipts below this count are not enough to measure a lead time from. */
const MIN_RECEIPTS_TO_MEASURE = 4;

export interface MeasuredLeadTime {
  meanDays: number;
  stdDevDays: number;
  observations: number[];
  matchedCount: number;
  unmatchedCount: number;
}

export interface RunContext {
  scenarioId: string;
  planningDate: string;
  planningEpochDay: number;
  horizonDays: number;
  elapsedMs: number;
  snapshot: PlanningSnapshot;
  plan: MrpResult;
  buckets: Bucket[];
  /** Every planned item-plant, keyed. */
  materials: Map<string, MaterialFacts>;
  changes: PlanChange[];
  calendarForPlant: Map<string, WorkingCalendar>;
  /** The pilot plant every worked example lives at. */
  pilotPlantId: string;
}

/** Everything one material at one plant needs, assembled once. */
export interface MaterialFacts {
  itemId: string;
  plantId: string;
  description: string;
  itemType: string;
  baseUom: string;
  abcClass: string;
  itemCategoryId: string | null;
  standardCost: number;
  shelfLifeDays: number | null;
  plannerCode: string | null;
  itemPlant: ItemPlant;
  vendor: ItemVendor | null;
  vendorName: string | null;
  vendors: ItemVendor[];
  plan: ItemPlantPlan;
  chain: LeadTimeChain;
  fences: FenceSet;
  measured: MeasuredLeadTime | null;
  dailyDemandMean: number;
  openLines: OpenLineContext[];
  orders: SupplyElement[];
  categorySiblings: CategorySibling[];
  horizontalSiblings: HorizontalSibling[];
  /** First day the honest balance falls below safety stock, or −1. */
  firstBreachDay: number;
  /** First day the honest balance falls below zero, or −1. */
  firstStockoutDay: number;
  /** Days of cover today, at planned consumption. */
  daysOfCoverToday: number;
}

const CACHE = new WeakMap<MrpResult, RunContext>();

export function runContext(scenarioId = 'baseline'): RunContext {
  const plan = planFor(scenarioId);
  const cached = CACHE.get(plan);
  if (cached) return cached;

  const snapshot = snapshotFor();
  const context = build(scenarioId, snapshot, plan);
  CACHE.set(plan, context);
  return context;
}

/** The same assembly over an arbitrary plan — used for the previous run. */
export function contextFor(scenarioId: string, snapshot: PlanningSnapshot, plan: MrpResult): RunContext {
  const cached = CACHE.get(plan);
  if (cached) return cached;
  const context = build(scenarioId, snapshot, plan);
  CACHE.set(plan, context);
  return context;
}

function build(scenarioId: string, snapshot: PlanningSnapshot, plan: MrpResult): RunContext {
  const planningEpochDay = toEpochDay(plan.planningDate);
  const horizonDays = plan.horizonDays;

  const itemById = new Map(snapshot.items.map((item) => [item.id, item]));
  const vendorNameById = new Map(snapshot.vendors.map((vendor) => [vendor.id, vendor.name]));

  const calendars = buildCalendars(snapshot.calendars, plan.planningDate, horizonDays);
  const fallback = new WorkingCalendar(FALLBACK_CALENDAR, plan.planningDate, horizonDays);
  const calendarForPlant = new Map<string, WorkingCalendar>();
  for (const plant of snapshot.plants) calendarForPlant.set(plant.id, calendars.get(plant.calendarId) ?? fallback);

  const vendorsByKey = new Map<string, ItemVendor[]>();
  for (const row of snapshot.itemVendors) {
    const key = planKey(row.itemId, row.plantId);
    const list = vendorsByKey.get(key) ?? [];
    list.push(row);
    vendorsByKey.set(key, list);
  }

  const supplyByKey = new Map<string, SupplyElement[]>();
  for (const element of snapshot.supply) {
    const key = planKey(element.itemId, element.plantId);
    const list = supplyByKey.get(key) ?? [];
    list.push(element);
    supplyByKey.set(key, list);
  }

  const measuredByKey = measureLeadTimes(snapshot);

  // Which components share a parent — the horizontal check, built once.
  const siblingsByComponent = new Map<string, Array<{ itemId: string; parentItemId: string }>>();
  const componentsByParent = new Map<string, string[]>();
  for (const line of snapshot.boms) {
    if (line.isAlternate) continue;
    const key = planKey(line.parentItemId, line.plantId);
    const list = componentsByParent.get(key) ?? [];
    if (!list.includes(line.componentItemId)) list.push(line.componentItemId);
    componentsByParent.set(key, list);
  }
  for (const [parentKey, components] of componentsByParent) {
    const [parentItemId] = parentKey.split('@') as [string, string];
    for (const component of components) {
      const list = siblingsByComponent.get(component) ?? [];
      for (const other of components) {
        if (other !== component && !list.some((row) => row.itemId === other)) {
          list.push({ itemId: other, parentItemId });
        }
      }
      siblingsByComponent.set(component, list);
    }
  }

  // ---- First pass: everything that does not depend on another material ----
  const materials = new Map<string, MaterialFacts>();

  for (const itemPlant of snapshot.itemPlants) {
    const key = planKey(itemPlant.itemId, itemPlant.plantId);
    const itemPlan = plan.plans.get(key);
    const item = itemById.get(itemPlant.itemId);
    if (!itemPlan || !item) continue;

    const vendors = (vendorsByKey.get(key) ?? []).slice().sort((a, b) => b.allocationShare - a.allocationShare);
    const vendor = vendors.find((row) => row.isPrimary) ?? vendors[0] ?? null;
    const chain = leadTimeChain(itemPlant, vendor);
    const measured = measuredByKey.get(key) ?? null;

    const calendar = calendarForPlant.get(itemPlant.plantId) ?? fallback;
    const fences = computeFences({
      planningEpochDay,
      calendar,
      maintainedChainDays: chain.totalDays,
      measuredTotalDays: measured?.meanDays ?? null,
      horizonDays,
    });

    let totalDemand = 0;
    for (let day = 0; day <= horizonDays; day += 1) totalDemand += itemPlan.grossRequirements[day] as number;
    const dailyDemandMean = totalDemand / Math.max(horizonDays, 1);

    const orders = supplyByKey.get(key) ?? [];
    const openLines = orders.flatMap((order) =>
      (order.schedule ?? []).map((line) => toOpenLine(order, line, planningEpochDay, vendorNameById)),
    );

    // Measured on the balance *after* the orders that can still be placed.
    //
    // The before-planned curve goes negative for almost every material
    // eventually — that is simply what a replenishment book looks like beyond
    // its own order horizon, and counting it would report four hundred
    // stock-outs and mean nothing. What is worth raising is an exposure that
    // survives doing everything still possible, and the feasible curve is
    // exactly that: it already excludes orders whose release date has passed.
    let firstBreachDay = -1;
    let firstStockoutDay = -1;
    for (let day = 0; day <= horizonDays; day += 1) {
      const balance = itemPlan.projectedAvailableFeasible[day] as number;
      if (firstStockoutDay === -1 && balance < 0) firstStockoutDay = day;
      if (firstBreachDay === -1 && balance < itemPlan.safetyStock) firstBreachDay = day;
    }

    materials.set(key, {
      itemId: itemPlant.itemId,
      plantId: itemPlant.plantId,
      description: item.description,
      itemType: item.type,
      baseUom: item.baseUom,
      abcClass: item.abcClass,
      itemCategoryId: item.itemCategoryId,
      standardCost: item.standardCost,
      shelfLifeDays: item.shelfLifeDays,
      plannerCode: itemPlant.plannerCode,
      itemPlant,
      vendor,
      vendorName: vendor ? (vendorNameById.get(vendor.vendorId) ?? null) : null,
      vendors,
      plan: itemPlan,
      chain,
      fences,
      measured,
      dailyDemandMean,
      openLines,
      orders,
      categorySiblings: [],
      horizontalSiblings: [],
      firstBreachDay,
      firstStockoutDay,
      daysOfCoverToday: itemPlan.daysOfCover[0] as number,
    });
  }

  // ---- Second pass: the two cross-material checks -------------------------
  //
  // The item-category check is the lever nothing on a planning screen shows
  // today: the same chemistry under a different material code, with its own
  // lead time. The horizontal check is why a planner should not expedite one
  // component of a blend whose partner cannot follow.
  const byCategory = new Map<string, MaterialFacts[]>();
  for (const facts of materials.values()) {
    if (facts.itemCategoryId === null) continue;
    const list = byCategory.get(`${facts.itemCategoryId}@${facts.plantId}`) ?? [];
    list.push(facts);
    byCategory.set(`${facts.itemCategoryId}@${facts.plantId}`, list);
  }

  for (const facts of materials.values()) {
    if (facts.itemCategoryId !== null) {
      const family = byCategory.get(`${facts.itemCategoryId}@${facts.plantId}`) ?? [];
      facts.categorySiblings = family
        .filter((row) => row.itemId !== facts.itemId)
        .map((row) => ({
          itemId: row.itemId,
          description: row.description,
          earliestReceiptDay: row.fences.maintained.earliestReceiptDay,
          leadTimeDays: row.chain.totalDays,
        }))
        .sort((a, b) => a.earliestReceiptDay - b.earliestReceiptDay);
    }

    facts.horizontalSiblings = (siblingsByComponent.get(facts.itemId) ?? [])
      .map((sibling) => {
        const other = materials.get(planKey(sibling.itemId, facts.plantId));
        if (!other) return null;
        return {
          itemId: other.itemId,
          description: other.description,
          parentItemId: sibling.parentItemId,
          firstBreachDay: other.firstBreachDay === -1 ? null : other.firstBreachDay,
          unreachable: other.firstBreachDay !== -1 && other.firstBreachDay < other.fences.maintained.earliestReceiptDay,
        } satisfies HorizontalSibling;
      })
      .filter((row): row is HorizontalSibling => row !== null)
      .slice(0, 8);
  }

  return {
    scenarioId,
    planningDate: plan.planningDate,
    planningEpochDay,
    horizonDays,
    elapsedMs: plan.elapsedMs,
    snapshot,
    plan,
    buckets: buildBuckets(plan.planningDate, horizonDays),
    materials,
    changes: changesSinceLastRun(),
    calendarForPlant,
    pilotPlantId: HERO_RM.plantId,
  };
}

function toOpenLine(
  order: SupplyElement,
  line: DeliveryLine,
  planningEpochDay: number,
  vendorNameById: Map<string, string>,
): OpenLineContext {
  return {
    orderId: order.id,
    line: line.line,
    qty: line.qty,
    expectedDay: toEpochDay(line.expectedDate) - planningEpochDay,
    expectedDate: line.expectedDate,
    tier: line.status === 'RECEIVED' ? 1 : tierOfLine(line),
    vendorId: order.vendorId,
    vendorName: order.vendorId ? (vendorNameById.get(order.vendorId) ?? null) : null,
    hasGrn: line.grnDate !== null || line.status === 'RECEIVED',
  };
}

/**
 * Lead times, measured from the dates rather than read off a field beside them.
 *
 * Only receipts that reconcile to a delivery line are used. An unmatched
 * receipt — one posted against a cancelled line, a consolidated delivery, a
 * batch returned and reissued — has no reliable released-on date behind it, so
 * including it would measure something other than a lead time. They are counted
 * and named as excluded rather than quietly dropped: a figure that hides its
 * own exclusions is the kind that loses an audience.
 */
function measureLeadTimes(snapshot: PlanningSnapshot): Map<string, MeasuredLeadTime> {
  const grouped = new Map<string, { matched: number[]; unmatched: number }>();

  for (const receipt of snapshot.receiptHistory) {
    const key = planKey(receipt.itemId, receipt.plantId);
    const entry = grouped.get(key) ?? { matched: [], unmatched: 0 };
    if (receipt.matchedLineId === null || receipt.qaReleasedOn === null) {
      entry.unmatched += 1;
    } else {
      entry.matched.push(toEpochDay(receipt.qaReleasedOn) - toEpochDay(receipt.orderedOn));
    }
    grouped.set(key, entry);
  }

  const result = new Map<string, MeasuredLeadTime>();
  for (const [key, entry] of grouped) {
    if (entry.matched.length < MIN_RECEIPTS_TO_MEASURE) continue;
    const mean = entry.matched.reduce((sum, value) => sum + value, 0) / entry.matched.length;
    const variance = entry.matched.reduce((sum, value) => sum + (value - mean) ** 2, 0) / entry.matched.length;
    result.set(key, {
      meanDays: mean,
      stdDevDays: Math.sqrt(variance),
      observations: entry.matched,
      matchedCount: entry.matched.length,
      unmatchedCount: entry.unmatched,
    });
  }
  return result;
}

/** The shape the exception engine wants, from the facts already assembled. */
export function toMaterialContext(facts: MaterialFacts, plan: MrpResult): MaterialContext {
  return {
    itemId: facts.itemId,
    plantId: facts.plantId,
    description: facts.description,
    baseUom: facts.baseUom,
    standardCost: facts.standardCost,
    itemPlant: facts.itemPlant,
    vendor: facts.vendor,
    plan: facts.plan,
    fences: facts.fences,
    orders: plan.orderExplanations.get(planKey(facts.itemId, facts.plantId)) ?? [],
    dailyDemandMean: facts.dailyDemandMean,
    observedLeadTimeDays: facts.measured?.meanDays ?? null,
    maxNormDays: facts.itemPlant.maxNormDays,
    shelfLifeDays: facts.shelfLifeDays,
    openLines: facts.openLines,
    categorySiblings: facts.categorySiblings,
    horizontalSiblings: facts.horizontalSiblings,
  };
}

export function packLabel(): string {
  return getDataPack(process.env.NEXT_PUBLIC_DATA_PACK).label;
}
