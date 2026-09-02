/**
 * The rest of the engine's required coverage: every lot-sizing rule, the
 * working-day calendar walk, forecast consumption, multi-level explosion with
 * scrap, phantom pass-through and cycle detection.
 *
 * These are the parts a planner will recognise instantly and check first.
 */

import { describe, expect, it } from 'vitest';
import { addDays, planKey, toEpochDay, type ItemPlant } from '@repo/domain';

import { WorkingCalendar } from '../src/calendar';
import { consumeForecast } from '../src/forecast-consumption';
import { assignLowLevelCodes } from '../src/low-level-codes';
import { applyLotSizing, economicOrderQuantity } from '../src/lot-sizing';
import { runMrp } from '../src/run-mrp';
import {
  CONTINUOUS_CALENDAR,
  FIVE_DAY_CALENDAR,
  PLANNING_DATE,
  bom,
  dailyDemand,
  demand,
  item,
  itemPlant,
  options,
  snapshot,
  stock,
  supply,
} from './fixtures';

// ---------------------------------------------------------------------------

describe('lot sizing', () => {
  const base = (overrides: Partial<ItemPlant> = {}) => itemPlant({ itemId: 'X', plantId: 'P1', ...overrides });

  const size = (
    rule: Parameters<typeof applyLotSizing>[0]['rule'],
    master: ItemPlant,
    netRequirement: number,
    extra: Partial<Parameters<typeof applyLotSizing>[0]> = {}
  ) =>
    applyLotSizing({
      rule,
      netRequirement,
      itemPlant: master,
      standardCost: 10,
      day: 0,
      horizonDays: 30,
      grossRequirements: new Float64Array(31),
      scheduledReceipts: new Float64Array(31),
      plannedReceipts: new Float64Array(31),
      thresholdAt: () => 0,
      projectedAvailable: 0,
      moq: 0,
      incrementQty: 0,
      ...extra,
    });

  it('LFL orders exactly what is needed', () => {
    expect(size('LFL', base(), 1_234).orderQtys).toEqual([1_234]);
  });

  it('FOQ rounds up to whole multiples of the fixed lot', () => {
    expect(size('FOQ', base({ fixedLotSize: 25_000 }), 1_000).orderQtys).toEqual([25_000]);
    expect(size('FOQ', base({ fixedLotSize: 25_000 }), 26_000).orderQtys).toEqual([50_000]);
  });

  it('POQ covers the whole period in one order', () => {
    const gross = new Float64Array(31);
    for (let day = 0; day <= 30; day += 1) gross[day] = 100;
    // Day 0 shortfall of 50, plus days 1–6 of net demand at 100 a day.
    const result = size('POQ', base({ periodsOfSupplyDays: 7 }), 50, { grossRequirements: gross });
    expect(result.orderQtys).toEqual([650]);
    expect(result.coversThroughDay).toBe(6);
  });

  it('POQ counts supply already scheduled inside the period', () => {
    // Demand of 100 a day for a week, and a 700 MT delivery already landing on
    // day 1. The period covers itself; only the day-0 shortfall is left.
    //
    // Flooring each day at zero independently is what broke this: a day whose
    // receipt exceeds its demand contributed nothing instead of carrying its
    // surplus forward, so 992 MT of scheduled inbound stopped counting on
    // RM-30137 and the run asked for 800 MT it did not need.
    const gross = new Float64Array(31);
    for (let day = 0; day <= 30; day += 1) gross[day] = 100;
    const scheduled = new Float64Array(31);
    scheduled[1] = 700;

    const result = size('POQ', base({ periodsOfSupplyDays: 7 }), 50, {
      grossRequirements: gross,
      scheduledReceipts: scheduled,
    });
    expect(result.orderQtys).toEqual([50]);
  });

  it('POQ measures the deficit against the threshold on each future day', () => {
    const gross = new Float64Array(31);
    for (let day = 0; day <= 30; day += 1) gross[day] = 100;
    // A norm of 200 has to be held through the period, not just a zero balance.
    const result = size('POQ', base({ periodsOfSupplyDays: 7 }), 50, {
      grossRequirements: gross,
      thresholdAt: () => 200,
    });
    // Runs from 200, loses 600 over days 1–6, so it ends 600 below the norm.
    expect(result.orderQtys).toEqual([650]);
  });

  it('MINMAX orders up to the maximum when the balance falls below the minimum', () => {
    const result = size('MINMAX', base({ minLotSize: 200, maxLotSize: 1_000 }), 50, { projectedAvailable: 150 });
    expect(result.orderQtys).toEqual([850]);
  });

  it('EOQ follows the square-root formula and clamps to the configured bounds', () => {
    // sqrt(2 · 36,500 · 5,000 / (0.22 · 10)) ≈ 12,881
    expect(economicOrderQuantity(36_500, 10)).toBeCloseTo(12_881, 0);
    const clamped = size('EOQ', base({ minLotSize: 100, maxLotSize: 500 }), 50, {
      grossRequirements: Float64Array.from({ length: 31 }, () => 100),
    });
    expect(clamped.orderQtys).toEqual([500]);
  });

  it('applies MOQ, then vendor increment, then rounding, in that order', () => {
    const result = size('LFL', base({ roundingValue: 500 }), 100, { moq: 1_200, incrementQty: 250 });
    // 100 → MOQ 1,200 → increment 250 keeps 1,250 → rounding 500 → 1,500.
    expect(result.orderQtys).toEqual([1_500]);
  });

  it('splits an order that exceeds the maximum lot size', () => {
    const result = size('LFL', base({ maxLotSize: 400 }), 1_000);
    expect(result.orderQtys).toEqual([400, 400, 200]);
  });

  it('inflates for assembly scrap before rounding, so the result is on the increment', () => {
    const result = size('LFL', base({ roundingValue: 100, scrapPct: 0.2 }), 950);
    // 950 → inflated for 20% scrap → 1,187.5 → rounds up to 1,200.
    //
    // Inflating last produced 1,250, which is not a multiple of the 100 it had
    // just rounded to: the adjustment that ran last silently undid the one
    // before it. Scrap goes first so the ceilings apply to what is released.
    expect(result.orderQtys).toEqual([1_200]);
    expect(1_200 % 100).toBe(0);
    expect(1_200 * (1 - 0.2)).toBeGreaterThanOrEqual(950);
  });

  it('keeps every slice inside the maximum lot when scrap also applies', () => {
    // Splitting first and inflating after pushed each slice to 4,444 against a
    // 4,000 maximum — the split's whole purpose, undone by the next line.
    const result = size('LFL', base({ maxLotSize: 4_000, scrapPct: 0.1 }), 8_000);
    for (const slice of result.orderQtys) expect(slice).toBeLessThanOrEqual(4_000);
    expect(result.orderQtys.reduce((sum, slice) => sum + slice, 0)).toBeCloseTo(result.finalOrderQuantity, 6);
  });

  it('reconciles a vendor increment and a rounding value that differ', () => {
    // 30 and 25 share 150. Applying one then the other lands on 800, which is
    // not a multiple of 30.
    const result = size('LFL', base({ roundingValue: 25 }), 786, { incrementQty: 30 });
    expect(result.finalOrderQuantity % 25).toBe(0);
    expect(result.finalOrderQuantity % 30).toBe(0);
    expect(result.finalOrderQuantity).toBe(900);
    expect(result.conflicts).toEqual([]);
  });

  it('reports a partition that cannot satisfy its own minimum', () => {
    // 400 against a 300 maximum needs two orders, but each must clear a 250
    // minimum and 2 × 250 > 400. There is no valid answer to give.
    const result = size('LFL', base({ maxLotSize: 300, minLotSize: 250 }), 400);
    expect(result.conflicts.map((row) => row.kind)).toContain('NO_FEASIBLE_PARTITION');
  });
});

