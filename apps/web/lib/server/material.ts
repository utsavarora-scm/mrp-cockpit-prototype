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
  ACTION_GROUP_LABEL,
  componentFactor,
  bucketFlow,
  bucketLevel,
  bucketTrough,
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
  type LotSizingStep,
  type PlannedOrderExplanation,
  type RequirementExplanation,
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
  GridCell,
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
  // "The plan, if everything proposed is actually done" — including the orders
  // whose release date has passed. The feasible curve, which leaves those out,
  // is a different and equally necessary line; it drives the status word and
  // the breach detection rather than this series.
  const afterPlanned = bucketLevel(plan.projectedAvailable, buckets);
  const afterFeasible = bucketLevel(plan.projectedAvailableFeasible, buckets);
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
      balanceAfterPlaceable: round(afterFeasible[index] as number),
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
  const plannedReceipt = new Float64Array(horizon + 1);
  const lotSizingAddition = new Float64Array(horizon + 1);

  // Rows 10 and 11 are per *order*, so the quantity a rule added is charged
  // once against the requirement that triggered it. Lot sizing can split one
  // requirement across several receipts, and each slice carries the whole
  // `netRequirement`, so crediting every slice would report the rule's
  // contribution as many times as the order was cut.
  const chargedRequirement = new Set<PlannedOrderExplanation>();
  for (const order of explanations) {
    const receiptDay = toEpochDay(order.receiptDate) - context.planningEpochDay;
    if (receiptDay < 0 || receiptDay > horizon) continue;
    plannedReceipt[receiptDay] = (plannedReceipt[receiptDay] as number) + order.qty;

    const sameRequirement = explanations.find(
      (row) => row.requirementDay === order.requirementDay && chargedRequirement.has(row),
    );
    const alreadyCharged = sameRequirement !== undefined;
    chargedRequirement.add(order);
    const added = alreadyCharged ? order.qty : Math.max(0, order.qty - order.netRequirement);
    lotSizingAddition[receiptDay] = (lotSizingAddition[receiptDay] as number) + added;
  }

  const releaseCells = buildReleaseCells(explanations, context, buckets);

  const row = (
    key: string,
    label: string,
    series: ArrayLike<number>,
    aggregate: GridRow['aggregate'],
    options: Partial<Pick<GridRow, 'indent' | 'emphasis' | 'tone' | 'note' | 'cells'>> & { showTrough?: boolean } = {},
  ): GridRow => {
    const values = (aggregate === 'SUM' ? bucketFlow(series, buckets) : bucketLevel(series, buckets)).map(round);

    // A level row closes where it closes and dips where it dips, and netting
    // acted on the dip. Carried only where the two differ, so a daily bucket —
    // where they never can — stays quiet.
    const trough =
      options.showTrough && aggregate === 'LAST'
        ? bucketTrough(series, buckets)
            .map(round)
            .map((low, index) => (low < (values[index] as number) ? low : null))
        : undefined;

    return {
      key,
      label,
      indent: options.indent ?? 0,
      values,
      ...(trough && trough.some((low) => low !== null) ? { trough } : {}),
      aggregate,
      emphasis: options.emphasis ?? 'NONE',
      tone: options.tone ?? 'NEUTRAL',
      note: options.note ?? null,
      ...(options.cells ? { cells: options.cells } : {}),
    };
  };

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
      showTrough: true,
      emphasis: 'BALANCE',
      tone: 'NEGATIVE_IS_BAD',
      note: 'The honest position: stock and existing orders, with nothing the system is merely proposing.',
    }),
    row('safetyStock', 'Safety stock', safetyStockSeries, 'LAST', { emphasis: 'THRESHOLD' }),
    // The engine's own series, not a reconstruction from the orders it went on
    // to raise. Rebuilding it from recommendations loses every requirement lot
    // sizing consolidated and repeats every one it split.
    row('netRequirement', 'Net requirement', plan.netRequirements, 'SUM', {
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
    // Under the bucket the receipt is needed in, the week it had to be ordered.
    // A quantity keyed to the release bucket cannot say "W39 needed ordering in
    // W26", which is the single most useful thing this screen shows.
    row('release', 'Planned order release', new Float64Array(horizon + 1), 'SUM', {
      tone: 'PAST_IS_BAD',
      note: 'Offset back by the full lead-time chain. Red where the date has already passed.',
      cells: releaseCells,
    }),
    row('balanceAfter', 'Projected balance after planned orders', plan.projectedAvailable, 'LAST', {
      showTrough: true,
      emphasis: 'BALANCE',
      tone: 'NEGATIVE_IS_BAD',
      note: 'The plan, if every order it proposes is actually placed — including the ones whose release date has passed.',
    }),
    row('cover', 'Days of cover', plan.daysOfCover, 'LAST', {
      note: 'Forward-looking, at planned consumption.',
    }),
  ];
}

