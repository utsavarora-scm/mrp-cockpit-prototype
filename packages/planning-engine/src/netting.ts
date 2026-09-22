/**
 * Net requirements calculation — the bucket walk at the centre of the engine.
 *
 *   GR(t)  = firm sales orders + net forecast + dependent demand + STO demand
 *   SR(t)  = open POs + production orders + in-transit STOs + firm planned orders
 *   PAB(t) = PAB(t−1) + SR(t) + PlannedReceipts(t) − GR(t)      PAB(−1) = on hand
 *
 * A net requirement exists wherever PAB falls below the planning threshold —
 * safety stock for deterministic items, the reorder point for consumption-based
 * ones. Lot sizing turns that into an order quantity, and the release date is
 * then walked backwards over the working calendar.
 *
 * Release dates that land before the planning date are kept, not discarded.
 * That case is `A8-ORDER-IN-PAST`, and quietly dropping it is exactly the
 * behaviour that lets a plan look feasible when it is not.
 */

import type { Item, ItemPlant } from '@repo/domain';
import type { WorkingCalendar } from './calendar';
import { applyLotSizing, effectiveLotSizeRule, type LotSizingConflict, type LotSizingStep } from './lot-sizing';

/** Quantities below this are rounding noise, not a shortage. */
const EPSILON = 1e-6;

/** Backstop against a pathological parameter set producing endless orders. */
const MAX_ORDERS_PER_ITEM_PLANT = 400;

export interface PlannedOrderDraft {
  itemId: string;
  plantId: string;
  qty: number;
  /** Day offset of the receipt. Always within the horizon. */
  receiptDay: number;
  /** Day offset of the release. Negative means it needed placing in the past. */
  releaseDay: number;
  receiptEpochDay: number;
  releaseEpochDay: number;
  /** True when the release date precedes the planning date — drives A8. */
  isReleaseInPast: boolean;
  /** Release clamped to the planning date, which is what would actually be sent. */
  clampedReleaseEpochDay: number;
  totalOffsetDays: number;
  effectiveLeadTimeDays: number;
  vendorId: string | null;
  sourcePlantId: string | null;
  /** The quantity the lot-sizing rule chose, before MOQ/rounding/scrap. */
  ruleQty: number;
  /** Net requirement that triggered the order. */
  netRequirement: number;
  /**
   * The shortage this order serves.
   *
   * Shared by every slice a max-lot split produced, so anything summing
   * exposure across orders can count one shortage once. Summing
   * `netRequirement` over slices reports a 12,000 MT requirement three times.
   */
  requirementId: string;
}

/**
 * One shortage, and everything lot sizing did to it.
 *
 * Held per requirement rather than per order because a max-lot split produces
 * several orders from one shortage: copying the trace onto each would show three
 * 4,000 MT slices each claiming a 12,000 MT derivation.
 */
export interface RequirementDraft {
  requirementId: string;
  itemId: string;
  plantId: string;
  /** Day offset of the bucket that breached. */
  day: number;
  netRequirement: number;
  ruleQty: number;
  /** The reconciled total, before splitting. Slices sum to this. */
  finalOrderQuantity: number;
  slices: number[];
  threshold: number;
  /** The balance the order is topping up from. */
  balanceBefore: number;
  trace: LotSizingStep[];
}

export interface NettingInput {
  item: Item;
  itemPlant: ItemPlant;
  calendar: WorkingCalendar;
  planningEpochDay: number;
  horizonDays: number;
  openingStock: number;
  grossRequirements: Float64Array;
  scheduledReceipts: Float64Array;
  /** Written in place by this pass. */
  plannedReceipts: Float64Array;
  /** Written in place by this pass. */
  projectedAvailable: Float64Array;
  /** Written in place by this pass — excludes receipts that cannot be ordered in time. */
  projectedAvailableFeasible: Float64Array;
  /**
   * The planning threshold per bucket, from the norms engine.
   *
   * A quantity per bucket rather than one figure, so a seasonal norm can vary
   * across the horizon — the point of Act 2 is that a flat norm is 50 days of
   * cover in April and 14 in July, and a netting walk holding one number cannot
   * express that. Omitted, the maintained safety stock applies flat.
   */
  normByBucket?: Float64Array;
  /** Maintained or observed, resolved by the caller. */
  effectiveLeadTimeDays: number;
  moq: number;
  incrementQty: number;
  vendorId: string | null;
  sourcePlantId: string | null;
}

