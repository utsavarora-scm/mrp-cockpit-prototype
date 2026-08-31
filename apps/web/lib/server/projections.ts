/**
 * Projections — turning the in-memory plan into what a screen actually draws.
 *
 * The plan holds typed arrays, a pegging graph and the whole snapshot. None of
 * that belongs in a browser. Everything here narrows it to the smallest honest
 * view of the data a given screen needs.
 */

import {
  daysBetween,
  formatDays,
  formatQty,
  fromEpochDay,
  planKey,
  toEpochDay,
  type DemandElement,
  type ItemPlant,
  type MrpResult,
  type PlanningSnapshot,
  type ReceiptHistory,
  type SnapshotMutation,
} from '@repo/domain';
import { reviewPeriodDays, demandStdDev } from '@repo/mrp-engine';

import type {
  CockpitSummary,
  DeliveryLineView,
  ItemDetail,
  ItemPosition,
  LeadTimeEvidence,
  MaterialRow,
  MaterialsQueryResult,
  MrpExplain,
  OverridePreview,
  ParameterHealth,
  PlanningPosition,
  PlantOption,
  PurchaseOrderView,
  TimePhasedRow,
  VendorSplit,
} from '../api-types';
import { dataPack, planFor, planWithParamOverride, snapshotFor } from './planning-session';

/** Opening stock above this many times the horizon's own demand reads as excess. */
const EXCESS_COVER_MULTIPLE = 1.35;

/** Balance below this share of safety stock is a watch item rather than healthy. */
const WATCH_THRESHOLD = 1;

/** Days of demand a material's stock should cover to count as comfortably held. */
const INVENTORY_COVER_TARGET_DAYS = 30;

/** Planning parameters older than this are no longer considered fresh. */
const PARAM_FRESHNESS_DAYS = 365;

/** |observed − maintained| / maintained above this reads as lead-time drift. */
const LEAD_TIME_DRIFT_PCT = 0.2;

/** |calculated − maintained| / maintained above this reads as a stale buffer. */
const SAFETY_STOCK_MISALIGN_PCT = 0.3;

/** How a parameter set's health score is weighted across its three parts. */
const HEALTH_WEIGHTS = { completeness: 0.4, freshness: 0.3, consistency: 0.3 } as const;

/**
 * What the top bar and the reset endpoint read: how the plan stands, and how
 * long the run took. The v2 cockpit hero — excess capital against unprotected
 * exposure — is computed by the norms engine and lands with Checkpoint B.
 */
