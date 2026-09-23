/**
 * The delivery schedule — turning an order quantity into a set of dated drops.
 *
 * This is the part the system of record does not do. MRP produces a quantity
 * and a date; reality needs that quantity split into deliveries across weeks,
 * sized to what the vendor can actually make and what the warehouse can
 * actually hold. Today that split happens by phone, memory and experience, and
 * it is never written back anywhere anything can learn from.
 *
 * The module produces **two schedules and the reconciliation between them**:
 *
 *   - The **ideal** schedule answers *if the vendor and the warehouse could do
 *     anything, when would I want each unit?* It is the planner's statement of
 *     need, and it is the benchmark everything else is measured against.
 *   - The **committed** schedule answers *given everything that is actually
 *     true, what can I ask for?*
 *   - The **delta ledger** answers the question that decides whether a planner
 *     trusts any of this: *why are these two different?*
 *
 * The rule that shapes the whole implementation: **no unattributed deltas.** If
 * the engine cannot name the constraint that moved a unit, it must not move it.
 * A schedule that differs from the plan for reasons it cannot articulate is
 * indistinguishable from a schedule that is simply wrong, and a planner will —
 * correctly — go back to the spreadsheet.
 *
 * A second rule, learned the same way: **a line that cannot be met is emitted,
 * flagged, with the gap in days.** It is never quietly pushed to the first date
 * that works. On a 90-day import the first line of an urgent order is routinely
 * impossible, and knowing that in time to do something else is the planner's
 * entire job. Silently rescheduling it is how a planning system teaches people
 * not to trust it.
 */

import { fromEpochDay, startOfWeek, toEpochDay, weekLabel } from '@repo/domain';

import type { WorkingCalendar } from './calendar';
import { receiptCeiling } from './receipt-constraints';

/** Every reason a committed line can differ from the ideal one. */
export type ConstraintKey =
  | 'MOQ'
  | 'ROUNDING'
  | 'MAX_LOT'
  | 'VENDOR_SHUTDOWN'
  | 'VENDOR_CAPACITY'
  | 'STORAGE_CAP'
  | 'SHELF_LIFE'
  | 'RECEIVING_CAPACITY'
  | 'SOURCE_SPLIT'
  | 'QA_QUARANTINE'
  | 'MIN_GAP'
  | 'PULL_FORWARD'
  | 'RECOVERY'
  | 'FROZEN_ZONE'
  | 'PLANNER_EDIT';

export const CONSTRAINT_LABEL: Record<ConstraintKey, string> = {
  MOQ: 'Minimum order quantity',
  ROUNDING: 'Rounding value',
  MAX_LOT: 'Maximum lot',
  VENDOR_SHUTDOWN: 'Vendor plant shutdown',
  VENDOR_CAPACITY: 'Vendor capacity',
  STORAGE_CAP: 'Warehouse volumetric ceiling',
  SHELF_LIFE: 'Shelf life',
  RECEIVING_CAPACITY: 'Daily receiving capacity',
  SOURCE_SPLIT: 'Source split',
  QA_QUARANTINE: 'Quality inspection',
  MIN_GAP: 'Minimum gap between deliveries',
  PULL_FORWARD: 'Pull-forward to cover a closed week',
  RECOVERY: 'Recovery of the safety-stock dip',
  FROZEN_ZONE: 'Inside the lead-time fence',
  PLANNER_EDIT: 'Set by the planner',
};

export interface IdealLine {
  line: number;
  /** Day offset from the planning date the delivery is needed by. */
  needByDay: number;
  needByDate: string;
  week: string;
  /** Gross requirement falling in this bucket. */
  requirement: number;
  /** Supply already on order or in quality that lands in this bucket. */
  existingReceipts: number;
  /** What the position actually needs to stay at its buffer. */
  needQty: number;
  /** What lot sizing adds on top of the need. Never folded into it. */
  lotSizingAddition: number;
  /** needQty + lotSizingAddition. */
  qty: number;
  /** Which lot-sizing rule bound, where one did. */
  lotSizingReason: ConstraintKey | null;
  /** Balance at the end of this bucket if the ideal schedule were delivered. */
  balanceAfter: number;
}

export interface CommittedLine {
  line: number;
  deliveryDay: number;
  deliveryDate: string;
  /** Working day the vendor must dispatch on to make the delivery date. */
  dispatchDate: string;
  week: string;
  idealQty: number;
  qty: number;
  /** qty − idealQty. */
  delta: number;
  balanceAfter: number;
  /**
   * The most on the floor from this delivery's arrival to the end of its week
   * if the whole line came as one drop on its delivery date. The schedule
   * assumes call-offs through the week, which peak at the closing balance;
   * this is the figure that says whether one truck would fit instead.
   */
  singleDropPeak: number;
  /** The constraint that moved this line, where one did. */
  constraint: ConstraintKey | null;
  /** Written from the constraint objects, never selected from a list of templates. */
  note: string;
  /** True when the line lands inside the lead-time fence and cannot be ordered. */
  insideFence: boolean;
  /** Days the line is needed before a newly placed order could arrive. */
  unreachableByDays: number;
  /**
   * The day the quantity is actually usable, which is not the day it arrives.
   *
   * Quality inspection is elapsed time between the two, and a schedule quoted
   * against the delivery date alone is optimistic by exactly that much.
   */
  availableDate: string;
  /** Working days the plant needs to unload it, at its receiving rate. */
  unloadDays: number;
  /** The line divided across sources, where sourcing splits it. */
  split: Array<{ vendorId: string; vendorName: string | null; qty: number }>;
}

/** One attributed difference between the two schedules. */
export interface ScheduleDelta {
  week: string;
  deliveryDate: string;
  idealQty: number;
  committedQty: number;
  delta: number;
  /**
   * The constraint that moved these units, or null where the engine cannot name
   * one. Null is not a tolerance: it is a defect, and it blocks the schedule.
   */
  constraint: ConstraintKey | null;
  note: string;
}

/**
 * A reason the schedule cannot be sent.
 *
 * Separate from an advisory because the two are answered differently. A broken
 * ceiling is a mistake to fix; a residual exposure is a finding to accept, and
 * the packaging hero's whole worked example ends in one. Blocking on both would
 * mean the only schedule the product can produce is one with nothing to say.
 */
export interface ScheduleViolation {
  line: number | null;
  week: string;
  /** `UNATTRIBUTED` where a delta has no named cause; otherwise the constraint broken. */
  constraint: ConstraintKey | 'UNATTRIBUTED' | 'UNPLACEABLE';
  qty: number;
  message: string;
}

/** A finding the planner should see and may accept. Never blocks. */
export interface ScheduleAdvisory {
  line: number | null;
  week: string | null;
  kind: 'RESIDUAL_EXPOSURE' | 'INSIDE_FENCE' | 'CALL_OFF_REQUIRED';
  message: string;
}

/**
 * A change the engine would make elsewhere to accommodate a planner's edit.
 *
 * Offered rather than applied. A planner who types a quantity and watches the
 * screen silently move it has learned that the tool argues with them, and will
 * go back to the spreadsheet where it does not.
 */
export interface ProposedCorrection {
  line: number;
  week: string;
  from: number;
  to: number;
  reason: string;
}

