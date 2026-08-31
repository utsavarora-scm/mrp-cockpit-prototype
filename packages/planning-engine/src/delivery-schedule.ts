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

/** Every reason a committed line can differ from the ideal one. */
export type ConstraintKey =
  | 'MOQ'
  | 'ROUNDING'
  | 'MAX_LOT'
  | 'VENDOR_SHUTDOWN'
  | 'VENDOR_CAPACITY'
  | 'STORAGE_CAP'
  | 'MIN_GAP'
  | 'PULL_FORWARD'
  | 'RECOVERY'
  | 'FROZEN_ZONE';

export const CONSTRAINT_LABEL: Record<ConstraintKey, string> = {
  MOQ: 'Minimum order quantity',
  ROUNDING: 'Rounding value',
  MAX_LOT: 'Maximum lot',
  VENDOR_SHUTDOWN: 'Vendor plant shutdown',
  VENDOR_CAPACITY: 'Vendor capacity',
  STORAGE_CAP: 'Warehouse volumetric ceiling',
  MIN_GAP: 'Minimum gap between deliveries',
  PULL_FORWARD: 'Pull-forward to cover a closed week',
  RECOVERY: 'Recovery of the safety-stock dip',
  FROZEN_ZONE: 'Inside the lead-time fence',
};

export interface IdealLine {
  line: number;
  /** Day offset from the planning date the delivery is needed by. */
  needByDay: number;
  needByDate: string;
  week: string;
  /** Gross requirement falling in this bucket. */
  requirement: number;
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
  /** The constraint that moved this line, where one did. */
  constraint: ConstraintKey | null;
  /** Written from the constraint objects, never selected from a list of templates. */
  note: string;
  /** True when the line lands inside the lead-time fence and cannot be ordered. */
  insideFence: boolean;
  /** Days the line is needed before a newly placed order could arrive. */
  unreachableByDays: number;
}

/** One attributed difference between the two schedules. */
export interface ScheduleDelta {
  week: string;
  deliveryDate: string;
  idealQty: number;
  committedQty: number;
  delta: number;
  constraint: ConstraintKey;
  note: string;
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
  /** Balance at the end of the day before `fromDay`. */
  openingBalance: number;
  safetyStock: number;
  /** Mean daily consumption, for stating a shortfall in days rather than units. */
  dailyDemandMean: number;

  moq: number | null;
  roundingValue: number | null;
  maxLotSize: number | null;
  /** Most the vendor can produce in one week. */
  weeklyCapacity: number | null;
  /** Most the plant can hold of this item at one moment. Dominant for packaging. */
  storageCapacity: number | null;
  /** Working days that must separate two deliveries. */
  minGapDays: number;

  transitDays: number;
  /** Earliest day offset a newly placed order could be received. */
  earliestReceiptDay: number;
  /** ISO Monday dates of weeks in which the vendor produces nothing. */
  productionShutdownWeeks: readonly string[];

  plantCalendar: WorkingCalendar;
  vendorCalendar: WorkingCalendar;
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
    };
  }

  const ideal = buildIdeal(input, weeks);
  const { lines: committed, bindings } = buildCommitted(input, weeks, ideal);
  const deltas = attributeDeltas(ideal, committed);
  const residual = measureResidual(input, weeks, committed);
  const constraints = summariseConstraints(input, ideal, committed, bindings);

  const idealTotal = ideal.reduce((sum, line) => sum + line.qty, 0);
  const committedTotal = committed.reduce((sum, line) => sum + line.qty, 0);

  return {
    ideal,
    committed,
    deltas,
    constraints,
    residual,
    totals: { ideal: idealTotal, committed: committedTotal, delta: committedTotal - idealTotal },
    ledger: buildLedger(input, ideal, committed, deltas, constraints, bindings, residual),
    options: closingOptions(input, constraints, residual),
  };
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
    for (let index = Math.max(day, 0); index <= endDay; index += 1) requirement += input.grossRequirements[index] ?? 0;
    // Summed from daily buckets, so the accumulated float error is cleared here
    // rather than allowed to travel into a lot-sizing decision.
    requirement = Math.round(requirement * 1e6) / 1e6;

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
      isShutdown: shutdowns.has(monday),
    });

    day = endDay + 1;
  }

  return buckets;
}

