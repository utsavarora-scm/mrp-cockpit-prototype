/**
 * Observed lead times, summarised from goods-receipt history.
 *
 * This is the evidence behind `B7-LEAD-TIME-DRIFT`, and the reason the demo's
 * hero exception exists at all: SAP and Kinaxis both plan faithfully on the
 * maintained parameter, and neither looks back at what actually happened.
 */

import { type ReceiptHistory, planKey } from '@repo/domain';

export interface ObservedLeadTime {
  itemId: string;
  plantId: string;
  vendorId: string;
  /** Mean actual lead time across the sampled receipts. */
  averageDays: number;
  /** Population standard deviation, in days. */
  stdDevDays: number;
  count: number;
  /** The receipts used, most recent first. */
  sample: ReceiptHistory[];
}

/** How many recent receipts the average is taken over. */
export const OBSERVATION_WINDOW = 6;

export function summariseObservedLeadTimes(history: ReceiptHistory[]): Map<string, ObservedLeadTime> {
  const grouped = new Map<string, ReceiptHistory[]>();
  for (const receipt of history) {
    const key = planKey(receipt.itemId, receipt.plantId);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(receipt);
    else grouped.set(key, [receipt]);
  }

  const summaries = new Map<string, ObservedLeadTime>();
  for (const [key, receipts] of grouped) {
    // Most recent first, id as a deterministic tie-break.
    receipts.sort((a, b) =>
      a.receivedOn !== b.receivedOn ? (a.receivedOn < b.receivedOn ? 1 : -1) : a.poId < b.poId ? 1 : -1
    );
    const sample = receipts.slice(0, OBSERVATION_WINDOW);
    if (sample.length === 0) continue;

    let total = 0;
    for (const receipt of sample) total += receipt.actualLeadTimeDays;
    const average = total / sample.length;

    let variance = 0;
    for (const receipt of sample) variance += (receipt.actualLeadTimeDays - average) ** 2;
    variance /= sample.length;

    const first = sample[0] as ReceiptHistory;
    summaries.set(key, {
      itemId: first.itemId,
      plantId: first.plantId,
      vendorId: first.vendorId,
      averageDays: average,
      stdDevDays: Math.sqrt(variance),
      count: sample.length,
      sample,
    });
  }

  return summaries;
}

/**
 * The review period the variability measure smooths over: the item's own
 * replenishment lead time, bounded either side so neither a same-day item nor a
 * six-month one distorts the measure.
 */
export function reviewPeriodDays(leadTimeDays: number | null): number {
  return Math.min(28, Math.max(7, leadTimeDays ?? 7));
}

/**
 * Demand standard deviation per day, for the calculated safety stock check.
 *
 * Measured on a rolling mean over the item's own replenishment review period
 * rather than on the raw buckets. Safety stock buffers genuine demand
 * variability, not the lumpiness that lot sizing and weekly delivery patterns
 * create upstream — a component whose parent is built in fortnightly batches
 * sees violently spiky requirements without its demand being any less
 * predictable. Measuring the raw series makes almost every parameter in a normal
 * catalogue look misaligned, which is a detector that cries wolf.
 */
/**
 * Standard deviation of daily demand, unsmoothed.
 *
 * This is the σ_D the safety-stock formula means, and it is deliberately a
 * different function from `demandStdDev` below rather than a flag on it.
 * Smoothing over a seven-day window measures the spread of the *moving
 * average*, which is smaller than the spread of daily demand by roughly √7 —
 * on the hero material, 3.2 against 9.0. Feed the smoothed figure to the norm
 * and the buffer comes out understated and the naive-versus-combined ratio
 * comes out at 21× instead of 7.6×: both wrong, and neither obviously so.
 *
 * Population, matching every other spread in the product.
 */
export function dailyDemandStdDev(demand: Float64Array): number {
  const n = demand.length;
  if (n === 0) return 0;
  let total = 0;
  for (let i = 0; i < n; i += 1) total += demand[i] as number;
  const mean = total / n;
  let variance = 0;
  for (let i = 0; i < n; i += 1) variance += ((demand[i] as number) - mean) ** 2;
  return Math.sqrt(variance / n);
}

/**
 * Standard deviation of *smoothed* demand.
 *
 * Kept for the parameter-health comparison, which is asking whether a
 * maintained safety stock is in the right region given lumpy dependent demand
 * — a question where smoothing out campaign spikes is the right thing to do.
 * Not for sizing a norm: see `dailyDemandStdDev`.
 */
export function demandStdDev(grossRequirements: Float64Array, smoothingDays = 7): number {
  const n = grossRequirements.length;
  if (n === 0) return 0;

  const smoothed = new Float64Array(n);
  let window = 0;
  for (let i = 0; i < n; i += 1) {
    window += grossRequirements[i] as number;
    if (i >= smoothingDays) window -= grossRequirements[i - smoothingDays] as number;
    smoothed[i] = window / Math.min(i + 1, smoothingDays);
  }

  let total = 0;
  for (let i = 0; i < n; i += 1) total += smoothed[i] as number;
  const mean = total / n;

  let variance = 0;
  for (let i = 0; i < n; i += 1) variance += ((smoothed[i] as number) - mean) ** 2;
  return Math.sqrt(variance / n);
}
