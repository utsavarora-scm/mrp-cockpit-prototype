/**
 * Time buckets.
 *
 * Precision you do not have should not be displayed as precision you do. A
 * weekly bar says "some time this week", which is fine twenty weeks out and
 * useless next Tuesday — so the near horizon is bucketed daily and everything
 * beyond it weekly, and the boundary between them is drawn rather than implied.
 *
 * The engine itself is always daily. Bucketing happens here, on the way to a
 * screen, so nothing about how a chart is drawn can change what the plan says.
 *
 * The one rule that is not cosmetic: **a flow sums and a level does not.**
 * Gross requirement over a week is the week's total; projected balance over a
 * week is the balance at the end of it. Summing a balance across seven days
 * reports seven times the stock, and it reports it confidently.
 */

import { fromEpochDay, isoWeekNumber, toEpochDay, weekLabel } from '@repo/domain';

export type BucketKind = 'DAY' | 'WEEK' | 'MONTH';

/**
 * Why a bucket is the width it is. Shown on the axis, because a planner asked
 * to act on a number is entitled to know what window it covers.
 */
export type HorizonZone = 'EXECUTION' | 'SCHEDULING' | 'PROCUREMENT' | 'STRATEGIC';

export const ZONE_LABEL: Record<HorizonZone, string> = {
  EXECUTION: 'Execution',
  SCHEDULING: 'Scheduling',
  PROCUREMENT: 'Procurement',
  STRATEGIC: 'Strategic',
};

export const ZONE_NOTE: Record<HorizonZone, string> = {
  EXECUTION: 'Dock-level decisions. "Some time next week" is not actionable when the line runs on Tuesday.',
  SCHEDULING: 'Where delivery schedule lines are built and adjusted. Vendors think in weeks.',
  PROCUREMENT: 'The long-lead ordering window. Nothing lands here without being ordered now.',
  STRATEGIC: 'Long-lead commitment only. Not a netting horizon.',
};

export interface Bucket {
  index: number;
  kind: BucketKind;
  zone: HorizonZone;
  /** Day offset from the planning date, inclusive. */
  startDay: number;
  /** Day offset from the planning date, inclusive. */
  endDay: number;
  startDate: string;
  endDate: string;
  /** `Tue 01 Sep` for a day, `W39` for a week. */
  label: string;
  /** Always present, so a daily bucket can still say which week it is in. */
  week: string;
  /** True on the first bucket of a new zone — where the axis draws a boundary. */
  startsZone: boolean;
}

export interface BucketingOptions {
  /** Days bucketed one-per-day before weekly bucketing begins. */
  dailyDays?: number;
  /** Day offset at which the procurement zone begins. */
  procurementFromDay?: number;
}

/** Four weeks daily, then weekly. The default the screens use. */
export const DEFAULT_BUCKETING: Required<BucketingOptions> = {
  dailyDays: 28,
  procurementFromDay: 112,
};

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * The bucket calendar for one horizon.
 *
 * Weekly buckets are aligned to ISO Mondays rather than to multiples of seven
 * days from the planning date, so a bucket labelled W39 contains exactly the
 * days a vendor means by week 39.
 */
export function buildBuckets(planningDate: string, horizonDays: number, options: BucketingOptions = {}): Bucket[] {
  const { dailyDays, procurementFromDay } = { ...DEFAULT_BUCKETING, ...options };
  const planningEpochDay = toEpochDay(planningDate);
  const buckets: Bucket[] = [];

  const push = (startDay: number, endDay: number, kind: BucketKind, zone: HorizonZone): void => {
    const startDate = fromEpochDay(planningEpochDay + startDay);
    const endDate = fromEpochDay(planningEpochDay + endDay);
    const dow = (((planningEpochDay + startDay + 4) % 7) + 7) % 7;
    buckets.push({
      index: buckets.length,
      kind,
      zone,
      startDay,
      endDay,
      startDate,
      endDate,
      label: kind === 'DAY' ? `${WEEKDAY[dow]} ${startDate.slice(8, 10)} ${monthOf(startDate)}` : weekLabel(startDate),
      week: weekLabel(startDate),
      startsZone: buckets.length === 0 || (buckets[buckets.length - 1] as Bucket).zone !== zone,
    });
  };

  const lastDailyDay = Math.min(dailyDays - 1, horizonDays);
  for (let day = 0; day <= lastDailyDay; day += 1) push(day, day, 'DAY', 'EXECUTION');

  let day = lastDailyDay + 1;
  while (day <= horizonDays) {
    // Snap to the ISO week the day falls in, so a weekly bucket is a real week.
    const iso = fromEpochDay(planningEpochDay + day);
    const dow = (((planningEpochDay + day + 4) % 7) + 7) % 7;
    const daysToSunday = dow === 0 ? 0 : 7 - dow;
    const endDay = Math.min(day + daysToSunday, horizonDays);
    push(day, endDay, 'WEEK', day >= procurementFromDay ? 'PROCUREMENT' : 'SCHEDULING');
    void iso;
    day = endDay + 1;
  }

  return buckets;
}

function monthOf(iso: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[Number(iso.slice(5, 7)) - 1] as string;
}

/**
 * A flow — what moved during the bucket. Sums.
 *
 * Gross requirement, receipts, planned orders: quantities that happened over a
 * window, so a wider window holds more of them.
 */
export function bucketFlow(series: ArrayLike<number>, buckets: readonly Bucket[]): number[] {
  return buckets.map((bucket) => {
    let total = 0;
    for (let day = bucket.startDay; day <= bucket.endDay; day += 1) total += series[day] ?? 0;
    return total;
  });
}

/**
 * A level — what is held at an instant. Takes the closing value.
 *
 * Projected balance, safety stock, days of cover: quantities that describe a
 * moment, so a wider window does not hold more of them, it just ends later.
 */
export function bucketLevel(series: ArrayLike<number>, buckets: readonly Bucket[]): number[] {
  return buckets.map((bucket) => series[bucket.endDay] ?? 0);
}

/** The lowest value reached anywhere inside each bucket — where the trouble is. */
export function bucketTrough(series: ArrayLike<number>, buckets: readonly Bucket[]): number[] {
  return buckets.map((bucket) => {
    let lowest = Number.POSITIVE_INFINITY;
    for (let day = bucket.startDay; day <= bucket.endDay; day += 1) lowest = Math.min(lowest, series[day] ?? 0);
    return Number.isFinite(lowest) ? lowest : 0;
  });
}

/** The bucket a day offset falls in, or −1 when it falls outside the horizon. */
export function bucketIndexOfDay(buckets: readonly Bucket[], day: number): number {
  for (const bucket of buckets) if (day >= bucket.startDay && day <= bucket.endDay) return bucket.index;
  return -1;
}

/** `W39 (21 Sep)` — how a bucket is named in prose. */
export function bucketPhrase(bucket: Bucket): string {
  const day = bucket.startDate.slice(8, 10);
  return bucket.kind === 'DAY'
    ? `${day} ${monthOf(bucket.startDate)}`
    : `${bucket.week} (${day} ${monthOf(bucket.startDate)})`;
}

/** The ISO week number of a day offset. Used wherever prose names a week. */
export function weekNumberOfDay(planningDate: string, day: number): number {
  return isoWeekNumber(fromEpochDay(toEpochDay(planningDate) + day));
}
