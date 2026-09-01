/**
 * Screen 2 — the material workbench, and the explain panel that opens from it.
 *
 * The heart of the product: the chart and the grid, together, for one material.
 * Two things here are not conventional and both are deliberate.
 *
 * **Row 7 against row 13.** The balance before any planned order, and the
 * balance if everything proposed is actually done. Most planning tools show
 * only the second, which hides the problem behind its own proposed solution.
 * Keeping both is the whole story of the screen.
 *
 * **The explain payload recurses to a source field.** Every operand carries a
 * provenance, the requirement walks back up the bill of material to a number
 * the business recognises, and the lead time is shown maintained *and*
 * measured with the receipts behind it. No narrative generation anywhere: the
 * sentence is a template filled from the calculation, so the same numbers
 * always produce the same words.
 */

import {
  componentFactor,
  bucketFlow,
  bucketLevel,
  raiseExceptions,
  rankExceptions,
  zoneOfDay,
  type Bucket,
} from '@repo/planning-engine';
import {
  fromEpochDay,
  planKey,
  reasonLabel,
  TIERS,
  toEpochDay,
  weekLabel,
  type BomLine,
  type DeliveryLine,
  type PlannedOrderExplanation,
  type SupplyElement,
} from '@repo/domain';

import type {
  ChainStep,
  ChartBucket,
  DeliveryLineView,
  ExplainLine,
  ExplainPayload,
  ExceptionView,
  FenceView,
  GridRow,
  MaterialDetail,
  OrderView,
  ParameterView,
  ProvenanceRow,
  ReceiptView,
  RecommendationView,
  VendorSplitView,
} from '../api-types';
import { runContext, toMaterialContext, type MaterialFacts, type RunContext } from './context';
import { runHeader } from './header';
import { dismissedExceptions } from './planning-session';
import { tierView } from './position';

/** Planning parameters older than this have stopped being current. */
const PARAM_STALE_DAYS = 365;

export function materialDetail(scenarioId: string, itemId: string, plantId: string): MaterialDetail | null {
  const context = runContext(scenarioId);
  const facts = context.materials.get(planKey(itemId, plantId));
  if (!facts) return null;

  const buckets = context.buckets;
  const chart = buildChart(facts, context, buckets);
  const explanations = context.plan.orderExplanations.get(planKey(itemId, plantId)) ?? [];
  const stock = context.snapshot.stock.find((row) => row.itemId === itemId && row.plantId === plantId);

  return {
    header: runHeader(context),
    itemId,
    plantId,
    description: facts.description,
    itemType: facts.itemType,
    baseUom: facts.baseUom,
    abcClass: facts.abcClass,
    itemCategoryId: facts.itemCategoryId,
    standardCost: facts.standardCost,
    plannerCode: facts.plannerCode,
    lowLevelCode: facts.plan.lowLevelCode,

    stock: {
      unrestricted: stock?.unrestricted ?? 0,
      blocked: stock?.blocked ?? 0,
      qualityInspection: stock?.qualityInspection ?? 0,
      inTransit: stock?.inTransit ?? 0,
    },
    quarantine: (stock?.quarantine ?? []).map((lot) => ({ ...lot })),
    safetyStock: facts.plan.safetyStock,
    maxNorm: maxNormQty(facts),

    buckets: chart,
    grid: buildGrid(facts, context, buckets, explanations),

    chain: facts.chain.intervals.map((interval) => ({ ...interval })),
    fences: {
      maintained: fenceView(facts.fences.maintained, buckets),
      measured: facts.fences.measured === null ? null : fenceView(facts.fences.measured, buckets),
      driftDays: facts.fences.driftDays === null ? null : Math.round(facts.fences.driftDays),
    },
    parameters: buildParameters(facts, context),
    vendors: buildVendors(facts, context),

    firstBreachDate: dayToDate(facts.firstBreachDay, context),
    firstStockoutDate: dayToDate(facts.firstStockoutDay, context),
    daysOfCoverToday: round1(facts.daysOfCoverToday),

    recommendation: buildRecommendation(explanations, facts, context),
    orders: buildOrders(facts, context),
    exceptions: exceptionsFor(facts, context),
  };
}

// ---------------------------------------------------------------------------
// The chart
// ---------------------------------------------------------------------------