/**
 * The planned-order release row, as dates against the bucket that needs them.
 *
 * "Not one of the orders the engine just proposed can be placed" is the finding
 * the whole workbench exists to deliver, and it only reads as one when the week
 * an order had to be released sits directly under the week it is needed.
 */
function buildReleaseCells(
  explanations: PlannedOrderExplanation[],
  context: RunContext,
  buckets: Bucket[],
): GridCell[][] {
  const cells: GridCell[][] = buckets.map(() => []);

  for (const order of explanations) {
    const receiptDay = toEpochDay(order.receiptDate) - context.planningEpochDay;
    const index = buckets.findIndex((bucket) => receiptDay >= bucket.startDay && receiptDay <= bucket.endDay);
    if (index === -1) continue;

    const releaseDay = order.releaseDay;
    const daysLate = releaseDay < 0 ? -releaseDay : 0;
    (cells[index] as GridCell[]).push({
      text: weekLabel(order.releaseDate),
      tone: order.isReleaseInPast ? 'PAST' : 'NEUTRAL',
      releaseWeek: weekLabel(order.releaseDate),
      releaseDate: order.releaseDate,
      daysLate,
      qty: round(order.qty),
    });
  }

  return cells;
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
      changedBy: master.paramsLastChangedBy,
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
  // The parameter that decides how much a POQ material orders, and it appeared
  // on no screen. RM-30137's 800 MT came from a 27-day period of supply while
  // the explanation blamed a 386 MT minimum order quantity that had not bound.
  if (master.lotSizeRule === 'POQ') {
    add('periodsOfSupplyDays', 'Period of supply', master.periodsOfSupplyDays, {
      uom: 'days',
      editable: true,
      note: 'How much forward demand one order covers. Under POQ this, not the minimum order quantity, is usually what sets the quantity.',
    });
  }
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
  const releaseDay = first.releaseDay;
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
    daysLate: releaseDay < 0 ? -releaseDay : 0,
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
      // The label, not the enum. Harmless only because the queue happened to
      // read its own copy — a screen reading this one printed `CANNOT_ORDER`.
      groupLabel: ACTION_GROUP_LABEL[exception.group],
      score: exception.score,
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

/**
 * Which number is being explained.
 *
 * Explain opens from a cell, not from a screen. Without an anchor the panel can
 * only ever describe the first recommendation on the material, which is the
 * right answer to one of the fifteen rows and the wrong answer to the other
 * fourteen — and the standard the product is held to is that *every* number
 * traces to a source field in at most four clicks.
 */
export interface ExplainAnchor {
  /** A grid row key — `netRequirement`, `balanceBefore`, and so on. */
  row?: string;
  /**
   * The window the cell covers, as dates.
   *
   * Dates rather than a bucket index because the grid collapses daily buckets
   * into weeks on the client, which renumbers them — an index would explain a
   * Tuesday when the planner clicked a week.
   */
  fromDate?: string;
  toDate?: string;
}

/** The span of days one cell covers. */
interface CellWindow {
  startDay: number;
  endDay: number;
  label: string;
  week: string;
}

export function explain(
  scenarioId: string,
  itemId: string,
  plantId: string,
  anchor: ExplainAnchor = {},
): ExplainPayload | null {
  const context = runContext(scenarioId);
  const facts = context.materials.get(planKey(itemId, plantId));
  if (!facts) return null;

  const explanations = context.plan.orderExplanations.get(planKey(itemId, plantId)) ?? [];
  const window = windowOf(anchor, context);

  // The recommendation the anchored window is about, where there is one; the
  // material's first otherwise, which is what the screen-level button asks for.
  const anchoredOrder =
    window === undefined
      ? null
      : (explanations.find((row) => {
          const day = toEpochDay(row.receiptDate) - context.planningEpochDay;
          return day >= window.startDay && day <= window.endDay;
        }) ?? null);

  const order = anchoredOrder ?? explanations[0] ?? null;
  const biteDay = facts.firstStockoutDay !== -1 ? facts.firstStockoutDay : facts.firstBreachDay;

  return {
    itemId,
    plantId,
    anchor: window === undefined ? null : { row: anchor.row ?? null, label: window.label, week: window.week },
    sentence: buildSentence(facts, context, order, biteDay),
    arithmetic:
      window === undefined || anchor.row === undefined
        ? buildArithmetic(facts, context, order)
        : buildCellArithmetic(facts, context, anchor.row, window, anchoredOrder),
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

  // What actually bound, from the sizing trace — not a guess.
  //
  // This clause used to name the minimum order quantity whenever any lot sizing
  // had happened and a `minLotSize` merely existed. On a POQ material that read
  // "the order is 800 MT because the minimum order quantity is 386 MT", which is
  // wrong twice: 386 cannot produce 800, and the MOQ had not bound at all.
  const shortage = requirementFor(context, facts, order);
  const drivers = (shortage?.sizingTrace ?? []).filter(
    (step) => step.kind !== 'RULE' && (step.changedQuantity || step.changedShape),
  );
  const ruleStep = (shortage?.sizingTrace ?? []).find((step) => step.kind === 'RULE');
  if (ruleStep?.changedQuantity) drivers.unshift(ruleStep);

  const lotClause =
    shortage && drivers.length > 0
      ? ` The order is ${format(order.qty)} ${uom} — not ${format(order.netRequirement)} ${uom} — because of ${joinPhrases(drivers.map(describeStep))}.`
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

/** The shortage an order serves, carrying the sizing trace the run recorded. */
function requirementFor(
  context: RunContext,
  facts: MaterialFacts,
  order: PlannedOrderExplanation,
): RequirementExplanation | null {
  const requirements = context.plan.requirementExplanations.get(planKey(facts.itemId, facts.plantId)) ?? [];
  return requirements.find((row) => row.requirementId === order.requirementId) ?? null;
}

/** How a step reads in a sentence, from what it did rather than from its name. */
function describeStep(step: LotSizingStep): string {
  switch (step.kind) {
    case 'RULE':
      return step.source.toLowerCase();
    case 'SCRAP':
      return `${Math.round((step.parameter ?? 0) * 100)}% scrap`;
    case 'VENDOR_MOQ':
      return `a vendor minimum of ${format(step.parameter ?? 0)}`;
    case 'MIN_LOT':
      return `a minimum order quantity of ${format(step.parameter ?? 0)}`;
    case 'VENDOR_INCREMENT':
      return `a vendor increment of ${format(step.parameter ?? 0)}`;
    case 'ROUNDING':
      return `a rounding value of ${format(step.parameter ?? 0)}`;
    case 'MAX_LOT_SPLIT':
      return `a maximum lot of ${format(step.parameter ?? 0)}, which splits it into ${step.sliceQtys?.length ?? 1} orders`;
  }
}

/** "a, b and c" — so a compound cause reads as one. */
function joinPhrases(phrases: string[]): string {
  if (phrases.length <= 1) return phrases[0] ?? '';
  return `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
}

/** The label a trace row carries in the explain column. */
function labelStep(step: LotSizingStep, uom: string): string {
  switch (step.kind) {
    case 'RULE':
      return step.source;
    case 'SCRAP':
      return `Scrap allowance ${Math.round((step.parameter ?? 0) * 100)}%`;
    case 'VENDOR_MOQ':
      return `Vendor minimum order quantity ${format(step.parameter ?? 0)} ${uom}`;
    case 'MIN_LOT':
      return `Minimum order quantity ${format(step.parameter ?? 0)} ${uom}`;
    case 'VENDOR_INCREMENT':
      return `Vendor increment ${format(step.parameter ?? 0)} ${uom}`;
    case 'ROUNDING':
      return `Rounding value ${format(step.parameter ?? 0)} ${uom}`;
    case 'MAX_LOT_SPLIT':
      return `Maximum lot ${format(step.parameter ?? 0)} ${uom}`;
  }
}

/**
 * The arithmetic, one line per operand, each with its own provenance.
 *
 * Displayed components sum to displayed totals. Rounding and lot sizing are
 * their own lines, never absorbed into a figure that then does not foot.
 */
/**
 * The days an anchor covers, clamped to the horizon.
 *
 * A single date is one day; a range is the week the grid was showing. Absent or
 * unparseable, there is no anchor and the panel falls back to the material's
 * first recommendation.
 */
function windowOf(anchor: ExplainAnchor, context: RunContext): CellWindow | undefined {
  if (!anchor.fromDate) return undefined;
  const startDay = toEpochDay(anchor.fromDate) - context.planningEpochDay;
  if (!Number.isFinite(startDay)) return undefined;

  const rawEnd = anchor.toDate ? toEpochDay(anchor.toDate) - context.planningEpochDay : startDay;
  const endDay = Math.min(context.horizonDays, Math.max(startDay, Number.isFinite(rawEnd) ? rawEnd : startDay));
  if (startDay < 0 || startDay > context.horizonDays) return undefined;

  const week = weekLabel(anchor.fromDate);
  return { startDay, endDay, label: endDay > startDay ? week : anchor.fromDate, week };
}

/**
 * The arithmetic behind one cell.
 *
 * Each row is a different question, so each gets its own working rather than
 * the material's first recommendation dressed up. A balance is the roll that
 * produced it; a requirement is the explosion that produced it; a release date
 * is the chain it was walked back over. The rows that *are* the recommendation
 * fall through to the full working below.
 */
function buildCellArithmetic(
  facts: MaterialFacts,
  context: RunContext,
  row: string,
  bucket: CellWindow,
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

  const flow = (series: Float64Array): number => {
    let total = 0;
    for (let day = bucket.startDay; day <= bucket.endDay; day += 1) total += series[day] as number;
    return total;
  };
  const closing = (series: Float64Array): number => series[bucket.endDay] as number;
  const opening = (series: Float64Array): number =>
    bucket.startDay === 0 ? facts.plan.openingStock : (series[bucket.startDay - 1] as number);

  // `W39`, not `W39 (W39)` — the label and the week are the same string on a
  // weekly cell, and only differ on a daily one.
  const where = bucket.label === bucket.week ? bucket.week : `${bucket.label} (${bucket.week})`;

  switch (row) {
    case 'gross':
    case 'independent':
    case 'dependent': {
      const independent = flow(facts.plan.underlyingDemand);
      const gross = flow(facts.plan.grossRequirements);
      push(`Independent demand, ${where}`, independent, '', 'Production schedule and customer orders');
      push('From bill-of-material explosion', gross - independent, '+', 'Aggregated across every parent', {
        expandable: true,
      });
      push('Gross requirement', gross, '=', null, { emphasis: true });
      return lines;
    }

    case 'confirmed':
    case 'committed':
    case 'quarantine': {
      push(`Acknowledged by the vendor, ${where}`, flow(facts.plan.confirmedReceipts), '', 'Tier 1 — confirmed');
      push('Ordered, not acknowledged', flow(facts.plan.committedReceipts), '+', 'Tier 2 — committed');
      push('Scheduled receipts', flow(facts.plan.scheduledReceipts), '=', null, { emphasis: true });
      push('of which clearing quality inspection', flow(facts.plan.qaReleases), '', 'On site, and not yet stock');
      return lines;
    }

    case 'balanceBefore':
    case 'balanceAfter': {
      const after = row === 'balanceAfter';
      const series = after ? facts.plan.projectedAvailable : facts.plan.projectedBeforePlanned;
      push(`Balance entering ${bucket.week}`, opening(series), '', 'Rolled from opening stock', { expandable: true });
      push('Scheduled receipts', flow(facts.plan.scheduledReceipts), '+', 'Open purchase order schedule lines');
      if (after) push('Planned order receipts', flow(facts.plan.plannedReceipts), '+', 'Orders this run proposes');
      push('Gross requirement', flow(facts.plan.grossRequirements), '−', 'Demand in this bucket', {
        expandable: true,
      });
      push(`Balance closing ${bucket.week}`, closing(series), '=', null, { emphasis: true });
      if (!after) {
        push(
          'Safety stock',
          facts.plan.safetyStock,
          '',
          `SAP material master, set ${facts.itemPlant.paramsLastChangedOn}`,
        );
      }
      return lines;
    }

    case 'safetyStock': {
      push(
        'Safety stock',
        facts.plan.safetyStock,
        '',
        `SAP material master, set ${facts.itemPlant.paramsLastChangedOn}`,
      );
      push('Maintained days of cover', facts.itemPlant.maintainedStockDays, '', 'Material master');
      push('Mean daily demand', facts.dailyDemandMean, '', 'Across the planning horizon');
      return lines;
    }

    case 'cover': {
      push(`Balance closing ${bucket.week}`, closing(facts.plan.projectedAvailable), '', 'Rolled from opening stock');
      push('Mean daily demand', facts.dailyDemandMean, '÷', 'Forward consumption at the planned rate');
      push('Days of cover', closing(facts.plan.daysOfCover), '=', null, { emphasis: true });
      return lines;
    }

    case 'netRequirement': {
      const gross = flow(facts.plan.grossRequirements);
      const receipts = flow(facts.plan.scheduledReceipts);
      const before = opening(facts.plan.projectedBeforePlanned);
      push(`Gross requirement, ${where}`, gross, '', 'Bill-of-material explosion', { expandable: true });
      push(
        'Safety stock',
        facts.plan.safetyStock,
        '+',
        `SAP material master, set ${facts.itemPlant.paramsLastChangedOn}`,
      );
      push('Required position', gross + facts.plan.safetyStock, '=', null, { emphasis: true });
      push(`Balance entering ${bucket.week}`, before, '', 'Rolled from opening stock', { expandable: true });
      push('Scheduled receipts', receipts, '+', 'Open purchase order schedule lines');
      push('Available position', before + receipts, '=', null, { emphasis: true });
      // Stated, not claimed as this block's difference. Over a week the engine
      // walks day by day and tops the balance up as it goes, so the bucket's
      // requirement is the sum of the daily shortfalls rather than the gap
      // between these two totals — and printing an equals sign over that would
      // be exactly the kind of arithmetic this panel exists to avoid.
      push('NET REQUIREMENT', flow(facts.plan.netRequirements), '', 'Summed from the daily netting walk', {
        emphasis: true,
      });
      return lines;
    }

    default:
      // Rows 10 to 12 *are* the recommendation, so they get its full working.
      return buildArithmetic(facts, context, order);
  }
}

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
    options: { emphasis?: boolean; expandable?: boolean; precise?: boolean } = {},
  ): void => {
    lines.push({
      label,
      value: value === null ? null : options.precise ? round2(value) : round(value),
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

  push(`Gross requirement, ${requirementDate}`, requirement, '', 'Bill-of-material explosion', {
    expandable: true,
    precise: true,
  });
  push('Safety stock', order.threshold, '+', `SAP material master, set ${facts.itemPlant.paramsLastChangedOn}`, {
    precise: true,
  });
  const required = requirement + order.threshold;
  push('Required position', required, '=', null, { emphasis: true, precise: true });

  // The receipts actually landing that day, not a literal zero. Every material
  // with an inbound delivery in its requirement bucket printed `+0` here, under
  // a heading promising the components sum to the total.
  //
  // And the balance is the one *entering* the day, which is what the label has
  // always said and not what it used to show: `balanceBefore` on the
  // explanation is the balance netting was topping up *from*, after the day's
  // demand and receipts had already moved it.
  const receipts = facts.plan.scheduledReceipts[order.requirementDay] as number;
  const entering = order.balanceBefore + requirement - receipts;
  push(`Balance entering ${requirementDate}`, entering, '', 'Rolled from opening stock', {
    expandable: true,
    precise: true,
  });
  push('Scheduled receipts that day', receipts, '+', 'Open purchase order schedule lines', { precise: true });
  const available = entering + receipts;
  push('Available position', available, '=', null, { emphasis: true, precise: true });

  // Restated as its own subtraction rather than asserted. A line that claims to
  // be an equals sign has to be one.
  push('Required position', required, '', 'From above', { precise: true });
  push('Available position', available, '−', 'From above', { precise: true });
  push('NET REQUIREMENT', order.netRequirement, '=', 'Required position less available position', {
    emphasis: true,
    precise: true,
  });

  // Every adjustment, as the run recorded it — not re-derived here.
  //
  // Re-deriving these from `netRequirement` alone is what printed
  // `1 + 385 + 14` under a total of `800`: it modelled a minimum order quantity
  // and a rounding value, and knew nothing about the POQ look-ahead that had
  // actually produced the number, nor about scrap, vendor increments or a
  // max-lot split. The trace is the only account of the quantity, so it is the
  // one shown.
  const shortage = requirementFor(context, facts, order);
  const trace = shortage?.sizingTrace ?? [];

  // Deltas are the difference between *rounded* running totals, not the rounded
  // difference. Rounding each contribution independently is what let a column
  // of 0.64 + 385 + 14 sit under a total of 400: the 385 was really 385.36, and
  // the third of a unit it lost had nowhere to go. Taken this way the rows foot
  // exactly, whatever precision they are shown at.
  for (const step of trace) {
    if (step.kind === 'MAX_LOT_SPLIT') continue;
    const delta = round2(step.afterQty) - round2(step.beforeQty);

    if (step.kind === 'RULE') {
      // The rule's own contribution, above the ceilings it is then subject to.
      if (delta !== 0) push(labelStep(step, uom), delta, '+', step.source, { precise: true });
      continue;
    }

    // "Binding" and "changed the quantity" are not the same thing. Where a
    // vendor increment and a material rounding value are reconciled together,
    // both constrain the answer and only one moves it.
    const source = delta !== 0 ? 'Binding' : step.binding ? 'Binding — met by the reconciled quantity' : 'Not binding';
    push(labelStep(step, uom), delta === 0 ? null : delta, '+', source, { precise: true });
  }

  push('PLANNED ORDER RECEIPT', shortage?.finalOrderQuantity ?? order.qty, '=', null, {
    emphasis: true,
    precise: true,
  });

  // A split is a change of shape, not of quantity, so it sits under the total
  // rather than inside the sum it would otherwise break.
  const split = trace.find((step) => step.kind === 'MAX_LOT_SPLIT' && step.changedShape);
  if (split) {
    push(
      `Released as ${split.sliceQtys?.length ?? 0} orders — maximum lot ${format(split.parameter ?? 0)} ${uom}`,
      null,
      '',
      (split.sliceQtys ?? []).map((slice) => format(slice)).join(' + '),
    );
  }

  const lotSizing = Math.max(0, (shortage?.finalOrderQuantity ?? order.qty) - order.netRequirement);
  // Under the total, the way row 11 of the grid sits under row 10. Above it,
  // this restatement broke the running sum it was standing in the middle of.
  if (lotSizing > 0) {
    push('of which added by a rule rather than by demand', lotSizing, '', 'Need and rule are never merged', {
      precise: true,
    });
  }

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
    changedBy: master.paramsLastChangedBy,
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

/**
 * Two places, whatever the magnitude.
 *
 * `round` drops to whole units above 10, which is right for a balance and wrong
 * for a column that has to add up: a 385.36 contribution printed as 385 leaves
 * the total short by a third of a unit and the planner looking at arithmetic
 * that does not work.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function format(value: number): string {
  return Math.round(value).toLocaleString('en-IN');
}
