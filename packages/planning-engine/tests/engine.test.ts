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

  it('inflates for assembly scrap last, so rounding is not undone', () => {
    const result = size('LFL', base({ roundingValue: 100, scrapPct: 0.2 }), 950);
    // 950 → rounds to 1,000 → inflated for 20% scrap → 1,250.
    expect(result.orderQtys).toEqual([1_250]);
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

describe('order supersession', () => {
  it('does not raise an order when existing supply already restores the buffer', () => {
    // A ten-day lead time puts the release date in the past, which is the case
    // worth reporting: no order was placeable, and existing supply saves it.
    const base = snapshot({
      items: [item({ id: 'X' })],
      itemPlants: [itemPlant({ itemId: 'X', plantId: 'P1', safetyStock: 100, leadTimeDays: 10 })],
      stock: [stock('X', 'P1', 150)],
      demand: dailyDemand('X', 'P1', 20, 1, 10),
      supply: [supply({ id: 'PO-1', itemId: 'X', plantId: 'P1', qty: 500, dueDate: addDays(PLANNING_DATE, 4) })],
    });

    const plan = runMrp(base, options());
    expect(plan.plannedOrders).toHaveLength(0);
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
