/**
 * The scheduling engine — the keystone.
 *
 * The client's fourth complaint was that a purchase order carries no delivery
 * schedule: SAP tells them to buy 2,520 MT and stops. This engine answers the
 * question that actually matters — *2,520 by when, in how many drops, and which
 * of them is impossible* — and it shows the constraints that produced the
 * answer rather than presenting it as an oracle.
 *
 * Two decisions shape the whole thing:
 *
 * **Quantity and split are one decision, not two.** With a minimum order
 * quantity, a shipment cap, a storage ceiling and a receiving rate all in play,
 * choosing the total first and slicing it afterwards produces splits that
 * violate one constraint to satisfy another. So netting hands over a
 * time-phased net requirement and this engine decides both together.
 *
 * **A line that cannot be met is emitted, flagged, with the gap in days.** It is
 * never quietly pushed out to the first date that works. With a 47-day imported
 * lead time the first line of an urgent order is routinely impossible, and the
 * planner's whole job is knowing that in time to do something else about it.
 * Silently rescheduling it is how a planning system teaches people not to trust
 * it.
 *
 * Rationales are built from the binding constraint objects, never selected from
 * a list of templates. Templated prose is the fastest way to make a prototype
 * feel fake, and this is the panel the audience reads most closely.
 */

import { fromEpochDay, normalCdf } from '@repo/domain';

import type { WorkingCalendar } from './calendar';

/**
 * Working days a single delivery may take to unload and put away.
 *
 * The receiving constraint is about flow, not storage: a plant that can put
 * away 120 MT a day cannot absorb a 900 MT drop however much rack space it has.
 */
export const MAX_UNLOAD_DAYS = 5;

export type LineFlag = 'INFEASIBLE_LINE' | 'BELOW_MOQ' | 'OVER_SHIPMENT_CAP';

export interface ScheduledLine {
  line: number;
  qty: number;
  requiredByEpochDay: number;
  requiredByDate: string;
  requestedDispatchEpochDay: number;
  requestedDispatchDate: string;
  /** Days of demand this line covers on its own. */
  coverDays: number;
  /** 0–1, from the vendor's own delivery history. */
  confidence: number;
  flags: LineFlag[];
  /** Days the dispatch date falls before the vendor can actually ship. */
  infeasibleByDays: number;
}

export type LineCountDriverKind = 'SHIPMENT_CAP' | 'STORAGE' | 'RECEIVING' | 'SHELF_LIFE';

/** One reason the order has to be split into at least so many deliveries. */
export interface LineCountDriver {
  kind: LineCountDriverKind;
  lines: number;
  binding: boolean;
  note: string;
}

export interface SchedulingInput {
  itemId: string;
  plantId: string;
  vendorId: string;
  /** Total to place with this vendor, after allocation. */
  totalQty: number;
  /** The first day the position is uncovered — where line 1 is needed. */
  firstUncoveredEpochDay: number;
  dailyDemandMean: number;

  /** The buffer the order has to restore, for the peak-on-hand check. */
  safetyStockQty: number;

  moq: number | null;
  incrementQty: number | null;
  maxShipmentQty: number | null;
  storageCapacity: number | null;
  dailyReceivingCapacity: number | null;
  shelfLifeDays: number | null;

  transitDays: number;
  /** Working days from the planning date before this vendor can dispatch. */
  earliestDispatchDays: number;
  planningEpochDay: number;

  plantCalendar: WorkingCalendar;
  vendorCalendar?: WorkingCalendar;

  /** From the adherence engine. Omitted where the vendor has no history. */
  reliability?: {
    meanDateVarianceDays: number;
    stdDevDateVarianceDays: number;
    /** Null where no historical receipt carries a known ordered quantity. */
    otifRate: number | null;
  };
}