/** One line the planner has set by hand. The engine must not move it. */
export interface PlannerLine {
  line: number;
  qty: number;
}

/** A constraint, whether or not it bound. Non-binding ones are shown too. */
export interface ConstraintSummary {
  key: ConstraintKey;
  label: string;
  binding: boolean;
  /** The constraint's own value, in the material's unit. */
  value: number | null;
  note: string;
}

/** Cover the committed schedule does not restore, stated rather than buried. */
export interface ResidualExposure {
  /** Weeks in which the balance sits below safety stock. */
  weeks: string[];
  /** The largest shortfall against safety stock across those weeks. */
  shortfall: number;
  /** That shortfall, in days of cover at the planned consumption rate. */
  shortfallDays: number;
  /** The week it is recovered in, or null if it is not recovered in the window. */
  recoveredIn: string | null;
  /** Whether the balance goes below zero at any point — a stock-out, not a dip. */
  stocksOut: boolean;
}

export interface DeliveryScheduleInput {
  itemId: string;
  plantId: string;
  vendorId: string | null;
  planningEpochDay: number;
  /** Day offset of the first bucket the schedule covers. */
  fromDay: number;
  /** Day offset of the last bucket the schedule covers. */
  toDay: number;
  /** Daily gross requirement, indexed by day offset from the planning date. */
  grossRequirements: ArrayLike<number>;
  /**
   * Supply already coming, by day: open delivery lines and quality releases,
   * exactly as the grid nets them. The schedule is built *in addition to* this
   * — without it the builder proposes cover for weeks an open order already
   * covers, and the grid and the schedule describe two different positions.
   */
  scheduledReceipts: ArrayLike<number>;
  /** Balance at the end of the day before `fromDay`. */
  openingBalance: number;
  safetyStock: number;
  /** Mean daily consumption, for stating a shortfall in days rather than units. */
  dailyDemandMean: number;
  /** The material's base unit, so the ledger's sentences can carry it. */
  baseUom: string;

  moq: number | null;
  roundingValue: number | null;
  maxLotSize: number | null;
  /** Most the vendor can produce in one week. */
  weeklyCapacity: number | null;
  /** Most the plant can hold of this item at one moment. Dominant for packaging. */
  storageCapacity: number | null;
  /** Working days that must separate two deliveries. */
  minGapDays: number;
  /** Most the plant can unload and put away in one working day. */
  dailyReceivingCapacity: number | null;
  /**
   * Days the material keeps. Ceilings forward cover, which is the constraint
   * that binds for a raw material where the warehouse ceiling binds for a
   * packaging one — buying eleven months of an oil that keeps twelve is a
   * write-off with a delivery note.
   */
  shelfLifeDays: number | null;
  /** Days a receipt sits in quality inspection before it is available to use. */
  qaQuarantineDays: number;
  /** How the sourcing split divides each line. Empty where there is one source. */
  sourceSplit: readonly { vendorId: string; vendorName: string | null; share: number }[];

  transitDays: number;
  /** Earliest day offset a newly placed order could be received. */
  earliestReceiptDay: number;
  /** ISO Monday dates of weeks in which the vendor produces nothing. */
  productionShutdownWeeks: readonly string[];

  plantCalendar: WorkingCalendar;
  vendorCalendar: WorkingCalendar;

  /**
   * Lines the planner has edited. Pinned: the engine rebalances around them and
   * reports what they break, but never rewrites them.
   */
  plannerLines?: readonly PlannerLine[];
}

export interface DeliveryScheduleResult {
  ideal: IdealLine[];
  committed: CommittedLine[];
  deltas: ScheduleDelta[];
  constraints: ConstraintSummary[];
  residual: ResidualExposure | null;
  totals: { ideal: number; committed: number; delta: number };
  /** The ledger, as prose, in the order a planner reads it. */
  ledger: string[];
  /** Ways to close the residual, where there is one. Never invented. */
  options: string[];
  /** Why this schedule cannot be sent. Empty means it can. */
  blockingViolations: ScheduleViolation[];
  /** Findings the planner should see and may accept with a reason. */
  advisories: ScheduleAdvisory[];
  /** Changes the engine would make elsewhere to fit a planner's edit. */
  proposedCorrections: ProposedCorrection[];
}

/**
 * Quantity tolerance.
 *
 * Weekly requirements are summed from daily buckets, so a week that is exactly
 * 210,000 arrives as 209,999.99999999997. Without a tolerance the rounding rule
 * then adds a whole pallet to cover a rounding error, and the schedule gains a
 * delivery nobody asked for. Comparisons that decide an outcome use this.
 */
const QTY_EPSILON = 1e-6;

interface WeekBucket {
  week: string;
  /** Monday, as a day offset from the planning date. May be negative for W1. */
  startDay: number;
  endDay: number;
  /** The day a delivery into this week is dated — the first working day of it. */
  deliveryDay: number;
  requirement: number;
  /** Supply already on order landing in this bucket. */
  existing: number;
  isShutdown: boolean;
}

export function buildDeliverySchedule(input: DeliveryScheduleInput): DeliveryScheduleResult {
  const weeks = weekBuckets(input);
  if (weeks.length === 0) {
    return {
      ideal: [],
      committed: [],
      deltas: [],
      constraints: [],
      residual: null,
      totals: { ideal: 0, committed: 0, delta: 0 },
      ledger: ['Nothing falls inside the scheduling window.'],
      options: [],
      blockingViolations: [],
      advisories: [],
      proposedCorrections: [],
    };
  }

  const ideal = buildIdeal(input, weeks);
  const { lines: committed, bindings, unplaced } = buildCommitted(input, weeks, ideal);
  const deltas = attributeDeltas(ideal, committed);
  const residual = measureResidual(input, weeks, committed);
  const constraints = summariseConstraints(input, ideal, committed, bindings);

  const idealTotal = ideal.reduce((sum, line) => sum + line.qty, 0);
  const committedTotal = committed.reduce((sum, line) => sum + line.qty, 0);

  const blockingViolations = [
    ...findBlockingViolations(deltas, committed),
    ...validatePlannerLines(input, weeks, committed),
  ];
  if (unplaced > QTY_EPSILON) {
    blockingViolations.push({
      line: null,
      week: (weeks[weeks.length - 1] as WeekBucket).week,
      constraint: 'UNPLACEABLE',
      qty: unplaced,
      message: `${format(unplaced)} could not be placed in any week the schedule covers. Widen the window, lift a ceiling, or accept the shortfall — but the quantity is not silently dropped.`,
    });
  }

  // Where a planner has pinned a line, what the schedule would have been
  // without their edit is what the engine offers back — as a proposal, never
  // as a change.
  const proposedCorrections =
    (input.plannerLines?.length ?? 0) === 0
      ? []
      : proposeCorrections(committed, buildCommitted({ ...input, plannerLines: [] }, weeks, ideal).lines, input);

  return {
    ideal,
    committed,
    deltas,
    constraints,
    residual,
    totals: { ideal: idealTotal, committed: committedTotal, delta: committedTotal - idealTotal },
    ledger: buildLedger(input, ideal, committed, deltas, constraints, bindings, residual),
    options: closingOptions(input, constraints, residual),
    blockingViolations,
    advisories: findAdvisories(input, committed, residual),
    proposedCorrections,
  };
}

