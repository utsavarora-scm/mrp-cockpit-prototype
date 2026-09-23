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

import type { ItemPlant, ItemPlantPlan, ItemVendor, MaterialRecovery, PlannedOrderExplanation } from '@repo/domain';

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
  | 'CONFIRMED_LATE'
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
  /**
   * What can still be done where the plan asked for an order in the past.
   *
   * Absent where nothing is unplaceable. Where present, the split between
   * unavoidable and recoverable is what decides whether a row belongs under
   * "cannot be fixed by ordering" — rather than the bite date's position
   * relative to the fence, which says only when the exposure starts and nothing
   * about whether an order reaches it.
   */
  recovery: MaterialRecovery | null;
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
  /**
   * Whether a made material has a bill of material at all.
   *
   * A missing BOM is the master-data gap with the largest consequence — the
   * requirement below it is simply absent, so the plan is not wrong about the
   * component, it has never heard of it — and it was the one gap the check did
   * not look for.
   */
  hasBom: boolean;
  /** Batch expiry on hand, for the excess check that is about expiry rather than cover. */
  expiringBatches: Array<{ batchId: string; qty: number; expiryDate: string; daysToExpiry: number }>;
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
  /** Day offset of the date the order asked for. */
  plannedDay: number;
  plannedDate: string;
  /** The date the vendor committed to, where they have. Planning runs on it. */
  confirmedDate: string | null;
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

/**
 * Cover above this multiple of the maximum norm reads as excess.
 *
 * Exported because the planning position counts the same condition, and two
 * copies of one threshold is how a tile and a queue come to disagree about the
 * same material.
 */
export const EXCESS_MULTIPLE = 1.1;

/** A receipt this far past its date with no goods receipt is a live problem. */
const PAST_DUE_GRACE_DAYS = 2;

/** Cover above this multiple of the norm, when a delivery lands, is worth deferring. */
const PUSH_OUT_MULTIPLE = 1.5;

// ---------------------------------------------------------------------------

