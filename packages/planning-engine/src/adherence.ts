/**
 * The adherence engine — what actually happened, versus what was promised.
 *
 * This runs first, because every later engine depends on it. Norms are only as
 * good as the lead times they are reconstructed from, and lead times are only
 * as good as the match between a goods receipt and the delivery line it was
 * meant to satisfy.
 *
 * **Unmatched receipts are never dropped.** They go to a queue and are counted.
 * A pipeline that silently discards what it cannot reconcile biases every
 * statistic downstream and does so invisibly — the reconstruction looks
 * cleaner precisely because the awkward cases are gone. Roughly 4% of any real
 * GRN feed fails to match, and a planner who has lived with that data knows it;
 * a tool that reports 100% clean matching is telling them it did not look.
 *
 * **Confirmation adherence is tracked apart from delivery adherence.** A vendor
 * who confirms every date and then delivers late is a different problem from
 * one who negotiates honestly and delivers to what they agreed. Collapsing the
 * two into a single "reliability" score hides the distinction that decides what
 * you do about it.
 */

import {
  type DeliveryLine,
  type ReceiptHistory,
  type SupplyElement,
  toEpochDay,
} from '@repo/domain';

/**
 * How a receipt found its delivery line, or why it did not.
 *
 * `PROMISED` covers historical receipts. Twenty-four months of goods receipts
 * belong to orders that closed long ago and are not in the open supply book, so
 * there is no delivery line left to match against — but the receipt still
 * carries the date the vendor promised, which is the line in every respect that
 * matters for measuring adherence.
 */
export type MatchMethod = 'EXACT' | 'FIFO' | 'PARTIAL' | 'OVER_RECEIPT' | 'PROMISED';

export interface MatchedReceipt {
  receipt: ReceiptHistory;
  orderId: string;
  line: number;
  method: MatchMethod;
  /** Quantity of this receipt allocated to this line. */
  allocatedQty: number;
  /** receivedOn − plannedDate, in days. Positive is late. */
  dateVarianceDays: number;
  /** receivedOn − confirmedDate, in days. Null where the vendor never confirmed. */
  confirmationVarianceDays: number | null;
  /**
   * allocatedQty − lineQty. Null for a historical receipt, where the ordered
   * quantity is no longer on the books — unknown is reported as unknown rather
   * than as zero, which would silently claim every historical delivery arrived
   * exactly in full.
   */
  quantityVariance: number | null;
  onTime: boolean;
  inFull: boolean | null;
  /** receivedOn − orderedOn, in calendar days. */
  observedLeadTimeDays: number;
}

export interface UnmatchedReceipt {
  receipt: ReceiptHistory;
  reason: 'NO_SUCH_ORDER' | 'NO_OPEN_LINE' | 'NOT_RECONCILED';
}

/** Reliability at one level of aggregation. */
export interface AdherenceStats {
  key: string;
  vendorId: string;
  itemId: string | null;
  plantId: string | null;
  receipts: number;
  /** Share of receipts arriving on or before the planned date, 0–1. */
  onTimeRate: number;
  /** Share arriving in full, over those where the ordered quantity is known. */
  inFullRate: number | null;
  /** Share both on time and in full, over those where both are known. */
  otifRate: number | null;
  /** Mean signed date variance in days. Positive means habitually late. */
  meanDateVarianceDays: number;
  /** Population standard deviation of the date variance, in days. */
  stdDevDateVarianceDays: number;
  meanLeadTimeDays: number;
  /**
   * Share of receipts hitting the date the vendor *confirmed*, over those they
   * confirmed at all. Null when this vendor confirms nothing.
   */
  confirmationAdherence: number | null;
  /** Receipts the vendor never confirmed a date for. */
  unconfirmedReceipts: number;
}

export interface AdherenceResult {
  matched: MatchedReceipt[];
  unmatched: UnmatchedReceipt[];
  byVendor: Map<string, AdherenceStats>;
  byVendorMaterial: Map<string, AdherenceStats>;
  byVendorPlant: Map<string, AdherenceStats>;
}