/**
 * What a planner's own edit breaks.
 *
 * The engine's schedule satisfies every constraint by construction; a hand-set
 * line satisfies none of them by construction. Naming the broken one *against
 * the line that broke it* is the difference between a builder a planner argues
 * with and one they can use — §7.3's "any constraint violated by the manual
 * edit is named immediately rather than silently accepted".
 */
function validatePlannerLines(
  input: DeliveryScheduleInput,
  weeks: WeekBucket[],
  committed: CommittedLine[]
): ScheduleViolation[] {
  const violations: ScheduleViolation[] = [];
  const edited = new Set((input.plannerLines ?? []).map((line) => line.line));
  if (edited.size === 0) return violations;

  const raise = (line: CommittedLine, constraint: ConstraintKey, message: string, qty: number): void => {
    violations.push({ line: line.line, week: line.week, constraint, qty, message });
  };

  let lastDelivery: number | null = null;
  for (let index = 0; index < committed.length; index += 1) {
    const line = committed[index] as CommittedLine;
    const week = weeks[index] as WeekBucket;
    const qty = line.qty;

    if (edited.has(line.line) && qty > QTY_EPSILON) {
      if (input.moq && qty < input.moq - QTY_EPSILON) {
        raise(line, 'MOQ', `${format(qty)} is below the ${format(input.moq)} the vendor accepts per call-off.`, qty);
      }
      if (input.roundingValue && Math.abs(qty % input.roundingValue) > QTY_EPSILON) {
        raise(line, 'ROUNDING', `${format(qty)} is not a whole multiple of ${format(input.roundingValue)}.`, qty);
      }
      if (input.maxLotSize && qty > input.maxLotSize + QTY_EPSILON) {
        raise(line, 'MAX_LOT', `${format(qty)} exceeds the ${format(input.maxLotSize)} maximum lot.`, qty);
      }
      if (input.weeklyCapacity && qty > input.weeklyCapacity + QTY_EPSILON) {
        raise(
          line,
          'VENDOR_CAPACITY',
          `${format(qty)} exceeds the ${format(input.weeklyCapacity)} the vendor can make in a week.`,
          qty
        );
      }
      if (week.isShutdown) {
        raise(line, 'VENDOR_SHUTDOWN', `The vendor's plant is shut in ${line.week}. It can produce nothing.`, qty);
      }
      if (
        input.storageCapacity !== null &&
        input.storageCapacity > 0 &&
        line.balanceAfter > input.storageCapacity + QTY_EPSILON
      ) {
        raise(
          line,
          'STORAGE_CAP',
          `${format(line.balanceAfter)} on the floor after this delivery, against a ${format(input.storageCapacity)} ceiling.`,
          line.balanceAfter - input.storageCapacity
        );
      }
    }

    if (qty > QTY_EPSILON) {
      if (
        edited.has(line.line) &&
        lastDelivery !== null &&
        input.minGapDays > 0 &&
        line.deliveryDay - lastDelivery < input.minGapDays
      ) {
        raise(
          line,
          'MIN_GAP',
          `Only ${line.deliveryDay - lastDelivery} days since the previous delivery; ${input.minGapDays} are required.`,
          qty
        );
      }
      lastDelivery = line.deliveryDay;
    }
  }

  return violations;
}

/** What the schedule looked like before the planner touched it, line by line. */
function proposeCorrections(
  edited: CommittedLine[],
  baseline: CommittedLine[],
  input: DeliveryScheduleInput
): ProposedCorrection[] {
  const pinned = new Set((input.plannerLines ?? []).map((line) => line.line));
  const corrections: ProposedCorrection[] = [];

  for (const line of edited) {
    if (pinned.has(line.line)) continue;
    const before = baseline.find((row) => row.line === line.line);
    if (!before || Math.abs(before.qty - line.qty) <= QTY_EPSILON) continue;
    corrections.push({
      line: line.line,
      week: line.week,
      from: line.qty,
      to: before.qty,
      reason: `Rebalanced around the edited lines. Without them this week carried ${format(before.qty)}.`,
    });
  }

  return corrections;
}

// ---------------------------------------------------------------------------
// Step 1 — the weeks the schedule covers
// ---------------------------------------------------------------------------

function weekBuckets(input: DeliveryScheduleInput): WeekBucket[] {
  const buckets: WeekBucket[] = [];
  const shutdowns = new Set(input.productionShutdownWeeks);

  let day = input.fromDay;
  while (day <= input.toDay) {
    const iso = fromEpochDay(input.planningEpochDay + day);
    const monday = startOfWeek(iso);
    const mondayDay = toEpochDay(monday) - input.planningEpochDay;
    const endDay = Math.min(mondayDay + 6, input.toDay);

    let requirement = 0;
    let existing = 0;
    for (let index = Math.max(day, 0); index <= endDay; index += 1) {
      requirement += input.grossRequirements[index] ?? 0;
      existing += input.scheduledReceipts[index] ?? 0;
    }
    // Summed from daily buckets, so the accumulated float error is cleared here
    // rather than allowed to travel into a lot-sizing decision.
    requirement = Math.round(requirement * 1e6) / 1e6;
    existing = Math.round(existing * 1e6) / 1e6;

    // Deliveries are dated to the first day of the week the plant can receive
    // on. A delivery scheduled into a shutdown day is a delivery that will be
    // turned away at the gate.
    const deliveryEpochDay = input.plantCalendar.nextWorkingDayOnOrAfter(
      input.planningEpochDay + Math.max(day, mondayDay)
    );

    buckets.push({
      week: weekLabel(monday),
      startDay: day,
      endDay,
      deliveryDay: deliveryEpochDay - input.planningEpochDay,
      requirement,
      existing,
      isShutdown: shutdowns.has(monday),
    });

    day = endDay + 1;
  }

  return buckets;
}

/**
 * The most on the floor from the delivery day to the end of the week, were
 * the whole line to come as one drop.
 *
 * Walked day by day: open orders land when they are dated, consumption draws
 * down after each day's receipts, and the peak is taken only from the delivery
 * onwards — stock consumed before the truck arrives does not compete with it
 * for space. A delivery dated past the week's last day (a week the plant
 * cannot receive in at all) is charged against everything the week leaves.
 */
function peakFromDelivery(input: DeliveryScheduleInput, week: WeekBucket, opening: number, qty: number): number {
  let level = opening;
  let peak = Number.NEGATIVE_INFINITY;
  for (let day = Math.max(week.startDay, 0); day <= week.endDay; day += 1) {
    level += input.scheduledReceipts[day] ?? 0;
    if (day === week.deliveryDay) level += qty;
    if (day >= week.deliveryDay) peak = Math.max(peak, level);
    level -= input.grossRequirements[day] ?? 0;
  }
  return peak === Number.NEGATIVE_INFINITY ? level + qty : peak;
}

// ---------------------------------------------------------------------------
// Step 2 — the ideal schedule: what the planner wants
// ---------------------------------------------------------------------------