function buildChart(facts: MaterialFacts, context: RunContext, buckets: Bucket[]): ChartBucket[] {
  const plan = facts.plan;
  const demand = bucketFlow(plan.grossRequirements, buckets);
  const confirmed = bucketFlow(plan.confirmedReceipts, buckets);
  const committed = bucketFlow(plan.committedReceipts, buckets);
  const planned = bucketFlow(plan.plannedReceipts, buckets);
  const qaRelease = bucketFlow(plan.qaReleases, buckets);
  const beforePlanned = bucketLevel(plan.projectedBeforePlanned, buckets);
  const confirmedOnly = bucketLevel(plan.projectedConfirmedOnly, buckets);
  const afterPlanned = bucketLevel(plan.projectedAvailableFeasible, buckets);
  const cover = bucketLevel(plan.daysOfCover, buckets);
  const maxNorm = maxNormQty(facts);

  return buckets.map((bucket, index) => {
    const balance = beforePlanned[index] as number;
    const status: ChartBucket['status'] =
      balance < 0
        ? 'STOCK_OUT'
        : balance < plan.safetyStock
          ? 'BREACH'
          : balance < plan.safetyStock * 1.15
            ? 'TIGHT'
            : maxNorm !== null && balance > maxNorm
              ? 'EXCESS'
              : 'OK';

    return {
      index,
      label: bucket.label,
      week: bucket.week,
      kind: bucket.kind,
      zone: bucket.zone,
      startsZone: bucket.startsZone,
      startDate: bucket.startDate,
      endDate: bucket.endDate,
      demand: round(demand[index] as number),
      confirmed: round(confirmed[index] as number),
      committed: round(committed[index] as number),
      planned: round(planned[index] as number),
      qaRelease: round(qaRelease[index] as number),
      balanceBeforePlanned: round(balance),
      balanceConfirmedOnly: round(confirmedOnly[index] as number),
      balanceAfterPlanned: round(afterPlanned[index] as number),
      safetyStock: plan.safetyStock,
      maxNorm,
      daysOfCover: round1(cover[index] as number),
      fenceZone: zoneOfDay(facts.fences.maintained, bucket.endDay),
      status,
    };
  });
}

function maxNormQty(facts: MaterialFacts): number | null {
  if (facts.itemPlant.maxNormDays === null) return null;
  return Math.round(facts.itemPlant.maxNormDays * facts.dailyDemandMean);
}

function fenceView(
  fence: { totalDays: number; earliestReceiptDay: number; earliestReceiptDate: string },
  buckets: Bucket[],
): FenceView {
  const bucket = buckets.findIndex(
    (row) => fence.earliestReceiptDay >= row.startDay && fence.earliestReceiptDay <= row.endDay,
  );
  return {
    totalDays: fence.totalDays,
    earliestReceiptDate: fence.earliestReceiptDate,
    earliestReceiptWeek: weekLabel(fence.earliestReceiptDate),
    earliestReceiptBucket: bucket === -1 ? buckets.length - 1 : bucket,
  };
}

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

/**
 * The classic planning table, made legible.
 *
 * Rows are fixed and in this order, because a planner who has used one of these
 * for twenty years reads it by position. What is new is rows 2 and 3, which
 * split the requirement into what came from the schedule and what came from the
 * explosion; row 11, which separates need from rule; and row 7, which is the
 * position with no wishful supply in it.
 */