export interface OrderSchedule {
  itemId: string;
  plantId: string;
  vendorId: string;
  totalQty: number;
  lineCount: number;
  lines: ScheduledLine[];
  drivers: LineCountDriver[];
  /** Buffer plus the largest single delivery — what is on the ground at once. */
  peakOnHand: number;
  storageCapacity: number | null;
  storageBinding: boolean;
  belowMoq: boolean;
  infeasibleLines: number;
  /** Built from the binding constraints above. */
  rationale: string;
}

export function scheduleOrder(input: SchedulingInput): OrderSchedule {
  const { totalQty, dailyDemandMean } = input;

  // --- Step 4: how many deliveries the constraints force ------------------
  const drivers: LineCountDriver[] = [];

  const byShipmentCap =
    input.maxShipmentQty && input.maxShipmentQty > 0 ? Math.ceil(totalQty / input.maxShipmentQty) : 1;
  drivers.push({
    kind: 'SHIPMENT_CAP',
    lines: byShipmentCap,
    binding: false,
    note:
      input.maxShipmentQty && input.maxShipmentQty > 0
        ? `A single shipment cannot exceed ${round(input.maxShipmentQty)}.`
        : 'No shipment cap on this vendor.',
  });

  const byStorage =
    input.storageCapacity && input.storageCapacity > 0 ? Math.ceil(totalQty / input.storageCapacity) : 1;
  drivers.push({
    kind: 'STORAGE',
    lines: byStorage,
    binding: false,
    note:
      input.storageCapacity && input.storageCapacity > 0
        ? `The plant holds ${round(input.storageCapacity)} at most.`
        : 'No storage limit recorded.',
  });

  const receivingPerDelivery =
    input.dailyReceivingCapacity && input.dailyReceivingCapacity > 0
      ? input.dailyReceivingCapacity * MAX_UNLOAD_DAYS
      : null;
  const byReceiving = receivingPerDelivery ? Math.ceil(totalQty / receivingPerDelivery) : 1;
  drivers.push({
    kind: 'RECEIVING',
    lines: byReceiving,
    binding: false,
    note: receivingPerDelivery
      ? `Goods receipt can absorb ${round(receivingPerDelivery)} in one delivery, at ${round(input.dailyReceivingCapacity as number)} a day over ${MAX_UNLOAD_DAYS} days.`
      : 'No receiving rate recorded.',
  });

  const shelfLifeQty =
    input.shelfLifeDays && input.shelfLifeDays > 0 ? dailyDemandMean * input.shelfLifeDays * 0.75 : null;
  const byShelfLife = shelfLifeQty && shelfLifeQty > 0 ? Math.ceil(totalQty / shelfLifeQty) : 1;
  drivers.push({
    kind: 'SHELF_LIFE',
    lines: byShelfLife,
    binding: false,
    note: shelfLifeQty
      ? `A delivery larger than ${round(shelfLifeQty)} would not be consumed inside three quarters of its shelf life.`
      : 'No shelf life recorded.',
  });

  let lineCount = Math.max(byShipmentCap, byStorage, byReceiving, byShelfLife, 1);
  for (const driver of drivers) driver.binding = driver.lines === lineCount && lineCount > 1;

  // Reduce until every line clears MOQ. Ordering below the minimum is never
  // silent: if it cannot be reached the whole order is flagged and the planner
  // has to pull demand forward or defer it.
  let belowMoq = false;
  if (input.moq && input.moq > 0) {
    while (lineCount > 1 && totalQty / lineCount < input.moq) lineCount -= 1;
    if (totalQty < input.moq) belowMoq = true;
  }

  // --- Step 5: line quantities -------------------------------------------
  const increment = input.incrementQty && input.incrementQty > 0 ? input.incrementQty : null;
  const evenSplit = totalQty / lineCount;
  const baseQty = increment ? Math.floor(evenSplit / increment) * increment : evenSplit;
  const quantities: number[] = new Array(lineCount).fill(baseQty);
  // The remainder rides on the last line rather than being spread, so the other
  // lines stay on the increment the vendor actually ships in.
  quantities[lineCount - 1] = totalQty - baseQty * (lineCount - 1);

  // --- Step 6: dates, paced to consumption -------------------------------
  const lines: ScheduledLine[] = [];
  const earliestDispatch = (input.vendorCalendar ?? input.plantCalendar).addWorkingDays(
    input.planningEpochDay,
    input.earliestDispatchDays
  );

  let requiredBy = input.firstUncoveredEpochDay;
  let infeasibleLines = 0;

  for (let index = 0; index < lineCount; index += 1) {
    const qty = quantities[index] as number;
    const coverDays = dailyDemandMean > 0 ? qty / dailyDemandMean : 0;

    // Snapped to a day the plant can actually receive on — never naive date
    // arithmetic, which lands deliveries on Sundays and public holidays.
    const snappedRequiredBy = input.plantCalendar.nextWorkingDayOnOrAfter(Math.round(requiredBy));
    const dispatchCalendar = input.vendorCalendar ?? input.plantCalendar;
    const requestedDispatch = dispatchCalendar.subtractWorkingDays(snappedRequiredBy, input.transitDays);

    const flags: LineFlag[] = [];
    let infeasibleByDays = 0;
    if (requestedDispatch < earliestDispatch) {
      infeasibleByDays = earliestDispatch - requestedDispatch;
      flags.push('INFEASIBLE_LINE');
      infeasibleLines += 1;
    }
    if (belowMoq) flags.push('BELOW_MOQ');
    if (input.maxShipmentQty && qty > input.maxShipmentQty) flags.push('OVER_SHIPMENT_CAP');

    lines.push({
      line: index + 1,
      qty,
      requiredByEpochDay: snappedRequiredBy,
      requiredByDate: fromEpochDay(snappedRequiredBy),
      requestedDispatchEpochDay: requestedDispatch,
      requestedDispatchDate: fromEpochDay(requestedDispatch),
      coverDays,
      confidence: confidenceFor(input.reliability),
      flags,
      infeasibleByDays,
    });

    requiredBy = snappedRequiredBy + coverDays;
  }

  // --- Peak on-hand: the storage question is about what is on the ground --
  const largestLine = quantities.reduce((max, qty) => Math.max(max, qty), 0);
  const peakOnHand = input.safetyStockQty + largestLine;
  const storageBinding =
    input.storageCapacity !== null && input.storageCapacity > 0 && peakOnHand > input.storageCapacity;

  return {
    itemId: input.itemId,
    plantId: input.plantId,
    vendorId: input.vendorId,
    totalQty,
    lineCount,
    lines,
    drivers,
    peakOnHand,
    storageCapacity: input.storageCapacity,
    storageBinding,
    belowMoq,
    infeasibleLines,
    rationale: buildRationale({ input, lineCount, quantities, drivers, lines, peakOnHand, storageBinding, belowMoq }),
  };
}

