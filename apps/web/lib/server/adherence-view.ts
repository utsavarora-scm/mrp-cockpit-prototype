/**
 * Screen 4 — adherence.
 *
 * The schedule builder says what was asked for. This says what happened. It is
 * the other half of the same feature, and without it the schedule is a document
 * rather than a loop.
 *
 * The part that changes the conversation is the decomposition. A twelve-day
 * slip is not "the supplier was late": split across the four intervals a lead
 * time is actually made of, it is four separate slips with four different
 * owners, and two of them routinely belong to the buyer rather than the
 * supplier. That is not an accusation — it is four different fixes, and none of
 * them is "chase the vendor harder".
 *
 * What this screen deliberately does not do: score anyone, propose a lead time,
 * or touch master data. It measures. Proposing is the norms calculator, and
 * keeping those apart is what makes the measurement trustworthy enough to act
 * on later.
 */

import { INTERVAL_OWNERS, openQtyOf, planKey, REASON_CODES, reasonLabel, toEpochDay } from '@repo/domain';

import type {
  AdherenceByMaterial,
  AdherenceByVendor,
  AdherenceLineView,
  AdherenceView,
  Distribution,
  IntervalSlip,
} from '../api-types';
import { runContext, type MaterialFacts, type RunContext } from './context';
import { runHeader } from './header';

/** How many receipts a distribution needs before it is worth drawing. */
const MIN_RECEIPTS = 4;

export function adherenceView(scenarioId: string, filters: { plant?: string; itemId?: string } = {}): AdherenceView {
  const context = runContext(scenarioId);

  return {
    header: runHeader(context),
    lines: byLine(context, filters),
    byMaterial: byMaterial(context, filters),
    byVendor: byVendor(context, filters),
    reasonCodes: reasonCodeCounts(context),
    boundary:
      'Phase 1 measures. It does not score a vendor, propose a lead time or change master data — that is the norms calculator, and keeping the two apart is what makes this measurement worth acting on.',
  };
}

/**
 * By line — the permanent record behind one delivery.
 *
 * Every committed schedule line records what was requested, what the vendor
 * committed to, when it was dispatched, when it was received, when it cleared
 * quality, and the reason for any change. None of that exists in a system at
 * GCPL today, which is the whole point: it costs the planner nothing they were
 * not already doing, and after one ordering cycle it is the only dataset a lead
 * time can be measured from rather than remembered.
 */
function byLine(context: RunContext, filters: { plant?: string; itemId?: string }): AdherenceLineView[] {
  const rows: AdherenceLineView[] = [];

  for (const facts of context.materials.values()) {
    if (filters.plant && facts.plantId !== filters.plant) continue;
    if (filters.itemId && facts.itemId !== filters.itemId) continue;

    for (const order of facts.orders) {
      for (const line of order.schedule ?? []) {
        const requested = toEpochDay(line.plannedDate);
        const arrived = line.qaReleasedOn ?? line.grnDate ?? (line.status === 'RECEIVED' ? line.expectedDate : null);
        rows.push({
          itemId: facts.itemId,
          plantId: facts.plantId,
          description: facts.description,
          baseUom: facts.baseUom,
          poId: order.id,
          line: line.line,
          requestedDate: line.plannedDate,
          committedDate: line.confirmedDate,
          grnDate: line.grnDate,
          qaReleasedOn: line.qaReleasedOn,
          requestedQty: Math.round(line.qty),
          committedQty: line.confirmedDate === null ? null : Math.round(line.qty),
          receivedQty: line.grnQty === null ? null : Math.round(line.grnQty),
          fillRate: line.grnQty === null ? null : line.grnQty / Math.max(line.qty, 1),
          deviationDays: arrived === null ? null : toEpochDay(arrived) - requested,
          reasonCode: line.reasonCode,
          reasonLabel: reasonLabel(line.reasonCode),
          intervals: lineIntervals(
            facts,
            line.releasedOn,
            line.acknowledgedOn,
            line.dispatchedOn,
            line.grnDate,
            line.qaReleasedOn,
          ),
        });
      }
    }
  }

  // Worst deviation first: an on-time line is not what anybody opens this for.
  rows.sort((a, b) => (b.deviationDays ?? -999) - (a.deviationDays ?? -999));
  return rows.slice(0, 200);
}