function buildGrid(
  facts: MaterialFacts,
  context: RunContext,
  buckets: Bucket[],
  explanations: PlannedOrderExplanation[],
): GridRow[] {
  const plan = facts.plan;
  const horizon = context.horizonDays;

  const { independent, dependent } = splitDemand(facts, context, horizon);
  const netRequirement = new Float64Array(horizon + 1);
  const plannedReceipt = new Float64Array(horizon + 1);
  const lotSizingAddition = new Float64Array(horizon + 1);
  const releaseSeries = new Float64Array(horizon + 1);

  for (const order of explanations) {
    const receiptDay = toEpochDay(order.receiptDate) - context.planningEpochDay;
    if (receiptDay >= 0 && receiptDay <= horizon) {
      netRequirement[receiptDay] = (netRequirement[receiptDay] as number) + order.netRequirement;
      plannedReceipt[receiptDay] = (plannedReceipt[receiptDay] as number) + order.qty;
      lotSizingAddition[receiptDay] =
        (lotSizingAddition[receiptDay] as number) + Math.max(0, order.qty - order.netRequirement);
    }
    const releaseDay = toEpochDay(order.releaseDate) - context.planningEpochDay;
    // A release date in the past is the finding, so it is carried at day zero
    // and flagged rather than dropped for being off the left of the chart.
    const slot = releaseDay < 0 ? 0 : releaseDay > horizon ? -1 : releaseDay;
    if (slot !== -1) releaseSeries[slot] = (releaseSeries[slot] as number) + order.qty;
  }

  const row = (
    key: string,
    label: string,
    series: ArrayLike<number>,
    aggregate: GridRow['aggregate'],
    options: Partial<Pick<GridRow, 'indent' | 'emphasis' | 'tone' | 'note'>> = {},
  ): GridRow => ({
    key,
    label,
    indent: options.indent ?? 0,
    values: (aggregate === 'SUM' ? bucketFlow(series, buckets) : bucketLevel(series, buckets)).map(round),
    aggregate,
    emphasis: options.emphasis ?? 'NONE',
    tone: options.tone ?? 'NEUTRAL',
    note: options.note ?? null,
  });

  const inTransitOrQa = new Float64Array(horizon + 1);
  for (let day = 0; day <= horizon; day += 1) inTransitOrQa[day] = plan.qaReleases[day] as number;

  const safetyStockSeries = new Float64Array(horizon + 1).fill(plan.safetyStock);

  return [
    row('gross', 'Gross requirement', plan.grossRequirements, 'SUM', { emphasis: 'NONE' }),
    row('independent', 'from the production schedule', independent, 'SUM', {
      indent: 1,
      note: 'Independent demand — what this plant is committed to make or ship.',
    }),
    row('dependent', 'from bill-of-material explosion', dependent, 'SUM', {
      indent: 1,
      note: 'Aggregated across every parent that consumes this material.',
    }),
    row('confirmed', 'Scheduled receipts — confirmed', plan.confirmedReceipts, 'SUM', {
      note: TIERS[1].description,
    }),
    row('committed', 'Scheduled receipts — committed', plan.committedReceipts, 'SUM', {
      note: TIERS[2].description,
    }),
    row('quarantine', 'In transit / in quality inspection', inTransitOrQa, 'SUM', {
      note: 'On site and not yet stock. Dated to the day it is expected to clear.',
    }),
    row('balanceBefore', 'Projected balance before planned orders', plan.projectedBeforePlanned, 'LAST', {
      emphasis: 'BALANCE',
      tone: 'NEGATIVE_IS_BAD',
      note: 'The honest position: stock and existing orders, with nothing the system is merely proposing.',
    }),
    row('safetyStock', 'Safety stock', safetyStockSeries, 'LAST', { emphasis: 'THRESHOLD' }),
    row('netRequirement', 'Net requirement', netRequirement, 'SUM', {
      emphasis: 'ANSWER',
      note: 'Requirement plus safety stock, less the balance and the receipts already landing.',
    }),
    row('plannedReceipt', 'Planned order receipt', plannedReceipt, 'SUM', {
      note: 'After the minimum, the rounding value and the maximum lot, in that order.',
    }),
    row('lotSizing', 'of which added by lot sizing', lotSizingAddition, 'SUM', {
      indent: 1,
      note: 'Quantity created by a rule rather than by demand.',
    }),
    row('release', 'Planned order release', releaseSeries, 'SUM', {
      tone: 'PAST_IS_BAD',
      note: 'Offset back by the full lead-time chain. Red where the date has already passed.',
    }),
    row('balanceAfter', 'Projected balance after planned orders', plan.projectedAvailableFeasible, 'LAST', {
      emphasis: 'BALANCE',
      tone: 'NEGATIVE_IS_BAD',
      note: 'The plan, if everything proposed is actually done — counting only orders that can still be placed.',
    }),
    row('cover', 'Days of cover', plan.daysOfCover, 'LAST', {
      note: 'Forward-looking, at planned consumption.',
    }),
  ];
}

/**
 * Independent demand against dependent, per bucket.
 *
 * Worth splitting because they are argued about with different people. An
 * independent number is a conversation with sales; a dependent one is a
 * conversation about a parent's build plan.
 */
function splitDemand(
  facts: MaterialFacts,
  context: RunContext,
  horizon: number,
): { independent: Float64Array; dependent: Float64Array } {
  const independent = new Float64Array(horizon + 1);
  const dependent = new Float64Array(horizon + 1);

  for (const element of context.snapshot.demand) {
    if (element.itemId !== facts.itemId || element.plantId !== facts.plantId) continue;
    const day = toEpochDay(element.requiredDate) - context.planningEpochDay;
    if (day < 0 || day > horizon) continue;
    independent[day] = (independent[day] as number) + element.qty;
  }
  for (const element of context.plan.derivedDemand) {
    if (element.itemId !== facts.itemId || element.plantId !== facts.plantId) continue;
    const day = toEpochDay(element.requiredDate) - context.planningEpochDay;
    if (day < 0 || day > horizon) continue;
    dependent[day] = (dependent[day] as number) + element.qty;
  }
  return { independent, dependent };
}

// ---------------------------------------------------------------------------
// Parameters, vendors, orders, recommendation
// ---------------------------------------------------------------------------