function buildIdeal(input: DeliveryScheduleInput, weeks: WeekBucket[]): IdealLine[] {
  const lines: IdealLine[] = [];
  let balance = input.openingBalance;
  let lineNumber = 10;

  for (const week of weeks) {
    // Exactly to requirement: enough to meet the week and end it on the
    // buffer, after what is already on order for it.
    const needQty = Math.max(0, week.requirement + input.safetyStock - balance - week.existing);

    const sized = applyLotRules(needQty, input);
    const qty = sized.qty;
    balance = balance + qty + week.existing - week.requirement;

    lines.push({
      line: lineNumber,
      needByDay: week.deliveryDay,
      needByDate: fromEpochDay(input.planningEpochDay + week.deliveryDay),
      week: week.week,
      requirement: week.requirement,
      existingReceipts: week.existing,
      needQty,
      lotSizingAddition: qty - needQty,
      qty,
      lotSizingReason: sized.reason,
      balanceAfter: balance,
    });
    lineNumber += 10;
  }

  return lines;
}

/**
 * Lot sizing, in the fixed order the product displays: minimum, then rounding,
 * then the maximum lot. Anything a rule adds is reported separately from the
 * requirement, so a planner always knows how much of an order is need and how
 * much is rule.
 */
function applyLotRules(
  needQty: number,
  input: Pick<DeliveryScheduleInput, 'moq' | 'roundingValue' | 'maxLotSize'>
): { qty: number; reason: ConstraintKey | null } {
  if (needQty <= 0) return { qty: 0, reason: null };

  let qty = needQty;
  let reason: ConstraintKey | null = null;

  if (input.moq && input.moq > 0 && qty < input.moq - QTY_EPSILON) {
    qty = input.moq;
    reason = 'MOQ';
  }
  if (input.roundingValue && input.roundingValue > 0) {
    const rounded = Math.ceil((qty - QTY_EPSILON) / input.roundingValue) * input.roundingValue;
    if (rounded > qty + QTY_EPSILON) {
      qty = rounded;
      reason = reason ?? 'ROUNDING';
    }
  }
  if (input.maxLotSize && input.maxLotSize > 0 && qty > input.maxLotSize + QTY_EPSILON) {
    qty = input.maxLotSize;
    reason = 'MAX_LOT';
  }

  return { qty, reason };
}

// ---------------------------------------------------------------------------
// Step 3 — the committed schedule: what can actually be asked for
// ---------------------------------------------------------------------------

interface CommittedResult {
  lines: CommittedLine[];
  /**
   * Which constraints actually bound, and in which weeks.
   *
   * Recorded as the algorithm runs rather than inferred afterwards from the
   * deltas. A ceiling that caps a pull-forward leaves a delta attributed to the
   * pull-forward, so reading the deltas back would report that no ceiling bound
   * — and the whole point of the ledger is naming the one that did.
   */
  bindings: Map<ConstraintKey, string[]>;
  /** Quantity the constraints displaced that no week could take. Never silently lost. */
  unplaced: number;
}

