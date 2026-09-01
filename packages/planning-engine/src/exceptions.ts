/**
 * Exceptions.
 *
 * Not a separate rules engine. Every exception here is a named condition on a
 * number the planning run already computed, which is why every one of them can
 * explain itself down to its operands. A rules engine sitting beside the plan
 * is how a system ends up raising alerts the plan disagrees with.
 *
 * Two structural rules from the confidence tiers are enforced here and nowhere
 * else, because this is the only place they change an outcome:
 *
 *   - **A safety-stock breach avoided only by a tier 3 receipt is still a
 *     breach.** Nothing has been ordered. It is raised.
 *   - **A breach avoided only by a tier 2 receipt is raised as supply
 *     unconfirmed**, naming the line, the vendor and the quantity at risk.
 *
 * Grouping is by *what the planner would do about it*, not by exception type,
 * because a planner's morning is a sequence of phone calls and not a taxonomy.
 */

import type { ItemPlant, ItemPlantPlan, ItemVendor, PlannedOrderExplanation } from '@repo/domain';

import type { Fence, FenceSet } from './fences';

export type ExceptionCode =
  | 'PROJECTED_STOCKOUT'
  | 'SAFETY_STOCK_BREACH'
  | 'UNREACHABLE_REQUIREMENT'
  | 'ALTERNATE_SOURCE_REACHES'
  | 'PULL_IN'
  | 'PUSH_OUT'
  | 'PAST_DUE'
  | 'UNCONFIRMED_SUPPLY'
  | 'LEAD_TIME_DRIFT'
  | 'EXCESS_RISK'
  | 'HORIZONTAL_BLOCK'
  | 'MASTER_DATA_GAP';

/**
 * What a planner would actually do about it. This is the grouping the queue
 * uses; the code above is the diagnosis, and this is the appointment.
 */
export type ActionGroup =
  | 'CANNOT_ORDER'
  | 'SWITCH_SOURCE'
  | 'MOVE_EXISTING_ORDER'
  | 'ORDER_NOW'
  | 'GET_CONFIRMATION'
  | 'FIX_DATA'
  | 'REDUCE_COVER';

export const ACTION_GROUP_LABEL: Record<ActionGroup, string> = {
  CANNOT_ORDER: 'Cannot be fixed by ordering',
  SWITCH_SOURCE: 'Fix by switching source',
  MOVE_EXISTING_ORDER: 'Fix by moving an existing order',
  ORDER_NOW: 'Fix by placing an order this week',
  GET_CONFIRMATION: 'Fix by getting a confirmation',
  FIX_DATA: 'Fix the data',
  REDUCE_COVER: 'Fix by reducing cover',
};

export const ACTION_GROUP_NOTE: Record<ActionGroup, string> = {
  CANNOT_ORDER: 'Inside the lead-time fence. Expedite, substitute or resequence — a purchase order cannot reach it.',
  SWITCH_SOURCE: 'Another material code in the same item category has a short enough lead time to reach this.',
  MOVE_EXISTING_ORDER: 'The supply exists. It is on the wrong date.',
  ORDER_NOW: 'The last responsible order date is this week.',
  GET_CONFIRMATION: 'Supply nobody has acknowledged is holding up a critical week.',
  FIX_DATA: 'A missing or drifted parameter. Fix it before trusting the line.',
  REDUCE_COVER: 'More cover than the norm or the shelf life supports.',
};

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/** One operand of the arithmetic behind an exception. Every number has a source. */
export interface Operand {
  label: string;
  value: number;
  /** Where it came from — a system field, or the calculation that produced it. */
  source: string;
}

export interface PlanningException {
  id: string;
  code: ExceptionCode;
  group: ActionGroup;
  severity: Severity;
  itemId: string;
  plantId: string;
  /** One sentence, before any table. Deterministic — no narrative generation. */
  headline: string;
  /** Day offset of the bucket it bites in. */
  biteDay: number;
  /** Quantity at stake, in the material's base unit. */
  qtyAtStake: number;
  /** Days of cover at stake. */
  daysAtStake: number;
  /** Value at stake, at standard cost. */
  valueAtStake: number;
  /** True when no purchase order placed today can reach it. */
  reachableByOrdering: boolean;
  /** The arithmetic, one operand per line. */
  operands: Operand[];
  /** What the planner can actually do, most useful first. */
  actions: string[];
  /** Ranking score. Higher bites sooner, harder and more expensively. */
  score: number;
}