function buildParameters(facts: MaterialFacts, context: RunContext): ParameterView[] {
  const master = facts.itemPlant;
  const ageDays = context.planningEpochDay - toEpochDay(master.paramsLastChangedOn);
  const stale = ageDays > PARAM_STALE_DAYS;

  const rows: ParameterView[] = [];
  const add = (
    field: string,
    label: string,
    value: number | string | null,
    options: { measured?: string | null; note?: string | null; editable?: boolean; uom?: string } = {},
  ): void => {
    const maintained =
      value === null
        ? '—'
        : typeof value === 'number'
          ? `${format(value)}${options.uom ? ` ${options.uom}` : ''}`
          : value;
    rows.push({
      field,
      label,
      maintained,
      measured: options.measured ?? null,
      status: value === null ? 'MISSING' : options.measured ? 'DRIFTED' : stale ? 'STALE' : 'FRESH',
      source: 'SAP material master',
      lastChangedOn: master.paramsLastChangedOn,
      note: options.note ?? (stale ? `Set ${Math.round(ageDays / 30)} months ago and not revisited since.` : null),
      editable: options.editable ?? false,
    });
  };

  const measured = facts.measured;
  const driftNote =
    measured && master.leadTimeDays
      ? `${Math.round(measured.meanDays)} days measured across ${measured.matchedCount} receipts, spread ±${Math.round(measured.stdDevDays)}.`
      : null;

  add('leadTimeDays', 'Total planning lead time', master.leadTimeDays, {
    uom: 'days',
    measured: measured ? `${Math.round(measured.meanDays)} days` : null,
    note: driftNote,
    editable: true,
  });
  add('safetyStock', 'Safety stock', master.safetyStock, { uom: facts.baseUom, editable: true });
  add('minLotSize', 'Minimum order quantity', master.minLotSize, { uom: facts.baseUom, editable: true });
  add('roundingValue', 'Rounding value', master.roundingValue, { uom: facts.baseUom, editable: true });
  add('maxLotSize', 'Maximum lot', master.maxLotSize, { uom: facts.baseUom, editable: true });
  add('lotSizeRule', 'Lot-sizing rule', master.lotSizeRule);
  add('storageCapacity', 'Storage capacity', master.storageCapacity, {
    uom: facts.baseUom,
    note: 'What the plant can hold of this item at once — a different question from how much can be bought.',
  });
  add('qaQuarantineDays', 'Quality inspection', master.qaQuarantineDays, {
    uom: 'days',
    note: 'Material in inspection is on site and is not stock.',
  });
  add('maxNormDays', 'Maximum coverage norm', master.maxNormDays, { uom: 'days' });

  return rows;
}

function buildVendors(facts: MaterialFacts, context: RunContext): VendorSplitView[] {
  const vendorById = new Map(context.snapshot.vendors.map((vendor) => [vendor.id, vendor]));
  return facts.vendors.map((row) => {
    const vendor = vendorById.get(row.vendorId);
    return {
      vendorId: row.vendorId,
      vendorName: vendor?.name ?? null,
      isPrimary: row.isPrimary,
      allocationShare: row.allocationShare,
      leadTimeDays: row.acknowledgementDays + row.leadTimeDays + row.transitDays + row.customsDays,
      isImport: row.isImport,
      weeklyCapacity: row.weeklyCapacity,
      shutdownWeeks: (vendor?.productionShutdownWeeks ?? []).map((monday) => weekLabel(monday)),
    };
  });
}

export function buildOrders(facts: MaterialFacts, context: RunContext): OrderView[] {
  const vendorById = new Map(context.snapshot.vendors.map((vendor) => [vendor.id, vendor.name]));
  return facts.orders.map((order) => {
    const lines = (order.schedule ?? []).map((line) => toLineView(order, line, facts, context));
    return {
      id: order.id,
      vendorId: order.vendorId,
      vendorName: order.vendorId ? (vendorById.get(order.vendorId) ?? null) : null,
      totalQty: Math.round(order.qty),
      confirmedQty: Math.round(lines.filter((line) => line.tier.tier === 1).reduce((sum, line) => sum + line.qty, 0)),
      unconfirmedQty: Math.round(lines.filter((line) => line.tier.tier !== 1).reduce((sum, line) => sum + line.qty, 0)),
      lines,
    };
  });
}

const STAGE_OF: Record<string, string> = {
  PLANNED: 'PO created',
  CONFIRMED: 'Vendor acknowledged',
  DELAYED: 'Vendor acknowledged',
  IN_TRANSIT: 'In transit',
  RECEIVED: 'Received (GRN)',
};

function toLineView(
  order: SupplyElement,
  line: DeliveryLine,
  facts: MaterialFacts,
  context: RunContext,
): DeliveryLineView {
  const slipDays = line.confirmedDate === null ? 0 : toEpochDay(line.expectedDate) - toEpochDay(line.plannedDate);
  const tier = line.status === 'RECEIVED' ? 1 : line.confirmedDate !== null || line.status === 'IN_TRANSIT' ? 1 : 2;
  void context;
  return {
    orderId: order.id,
    line: line.line,
    qty: Math.round(line.qty),
    requestedDate: line.plannedDate,
    requestedWeek: weekLabel(line.plannedDate),
    committedDate: line.confirmedDate,
    expectedDate: line.expectedDate,
    expectedWeek: weekLabel(line.expectedDate),
    tier: tierView(tier as 1 | 2 | 3),
    stage: line.qaReleasedOn ? 'Available' : (STAGE_OF[line.status] ?? 'PO created'),
    slipDays,
    // A five-day delay on a fast mover and a five-day delay on a slow one are
    // not the same event, so the slip is also stated in cover.
    coverLostDays: facts.dailyDemandMean > 0 ? round1((slipDays * facts.dailyDemandMean) / facts.dailyDemandMean) : 0,
    reasonCode: line.reasonCode,
    reasonLabel: reasonLabel(line.reasonCode),
    note: line.note,
    grnDate: line.grnDate,
    grnQty: line.grnQty,
    qaReleasedOn: line.qaReleasedOn,
    editable: line.status !== 'RECEIVED',
  };
}