export function raiseExceptions(context: MaterialContext, horizonDays: number): PlanningException[] {
  const raised: PlanningException[] = [];
  const { plan, itemPlant, fences } = context;
  const safetyStock = plan.safetyStock;
  const fence = fences.maintained;

  const emit = (
    partial: Omit<PlanningException, 'id' | 'score' | 'valueAtStake' | 'itemId' | 'plantId' | 'daysAtStake'> & {
      daysAtStake?: number;
      /**
       * Distinguishes conditions sharing a code.
       *
       * The three `EXCESS_RISK` variants keyed on the same id whenever their
       * bite days collided — an expiry within a day of the norm check — and
       * dismissals are stored by id, so dismissing one hid the other.
       */
      variant?: string;
    }
  ): void => {
    const daysAtStake =
      partial.daysAtStake ?? (context.dailyDemandMean > 0 ? partial.qtyAtStake / context.dailyDemandMean : 0);
    const exception: PlanningException = {
      ...partial,
      daysAtStake,
      id: `${partial.code}-${partial.variant ?? ''}-${context.itemId}-${context.plantId}-${partial.biteDay}`,
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

  // The plan as it stands, for the counterfactuals to be measured against.
  const baselineWorstDeficit = worstDeficitWithShift(
    plan.projectedAvailableFeasible,
    safetyStock,
    horizonDays,
    0,
    0,
    0
  );

  // Whether ordering helps, decided by whether ordering actually closes it.
  //
  // This used to be `biteDay >= fence.earliestReceiptDay` — a statement about
  // when the exposure starts, not about whether an order reaches it. That is
  // how a card came to wear "Reachable by ordering" above a headline saying the
  // balance stays out *after* every order that can still be placed: the two
  // sentences were answering different questions, and neither was the
  // planner's. Where a recovery pass has run, the residual it could not close —
  // whether because nothing lands in time or because a constraint blocked it —
  // is what decides the group.
  const recovery = context.recovery;
  const reachable =
    biteDay === -1 ? true : recovery ? recovery.residualAfterFenceQty <= 0 : biteDay >= fence.earliestReceiptDay;

  // ---- Projected stock-out -------------------------------------------------
  if (firstStockoutDay !== -1) {
    emit({
      code: 'PROJECTED_STOCKOUT',
      group: reachable ? 'ORDER_NOW' : 'CANNOT_ORDER',
      severity: 'CRITICAL',
      // Two clauses on two clearly different measures, rather than one subtraction
      // across bases. The trough is a depth below zero; the recovery figures are
      // shortfalls against the norm, and adding them to each other — or to the
      // trough — produced numbers larger than the exposure they described.
      headline: recovery
        ? recovery.residualQty <= 0
          ? `${context.description} runs out: the balance reaches ${round(-worstStockoutQty)} ${context.baseUom} at its worst. Ordering everything still placeable clears it.`
          : `${context.description} runs out: the balance reaches ${round(-worstStockoutQty)} ${context.baseUom} at its worst. Ordering everything still placeable lifts the shortfall against the norm to ${round(recovery.residualQty)} ${context.baseUom}, and no further.`
        : `${context.description} runs out, and stays out: the balance reaches ${round(-worstStockoutQty)} ${context.baseUom} at its worst, even after every order that can still be placed.`,
      biteDay: firstStockoutDay,
      qtyAtStake: worstStockoutQty,
      reachableByOrdering: reachable,
      operands: [
        { label: 'Opening stock', value: plan.openingStock, source: 'Stock on hand, unrestricted' },
        { label: 'Safety stock', value: safetyStock, source: 'Material master' },
        {
          label: 'Worst balance',
          value: -worstStockoutQty,
          source: 'Projected balance after every order that can still be placed',
        },
        ...(recovery
          ? [
              {
                label: 'Worst shortfall against the norm, closed by ordering now',
                value: recovery.recoverableQty,
                source: 'Recovery orders that clear the lead time and every capacity check',
              },
              {
                label: 'Worst shortfall still standing after that',
                value: recovery.residualQty,
                source:
                  recovery.blocked.length > 0
                    ? `${recovery.blocked.length} candidate${recovery.blocked.length === 1 ? '' : 's'} blocked by ${recovery.blocked[0]?.blockedBy ?? 'a constraint'}`
                    : 'Nothing ordered now lands before the exposure bites',
              },
              {
                label: 'Of which falls before anything could land',
                value: recovery.unavoidableQty,
                source: 'Inside the lead-time fence — no order reaches these days',
              },
            ]
          : []),
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

    // The exposure is the shortfall, not the lot.
    //
    // `order.qty` is what a buyer would raise; most of it is usually lot sizing,
    // and lot sizing is not something the business is short of. Pricing the lot
    // put ₹7.51 Cr against a 0.64 MT miss on RM-30137 and ₹85.50 Cr against the
    // hero, then ranked both above genuinely larger exposures because
    // `valueAtStake` feeds the score twice over.
    //
    // Counted once per shortage: a max-lot split emits one order per slice, each
    // carrying the same `netRequirement`, so summing across orders reports one
    // requirement as many times as it was cut up.
    const shortfallByRequirement = new Map<string, number>();
    for (const order of unplaceable) {
      shortfallByRequirement.set(order.requirementId, Math.min(order.netRequirement, order.qty));
    }
    const shortfall = [...shortfallByRequirement.values()].reduce((sum, qty) => sum + qty, 0);
    const requirementCount = shortfallByRequirement.size;

    // Days, and the two week labels — not a rounded week count.
    //
    // "9 weeks ago" sat above its own W26-against-W36 labels and looked wrong,
    // because those are two different measures: 65 elapsed days is 9.3 weeks,
    // while 10 is the difference between the planning weeks. Saying how many
    // days, and naming both weeks, is unambiguous in a way neither rounding is.
    const daysLate = Math.max(0, -first.releaseDay);
    emit({
      code: 'UNREACHABLE_REQUIREMENT',
      group: 'CANNOT_ORDER',
      severity: 'CRITICAL',
      headline: `${requirementCount} ${requirementCount === 1 ? 'requirement' : 'requirements'} for ${context.description} needed ordering before today — the first ${daysLate} ${daysLate === 1 ? 'day' : 'days'} ago, on ${first.releaseDate}. ${round(shortfall)} ${context.baseUom} of genuine shortfall, against ${round(totalQty)} ${context.baseUom} that would be raised. No purchase order placed now can reach ${requirementCount === 1 ? 'it' : 'them'}.`,
      biteDay: first.requirementDay,
      qtyAtStake: shortfall,
      reachableByOrdering: false,
      operands: [
        { label: 'Shortfall at stake', value: shortfall, source: 'Net requirement, counted once per shortage' },
        { label: 'Executable order quantity', value: totalQty, source: 'Planned orders from this run' },
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
    // It has to reach the exposure, not merely beat this material's own chain.
    // The second disjunct admitted a sibling five days faster that still landed
    // after the bite date — and then told the planner, under a heading reading
    // "fix by switching source", that it reached something it did not.
    const reachableSibling = context.categorySiblings
      .filter((sibling) => sibling.earliestReceiptDay <= biteDay)
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
  //
  // Tier **2**, deliberately. The requirements document contradicts itself
  // here: its exception table calls this "a breach avoided only by a Tier-3
  // receipt", while §6.4 states the two rules the tiers exist for — a breach
  // avoided only by Tier 3 *is still a breach* and is raised as one, and a
  // breach avoided only by Tier 2 is raised as supply unconfirmed. §6.4 wins,
  // because it is the section that defines the tiers and the table is a
  // summary of it. Tier 3 is handled by the breach exception above.
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
      // What the plan loses if these never arrive, not what they weigh.
      //
      // A line's quantity is not an exposure: most overdue supply lands into a
      // position that can absorb it. The number worth a phone call is how much
      // deeper the shortfall gets with the line taken out — one counterfactual,
      // capped at the line, rather than a daily deficit summed over every day it
      // persists.
      qtyAtStake: Math.min(
        qty,
        Math.max(
          0,
          worstDeficitWithShift(plan.projectedAvailableFeasible, safetyStock, horizonDays, -qty, 0, horizonDays + 1) -
            baselineWorstDeficit
        )
      ),
      reachableByOrdering: false,
      operands: [
        { label: 'Quantity overdue', value: qty, source: 'Open schedule lines past their expected date' },
        { label: 'Days overdue, worst line', value: -worst, source: 'Expected date against the planning date' },
        {
          label: 'Worst shortfall if it never arrives',
          value: worstDeficitWithShift(
            plan.projectedAvailableFeasible,
            safetyStock,
            horizonDays,
            -qty,
            0,
            horizonDays + 1
          ),
          source: 'The balance re-rolled without these lines',
        },
        { label: 'Worst shortfall as planned', value: baselineWorstDeficit, source: 'Balance after placeable orders' },
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
        // What advancing it is worth: the improvement in the worst shortfall if
        // the line landed when the position needs it rather than when it is due.
        qtyAtStake: Math.min(
          late.qty,
          Math.max(
            0,
            baselineWorstDeficit -
              worstDeficitWithShift(
                plan.projectedAvailableFeasible,
                safetyStock,
                horizonDays,
                late.qty,
                biteDay,
                late.expectedDay
              )
          )
        ),
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

  // ---- Confirmed later than asked ------------------------------------------
  //
  // A vendor's confirmation is the date the plan runs on, so a confirmation
  // later than the order asked for moves the supply — silently, unless it is
  // said. Raised only where the slip costs cover: a week late into a position
  // that can carry it is a fact on the line, not a call to make.
  {
    const slipped = context.openLines
      .filter(
        (line) =>
          line.confirmedDate !== null &&
          !line.hasGrn &&
          line.expectedDay > line.plannedDay &&
          line.expectedDay >= 0 &&
          line.plannedDay <= horizonDays
      )
      .map((line) => {
        const from = Math.max(line.plannedDay, 0);
        const cost = Math.min(
          line.qty,
          Math.max(
            0,
            baselineWorstDeficit -
              worstDeficitWithShift(
                plan.projectedAvailableFeasible,
                safetyStock,
                horizonDays,
                line.qty,
                from,
                Math.min(line.expectedDay, horizonDays + 1)
              )
          )
        );
        return { line, cost };
      })
      .filter((row) => row.cost > 0)
      .sort((a, b) => b.cost - a.cost);

    const worst = slipped[0];
    if (worst) {
      const { line, cost } = worst;
      const slip = line.expectedDay - line.plannedDay;
      emit({
        code: 'CONFIRMED_LATE',
        group: 'MOVE_EXISTING_ORDER',
        severity: 'HIGH',
        headline: `${line.vendorName ?? line.vendorId ?? 'The vendor'} confirmed ${line.orderId} line ${line.line} for ${line.confirmedDate}, ${slip} days after the ${line.plannedDate} it was ordered for. The plan now runs on the later date.`,
        biteDay: Math.max(line.plannedDay, 0),
        qtyAtStake: cost,
        reachableByOrdering: false,
        operands: [
          { label: 'Ordered for day', value: line.plannedDay, source: `Schedule line ${line.orderId}/${line.line}` },
          { label: 'Confirmed for day', value: line.expectedDay, source: 'Vendor confirmation, as recorded' },
          { label: 'Days late', value: slip, source: 'Confirmed less ordered' },
          { label: 'Quantity on the line', value: line.qty, source: 'Open schedule line' },
        ],
        actions: [
          `Push ${line.vendorName ?? line.vendorId ?? 'the vendor'} back to ${line.plannedDate} on ${line.orderId} line ${line.line}.`,
          'Or cover the gap from another open line or source.',
        ],
      });
    }
  }

  // The mirror of the pull-in, and the half that was never written. The excess
  // exception has been telling planners to "push out the next inbound line"
  // for as long as it has existed without anything naming which line that is.
  //
  // Two conditions, both about a delivery arriving into a position that does
  // not want it: cover already beyond the maximum norm when it lands, or a
  // quantity that will not fit on the floor.
  {
    const norm = context.maxNormDays;
    const cap = itemPlant.storageCapacity;

    const unwanted = context.openLines
      .filter((line) => line.tier <= 2 && line.expectedDay >= 0 && line.expectedDay <= horizonDays && !line.hasGrn)
      .map((line) => {
        const cover = plan.daysOfCover[line.expectedDay] as number;
        const onHand = plan.projectedBeforePlanned[line.expectedDay] as number;
        // A wider band than the excess check uses. A delivery landing into cover
        // a little above the norm is a replenishment pipeline working; one
        // landing into half again as much is a delivery nobody wants. At the
        // narrower threshold this fired on a quarter of the book and stopped
        // being a finding.
        const overNorm = norm !== null && cover > norm * PUSH_OUT_MULTIPLE;
        const overCap = cap !== null && cap > 0 && onHand > cap;
        return { line, cover, onHand, overNorm, overCap };
      })
      .filter((row) => row.overNorm || row.overCap)
      .sort((a, b) => a.line.expectedDay - b.line.expectedDay)[0];

    if (unwanted) {
      const { line, cover, onHand, overCap } = unwanted;
      emit({
        code: 'PUSH_OUT',
        group: 'MOVE_EXISTING_ORDER',
        severity: 'LOW',
        headline: overCap
          ? `${round(line.qty)} ${context.baseUom} on ${line.orderId} line ${line.line} lands on a position of ${round(onHand)} against ${round(cap as number)} of space.`
          : `${round(line.qty)} ${context.baseUom} on ${line.orderId} line ${line.line} lands into ${Math.round(cover)} days of cover against a ${norm}-day maximum norm.`,
        biteDay: line.expectedDay,
        qtyAtStake: line.qty,
        daysAtStake: overCap ? 0 : cover - (norm ?? 0),
        reachableByOrdering: true,
        operands: overCap
          ? [
              { label: 'Position when it lands', value: onHand, source: 'Balance before planned orders' },
              { label: 'Storage capacity', value: cap as number, source: 'Plant master' },
            ]
          : [
              { label: 'Days of cover when it lands', value: cover, source: 'Balance against forward consumption' },
              { label: 'Maximum norm, days', value: norm as number, source: 'Material master' },
            ],
        actions: [
          `Ask ${line.vendorName ?? line.vendorId ?? 'the vendor'} to defer ${line.orderId} line ${line.line}.`,
          'Or take the delivery and carry the cover deliberately, with the cost stated.',
        ],
      });
    }
  }

  // ---- Excess and obsolescence --------------------------------------------
  //
  // Measured on supply that could actually turn up.
  //
  // `plan.daysOfCover` is rolled off `projectedAvailable`, which counts every
  // planned order including the ones whose release date has passed. So an
  // unplaceable proposal manufactured its own excess exception: RM-30137 was
  // told it held 27 days of cover against an 18-day norm, ₹2.96 Cr of it, on the
  // strength of 800 MT nobody could order — while a second card on the same
  // material said it was critically short.
  //
  // A *feasible* recommendation creating excess is a different thing and stays:
  // a 1,000 MT vessel parcel to close a 120 MT gap really does leave the cover
  // it leaves, and that is a trade-off worth showing rather than an artefact.
  const executableBalance = recovery
    ? (recovery.projectedAvailableRecovered[0] as number)
    : (plan.projectedAvailableFeasible[0] as number);
  const closingCover = coverAt(executableBalance, plan.grossRequirements, 0, horizonDays);
  if (context.maxNormDays !== null && closingCover > context.maxNormDays * EXCESS_MULTIPLE) {
    const excessQty = (closingCover - context.maxNormDays) * context.dailyDemandMean;
    emit({
      code: 'EXCESS_RISK',
      variant: 'NORM',
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
  }

  // Cover beyond the norm and cover beyond the shelf life are two findings with
  // two owners, and an `else if` reported only the first — at the *lower* of
  // the two severities, because the norm branch is tested first.
  if (context.shelfLifeDays !== null && closingCover > context.shelfLifeDays * 0.75) {
    emit({
      code: 'EXCESS_RISK',
      variant: 'SHELF_LIFE',
      group: 'REDUCE_COVER',
      severity: 'MEDIUM',
      headline: `${context.description} holds ${Math.round(closingCover)} days of cover against a ${context.shelfLifeDays}-day shelf life.`,
      biteDay: 1,
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

  // Expiry proper, which is not the same question as cover. A batch dated to
  // die is a write-off whatever the forward cover says, and the data has been
  // in the snapshot all along with nothing reading it.
  const expiring = context.expiringBatches.filter(
    (batch) => batch.daysToExpiry <= (context.shelfLifeDays ?? 90) * 0.25
  );
  if (expiring.length > 0) {
    const qty = expiring.reduce((sum, batch) => sum + batch.qty, 0);
    const soonest = expiring.reduce((min, batch) => Math.min(min, batch.daysToExpiry), Number.POSITIVE_INFINITY);
    emit({
      code: 'EXCESS_RISK',
      variant: 'EXPIRY',
      group: 'REDUCE_COVER',
      severity: soonest <= 30 ? 'HIGH' : 'MEDIUM',
      headline: `${round(qty)} ${context.baseUom} of ${context.description} expires within ${Math.round(soonest)} days, across ${expiring.length} batch${expiring.length === 1 ? '' : 'es'}.`,
      biteDay: Math.max(0, Math.round(soonest)),
      qtyAtStake: qty,
      daysAtStake: soonest,
      reachableByOrdering: false,
      operands: [
        { label: 'Quantity expiring', value: qty, source: 'Batch expiry dates on hand' },
        { label: 'Days to the first expiry', value: soonest, source: 'Earliest batch' },
      ],
      actions: ['Consume or redeploy the oldest batches first.', 'Push out the next inbound line before it compounds.'],
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
  // The gap with the largest consequence, and the one nothing looked for: a
  // made material with no bill of material raises no requirement at all, so the
  // plan is not wrong about what sits below it — it has never heard of it.
  if (itemPlant.procurementType === 'MAKE' && !context.hasBom) gaps.push('bill of material');
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
  const recovery = context.recovery;

  // The same test the grouping uses, so a row cannot say "nothing reaches this"
  // in its headline and "place the order this week" in its first bullet.
  const reachable = recovery ? recovery.residualAfterFenceQty <= 0 : biteDay >= fence.earliestReceiptDay;

  if (recovery && recovery.orders.length > 0) {
    const first = recovery.orders[0] as { qty: number; receiptDate: string; releaseDate: string };
    actions.push(
      `Raise ${round(first.qty)} ${context.baseUom} now for ${first.receiptDate} — release by ${first.releaseDate}. That is the earliest anything ordered today can land.`
    );
  }

  if (!reachable) {
    actions.push(
      `Nothing ordered today lands before day ${fence.earliestReceiptDay}. This exposure has to be closed another way.`
    );

    // Lines are picked by date and by stage, not by their position in the
    // snapshot array. Naming a line that is already as early as it can be — or
    // asking for discharge on one that has already been received — is how a
    // queue teaches a planner to stop reading it.
    for (const action of expediteActions(context, biteDay)) actions.push(action);

    const sibling = context.categorySiblings.sort((a, b) => a.earliestReceiptDay - b.earliestReceiptDay)[0];
    if (sibling && sibling.earliestReceiptDay < fence.earliestReceiptDay) {
      actions.push(
        `Order ${sibling.itemId} — same chemistry, ${sibling.leadTimeDays}-day lead time — for the weeks it can cover.`
      );
    }

    if (recovery && recovery.blocked.length > 0) {
      const blocked = recovery.blocked[0] as { blockedBy: string | null; receiptDay: number };
      actions.push(
        `An order for day ${blocked.receiptDay} would be refused by ${CONSTRAINT_PROSE[blocked.blockedBy ?? ''] ?? 'a capacity limit'}. Clear that before it can help.`
      );
    }

    actions.push('Commit the weeks beyond the fence now, so the same conversation does not happen again in a month.');
  } else if (!recovery || recovery.orders.length === 0) {
    actions.push('Place the order this week — the last responsible order date is now.');
  }

  return actions;
}

/** Plain words for a constraint key, where one has to appear in a sentence. */
const CONSTRAINT_PROSE: Record<string, string> = {
  VENDOR_CAPACITY: "the vendor's weekly capacity",
  VENDOR_SHUTDOWN: "the vendor's plant shutdown",
  STORAGE_CAP: 'the storage ceiling',
  SHELF_LIFE: 'shelf life',
  MAX_LOT: 'the maximum lot size',
  RECEIVING_CAPACITY: 'the receiving dock',
};

/**
 * Which open lines are worth chasing, and what to ask of them.
 *
 * Three rules the old version had none of. A line only helps if it lands
 * *after* the exposure bites — one already due earlier is not the problem. A
 * line that has been goods-received cannot be expedited into the warehouse
 * twice. And what to ask depends on where the line is: a vessel at anchor needs
 * discharge and quality release, an unacknowledged order needs a vendor.
 */
function expediteActions(context: MaterialContext, biteDay: number): string[] {
  const actions: string[] = [];
  const byDate = (a: OpenLineContext, b: OpenLineContext): number => a.expectedDay - b.expectedDay;

  // Already moving, not yet received: the lever is logistics and QA, not the vendor.
  const inFlight = context.openLines
    .filter((line) => line.tier === 1 && line.expectedDay >= 0 && !line.hasGrn && line.expectedDay > biteDay)
    .sort(byDate);
  if (inFlight.length > 0) {
    const line = inFlight[0] as OpenLineContext;
    actions.push(
      `Expedite discharge and quality release on ${line.orderId} line ${line.line}, due ${line.expectedDate}, to buy days at the front.`
    );
  }

  // Nobody has acknowledged it, so the date is not yet real. That is a vendor
  // conversation, and it is the one worth having first.
  const unacknowledged = context.openLines
    .filter((line) => line.tier === 2 && line.expectedDay >= 0 && !line.hasGrn && line.expectedDay > biteDay)
    .sort(byDate);
  if (unacknowledged.length > 0) {
    const line = unacknowledged[0] as OpenLineContext;
    actions.push(
      `Get ${line.orderId} line ${line.line} acknowledged and pulled in from ${line.expectedDate} — it lands after the position needs it.`
    );
  }

  return actions;
}

/**
 * The worst shortfall against the norm, with one receipt shifted in or out.
 *
 * Moving a receipt of `qty` so that it is present over `[fromDay, toDay)` and
 * absent elsewhere displaces the rolled balance by exactly `qty` over that
 * span — so the counterfactual needs no second roll, only an offset. Passing a
 * negative `qty` removes a receipt; a positive one brings it forward.
 */
function worstDeficitWithShift(
  feasible: ArrayLike<number>,
  safetyStock: number,
  horizonDays: number,
  qty: number,
  fromDay: number,
  toDay: number
): number {
  let worst = 0;
  for (let day = 0; day <= horizonDays; day += 1) {
    const shifted = (feasible[day] as number) + (day >= fromDay && day < toDay ? qty : 0);
    const deficit = safetyStock - shifted;
    if (deficit > worst) worst = deficit;
  }
  return worst;
}

/**
 * Forward days of demand a balance covers, from one day.
 *
 * The published `daysOfCover` series answers the same question against a
 * different balance — one that counts orders nobody can place. Where the
 * question is "how much cover does this material actually have", the balance has
 * to be one that can actually arrive.
 */
function coverAt(balance: number, grossRequirements: Float64Array, fromDay: number, horizonDays: number): number {
  if (balance <= 0) return 0;
  let remaining = balance;
  for (let day = fromDay; day <= horizonDays; day += 1) {
    const demand = grossRequirements[day] as number;
    if (demand <= 0) continue;
    if (remaining < demand) return day - fromDay + remaining / demand;
    remaining -= demand;
  }
  return horizonDays - fromDay;
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