function buildCommitted(input: DeliveryScheduleInput, weeks: WeekBucket[], ideal: IdealLine[]): CommittedResult {
  const qty = ideal.map((line) => line.qty);

  // Lines the planner set by hand. Pinned before anything else runs, and never
  // touched again: every pass below skips them, so the quantity a planner typed
  // is the quantity that comes back.
  const pinned = new Set<number>();
  for (const edit of input.plannerLines ?? []) {
    const index = ideal.findIndex((line) => line.line === edit.line);
    if (index === -1) continue;
    qty[index] = Math.max(0, edit.qty);
    pinned.add(index);
  }

  const bindings = new Map<ConstraintKey, string[]>();
  const bind = (key: ConstraintKey, week: string): void => {
    const weeksBound = bindings.get(key) ?? [];
    if (!weeksBound.includes(week)) weeksBound.push(week);
    bindings.set(key, weeksBound);
  };
  const constraint: Array<ConstraintKey | null> = ideal.map(() => null);
  const notes: string[] = ideal.map(() => '');

  // The planner *is* the attribution. Left null, their own edit came back as an
  // unattributed delta — the engine reporting its own defect for a change it
  // was told to make, and blocking the schedule on it.
  for (const index of pinned) {
    constraint[index] = 'PLANNER_EDIT';
    notes[index] =
      `Set by hand to ${format(qty[index] as number)}, in place of the ${format(ideal[index]?.qty ?? 0)} the plan proposed.`;
  }

  /**
   * The most that can be *delivered* into a week.
   *
   * Two ceilings, and the interesting one is rarely the expected one. Vendor
   * capacity limits what can be made; the warehouse limits what can be held.
   * The storage question is asked about the balance the week *closes* on,
   * because that is what has to fit on the floor once the week's consumption
   * has drawn it down.
   */
  /** Rolls the balances for the current quantities. */
  const roll = (): number[] => {
    const balances: number[] = [];
    let running = input.openingBalance;
    for (let index = 0; index < weeks.length; index += 1) {
      const week = weeks[index] as WeekBucket;
      running = running + (qty[index] as number) + week.existing - week.requirement;
      balances.push(running);
    }
    return balances;
  };

  const openingOf = (index: number, balances: number[]): number =>
    index === 0 ? input.openingBalance : (balances[index - 1] as number);

  // One implementation, shared with the recovery pass. Two copies of a ceiling
  // is how a schedule and a recommendation come to disagree about the same week.
  //
  // A weekly line is called off through the week, so the warehouse is asked
  // about the balance the week closes on — with the open orders landing that
  // week counted, because they take the same floor. Where the whole line as
  // one drop would not fit, an advisory says so rather than the ceiling
  // pretending the call-offs are guaranteed.
  const ceilingAt = (index: number, balances: number[]): { limit: number; binds: ConstraintKey | null } => {
    const week = weeks[index] as WeekBucket;
    return receiptCeiling(input, openingOf(index, balances) + week.existing, week.requirement);
  };

  // --- 3a. A closed week produces nothing ---------------------------------
  //
  // The quantity does not disappear; it has to be found somewhere else, and
  // where it goes is the whole subject of the ledger below.
  let displaced = 0;
  let lastClosedIndex = -1;
  let firstDisplacedIndex = weeks.length;
  for (let index = 0; index < weeks.length; index += 1) {
    const week = weeks[index] as WeekBucket;
    if (!week.isShutdown || (qty[index] as number) === 0) continue;
    if (pinned.has(index)) continue;
    displaced += qty[index] as number;
    firstDisplacedIndex = Math.min(firstDisplacedIndex, index);
    constraint[index] = 'VENDOR_SHUTDOWN';
    notes[index] = `Vendor plant shutdown in ${week.week}. No production capacity that week.`;
    qty[index] = 0;
    lastClosedIndex = index;
    bind('VENDOR_SHUTDOWN', week.week);
  }

  // --- 3b. Ceilings, applied to every week ---------------------------------
  {
    let balances = roll();
    for (let index = 0; index < weeks.length; index += 1) {
      const week = weeks[index] as WeekBucket;
      const { limit, binds } = ceilingAt(index, balances);
      const lineQty = qty[index] as number;
      if (lineQty <= limit + QTY_EPSILON) continue;
      if (pinned.has(index)) continue;
      firstDisplacedIndex = Math.min(firstDisplacedIndex, index);
      displaced += lineQty - limit;
      qty[index] = roundDown(limit, input.roundingValue);
      displaced += limit - (qty[index] as number);
      bind(binds ?? 'VENDOR_CAPACITY', week.week);
      if (constraint[index] === null) {
        constraint[index] = binds ?? 'VENDOR_CAPACITY';
        notes[index] =
          binds === 'STORAGE_CAP'
            ? 'Capped by the warehouse ceiling, not by the vendor.'
            : "Capped by the vendor's weekly capacity.";
      }
      balances = roll();
    }
  }

  // --- 3c. Pull forward, into the weeks *before* the displacement ----------
  //
  // Earliest first: cover bought late is cover that arrives after it was
  // needed. Each week takes as much as its own ceiling leaves room for.
  //
  // Bounded by where the quantity was displaced *from*, not by the shutdown
  // alone — a ceiling with no closed week in sight displaces quantity too, and
  // gating on the shutdown left that quantity stranded with nowhere to go.
  const pullForwardBefore = (limitIndex: number): void => {
    if (displaced <= QTY_EPSILON || limitIndex <= 0) return;
    let balances = roll();
    for (let index = 0; index < limitIndex && displaced > QTY_EPSILON; index += 1) {
      const week = weeks[index] as WeekBucket;
      if (week.isShutdown || pinned.has(index)) continue;
      const { limit, binds } = ceilingAt(index, balances);
      const headroom = roundDown(Math.max(0, limit - (qty[index] as number)), input.roundingValue);
      const pull = Math.min(displaced, headroom);
      if (pull <= 0) continue;

      qty[index] = (qty[index] as number) + pull;
      displaced -= pull;
      constraint[index] = 'PULL_FORWARD';
      notes[index] =
        `Pulled forward to cover ${(weeks[Math.max(limitIndex, 0)] as WeekBucket | undefined)?.week ?? 'the closed week'}.`;

      balances = roll();
      // The pull stopped where a ceiling stopped it. Which ceiling that was is
      // the single most useful sentence on the screen, so it is recorded as a
      // binding here even though the delta belongs to the pull-forward.
      if (displaced > QTY_EPSILON && binds !== null) {
        bind(binds, week.week);
        notes[index] +=
          binds === 'STORAGE_CAP'
            ? ' Capped by the warehouse ceiling, not by the vendor.'
            : " Capped by the vendor's weekly capacity.";
      }
    }
  };

  pullForwardBefore(lastClosedIndex > 0 ? lastClosedIndex : firstDisplacedIndex);

  // --- 3d. Recover the remainder, in one week rather than as dribble -------
  //
  // A recovery split across three weeks is three deliveries, three receipts
  // and three invoices for one problem. The first week after the disruption
  // that can absorb the whole remainder takes it; only if none can is it
  // spread, and then it is spread as late as the ceilings force.
  const recoverAfter = (fromIndex: number): void => {
    if (displaced <= QTY_EPSILON) return;
    const balances = roll();
    const from = Math.max(fromIndex, 0);

    let target = -1;
    for (let index = from; index < weeks.length; index += 1) {
      if ((weeks[index] as WeekBucket).isShutdown || pinned.has(index)) continue;
      const { limit } = ceilingAt(index, balances);
      if (limit - (qty[index] as number) >= displaced - QTY_EPSILON) {
        target = index;
        break;
      }
    }

    if (target !== -1) {
      qty[target] = (qty[target] as number) + displaced;
      if (constraint[target] === null) {
        constraint[target] = 'RECOVERY';
        notes[target] = 'Recovery of the safety-stock dip.';
      }
      displaced = 0;
      return;
    }

    let running = roll();
    for (let index = from; index < weeks.length && displaced > QTY_EPSILON; index += 1) {
      const week = weeks[index] as WeekBucket;
      if (week.isShutdown || pinned.has(index)) continue;
      const { limit } = ceilingAt(index, running);
      const headroom = roundDown(Math.max(0, limit - (qty[index] as number)), input.roundingValue);
      const add = Math.min(displaced, headroom);
      if (add <= 0) continue;
      qty[index] = (qty[index] as number) + add;
      displaced -= add;
      if (constraint[index] === null) {
        constraint[index] = 'RECOVERY';
        notes[index] = 'Recovery of the safety-stock dip, spread because no single week could absorb it.';
      }
      running = roll();
    }
  };

  recoverAfter(lastClosedIndex + 1);

  // --- 3e. A line below the vendor's minimum is not a line -----------------
  //
  // The quantity is displaced, not deleted. Zeroing it and walking away made
  // the two totals stop footing while the screen went on saying they matched.
  for (let index = 0; index < weeks.length; index += 1) {
    const lineQty = qty[index] as number;
    if (lineQty <= QTY_EPSILON || !input.moq || input.moq <= 0 || lineQty >= input.moq - QTY_EPSILON) continue;
    if (pinned.has(index)) continue;
    displaced += lineQty;
    qty[index] = 0;
    constraint[index] = 'MOQ';
    notes[index] = `Below the ${format(input.moq)} minimum the vendor accepts. Deferred rather than placed.`;
    bind('MOQ', (weeks[index] as WeekBucket).week);
  }

  // Whatever the minimum displaced has to land somewhere too.
  recoverAfter(0);

  // --- 3e2. Deliveries too close together are one delivery -----------------
  //
  // Declared for a long time and never enforced: the panel reported the gap as
  // slack whatever the schedule did. Two drops three days apart are two
  // receipts, two inspections and two invoices for one requirement, which is
  // the uneconomic dribble the constraint exists to prevent.
  //
  // Merged into the delivery it crowds rather than displaced, because handing
  // the quantity back to the recovery pass simply puts it in the next week —
  // which is the week the gap has just ruled out.
  if (input.minGapDays > 0) {
    let previousIndex = -1;
    for (let index = 0; index < weeks.length; index += 1) {
      const week = weeks[index] as WeekBucket;
      if ((qty[index] as number) <= QTY_EPSILON) continue;
      if (previousIndex === -1) {
        previousIndex = index;
        continue;
      }

      const previousDay = (weeks[previousIndex] as WeekBucket).deliveryDay;
      if (week.deliveryDay - previousDay >= input.minGapDays || pinned.has(index)) {
        previousIndex = index;
        continue;
      }

      const merged = qty[index] as number;
      qty[index] = 0;
      constraint[index] = 'MIN_GAP';
      notes[index] =
        `Only ${week.deliveryDay - previousDay} days after the previous delivery; ${input.minGapDays} are required. Folded into ${(weeks[previousIndex] as WeekBucket).week}.`;
      bind('MIN_GAP', week.week);

      // Into the earlier delivery, as much as its ceiling allows. Whatever
      // will not fit is displaced and reported rather than dropped.
      const balances = roll();
      const { limit } = ceilingAt(previousIndex, balances);
      const room = Math.max(0, limit - (qty[previousIndex] as number));
      const folded = Math.min(merged, room);
      qty[previousIndex] = (qty[previousIndex] as number) + folded;
      displaced += merged - folded;
    }
  }

  // --- 3f. Dates, dispatch, and the honest verdict on reachability ---------
  const balances = roll();
  const lines = weeks.map((week, index) => {
    const idealLine = ideal[index] as IdealLine;
    const lineQty = qty[index] as number;
    const deliveryEpochDay = input.planningEpochDay + week.deliveryDay;
    const dispatch = input.vendorCalendar.subtractWorkingDays(deliveryEpochDay, input.transitDays);
    const gap = input.earliestReceiptDay - week.deliveryDay;

    return {
      line: idealLine.line,
      deliveryDay: week.deliveryDay,
      deliveryDate: fromEpochDay(deliveryEpochDay),
      dispatchDate: fromEpochDay(dispatch),
      week: week.week,
      idealQty: idealLine.qty,
      qty: lineQty,
      delta: lineQty - idealLine.qty,
      balanceAfter: balances[index] as number,
      singleDropPeak: peakFromDelivery(input, week, openingOf(index, balances), lineQty),
      constraint: constraint[index] ?? null,
      note: notes[index] as string,
      insideFence: lineQty > 0 && gap > 0,
      unreachableByDays: Math.max(0, gap),
      // Arrival and availability are different days, and a schedule quoted
      // against the first is optimistic by the length of the second.
      availableDate: fromEpochDay(
        input.plantCalendar.nextWorkingDayOnOrAfter(deliveryEpochDay + input.qaQuarantineDays)
      ),
      unloadDays:
        input.dailyReceivingCapacity && input.dailyReceivingCapacity > 0
          ? Math.max(1, Math.ceil(lineQty / input.dailyReceivingCapacity))
          : 1,
      split: splitAcrossSources(lineQty, input),
    };
  });

  for (const line of lines) if (line.insideFence) bind('FROZEN_ZONE', line.week);

  return { lines, bindings, unplaced: displaced > QTY_EPSILON ? displaced : 0 };
}