/** Everything an exception needs, assembled by the caller from one run. */
export interface MaterialContext {
  itemId: string;
  plantId: string;
  description: string;
  baseUom: string;
  standardCost: number;
  itemPlant: ItemPlant;
  vendor: ItemVendor | null;
  plan: ItemPlantPlan;
  fences: FenceSet;
  orders: PlannedOrderExplanation[];
  dailyDemandMean: number;
  /** Mean total lead time from matched receipts, where there are enough. */
  observedLeadTimeDays: number | null;
  /** Days of cover the maintained norm targets, where one is maintained. */
  maxNormDays: number | null;
  shelfLifeDays: number | null;
  /** Open delivery lines, already tiered. */
  openLines: OpenLineContext[];
  /** Other material codes carrying the same chemistry. */
  categorySiblings: CategorySibling[];
  /** Components sharing a parent with this one — the horizontal check. */
  horizontalSiblings: HorizontalSibling[];
}

export interface OpenLineContext {
  orderId: string;
  line: number;
  qty: number;
  /** Day offset of the expected receipt. Negative when the date has passed. */
  expectedDay: number;
  expectedDate: string;
  tier: 1 | 2 | 3;
  vendorId: string | null;
  vendorName: string | null;
  hasGrn: boolean;
}

export interface CategorySibling {
  itemId: string;
  description: string;
  /** Earliest day a newly placed order on *this* code could be received. */
  earliestReceiptDay: number;
  leadTimeDays: number;
}

export interface HorizontalSibling {
  itemId: string;
  description: string;
  parentItemId: string;
  /** First day this sibling itself breaches, or null where it does not. */
  firstBreachDay: number | null;
  /** True when the sibling cannot be reached by ordering either. */
  unreachable: boolean;
}

/** |measured − maintained| ÷ maintained above this reads as drift worth acting on. */
export const LEAD_TIME_DRIFT_THRESHOLD = 0.2;

/** Cover above this multiple of the maximum norm reads as excess. */
const EXCESS_MULTIPLE = 1.1;

/** A receipt this far past its date with no goods receipt is a live problem. */
const PAST_DUE_GRACE_DAYS = 2;

// ---------------------------------------------------------------------------