export interface NettingResult {
  orders: PlannedOrderDraft[];
  /** Day of the first balance below zero, or −1. */
  firstStockoutDay: number;
  /** Day of the first balance below the planning threshold, or −1. */
  firstBreachDay: number;
  /** The threshold actually applied on day 0 — safety stock or reorder point. */
  threshold: number;
  /**
   * The net requirement raised in each bucket, before any lot sizing.
   *
   * `(gross requirement + safety stock) − (previous balance + scheduled
   * receipts)`, and the answer to "why is the system asking me to order this?".
   * Incremental, not cumulative: a gap that persists across nine days is
   * reported once, so summing the series over a weekly bucket gives the week's
   * requirement rather than nine times it.
   *
   * Published on the plan rather than re-derived from the orders it produced.
   * Reconstructing it from order explanations loses every requirement lot
   * sizing consolidated and double-counts every one it split.
   */
  netRequirements: Float64Array;
  /** First bucket the position runs below its norm, or −1. Where line 1 is needed. */
  firstUncoveredDay: number;
  /** One entry per shortage, carrying the sizing trace the orders share. */
  requirements: RequirementDraft[];
  /** Parameter sets that could not be satisfied. A data-quality finding. */
  conflicts: LotSizingConflict[];
  /**
   * Planned receipts whose release date has already passed.
   *
   * Published so a recovery pass can roll its own balance from opening stock
   * rather than adjusting `projectedAvailableFeasible`, which is already rolled.
   */
  infeasibleReceipts: Float64Array;
  /**
   * First day an order released today could land, under *this run's* lead time.
   *
   * Computed from the same offset and calendar walk netting uses, not from the
   * maintained fence: under the measured-lead-time scenario the two differ, and
   * a recovery dated off the wrong one is a date nobody can hit.
   */
  earliestFeasibleReceiptDay: number;
}

/**
 * Back-scheduling, in the units the lead time is actually measured in.
 *
 * Exported so the recovery pass walks the same calendar netting did. Two
 * implementations of this walk is how a proposal and the order it replaces come
 * to disagree about which Monday they land on.
 */
export function releaseDayForReceipt(
  calendar: WorkingCalendar,
  isBought: boolean,
  totalOffset: number
): (receiptEpochDay: number) => number {
  return (receiptEpochDay: number): number =>
    isBought
      ? calendar.previousWorkingDayOnOrBefore(receiptEpochDay - totalOffset)
      : calendar.subtractWorkingDays(receiptEpochDay, totalOffset);
}

/** Items with no planning type, or explicitly excluded, are not netted. */
export function isPlanningActive(itemPlant: ItemPlant): boolean {
  if (!itemPlant.isPlanningRelevant) return false;
  if (itemPlant.mrpType === 'ND') return false;
  return true;
}

