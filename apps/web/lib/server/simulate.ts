/**
 * Screen 7 — simulate and override.
 *
 * The planner changes one input and sees the consequence before committing to
 * it. Both sides are genuine planning runs, not an estimate of one: the
 * snapshot is cloned with the single field changed and the engine is run again,
 * so what the comparison shows is what would actually happen.
 *
 * The demo case is the strongest argument the product can make without a
 * slide: change the maintained lead time to the measured one, and watch the
 * fence slide two weeks to the right. On a ninety-day import, two weeks is a
 * vessel.
 */

import { fromEpochDay, planKey, toEpochDay, weekLabel } from '@repo/domain';
import { bucketLevel, computeFences, FALLBACK_CALENDAR, leadTimeChain, WorkingCalendar } from '@repo/planning-engine';

import type { SimulationView } from '../api-types';
import { runContext } from './context';
import { planWithParamOverride, type OverridableField } from './planning-session';

/** Fields a planner may simulate. Derived values are never editable. */
export const SIMULATABLE_FIELDS: Record<string, string> = {
  leadTimeDays: 'Total planning lead time',
  safetyStock: 'Safety stock',
  minLotSize: 'Minimum order quantity',
  roundingValue: 'Rounding value',
  maxLotSize: 'Maximum lot',
  periodsOfSupplyDays: 'Fixed period, days',
  grProcessingTimeDays: 'Goods receipt processing, days',
  qaQuarantineDays: 'Quality inspection, days',
};

export function simulate(
  scenarioId: string,
  itemId: string,
  plantId: string,
  field: OverridableField,
  value: number | null,
): SimulationView | null {
  const started = performance.now();
  const context = runContext(scenarioId);
  const facts = context.materials.get(planKey(itemId, plantId));
  if (!facts) return null;

  const after = planWithParamOverride(scenarioId, itemId, plantId, field, value);
  if (!after) return null;

  const afterPlan = after.plan.plans.get(planKey(itemId, plantId));
  if (!afterPlan) return null;

  const buckets = context.buckets;
  const beforeBalance = bucketLevel(facts.plan.projectedBeforePlanned, buckets).map(round);
  const afterBalance = bucketLevel(afterPlan.projectedBeforePlanned, buckets).map(round);

  const calendar =
    context.calendarForPlant.get(plantId) ??
    new WorkingCalendar(FALLBACK_CALENDAR, context.planningDate, context.horizonDays);
  const afterChain = leadTimeChain(after.master, facts.vendor);
  const afterFences = computeFences({
    planningEpochDay: context.planningEpochDay,
    calendar,
    maintainedChainDays: afterChain.totalDays,
    measuredTotalDays: null,
    horizonDays: context.horizonDays,
  });

  const beforeMetrics = metricsOf(facts.plan, facts.fences.maintained.earliestReceiptDay, context.horizonDays);
  const afterMetrics = metricsOf(afterPlan, afterFences.maintained.earliestReceiptDay, context.horizonDays);

  const dateOf = (day: number): string => (day === -1 ? 'None' : fromEpochDay(context.planningEpochDay + day));
  const uom = facts.baseUom;
  const beforeExposure = beforeMetrics.exposureInsideFence(facts.fences.maintained.earliestReceiptDay);
  const afterExposure = afterMetrics.exposureInsideFence(afterFences.maintained.earliestReceiptDay);

  return {
    field,
    label: SIMULATABLE_FIELDS[field] ?? field,
    before: readField(facts.itemPlant as unknown as Record<string, unknown>, field),
    after: value,
    metrics: [
      metric(
        'First safety-stock breach',
        dateOf(beforeMetrics.firstBreach),
        dateOf(afterMetrics.firstBreach),
        compareDay(beforeMetrics.firstBreach, afterMetrics.firstBreach),
      ),
      metric(
        'First stock-out',
        dateOf(beforeMetrics.firstStockout),
        dateOf(afterMetrics.firstStockout),
        compareDay(beforeMetrics.firstStockout, afterMetrics.firstStockout),
      ),
      metric(
        'Earliest a new order can land',
        `${facts.fences.maintained.earliestReceiptDate} (${weekLabel(facts.fences.maintained.earliestReceiptDate)})`,
        `${afterFences.maintained.earliestReceiptDate} (${weekLabel(afterFences.maintained.earliestReceiptDate)})`,
        compareDay(afterFences.maintained.earliestReceiptDay, facts.fences.maintained.earliestReceiptDay),
        `${afterFences.maintained.earliestReceiptDay - facts.fences.maintained.earliestReceiptDay >= 0 ? '+' : ''}${afterFences.maintained.earliestReceiptDay - facts.fences.maintained.earliestReceiptDay} days`,
      ),
      metric(
        'Weeks unreachable by ordering',
        String(Math.max(0, Math.round(beforeMetrics.unreachableWeeks(facts.fences.maintained.earliestReceiptDay)))),
        String(Math.max(0, Math.round(afterMetrics.unreachableWeeks(afterFences.maintained.earliestReceiptDay)))),
        compareNumber(
          beforeMetrics.unreachableWeeks(facts.fences.maintained.earliestReceiptDay),
          afterMetrics.unreachableWeeks(afterFences.maintained.earliestReceiptDay),
          'lower',
        ),
      ),
      metric(
        'Worst shortfall against safety stock',
        `${format(beforeMetrics.worstShortfall)} ${uom}`,
        `${format(afterMetrics.worstShortfall)} ${uom}`,
        compareNumber(beforeMetrics.worstShortfall, afterMetrics.worstShortfall, 'lower'),
      ),
      metric(
        'Peak inventory',
        `${format(beforeMetrics.peak)} ${uom}`,
        `${format(afterMetrics.peak)} ${uom}`,
        compareNumber(beforeMetrics.peak, afterMetrics.peak, 'lower'),
      ),
      // What a lead-time change actually moves on a material whose orders are
      // all already unplaceable: not the balance, but how much of the exposure
      // falls inside the fence. A peak-inventory delta here prints zero and
      // teaches a planner that the change did nothing.
      metric(
        'Exposure no order can reach',
        `${format(beforeExposure)} ${uom}`,
        `${format(afterExposure)} ${uom}`,
        compareNumber(beforeExposure, afterExposure, 'lower'),
        `${formatMoney((afterExposure - beforeExposure) * facts.standardCost)} at standard cost`,
      ),
    ],
    beforeBalance,
    afterBalance,
    bucketLabels: buckets.map((bucket) => bucket.label),
    beforeFence: {
      totalDays: facts.fences.maintained.totalDays,
      earliestReceiptDate: facts.fences.maintained.earliestReceiptDate,
      earliestReceiptWeek: weekLabel(facts.fences.maintained.earliestReceiptDate),
      earliestReceiptBucket: bucketOf(buckets, facts.fences.maintained.earliestReceiptDay),
    },
    afterFence: {
      totalDays: afterFences.maintained.totalDays,
      earliestReceiptDate: afterFences.maintained.earliestReceiptDate,
      earliestReceiptWeek: weekLabel(afterFences.maintained.earliestReceiptDate),
      earliestReceiptBucket: bucketOf(buckets, afterFences.maintained.earliestReceiptDay),
    },
    elapsedMs: Math.round(performance.now() - started),
  };
}

