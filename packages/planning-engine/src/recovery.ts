/**
 * What can still be done about a plan that asked for orders in the past.
 *
 * Netting keeps a past-due order at its original need date and its original,
 * impossible release date, which is the honest answer to "when was this
 * needed?" and no answer at all to "what do I do now?". This pass answers the
 * second question without disturbing the first: the original order is left
 * exactly where it is, and a separate set of orders is proposed at dates that
 * can actually be met.
 *
 * Three things it is deliberately not:
 *
 * **Not a redate.** The quantity is recalculated at the feasible date, because
 * the demand and the receipts between the original date and that one change
 * what is needed — in either direction. Copying the old quantity forward would
 * be a guess dressed as a plan.
 *
 * **Not an adjustment of the feasible curve.** The balance here is rolled fresh
 * from opening stock. `projectedAvailableFeasible` is already a rolled series;
 * walking it forward while adding demand and receipts a second time counts both
 * twice. When this pass raises nothing, the two series are identical, and that
 * is the invariant worth testing.
 *
 * **Not a promise.** Clearing the lead-time fence says an order could arrive,
 * not that anyone can take it. Every candidate is checked against the vendor's
 * capacity and shutdowns and the site's storage and shelf life before it is
 * allowed into the series — otherwise exposure gets classified as recoverable
 * on the strength of an order nobody can place.
 */

import { fromEpochDay, startOfWeek, type ItemPlant, type LotSizingStep } from '@repo/domain';

import type { WorkingCalendar } from './calendar';
import { applyLotSizing, effectiveLotSizeRule } from './lot-sizing';
import type { ConstraintKey } from './delivery-schedule';
import { checkReceipt, type ReceiptCeilingInput } from './receipt-constraints';

const EPSILON = 1e-6;

/** Backstop against a pathological parameter set proposing endless recoveries. */
const MAX_RECOVERY_ORDERS = 200;

/** One order that could actually be placed, standing in for ones that cannot. */
export interface RecoveryOrder {
  itemId: string;
  plantId: string;
  /** The reconciled total. `slices` sum to this. */
  qty: number;
  /**
   * What would actually be released, where a maximum lot splits it.
   *
   * Held beside the total rather than as separate orders, for the same reason
   * the sizing trace lives on the requirement: three slices each carrying a
   * copy of one derivation is three claims to the same quantity.
   */
  slices: number[];
  receiptDay: number;
  receiptDate: string;
  releaseDate: string;
  /**
   * The unmet requirements this order stands in for.
   *
   * One recovery order usually covers several: the shortages a 90-day lead time
   * stranded do not each deserve their own proposal, and emitting one per unmet
   * requirement is how a planner ends up with nine suggestions for one problem.
   */
  coversRequirementIds: string[];
  sizingTrace: LotSizingStep[];
}

/** A candidate that cleared the lead time and failed something else. */
export interface BlockedRecovery {
  receiptDay: number;
  qty: number;
  blockedBy: ConstraintKey | null;
  detail: string;
}

export interface RecoveryResult {
  orders: RecoveryOrder[];
  blocked: BlockedRecovery[];
  /** Fresh roll: opening + booked + placeable planned + recovery − demand. */
  projectedAvailableRecovered: Float64Array;
  /** Deficit before the earliest feasible receipt. No order reaches this. */
  unavoidableQty: number;
  /**
   * How much of the worst shortfall constraint-cleared ordering removes.
   *
   * The improvement in one measure, not a sum of per-day top-ups: summing those
   * counts one exposure once per day it persists.
   */
  recoverableQty: number;
  /**
   * Worst shortfall against the norm still standing once recovery has done
   * what it can — across the whole horizon, so it includes the days inside the
   * fence that no order was ever going to reach.
   */
  residualQty: number;
  /**
   * The part of that falling on days an order could actually have landed on.
   *
   * This, not the whole-horizon figure, is what decides whether a row belongs
   * under "cannot be fixed by ordering".
   */
  residualAfterFenceQty: number;
  /** The first day the recovered balance is still short, or −1. */
  firstResidualDay: number;
}

export interface RecoveryInput {
  itemId: string;
  plantId: string;
  itemPlant: ItemPlant;
  calendar: WorkingCalendar;
  planningEpochDay: number;
  horizonDays: number;
  openingStock: number;
  standardCost: number;
  grossRequirements: Float64Array;
  scheduledReceipts: Float64Array;
  plannedReceipts: Float64Array;
  /** Planned receipts whose release date has already passed. */
  infeasibleReceipts: Float64Array;
  thresholdAt: (day: number) => number;
  /** First day an order placed today could land, under this run's lead time. */
  earliestFeasibleReceiptDay: number;
  /** Walks a receipt date back to its release date, as netting does. */
  releaseDayFor: (receiptEpochDay: number) => number;
  moq: number;
  incrementQty: number;
  ceiling: ReceiptCeilingInput;
  /** ISO Mondays of weeks the vendor's plant is shut. */
  shutdownMondays: Set<string>;
  /** Shortages whose orders cannot be placed, earliest first. */
  unmetRequirements: Array<{ requirementId: string; day: number }>;
}