export interface AdherenceInput {
  receiptHistory: ReceiptHistory[];
  supply: SupplyElement[];
}

/** A delivery line with the quantity still unallocated during matching. */
interface OpenLine {
  orderId: string;
  line: DeliveryLine;
  remaining: number;
}

export function runAdherence(input: AdherenceInput): AdherenceResult {
  const openLines = indexOpenLines(input.supply);

  const matched: MatchedReceipt[] = [];
  const unmatched: UnmatchedReceipt[] = [];

  // Oldest first, so FIFO allocation consumes lines in the order a warehouse
  // would have done. Sorting by receipt date rather than by document id keeps
  // the result independent of how the source system numbers things.
  const receipts = [...input.receiptHistory].sort((a, b) =>
    a.receivedOn !== b.receivedOn ? (a.receivedOn < b.receivedOn ? -1 : 1) : a.poId < b.poId ? -1 : 1
  );

  for (const receipt of receipts) {
    // A receipt the source feed already knows reconciles to nothing. Kept and
    // counted; it never reaches the statistics.
    if (receipt.matchedLineId === null) {
      unmatched.push({ receipt, reason: 'NOT_RECONCILED' });
      continue;
    }

    const lines = openLines.get(receipt.poId);
    if (!lines || lines.length === 0) {
      // No open order document. The source feed has already reconciled this
      // receipt, so measure it against the date the vendor promised on it.
      matched.push(measureAgainstPromise(receipt));
      continue;
    }

    // 1 — exact match on order and line id.
    let target = lines.find((candidate) => lineId(candidate.orderId, candidate.line.line) === receipt.matchedLineId);
    let method: MatchMethod = 'EXACT';

    // 2 — otherwise FIFO across lines still open, earliest planned date first.
    if (!target || target.remaining <= 0) {
      target = lines.find((candidate) => candidate.remaining > 0);
      method = 'FIFO';
    }

    if (!target) {
      unmatched.push({ receipt, reason: 'NO_OPEN_LINE' });
      continue;
    }


    // 3 — partial and over-receipts. Both are allocated, never refused: the
    // quantity variance is the finding, so discarding the receipt would delete
    // the very thing worth reporting.
    const allocated = Math.min(receipt.qty, target.remaining);
    if (receipt.qty > target.remaining) method = 'OVER_RECEIPT';
    else if (receipt.qty < target.line.qty) method = 'PARTIAL';
    target.remaining -= allocated;

    matched.push(measure(receipt, target, method, receipt.qty));
  }

  return {
    matched,
    unmatched,
    byVendor: rollUp(matched, (row) => row.receipt.vendorId),
    byVendorMaterial: rollUp(matched, (row) => `${row.receipt.vendorId}@${row.receipt.itemId}`),
    byVendorPlant: rollUp(matched, (row) => `${row.receipt.vendorId}@${row.receipt.plantId}`),
  };
}

function lineId(orderId: string, line: number): string {
  return `${orderId}-${line * 10}`;
}

/**
 * A historical receipt, measured against its own promised date.
 *
 * Date variance and lead time are fully observable here. Quantity variance is
 * not — the ordered quantity closed with the order — so it is returned as null
 * and the roll-ups compute in-full only over receipts where it is known.
 */
function measureAgainstPromise(receipt: ReceiptHistory): MatchedReceipt {
  const received = toEpochDay(receipt.receivedOn);
  const dateVarianceDays = received - toEpochDay(receipt.promisedOn);
  return {
    receipt,
    orderId: receipt.poId,
    line: 1,
    method: 'PROMISED',
    allocatedQty: receipt.qty,
    dateVarianceDays,
    confirmationVarianceDays: dateVarianceDays,
    quantityVariance: null,
    onTime: dateVarianceDays <= 0,
    inFull: null,
    observedLeadTimeDays: receipt.actualLeadTimeDays,
  };
}