/**
 * The four intervals, maintained against actual.
 *
 * Where a boundary date is missing the interval is reported as unmeasured
 * rather than assumed to be on time. An interval nobody recorded is not an
 * interval that went well.
 */
function lineIntervals(
  facts: MaterialFacts,
  releasedOn: string | null,
  acknowledgedOn: string | null,
  dispatchedOn: string | null,
  grnDate: string | null,
  qaReleasedOn: string | null,
): IntervalSlip[] {
  const chain = new Map(facts.chain.intervals.map((interval) => [interval.key, interval.days]));
  const slips: IntervalSlip[] = [];

  const add = (
    key: string,
    label: string,
    owner: string,
    maintained: number,
    from: string | null,
    to: string | null,
  ): void => {
    if (from === null || to === null) return;
    const actual = toEpochDay(to) - toEpochDay(from);
    slips.push({ key, label, owner, maintainedDays: maintained, actualDays: actual, slipDays: actual - maintained });
  };

  add(
    'response',
    'Vendor response — release to acknowledgement',
    INTERVAL_OWNERS.response,
    chain.get('response') ?? 0,
    releasedOn,
    acknowledgedOn,
  );
  add(
    'readiness',
    'Vendor readiness — acknowledgement to dispatch',
    INTERVAL_OWNERS.readiness,
    chain.get('readiness') ?? 0,
    acknowledgedOn,
    dispatchedOn,
  );
  add(
    'transit',
    'Transit and clearance — dispatch to gate-in',
    INTERVAL_OWNERS.transit,
    (chain.get('transit') ?? 0) + (chain.get('customs') ?? 0),
    dispatchedOn,
    grnDate,
  );
  add(
    'release',
    'Receipt to available — gate-in to quality release',
    INTERVAL_OWNERS.release,
    (chain.get('goodsReceipt') ?? 0) + (chain.get('qaRelease') ?? 0),
    grnDate,
    qaReleasedOn,
  );

  return slips;
}

/**
 * By material — the distribution rather than the average.
 *
 * A planner needs to see whether 104 days is a reliable 104 or a coin toss
 * between 88 and 121, because those two facts imply completely different
 * buffers and the average hides the difference entirely.
 */
function byMaterial(context: RunContext, filters: { plant?: string; itemId?: string }): AdherenceByMaterial[] {
  const rows: AdherenceByMaterial[] = [];

  for (const facts of context.materials.values()) {
    if (filters.plant && facts.plantId !== filters.plant) continue;
    if (filters.itemId && facts.itemId !== filters.itemId) continue;

    const receipts = context.snapshot.receiptHistory.filter(
      (row) => row.itemId === facts.itemId && row.plantId === facts.plantId && row.matchedLineId !== null,
    );
    if (receipts.length < MIN_RECEIPTS) continue;

    const observations = receipts.map((row) =>
      row.qaReleasedOn === null ? row.actualLeadTimeDays : toEpochDay(row.qaReleasedOn) - toEpochDay(row.orderedOn),
    );
    const distribution = distributionOf(observations);
    const orderedTotal = receipts.reduce((sum, row) => sum + row.orderedQty, 0);
    const receivedTotal = receipts.reduce((sum, row) => sum + row.qty, 0);

    rows.push({
      itemId: facts.itemId,
      plantId: facts.plantId,
      description: facts.description,
      baseUom: facts.baseUom,
      maintainedDays: facts.itemPlant.leadTimeDays,
      distribution,
      fillRate: orderedTotal > 0 ? receivedTotal / orderedTotal : 1,
      driftDays:
        facts.itemPlant.leadTimeDays === null ? null : round1(distribution.meanDays - facts.itemPlant.leadTimeDays),
      intervals: aggregateIntervals(context, receipts, facts),
    });
  }

  rows.sort((a, b) => Math.abs(b.driftDays ?? 0) - Math.abs(a.driftDays ?? 0));
  return rows.slice(0, 120);
}