export function netItemPlant(input: NettingInput): NettingResult {
  const {
    itemPlant,
    calendar,
    planningEpochDay,
    horizonDays,
    openingStock,
    grossRequirements,
    scheduledReceipts,
    plannedReceipts,
    projectedAvailable,
    projectedAvailableFeasible,
  } = input;

  const safetyStock = itemPlant.safetyStock ?? 0;
  const flatThreshold = itemPlant.mrpType === 'VB' ? (itemPlant.reorderPoint ?? safetyStock) : safetyStock;
  const normByBucket = input.normByBucket;
  const thresholdAt = (day: number): number => (normByBucket ? (normByBucket[day] ?? flatThreshold) : flatThreshold);
  const planningActive = isPlanningActive(itemPlant);

  // `effectiveLeadTimeDays` is the *complete* chain — release to available —
  // and goods receipt and quality release are already inside it. Adding goods
  // receipt again here is how the netting offset and the lead-time fence came
  // to disagree by two days on a material whose whole story is that the fence
  // sits ten weeks right of the breach.
  const totalOffset = input.effectiveLeadTimeDays + itemPlant.safetyTimeDays;
  const rule = effectiveLotSizeRule(itemPlant);

  /**
   * Back-scheduling, in the units the lead time is actually measured in.
   *
   * A bought material's lead time is calendar days: a vessel sails through the
   * weekend, customs queues through it, and a quarantine clock does not stop on
   * a Sunday. A made material's is working days, because a plant that runs six
   * days a week takes eight calendar days to do six days of work. Walking
   * working days for an import overstates a 90-day chain by more than two
   * weeks, which moves the fence past the point where it means anything.
   *
   * Either way the answer is snapped back to a day the site is open, because a
   * purchase order raised on a Sunday is one raised on Monday.
   */
  const isBought = itemPlant.procurementType !== 'MAKE';
  const releaseDayFor = releaseDayForReceipt(calendar, isBought, totalOffset);

  const orders: PlannedOrderDraft[] = [];
  const requirements: RequirementDraft[] = [];
  const conflicts: LotSizingConflict[] = [];
  let firstStockoutDay = -1;
  let firstBreachDay = -1;
  const netRequirements = new Float64Array(horizonDays + 1);
  // The shortfall still standing uncovered at the close of the previous
  // bucket. Without it, a gap that persists for nine days is written out nine
  // times and a weekly bucket reports seven times the requirement — the series
  // has to be summable, because the grid sums it. Carried across the *close*
  // of each bucket rather than its opening, so a gap an order closed is not
  // still counted as covered ground on the day after.
  let uncoveredShortfall = 0;
  let balance = openingStock;
  // The same walk, minus any receipt whose release date has already passed.
  let feasibleBalance = openingStock;
  const infeasibleReceipts = new Float64Array(horizonDays + 1);

  for (let day = 0; day <= horizonDays; day += 1) {
    balance +=
      (scheduledReceipts[day] as number) + (plannedReceipts[day] as number) - (grossRequirements[day] as number);
    feasibleBalance +=
      (scheduledReceipts[day] as number) +
      (plannedReceipts[day] as number) -
      (infeasibleReceipts[day] as number) -
      (grossRequirements[day] as number);

    const threshold = thresholdAt(day);
    if (firstBreachDay === -1 && balance < threshold - EPSILON) firstBreachDay = day;

    if (balance < threshold - EPSILON) {
      // Only the growth on top of the gap still standing, so the series sums
      // across a bucket. Where an order was raised yesterday the balance was
      // topped back up, nothing is standing, and today's shortfall is reported
      // in full; where one could not be, this is what stops the same shortfall
      // being counted every day until supply arrives.
      const required = threshold - balance;
      netRequirements[day] = Math.max(0, required - uncoveredShortfall);
    }

    if (planningActive && balance < threshold - EPSILON && orders.length < MAX_ORDERS_PER_ITEM_PLANT) {
      const netRequirement = threshold - balance;

      // Netting does not look ahead. A receipt landing after this bucket —
      // acknowledged or not — cannot mean the bucket never needed anything;
      // it means an existing order is later than the position requires, which
      // is a pull-in, and the exception engine raises it as one. Deciding here
      // that a later delivery cancels an earlier requirement is how the whole
      // worked example lost its headline order: W39 needed 120 MT, and a line
      // in W41 that nobody had confirmed made the requirement disappear.

      const sizing = applyLotSizing({
        rule,
        netRequirement,
        itemPlant,
        standardCost: input.item.standardCost,
        day,
        horizonDays,
        grossRequirements,
        scheduledReceipts,
        plannedReceipts,
        thresholdAt,
        projectedAvailable: balance,
        moq: input.moq,
        incrementQty: input.incrementQty,
      });

      const requirementId = `${itemPlant.itemId}@${itemPlant.plantId}#${day}`;
      requirements.push({
        requirementId,
        itemId: itemPlant.itemId,
        plantId: itemPlant.plantId,
        day,
        netRequirement,
        ruleQty: sizing.ruleQty,
        finalOrderQuantity: sizing.finalOrderQuantity,
        slices: sizing.orderQtys.slice(),
        threshold,
        balanceBefore: balance,
        trace: sizing.trace,
      });
      for (const conflict of sizing.conflicts) conflicts.push(conflict);

      const bucketEpochDay = planningEpochDay + day;
      for (let slice = 0; slice < sizing.orderQtys.length; slice += 1) {
        const qty = sizing.orderQtys[slice] as number;
        if (qty <= EPSILON) continue;

        // Splits land on consecutive working days after the first.
        const receiptEpochDay = slice === 0 ? bucketEpochDay : calendar.addWorkingDays(bucketEpochDay, slice);
        const receiptDay = receiptEpochDay - planningEpochDay;
        if (receiptDay > horizonDays) break;

        const releaseEpochDay = releaseDayFor(receiptEpochDay);
        const isReleaseInPast = releaseEpochDay < planningEpochDay;

        orders.push({
          itemId: itemPlant.itemId,
          plantId: itemPlant.plantId,
          qty,
          receiptDay,
          releaseDay: releaseEpochDay - planningEpochDay,
          receiptEpochDay,
          releaseEpochDay,
          isReleaseInPast,
          clampedReleaseEpochDay: isReleaseInPast ? planningEpochDay : releaseEpochDay,
          totalOffsetDays: totalOffset,
          effectiveLeadTimeDays: input.effectiveLeadTimeDays,
          vendorId: input.vendorId,
          sourcePlantId: input.sourcePlantId,
          ruleQty: sizing.ruleQty,
          netRequirement,
          requirementId,
        });

        plannedReceipts[receiptDay] = (plannedReceipts[receiptDay] as number) + qty;
        if (isReleaseInPast) infeasibleReceipts[receiptDay] = (infeasibleReceipts[receiptDay] as number) + qty;
        if (receiptDay === day) {
          balance += qty;
          if (!isReleaseInPast) feasibleBalance += qty;
        }
      }
    }

    // What this bucket leaves behind, measured after any order it raised.
    //
    // A shortfall an order covered is closed, not carried: the next bucket's
    // gap is a fresh requirement, not growth in this one. Reading it off the
    // closing balance also lets a partial recovery widen again and be
    // reported, which a high-water mark would swallow.
    uncoveredShortfall = balance < threshold - EPSILON ? threshold - balance : 0;

    projectedAvailable[day] = balance;
    projectedAvailableFeasible[day] = feasibleBalance;
    if (firstStockoutDay === -1 && feasibleBalance < -1e-6) firstStockoutDay = day;
  }

  return {
    orders,
    firstStockoutDay,
    firstBreachDay,
    threshold: thresholdAt(0),
    netRequirements,
    firstUncoveredDay: firstBreachDay,
    requirements,
    conflicts,
    infeasibleReceipts,
    earliestFeasibleReceiptDay: earliestFeasibleReceiptDay(),
  };

  /** The first receipt day whose release date is today or later. */
  function earliestFeasibleReceiptDay(): number {
    for (let day = 0; day <= horizonDays; day += 1) {
      if (releaseDayFor(planningEpochDay + day) >= planningEpochDay) return day;
    }
    return horizonDays;
  }
}