function indexOpenLines(supply: SupplyElement[]): Map<string, OpenLine[]> {
  const index = new Map<string, OpenLine[]>();
  for (const element of supply) {
    const schedule = element.schedule;
    if (!schedule || schedule.length === 0) continue;
    const lines = [...schedule]
      .sort((a, b) => (a.plannedDate < b.plannedDate ? -1 : a.plannedDate > b.plannedDate ? 1 : a.line - b.line))
      .map((line) => ({ orderId: element.id, line, remaining: line.qty }));
    index.set(element.id, lines);
  }
  return index;
}

function measure(
  receipt: ReceiptHistory,
  target: OpenLine,
  method: MatchMethod,
  receivedQty: number
): MatchedReceipt {
  const received = toEpochDay(receipt.receivedOn);
  const dateVarianceDays = received - toEpochDay(target.line.plannedDate);
  const confirmationVarianceDays =
    target.line.confirmedDate === null ? null : received - toEpochDay(target.line.confirmedDate);

  return {
    receipt,
    orderId: target.orderId,
    line: target.line.line,
    method,
    allocatedQty: Math.min(receivedQty, target.line.qty),
    dateVarianceDays,
    confirmationVarianceDays,
    quantityVariance: receivedQty - target.line.qty,
    onTime: dateVarianceDays <= 0,
    inFull: receivedQty >= target.line.qty,
    observedLeadTimeDays: receipt.actualLeadTimeDays,
  };
}

/**
 * Rolled up at three levels, computed separately rather than derived from one
 * another. A vendor reliable on one material is routinely unreliable on
 * another, and a single blended score hides exactly the variance the norms
 * engine is trying to measure.
 */
function rollUp(matched: MatchedReceipt[], keyOf: (row: MatchedReceipt) => string): Map<string, AdherenceStats> {
  const grouped = new Map<string, MatchedReceipt[]>();
  for (const row of matched) {
    const key = keyOf(row);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }

  const stats = new Map<string, AdherenceStats>();
  for (const [key, rows] of grouped) {
    const first = rows[0] as MatchedReceipt;
    const count = rows.length;

    let onTime = 0;
    let inFull = 0;
    let inFullKnown = 0;
    let otif = 0;
    let varianceTotal = 0;
    let leadTimeTotal = 0;
    let confirmed = 0;
    let confirmedOnTime = 0;

    for (const row of rows) {
      if (row.onTime) onTime += 1;
      if (row.inFull !== null) {
        inFullKnown += 1;
        if (row.inFull) inFull += 1;
        if (row.onTime && row.inFull) otif += 1;
      }
      varianceTotal += row.dateVarianceDays;
      leadTimeTotal += row.observedLeadTimeDays;
      if (row.confirmationVarianceDays !== null) {
        confirmed += 1;
        if (row.confirmationVarianceDays <= 0) confirmedOnTime += 1;
      }
    }

    const meanVariance = varianceTotal / count;
    let spread = 0;
    for (const row of rows) spread += (row.dateVarianceDays - meanVariance) ** 2;

    stats.set(key, {
      key,
      vendorId: first.receipt.vendorId,
      itemId: key.includes('@') ? first.receipt.itemId : null,
      plantId: key.includes('@') ? first.receipt.plantId : null,
      receipts: count,
      onTimeRate: onTime / count,
      inFullRate: inFullKnown === 0 ? null : inFull / inFullKnown,
      otifRate: inFullKnown === 0 ? null : otif / inFullKnown,
      meanDateVarianceDays: meanVariance,
      // Population, matching `observed.ts`. Two spread figures computed
      // differently in one product is a bug waiting to be argued about.
      stdDevDateVarianceDays: Math.sqrt(spread / count),
      meanLeadTimeDays: leadTimeTotal / count,
      confirmationAdherence: confirmed === 0 ? null : confirmedOnTime / confirmed,
      unconfirmedReceipts: count - confirmed,
    });
  }

  return stats;
}
