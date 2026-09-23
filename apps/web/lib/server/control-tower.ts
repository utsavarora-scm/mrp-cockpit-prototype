/**
 * Screen 8 — the purchase-order control tower.
 *
 * Screens 1 to 7 answer *what should I do about this material*. This one
 * answers *how is the whole book behaving*, and its reader is not the daily
 * planner. It is deliberately last, because it is worthless until the seven
 * before it are generating the data it counts.
 *
 * The figure that earns it: the share of the open book nobody has acknowledged.
 * Until this screen exists there is no number for it at all, and it is produced
 * as a by-product of Phase 1 rather than as a project of its own.
 *
 * Deliberately excluded: narrative summaries, recommended actions, risk scores,
 * anomaly detection. This screen counts things that happened and shows them
 * accurately. Counting is Phase 1; concluding is later.
 */

import { openQtyOf, toEpochDay } from '@repo/domain';

import type { ControlTowerView } from '../api-types';
import { runContext, type RunContext } from './context';
import { runHeader } from './header';

/** How far back the closed book looks. */
const CLOSED_BOOK_DAYS = 90;

/** A receipt inside this many days of its requested date counts as on time. */
const ON_TIME_TOLERANCE_DAYS = 2;

export function controlTower(scenarioId: string, filters: { plant?: string } = {}): ControlTowerView {
  const context = runContext(scenarioId);

  return {
    header: runHeader(context),
    openBook: openBook(context, filters),
    closedBook: closedBook(context, filters),
    byPlant: byPlant(context),
    byVendor: byVendor(context),
    byRaiser: byRaiser(context, filters),
    boundary:
      'This screen counts. It carries no recommended actions, no risk scores and no narrative — the layer that interprets these numbers needs the base system running first.',
  };
}

/**
 * The open book — where every live schedule line currently sits.
 *
 * The first row is the one that should stop a category manager.
 */
function openBook(context: RunContext, filters: { plant?: string }): ControlTowerView['openBook'] {
  const states = {
    'Awaiting vendor confirmation': { lines: 0, qty: 0, value: 0 },
    'Confirmed, not yet dispatched': { lines: 0, qty: 0, value: 0 },
    'Dispatched / in transit': { lines: 0, qty: 0, value: 0 },
    'Past due, no goods receipt': { lines: 0, qty: 0, value: 0 },
  };

  for (const facts of context.materials.values()) {
    if (filters.plant && facts.plantId !== filters.plant) continue;
    for (const order of facts.orders) {
      for (const line of order.schedule ?? []) {
        if (openQtyOf(line) === 0) continue;
        const overdue = toEpochDay(line.expectedDate) - context.planningEpochDay < -ON_TIME_TOLERANCE_DAYS;
        const bucket = overdue
          ? 'Past due, no goods receipt'
          : line.confirmedDate === null
            ? 'Awaiting vendor confirmation'
            : line.status === 'IN_TRANSIT'
              ? 'Dispatched / in transit'
              : 'Confirmed, not yet dispatched';
        states[bucket].lines += 1;
        states[bucket].qty += openQtyOf(line);
        states[bucket].value += openQtyOf(line) * facts.standardCost;
      }
    }
  }

  const totalLines = Object.values(states).reduce((sum, row) => sum + row.lines, 0) || 1;
  const totalValue = Object.values(states).reduce((sum, row) => sum + row.value, 0);

  return {
    rows: Object.entries(states).map(([state, row]) => ({
      state,
      lines: row.lines,
      share: row.lines / totalLines,
      qty: Math.round(row.qty),
      value: Math.round(row.value),
    })),
    totalLines,
    totalValue: Math.round(totalValue),
    unconfirmedShare: states['Awaiting vendor confirmation'].lines / totalLines,
  };
}

/**
 * The closed book — what actually happened.
 *
 * Whether the resulting on-time-in-full figure is good or bad is not for this
 * screen to say. It is currently unknown, and a planning organisation that does
 * not know it is tuning its norms in the dark.
 */
function closedBook(context: RunContext, filters: { plant?: string }): ControlTowerView['closedBook'] {
  const outcomes = {
    'On time (within ±2 days)': 0,
    'Late 3–7 days': 0,
    'Late 8–14 days': 0,
    'Late more than 14 days': 0,
    Early: 0,
  };

  let ordered = 0;
  let received = 0;
  let inFull = 0;
  let total = 0;

  for (const receipt of context.snapshot.receiptHistory) {
    if (filters.plant && receipt.plantId !== filters.plant) continue;
    const age = context.planningEpochDay - toEpochDay(receipt.receivedOn);
    if (age < 0 || age > CLOSED_BOOK_DAYS) continue;

    const slip = toEpochDay(receipt.receivedOn) - toEpochDay(receipt.promisedOn);
    if (slip < -ON_TIME_TOLERANCE_DAYS) outcomes['Early'] += 1;
    else if (slip <= ON_TIME_TOLERANCE_DAYS) outcomes['On time (within ±2 days)'] += 1;
    else if (slip <= 7) outcomes['Late 3–7 days'] += 1;
    else if (slip <= 14) outcomes['Late 8–14 days'] += 1;
    else outcomes['Late more than 14 days'] += 1;

    ordered += receipt.orderedQty;
    received += receipt.qty;
    // On time *and* in full — the two conditions together, which is the figure
    // that matters and the one an average of each separately overstates.
    if (Math.abs(slip) <= ON_TIME_TOLERANCE_DAYS && receipt.qty >= receipt.orderedQty) inFull += 1;
    total += 1;
  }

  const denominator = total || 1;
  return {
    rows: Object.entries(outcomes)
      .filter(([, count]) => count > 0)
      .map(([outcome, lines]) => ({ outcome, lines, share: lines / denominator })),
    totalLines: total,
    fillRate: ordered > 0 ? received / ordered : 1,
    otif: inFull / denominator,
    windowDays: CLOSED_BOOK_DAYS,
  };
}