export function raiseExceptions(context: MaterialContext, horizonDays: number): PlanningException[] {
  const raised: PlanningException[] = [];
  const { plan, itemPlant, fences } = context;
  const safetyStock = plan.safetyStock;
  const fence = fences.maintained;

  const emit = (
    partial: Omit<PlanningException, 'id' | 'score' | 'valueAtStake' | 'itemId' | 'plantId' | 'daysAtStake'> & {
      daysAtStake?: number;
    }
  ): void => {
    const daysAtStake =
      partial.daysAtStake ?? (context.dailyDemandMean > 0 ? partial.qtyAtStake / context.dailyDemandMean : 0);
    const exception: PlanningException = {
      ...partial,
      daysAtStake,
      id: `${partial.code}-${context.itemId}-${context.plantId}-${partial.biteDay}`,
      itemId: context.itemId,
      plantId: context.plantId,
      valueAtStake: partial.qtyAtStake * context.standardCost,
      score: 0,
    };
    exception.score = scoreOf(exception, horizonDays);
    raised.push(exception);
  };

  // ---- The balance that survives doing everything still possible -----------
  //
  // Orders whose release date has already passed are excluded from this series
  // by construction, which is what makes "a breach avoided only by a receipt
  // nobody can still order is still a breach" true by arithmetic rather than by
  // a rule somebody has to remember. What is left is the exposure that no
  // amount of ordering can close.
  let firstBreachDay = -1;
  let firstStockoutDay = -1;
  let worstBreachQty = 0;
  let worstStockoutQty = 0;

  for (let day = 0; day <= horizonDays; day += 1) {
    const balance = plan.projectedAvailableFeasible[day] as number;
    if (balance < 0) {
      if (firstStockoutDay === -1) firstStockoutDay = day;
      worstStockoutQty = Math.max(worstStockoutQty, -balance);
    } else if (balance < safetyStock) {
      if (firstBreachDay === -1) firstBreachDay = day;
      worstBreachQty = Math.max(worstBreachQty, safetyStock - balance);
    }
  }
  if (firstStockoutDay !== -1 && (firstBreachDay === -1 || firstStockoutDay < firstBreachDay)) {
    firstBreachDay = firstStockoutDay;
  }

  const biteDay = firstStockoutDay !== -1 ? firstStockoutDay : firstBreachDay;
  const reachable = biteDay === -1 ? true : biteDay >= fence.earliestReceiptDay;

  // ---- Projected stock-out -------------------------------------------------
  if (firstStockoutDay !== -1) {
    emit({
      code: 'PROJECTED_STOCKOUT',
      group: reachable ? 'ORDER_NOW' : 'CANNOT_ORDER',
      severity: 'CRITICAL',
      headline: `${context.description} runs out, and stays out: the balance reaches ${round(-worstStockoutQty)} ${context.baseUom} at its worst, even after every order that can still be placed.`,
      biteDay: firstStockoutDay,
      qtyAtStake: worstStockoutQty,
      reachableByOrdering: firstStockoutDay >= fence.earliestReceiptDay,
      operands: [
        { label: 'Opening stock', value: plan.openingStock, source: 'Stock on hand, unrestricted' },
        { label: 'Safety stock', value: safetyStock, source: 'Material master' },
        {
          label: 'Worst balance',
          value: -worstStockoutQty,
          source: 'Projected balance after every order that can still be placed',
        },
        { label: 'Earliest a new order could land', value: fence.earliestReceiptDay, source: 'Lead-time chain' },
      ],
      actions: actionsFor(context, firstStockoutDay, fence),
    });
  } else if (firstBreachDay !== -1) {
    // ---- Safety-stock breach ----------------------------------------------
    emit({
      code: 'SAFETY_STOCK_BREACH',
      group: reachable ? 'ORDER_NOW' : 'CANNOT_ORDER',
      severity: firstBreachDay <= fence.earliestReceiptDay ? 'HIGH' : 'MEDIUM',
      headline: `${context.description} falls ${round(worstBreachQty)} ${context.baseUom} into its safety stock, even after every order that can still be placed.`,
      biteDay: firstBreachDay,
      qtyAtStake: worstBreachQty,
      reachableByOrdering: reachable,
      operands: [
        { label: 'Safety stock', value: safetyStock, source: 'Material master' },
        {
          label: 'Balance at the breach',
          value: plan.projectedBeforePlanned[firstBreachDay] as number,
          source: 'Projected balance before planned orders',
        },
        { label: 'Shortfall', value: worstBreachQty, source: 'Safety stock less the balance' },
      ],
      actions: actionsFor(context, firstBreachDay, fence),
    });
  }

  // ---- Unreachable requirement --------------------------------------------
  //
  // The single most useful thing this can put in front of a planner, and no
  // screen they have today shows it: the order the system is asking for needed
  // placing weeks ago, and cannot now be placed at all.
  const unplaceable = context.orders.filter((order) => order.isReleaseInPast);
  if (unplaceable.length > 0) {
    const first = unplaceable[0] as PlannedOrderExplanation;
    const totalQty = unplaceable.reduce((sum, order) => sum + order.qty, 0);
    const weeksLate = Math.round((0 - dayOffsetOfRelease(first)) / 7);
    emit({
      code: 'UNREACHABLE_REQUIREMENT',
      group: 'CANNOT_ORDER',
      severity: 'CRITICAL',
      headline: `${unplaceable.length} proposed ${unplaceable.length === 1 ? 'order' : 'orders'} for ${context.description} needed releasing before today — the first ${weeksLate} ${weeksLate === 1 ? 'week' : 'weeks'} ago. No purchase order placed now can reach ${unplaceable.length === 1 ? 'it' : 'them'}.`,
      biteDay: first.requirementDay,
      qtyAtStake: totalQty,
      reachableByOrdering: false,
      operands: [
        { label: 'Quantity proposed', value: totalQty, source: 'Planned orders from this run' },
        { label: 'Lead time', value: first.effectiveLeadTimeDays, source: 'Material master' },
        {
          label: 'Total offset including receipt and release',
          value: first.totalOffsetDays,
          source: 'Lead-time chain',
        },
        { label: 'Earliest a new order could land', value: fence.earliestReceiptDay, source: 'Lead-time chain' },
      ],
      actions: actionsFor(context, first.requirementDay, fence),
    });
  }

  // ---- Alternate source reaches it ----------------------------------------
  if (biteDay !== -1 && !reachable) {
    const reachableSibling = context.categorySiblings
      .filter(
        (sibling) => sibling.earliestReceiptDay <= biteDay || sibling.earliestReceiptDay < fence.earliestReceiptDay
      )
      .sort((a, b) => a.earliestReceiptDay - b.earliestReceiptDay)[0];

    if (reachableSibling) {
      const weeksEarlier = Math.round((fence.earliestReceiptDay - reachableSibling.earliestReceiptDay) / 7);
      emit({
        code: 'ALTERNATE_SOURCE_REACHES',
        group: 'SWITCH_SOURCE',
        severity: 'HIGH',
        headline: `${reachableSibling.description} carries the same chemistry on a ${reachableSibling.leadTimeDays}-day lead time and lands ${weeksEarlier} ${weeksEarlier === 1 ? 'week' : 'weeks'} earlier than ${context.description} can.`,
        biteDay,
        qtyAtStake: firstStockoutDay !== -1 ? worstStockoutQty : worstBreachQty,
        reachableByOrdering: true,
        operands: [
          { label: 'This code, earliest receipt', value: fence.earliestReceiptDay, source: 'Lead-time chain' },
          {
            label: 'Alternate code, earliest receipt',
            value: reachableSibling.earliestReceiptDay,
            source: `Lead-time chain for ${reachableSibling.itemId}`,
          },
          { label: 'Exposure first bites', value: biteDay, source: 'Projected balance after placeable orders' },
        ],
        actions: [
          `Order ${reachableSibling.itemId} for the weeks it can cover, and take the rest as residual.`,
          'Check the source split — this lever is what the 60:40 is meant to be for.',
        ],
      });
    }
  }

  // ---- Unconfirmed supply propping up a critical week ---------------------
  //
  // The rosy picture, made structural: if removing the unacknowledged lines
  // moves the first breach earlier, the plan survives on a line nobody has
  // agreed to.
  let confirmedBreachDay = -1;
  for (let day = 0; day <= horizonDays; day += 1) {
    if ((plan.projectedConfirmedOnly[day] as number) < safetyStock) {
      confirmedBreachDay = day;
      break;
    }
  }
  if (confirmedBreachDay !== -1 && (firstBreachDay === -1 || confirmedBreachDay < firstBreachDay)) {
    const propping = context.openLines
      .filter((line) => line.tier === 2 && line.expectedDay >= confirmedBreachDay && line.expectedDay <= horizonDays)
      .sort((a, b) => a.expectedDay - b.expectedDay);
    const line = propping[0];
    if (line) {
      const qty = propping.reduce((sum, row) => sum + row.qty, 0);
      emit({
        code: 'UNCONFIRMED_SUPPLY',
        group: 'GET_CONFIRMATION',
        severity: 'HIGH',
        headline: `${context.description} only stays above its safety stock because of ${round(qty)} ${context.baseUom} nobody has acknowledged — order ${line.orderId} line ${line.line}, due ${line.expectedDate}.`,
        biteDay: confirmedBreachDay,
        qtyAtStake: qty,
        reachableByOrdering: confirmedBreachDay >= fence.earliestReceiptDay,
        operands: [
          {
            label: 'Unacknowledged quantity',
            value: qty,
            source: 'Open order schedule lines with no vendor acknowledgement',
          },
          { label: 'Breach without it', value: confirmedBreachDay, source: 'Balance on acknowledged supply only' },
          { label: 'Breach with it', value: firstBreachDay, source: 'Balance after placeable orders' },
        ],
        actions: [
          `Get ${line.vendorName ?? line.vendorId ?? 'the vendor'} to acknowledge ${line.orderId} line ${line.line}.`,
          'Plan the week without it until they do.',
        ],
      });
    }
  }

  // ---- Past due ------------------------------------------------------------
  const pastDue = context.openLines.filter((line) => line.expectedDay < -PAST_DUE_GRACE_DAYS && !line.hasGrn);
  if (pastDue.length > 0) {
    const qty = pastDue.reduce((sum, line) => sum + line.qty, 0);
    const worst = pastDue.reduce((min, line) => Math.min(min, line.expectedDay), 0);
    emit({
      code: 'PAST_DUE',
      group: 'MOVE_EXISTING_ORDER',
      severity: 'HIGH',
      headline: `${round(qty)} ${context.baseUom} of ${context.description} is past its date with no goods receipt — the oldest by ${-worst} days.`,
      biteDay: 0,
      qtyAtStake: qty,
      reachableByOrdering: false,
      operands: [
        { label: 'Quantity overdue', value: qty, source: 'Open schedule lines past their expected date' },
        { label: 'Days overdue, worst line', value: -worst, source: 'Expected date against the planning date' },
      ],
      actions: [
        `Trace ${pastDue.map((line) => `${line.orderId}/${line.line}`).join(', ')}.`,
        'Re-date the line so the plan stops counting on it.',
      ],
    });
  }

  // ---- Pull-in and push-out ------------------------------------------------
  if (biteDay !== -1) {
    const late = context.openLines
      .filter((line) => line.expectedDay > biteDay && line.expectedDay <= horizonDays && line.tier <= 2)
      .sort((a, b) => a.expectedDay - b.expectedDay)[0];
    if (late) {
      emit({
        code: 'PULL_IN',
        group: 'MOVE_EXISTING_ORDER',
        severity: 'MEDIUM',
        headline: `${round(late.qty)} ${context.baseUom} on ${late.orderId} line ${late.line} lands ${late.expectedDay - biteDay} days after the position needs it.`,
        biteDay,
        qtyAtStake: late.qty,
        reachableByOrdering: true,
        operands: [
          { label: 'Needed by day', value: biteDay, source: 'Projected balance after placeable orders' },
          {
            label: 'Currently expected day',
            value: late.expectedDay,
            source: `Schedule line ${late.orderId}/${late.line}`,
          },
          { label: 'Gap', value: late.expectedDay - biteDay, source: 'Expected less needed' },
        ],
        actions: [
          `Ask ${late.vendorName ?? late.vendorId ?? 'the vendor'} to advance ${late.orderId} line ${late.line}.`,
        ],
      });
    }
  }

  // ---- Excess and obsolescence --------------------------------------------
  const closingCover = plan.daysOfCover[0] as number;
  if (context.maxNormDays !== null && closingCover > context.maxNormDays * EXCESS_MULTIPLE) {
    const excessQty = (closingCover - context.maxNormDays) * context.dailyDemandMean;
    emit({
      code: 'EXCESS_RISK',
      group: 'REDUCE_COVER',
      severity: 'LOW',
      headline: `${context.description} holds ${Math.round(closingCover)} days of cover against a maximum norm of ${context.maxNormDays}.`,
      biteDay: 0,
      qtyAtStake: Math.max(0, excessQty),
      daysAtStake: closingCover - context.maxNormDays,
      reachableByOrdering: true,
      operands: [
        { label: 'Days of cover today', value: closingCover, source: 'Balance against forward consumption' },
        { label: 'Maximum norm, days', value: context.maxNormDays, source: 'Material master' },
      ],
      actions: ['Push out or cancel the next inbound line.', 'Redeploy to another plant if the network allows it.'],
    });
  } else if (context.shelfLifeDays !== null && closingCover > context.shelfLifeDays * 0.75) {
    emit({
      code: 'EXCESS_RISK',
      group: 'REDUCE_COVER',
      severity: 'MEDIUM',
      headline: `${context.description} holds ${Math.round(closingCover)} days of cover against a ${context.shelfLifeDays}-day shelf life.`,
      biteDay: 0,
      qtyAtStake: plan.openingStock * 0.25,
      daysAtStake: closingCover,
      reachableByOrdering: true,
      operands: [
        { label: 'Days of cover today', value: closingCover, source: 'Balance against forward consumption' },
        { label: 'Shelf life, days', value: context.shelfLifeDays, source: 'Material master' },
      ],
      actions: ['Push out the next inbound line before it writes off.'],
    });
  }

  // ---- Lead-time drift -----------------------------------------------------
  const maintained = itemPlant.leadTimeDays;
  if (maintained !== null && maintained > 0 && context.observedLeadTimeDays !== null) {
    const drift = (context.observedLeadTimeDays - maintained) / maintained;
    if (Math.abs(drift) >= LEAD_TIME_DRIFT_THRESHOLD) {
      const days = Math.round(context.observedLeadTimeDays - maintained);
      emit({
        code: 'LEAD_TIME_DRIFT',
        group: 'FIX_DATA',
        severity: Math.abs(drift) > 0.35 ? 'HIGH' : 'MEDIUM',
        headline: `${context.description} is maintained at ${maintained} days and measures ${Math.round(context.observedLeadTimeDays)} — ${Math.abs(days)} days ${days > 0 ? 'longer' : 'shorter'} than the plan assumes.`,
        biteDay: 0,
        qtyAtStake: Math.abs(days) * context.dailyDemandMean,
        daysAtStake: Math.abs(days),
        reachableByOrdering: true,
        operands: [
          {
            label: 'Maintained lead time',
            value: maintained,
            source: `Material master, set ${itemPlant.paramsLastChangedOn}`,
          },
          { label: 'Measured lead time', value: context.observedLeadTimeDays, source: 'Matched goods receipts' },
          { label: 'Difference', value: days, source: 'Measured less maintained' },
        ],
        actions: [
          'Throw the drift toggle on the chart to see what the fence does.',
          'Phase 1 measures this. Proposing a new value is the norms calculator.',
        ],
      });
    }
  }

  // ---- Horizontal block ----------------------------------------------------
  //
  // Expediting bottles when the caps cannot move just fills the warehouse.
  const blocked = context.horizontalSiblings.filter((sibling) => sibling.unreachable);
  if (biteDay !== -1 && blocked.length > 0) {
    const sibling = blocked[0] as HorizontalSibling;
    emit({
      code: 'HORIZONTAL_BLOCK',
      group: 'CANNOT_ORDER',
      severity: 'MEDIUM',
      headline: `${sibling.description} goes into the same parent and cannot be moved either. Expediting ${context.description} alone would fill the warehouse without making anything.`,
      biteDay,
      qtyAtStake: 0,
      daysAtStake: 0,
      reachableByOrdering: false,
      operands: [{ label: 'Blocked siblings', value: blocked.length, source: `Components of ${sibling.parentItemId}` }],
      actions: ['Resolve the whole component set for this parent, or resequence the production.'],
    });
  }

  // ---- Master-data gaps ----------------------------------------------------
  const gaps: string[] = [];
  if (itemPlant.leadTimeDays === null) gaps.push('lead time');
  if (itemPlant.safetyStock === null) gaps.push('safety stock');
  if (itemPlant.lotSizeRule === null) gaps.push('lot-sizing rule');
  if (itemPlant.procurementType === 'BUY' && context.vendor === null) gaps.push('approved source');
  if (gaps.length > 0) {
    emit({
      code: 'MASTER_DATA_GAP',
      group: 'FIX_DATA',
      severity: 'MEDIUM',
      headline: `${context.description} is missing its ${gaps.join(', ')}. Every number the plan produces for it rests on a default.`,
      biteDay: 0,
      qtyAtStake: 0,
      daysAtStake: 0,
      reachableByOrdering: true,
      operands: gaps.map((gap) => ({ label: gap, value: 0, source: 'Absent from the material master' })),
      actions: [`Maintain the ${gaps.join(' and ')} before acting on this line.`],
    });
  }

  return raised;
}

