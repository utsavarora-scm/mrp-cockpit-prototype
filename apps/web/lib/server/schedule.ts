/**
 * Screen 3 — the supply timeline and the purchase-order schedule builder.
 *
 * The sponsor's headline ask, made a screen: *if I am generating a purchase
 * order from MRP, divide it into the parts in which I would ideally need my
 * deliveries to happen.*
 *
 * Upper half, the inbound timeline: every open order on a track, each schedule
 * line with the stage it has reached and the slip against what was asked for.
 * Lower half, the builder: the ideal schedule, the committable one, and the
 * ledger that attributes every unit of difference to a named constraint.
 *
 * The window is derived, not typed in. A campaign material is scheduled over
 * its campaign; everything else over the window its own lead time implies, and
 * the screen says which and why.
 */

import { fromEpochDay, planKey, startOfWeek, toEpochDay, weekLabel } from '@repo/domain';
import {
  buildDeliverySchedule,
  CONSTRAINT_LABEL,
  FALLBACK_CALENDAR,
  WorkingCalendar,
  type ConstraintKey,
} from '@repo/planning-engine';

import type {
  ConstraintView,
  ProposedCorrectionView,
  ScheduleAdvisoryView,
  ScheduleBuilderView,
  ScheduleLineView,
  ScheduleViolationView,
} from '../api-types';
import { runContext, type MaterialFacts, type RunContext } from './context';
import { runHeader } from './header';
import { buildOrders } from './material';
import { builderEditsFor } from './planning-session';

/** Shortest and longest window worth building a delivery schedule over. */
const MIN_WINDOW_DAYS = 28;
const MAX_WINDOW_DAYS = 84;