function buildRecommendation(
  explanations: PlannedOrderExplanation[],
  facts: MaterialFacts,
  context: RunContext,
): RecommendationView | null {
  const first = explanations[0];
  if (!first) return null;
  const releaseDay = toEpochDay(first.releaseDate) - context.planningEpochDay;
  void facts;
  return {
    qty: Math.round(first.qty),
    netRequirement: Math.round(first.netRequirement),
    lotSizingAddition: Math.round(Math.max(0, first.qty - first.netRequirement)),
    receiptDate: first.receiptDate,
    receiptWeek: weekLabel(first.receiptDate),
    releaseDate: first.releaseDate,
    releaseWeek: weekLabel(first.releaseDate),
    isReleaseInPast: first.isReleaseInPast,
    weeksLate: releaseDay < 0 ? Math.round(-releaseDay / 7) : 0,
    leadTimeDays: first.totalOffsetDays,
  };
}

export function exceptionsFor(facts: MaterialFacts, context: RunContext): ExceptionView[] {
  const dismissed = dismissedExceptions();
  const raised = rankExceptions(raiseExceptions(toMaterialContext(facts, context.plan), context.horizonDays));
  return raised.map((exception) => {
    const biteDate = fromEpochDay(context.planningEpochDay + Math.max(exception.biteDay, 0));
    return {
      id: exception.id,
      code: exception.code,
      group: exception.group,
      groupLabel: exception.group,
      severity: exception.severity,
      itemId: exception.itemId,
      plantId: exception.plantId,
      description: facts.description,
      baseUom: facts.baseUom,
      headline: exception.headline,
      biteDate,
      biteWeek: weekLabel(biteDate),
      daysToBite: exception.biteDay,
      qtyAtStake: Math.round(exception.qtyAtStake),
      daysAtStake: round1(exception.daysAtStake),
      valueAtStake: Math.round(exception.valueAtStake),
      reachableByOrdering: exception.reachableByOrdering,
      operands: exception.operands.map((operand) => ({ ...operand, value: round(operand.value) })),
      actions: exception.actions,
      dismissed: dismissed.has(exception.id),
    };
  });
}

// ---------------------------------------------------------------------------
// Explain
// ---------------------------------------------------------------------------

export function explain(scenarioId: string, itemId: string, plantId: string): ExplainPayload | null {
  const context = runContext(scenarioId);
  const facts = context.materials.get(planKey(itemId, plantId));
  if (!facts) return null;

  const explanations = context.plan.orderExplanations.get(planKey(itemId, plantId)) ?? [];
  const order = explanations[0] ?? null;
  const biteDay = facts.firstStockoutDay !== -1 ? facts.firstStockoutDay : facts.firstBreachDay;

  return {
    itemId,
    plantId,
    sentence: buildSentence(facts, context, order, biteDay),
    arithmetic: buildArithmetic(facts, context, order),
    chain: buildChainWalk(facts, context, order),
    provenance: buildProvenance(facts, context),
    categoryCheck: facts.categorySiblings.map((sibling) => ({
      itemId: sibling.itemId,
      description: sibling.description,
      leadTimeDays: sibling.leadTimeDays,
      earliestReceiptDate: fromEpochDay(context.planningEpochDay + sibling.earliestReceiptDay),
      earliestReceiptWeek: weekLabel(fromEpochDay(context.planningEpochDay + sibling.earliestReceiptDay)),
      reachesTheBreach: biteDay !== -1 && sibling.earliestReceiptDay <= biteDay,
    })),
    horizontalCheck: facts.horizontalSiblings.map((sibling) => ({
      itemId: sibling.itemId,
      description: sibling.description,
      parentItemId: sibling.parentItemId,
      firstBreachDate: sibling.firstBreachDay === null ? null : dayToDate(sibling.firstBreachDay, context),
      blocked: sibling.unreachable,
    })),
    realityCheck: {
      maintainedDays: facts.itemPlant.leadTimeDays,
      measuredDays: facts.measured ? Math.round(facts.measured.meanDays * 10) / 10 : null,
      stdDevDays: facts.measured ? Math.round(facts.measured.stdDevDays * 10) / 10 : null,
      matchedCount: facts.measured?.matchedCount ?? 0,
      unmatchedCount: facts.measured?.unmatchedCount ?? 0,
      receipts: receiptsFor(facts, context),
    },
  };
}