/**
 * One line, divided across the sources that supply it.
 *
 * The 60:40 nobody can defend, made visible on the delivery rather than left in
 * the master data. Rounded to whole units with the remainder on the largest
 * share, so the parts sum to the line — a split that does not add up is worse
 * than no split at all.
 */
function splitAcrossSources(
  qty: number,
  input: DeliveryScheduleInput
): Array<{ vendorId: string; vendorName: string | null; qty: number }> {
  const sources = input.sourceSplit.filter((source) => source.share > 0);
  if (qty <= QTY_EPSILON || sources.length <= 1) return [];

  const total = sources.reduce((sum, source) => sum + source.share, 0);
  const parts = sources.map((source) => ({
    vendorId: source.vendorId,
    vendorName: source.vendorName,
    qty: Math.round((qty * source.share) / total),
  }));

  const largest = parts.reduce(
    (best, part, index) => (part.qty > (parts[best] as (typeof parts)[number]).qty ? index : best),
    0
  );
  const drift = qty - parts.reduce((sum, part) => sum + part.qty, 0);
  (parts[largest] as (typeof parts)[number]).qty += drift;
  return parts;
}

/** Down to a whole multiple. A part-pallet is not a thing a vendor ships. */
function roundDown(value: number, increment: number | null): number {
  if (!increment || increment <= 0) return value;
  return Math.floor(value / increment) * increment;
}

// ---------------------------------------------------------------------------
// Step 4 — the delta ledger. Every unit of difference, attributed.
// ---------------------------------------------------------------------------

function attributeDeltas(ideal: IdealLine[], committed: CommittedLine[]): ScheduleDelta[] {
  const deltas: ScheduleDelta[] = [];

  for (let index = 0; index < committed.length; index += 1) {
    const line = committed[index] as CommittedLine;
    // The same tolerance every other decision uses. Weekly requirements are
    // summed from daily buckets, so an exact match arrives as a difference of
    // 1e-11 — and an exact-equality test turns that into a ledger row.
    if (Math.abs(line.delta) <= QTY_EPSILON) continue;
    deltas.push({
      week: line.week,
      deliveryDate: line.deliveryDate,
      idealQty: (ideal[index] as IdealLine).qty,
      committedQty: line.qty,
      delta: line.delta,
      // Every moved unit names its cause, or the schedule does not go out.
      // Guessing here — positive is a recovery, negative is vendor capacity —
      // is worse than an empty field: it prints a constraint the panel beside
      // it may not even list, and does it in the one place the product asks to
      // be trusted.
      constraint: line.constraint,
      note: line.note,
    });
  }

  return deltas;
}

/**
 * Everything that stops this schedule being sent.
 *
 * A delta with no named constraint is the headline case, and it is a defect in
 * the engine rather than a judgement about the plan — which is exactly why it
 * must surface rather than be absorbed.
 */
function findBlockingViolations(deltas: ScheduleDelta[], committed: CommittedLine[]): ScheduleViolation[] {
  const violations: ScheduleViolation[] = [];

  for (const delta of deltas) {
    if (delta.constraint !== null) continue;
    const line = committed.find((row) => row.week === delta.week);
    violations.push({
      line: line?.line ?? null,
      week: delta.week,
      constraint: 'UNATTRIBUTED',
      qty: delta.delta,
      message: `${format(Math.abs(delta.delta))} moved in ${delta.week} with no constraint named. The schedule cannot be sent until the engine can say why.`,
    });
  }

  return violations;
}

/** Findings worth stating that are not reasons to stop. */
function findAdvisories(
  input: DeliveryScheduleInput,
  committed: CommittedLine[],
  residual: ResidualExposure | null
): ScheduleAdvisory[] {
  const advisories: ScheduleAdvisory[] = [];

  if (residual !== null) {
    advisories.push({
      line: null,
      week: residual.weeks[0] ?? null,
      kind: 'RESIDUAL_EXPOSURE',
      message: `${format(residual.shortfall)} below safety stock in ${residual.weeks.join(' and ')} — about ${residual.shortfallDays.toFixed(1)} days of cover${residual.recoveredIn ? `, recovered in ${residual.recoveredIn}` : ''}.`,
    });
  }

  for (const line of committed) {
    if (!line.insideFence) continue;
    advisories.push({
      line: line.line,
      week: line.week,
      kind: 'INSIDE_FENCE',
      message: `Line ${line.line} is needed ${line.unreachableByDays} days before a newly placed order could arrive. It cannot be closed by ordering.`,
    });
  }

  // The warehouse ceiling was checked as call-offs. Where one truck would not
  // fit, that assumption is doing real work and the vendor has to be told.
  const cap = input.storageCapacity;
  if (cap !== null && cap > 0) {
    for (const line of committed) {
      if (line.qty <= QTY_EPSILON || line.singleDropPeak <= cap + QTY_EPSILON) continue;
      advisories.push({
        line: line.line,
        week: line.week,
        kind: 'CALL_OFF_REQUIRED',
        message: `Line ${line.line} fits only as call-offs through ${line.week}. As one drop on ${line.deliveryDate} it would put ${format(line.singleDropPeak)} ${input.baseUom} on the floor against a ${format(cap)} ceiling.`,
      });
    }
  }

  return advisories;
}

// ---------------------------------------------------------------------------
// Step 5 — what the committed schedule does not cover
// ---------------------------------------------------------------------------