/**
 * Step 3 — split a total across vendors on their allocation shares.
 *
 * Rounding preserves the total: the shares are applied, each share rounded to
 * the vendor's own increment, and whatever the rounding lost or gained lands on
 * the largest allocation. An order that does not sum to what was asked for is
 * a bug the planner has to find by adding up the lines themselves.
 */
export function allocateAcrossVendors(
  totalQty: number,
  vendors: ReadonlyArray<{ vendorId: string; allocationShare: number; incrementQty: number | null }>
): Array<{ vendorId: string; qty: number }> {
  if (vendors.length === 0) return [];
  if (vendors.length === 1) return [{ vendorId: (vendors[0] as { vendorId: string }).vendorId, qty: totalQty }];

  const shareTotal = vendors.reduce((sum, vendor) => sum + vendor.allocationShare, 0) || 1;
  const allocated = vendors.map((vendor) => {
    const raw = (totalQty * vendor.allocationShare) / shareTotal;
    const increment = vendor.incrementQty && vendor.incrementQty > 0 ? vendor.incrementQty : null;
    return { vendorId: vendor.vendorId, qty: increment ? Math.round(raw / increment) * increment : raw };
  });

  const drift = totalQty - allocated.reduce((sum, row) => sum + row.qty, 0);
  if (drift !== 0) {
    let largest = 0;
    for (let i = 1; i < allocated.length; i += 1) {
      if ((allocated[i] as { qty: number }).qty > (allocated[largest] as { qty: number }).qty) largest = i;
    }
    (allocated[largest] as { qty: number }).qty += drift;
  }
  return allocated;
}