export function planRecovery(input: RecoveryInput): RecoveryResult {
  const {
    horizonDays,
    grossRequirements,
    scheduledReceipts,
    plannedReceipts,
    infeasibleReceipts,
    thresholdAt,
    earliestFeasibleReceiptDay,
  } = input;

  const recoveryReceipts = new Float64Array(horizonDays + 1);
  const recovered = new Float64Array(horizonDays + 1);
  // POQ has to see what recovery has already committed, or consecutive orders
  // each cover the same period.
  const visiblePlanned = new Float64Array(horizonDays + 1);
  for (let day = 0; day <= horizonDays; day += 1) {
    visiblePlanned[day] = (plannedReceipts[day] as number) - (infeasibleReceipts[day] as number);
  }

  const orders: RecoveryOrder[] = [];
  const blocked: BlockedRecovery[] = [];
  const rule = effectiveLotSizeRule(input.itemPlant);

  // Earliest first, so an order covers the shortages that precede it.
  const pending = [...input.unmetRequirements].sort((a, b) => a.day - b.day);
  let nextPending = 0;

  let balance = input.openingStock;
  let feasibleBalance = input.openingStock;
  let unavoidableQty = 0;
  let worstFeasibleDeficit = 0;
  let residualQty = 0;
  let residualAfterFenceQty = 0;
  let firstResidualDay = -1;

  for (let day = 0; day <= horizonDays; day += 1) {
    const booked = (scheduledReceipts[day] as number) + (visiblePlanned[day] as number);
    const demand = grossRequirements[day] as number;

    feasibleBalance += booked - demand;
    balance += booked + (recoveryReceipts[day] as number) - demand;

    const threshold = thresholdAt(day);

    // What no order could have reached, measured on the curve without recovery.
    if (day < earliestFeasibleReceiptDay && feasibleBalance < threshold - EPSILON) {
      unavoidableQty = Math.max(unavoidableQty, threshold - feasibleBalance);
    }

    if (day >= earliestFeasibleReceiptDay && balance < threshold - EPSILON && orders.length < MAX_RECOVERY_ORDERS) {
      const netRequirement = threshold - balance;

      const sizing = applyLotSizing({
        rule,
        netRequirement,
        itemPlant: input.itemPlant,
        standardCost: input.standardCost,
        day,
        horizonDays,
        grossRequirements,
        scheduledReceipts,
        plannedReceipts: visiblePlanned,
        thresholdAt,
        projectedAvailable: balance,
        moq: input.moq,
        incrementQty: input.incrementQty,
      });

      const receiptEpochDay = input.planningEpochDay + day;
      const monday = startOfWeek(fromEpochDay(receiptEpochDay));
      // Checked against the largest slice, not the unsplit total, and with the
      // maximum lot excluded — lot sizing owns that constraint and has already
      // satisfied it. Checking the total against it refused every recovery on
      // any material whose requirement exceeds one lot, which is most of them.
      const largestSlice = sizing.orderQtys.reduce((max, slice) => Math.max(max, slice), 0);
      const verdict = checkReceipt(
        { ...input.ceiling, maxLotSize: null },
        {
          qty: largestSlice,
          // The balance the period opens on, before this day's own demand —
          // which is also what is on the floor when the receipt arrives. A
          // recovery is one receipt on one day, so the storage question is
          // asked at arrival, not after the day's consumption has made room.
          openingBalance: balance + demand,
          heldAtArrival: balance + demand,
          requirement: demand,
          isShutdownWeek: input.shutdownMondays.has(monday),
        }
      );

      if (!verdict.ok) {
        // Excluded from the series, not merely annotated. A blocked candidate
        // that still topped up the balance would report the exposure it failed
        // to cover as recovered.
        blocked.push({
          receiptDay: day,
          qty: sizing.finalOrderQuantity,
          blockedBy: verdict.blockedBy,
          detail: verdict.detail ?? 'The receipt could not be taken that week.',
        });
      } else {
        const covers: string[] = [];
        while (nextPending < pending.length && (pending[nextPending] as { day: number }).day <= day) {
          covers.push((pending[nextPending] as { requirementId: string }).requirementId);
          nextPending += 1;
        }

        orders.push({
          itemId: input.itemId,
          plantId: input.plantId,
          qty: sizing.finalOrderQuantity,
          slices: sizing.orderQtys.slice(),
          receiptDay: day,
          receiptDate: fromEpochDay(receiptEpochDay),
          releaseDate: fromEpochDay(input.releaseDayFor(receiptEpochDay)),
          coversRequirementIds: covers,
          sizingTrace: sizing.trace,
        });

        recoveryReceipts[day] = (recoveryReceipts[day] as number) + sizing.finalOrderQuantity;
        balance += sizing.finalOrderQuantity;
      }
    }

    // Both measures on one base — the worst shortfall against the norm — so the
    // sentence "ordering lifts it from A to B" is arithmetic a planner can
    // check. Summing per-day top-ups instead reported one exposure many times,
    // and adding a pre-fence maximum to a post-recovery one produced a figure
    // larger than the trough it claimed to describe.
    if (feasibleBalance < threshold - EPSILON) {
      worstFeasibleDeficit = Math.max(worstFeasibleDeficit, threshold - feasibleBalance);
    }
    if (balance < threshold - EPSILON) {
      residualQty = Math.max(residualQty, threshold - balance);
      // Separately, the part ordering could have reached and did not. Whether
      // ordering fixes a problem is a question about the days an order can
      // land on: a hole inside the fence is not evidence that ordering fails,
      // it is a different finding, and `UNREACHABLE_REQUIREMENT` already says
      // so. Grouping on the whole-horizon figure filed a stock-out under
      // "cannot be fixed by ordering" on the strength of a 0.64 MT day-zero
      // residue that ordering was never going to touch.
      if (day >= earliestFeasibleReceiptDay) {
        residualAfterFenceQty = Math.max(residualAfterFenceQty, threshold - balance);
      }
      if (firstResidualDay === -1) firstResidualDay = day;
    }

    recovered[day] = balance;
  }

  const recoverableQty = Math.max(0, worstFeasibleDeficit - residualQty);

  return {
    orders,
    blocked,
    projectedAvailableRecovered: recovered,
    unavoidableQty,
    recoverableQty,
    residualQty,
    residualAfterFenceQty,
    firstResidualDay,
  };
}