export function scheduleBuilder(
  scenarioId: string,
  itemId: string,
  plantId: string,
  overrides: { windowDays?: number } = {},
): ScheduleBuilderView | null {
  const context = runContext(scenarioId);
  const facts = context.materials.get(planKey(itemId, plantId));
  if (!facts) return null;

  const window = resolveWindow(facts, context, overrides.windowDays);
  const openingBalance =
    window.fromDay === 0 ? facts.plan.openingStock : (facts.plan.projectedBeforePlanned[window.fromDay - 1] as number);

  const plantCalendar =
    context.calendarForPlant.get(plantId) ??
    new WorkingCalendar(FALLBACK_CALENDAR, context.planningDate, context.horizonDays);
  const vendorCalendarId = context.snapshot.vendors.find((row) => row.id === facts.vendor?.vendorId)?.calendarId;
  const vendorCalendar = vendorCalendarId
    ? new WorkingCalendar(
        context.snapshot.calendars.find((row) => row.id === vendorCalendarId) ?? FALLBACK_CALENDAR,
        context.planningDate,
        context.horizonDays,
      )
    : plantCalendar;

  const shutdownWeeks =
    context.snapshot.vendors.find((row) => row.id === facts.vendor?.vendorId)?.productionShutdownWeeks ?? [];

  const plannerLines = builderEditsFor(itemId, plantId).map((edit) => ({ line: edit.line, qty: edit.qty }));

  const result = buildDeliverySchedule({
    baseUom: facts.baseUom,
    plannerLines,
    itemId,
    plantId,
    vendorId: facts.vendor?.vendorId ?? null,
    planningEpochDay: context.planningEpochDay,
    fromDay: window.fromDay,
    toDay: window.toDay,
    grossRequirements: facts.plan.grossRequirements,
    // The same dated supply the grid nets: open delivery lines and quality
    // releases. Proposed deliveries are in addition to these, never instead.
    scheduledReceipts: facts.plan.scheduledReceipts,
    openingBalance,
    safetyStock: facts.plan.safetyStock,
    dailyDemandMean: facts.dailyDemandMean,
    moq: facts.itemPlant.minLotSize,
    roundingValue: facts.itemPlant.roundingValue,
    maxLotSize: facts.itemPlant.maxLotSize,
    weeklyCapacity: facts.vendor?.weeklyCapacity ?? null,
    storageCapacity: facts.itemPlant.storageCapacity,
    minGapDays: facts.vendor?.minGapDays ?? 0,
    dailyReceivingCapacity: facts.itemPlant.dailyReceivingCapacity,
    shelfLifeDays: facts.shelfLifeDays,
    qaQuarantineDays: facts.itemPlant.qaQuarantineDays,
    // The sourcing split, on the delivery rather than buried in master data.
    sourceSplit: facts.vendors
      .filter((vendor) => vendor.allocationShare > 0)
      .map((vendor) => ({
        vendorId: vendor.vendorId,
        vendorName: context.snapshot.vendors.find((row) => row.id === vendor.vendorId)?.name ?? null,
        share: vendor.allocationShare,
      })),
    transitDays: (facts.vendor?.transitDays ?? 0) + (facts.vendor?.customsDays ?? 0),
    earliestReceiptDay: facts.fences.maintained.earliestReceiptDay,
    productionShutdownWeeks: shutdownWeeks,
    plantCalendar,
    vendorCalendar,
  });

  const lines: ScheduleLineView[] = result.committed.map((committed, index) => {
    const ideal = result.ideal[index];
    return {
      line: committed.line,
      week: committed.week,
      date: committed.deliveryDate,
      dispatchDate: committed.dispatchDate,
      requirement: round(ideal?.requirement ?? 0),
      existingReceipts: round(ideal?.existingReceipts ?? 0),
      needQty: round(ideal?.needQty ?? 0),
      lotSizingAddition: round(ideal?.lotSizingAddition ?? 0),
      idealQty: round(committed.idealQty),
      committedQty: round(committed.qty),
      delta: round(committed.delta),
      balanceAfter: round(committed.balanceAfter),
      constraint: committed.constraint,
      constraintLabel: committed.constraint === null ? null : CONSTRAINT_LABEL[committed.constraint as ConstraintKey],
      note: committed.note,
      insideFence: committed.insideFence,
      unreachableByDays: committed.unreachableByDays,
    };
  });

  const constraints: ConstraintView[] = result.constraints.map((row) => ({
    key: row.key,
    label: row.label,
    binding: row.binding,
    value: row.value === null ? null : round(row.value),
    note: row.note,
  }));

  return {
    header: runHeader(context),
    itemId,
    plantId,
    description: facts.description,
    baseUom: facts.baseUom,
    vendorId: facts.vendor?.vendorId ?? null,
    vendorName: facts.vendorName,
    safetyStock: facts.plan.safetyStock,
    openingBalance: round(openingBalance),
    window: {
      fromDate: fromEpochDay(context.planningEpochDay + window.fromDay),
      toDate: fromEpochDay(context.planningEpochDay + window.toDay),
      fromWeek: weekLabel(fromEpochDay(context.planningEpochDay + window.fromDay)),
      toWeek: weekLabel(fromEpochDay(context.planningEpochDay + window.toDay)),
      days: window.toDay - window.fromDay + 1,
      reason: window.reason,
    },
    lines,
    totals: {
      ideal: round(result.totals.ideal),
      committed: round(result.totals.committed),
      delta: round(result.totals.delta),
    },
    constraints,
    ledger: result.ledger,
    options: result.options,
    residual:
      result.residual === null
        ? null
        : {
            weeks: result.residual.weeks,
            shortfall: round(result.residual.shortfall),
            shortfallDays: Math.round(result.residual.shortfallDays * 10) / 10,
            recoveredIn: result.residual.recoveredIn,
            stocksOut: result.residual.stocksOut,
          },
    blockingViolations: result.blockingViolations.map(
      (row): ScheduleViolationView => ({
        line: row.line,
        week: row.week,
        constraint: row.constraint,
        constraintLabel:
          row.constraint === 'UNATTRIBUTED'
            ? 'Unattributed difference'
            : row.constraint === 'UNPLACEABLE'
              ? 'Quantity with nowhere to go'
              : CONSTRAINT_LABEL[row.constraint],
        qty: round(row.qty),
        message: row.message,
      }),
    ),
    advisories: result.advisories.map(
      (row): ScheduleAdvisoryView => ({ line: row.line, week: row.week, kind: row.kind, message: row.message }),
    ),
    proposedCorrections: result.proposedCorrections.map(
      (row): ProposedCorrectionView => ({
        line: row.line,
        week: row.week,
        from: round(row.from),
        to: round(row.to),
        reason: row.reason,
      }),
    ),
    plannerLines,
    orders: buildOrders(facts, context),
    fence: {
      totalDays: facts.fences.maintained.totalDays,
      earliestReceiptDate: facts.fences.maintained.earliestReceiptDate,
      earliestReceiptWeek: weekLabel(facts.fences.maintained.earliestReceiptDate),
      earliestReceiptBucket: 0,
    },
  };
}

/**
 * How far forward the schedule runs, and why.
 *
 * A campaign material is scheduled over its campaign, because that is the
 * order the buyer actually places. Everything else is scheduled over the window
 * its own lead time implies — long enough that the schedule is worth sending,
 * short enough that a planner is not asked to commit to a date they cannot
 * see. The reason is displayed, so the window is never an unexplained choice.
 */
function resolveWindow(
  facts: MaterialFacts,
  context: RunContext,
  override?: number,
): { fromDay: number; toDay: number; reason: string } {
  // Deliveries start at the beginning of the next full week: this week is
  // already being executed.
  const nextMonday = startOfWeek(fromEpochDay(context.planningEpochDay + 7));
  const fromDay = Math.max(0, toEpochDay(nextMonday) - context.planningEpochDay);

  const campaign = facts.itemPlant.campaignCycleDays ?? facts.itemPlant.periodsOfSupplyDays;
  const rawDays =
    override ??
    campaign ??
    Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, Math.round(facts.chain.totalDays * 0.6)));
  const days = Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, rawDays));
  const toDay = Math.min(context.horizonDays, fromDay + days - 1);

  const reason = override
    ? 'Window set by the planner.'
    : campaign
      ? `A ${Math.round(campaign / 7)}-week campaign — the order this material is actually bought in.`
      : `Sized against the ${facts.chain.totalDays}-day lead time: long enough to be worth sending, short enough to be committable.`;

  return { fromDay, toDay, reason };
}

function round(value: number): number {
  return Math.abs(value) < 10 ? Math.round(value * 100) / 100 : Math.round(value);
}
