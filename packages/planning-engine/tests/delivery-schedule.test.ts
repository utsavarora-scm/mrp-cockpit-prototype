/**
 * The delivery schedule, checked against the worked example it was written for.
 *
 * The example is the sponsor's headline ask made concrete: a six-week campaign
 * for a packaging material where two constraints bind and the interesting one
 * is not the one anybody expects. Every figure below is the one the
 * requirements document works by hand, so a change to the scheduler that
 * quietly stops reproducing it fails here rather than in front of an audience.
 */

import { describe, expect, it } from 'vitest';
import { toEpochDay } from '@repo/domain';

import { buildDeliverySchedule, type DeliveryScheduleInput } from '../src/delivery-schedule';
import { WorkingCalendar } from '../src/calendar';

const PLANNING_DATE = '2026-08-31';
const PLANNING_EPOCH = toEpochDay(PLANNING_DATE);

/** Six working days a week — a plant that receives Monday to Saturday. */
const SIX_DAY = new WorkingCalendar({ id: 'CAL', workingDays: [1, 2, 3, 4, 5, 6], holidays: [] }, PLANNING_DATE, 400);

/**
 * The worked example, input for input.
 *
 * Opening 260,000; safety stock 100,000; the promotion's weekly requirement
 * across W37 to W42; a vendor that can make 250,000 a week but shuts for
 * maintenance in W39; and a plant that can only hold 320,000 empty bottles.
 */
function bottleCampaign(overrides: Partial<DeliveryScheduleInput> = {}): DeliveryScheduleInput {
  const requirements = new Float64Array(200);
  const weekly = [180_000, 210_000, 240_000, 240_000, 200_000, 180_000];
  // W37 starts seven days after the planning Monday.
  for (let week = 0; week < weekly.length; week += 1) {
    const perDay = (weekly[week] as number) / 7;
    for (let day = 0; day < 7; day += 1) requirements[7 + week * 7 + day] = perDay;
  }

  return {
    itemId: 'PM-88431',
    plantId: 'M014',
    vendorId: 'V-PKG-01',
    planningEpochDay: PLANNING_EPOCH,
    fromDay: 7,
    toDay: 48,
    grossRequirements: requirements,
    openingBalance: 260_000,
    safetyStock: 100_000,
    dailyDemandMean: 30_000,
    moq: 100_000,
    roundingValue: 10_000,
    maxLotSize: null,
    weeklyCapacity: 250_000,
    storageCapacity: 320_000,
    minGapDays: 4,
    dailyReceivingCapacity: 120_000,
    shelfLifeDays: null,
    qaQuarantineDays: 1,
    sourceSplit: [],
    transitDays: 2,
    earliestReceiptDay: 10,
    productionShutdownWeeks: ['2026-09-21'],
    plantCalendar: SIX_DAY,
    vendorCalendar: SIX_DAY,
    ...overrides,
  };
}