export function cockpitSummary(scenarioId: string): CockpitSummary {
  const plan = planFor(scenarioId);
  const pack = dataPack();
  const snapshot = snapshotFor();
  const plants: PlantOption[] = snapshot.plants
    .map((plant) => ({ id: plant.id, name: plant.name, type: plant.type }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    scenarioId,
    planningDate: pack.planningDate,
    horizonDays: pack.horizonDays,
    plants,
    elapsedMs: plan.elapsedMs,
    planningPosition: planningPosition(scenarioId),
  };
}

export function planningPosition(scenarioId: string): PlanningPosition {
  const plan = planFor(scenarioId);
  const snapshot = snapshotFor();

  // At risk = the orderable-supply balance goes negative somewhere in the
  // horizon. Read off the plan directly rather than counted from a separate
  // exception pass, so the number cannot drift from the curve it describes.
  const atRiskKeys = new Set<string>();
  for (const [key, itemPlan] of plan.plans) {
    for (let day = 0; day <= plan.horizonDays; day += 1) {
      if ((itemPlan.projectedAvailableFeasible[day] as number) < 0) {
        atRiskKeys.add(key);
        break;
      }
    }
  }

  let projectedStockouts = 0;
  let excessMaterials = 0;
  let coveredByInventory = 0;
  let aboveSafety = 0;
  let planned = 0;

  for (const [, itemPlan] of plan.plans) {
    planned += 1;
    const horizon = itemPlan.projectedAvailableFeasible.length - 1;

    let lowest = Number.POSITIVE_INFINITY;
    let demand = 0;
    for (let day = 0; day <= horizon; day += 1) {
      const balance = itemPlan.projectedAvailableFeasible[day] as number;
      if (balance < lowest) lowest = balance;
      demand += itemPlan.grossRequirements[day] as number;
    }

    if (lowest < 0) projectedStockouts += 1;
    // Excess is judged against what the horizon will actually consume, not
    // against the buffer: an item can sit far above safety stock and still be
    // exactly right if demand is about to take it.
    if (demand > 0 && itemPlan.openingStock > demand * EXCESS_COVER_MULTIPLE) excessMaterials += 1;
    // The four coverage measures read as a progression, from now to the end of
    // the horizon: stock in hand today, demand the plan can serve, materials
    // that never go negative, materials that never breach the buffer.
    //
    // Inventory is measured as days of cover rather than against safety stock
    // or against the whole horizon. Both of those are degenerate on a normal
    // catalogue — the first reports ~100%, the second ~6% — and a bar pinned to
    // one end tells a planner nothing.
    if ((itemPlan.daysOfCover[0] as number) >= INVENTORY_COVER_TARGET_DAYS) coveredByInventory += 1;
    if (lowest >= itemPlan.safetyStock) aboveSafety += 1;
  }

  let openPos = 0;
  let delayedInbound = 0;
  for (const element of snapshot.supply) {
    if (element.type === 'PO') openPos += 1;
    for (const line of element.schedule ?? []) {
      if (line.status === 'DELAYED') delayedInbound += 1;
    }
  }

  const share = (count: number) => (planned > 0 ? count / planned : 0);

  return {
    mrpMaterials: planned,
    atRisk: atRiskKeys.size,
    projectedStockouts,
    excessMaterials,
    openPos,
    delayedInbound,
    coverage: {
      inventory: share(coveredByInventory),
      demand: share(planned - atRiskKeys.size),
      supply: share(planned - projectedStockouts),
      safetyStock: share(aboveSafety),
    },
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
// ---------------------------------------------------------------------------
// Item 360
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export interface MaterialFilters {
  search?: string;
  status?: MaterialRow['status'] | 'ALL';
  plant?: string;
  limit?: number;
}

/**
 * The material-level planning table.
 *
 * One row per planned item-plant, carrying the six figures a planner reads
 * across before deciding whether to open anything: what is wanted, what is
 * held, what is ordered, what is genuinely coming, where that leaves the
 * balance, and whether that is a problem.
 */
export function materialsTable(scenarioId: string, filters: MaterialFilters = {}): MaterialsQueryResult {
  const plan = planFor(scenarioId);
  const snapshot = snapshotFor();
  const planningEpochDay = toEpochDay(plan.planningDate);

  const itemById = new Map(snapshot.items.map((entry) => [entry.id, entry]));
  const masterByKey = new Map(snapshot.itemPlants.map((entry) => [planKey(entry.itemId, entry.plantId), entry]));
  const stockByKey = new Map(snapshot.stock.map((entry) => [planKey(entry.itemId, entry.plantId), entry]));

  // Open supply, split into what is ordered and what is actually committed.
  const supplyByKey = new Map<string, { openPo: number; expected: number }>();
  for (const element of snapshot.supply) {
    const key = planKey(element.itemId, element.plantId);
    const bucket = supplyByKey.get(key) ?? { openPo: 0, expected: 0 };
    bucket.openPo += element.qty;
    if (element.schedule && element.schedule.length > 0) {
      for (const line of element.schedule) {
        if (line.status === 'CONFIRMED' || line.status === 'IN_TRANSIT' || line.status === 'RECEIVED') {
          bucket.expected += line.qty;
        }
      }
    } else {
      bucket.expected += element.qty;
    }
    supplyByKey.set(key, bucket);
  }

  const counts = { all: 0, atRisk: 0, watch: 0, excess: 0, healthy: 0 };
  const rows: MaterialRow[] = [];
  const search = filters.search?.trim().toLowerCase();

  for (const [key, itemPlan] of plan.plans) {
    const item = itemById.get(itemPlan.itemId);
    const master = masterByKey.get(key);
    if (!item || !master) continue;

    const horizon = itemPlan.projectedAvailableFeasible.length - 1;
    let demand = 0;
    let lowest = Number.POSITIVE_INFINITY;
    let stockoutDay = -1;
    for (let day = 0; day <= horizon; day += 1) {
      demand += itemPlan.grossRequirements[day] as number;
      const balance = itemPlan.projectedAvailableFeasible[day] as number;
      if (balance < lowest) lowest = balance;
      if (stockoutDay === -1 && balance < 0) stockoutDay = day;
    }

    const supply = supplyByKey.get(key) ?? { openPo: 0, expected: 0 };
    const stock = stockByKey.get(key);
    const safetyStock = itemPlan.safetyStock;

    const status: MaterialRow['status'] =
      stockoutDay >= 0
        ? 'AT_RISK'
        : demand > 0 && itemPlan.openingStock > demand * EXCESS_COVER_MULTIPLE
          ? 'EXCESS'
          : lowest < safetyStock * WATCH_THRESHOLD
            ? 'WATCH'
            : 'HEALTHY';

    counts.all += 1;
    if (status === 'AT_RISK') counts.atRisk += 1;
    else if (status === 'WATCH') counts.watch += 1;
    else if (status === 'EXCESS') counts.excess += 1;
    else counts.healthy += 1;

    if (filters.status && filters.status !== 'ALL' && filters.status !== status) continue;
    if (filters.plant && itemPlan.plantId !== filters.plant) continue;
    if (
      search &&
      !itemPlan.itemId.toLowerCase().includes(search) &&
      !item.description.toLowerCase().includes(search) &&
      !itemPlan.plantId.toLowerCase().includes(search)
    ) {
      continue;
    }

    rows.push({
      itemId: itemPlan.itemId,
      plantId: itemPlan.plantId,
      description: item.description,
      itemType: item.type,
      baseUom: item.baseUom,
      abcClass: item.abcClass,
      plannerCode: master.plannerCode,
      demand,
      stock: stock?.unrestricted ?? itemPlan.openingStock,
      openPo: supply.openPo,
      expectedInbound: supply.expected,
      safetyStock,
      projectedBalance: itemPlan.projectedAvailableFeasible[horizon] as number,
      lowestBalance: lowest === Number.POSITIVE_INFINITY ? 0 : lowest,
      stockoutDate: stockoutDay >= 0 ? fromEpochDay(planningEpochDay + stockoutDay) : null,
      status,
      // Money the shortfall puts at stake, valued at standard cost. The v2
      // cockpit replaces this with the norms engine's excess/exposure pair.
      exposure: lowest < 0 ? -lowest * item.standardCost : 0,
    });
  }

  // Trouble first, then money, so the top of the table is always the work.
  const rank: Record<MaterialRow['status'], number> = { AT_RISK: 0, WATCH: 1, EXCESS: 2, HEALTHY: 3 };
  rows.sort((a, b) => rank[a.status] - rank[b.status] || b.exposure - a.exposure || b.demand - a.demand);

  const total = rows.length;
  return { rows: rows.slice(0, filters.limit ?? 200), total, counts };
}

export function itemDetail(scenarioId: string, itemId: string, plantId: string): ItemDetail | null {
  const plan = planFor(scenarioId);
  const snapshot = snapshotFor();
  const key = planKey(itemId, plantId);
  const itemPlan = plan.plans.get(key);
  const item = snapshot.items.find((entry) => entry.id === itemId);
  const master = snapshot.itemPlants.find((entry) => entry.itemId === itemId && entry.plantId === plantId);
  if (!itemPlan || !item || !master) return null;

  const planningEpochDay = toEpochDay(plan.planningDate);
  const dates = Array.from({ length: plan.horizonDays + 1 }, (_, day) => fromEpochDay(planningEpochDay + day));
  const stock = snapshot.stock.find((entry) => entry.itemId === itemId && entry.plantId === plantId);

  const demandByType = splitDemandByType(snapshot, plan, itemId, plantId, planningEpochDay, plan.horizonDays);
  const supplyRows = splitSupply(snapshot, itemId, plantId, planningEpochDay, plan.horizonDays);

  const { confirmed, unconfirmed } = splitConfirmedAndPlanned(
    snapshot,
    itemId,
    plantId,
    planningEpochDay,
    plan.horizonDays,
  );
  const requirements = Array.from(itemPlan.grossRequirements);
  const plannedIn = Array.from(itemPlan.plannedReceipts);
  const opening = itemPlan.openingStock;

  // Two balances, never merged. One counts only what a supplier has committed
  // to; the other adds everything the plan is assuming on top.
  const balanceConfirmed = runningBalance(opening, [confirmed], requirements);
  const balanceWithPlanned = runningBalance(opening, [confirmed, unconfirmed, plannedIn], requirements);

  // The same vocabulary the chart above the table uses. Two names for one
  // series across a screen is exactly what made the last build unreadable.
  const grid: TimePhasedRow[] = [
    {
      key: 'gross',
      label: 'Consumed by production',
      values: requirements,
      children: demandByType,
      aggregate: 'SUM',
    },
    {
      key: 'confirmed',
      label: 'Received · confirmed',
      values: confirmed,
      children: supplyRows,
      editable: true,
      aggregate: 'SUM',
    },
    { key: 'unconfirmed', label: 'Received · not yet confirmed', values: unconfirmed, aggregate: 'SUM' },
    { key: 'planned', label: 'Recommended by the plan', values: plannedIn, aggregate: 'SUM' },
    {
      key: 'balance-planned',
      label: 'Stock on hand — the plan’s position',
      values: balanceWithPlanned,
      emphasis: 'BALANCE',
      aggregate: 'LAST',
    },
    {
      key: 'balance-confirmed',
      label: 'Stock on hand — committed supply only',
      values: balanceConfirmed,
      emphasis: 'BALANCE',
      aggregate: 'LAST',
    },
    {
      key: 'norm',
      label: 'Norm',
      values: new Array(plan.horizonDays + 1).fill(itemPlan.safetyStock),
      emphasis: 'THRESHOLD',
      aggregate: 'LAST',
    },
    { key: 'cover', label: 'Days of cover', values: Array.from(itemPlan.daysOfCover), aggregate: 'LAST' },
  ];

  return {
    itemId,
    plantId,
    planningDate: plan.planningDate,
    horizonDays: plan.horizonDays,
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
    paramsLastChangedOn: master.paramsLastChangedOn,
    dates,
    grossRequirements: requirements,
    scheduledReceipts: Array.from(itemPlan.scheduledReceipts),
    plannedReceipts: plannedIn,
    confirmedReceipts: confirmed,
    unconfirmedReceipts: unconfirmed,
    balanceConfirmed,
    balanceWithPlanned,
    projectedAvailable: Array.from(itemPlan.projectedAvailable),
    projectedAvailableFeasible: Array.from(itemPlan.projectedAvailableFeasible),
    daysOfCover: Array.from(itemPlan.daysOfCover),
    grid,
    parameters: parameterHealth(master, item, itemPlan, snapshot),
    leadTime: leadTimeEvidence(snapshot, master, itemId, plantId),
    vendors: vendorSplit(snapshot, itemId, plantId),
    healthScore: healthScoreFor(master, snapshot, itemId, plantId),
    position: itemPosition(itemPlan, snapshot, itemId, plantId, planningEpochDay),
    purchaseOrders: purchaseOrders(snapshot, itemId, plantId),
    recommendation: explainRecommendation(plan, snapshot, master, itemId, plantId),
  };
}

/** The planning position for one item-plant, in the terms the header reads. */
function itemPosition(
  itemPlan: MrpResult['plans'] extends Map<string, infer T> ? T : never,
  snapshot: PlanningSnapshot,
  itemId: string,
  plantId: string,
  planningEpochDay: number,
): ItemPosition {
  const horizon = itemPlan.projectedAvailableFeasible.length - 1;

  let demand = 0;
  let plannedReceipts = 0;
  let lowest = Number.POSITIVE_INFINITY;
  let stockoutDay = -1;
  for (let day = 0; day <= horizon; day += 1) {
    demand += itemPlan.grossRequirements[day] as number;
    plannedReceipts += itemPlan.plannedReceipts[day] as number;
    const balance = itemPlan.projectedAvailableFeasible[day] as number;
    if (balance < lowest) lowest = balance;
    if (stockoutDay === -1 && balance < 0) stockoutDay = day;
  }

  let openPo = 0;
  let expectedInbound = 0;
  for (const element of snapshot.supply) {
    if (element.itemId !== itemId || element.plantId !== plantId) continue;
    openPo += element.qty;
    const lines = element.schedule;
    if (lines && lines.length > 0) {
      for (const line of lines) {
        if (line.status === 'CONFIRMED' || line.status === 'IN_TRANSIT' || line.status === 'RECEIVED') {
          expectedInbound += line.qty;
        }
      }
    } else {
      expectedInbound += element.qty;
    }
  }

  return {
    demand,
    openPo,
    expectedInbound,
    plannedReceipts,
    projectedBalance: itemPlan.projectedAvailableFeasible[horizon] as number,
    lowestBalance: lowest === Number.POSITIVE_INFINITY ? 0 : lowest,
    stockoutDate: stockoutDay >= 0 ? fromEpochDay(planningEpochDay + stockoutDay) : null,
    shortfall: (lowest === Number.POSITIVE_INFINITY ? 0 : lowest) - itemPlan.safetyStock,
  };
}

/** Open orders for one item-plant, with their delivery buckets. */
function purchaseOrders(snapshot: PlanningSnapshot, itemId: string, plantId: string): PurchaseOrderView[] {
  const vendorNames = new Map(snapshot.vendors.map((vendor) => [vendor.id, vendor.name]));

  return snapshot.supply
    .filter((element) => element.itemId === itemId && element.plantId === plantId)
    .map((element) => {
      const lines: DeliveryLineView[] = (element.schedule ?? []).map((line) => ({
        line: line.line,
        qty: line.qty,
        plannedDate: line.plannedDate,
        confirmedDate: line.confirmedDate,
        expectedDate: line.expectedDate,
        status: line.status,
        slipDays: line.confirmedDate ? Math.max(0, daysBetween(line.plannedDate, line.confirmedDate)) : 0,
      }));

      let confirmedQty = 0;
      let unconfirmedQty = 0;
      let worstSlipDays = 0;
      for (const line of lines) {
        if (line.status === 'PLANNED') unconfirmedQty += line.qty;
        else confirmedQty += line.qty;
        if (line.slipDays > worstSlipDays) worstSlipDays = line.slipDays;
      }

      return {
        id: element.id,
        type: element.type,
        vendorId: element.vendorId,
        vendorName: element.vendorId ? (vendorNames.get(element.vendorId) ?? null) : null,
        totalQty: element.qty,
        dueDate: element.dueDate,
        isFirm: element.isFirm,
        sourceSystem: element.sourceSystem,
        lines,
        confirmedQty,
        unconfirmedQty,
        worstSlipDays,
      } satisfies PurchaseOrderView;
    })
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.id.localeCompare(b.id)));
}

/**
 * "Why this quantity?", answered from the run rather than recomputed.
 *
 * The engine's own working gives the outer subtraction — order-up-to level less
 * the balance it found. The inner one, effective stock, is assembled here from
 * the same facts the netting walk used: stock on hand, the inbound a supplier
 * has actually committed to, and the demand already booked against it before
 * the requirement bucket.
 */
function explainRecommendation(
  plan: MrpResult,
  snapshot: PlanningSnapshot,
  master: ItemPlant,
  itemId: string,
  plantId: string,
): MrpExplain | null {
  const key = planKey(itemId, plantId);
  const explanations = plan.orderExplanations.get(key);
  const first = explanations?.[0];
  if (!first) return null;

  const itemPlan = plan.plans.get(key);
  if (!itemPlan) return null;

  const stock = snapshot.stock.find((entry) => entry.itemId === itemId && entry.plantId === plantId);
  const onHand = stock?.unrestricted ?? itemPlan.openingStock;

  // Everything the position absorbs before the bucket that breached.
  let commitments = 0;
  for (let day = 0; day <= first.requirementDay && day < itemPlan.grossRequirements.length; day += 1) {
    commitments += itemPlan.grossRequirements[day] as number;
  }

  // Inbound is derived from the engine's own balance rather than re-summed.
  //
  // Netting counts scheduled *and* already-planned receipts up to the bucket
  // that breached, and its planned-receipt array has this very order written
  // into it by the time the run finishes — re-adding the series here would
  // double-count it. The engine's balance is authoritative, so the term that
  // makes the subtraction close is taken from it, and only the two figures that
  // cannot drift (stock on hand, demand booked before the bucket) are measured
  // directly. That way the panel can never disagree with the plan it explains.
  const inbound = first.balanceBefore - onHand + commitments;

  // What none of that inbound has behind it: a supplier commitment.
  let unconfirmedInbound = 0;
  const requirementDate = fromEpochDay(toEpochDay(plan.planningDate) + first.requirementDay);
  for (const element of snapshot.supply) {
    if (element.itemId !== itemId || element.plantId !== plantId) continue;
    for (const line of element.schedule ?? []) {
      if (line.status !== 'PLANNED') continue;
      if (line.expectedDate > requirementDate) continue;
      unconfirmedInbound += line.qty;
    }
  }

  const horizon = itemPlan.grossRequirements.length - 1;
  let totalDemand = 0;
  for (let day = 0; day <= horizon; day += 1) totalDemand += itemPlan.grossRequirements[day] as number;
  const averageDailyDemand = horizon > 0 ? totalDemand / horizon : 0;

  const observed = observedLeadTimeFor(snapshot, itemId, plantId);
  const vendor = snapshot.itemVendors.find(
    (link) => link.itemId === itemId && link.plantId === plantId && link.isPrimary,
  );

  return {
    recommendedQty: first.qty,
    ruleQty: first.ruleQty,
    orderUpToLevel: first.threshold,
    netRequirement: first.netRequirement,
    effectiveStock: {
      onHand,
      inbound,
      commitments,
      total: first.balanceBefore,
      unconfirmedInbound,
    },
    assumptions: {
      averageDailyDemand,
      safetyStock: master.safetyStock ?? 0,
      inventoryNorm: first.threshold,
      leadTimeDays: first.effectiveLeadTimeDays,
      observedLeadTimeDays: observed,
      lotSizeRule: master.lotSizeRule,
      moq: vendor?.moq ?? null,
    },
    receiptDate: first.receiptDate,
    releaseDate: first.releaseDate,
    isReleaseInPast: first.isReleaseInPast,
    totalOffsetDays: first.totalOffsetDays,
  };
}

/**
 * Receipts for one item-plant, most recent first, split by whether they
 * reconciled to a delivery line.
 *
 * Only matched receipts carry a trustworthy ordered-on date, so only they feed
 * the reconstruction. Averaging all seventeen of the hero material's receipts
 * gives 47.2 days; the fourteen matched ones give 47.0, which is the figure
 * Brief A.1 reconstructs the norm from.
 */
function receiptsFor(
  snapshot: PlanningSnapshot,
  itemId: string,
  plantId: string,
): { matched: ReceiptHistory[]; unmatched: ReceiptHistory[] } {
  const matched: ReceiptHistory[] = [];
  const unmatched: ReceiptHistory[] = [];
  for (const receipt of snapshot.receiptHistory) {
    if (receipt.itemId !== itemId || receipt.plantId !== plantId) continue;
    (receipt.matchedLineId === null ? unmatched : matched).push(receipt);
  }
  const byRecency = (a: ReceiptHistory, b: ReceiptHistory): number =>
    a.receivedOn !== b.receivedOn ? (a.receivedOn < b.receivedOn ? 1 : -1) : a.poId < b.poId ? 1 : -1;
  matched.sort(byRecency);
  unmatched.sort(byRecency);
  return { matched, unmatched };
}

/** Mean actual lead time from matched goods receipts, or null where there is none. */
function observedLeadTimeFor(snapshot: PlanningSnapshot, itemId: string, plantId: string): number | null {
  const { matched } = receiptsFor(snapshot, itemId, plantId);
  if (matched.length === 0) return null;
  let total = 0;
  for (const receipt of matched) total += receipt.actualLeadTimeDays;
  return total / matched.length;
}

/** The approved sources for a material, largest allocation first. */
function vendorSplit(snapshot: PlanningSnapshot, itemId: string, plantId: string): VendorSplit[] {
  const vendors = new Map(snapshot.vendors.map((vendor) => [vendor.id, vendor]));
  return snapshot.itemVendors
    .filter((row) => row.itemId === itemId && row.plantId === plantId)
    .map((row) => ({
      vendorId: row.vendorId,
      vendorName: vendors.get(row.vendorId)?.name ?? null,
      isPrimary: row.isPrimary,
      allocationShare: row.allocationShare,
      leadTimeDays: row.leadTimeDays,
      isImport: row.isImport,
    }))
    .sort((a, b) => b.allocationShare - a.allocationShare || a.vendorId.localeCompare(b.vendorId));
}

/** Everything the Explain drawer needs to justify the lead time it used. */
function leadTimeEvidence(
  snapshot: PlanningSnapshot,
  master: ItemPlant,
  itemId: string,
  plantId: string,
): LeadTimeEvidence {
  const { matched, unmatched } = receiptsFor(snapshot, itemId, plantId);
  const vendorNames = new Map(snapshot.vendors.map((vendor) => [vendor.id, vendor.name]));

  let mean: number | null = null;
  let stdDev: number | null = null;
  if (matched.length > 0) {
    let total = 0;
    for (const receipt of matched) total += receipt.actualLeadTimeDays;
    mean = total / matched.length;
    let variance = 0;
    for (const receipt of matched) variance += (receipt.actualLeadTimeDays - mean) ** 2;
    // Population, matching `observed.ts` — the two must never disagree.
    stdDev = Math.sqrt(variance / matched.length);
  }

  return {
    maintainedDays: master.leadTimeDays,
    observedMeanDays: mean,
    observedStdDevDays: stdDev,
    matchedCount: matched.length,
    unmatchedCount: unmatched.length,
    receipts: matched.map((receipt) => ({
      poId: receipt.poId,
      vendorId: receipt.vendorId,
      vendorName: vendorNames.get(receipt.vendorId) ?? null,
      orderedOn: receipt.orderedOn,
      promisedOn: receipt.promisedOn,
      receivedOn: receipt.receivedOn,
      qty: receipt.qty,
      actualLeadTimeDays: receipt.actualLeadTimeDays,
    })),
    paramsLastChangedOn: master.paramsLastChangedOn,
    maintainedSource: 'SAP MARC · planned delivery time',
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
    .map(([label, series]) => ({
      key: `demand-${label}`,
      label: humanise(label),
      values: Array.from(series),
      aggregate: 'SUM' as const,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Supply split into what is genuinely coming and what is only hoped for.
 *
 * The workshop showed real confusion between these, and the UI has to resolve
 * it rather than inherit it. **Confirmed** = the vendor has acknowledged the
 * delivery line, or it is already in transit or received. **Planned** = our own
 * forward projection — engine-raised orders, plus order lines no supplier has
 * yet committed to a date for.
 *
 * The buyer was explicit about why it matters: *"they should not be assumptions
 * which are giving you a rosy picture, and then later you realise this is not
 * actually going to happen."* Blending the two into one balance is exactly that
 * rosy picture, so the two are never added together into a single series.
 */
function splitConfirmedAndPlanned(
  snapshot: PlanningSnapshot,
  itemId: string,
  plantId: string,
  planningEpochDay: number,
  horizonDays: number,
): { confirmed: number[]; unconfirmed: number[] } {
  const buckets = horizonDays + 1;
  const confirmed = new Array<number>(buckets).fill(0);
  const unconfirmed = new Array<number>(buckets).fill(0);

  for (const element of snapshot.supply) {
    if (element.itemId !== itemId || element.plantId !== plantId) continue;

    // An order with no delivery schedule is a single drop on its due date.
    const lines =
      element.schedule && element.schedule.length > 0
        ? element.schedule
        : [
            {
              line: 1,
              qty: element.qty,
              plannedDate: element.dueDate,
              confirmedDate: null,
              expectedDate: element.dueDate,
              status: 'PLANNED' as const,
            },
          ];

    for (const line of lines) {
      const day = Math.max(0, Math.min(toEpochDay(line.expectedDate) - planningEpochDay, horizonDays));
      const isCommitted = line.status === 'CONFIRMED' || line.status === 'IN_TRANSIT' || line.status === 'RECEIVED';
      const target = isCommitted ? confirmed : unconfirmed;
      target[day] = (target[day] as number) + line.qty;
    }
  }

  return { confirmed, unconfirmed };
}

/** Running balance from an opening position, one bucket at a time. */
function runningBalance(opening: number, receipts: number[][], requirements: readonly number[]): number[] {
  const balance = new Array<number>(requirements.length).fill(0);
  let carried = opening;
  for (let day = 0; day < requirements.length; day += 1) {
    for (const series of receipts) carried += series[day] as number;
    carried -= requirements[day] as number;
    balance[day] = carried;
  }
  return balance;
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
        aggregate: 'SUM',
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
  const { matched: matchedReceipts } = receiptsFor(snapshot, master.itemId, master.plantId);
  const observedLeadTime = observedLeadTimeFor(snapshot, master.itemId, master.plantId);

  const sigma = demandStdDev(itemPlan.underlyingDemand, reviewPeriodDays(master.leadTimeDays));
  const calculatedSafetyStock =
    master.leadTimeDays !== null
      ? zFor(master.serviceLevelTarget) * sigma * Math.sqrt(Math.max(master.leadTimeDays, 1))
      : null;

  const staleAfter = PARAM_FRESHNESS_DAYS;
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
              Math.abs(observedLeadTime - master.leadTimeDays) / Math.max(master.leadTimeDays, 1) > LEAD_TIME_DRIFT_PCT
            ? 'DRIFTED'
            : 'FRESH',
      note: matchedReceipts.length > 0 ? `Across ${matchedReceipts.length} matched receipts` : null,
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
                SAFETY_STOCK_MISALIGN_PCT
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
  const weights = HEALTH_WEIGHTS;

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
  const freshness = Math.max(0, 1 - ageDays / (PARAM_FRESHNESS_DAYS * 3));

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
// Simulation
// ---------------------------------------------------------------------------

/**
 * A planner override, weighed before it is applied.
 *
 * The same machinery a resolution uses: clone the snapshot, set the parameter,
 * re-run, diff. Nothing is committed — this is the "what would happen" the
 * planner is entitled to before they touch anything, and answering it with an
 * estimate rather than a real run is how a decision-support tool loses the
 * planner's trust the first time the two disagree.
 */
export function previewOverride(
  scenarioId: string,
  itemId: string,
  plantId: string,
  field: Extract<SnapshotMutation, { kind: 'SET_ITEM_PLANT_PARAM' }>['field'],
  value: number | null,
): OverridePreview | null {
  const plan = planFor(scenarioId);
  const snapshot = snapshotFor();
  const master = snapshot.itemPlants.find((entry) => entry.itemId === itemId && entry.plantId === plantId);
  if (!master) return null;

  const after = planWithParamOverride(scenarioId, itemId, plantId, field, value);
  if (!after) return null;

  const key = planKey(itemId, plantId);
  const beforePlan = plan.plans.get(key);
  const afterPlan = after.plan.plans.get(key);

  const lowest = (series: Float64Array | undefined): number => {
    if (!series) return 0;
    let low = Number.POSITIVE_INFINITY;
    for (let index = 0; index < series.length; index += 1) {
      const point = series[index] as number;
      if (point < low) low = point;
    }
    return low === Number.POSITIVE_INFINITY ? 0 : low;
  };

  return {
    field,
    label: fieldLabel(field),
    systemValue: (master[field] as number | null) ?? null,
    overrideValue: value,
    before: explainRecommendation(plan, snapshot, master, itemId, plantId),
    after: explainRecommendation(after.plan, after.snapshot, after.master, itemId, plantId),
    beforeBalance: beforePlan ? downsample(beforePlan.projectedAvailableFeasible, 60) : [],
    afterBalance: afterPlan ? downsample(afterPlan.projectedAvailableFeasible, 60) : [],
    dates: sampleDates(toEpochDay(plan.planningDate), plan.horizonDays, 60),
    beforeLowestBalance: lowest(beforePlan?.projectedAvailableFeasible),
    afterLowestBalance: lowest(afterPlan?.projectedAvailableFeasible),
    elapsedMs: after.plan.elapsedMs,
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

/** A camelCase master-data field as a planner would say it: `leadTimeDays` → `Lead time days`. */
function fieldLabel(field: string): string {
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
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