describe('lot-sizing trace', () => {
  const base = (overrides: Partial<ItemPlant> = {}) => itemPlant({ itemId: 'X', plantId: 'P1', ...overrides });

  const size = (
    rule: Parameters<typeof applyLotSizing>[0]['rule'],
    master: ItemPlant,
    netRequirement: number,
    extra: Partial<Parameters<typeof applyLotSizing>[0]> = {}
  ) =>
    applyLotSizing({
      rule,
      netRequirement,
      itemPlant: master,
      standardCost: 10,
      day: 0,
      horizonDays: 30,
      grossRequirements: new Float64Array(31),
      scheduledReceipts: new Float64Array(31),
      plannedReceipts: new Float64Array(31),
      thresholdAt: () => 0,
      projectedAvailable: 0,
      moq: 0,
      incrementQty: 0,
      ...extra,
    });

  it('foots: the last step lands on the reconciled total, and slices sum to it', () => {
    for (const rule of ['LFL', 'FOQ', 'POQ', 'MINMAX', 'EOQ'] as const) {
      const result = size(
        rule,
        base({ fixedLotSize: 500, periodsOfSupplyDays: 7, minLotSize: 386, roundingValue: 25, maxLotSize: 4_000 }),
        120
      );
      const quantitySteps = result.trace.filter((step) => step.kind !== 'MAX_LOT_SPLIT');
      const last = quantitySteps[quantitySteps.length - 1];
      expect(last?.afterQty).toBeCloseTo(result.finalOrderQuantity, 6);
      expect(result.orderQtys.reduce((sum, slice) => sum + slice, 0)).toBeCloseTo(result.finalOrderQuantity, 6);
    }
  });

  it('records a non-binding step with a zero delta rather than omitting it', () => {
    // The MOQ is maintained and does not bind. It still has to appear, or the
    // planner cannot tell a parameter that did nothing from one that is unset.
    const result = size('LFL', base({ minLotSize: 100 }), 5_000);
    const step = result.trace.find((row) => row.kind === 'MIN_LOT');
    expect(step?.applied).toBe(true);
    expect(step?.binding).toBe(false);
    expect(step?.changedQuantity).toBe(false);
    expect(step?.deltaQty).toBe(0);
  });

  it('separates a change of shape from a change of quantity', () => {
    const result = size('LFL', base({ maxLotSize: 400 }), 1_000);
    const split = result.trace.find((row) => row.kind === 'MAX_LOT_SPLIT');
    expect(split?.changedShape).toBe(true);
    expect(split?.changedQuantity).toBe(false);
    expect(split?.deltaQty).toBe(0);
    expect(split?.sliceQtys).toEqual([400, 400, 200]);
  });

  it('omits a step for a parameter that is not maintained', () => {
    const result = size('LFL', base(), 1_000);
    expect(result.trace.map((row) => row.kind)).toEqual(['RULE']);
  });
});

