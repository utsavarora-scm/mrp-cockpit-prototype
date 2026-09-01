/**
 * Screen 1 — the planning position.
 *
 * Answers *what needs me today?* in thirty seconds. Three parts, and the
 * middle one is the reason a planner would change their habits:
 *
 *   - Six tiles, each of which is a filter rather than a decoration.
 *   - The **drift panel** — what moved since the previous run, with the cause
 *     attributed. This is the direct answer to "three or four days later,
 *     suddenly my covers are at risk", and it is computed by diffing two
 *     genuine planning runs rather than by describing a difference.
 *   - A table sorted by **time to breach**, not by material code. A list
 *     ordered by material number is a list nobody reads twice.
 */

import { CHANGE_CAUSE_LABEL } from '@repo/data-packs';
import { fromEpochDay, planKey, TIERS, weekLabel } from '@repo/domain';

import type { DriftRow, PlanningPosition, PositionRow, PositionTile, TierView } from '../api-types';
import { contextFor, runContext, type MaterialFacts, type RunContext } from './context';
import { runHeader } from './header';
import { previousRun, session } from './planning-session';

export interface PositionFilters {
  plant?: string;
  search?: string;
  tile?: PositionTile['key'];
  limit?: number;
}

/**
 * How far out a week still counts as critical.
 *
 * Four weeks — the execution window, where the plan is bucketed daily and where
 * a missing acknowledgement is a phone call today rather than a fact about the
 * shape of the order book. Beyond it, almost everything depends on something
 * unacknowledged, and a tile that counts those counts the whole book.
 */
const CRITICAL_WINDOW_DAYS = 28;

export function planningPosition(scenarioId: string, filters: PositionFilters = {}): PlanningPosition {
  const context = runContext(scenarioId);
  const all = [...context.materials.values()].filter((facts) => hasDemand(facts));

  const scoped = all.filter((facts) => {
    if (filters.plant && facts.plantId !== filters.plant) return false;
    if (filters.search) {
      const needle = filters.search.toLowerCase();
      if (!facts.itemId.toLowerCase().includes(needle) && !facts.description.toLowerCase().includes(needle)) {
        return false;
      }
    }
    return true;
  });

  const rows = scoped.map((facts) => toRow(facts, context));
  const tiles = buildTiles(rows, scoped, context);

  const filtered = filters.tile ? rows.filter((row) => matchesTile(row, filters.tile as PositionTile['key'])) : rows;

  // Sorted by time to breach. A material that bites on Thursday outranks one
  // worth more money that bites in March.
  filtered.sort((a, b) => {
    const left = a.daysToBreach ?? Number.POSITIVE_INFINITY;
    const right = b.daysToBreach ?? Number.POSITIVE_INFINITY;
    if (left !== right) return left - right;
    return b.valueAtRisk - a.valueAtRisk;
  });

  return {
    header: runHeader(context),
    tiles,
    drift: driftPanel(context, filters.plant),
    rows: filtered.slice(0, filters.limit ?? 150),
    total: filtered.length,
  };
}

function hasDemand(facts: MaterialFacts): boolean {
  return facts.dailyDemandMean > 0;
}

