/**
 * Calibration.
 *
 * A data pack's job is not only to be realistic but to land the plan in a
 * defensible band, and to land it in exactly the same place on every machine —
 * the video will be re-recorded several times, and a figure that moves between
 * takes is a figure nobody can quote.
 *
 * The v1 exception-band assertions have gone with the exception engine. What
 * survives here is what v2 still needs from any pack: it seeds deterministically,
 * it plans inside the performance budget, and it names nobody real.
 *
 * The `gcpl-soaps` pack replaces the confectionery one in the next step, and
 * brings the Brief §7.1 planted scenarios with it — 17 receipts on the hero
 * material resolving to 14 matched plus 3 unmatched, the 40 packaging materials
 * at 45 maintained days against an 18-day reality, and the ₹40–60 Cr category
 * band. Those assertions land with the pack that can satisfy them.
 */

import { describe, expect, it } from 'vitest';
import { runMrp } from '@repo/mrp-engine';

import { getDataPack } from '../src/index';

const pack = getDataPack();
const snapshot = pack.generate();
const plan = runMrp(snapshot, pack.defaultOptions('baseline'));

describe('data pack', () => {
  it('reports its shape', () => {
    const lines = [
      '',
      '─── dataset ─────────────────────────────────────────────',
      `items            ${snapshot.items.length}`,
      `item-plants      ${snapshot.itemPlants.length}`,
      `BOM lines        ${snapshot.boms.length}`,
      `demand elements  ${snapshot.demand.length}`,
      `supply elements  ${snapshot.supply.length}`,
      `receipt history  ${snapshot.receiptHistory.length}`,
      '',
      '─── plan ────────────────────────────────────────────────',
      `elapsed          ${plan.elapsedMs.toFixed(0)} ms`,
      `planned orders   ${plan.plannedOrders.length}`,
      `derived demand   ${plan.derivedDemand.length}`,
      `max BOM level    ${Math.max(...[...plan.plans.values()].map((entry) => entry.lowLevelCode))}`,
      '',
    ];

    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));
    expect(plan.plans.size).toBeGreaterThan(0);
  });

  it('explodes demand through every level of the bill of material', () => {
    const deepest = Math.max(...[...plan.plans.values()].map((entry) => entry.lowLevelCode));
    expect(deepest).toBeGreaterThanOrEqual(2);
    expect(plan.derivedDemand.length).toBeGreaterThan(0);
  });

  it('plans the whole dataset inside the performance budget', () => {
    expect(plan.elapsedMs).toBeLessThan(2_000);
  });

  it('generates identical data on every run', () => {
    const second = pack.generate();
    expect(second.items.length).toBe(snapshot.items.length);
    expect(JSON.stringify(second.itemPlants)).toBe(JSON.stringify(snapshot.itemPlants));
    expect(JSON.stringify(second.demand)).toBe(JSON.stringify(snapshot.demand));
    expect(JSON.stringify(second.stock)).toBe(JSON.stringify(snapshot.stock));
  });

  it('produces the same plan on every run', () => {
    const rerun = runMrp(snapshot, pack.defaultOptions('baseline'));
    expect(rerun.plannedOrders.map((order) => order.id)).toEqual(plan.plannedOrders.map((order) => order.id));
    expect(rerun.plannedOrders.map((order) => order.qty)).toEqual(plan.plannedOrders.map((order) => order.qty));
  });

  it('names no real company, brand or trading partner', () => {
    const serialised = JSON.stringify({
      items: snapshot.items.slice(0, 200),
      vendors: snapshot.vendors,
      customers: snapshot.customers,
      plants: snapshot.plants,
    }).toLowerCase();

    for (const forbidden of [
      'godrej',
      'gcpl',
      'mondelez',
      'nestle',
      'nestlé',
      'hershey',
      'mars ',
      'ferrero',
      'cadbury',
      'lindt',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});