function measureResidual(
  input: DeliveryScheduleInput,
  weeks: WeekBucket[],
  committed: CommittedLine[]
): ResidualExposure | null {
  const exposed: string[] = [];
  let worst = 0;
  let stocksOut = false;
  let lastExposedIndex = -1;

  for (let index = 0; index < committed.length; index += 1) {
    const balance = (committed[index] as CommittedLine).balanceAfter;
    if (balance < -QTY_EPSILON) stocksOut = true;
    if (balance < input.safetyStock - QTY_EPSILON) {
      exposed.push((weeks[index] as WeekBucket).week);
      worst = Math.max(worst, input.safetyStock - balance);
      lastExposedIndex = index;
    }
  }

  if (exposed.length === 0) return null;

  const recovered = committed.slice(lastExposedIndex + 1).find((line) => line.balanceAfter >= input.safetyStock)?.week;

  return {
    weeks: exposed,
    shortfall: worst,
    shortfallDays: input.dailyDemandMean > 0 ? worst / input.dailyDemandMean : 0,
    recoveredIn: recovered ?? null,
    stocksOut,
  };
}

// ---------------------------------------------------------------------------
// Step 6 — the constraint set, binding and not
// ---------------------------------------------------------------------------

function summariseConstraints(
  input: DeliveryScheduleInput,
  ideal: IdealLine[],
  committed: CommittedLine[],
  bindings: Map<ConstraintKey, string[]>
): ConstraintSummary[] {
  const bound = bindings;
  const summaries: ConstraintSummary[] = [];

  const add = (key: ConstraintKey, value: number | null, binding: boolean, note: string): void => {
    summaries.push({ key, label: CONSTRAINT_LABEL[key], binding, value, note });
  };

  if (input.moq && input.moq > 0) {
    const bindsOnIdeal = ideal.some((line) => line.lotSizingReason === 'MOQ');
    add(
      'MOQ',
      input.moq,
      bindsOnIdeal || bound.has('MOQ'),
      bindsOnIdeal || bound.has('MOQ')
        ? `Every line has to clear ${format(input.moq)}.`
        : `Every line already clears the ${format(input.moq)} minimum.`
    );
  }
  if (input.roundingValue && input.roundingValue > 0) {
    const binds = ideal.some((line) => line.lotSizingReason === 'ROUNDING');
    add(
      'ROUNDING',
      input.roundingValue,
      binds,
      binds
        ? `Lines are rounded up to whole multiples of ${format(input.roundingValue)}.`
        : `All lines are already whole multiples of ${format(input.roundingValue)}.`
    );
  }
  if (input.weeklyCapacity && input.weeklyCapacity > 0) {
    const binds = bound.has('VENDOR_CAPACITY');
    add(
      'VENDOR_CAPACITY',
      input.weeklyCapacity,
      binds,
      binds
        ? `The vendor cannot exceed ${format(input.weeklyCapacity)} in a week.`
        : `The vendor could supply ${format(input.weeklyCapacity)} a week and is not the limit here.`
    );
  }
  if (input.storageCapacity && input.storageCapacity > 0) {
    const binds = bound.has('STORAGE_CAP');
    const peak = committed.reduce((max, line) => Math.max(max, line.balanceAfter), 0);
    add(
      'STORAGE_CAP',
      input.storageCapacity,
      binds,
      binds
        ? `The plant holds ${format(input.storageCapacity)} of this item at most, and the schedule reaches it. Checked against each week's closing balance, which assumes the week is called off in daily drops.`
        : `Peak holding is ${format(peak)} against ${format(input.storageCapacity)} of space, at week end with daily call-offs.`
    );
  }
  if (input.productionShutdownWeeks.length > 0) {
    const binds = bound.has('VENDOR_SHUTDOWN');
    const weeks = input.productionShutdownWeeks.map((monday) => weekLabel(monday)).join(', ');
    add(
      'VENDOR_SHUTDOWN',
      null,
      binds,
      binds
        ? `Vendor plant shutdown in ${weeks}. Production stops; dispatch of stock built beforehand does not.`
        : `Vendor shutdown in ${weeks} falls outside this schedule.`
    );
  }
  if (input.minGapDays > 0) {
    // Reported from what the schedule actually did, rather than hardcoded to
    // slack. It said "slack" whatever happened for as long as it existed.
    const binds = bound.has('MIN_GAP');
    add(
      'MIN_GAP',
      input.minGapDays,
      binds,
      binds
        ? `Deliveries must be at least ${input.minGapDays} days apart, and a line was merged to keep them so.`
        : `Deliveries must be at least ${input.minGapDays} days apart, and every one of these is.`
    );
  }
  if (input.maxLotSize && input.maxLotSize > 0) {
    const binds = bound.has('MAX_LOT') || committed.some((line) => line.qty >= (input.maxLotSize as number));
    add(
      'MAX_LOT',
      input.maxLotSize,
      binds,
      binds
        ? `No delivery can exceed ${format(input.maxLotSize)}, and the schedule reaches it.`
        : `The largest delivery is well inside the ${format(input.maxLotSize)} ceiling.`
    );
  }
  if (input.shelfLifeDays && input.shelfLifeDays > 0) {
    const binds = bound.has('SHELF_LIFE');
    add(
      'SHELF_LIFE',
      input.shelfLifeDays,
      binds,
      binds
        ? `The material keeps ${input.shelfLifeDays} days, and the schedule is capped by how much can be used before it stops being material.`
        : `The material keeps ${input.shelfLifeDays} days — more forward cover than this schedule ever builds.`
    );
  }
  if (input.dailyReceivingCapacity && input.dailyReceivingCapacity > 0) {
    const longest = committed.reduce((max, line) => Math.max(max, line.unloadDays), 0);
    add(
      'RECEIVING_CAPACITY',
      input.dailyReceivingCapacity,
      longest > 1,
      longest > 1
        ? `The largest delivery takes ${longest} days to unload at ${format(input.dailyReceivingCapacity)} a day.`
        : `Every delivery clears the dock in a day at ${format(input.dailyReceivingCapacity)}.`
    );
  }
  if (input.qaQuarantineDays > 0) {
    add(
      'QA_QUARANTINE',
      input.qaQuarantineDays,
      true,
      `Nothing is usable for ${input.qaQuarantineDays} day${input.qaQuarantineDays === 1 ? '' : 's'} after it arrives. Every line carries an available date as well as a delivery date.`
    );
  }
  if (input.sourceSplit.length > 1) {
    add(
      'SOURCE_SPLIT',
      input.sourceSplit.length,
      true,
      `Each line divides across ${input.sourceSplit.length} sources: ${input.sourceSplit
        .map((source) => `${source.vendorName ?? source.vendorId} ${Math.round(source.share * 100)}%`)
        .join(', ')}.`
    );
  }

  const unreachable = committed.filter((line) => line.insideFence);
  add(
    'FROZEN_ZONE',
    input.earliestReceiptDay,
    unreachable.length > 0,
    unreachable.length > 0
      ? `${unreachable.length} ${unreachable.length === 1 ? 'line falls' : 'lines fall'} inside the lead-time fence and cannot be reached by a new order.`
      : 'Every line falls beyond the lead-time fence and can be ordered.'
  );

  return summaries;
}

// ---------------------------------------------------------------------------
// Step 7 — the ledger, in the words a planner would use
// ---------------------------------------------------------------------------

/**
 * The ledger is assembled from the constraint objects, clause by clause. Every
 * sentence is conditional on a fact, so a material with slack capacity produces
 * a shorter ledger rather than the same ledger with different numbers in it.
 * Templated prose is the fastest way to make a tool feel fake, and this is the
 * panel a planner reads most closely.
 */