/**
 * One sentence, before any table.
 *
 * A template filled from the calculation, so the same numbers always produce
 * the same words. No language model: a generated narrative that cannot be
 * reproduced is the opposite of a trust layer, and this is the sentence the
 * whole screen is judged on.
 */
function buildSentence(
  facts: MaterialFacts,
  context: RunContext,
  order: PlannedOrderExplanation | null,
  biteDay: number,
): string {
  const uom = facts.baseUom;
  if (!order) {
    if (biteDay === -1) {
      return `${facts.description} (${facts.itemId}) is covered across the whole ${Math.round(context.horizonDays / 7)}-week horizon on stock and existing orders. The plan is not asking for anything.`;
    }
    return `${facts.description} (${facts.itemId}) falls below its ${format(facts.plan.safetyStock)} ${uom} safety stock on ${fromEpochDay(context.planningEpochDay + biteDay)}, and the plan has no order it can propose to cover it.`;
  }

  const week = weekLabel(order.receiptDate);
  const lotSizing = Math.max(0, order.qty - order.netRequirement);
  const lotClause =
    lotSizing > 0 && facts.itemPlant.minLotSize
      ? ` The order is ${format(order.qty)} ${uom} — not ${format(order.netRequirement)} ${uom} — because the minimum order quantity is ${format(facts.itemPlant.minLotSize)} ${uom}.`
      : '';
  const reachClause = order.isReleaseInPast
    ? ` This order needed releasing in ${weekLabel(order.releaseDate)} (${fromEpochDay(toEpochDay(order.releaseDate))}) and cannot now be placed in time.`
    : ` It has to be released by ${fromEpochDay(toEpochDay(order.releaseDate))} (${weekLabel(order.releaseDate)}).`;

  const requirementDate = fromEpochDay(context.planningEpochDay + order.requirementDay);
  const requirement = facts.plan.grossRequirements[order.requirementDay] as number;

  return (
    `Order ${format(order.qty)} ${uom} of ${facts.itemId} (${facts.description}) to land in ${week} (${fromEpochDay(toEpochDay(order.receiptDate))}). ` +
    `Demand of ${format(requirement)} ${uom} on ${requirementDate} plus a ${format(order.threshold)} ${uom} safety stock exceeds the ${format(order.balanceBefore)} ${uom} projected on hand by ${format(order.netRequirement)} ${uom}.` +
    lotClause +
    reachClause
  );
}

/**
 * The arithmetic, one line per operand, each with its own provenance.
 *
 * Displayed components sum to displayed totals. Rounding and lot sizing are
 * their own lines, never absorbed into a figure that then does not foot.
 */
function buildArithmetic(
  facts: MaterialFacts,
  context: RunContext,
  order: PlannedOrderExplanation | null,
): ExplainLine[] {
  const uom = facts.baseUom;
  const lines: ExplainLine[] = [];
  const push = (
    label: string,
    value: number | null,
    operator: ExplainLine['operator'],
    source: string | null,
    options: { emphasis?: boolean; expandable?: boolean } = {},
  ): void => {
    lines.push({
      label,
      value: value === null ? null : round(value),
      uom,
      operator,
      source,
      emphasis: options.emphasis ?? false,
      expandable: options.expandable ?? false,
    });
  };

  if (!order) {
    push('Opening stock', facts.plan.openingStock, '', 'Stock on hand, unrestricted');
    push('Safety stock', facts.plan.safetyStock, '', `SAP material master, set ${facts.itemPlant.paramsLastChangedOn}`);
    push('Lowest projected balance', lowestBalance(facts, context), '=', 'Rolled from opening stock', {
      emphasis: true,
    });
    return lines;
  }

  const requirement = facts.plan.grossRequirements[order.requirementDay] as number;
  const requirementDate = fromEpochDay(context.planningEpochDay + order.requirementDay);

  push(`Gross requirement, ${weekLabel(requirementDate)}`, requirement, '', 'Bill-of-material explosion', {
    expandable: true,
  });
  push('Safety stock', order.threshold, '+', `SAP material master, set ${facts.itemPlant.paramsLastChangedOn}`);
  push('Required position', requirement + order.threshold, '=', null, { emphasis: true });

  push('Projected balance before this bucket', order.balanceBefore, '', 'Rolled from opening stock', {
    expandable: true,
  });
  push('Scheduled receipts in the bucket', 0, '+', 'Open purchase order schedule lines');
  push('Available position', order.balanceBefore, '=', null, { emphasis: true });

  push('NET REQUIREMENT', order.netRequirement, '=', 'Required position less available position', { emphasis: true });

  const lotSizing = Math.max(0, order.qty - order.netRequirement);
  if (facts.itemPlant.minLotSize) {
    const binding = order.netRequirement < facts.itemPlant.minLotSize;
    push(
      `Minimum order quantity ${format(facts.itemPlant.minLotSize)} ${uom}`,
      binding ? facts.itemPlant.minLotSize - order.netRequirement : null,
      '+',
      binding ? 'Binding' : 'Not binding',
    );
  }
  if (facts.itemPlant.roundingValue) {
    const afterMoq = Math.max(order.netRequirement, facts.itemPlant.minLotSize ?? 0);
    const rounded = Math.ceil(afterMoq / facts.itemPlant.roundingValue) * facts.itemPlant.roundingValue;
    push(
      `Rounding value ${format(facts.itemPlant.roundingValue)} ${uom}`,
      rounded > afterMoq ? rounded - afterMoq : null,
      '+',
      rounded > afterMoq ? 'Binding' : 'Not binding',
    );
  }
  push('PLANNED ORDER RECEIPT', order.qty, '=', null, { emphasis: true });
  void lotSizing;

  push(
    `Lead time ${order.totalOffsetDays} days`,
    null,
    '',
    'Vendor response, readiness, transit, customs, receipt and quality release',
  );
  push(
    `REQUIRED RELEASE ${weekLabel(order.releaseDate)}`,
    null,
    '',
    order.isReleaseInPast ? 'Already past' : 'Still reachable',
    { emphasis: true },
  );
  push(
    `EARLIEST ACHIEVABLE ${facts.fences.maintained.earliestReceiptDate}`,
    null,
    '',
    `${facts.fences.maintained.totalDays} days from today, walked over the working calendar`,
    { emphasis: true },
  );

  const twin = facts.categorySiblings[0];
  if (twin) {
    push(
      `EARLIEST VIA ${twin.itemId}`,
      null,
      '',
      `${twin.description} — same item category, ${twin.leadTimeDays}-day lead time`,
      { emphasis: true },
    );
  }

  return lines;
}