/**
 * What a planner can do, given where the exposure sits against the fence.
 *
 * Ordered by what is actually reachable rather than by what is conventional:
 * telling someone to raise a purchase order for a week no purchase order can
 * reach is worse than saying nothing.
 */
function actionsFor(context: MaterialContext, biteDay: number, fence: Fence): string[] {
  const actions: string[] = [];
  const reachable = biteDay >= fence.earliestReceiptDay;

  if (!reachable) {
    actions.push(
      `Nothing ordered today lands before day ${fence.earliestReceiptDay}. This exposure has to be closed another way.`
    );
    const confirmed = context.openLines.filter((line) => line.tier === 1 && line.expectedDay >= 0);
    if (confirmed.length > 0) {
      const line = confirmed[0] as OpenLineContext;
      actions.push(
        `Expedite discharge and quality release on ${line.orderId} line ${line.line} to buy days at the front.`
      );
    }
    const unacknowledged = context.openLines.filter((line) => line.tier === 2 && line.expectedDay >= 0);
    if (unacknowledged.length > 0) {
      const line = unacknowledged[0] as OpenLineContext;
      actions.push(
        `Get ${line.orderId} line ${line.line} acknowledged and pull it forward — it is the only supply that can reach the later weeks.`
      );
    }
    const sibling = context.categorySiblings.sort((a, b) => a.earliestReceiptDay - b.earliestReceiptDay)[0];
    if (sibling && sibling.earliestReceiptDay < fence.earliestReceiptDay) {
      actions.push(
        `Order ${sibling.itemId} — same chemistry, ${sibling.leadTimeDays}-day lead time — for the weeks it can cover.`
      );
    }
    actions.push('Commit the weeks beyond the fence now, so the same conversation does not happen again in a month.');
  } else {
    actions.push('Place the order this week — the last responsible order date is now.');
  }

  return actions;
}