/**
 * Step 7 — how likely this vendor is to hit the date, from their own history.
 *
 * The line is dated so it arrives exactly when needed, so there is no slack:
 * the probability of being on time is the probability their delivery variance
 * is not positive, read off the distribution the adherence engine measured.
 */
function confidenceFor(reliability: SchedulingInput['reliability']): number {
  if (!reliability) return 0.5;
  if (reliability.stdDevDateVarianceDays === 0) {
    return reliability.otifRate === null ? 0.5 : clamp(reliability.otifRate, 0.05, 0.99);
  }
  const z = (0 - reliability.meanDateVarianceDays) / reliability.stdDevDateVarianceDays;
  return clamp(normalCdf(z), 0.05, 0.99);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function round(value: number): string {
  return Math.round(value).toLocaleString('en-IN');
}

/**
 * Step 8 — the rationale, assembled from whichever constraints actually bound.
 *
 * Every clause is conditional on a fact in the constraint objects, so a
 * material with no shipment cap and slack storage produces a shorter sentence
 * rather than the same sentence with different numbers in it.
 */
function buildRationale(context: {
  input: SchedulingInput;
  lineCount: number;
  quantities: number[];
  drivers: LineCountDriver[];
  lines: ScheduledLine[];
  peakOnHand: number;
  storageBinding: boolean;
  belowMoq: boolean;
}): string {
  const { input, lineCount, quantities, drivers, lines, peakOnHand, storageBinding, belowMoq } = context;
  const parts: string[] = [];

  const binding = drivers.filter((driver) => driver.binding);
  if (lineCount === 1) {
    parts.push(`One delivery of ${round(quantities[0] as number)}: nothing forces a split.`);
  } else if (binding.length > 0) {
    const reasons = binding.map((driver) => driver.note.replace(/\.$/, '')).join(', and ');
    parts.push(`${lineCount} lines: ${reasons}.`);
  } else {
    parts.push(`${lineCount} lines.`);
  }

  const first = quantities[0] as number;
  const last = quantities[quantities.length - 1] as number;
  const quantityClause =
    last === first
      ? `Each line at ${round(first)}`
      : `Four lines at ${round(first)} and a last of ${round(last)}`.replace('Four', String(lineCount - 1));

  const rounding: string[] = [];
  if (input.moq && input.moq > 0) rounding.push(`clears the ${round(input.moq)} minimum`);
  if (input.incrementQty && input.incrementQty > 0)
    rounding.push(`rounds to the ${round(input.incrementQty)} increment`);
  parts.push(rounding.length > 0 ? `${quantityClause} ${rounding.join(' and ')}.` : `${quantityClause}.`);

  const cover = lines[0]?.coverDays ?? 0;
  if (cover > 0) parts.push(`Paced at ${cover.toFixed(1)} days of cover each.`);

  if (storageBinding && input.storageCapacity) {
    parts.push(
      `Storage binds: the buffer of ${round(input.safetyStockQty)} plus one delivery puts ${round(peakOnHand)} on the ground against ${round(input.storageCapacity)} of space.`
    );
  }

  const infeasible = lines.filter((line) => line.infeasibleByDays > 0);
  for (const line of infeasible) {
    parts.push(
      `Line ${line.line} is required ${line.infeasibleByDays} ${line.infeasibleByDays === 1 ? 'day' : 'days'} before this vendor can dispatch it.`
    );
  }

  if (belowMoq) {
    parts.push(`The total is below the ${round(input.moq as number)} minimum — pull demand forward or defer it.`);
  }

  return parts.join(' ');
}