// ---------------------------------------------------------------------------

describe('working calendar', () => {
  const calendar = new WorkingCalendar(FIVE_DAY_CALENDAR, PLANNING_DATE, 60);
  const day = (iso: string) => toEpochDay(iso);

  it('skips weekends when walking backwards', () => {
    // 2026-08-11 is a Tuesday. Five working days back is the previous Tuesday.
    expect(calendar.subtractWorkingDays(day('2026-08-11'), 5)).toBe(day('2026-08-04'));
  });

  it('skips holidays as well as weekends', () => {
    const withHoliday = new WorkingCalendar(
      { id: 'H', workingDays: [1, 2, 3, 4, 5], holidays: ['2026-08-10'] },
      PLANNING_DATE,
      60
    );
    // Monday the 10th is a holiday, so one working day back from Tuesday is Friday.
    expect(withHoliday.subtractWorkingDays(day('2026-08-11'), 1)).toBe(day('2026-08-07'));
  });

  it('reduces to plain date arithmetic on a seven-day calendar', () => {
    const continuous = new WorkingCalendar(CONTINUOUS_CALENDAR, PLANNING_DATE, 60);
    expect(continuous.subtractWorkingDays(day('2026-08-11'), 24)).toBe(day('2026-07-18'));
  });

  it('walks forwards symmetrically', () => {
    expect(calendar.addWorkingDays(day('2026-08-07'), 1)).toBe(day('2026-08-10'));
    expect(calendar.addWorkingDays(day('2026-08-11'), 5)).toBe(day('2026-08-18'));
  });

  it('reaches back before the planning date, where the interesting cases live', () => {
    // 40 working days is exactly eight weeks on a five-day calendar: 56 days.
    expect(calendar.subtractWorkingDays(day('2026-08-11'), 40)).toBe(day('2026-06-16'));
  });
});