/**
 * By vendor — the same distribution across everything they supply.
 *
 * Import and domestic lanes are never pooled: they have different means,
 * different variances and different failure modes, and averaging them describes
 * neither. That separation is already in the data, since a vendor is one or the
 * other.
 */
function byVendor(context: RunContext, filters: { plant?: string; itemId?: string }): AdherenceByVendor[] {
  const grouped = new Map<
    string,
    { observations: number[]; ordered: number; received: number; onTime: number; materials: Set<string> }
  >();

  for (const receipt of context.snapshot.receiptHistory) {
    if (filters.plant && receipt.plantId !== filters.plant) continue;
    if (filters.itemId && receipt.itemId !== filters.itemId) continue;
    if (receipt.matchedLineId === null) continue;

    const entry = grouped.get(receipt.vendorId) ?? {
      observations: [],
      ordered: 0,
      received: 0,
      onTime: 0,
      materials: new Set<string>(),
    };
    const total =
      receipt.qaReleasedOn === null
        ? receipt.actualLeadTimeDays
        : toEpochDay(receipt.qaReleasedOn) - toEpochDay(receipt.orderedOn);
    entry.observations.push(total);
    entry.ordered += receipt.orderedQty;
    entry.received += receipt.qty;
    if (Math.abs(toEpochDay(receipt.receivedOn) - toEpochDay(receipt.promisedOn)) <= 2) entry.onTime += 1;
    entry.materials.add(receipt.itemId);
    grouped.set(receipt.vendorId, entry);
  }

  const openValueByVendor = new Map<string, number>();
  for (const facts of context.materials.values()) {
    for (const order of facts.orders) {
      if (!order.vendorId) continue;
      const value = (order.schedule ?? []).reduce((sum, line) => sum + openQtyOf(line) * facts.standardCost, 0);
      openValueByVendor.set(order.vendorId, (openValueByVendor.get(order.vendorId) ?? 0) + value);
    }
  }

  const vendorName = new Map(context.snapshot.vendors.map((vendor) => [vendor.id, vendor.name]));
  const rows: AdherenceByVendor[] = [];

  for (const [vendorId, entry] of grouped) {
    if (entry.observations.length < MIN_RECEIPTS) continue;
    rows.push({
      vendorId,
      vendorName: vendorName.get(vendorId) ?? vendorId,
      materials: entry.materials.size,
      distribution: distributionOf(entry.observations),
      fillRate: entry.ordered > 0 ? entry.received / entry.ordered : 1,
      onTimeRate: entry.onTime / entry.observations.length,
      openBookValue: Math.round(openValueByVendor.get(vendorId) ?? 0),
      intervals: [],
    });
  }

  rows.sort((a, b) => b.openBookValue - a.openBookValue);
  return rows;
}