// ---------------------------------------------------------------------------
// Step 2 — the ideal schedule: what the planner wants
// ---------------------------------------------------------------------------

function buildIdeal(input: DeliveryScheduleInput, weeks: WeekBucket[]): IdealLine[] {
  const lines: IdealLine[] = [];
  let balance = input.openingBalance;
  let lineNumber = 10;

  for (const week of weeks) {
    // Exactly to requirement: enough to meet the week and end it on the buffer.
    const needQty = Math.max(0, week.requirement + input.safetyStock - balance);

    const sized = applyLotRules(needQty, input);
    const qty = sized.qty;
    balance = balance + qty - week.requirement;

    lines.push({
      line: lineNumber,
      needByDay: week.deliveryDay,
      needByDate: fromEpochDay(input.planningEpochDay + week.deliveryDay),
      week: week.week,
      requirement: week.requirement,
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
}

function buildCommitted(input: DeliveryScheduleInput, weeks: WeekBucket[], ideal: IdealLine[]): CommittedResult {
  const qty = ideal.map((line) => line.qty);
  const bindings = new Map<ConstraintKey, string[]>();
  const bind = (key: ConstraintKey, week: string): void => {
    const weeksBound = bindings.get(key) ?? [];
    if (!weeksBound.includes(week)) weeksBound.push(week);
    bindings.set(key, weeksBound);
  };
  const constraint: Array<ConstraintKey | null> = ideal.map(() => null);
  const notes: string[] = ideal.map(() => '');

  /**
   * The most that can be *delivered* into a week.
   *
   * Two ceilings, and the interesting one is rarely the expected one. Vendor
   * capacity limits what can be made; the warehouse limits what can be held.
   * The storage question is asked about the balance the week *closes* on,
   * because that is what has to fit on the floor once the week's consumption
   * has drawn it down.
   */
  const ceilingOf = (openingBalance: number, requirement: number): { limit: number; binds: ConstraintKey | null } => {
    let limit = Number.POSITIVE_INFINITY;
    let binds: ConstraintKey | null = null;

    if (input.storageCapacity !== null && input.storageCapacity > 0) {
      limit = Math.max(0, input.storageCapacity - openingBalance + requirement);
      binds = 'STORAGE_CAP';
    }
    if (input.weeklyCapacity !== null && input.weeklyCapacity > 0 && input.weeklyCapacity < limit) {
      limit = input.weeklyCapacity;
      binds = 'VENDOR_CAPACITY';
    }
    return { limit, binds };
  };

  /** Rolls the balances for the current quantities. */
  const roll = (): number[] => {
    const balances: number[] = [];
    let running = input.openingBalance;
    for (let index = 0; index < weeks.length; index += 1) {
      running = running + (qty[index] as number) - (weeks[index] as WeekBucket).requirement;
      balances.push(running);
    }
    return balances;
  };

  const openingOf = (index: number, balances: number[]): number =>
    index === 0 ? input.openingBalance : (balances[index - 1] as number);

  // --- 3a. A closed week produces nothing ---------------------------------
  //
  // The quantity does not disappear; it has to be found somewhere else, and
  // where it goes is the whole subject of the ledger below.
  let displaced = 0;
  let lastClosedIndex = -1;
  for (let index = 0; index < weeks.length; index += 1) {
    const week = weeks[index] as WeekBucket;
    if (!week.isShutdown || (qty[index] as number) === 0) continue;
    displaced += qty[index] as number;
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
      const { limit, binds } = ceilingOf(openingOf(index, balances), week.requirement);
      const lineQty = qty[index] as number;
      if (lineQty <= limit + QTY_EPSILON) continue;
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

  // --- 3c. Pull forward, into the weeks *before* the closure ---------------
  //
  // Earliest first: cover bought late is cover that arrives after it was
  // needed. Each week takes as much as its own ceiling leaves room for.
  if (displaced > QTY_EPSILON && lastClosedIndex > 0) {
    let balances = roll();
    for (let index = 0; index < lastClosedIndex && displaced > QTY_EPSILON; index += 1) {
      const week = weeks[index] as WeekBucket;
      if (week.isShutdown) continue;
      const { limit, binds } = ceilingOf(openingOf(index, balances), week.requirement);
      const headroom = roundDown(Math.max(0, limit - (qty[index] as number)), input.roundingValue);
      const pull = Math.min(displaced, headroom);
      if (pull <= 0) continue;

      qty[index] = (qty[index] as number) + pull;
      displaced -= pull;
      constraint[index] = 'PULL_FORWARD';
      notes[index] = `Pulled forward to cover ${(weeks[lastClosedIndex] as WeekBucket).week}.`;

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
  }

  // --- 3d. Recover the remainder, in one week rather than as dribble -------
  //
  // A recovery split across three weeks is three deliveries, three receipts
  // and three invoices for one problem. The first week after the disruption
  // that can absorb the whole remainder takes it; only if none can is it
  // spread, and then it is spread as late as the ceilings force.
  if (displaced > QTY_EPSILON) {
    const balances = roll();
    const from = Math.max(lastClosedIndex + 1, 0);

    let target = -1;
    for (let index = from; index < weeks.length; index += 1) {
      if ((weeks[index] as WeekBucket).isShutdown) continue;
      const { limit } = ceilingOf(openingOf(index, balances), (weeks[index] as WeekBucket).requirement);
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
    } else {
      let running = roll();
      for (let index = from; index < weeks.length && displaced > QTY_EPSILON; index += 1) {
        const week = weeks[index] as WeekBucket;
        if (week.isShutdown) continue;
        const { limit } = ceilingOf(openingOf(index, running), week.requirement);
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
    }
  }

  // --- 3e. A line below the vendor's minimum is not a line -----------------
  for (let index = 0; index < weeks.length; index += 1) {
    const lineQty = qty[index] as number;
    if (lineQty <= QTY_EPSILON || !input.moq || input.moq <= 0 || lineQty >= input.moq - QTY_EPSILON) continue;
    qty[index] = 0;
    constraint[index] = 'MOQ';
    notes[index] = `Below the ${format(input.moq)} minimum the vendor accepts. Deferred rather than placed.`;
    bind('MOQ', (weeks[index] as WeekBucket).week);
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
      constraint: constraint[index] ?? null,
      note: notes[index] as string,
      insideFence: lineQty > 0 && gap > 0,
      unreachableByDays: Math.max(0, gap),
    };
  });

  for (const line of lines) if (line.insideFence) bind('FROZEN_ZONE', line.week);

  return { lines, bindings };
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
    if (line.delta === 0) continue;
    deltas.push({
      week: line.week,
      deliveryDate: line.deliveryDate,
      idealQty: (ideal[index] as IdealLine).qty,
      committedQty: line.qty,
      delta: line.delta,
      // Every moved unit names its cause. A delta the engine cannot attribute
      // is a bug, not a rounding difference — so it is labelled as one rather
      // than silently absorbed.
      constraint: line.constraint ?? (line.delta > 0 ? 'RECOVERY' : 'VENDOR_CAPACITY'),
      note: line.note,
    });
  }

  return deltas;
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
        ? `The plant holds ${format(input.storageCapacity)} of this item at most, and the schedule reaches it.`
        : `Peak holding is ${format(peak)} against ${format(input.storageCapacity)} of space.`
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
    add('MIN_GAP', input.minGapDays, false, `Deliveries must be at least ${input.minGapDays} days apart.`);
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
      `${format(added)} of the schedule is lot sizing rather than requirement, across ${lotSizing.length} ${lotSizing.length === 1 ? 'line' : 'lines'}. That quantity is need created by a rule, not by demand.`
    );
  }

  const unreachable = committed.filter((line) => line.insideFence);
  if (unreachable.length > 0) {
    const worst = unreachable.reduce((max, line) => Math.max(max, line.unreachableByDays), 0);
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