// ---------------------------------------------------------------------------

describe('forecast consumption', () => {
  it('consumes the nearest bucket first, backward before forward', () => {
    const forecast = new Float64Array([100, 100, 100, 100, 100]);
    const orders = new Float64Array([0, 0, 150, 0, 0]);
    const consumed = consumeForecast(forecast, orders, { backwardDays: 2, forwardDays: 2 });

    expect(consumed).toBe(150);
    // Day 2 fully consumed, then day 1 (backward wins the tie at distance 1).
    expect(Array.from(forecast)).toEqual([100, 50, 0, 100, 100]);
  });

  it('respects the consumption window', () => {
    const forecast = new Float64Array([100, 0, 0, 0, 0]);
    const orders = new Float64Array([0, 0, 0, 0, 80]);
    const consumed = consumeForecast(forecast, orders, { backwardDays: 2, forwardDays: 2 });

    // The only forecast is four days away, outside a two-day window.
    expect(consumed).toBe(0);
    expect(forecast[0]).toBe(100);
  });

  it('stops double-counting a sales order against its own forecast', () => {
    const base = snapshot({
      items: [item({ id: 'A', type: 'FG', baseUom: 'EA' })],
      itemPlants: [itemPlant({ itemId: 'A', plantId: 'P1' })],
      stock: [stock('A', 'P1', 0)],
      demand: [
        demand({ id: 'SO', itemId: 'A', plantId: 'P1', qty: 100, requiredDate: addDays(PLANNING_DATE, 5) }),
        demand({
          id: 'FC',
          type: 'FORECAST',
          itemId: 'A',
          plantId: 'P1',
          qty: 100,
          requiredDate: addDays(PLANNING_DATE, 5),
        }),
      ],
    });

    const plan = runMrp(base, options());
    const gross = plan.plans.get(planKey('A', 'P1'))?.grossRequirements[5];
    expect(gross).toBe(100);
  });
});

// ---------------------------------------------------------------------------