function buildLedger(
  input: DeliveryScheduleInput,
  ideal: IdealLine[],
  committed: CommittedLine[],
  deltas: ScheduleDelta[],
  constraints: ConstraintSummary[],
  bindings: Map<ConstraintKey, string[]>,
  residual: ResidualExposure | null
): string[] {
  const entries: string[] = [];

  // Said first, because it decides how to read every number after it.
  const onOrder = ideal.filter((line) => line.existingReceipts > QTY_EPSILON);
  if (onOrder.length > 0) {
    const total = onOrder.reduce((sum, line) => sum + line.existingReceipts, 0);
    entries.push(
      `${format(total)} ${input.baseUom} is already on order or in quality across ${onOrder.map((line) => line.week).join(', ')}. This schedule is in addition to it, not in place of it.`
    );
  }

  const shutdown = deltas.filter((delta) => delta.constraint === 'VENDOR_SHUTDOWN');
  for (const delta of shutdown) {
    entries.push(
      `${format(Math.abs(delta.delta))} moved out of ${delta.week}. ${delta.note} Production stops that week; dispatch of stock built beforehand does not.`
    );
  }

  const cappedWeeks = [...(bindings.get('STORAGE_CAP') ?? []), ...(bindings.get('VENDOR_CAPACITY') ?? [])];
  if (cappedWeeks.length > 0) {
    const storage = constraints.find((row) => row.key === 'STORAGE_CAP');
    const capacity = constraints.find((row) => row.key === 'VENDOR_CAPACITY');
    const weeks = [...new Set(cappedWeeks)].join(' and ');
    if (storage?.binding && capacity && !capacity.binding && capacity.value !== null && storage.value !== null) {
      // The beat worth having: the constraint that binds is not the one anyone
      // expects. Empty bottles are the problem, not the vendor.
      entries.push(
        `Deliveries capped in ${weeks}. The binding constraint is not vendor capacity — the vendor could supply ${format(capacity.value)} in each week. It is the warehouse volumetric ceiling of ${format(storage.value)} for this item.`
      );
    } else if (capacity?.binding && capacity.value !== null && !storage?.binding) {
      entries.push(`Deliveries capped in ${weeks} by the vendor's weekly capacity of ${format(capacity.value)}.`);
    } else if (storage?.binding && storage.value !== null) {
      entries.push(`Deliveries capped in ${weeks} by the warehouse volumetric ceiling of ${format(storage.value)}.`);
    }
  }

  const pulled = deltas.filter((delta) => delta.constraint === 'PULL_FORWARD' || delta.constraint === 'RECOVERY');
  if (pulled.length > 0) {
    const total = pulled.reduce((sum, delta) => sum + delta.delta, 0);
    entries.push(
      `${format(total)} pulled into ${pulled.map((delta) => delta.week).join(', ')} to cover what the closed week cannot supply.`
    );
  }

  if (residual) {
    const weeks = residual.weeks.join(' and ');
    const recovery = residual.recoveredIn ? ` Recovered in ${residual.recoveredIn}.` : ' Not recovered in this window.';
    entries.push(
      residual.stocksOut
        ? `Residual exposure: the balance goes below zero in ${weeks}. This is a stock-out, not a dip into the buffer.${recovery}`
        : `Residual exposure: ${format(residual.shortfall)} below safety stock in ${weeks} — about ${residual.shortfallDays.toFixed(1)} days of cover. Safety stock is not fully consumed and there is no stock-out at any point.${recovery}`
    );
  } else {
    entries.push('The committed schedule holds the buffer in every week. No residual exposure.');
  }

  const lotSizing = ideal.filter((line) => line.lotSizingAddition > 0);
  if (lotSizing.length === 0) {
    const moq = constraints.find((row) => row.key === 'MOQ');
    const rounding = constraints.find((row) => row.key === 'ROUNDING');
    if (moq || rounding) {
      entries.push(
        `No minimum-order or rounding adjustment required. All committed lines are whole multiples${moq?.value ? ` and above the ${format(moq.value)} minimum` : ''}.`
      );
    }
  } else {
    const added = lotSizing.reduce((sum, line) => sum + line.lotSizingAddition, 0);
    entries.push(
      `${format(added)} ${input.baseUom} of the schedule is lot sizing rather than requirement, across ${lotSizing.length} ${lotSizing.length === 1 ? 'line' : 'lines'}. That quantity is need created by a rule, not by demand.`
    );
  }

  const unreachable = committed.filter((line) => line.insideFence);
  if (unreachable.length > 0) {
    // The *first* line's gap, because that is what the sentence claims. It
    // happens to be the largest — the gap shrinks as the delivery date grows —
    // but agreeing by accident of ordering is not the same as agreeing.
    const worst = unreachable.reduce(
      (earliest, line) => (line.deliveryDay < earliest.deliveryDay ? line : earliest),
      unreachable[0] as CommittedLine
    ).unreachableByDays;
    entries.push(
      `${unreachable.length} ${unreachable.length === 1 ? 'line is' : 'lines are'} required before a newly placed order could arrive — the first by ${worst} days. Those cannot be closed by ordering.`
    );
  }

  const idealTotal = ideal.reduce((sum, line) => sum + line.qty, 0);
  const committedTotal = committed.reduce((sum, line) => sum + line.qty, 0);
  if (Math.abs(idealTotal - committedTotal) > 0.5) {
    entries.push(
      `The committed schedule carries ${format(Math.abs(idealTotal - committedTotal))} ${committedTotal < idealTotal ? 'less' : 'more'} than the ideal one in total.`
    );
  }

  return entries;
}

/**
 * Ways to close the residual.
 *
 * Only the ones the constraint set actually supports are offered. Inventing a
 * lever that does not exist is worse than offering none, because a planner will
 * spend a phone call finding out.
 */
function closingOptions(
  input: DeliveryScheduleInput,
  constraints: ConstraintSummary[],
  residual: ResidualExposure | null
): string[] {
  if (!residual) return [];
  const options: string[] = [];

  options.push(
    residual.stocksOut
      ? `Accept it — but this is a stock-out, not a dip. ${format(residual.shortfall)} of demand goes unmet.`
      : `Accept it — ${residual.shortfallDays.toFixed(1)} days into a buffer sized for ${(input.safetyStock / Math.max(input.dailyDemandMean, 1)).toFixed(1)}.`
  );

  const shutdown = constraints.find((row) => row.key === 'VENDOR_SHUTDOWN');
  if (shutdown?.binding) {
    options.push(
      `Ask the vendor to dispatch ${format(residual.shortfall)} during the shutdown from finished stock built ahead of it. The shutdown stops production, not dispatch.`
    );
  }

  const storage = constraints.find((row) => row.key === 'STORAGE_CAP');
  if (storage?.binding) {
    options.push(
      `Take ${format(residual.shortfall)} of external floor space in the pull-forward week to lift the volumetric ceiling.`
    );
  }

  const capacity = constraints.find((row) => row.key === 'VENDOR_CAPACITY');
  if (capacity?.binding) {
    options.push('Ask the vendor for an extra shift, or split the shortfall to a second approved source.');
  }

  return options;
}

function format(value: number): string {
  return Math.round(value).toLocaleString('en-IN');
}
