/**
 * The §6.2 worked example — the spine of the demo.
 *
 * Cocoa butter at one plant, with master data that stopped being true. The
 * exception is not caused by a demand spike; it is caused by a maintained lead
 * time that no longer matches what the supplier actually does. Neither SAP nor
 * Kinaxis surfaces that, because both plan faithfully on the maintained figure.
 *
 * This test exists to be opened in front of a technical challenger. Every
 * expectation below is a number from the spec's table, asserted day by day.
 *
 * One deviation is recorded explicitly. The spec describes the day-7 requirement
 * as raising an order that is then superseded, reported as both
 * `A8-ORDER-IN-PAST` and `A5-RESCHEDULE-OUT`. The engine reaches the same plan
 * by declining to raise an order it can see is already covered, and reports the
 * requirement once, as `A5-RESCHEDULE-OUT`, carrying the infeasible release date
 * as evidence. Reporting one requirement under two codes would double-count it
 * in a queue whose entire purpose is ranking by money.
 */

import { describe, expect, it } from 'vitest';
import { addDays, planKey } from '@repo/domain';

import { runMrp } from '../src/run-mrp';
import {
  CONTINUOUS_CALENDAR,
  PLANNING_DATE,
  dailyDemand,
  item,
  itemPlant,
  options,
  snapshot,
  stock,
  supply,
} from './fixtures';

const ITEM_ID = 'RM-CB-001';
const PLANT_ID = 'P1';

function buildWorkedExample() {
  return snapshot({
    plants: [{ id: PLANT_ID, name: 'Plant 1', country: 'US', type: 'OWN', calendarId: CONTINUOUS_CALENDAR.id }],
    items: [item({ id: ITEM_ID, description: 'Cocoa Butter, Deodorised', standardCost: 8.2 })],
    itemPlants: [
      itemPlant({
        itemId: ITEM_ID,
        plantId: PLANT_ID,
        lotSizeRule: 'FOQ',
        fixedLotSize: 25_000,
        roundingValue: 1_000,
        leadTimeDays: 21,
        grProcessingTimeDays: 0,
        safetyTimeDays: 3,
        safetyStock: 15_000,
        scrapPct: 0,
      }),
    ],
    stock: [stock(ITEM_ID, PLANT_ID, 40_000)],
    // 4,000 kg/day on days 1–20.
    demand: dailyDemand(ITEM_ID, PLANT_ID, 4_000, 1, 20),
    // One open purchase order of 30,000 kg due day 9.
    supply: [
      supply({
        id: 'PO-4500071288',
        itemId: ITEM_ID,
        plantId: PLANT_ID,
        qty: 30_000,
        dueDate: addDays(PLANNING_DATE, 9),
        releaseDate: addDays(PLANNING_DATE, -12),
      }),
    ],
  });
}

