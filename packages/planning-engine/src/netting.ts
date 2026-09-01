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
import { applyLotSizing, effectiveLotSizeRule } from './lot-sizing';

/** Quantities below this are rounding noise, not a shortage. */
const EPSILON = 1e-6;

/** Backstop against a pathological parameter set producing endless orders. */
const MAX_ORDERS_PER_ITEM_PLANT = 400;

/** How far ahead existing supply is allowed to be and still count as covering. */
const COVERAGE_LOOKAHEAD_DAYS = 14;

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

/**
 * A net requirement the engine chose not to order for, because supply already on
 * the books covers it. Reported rather than discarded: the existing receipt is
 * usually sitting later than it needs to, which is a reschedule, not a non-event.
 */
export interface SupersededRequirement {
  itemId: string;
  plantId: string;
  /** Bucket the requirement arose in. */
  day: number;
  /** Bucket where existing supply restores the balance. */
  coveredByDay: number;
  netRequirement: number;
  /** Release date the order would have had — negative means it was already impossible. */
  wouldBeReleaseDay: number;
}

export interface NettingResult {
  orders: PlannedOrderDraft[];
  superseded: SupersededRequirement[];
  /** Day of the first balance below zero, or −1. */
  firstStockoutDay: number;
  /** Day of the first balance below the planning threshold, or −1. */
  firstBreachDay: number;
  /** The threshold actually applied on day 0 — safety stock or reorder point. */
  threshold: number;
  /**
   * The net requirement raised in each bucket, before any lot sizing.
   *
   * This is what the scheduling engine consumes. Quantity and delivery split
   * are one decision, not two: with a minimum order quantity, a shipment cap, a
   * storage ceiling and a receiving rate all in play, sizing the order here and
   * slicing it later produces splits that satisfy one constraint by violating
   * another. Netting says how short the position runs and when; scheduling
   * decides what to do about it.
   */
  netRequirements: Float64Array;
  /** First bucket the position runs below its norm, or −1. Where line 1 is needed. */
  firstUncoveredDay: number;
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

  const totalOffset = input.effectiveLeadTimeDays + itemPlant.grProcessingTimeDays + itemPlant.safetyTimeDays;
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
  const releaseDayFor = (receiptEpochDay: number): number =>
    isBought
      ? calendar.previousWorkingDayOnOrBefore(receiptEpochDay - totalOffset)
      : calendar.subtractWorkingDays(receiptEpochDay, totalOffset);

  const orders: PlannedOrderDraft[] = [];
  const superseded: SupersededRequirement[] = [];
  let firstStockoutDay = -1;
  let firstBreachDay = -1;
  const netRequirements = new Float64Array(horizonDays + 1);
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

    if (balance < threshold - EPSILON) netRequirements[day] = threshold - balance;

    if (planningActive && balance < threshold - EPSILON && orders.length < MAX_ORDERS_PER_ITEM_PLANT) {
      const netRequirement = threshold - balance;

      // Before ordering, look at what is already on the books. A receipt that
      // restores the buffer within the reschedule window makes a new order
      // redundant — raising one anyway is how planners end up cancelling their
      // own requisitions a week later. The requirement is still reported, since
      // the existing receipt is usually later than it ought to be.
      const coveredByDay = findCoveringReceipt(
        day,
        balance,
        threshold,
        scheduledReceipts,
        grossRequirements,
        horizonDays
      );
      if (coveredByDay !== null) {
        superseded.push({
          itemId: itemPlant.itemId,
          plantId: itemPlant.plantId,
          day,
          coveredByDay,
          netRequirement,
          wouldBeReleaseDay: releaseDayFor(planningEpochDay + day) - planningEpochDay,
        });
        projectedAvailable[day] = balance;
        projectedAvailableFeasible[day] = feasibleBalance;
        if (firstStockoutDay === -1 && feasibleBalance < -1e-6) firstStockoutDay = day;
        continue;
      }

      const sizing = applyLotSizing({
        rule,
        netRequirement,
        itemPlant,
        standardCost: input.item.standardCost,
        day,
        horizonDays,
        grossRequirements,
        scheduledReceipts,
        projectedAvailable: balance,
        moq: input.moq,
        incrementQty: input.incrementQty,
      });

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
        });

        plannedReceipts[receiptDay] = (plannedReceipts[receiptDay] as number) + qty;
        if (isReleaseInPast) infeasibleReceipts[receiptDay] = (infeasibleReceipts[receiptDay] as number) + qty;
        if (receiptDay === day) {
          balance += qty;
          if (!isReleaseInPast) feasibleBalance += qty;
        }
      }
    }

    projectedAvailable[day] = balance;
    projectedAvailableFeasible[day] = feasibleBalance;
    if (firstStockoutDay === -1 && feasibleBalance < -1e-6) firstStockoutDay = day;
  }

  return {
    orders,
    superseded,
    firstStockoutDay,
    firstBreachDay,
    threshold: thresholdAt(0),
    netRequirements,
    firstUncoveredDay: firstBreachDay,
  };
}

/**
 * The bucket at which receipts already on the books restore the balance to the
 * planning threshold, or null when they never do without it first going
 * negative. Bounded by the reschedule window — supply further out than that is
 * not covering this requirement in any useful sense.
 */
function findCoveringReceipt(
  fromDay: number,
  startingBalance: number,
  threshold: number,
  scheduledReceipts: Float64Array,
  grossRequirements: Float64Array,
  horizonDays: number
): number | null {
  const limit = Math.min(fromDay + COVERAGE_LOOKAHEAD_DAYS, horizonDays);
  let balance = startingBalance;
  for (let day = fromDay + 1; day <= limit; day += 1) {
    balance += (scheduledReceipts[day] as number) - (grossRequirements[day] as number);
    if (balance < -EPSILON) return null;
    if (balance >= threshold - EPSILON) return day;
  }
  return null;
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