function dayOffsetOfRelease(order: PlannedOrderExplanation): number {
  // The explanation carries the receipt day and the total offset that produced
  // the release date, so the release day is recoverable without a second date
  // parse — and it stays consistent with whatever the run actually used.
  return order.requirementDay - order.totalOffsetDays;
}

/**
 * Ranking, by consequence rather than by count.
 *
 * Time to breach dominates, because everything else can be bought and time
 * cannot. Reachability is a multiplier rather than a term: an exposure no
 * purchase order can touch needs a decision today, whatever it is worth.
 */
function scoreOf(exception: PlanningException, horizonDays: number): number {
  const urgency = exception.biteDay <= 0 ? 1 : Math.max(0, 1 - exception.biteDay / Math.max(horizonDays, 1));
  const severityWeight = { CRITICAL: 1, HIGH: 0.7, MEDIUM: 0.4, LOW: 0.15 }[exception.severity];
  const reachMultiplier = exception.reachableByOrdering ? 1 : 1.4;
  const value = Math.log10(Math.max(exception.valueAtStake, 1)) / 9;
  const cover = Math.min(exception.daysAtStake / 30, 1);

  return (urgency * 0.45 + severityWeight * 0.25 + value * 0.2 + cover * 0.1) * reachMultiplier;
}

/** Ranked worst first. Ties broken by the earlier bite, never by material code. */
export function rankExceptions(exceptions: PlanningException[]): PlanningException[] {
  return [...exceptions].sort((a, b) => b.score - a.score || a.biteDay - b.biteDay);
}

function round(value: number): string {
  return Math.round(value).toLocaleString('en-IN');
}