function lowestBalance(facts: MaterialFacts, context: RunContext): number {
  let lowest = Number.POSITIVE_INFINITY;
  for (let day = 0; day <= context.horizonDays; day += 1) {
    lowest = Math.min(lowest, facts.plan.projectedBeforePlanned[day] as number);
  }
  return Number.isFinite(lowest) ? lowest : 0;
}

/**
 * The walk back up the bill of material.
 *
 * Each step is one factor, labelled with whether it is a decision somebody made
 * or a property of the process. A planner disputing a requirement needs to know
 * which of the two they are actually arguing with — a blend ratio is a
 * conversation with formulation, a stage yield is a conversation with the
 * plant, and they are not the same conversation.
 */
function buildChainWalk(facts: MaterialFacts, context: RunContext, order: PlannedOrderExplanation | null): ChainStep[] {
  const day = order ? order.requirementDay : Math.max(facts.firstBreachDay, 0);
  const target = facts.plan.grossRequirements[day] as number;
  if (target <= 0) return [];

  // Walk up: find the parents that consume this material, and their own
  // requirement in the bucket that produced this one.
  const bomsByComponent = new Map<string, BomLine[]>();
  for (const line of context.snapshot.boms) {
    if (line.isAlternate || line.plantId !== facts.plantId) continue;
    const list = bomsByComponent.get(line.componentItemId) ?? [];
    list.push(line);
    bomsByComponent.set(line.componentItemId, list);
  }

  const steps: ChainStep[] = [];
  let currentItem = facts.itemId;
  let currentQty = target;
  let guard = 0;

  while (guard < 6) {
    guard += 1;
    const parents = bomsByComponent.get(currentItem);
    if (!parents || parents.length === 0) break;
    // The largest contributor. Where several parents share a component the
    // panel names the dominant one rather than inventing a blended factor.
    const line = parents.reduce(
      (best, row) => (componentFactor(row) > componentFactor(best) ? row : best),
      parents[0] as BomLine,
    );
    const parentFacts = context.materials.get(planKey(line.parentItemId, facts.plantId));
    if (!parentFacts) break;

    const factor = componentFactor(line);
    if (factor <= 0) break;
    const parentQty = currentQty / factor;

    // One row per factor, not one per bill-of-material level.
    //
    // A blend ratio and a stage yield sit on the same line and are argued about
    // with completely different people: the ratio is a decision somebody made
    // about formulation, the yield is a property of the plant. Collapsing them
    // into a single multiplier is what makes a requirement impossible to
    // dispute — the planner cannot tell which half they disagree with.
    const scrap = line.componentScrapPct > 0 && line.componentScrapPct < 1 ? line.componentScrapPct : 0;
    const operationYield = line.operationYieldPct > 0 && line.operationYieldPct <= 1 ? line.operationYieldPct : 1;

    const afterRatio = parentQty * line.qtyPer;
    const afterYield = afterRatio / operationYield;

    const emitted: ChainStep[] = [];
    emitted.push({
      label: line.stepLabel ?? `${parentFacts.description} to ${currentItem}`,
      factorLabel: `${line.qtyPer} per unit of ${line.parentItemId}`,
      factor: line.qtyPer,
      operator: '×',
      kind: 'DECISION',
      resultQty: round(afterRatio),
      uom: facts.baseUom,
      itemId: currentItem,
    });
    if (operationYield < 1) {
      emitted.push({
        label: 'Operation yield at this stage',
        factorLabel: `${Math.round(operationYield * 1000) / 10}% of theoretical reaches the next stage`,
        factor: operationYield,
        operator: '÷',
        kind: 'PROCESS',
        resultQty: round(afterYield),
        uom: facts.baseUom,
        itemId: currentItem,
      });
    }
    if (scrap > 0) {
      emitted.push({
        label: 'Component scrap',
        factorLabel: `${Math.round(scrap * 1000) / 10}% of the material is lost`,
        factor: 1 + scrap,
        operator: '×',
        kind: 'PROCESS',
        resultQty: round(currentQty),
        uom: facts.baseUom,
        itemId: currentItem,
      });
    }
    steps.unshift(...emitted);

    currentItem = line.parentItemId;
    currentQty = parentQty;
  }

  if (steps.length > 0) {
    const top = context.materials.get(planKey(currentItem, facts.plantId));
    steps.unshift({
      label: top ? `${top.description} — the plan this all comes from` : currentItem,
      factorLabel: 'Independent demand',
      factor: 1,
      operator: '×',
      kind: 'DECISION',
      resultQty: round(currentQty),
      uom: top?.baseUom ?? facts.baseUom,
      itemId: currentItem,
    });
  }

  return steps;
}