describe('BOM explosion', () => {
  it('explodes multiple levels, inflating for component scrap', () => {
    const base = snapshot({
      items: [
        item({ id: 'FG', type: 'FG', baseUom: 'EA' }),
        item({ id: 'SFG', type: 'SFG' }),
        item({ id: 'RM', type: 'RM' }),
      ],
      itemPlants: [
        itemPlant({ itemId: 'FG', plantId: 'P1', procurementType: 'MAKE' }),
        itemPlant({ itemId: 'SFG', plantId: 'P1', procurementType: 'MAKE' }),
        itemPlant({ itemId: 'RM', plantId: 'P1' }),
      ],
      boms: [bom('FG', 'P1', 'SFG', 2), bom('SFG', 'P1', 'RM', 3, 0.5)],
      stock: [stock('FG', 'P1', 0), stock('SFG', 'P1', 0), stock('RM', 'P1', 0)],
      demand: [demand({ id: 'SO', itemId: 'FG', plantId: 'P1', qty: 10, requiredDate: addDays(PLANNING_DATE, 5) })],
    });

    const plan = runMrp(base, options());
    const sfg = plan.plans.get(planKey('SFG', 'P1'));
    const rm = plan.plans.get(planKey('RM', 'P1'));

    // 10 finished units × 2 = 20 of the intermediate.
    expect(sum(sfg?.grossRequirements)).toBeCloseTo(20, 6);
    // 20 × 3 = 60, plus 50% again for the scrap the material loses = 90.
    // Scrap is a property of the material and multiplies up; yield is a
    // property of the process and divides. They are not the same arithmetic
    // and the engine must not conflate them.
    expect(sum(rm?.grossRequirements)).toBeCloseTo(90, 6);
  });

  it('separates operation yield from component scrap, and applies both', () => {
    const base = snapshot({
      items: [item({ id: 'FG', type: 'FG', baseUom: 'EA' }), item({ id: 'RM', type: 'RM' })],
      itemPlants: [
        itemPlant({ itemId: 'FG', plantId: 'P1', procurementType: 'MAKE' }),
        itemPlant({ itemId: 'RM', plantId: 'P1' }),
      ],
      // Two per unit, on a line that yields 80%, of a material that loses 25%.
      boms: [{ ...bom('FG', 'P1', 'RM', 2, 0.25), operationYieldPct: 0.8 }],
      stock: [stock('FG', 'P1', 0), stock('RM', 'P1', 0)],
      demand: [demand({ id: 'SO', itemId: 'FG', plantId: 'P1', qty: 10, requiredDate: addDays(PLANNING_DATE, 5) })],
    });

    const plan = runMrp(base, options());
    // 10 × 2 ÷ 0.8 × 1.25 = 31.25. A planner disputing that number has to be
    // able to see which of the two factors they are arguing with.
    expect(sum(plan.plans.get(planKey('RM', 'P1'))?.grossRequirements)).toBeCloseTo(31.25, 6);
  });

  it('assigns low-level codes by the longest path, not the first one found', () => {
    // RM is both a direct component of FG and a component of SFG beneath it.
    const result = assignLowLevelCodes(
      [
        itemPlant({ itemId: 'FG', plantId: 'P1' }),
        itemPlant({ itemId: 'SFG', plantId: 'P1' }),
        itemPlant({ itemId: 'RM', plantId: 'P1' }),
      ],
      [bom('FG', 'P1', 'SFG', 1), bom('FG', 'P1', 'RM', 1), bom('SFG', 'P1', 'RM', 1)],
      () => true
    );

    expect(result.codes.get(planKey('FG', 'P1'))).toBe(0);
    expect(result.codes.get(planKey('SFG', 'P1'))).toBe(1);
    expect(result.codes.get(planKey('RM', 'P1'))).toBe(2);
    expect(result.circular).toHaveLength(0);
  });

  it('detects a BOM cycle and reports it instead of hanging', () => {
    const result = assignLowLevelCodes(
      [itemPlant({ itemId: 'A', plantId: 'P1' }), itemPlant({ itemId: 'B', plantId: 'P1' })],
      [bom('A', 'P1', 'B', 1), bom('B', 'P1', 'A', 1)],
      () => true
    );

    expect(result.circular.sort()).toEqual([planKey('A', 'P1'), planKey('B', 'P1')]);
    expect(result.order).toHaveLength(2);
  });

  it('reports a circular BOM rather than throwing', () => {
    const base = snapshot({
      items: [item({ id: 'A' }), item({ id: 'B' })],
      itemPlants: [itemPlant({ itemId: 'A', plantId: 'P1' }), itemPlant({ itemId: 'B', plantId: 'P1' })],
      boms: [bom('A', 'P1', 'B', 1), bom('B', 'P1', 'A', 1)],
      stock: [stock('A', 'P1', 0), stock('B', 'P1', 0)],
      demand: [demand({ id: 'SO', itemId: 'A', plantId: 'P1', qty: 10, requiredDate: addDays(PLANNING_DATE, 5) })],
    });

    const plan = runMrp(base, options());
    expect(plan.circularItemPlants.sort()).toEqual([planKey('A', 'P1'), planKey('B', 'P1')]);
  });

  it('passes demand straight through a phantom, with no order and no offset', () => {
    const base = snapshot({
      items: [
        item({ id: 'FG', type: 'FG', baseUom: 'EA' }),
        item({ id: 'PH', type: 'SFG', isPhantom: true }),
        item({ id: 'RM', type: 'RM' }),
      ],
      itemPlants: [
        itemPlant({ itemId: 'FG', plantId: 'P1', procurementType: 'MAKE' }),
        itemPlant({ itemId: 'PH', plantId: 'P1', procurementType: 'MAKE', leadTimeDays: 10 }),
        itemPlant({ itemId: 'RM', plantId: 'P1' }),
      ],
      boms: [bom('FG', 'P1', 'PH', 1), bom('PH', 'P1', 'RM', 4)],
      stock: [stock('FG', 'P1', 0), stock('PH', 'P1', 0), stock('RM', 'P1', 0)],
      demand: [demand({ id: 'SO', itemId: 'FG', plantId: 'P1', qty: 10, requiredDate: addDays(PLANNING_DATE, 5) })],
    });

    const plan = runMrp(base, options());

    // The phantom itself is never ordered.
    expect(plan.plannedOrders.some((order) => order.itemId === 'PH')).toBe(false);
    // Its demand reaches the component in the same bucket, undelayed.
    const rm = plan.plans.get(planKey('RM', 'P1'));
    expect(rm?.grossRequirements[5]).toBeCloseTo(40, 6);
  });
});