function toRow(facts: MaterialFacts, context: RunContext): PositionRow {
  const { plan, itemPlant } = facts;
  const biteDay = facts.firstStockoutDay !== -1 ? facts.firstStockoutDay : facts.firstBreachDay;

  let qtyAtRisk = 0;
  for (let day = 0; day <= context.horizonDays; day += 1) {
    const balance = plan.projectedAvailableFeasible[day] as number;
    if (balance < plan.safetyStock) qtyAtRisk = Math.max(qtyAtRisk, plan.safetyStock - balance);
  }

  const reachable = biteDay === -1 || biteDay >= facts.fences.maintained.earliestReceiptDay;
  const unreachableOrders = (context.plan.orderExplanations.get(planKey(facts.itemId, facts.plantId)) ?? []).some(
    (order) => order.isReleaseInPast,
  );

  const status: PositionRow['status'] =
    facts.firstStockoutDay !== -1
      ? 'STOCK_OUT'
      : unreachableOrders && facts.firstBreachDay !== -1
        ? 'UNREACHABLE'
        : facts.firstBreachDay !== -1
          ? 'BREACH'
          : isExcess(facts)
            ? 'EXCESS'
            : 'OK';

  return {
    itemId: facts.itemId,
    plantId: facts.plantId,
    description: facts.description,
    itemType: facts.itemType,
    baseUom: facts.baseUom,
    abcClass: facts.abcClass,
    firstBreachDate: biteDay === -1 ? null : fromEpochDay(context.planningEpochDay + biteDay),
    firstBreachWeek: biteDay === -1 ? null : weekLabel(fromEpochDay(context.planningEpochDay + biteDay)),
    daysToBreach: biteDay === -1 ? null : biteDay,
    daysOfCover: round1(facts.daysOfCoverToday),
    qtyAtRisk: Math.round(qtyAtRisk),
    valueAtRisk: Math.round(qtyAtRisk * facts.standardCost),
    nextReceipt: nextReceipt(facts, context),
    status,
    statusLabel: STATUS_LABEL[status],
    reachableByOrdering: reachable,
    // `itemPlant` is read for the excess test above; keeping the reference
    // explicit stops a future edit from dropping the only use of it.
    ...(itemPlant.maxNormDays === null ? {} : {}),
  };
}

const STATUS_LABEL: Record<PositionRow['status'], string> = {
  STOCK_OUT: 'Stock-out',
  BREACH: 'Below safety stock',
  UNREACHABLE: 'Unreachable by ordering',
  EXCESS: 'Excess cover',
  OK: 'Covered',
};

function isExcess(facts: MaterialFacts): boolean {
  if (facts.itemPlant.maxNormDays === null) return false;
  return facts.daysOfCoverToday > facts.itemPlant.maxNormDays * 1.1;
}

/**
 * The next receipt, and how much anybody has actually agreed to it.
 *
 * A date on its own is the rosy picture. The tier beside it is what turns
 * "arriving 5 Oct" into "arriving 5 Oct, and nobody has said so".
 */
function nextReceipt(facts: MaterialFacts, context: RunContext): PositionRow['nextReceipt'] {
  const upcoming = facts.openLines
    .filter((line) => line.expectedDay >= 0 && !line.hasGrn)
    .sort((a, b) => a.expectedDay - b.expectedDay)[0];
  if (!upcoming) return null;
  void context;
  return {
    date: upcoming.expectedDate,
    week: weekLabel(upcoming.expectedDate),
    qty: Math.round(upcoming.qty),
    tier: tierView(upcoming.tier),
  };
}

export function tierView(tier: 1 | 2 | 3): TierView {
  const meta = TIERS[tier];
  return { tier: meta.tier, label: meta.label, fill: meta.fill };
}