function buildProvenance(facts: MaterialFacts, context: RunContext): ProvenanceRow[] {
  const master = facts.itemPlant;
  const ageDays = context.planningEpochDay - toEpochDay(master.paramsLastChangedOn);
  const row = (field: string, value: string): ProvenanceRow => ({
    field,
    value,
    system: 'SAP material master',
    lastChangedOn: master.paramsLastChangedOn,
    ageDays,
  });

  return [
    row('Lead time', master.leadTimeDays === null ? '—' : `${master.leadTimeDays} days`),
    row('Safety stock', master.safetyStock === null ? '—' : `${format(master.safetyStock)} ${facts.baseUom}`),
    row('Minimum order quantity', master.minLotSize === null ? '—' : `${format(master.minLotSize)} ${facts.baseUom}`),
    row('Rounding value', master.roundingValue === null ? '—' : `${format(master.roundingValue)} ${facts.baseUom}`),
    row('Lot-sizing rule', master.lotSizeRule ?? '—'),
    row(
      'Storage capacity',
      master.storageCapacity === null ? '—' : `${format(master.storageCapacity)} ${facts.baseUom}`,
    ),
  ];
}

export function receiptsFor(facts: MaterialFacts, context: RunContext): ReceiptView[] {
  const vendorById = new Map(context.snapshot.vendors.map((vendor) => [vendor.id, vendor.name]));
  const maintained = facts.itemPlant.leadTimeDays ?? 0;

  return context.snapshot.receiptHistory
    .filter((receipt) => receipt.itemId === facts.itemId && receipt.plantId === facts.plantId)
    .sort((a, b) => (a.receivedOn < b.receivedOn ? 1 : -1))
    .map((receipt) => {
      const totalDays =
        receipt.qaReleasedOn === null
          ? receipt.actualLeadTimeDays
          : toEpochDay(receipt.qaReleasedOn) - toEpochDay(receipt.orderedOn);
      return {
        poId: receipt.poId,
        vendorId: receipt.vendorId,
        vendorName: vendorById.get(receipt.vendorId) ?? null,
        orderedOn: receipt.orderedOn,
        promisedOn: receipt.promisedOn,
        acknowledgedOn: receipt.acknowledgedOn,
        dispatchedOn: receipt.dispatchedOn,
        receivedOn: receipt.receivedOn,
        qaReleasedOn: receipt.qaReleasedOn,
        orderedQty: Math.round(receipt.orderedQty),
        qty: Math.round(receipt.qty),
        fillRate: receipt.orderedQty > 0 ? receipt.qty / receipt.orderedQty : 1,
        totalDays,
        deviationDays: totalDays - maintained,
        reasonCode: receipt.reasonCode,
        reasonLabel: reasonLabel(receipt.reasonCode),
        matched: receipt.matchedLineId !== null,
      };
    });
}

// ---------------------------------------------------------------------------

function dayToDate(day: number, context: RunContext): string | null {
  return day === -1 ? null : fromEpochDay(context.planningEpochDay + day);
}

function round(value: number): number {
  return Math.abs(value) < 10 ? Math.round(value * 100) / 100 : Math.round(value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function format(value: number): string {
  return Math.round(value).toLocaleString('en-IN');
}