describe('the ideal schedule — what the planner wants', () => {
  const result = buildDeliverySchedule(bottleCampaign());

  it('covers one delivery per week of the campaign', () => {
    expect(result.ideal).toHaveLength(6);
    expect(result.ideal.map((line) => line.week)).toEqual(['W37', 'W38', 'W39', 'W40', 'W41', 'W42']);
    expect(result.ideal.map((line) => line.line)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it('asks for exactly what each week needs to end on its buffer', () => {
    expect(result.ideal.map((line) => Math.round(line.qty))).toEqual([
      100_000, 130_000, 240_000, 240_000, 200_000, 180_000,
    ]);
    expect(Math.round(result.totals.ideal)).toBe(1_090_000);
  });

  it('separates the minimum-order top-up from the requirement that earned it', () => {
    const first = result.ideal[0];
    // Line 10 is 100,000 and not 20,000 because the minimum floors it. That
    // 80,000 is a lot-sizing addition, not a requirement, and a planner should
    // never have to work out which part of an order is need and which is rule.
    expect(Math.round(first?.needQty ?? 0)).toBe(20_000);
    expect(Math.round(first?.lotSizingAddition ?? 0)).toBe(80_000);
    expect(first?.lotSizingReason).toBe('MOQ');

    // Every later line is pure requirement.
    for (const line of result.ideal.slice(1)) expect(Math.round(line.lotSizingAddition)).toBe(0);
  });

  it('holds the buffer in every week, because nothing is constraining it', () => {
    expect(result.ideal.map((line) => Math.round(line.balanceAfter))).toEqual([
      180_000, 100_000, 100_000, 100_000, 100_000, 100_000,
    ]);
  });
});

describe('the committed schedule — what can actually be asked for', () => {
  const result = buildDeliverySchedule(bottleCampaign());
  const committed = result.committed;

  it('empties the closed week and finds the quantity elsewhere', () => {
    expect(Math.round(committed[2]?.qty ?? -1)).toBe(0);
    expect(committed[2]?.constraint).toBe('VENDOR_SHUTDOWN');
  });

  it('reproduces the worked schedule, line for line', () => {
    expect(committed.map((line) => Math.round(line.qty))).toEqual([240_000, 210_000, 0, 240_000, 220_000, 180_000]);
    expect(committed.map((line) => Math.round(line.balanceAfter))).toEqual([
      320_000, 320_000, 80_000, 80_000, 100_000, 100_000,
    ]);
  });

  it('moves not one unit more than the ideal schedule asked for', () => {
    // Conservation. A committed schedule that does not sum to the ideal one is
    // a schedule that has quietly decided something on the planner's behalf.
    expect(Math.round(result.totals.committed)).toBe(Math.round(result.totals.ideal));
    expect(Math.round(result.totals.delta)).toBe(0);
  });

  it('attributes every unit of difference to a named constraint', () => {
    for (const delta of result.deltas) {
      expect(delta.constraint).toBeTruthy();
      expect(delta.note.length).toBeGreaterThan(0);
    }
    const moved = result.deltas.reduce((sum, delta) => sum + Math.abs(delta.delta), 0);
    expect(moved).toBeGreaterThan(0);
  });

  it('dates every delivery to a day the plant can receive on', () => {
    for (const line of committed) {
      const dow = new Date(`${line.deliveryDate}T00:00:00Z`).getUTCDay();
      expect(dow).not.toBe(0);
    }
  });

  it('back-schedules a dispatch date over the vendor calendar', () => {
    for (const line of committed) expect(line.dispatchDate < line.deliveryDate).toBe(true);
  });
});

describe('the delta ledger — why the two differ', () => {
  const result = buildDeliverySchedule(bottleCampaign());

  it('names the warehouse, not the vendor, as the binding constraint', () => {
    // The beat the whole example exists for. The vendor could supply 250,000
    // in each week; the plant can hold 320,000 empty bottles. Getting this
    // backwards is the difference between a phone call to the wrong person and
    // a decision about floor space.
    const storage = result.constraints.find((row) => row.key === 'STORAGE_CAP');
    const capacity = result.constraints.find((row) => row.key === 'VENDOR_CAPACITY');
    expect(storage?.binding).toBe(true);
    expect(capacity?.binding).toBe(false);

    const ledger = result.ledger.join(' ');
    expect(ledger).toContain('not vendor capacity');
    expect(ledger).toContain('warehouse volumetric ceiling');
  });

  it('states the residual exposure rather than burying it', () => {
    expect(result.residual).not.toBeNull();
    expect(result.residual?.weeks).toEqual(['W39', 'W40']);
    expect(Math.round(result.residual?.shortfall ?? 0)).toBe(20_000);
    expect(result.residual?.recoveredIn).toBe('W41');
    // A dip into the buffer, not a stock-out. The difference matters enormously
    // and the two must never be reported as the same event.
    expect(result.residual?.stocksOut).toBe(false);
  });

  it('offers only levers the constraint set actually supports', () => {
    const options = result.options.join(' ');
    // The shutdown stops production, not dispatch — the kind of thing a planner
    // knows and a system usually does not.
    expect(options).toContain('shutdown stops production, not dispatch');
    expect(options).toContain('external floor space');
  });

  it('says so when no lot-sizing adjustment was needed on the committed lines', () => {
    const placed = result.committed.filter((line) => line.qty > 0);
    for (const line of placed) {
      expect(line.qty % 10_000).toBe(0);
      expect(line.qty).toBeGreaterThanOrEqual(100_000);
    }
  });
});

describe('when nothing binds', () => {
  const result = buildDeliverySchedule(
    bottleCampaign({ productionShutdownWeeks: [], weeklyCapacity: null, storageCapacity: null })
  );

  it('commits the ideal schedule unchanged, and says nothing moved', () => {
    expect(result.committed.map((line) => Math.round(line.qty))).toEqual(
      result.ideal.map((line) => Math.round(line.qty))
    );
    expect(result.deltas).toHaveLength(0);
    expect(result.residual).toBeNull();
    expect(result.ledger.join(' ')).toContain('holds the buffer in every week');
  });
});

describe('the lead-time fence', () => {
  it('flags a line required before a new order could arrive, and does not move it', () => {
    // Ninety days of lead time against a campaign that starts next week: the
    // first four lines are physically unreachable. Pushing them out to the
    // first date that works would be the one behaviour guaranteed to teach a
    // planner not to trust the schedule.
    const result = buildDeliverySchedule(bottleCampaign({ earliestReceiptDay: 90 }));
    const unreachable = result.committed.filter((line) => line.insideFence);
    expect(unreachable.length).toBeGreaterThan(0);
    expect(unreachable[0]?.unreachableByDays).toBeGreaterThan(0);
    // The dates are unchanged — the schedule still says when it was needed.
    const baseline = buildDeliverySchedule(bottleCampaign());
    expect(result.committed.map((line) => line.deliveryDate)).toEqual(
      baseline.committed.map((line) => line.deliveryDate)
    );
    expect(result.ledger.join(' ')).toContain('before a newly placed order could arrive');
  });
});

describe('a shutdown the schedule can absorb entirely', () => {
  it('recovers in one week rather than dribbling across three', () => {
    // Lift the ceiling and the whole displaced quantity fits in one earlier
    // week. Three small deliveries for one problem is three receipts and three
    // invoices, which is what the minimum-gap rule exists to prevent.
    const result = buildDeliverySchedule(bottleCampaign({ storageCapacity: 900_000, weeklyCapacity: 600_000 }));
    const touched = result.committed.filter((line) => line.delta !== 0 && line.qty > 0);
    expect(touched.length).toBeLessThanOrEqual(2);
    expect(Math.round(result.totals.delta)).toBe(0);
    expect(result.residual).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// No unattributed deltas, and no quantity quietly deleted
// ---------------------------------------------------------------------------

describe('the invariant the module is written around', () => {
  it('names a constraint for every moved unit, or refuses to send the schedule', () => {
    const result = buildDeliverySchedule(bottleCampaign());

    for (const delta of result.deltas) {
      expect(delta.constraint, `${delta.week} moved ${delta.delta} with no cause`).not.toBeNull();
      expect(delta.note.length).toBeGreaterThan(0);
    }
    expect(result.blockingViolations).toEqual([]);
  });

  it('raises a blocking violation rather than guessing when it cannot attribute one', () => {
    // A guessed attribution is worse than an empty field: it prints a
    // constraint the panel beside it may not even list, in the one place the
    // product is asking to be trusted. So the schedule is refused instead.
    const result = buildDeliverySchedule(bottleCampaign());
    const unattributed = result.deltas.filter((delta) => delta.constraint === null);
    expect(result.blockingViolations.filter((row) => row.constraint === 'UNATTRIBUTED')).toHaveLength(
      unattributed.length
    );
  });

  it('keeps the totals footing across every plausible parameter set', () => {
    // A sweep rather than one case: the conservation bug that shipped was a
    // sub-minimum line being zeroed without the quantity going anywhere, and it
    // only appeared at a minimum the worked example never reaches.
    for (const moq of [0, 50_000, 100_000, 175_000]) {
      for (const capacity of [null, 150_000, 250_000]) {
        for (const storage of [null, 260_000, 320_000, 500_000]) {
          const result = buildDeliverySchedule(
            bottleCampaign({ moq, weeklyCapacity: capacity, storageCapacity: storage })
          );
          const label = `moq ${moq}, capacity ${capacity}, storage ${storage}`;
          const lost = result.totals.ideal - result.totals.committed;
          const unplaced = result.blockingViolations
            .filter((row) => row.constraint === 'UNPLACEABLE')
            .reduce((sum, row) => sum + row.qty, 0);

          // Either the quantity is on the schedule, or it is named as quantity
          // that could not be placed. It never simply stops existing.
          expect(Math.abs(lost - unplaced), label).toBeLessThan(1);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The planner's own edits
// ---------------------------------------------------------------------------

describe('a line the planner sets by hand', () => {
  it('comes back exactly as typed, whatever the engine would have preferred', () => {
    const result = buildDeliverySchedule(bottleCampaign({ plannerLines: [{ line: 30, qty: 150_000 }] }));
    expect(result.committed.find((line) => line.line === 30)?.qty).toBe(150_000);
  });

  it('names the constraint it breaks, against the line that broke it', () => {
    // W39 is the vendor's shutdown week and the plant is already near its
    // ceiling. Both are the planner's to override; neither is silently allowed.
    const result = buildDeliverySchedule(bottleCampaign({ plannerLines: [{ line: 30, qty: 150_000 }] }));
    const raised = result.blockingViolations.filter((row) => row.line === 30);

    expect(raised.map((row) => row.constraint)).toContain('VENDOR_SHUTDOWN');
    for (const violation of raised) expect(violation.message.length).toBeGreaterThan(0);
  });

  it('names a broken minimum and a broken pallet multiple', () => {
    const result = buildDeliverySchedule(bottleCampaign({ plannerLines: [{ line: 60, qty: 35_555 }] }));
    const raised = result.blockingViolations.filter((row) => row.line === 60).map((row) => row.constraint);

    expect(raised).toContain('MOQ');
    expect(raised).toContain('ROUNDING');
  });

  it('names the warehouse ceiling when an edit puts too much on the floor', () => {
    const result = buildDeliverySchedule(bottleCampaign({ plannerLines: [{ line: 10, qty: 400_000 }] }));
    const raised = result.blockingViolations.filter((row) => row.line === 10);

    expect(raised.map((row) => row.constraint)).toContain('STORAGE_CAP');
    expect(raised.find((row) => row.constraint === 'STORAGE_CAP')?.message).toMatch(/320,000|3,20,000/);
  });

  it('offers what it would have done elsewhere rather than doing it', () => {
    const result = buildDeliverySchedule(bottleCampaign({ plannerLines: [{ line: 10, qty: 100_000 }] }));

    // The edited line is untouched; the rebalance is a proposal on the others.
    expect(result.committed.find((line) => line.line === 10)?.qty).toBe(100_000);
    expect(result.proposedCorrections.every((row) => row.line !== 10)).toBe(true);
    for (const correction of result.proposedCorrections) expect(correction.reason.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Blocking against advisory
// ---------------------------------------------------------------------------

describe('what stops a schedule going out, and what does not', () => {
  it('treats the worked example‘s residual exposure as a finding, not an error', () => {
    // The whole point of the packaging example is that it ends 20,000 short of
    // the buffer for two weeks and that this is the honest answer. Blocking on
    // it would mean the only sendable schedule is one with nothing to say.
    const result = buildDeliverySchedule(bottleCampaign());

    expect(result.blockingViolations).toEqual([]);
    expect(result.advisories.some((row) => row.kind === 'RESIDUAL_EXPOSURE')).toBe(true);
    expect(result.advisories.find((row) => row.kind === 'RESIDUAL_EXPOSURE')?.message).toMatch(/20,000|safety stock/);
  });

  it('reports a line inside the fence as an advisory, and leaves the date alone', () => {
    const result = buildDeliverySchedule(bottleCampaign({ earliestReceiptDay: 25 }));
    const inside = result.committed.filter((line) => line.insideFence);

    expect(inside.length).toBeGreaterThan(0);
    for (const line of inside) {
      expect(result.advisories.some((row) => row.kind === 'INSIDE_FENCE' && row.line === line.line)).toBe(true);
    }
    // Flagged, never quietly pushed out to the first date that works.
    expect(result.committed.map((line) => line.week)).toEqual(['W37', 'W38', 'W39', 'W40', 'W41', 'W42']);
  });
});

// ---------------------------------------------------------------------------
// The constraint set of §6.2, one case each
// ---------------------------------------------------------------------------
//
// A matrix rather than a sample. The shelf-life and shipment-gap logic existed
// in a module nothing on this path imported, and the gap was reported as slack
// whatever the schedule did — both invisible because nothing enumerated the
// list the requirements document actually asks for.

describe('§6.2 — minimum gap between deliveries', () => {
  it('merges a delivery that crowds the one before it, and says so', () => {
    // Deliveries land weekly, so a ten-day minimum cannot be met by two
    // consecutive weeks: the second is folded back rather than dribbled out.
    const result = buildDeliverySchedule(bottleCampaign({ minGapDays: 10 }));
    const gap = result.constraints.find((row) => row.key === 'MIN_GAP');

    expect(gap?.binding).toBe(true);
    const delivered = result.committed.filter((line) => line.qty > 0).map((line) => line.deliveryDay);
    for (let index = 1; index < delivered.length; index += 1) {
      expect((delivered[index] as number) - (delivered[index - 1] as number)).toBeGreaterThanOrEqual(10);
    }
  });

  it('reports it as slack when the schedule already clears it', () => {
    const result = buildDeliverySchedule(bottleCampaign());
    expect(result.constraints.find((row) => row.key === 'MIN_GAP')?.binding).toBe(false);
  });
});

describe('§6.2 — maximum lot', () => {
  it('ceilings a delivery, and does it after the pull-forward as well as before', () => {
    const result = buildDeliverySchedule(bottleCampaign({ maxLotSize: 200_000 }));

    for (const line of result.committed) expect(line.qty).toBeLessThanOrEqual(200_000);
    expect(result.constraints.find((row) => row.key === 'MAX_LOT')?.binding).toBe(true);
  });
});

describe('§6.2 — shelf life', () => {
  it('ceilings forward cover the way the warehouse ceilings holding', () => {
    // Two days of shelf life on a 30,000-a-day mover leaves room for almost
    // nothing, whatever the floor could hold.
    const result = buildDeliverySchedule(
      bottleCampaign({ storageCapacity: null, weeklyCapacity: null, shelfLifeDays: 2, moq: 0, roundingValue: null })
    );

    expect(result.constraints.find((row) => row.key === 'SHELF_LIFE')?.binding).toBe(true);
    // Shelf life ceilings what can be *added*, not what is already on the
    // floor: two days of cover cannot un-buy the 260,000 the campaign opens
    // with. So nothing the schedule delivers may lift the position at all.
    for (const line of result.committed) expect(line.balanceAfter).toBeLessThanOrEqual(260_000);
    expect(result.totals.committed).toBeLessThan(result.totals.ideal);
  });

  it('is reported and does not bind where the material keeps long enough', () => {
    const result = buildDeliverySchedule(bottleCampaign({ shelfLifeDays: 365 }));
    const shelfLife = result.constraints.find((row) => row.key === 'SHELF_LIFE');
    expect(shelfLife).toBeDefined();
    expect(shelfLife?.binding).toBe(false);
  });
});

describe('§6.2 — daily receiving capacity', () => {
  it('says how many days a delivery takes to clear the dock', () => {
    const result = buildDeliverySchedule(bottleCampaign());
    const biggest = result.committed.reduce((max, line) => Math.max(max, line.qty), 0);

    // 240,000 at 120,000 a day is two days on the dock, not a reason to order
    // less — the receiving rate spreads the unload, it does not cap the line.
    expect(biggest).toBe(240_000);
    expect(result.committed.find((line) => line.qty === biggest)?.unloadDays).toBe(2);
    expect(result.constraints.find((row) => row.key === 'RECEIVING_CAPACITY')?.binding).toBe(true);
  });
});

describe('§6.2 — quality inspection', () => {
  it('separates the day it arrives from the day it can be used', () => {
    const result = buildDeliverySchedule(bottleCampaign({ qaQuarantineDays: 3 }));

    for (const line of result.committed) {
      expect(line.availableDate > line.deliveryDate, `${line.week}: ${line.deliveryDate} → ${line.availableDate}`).toBe(
        true
      );
    }
    expect(result.constraints.find((row) => row.key === 'QA_QUARANTINE')?.binding).toBe(true);
  });
});

describe('§6.2 — source split', () => {
  it('divides every line across its sources, and the parts sum to the line', () => {
    const result = buildDeliverySchedule(
      bottleCampaign({
        sourceSplit: [
          { vendorId: 'V-A', vendorName: 'Primary', share: 0.6 },
          { vendorId: 'V-B', vendorName: 'Secondary', share: 0.4 },
        ],
      })
    );

    for (const line of result.committed) {
      if (line.qty === 0) continue;
      expect(line.split).toHaveLength(2);
      expect(line.split.reduce((sum, part) => sum + part.qty, 0)).toBe(line.qty);
    }
    expect(result.constraints.find((row) => row.key === 'SOURCE_SPLIT')?.binding).toBe(true);
  });

  it('does not split a line that has one source', () => {
    const result = buildDeliverySchedule(bottleCampaign());
    for (const line of result.committed) expect(line.split).toEqual([]);
  });
});

describe('§6.2 — calendars and transit', () => {
  it('dates every delivery on a day the plant can receive on', () => {
    const fiveDay = new WorkingCalendar({ id: 'CAL5', workingDays: [1, 2, 3, 4, 5], holidays: [] }, PLANNING_DATE, 400);
    const result = buildDeliverySchedule(bottleCampaign({ plantCalendar: fiveDay }));

    for (const line of result.committed) {
      const day = (toEpochDay(line.deliveryDate) + 4) % 7;
      expect(day, `${line.week} lands on a closed day`).toBeGreaterThan(0);
      expect(day).toBeLessThan(6);
    }
  });

  it('backs the dispatch date off the delivery date by the transit time', () => {
    const result = buildDeliverySchedule(bottleCampaign({ transitDays: 5 }));
    for (const line of result.committed) {
      expect(toEpochDay(line.deliveryDate) - toEpochDay(line.dispatchDate)).toBeGreaterThanOrEqual(5);
    }
  });
});