function aggregateIntervals(
  context: RunContext,
  receipts: RunContext['snapshot']['receiptHistory'],
  facts: MaterialFacts,
): IntervalSlip[] {
  const chain = new Map(facts.chain.intervals.map((interval) => [interval.key, interval.days]));
  const totals = {
    response: [] as number[],
    readiness: [] as number[],
    transit: [] as number[],
    release: [] as number[],
  };

  for (const receipt of receipts) {
    if (receipt.acknowledgedOn === null || receipt.dispatchedOn === null || receipt.qaReleasedOn === null) continue;
    totals.response.push(toEpochDay(receipt.acknowledgedOn) - toEpochDay(receipt.orderedOn));
    totals.readiness.push(toEpochDay(receipt.dispatchedOn) - toEpochDay(receipt.acknowledgedOn));
    totals.transit.push(toEpochDay(receipt.receivedOn) - toEpochDay(receipt.dispatchedOn));
    totals.release.push(toEpochDay(receipt.qaReleasedOn) - toEpochDay(receipt.receivedOn));
  }
  void context;

  const meanOf = (values: number[]): number =>
    values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;

  const rows: Array<[string, string, string, number, number[]]> = [
    [
      'response',
      'Vendor response — release to acknowledgement',
      INTERVAL_OWNERS.response,
      chain.get('response') ?? 0,
      totals.response,
    ],
    [
      'readiness',
      'Vendor readiness — acknowledgement to dispatch',
      INTERVAL_OWNERS.readiness,
      chain.get('readiness') ?? 0,
      totals.readiness,
    ],
    [
      'transit',
      'Transit and clearance — dispatch to gate-in',
      INTERVAL_OWNERS.transit,
      (chain.get('transit') ?? 0) + (chain.get('customs') ?? 0),
      totals.transit,
    ],
    [
      'release',
      'Receipt to available — gate-in to quality release',
      INTERVAL_OWNERS.release,
      (chain.get('goodsReceipt') ?? 0) + (chain.get('qaRelease') ?? 0),
      totals.release,
    ],
  ];

  return rows
    .filter(([, , , , values]) => values.length > 0)
    .map(([key, label, owner, maintained, values]) => {
      const actual = round1(meanOf(values));
      return {
        key,
        label,
        owner,
        maintainedDays: maintained,
        actualDays: actual,
        slipDays: round1(actual - maintained),
      };
    });
}

function distributionOf(values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const min = sorted[0] as number;
  const max = sorted[sorted.length - 1] as number;

  const bucketCount = Math.min(8, Math.max(3, Math.round(Math.sqrt(values.length))));
  const width = Math.max(1, Math.ceil((max - min + 1) / bucketCount));
  const buckets: Distribution['buckets'] = [];
  for (let from = min; from <= max; from += width) {
    const to = from + width - 1;
    buckets.push({ from, to, count: values.filter((value) => value >= from && value <= to).length });
  }

  return {
    count: values.length,
    meanDays: round1(mean),
    medianDays: sorted[Math.floor(sorted.length / 2)] as number,
    stdDevDays: round1(Math.sqrt(variance)),
    minDays: min,
    maxDays: max,
    buckets,
  };
}

/**
 * Reason codes, counted.
 *
 * A deviation with no reason is a number; a deviation with a reason is a
 * pattern. Counting them is also what later lets a genuine one-off be excluded
 * from a lead-time calculation without anyone quietly deleting inconvenient
 * data.
 */
function reasonCodeCounts(context: RunContext): AdherenceView['reasonCodes'] {
  const counts = new Map<string, number>();
  for (const receipt of context.snapshot.receiptHistory) {
    if (receipt.reasonCode === null) continue;
    counts.set(receipt.reasonCode, (counts.get(receipt.reasonCode) ?? 0) + 1);
  }
  for (const facts of context.materials.values()) {
    for (const order of facts.orders) {
      for (const line of order.schedule ?? []) {
        if (line.reasonCode === null) continue;
        counts.set(line.reasonCode, (counts.get(line.reasonCode) ?? 0) + 1);
      }
    }
  }

  return REASON_CODES.map((row) => ({
    code: row.code,
    label: row.label,
    owner: row.owner,
    count: counts.get(row.code) ?? 0,
  })).sort((a, b) => b.count - a.count);
}

/** One material's adherence, for the panel that opens from the material screen. */
export function adherenceForMaterial(scenarioId: string, itemId: string, plantId: string): AdherenceByMaterial | null {
  const context = runContext(scenarioId);
  if (!context.materials.has(planKey(itemId, plantId))) return null;
  return byMaterial(context, { plant: plantId, itemId })[0] ?? null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