// ---------------------------------------------------------------------------

describe('netting does not look ahead', () => {
  it('raises the requirement even when a later receipt would have restored the buffer', () => {
    // The buffer breaches on day 3; a purchase order lands on day 4 and lifts
    // the balance clear again. Netting used to scan forward, find that receipt
    // and file the requirement as superseded — which is how the worked example
    // lost its headline order, because the line that "covered" week 39 was a
    // week-41 delivery nobody had acknowledged.
    //
    // A receipt landing after the bucket cannot mean the bucket needed nothing.
    // It means an existing order is later than the position requires, which is
    // a pull-in — a different finding, raised by the exception engine, and not
    // netting's to silently decide.
    const base = snapshot({
      items: [item({ id: 'X' })],
      itemPlants: [itemPlant({ itemId: 'X', plantId: 'P1', safetyStock: 100, leadTimeDays: 10 })],
      stock: [stock('X', 'P1', 150)],
      demand: dailyDemand('X', 'P1', 20, 1, 10),
      supply: [supply({ id: 'PO-1', itemId: 'X', plantId: 'P1', qty: 500, dueDate: addDays(PLANNING_DATE, 4) })],
    });

    const plan = runMrp(base, options());
    expect(plan.plannedOrders.length).toBeGreaterThan(0);

    // And it is honest about being unplaceable: a ten-day chain against a
    // day-3 requirement is a release date a week into the past.
    const explanations = plan.orderExplanations.get('X@P1') ?? [];
    expect(explanations[0]?.isReleaseInPast).toBe(true);
  });

  it('reports each bucket‘s own requirement, not the same gap repeated daily', () => {
    // Nothing can be ordered in time here, so the balance stays under the
    // threshold for days on end. The series has to carry the *growth* in the
    // shortfall, or a weekly bucket sums seven days of the same gap and reports
    // seven times the requirement.
    const base = snapshot({
      items: [item({ id: 'X' })],
      itemPlants: [
        itemPlant({ itemId: 'X', plantId: 'P1', safetyStock: 100, leadTimeDays: 10, isPlanningRelevant: false }),
      ],
      stock: [stock('X', 'P1', 150)],
      demand: dailyDemand('X', 'P1', 20, 1, 10),
    });

    const plan = runMrp(base, options());
    const series = plan.plans.get('X@P1')?.netRequirements as Float64Array;

    // Balance falls 20 a day from 150. It crosses 100 on day 3 (110 → 90), so
    // the first requirement is 10, and every day after it is the day's 20.
    expect(series[2]).toBe(0);
    expect(series[3]).toBeCloseTo(10, 6);
    expect(series[4]).toBeCloseTo(20, 6);
    expect(series[5]).toBeCloseTo(20, 6);

    // Which is the whole point: the week's total is the week's requirement.
    let week = 0;
    for (let day = 0; day <= 6; day += 1) week += series[day] as number;
    expect(week).toBeCloseTo(70, 6);
  });

  it('still raises an order when the gap goes negative before supply arrives', () => {
    const base = snapshot({
      items: [item({ id: 'X' })],
      itemPlants: [itemPlant({ itemId: 'X', plantId: 'P1', safetyStock: 100, leadTimeDays: 3 })],
      stock: [stock('X', 'P1', 150)],
      demand: dailyDemand('X', 'P1', 60, 1, 10),
      supply: [supply({ id: 'PO-1', itemId: 'X', plantId: 'P1', qty: 500, dueDate: addDays(PLANNING_DATE, 9) })],
    });

    const plan = runMrp(base, options());
    expect(plan.plannedOrders.length).toBeGreaterThan(0);
  });
});

function sum(series: Float64Array | undefined): number {
  if (!series) return 0;
  let total = 0;
  for (let index = 0; index < series.length; index += 1) total += series[index] as number;
  return total;
}