describe('§6.2 worked example — cocoa butter at P1', () => {
  const plan = runMrp(buildWorkedExample(), options({ horizonDays: 30 }));
  const itemPlan = plan.plans.get(planKey(ITEM_ID, PLANT_ID));

  it('produces exactly one planned order', () => {
    expect(plan.plannedOrders).toHaveLength(1);
  });

  it('nets at day 14, not at day 7, because the open order covers the earlier gap', () => {
    const order = plan.plannedOrders[0];
    expect(order?.dueDate).toBe(addDays(PLANNING_DATE, 14));
  });

  it('rounds the 1,000 kg net requirement up to the 25,000 kg fixed lot', () => {
    expect(plan.plannedOrders[0]?.qty).toBe(25_000);
  });

  it('reports the superseded day-7 requirement rather than silently netting it away', () => {
    const superseded = plan.exceptions.find(
      (exception) => exception.code === 'A5-RESCHEDULE-OUT' && exception.bucketDay === 7
    );
    expect(superseded).toBeDefined();
    // The gap is covered by the open purchase order arriving on day 9.
    expect(superseded?.evidence.some((fact) => fact.value.includes('day 9'))).toBe(true);
    // And the order could never have been placed: day 7 − 24 = day −17.
    expect(superseded?.evidence.some((fact) => fact.value === 'day -17')).toBe(true);
  });

  it('flags the day-14 order as impossible to place — release lands on day −10', () => {
    const orderInPast = plan.exceptions.find((exception) => exception.code === 'A8-ORDER-IN-PAST');
    expect(orderInPast).toBeDefined();
    expect(orderInPast?.bucketDay).toBe(14);
    expect(orderInPast?.evidence.some((fact) => fact.value === 'day -10')).toBe(true);
  });

  it('clamps the infeasible release to the planning date while keeping the receipt date visible', () => {
    const order = plan.plannedOrders[0];
    expect(order?.releaseDate).toBe(PLANNING_DATE);
    expect(order?.dueDate).toBe(addDays(PLANNING_DATE, 14));
  });

  it('reproduces the projected balance day by day', () => {
    // Day → projected available balance, straight from the spec's table.
    const expected: Array<[number, number]> = [
      [0, 40_000],
      [6, 16_000],
      [7, 12_000],
      [8, 8_000],
      [9, 34_000],
      [13, 18_000],
      // Day 14 nets 1,000, the fixed lot delivers 25,000: 14,000 + 25,000.
      [14, 39_000],
      // Then 4,000/day to day 20, landing exactly on safety stock.
      [20, 15_000],
    ];

    for (const [day, balance] of expected) {
      expect(itemPlan?.projectedAvailable[day]).toBeCloseTo(balance, 6);
    }
  });

  it('breaches safety stock at day 7', () => {
    const breach = plan.exceptions.find((exception) => exception.code === 'A2-SAFETY-STOCK-BREACH');
    expect(breach).toBeDefined();
    expect(breach?.bucketDay).toBe(7);
  });

  it('shows the honest balance too — without the unorderable receipt, cover runs out at day 18', () => {
    // 40,000 opening + 30,000 received, less 4,000/day from day 1.
    expect(itemPlan?.projectedAvailableFeasible[17]).toBeCloseTo(2_000, 6);
    expect(itemPlan?.projectedAvailableFeasible[18]).toBeCloseTo(-2_000, 6);
  });

  it('is a pure function of its inputs', () => {
    const rerun = runMrp(buildWorkedExample(), options({ horizonDays: 30 }));
    expect(rerun.plannedOrders).toEqual(plan.plannedOrders);
    expect(rerun.exceptions.map((exception) => exception.id)).toEqual(plan.exceptions.map((exception) => exception.id));
  });

  it('re-plans differently once the observed lead time is used instead of the maintained one', () => {
    const observed = buildWorkedExample();
    observed.receiptHistory = [36, 41, 37, 34, 40, 40].map((actual, index) => ({
      itemId: ITEM_ID,
      plantId: PLANT_ID,
      vendorId: 'VEND-114',
      poId: `PO-H-${index}`,
      orderedOn: addDays(PLANNING_DATE, -(index * 24 + 9) - actual),
      promisedOn: addDays(PLANNING_DATE, -(index * 24 + 9) - actual + 21),
      receivedOn: addDays(PLANNING_DATE, -(index * 24 + 9)),
      qty: 25_000,
      actualLeadTimeDays: actual,
    }));

    const maintained = runMrp(observed, options({ horizonDays: 30, useActualLeadTimes: false }));
    const actual = runMrp(observed, options({ horizonDays: 30, useActualLeadTimes: true }));

    // 38-day average plus three days of safety time pushes the release from
    // day −10 to day −27 — the same requirement, considerably further out of reach.
    const maintainedRelease = maintained.exceptions.find((e) => e.code === 'A8-ORDER-IN-PAST');
    const actualRelease = actual.exceptions.find((e) => e.code === 'A8-ORDER-IN-PAST');
    expect(maintainedRelease?.evidence.some((fact) => fact.value === 'day -10')).toBe(true);
    expect(actualRelease?.evidence.some((fact) => fact.value === 'day -27')).toBe(true);
  });

  it('detects the drift between the maintained and observed lead time', () => {
    const withHistory = buildWorkedExample();
    withHistory.receiptHistory = [36, 41, 37, 34, 40, 40].map((actual, index) => ({
      itemId: ITEM_ID,
      plantId: PLANT_ID,
      vendorId: 'VEND-114',
      poId: `PO-H-${index}`,
      orderedOn: addDays(PLANNING_DATE, -(index * 24 + 9) - actual),
      promisedOn: addDays(PLANNING_DATE, -(index * 24 + 9) - actual + 21),
      receivedOn: addDays(PLANNING_DATE, -(index * 24 + 9)),
      qty: 25_000,
      actualLeadTimeDays: actual,
    }));

    const drifted = runMrp(withHistory, options({ horizonDays: 30 }));
    const drift = drifted.exceptions.find((exception) => exception.code === 'B7-LEAD-TIME-DRIFT');
    expect(drift).toBeDefined();
    expect(drift?.narrative).toContain('21d');
    expect(drift?.narrative).toContain('38.0 days');
  });
});