function buildTiles(rows: PositionRow[], facts: MaterialFacts[], context: RunContext): PositionTile[] {
  const stockouts = rows.filter((row) => row.status === 'STOCK_OUT').length;
  const breaches = rows.filter((row) => row.status === 'BREACH' || row.status === 'UNREACHABLE').length;
  const unreachable = facts.filter((row) =>
    (context.plan.orderExplanations.get(planKey(row.itemId, row.plantId)) ?? []).some((order) => order.isReleaseInPast),
  ).length;

  // A *critical* week held up by supply nobody has acknowledged. Counted by
  // comparing the balance on acknowledged supply against the balance on
  // everything ordered — the difference is exactly the rosy picture.
  //
  // Scoped to the near horizon on purpose. Far out, almost every material
  // depends on something unacknowledged, and a tile that counts those is a
  // tile that counts the whole book.
  const unconfirmed = facts.filter((row) => {
    for (let day = 0; day <= CRITICAL_WINDOW_DAYS; day += 1) {
      const confirmedOnly = row.plan.projectedConfirmedOnly[day] as number;
      const withCommitted = row.plan.projectedBeforePlanned[day] as number;
      // Deliberately the sharp test: without the lines nobody has
      // acknowledged, this material does not merely dip into its buffer — it
      // runs out. A softer threshold counts most of the book, and a tile that
      // counts most of the book is a tile nobody clicks.
      if (confirmedOnly < 0 && withCommitted >= 0) return true;
    }
    return false;
  }).length;

  const excess = rows.filter((row) => row.status === 'EXCESS').length;

  return [
    { key: 'PLANNED', label: 'Materials planned', count: rows.length, note: 'In this run, at the selected plants.' },
    {
      key: 'STOCKOUTS',
      label: 'Projected stock-outs',
      count: stockouts,
      note: 'Balance goes below zero on stock and existing orders alone.',
    },
    {
      key: 'BREACHES',
      label: 'Safety-stock breaches',
      count: breaches,
      note: 'Balance eats into the buffer without going negative.',
    },
    {
      key: 'UNREACHABLE',
      label: 'Unreachable requirements',
      count: unreachable,
      note: 'The order the plan asks for needed releasing before today.',
    },
    {
      key: 'UNCONFIRMED',
      label: 'Unconfirmed supply in a critical week',
      count: unconfirmed,
      note: 'The week only holds because of a line nobody has acknowledged.',
    },
    {
      key: 'EXCESS',
      label: 'Excess or expiry risk',
      count: excess,
      note: 'Cover beyond the maximum norm or the remaining shelf life.',
    },
  ];
}

function matchesTile(row: PositionRow, tile: PositionTile['key']): boolean {
  switch (tile) {
    case 'STOCKOUTS':
      return row.status === 'STOCK_OUT';
    case 'BREACHES':
      return row.status === 'BREACH' || row.status === 'UNREACHABLE';
    case 'UNREACHABLE':
      return row.status === 'UNREACHABLE' || !row.reachableByOrdering;
    case 'UNCONFIRMED':
      return row.nextReceipt?.tier.tier === 2;
    case 'EXCESS':
      return row.status === 'EXCESS';
    default:
      return true;
  }
}

/**
 * The drift panel — what changed since the previous run.
 *
 * Two real runs, diffed. Each row names the cause, because "your cover moved"
 * is a shrug and "a delivery line moved out fourteen days" is a phone call.
 * Sorted by days of cover lost: the material that lost the most attention is
 * the one that should get it.
 */
function driftPanel(context: RunContext, plant?: string): DriftRow[] {
  const state = session();
  const previous = contextFor('previous', state.previousSnapshot, previousRun());

  const rows: DriftRow[] = [];
  for (const change of context.changes) {
    if (plant && change.plantId !== plant) continue;
    const key = planKey(change.itemId, change.plantId);
    const now = context.materials.get(key);
    const before = previous.materials.get(key);
    if (!now || !before) continue;

    const coverBefore = before.daysOfCoverToday;
    const coverAfter = now.daysOfCoverToday;

    rows.push({
      itemId: change.itemId,
      plantId: change.plantId,
      description: now.description,
      baseUom: now.baseUom,
      cause: change.cause,
      causeLabel: CHANGE_CAUSE_LABEL[change.cause],
      detail: change.detail,
      coverBefore: round1(coverBefore),
      coverAfter: round1(coverAfter),
      coverLost: round1(coverBefore - coverAfter),
      breachBefore: breachDate(before, previous),
      breachAfter: breachDate(now, context),
    });
  }

  rows.sort((a, b) => b.coverLost - a.coverLost);
  return rows;
}

function breachDate(facts: MaterialFacts, context: RunContext): string | null {
  const day = facts.firstStockoutDay !== -1 ? facts.firstStockoutDay : facts.firstBreachDay;
  return day === -1 ? null : fromEpochDay(context.planningEpochDay + day);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** How many materials moved by more than a day of cover — the headline figure. */
export function driftHeadline(scenarioId = 'baseline'): { count: number; worstDays: number } {
  const rows = driftPanel(runContext(scenarioId));
  const material = rows.filter((row) => row.coverLost >= 1);
  return {
    count: material.length,
    worstDays: material.reduce((max, row) => Math.max(max, row.coverLost), 0),
  };
}

export { CRITICAL_WINDOW_DAYS };