interface Metrics {
  firstBreach: number;
  firstStockout: number;
  worstShortfall: number;
  peak: number;
  unreachableWeeks: (fenceDay: number) => number;
  /** The deepest shortfall in the window no newly placed order can arrive in. */
  exposureInsideFence: (fenceDay: number) => number;
}

function metricsOf(
  plan: { projectedBeforePlanned: Float64Array; safetyStock: number },
  fenceDay: number,
  horizonDays: number,
): Metrics {
  let firstBreach = -1;
  let firstStockout = -1;
  let worstShortfall = 0;
  let peak = 0;

  for (let day = 0; day <= horizonDays; day += 1) {
    const balance = plan.projectedBeforePlanned[day] as number;
    if (firstBreach === -1 && balance < plan.safetyStock) firstBreach = day;
    if (firstStockout === -1 && balance < 0) firstStockout = day;
    worstShortfall = Math.max(worstShortfall, plan.safetyStock - balance);
    peak = Math.max(peak, balance);
  }
  void fenceDay;

  return {
    firstBreach,
    firstStockout,
    worstShortfall: Math.max(0, worstShortfall),
    peak,
    // How much of the exposure sits inside the fence — the window no purchase
    // order can reach. That is what a lead-time change actually moves.
    unreachableWeeks: (fence: number) => (firstBreach === -1 ? 0 : Math.max(0, (fence - firstBreach) / 7)),
    exposureInsideFence: (fence: number) => {
      let worst = 0;
      for (let day = 0; day <= Math.min(fence, horizonDays); day += 1) {
        worst = Math.max(worst, plan.safetyStock - (plan.projectedBeforePlanned[day] as number));
      }
      return Math.max(0, worst);
    },
  };
}

function metric(
  label: string,
  before: string,
  after: string,
  direction: SimulationView['metrics'][number]['direction'],
  delta?: string,
): SimulationView['metrics'][number] {
  return { label, before, after, delta: delta ?? (before === after ? 'unchanged' : `${before} → ${after}`), direction };
}

/** A later date is better for a breach; an earlier one for a fence. */
function compareDay(before: number, after: number): SimulationView['metrics'][number]['direction'] {
  if (before === after) return 'SAME';
  if (before === -1) return 'WORSE';
  if (after === -1) return 'BETTER';
  return after > before ? 'BETTER' : 'WORSE';
}

function compareNumber(
  before: number,
  after: number,
  better: 'lower' | 'higher',
): SimulationView['metrics'][number]['direction'] {
  if (Math.abs(before - after) < 0.5) return 'SAME';
  const improved = better === 'lower' ? after < before : after > before;
  return improved ? 'BETTER' : 'WORSE';
}

function readField(master: Record<string, unknown>, field: string): number | null {
  const value = master[field];
  return typeof value === 'number' ? value : null;
}

function bucketOf(buckets: Array<{ startDay: number; endDay: number; index: number }>, day: number): number {
  const found = buckets.find((bucket) => day >= bucket.startDay && day <= bucket.endDay);
  return found ? found.index : buckets.length - 1;
}

function round(value: number): number {
  return Math.round(value);
}

function format(value: number): string {
  return Math.round(value).toLocaleString('en-IN');
}

/** Signed, in crore or lakh, because a change can go either way. */
function formatMoney(value: number): string {
  const sign = value >= 0 ? '+' : '−';
  const abs = Math.abs(value);
  if (abs >= 10_000_000) return `${sign}₹${(abs / 10_000_000).toFixed(2)} Cr`;
  if (abs >= 100_000) return `${sign}₹${(abs / 100_000).toFixed(1)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

export { toEpochDay };