function byPlant(context: RunContext): ControlTowerView['byPlant'] {
  const rows = new Map<string, { lines: number; value: number; unconfirmed: number }>();

  for (const facts of context.materials.values()) {
    for (const order of facts.orders) {
      for (const line of order.schedule ?? []) {
        if (openQtyOf(line) === 0) continue;
        const entry = rows.get(facts.plantId) ?? { lines: 0, value: 0, unconfirmed: 0 };
        entry.lines += 1;
        entry.value += openQtyOf(line) * facts.standardCost;
        if (line.confirmedDate === null) entry.unconfirmed += 1;
        rows.set(facts.plantId, entry);
      }
    }
  }

  return context.snapshot.plants
    .map((plant) => {
      const entry = rows.get(plant.id) ?? { lines: 0, value: 0, unconfirmed: 0 };
      return {
        id: plant.id,
        name: plant.name,
        lines: entry.lines,
        value: Math.round(entry.value),
        unconfirmedShare: entry.lines > 0 ? entry.unconfirmed / entry.lines : 0,
      };
    })
    .sort((a, b) => b.value - a.value);
}

/**
 * By vendor: median lead time and its spread, beside the value they hold.
 *
 * The two together are the sourcing conversation. A vendor with a lower price
 * and double the spread is not cheaper — they are cheaper per unit and dearer
 * in the buffer they force somebody else to carry.
 */
function byVendor(context: RunContext): ControlTowerView['byVendor'] {
  const observations = new Map<string, number[]>();
  for (const receipt of context.snapshot.receiptHistory) {
    if (receipt.matchedLineId === null) continue;
    const list = observations.get(receipt.vendorId) ?? [];
    list.push(
      receipt.qaReleasedOn === null
        ? receipt.actualLeadTimeDays
        : toEpochDay(receipt.qaReleasedOn) - toEpochDay(receipt.orderedOn),
    );
    observations.set(receipt.vendorId, list);
  }

  const open = new Map<string, { lines: number; value: number }>();
  for (const facts of context.materials.values()) {
    for (const order of facts.orders) {
      if (!order.vendorId) continue;
      for (const line of order.schedule ?? []) {
        if (openQtyOf(line) === 0) continue;
        const entry = open.get(order.vendorId) ?? { lines: 0, value: 0 };
        entry.lines += 1;
        entry.value += openQtyOf(line) * facts.standardCost;
        open.set(order.vendorId, entry);
      }
    }
  }

  const names = new Map(context.snapshot.vendors.map((vendor) => [vendor.id, vendor.name]));
  const rows: ControlTowerView['byVendor'] = [];

  for (const [vendorId, entry] of open) {
    const values = (observations.get(vendorId) ?? []).sort((a, b) => a - b);
    if (values.length === 0) continue;
    const median = values[Math.floor(values.length / 2)] as number;
    const p15 = values[Math.floor(values.length * 0.15)] as number;
    const p85 = values[Math.min(values.length - 1, Math.floor(values.length * 0.85))] as number;
    rows.push({
      id: vendorId,
      name: names.get(vendorId) ?? vendorId,
      lines: entry.lines,
      value: Math.round(entry.value),
      medianLeadTimeDays: median,
      spreadDays: p85 - p15,
    });
  }

  return rows.sort((a, b) => b.value - a.value).slice(0, 20);
}

/**
 * Who raised the order — plant or head office.
 *
 * Asked for by name. Derived from the plant that owns the material: a
 * co-packer's requirement is raised centrally, an own plant's locally.
 */
function byRaiser(context: RunContext, filters: { plant?: string }): ControlTowerView['byRaiser'] {
  const counts = { Plant: 0, 'Head office': 0 };
  const copackers = new Set(
    context.snapshot.plants.filter((plant) => plant.type === 'COPACKER').map((plant) => plant.id),
  );

  for (const facts of context.materials.values()) {
    if (filters.plant && facts.plantId !== filters.plant) continue;
    for (const order of facts.orders) {
      for (const line of order.schedule ?? []) {
        if (openQtyOf(line) === 0) continue;
        if (copackers.has(facts.plantId) || facts.vendor?.isImport) counts['Head office'] += 1;
        else counts.Plant += 1;
      }
    }
  }

  const total = counts.Plant + counts['Head office'] || 1;
  return Object.entries(counts).map(([raiser, lines]) => ({ raiser, lines, share: lines / total }));
}