/**
 * Forward days of demand each day's balance covers.
 *
 * Done with a prefix sum and a binary search rather than the obvious nested
 * loop: at 180 buckets across a few thousand item-plants the naive version is
 * tens of millions of operations and by itself blows the sub-2-second budget.
 *
 * A balance of zero reads as zero days of cover, not as "covered forever"
 * because there happens to be no demand tomorrow.
 */
export function computeDaysOfCover(
  projectedAvailable: Float64Array,
  grossRequirements: Float64Array,
  out: Float64Array,
  /** Scratch buffer of length horizon + 1, reused across item-plants. */
  prefix: Float64Array
): void {
  const horizon = projectedAvailable.length - 1;

  let running = 0;
  for (let day = 0; day <= horizon; day += 1) {
    running += grossRequirements[day] as number;
    prefix[day] = running;
  }

  for (let day = 0; day <= horizon; day += 1) {
    const balance = projectedAvailable[day] as number;
    if (balance <= 0) {
      out[day] = 0;
      continue;
    }

    // Largest `hi` with prefix[hi] − prefix[day] ≤ balance.
    const ceiling = (prefix[day] as number) + balance;
    let lo = day;
    let hi = horizon;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((prefix[mid] as number) <= ceiling) lo = mid;
      else hi = mid - 1;
    }

    let cover = lo - day;
    // Partial day: how far into the next bucket's demand the remainder reaches.
    if (lo < horizon) {
      const nextDemand = (prefix[lo + 1] as number) - (prefix[lo] as number);
      if (nextDemand > 0) cover += (ceiling - (prefix[lo] as number)) / nextDemand;
    }
    out[day] = cover;
  }
}
