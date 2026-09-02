/**
 * Calibration.
 *
 * The pack's job is not only to be realistic but to land the plan in the same
 * place on every machine and every run — a demo is rehearsed several times, and
 * a figure that moves between takes is a figure nobody can quote.
 *
 * Every beat the walkthrough depends on is asserted here rather than trusted.
 * Where a beat rests on a number, that number is checked; where it rests on a
 * relationship — the breach falling *before* the supply that would fix it, the
 * fence falling to the *right* of the breach — the relationship is checked,
 * because that is what actually has to hold.
 */

import { describe, expect, it } from 'vitest';
import { leadTimeChain, primaryVendor, runMrp } from '@repo/planning-engine';
import { fromEpochDay, isoWeekNumber, planKey, toEpochDay, type ItemVendor } from '@repo/domain';

import { CHAIN_FG, CHAIN_ITEMS, getDataPack, HERO_PM, HERO_RM, HERO_RM_TWIN, SOAP_CHAIN } from '../src/index';

const pack = getDataPack();
const snapshot = pack.generate();
const plan = runMrp(snapshot, pack.defaultOptions('baseline'));
const planningEpoch = toEpochDay(pack.planningDate);

const heroKey = planKey(HERO_RM.itemId, HERO_RM.plantId);
const heroPlan = plan.plans.get(heroKey);

/** The ISO week label of a day offset from the planning date — `W39`. */
function weekOf(dayOffset: number): string {
  return `W${isoWeekNumber(fromEpochDay(planningEpoch + dayOffset))}`;
}

/** Weekly totals of a flow series, from the planning date. */
function weeklyFlow(series: Float64Array, weeks: number): number[] {
  const out: number[] = [];
  for (let week = 0; week < weeks; week += 1) {
    let sum = 0;
    for (let day = week * 7; day < (week + 1) * 7; day += 1) sum += series[day] as number;
    out.push(Math.round(sum));
  }
  return out;
}

/** Closing balance of each week — a level, so the last value, never the sum. */
function weeklyLevel(series: Float64Array, weeks: number): number[] {
  const out: number[] = [];
  for (let week = 0; week < weeks; week += 1) out.push(Math.round(series[week * 7 + 6] as number));
  return out;
}

/** Sample standard deviation — the Bessel-corrected counterpart. */
function sampleStdDev(values: readonly number[]): number {
  const average = mean(values);
  return Math.sqrt(values.reduce((total, value) => total + (value - average) ** 2, 0) / (values.length - 1));
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Population standard deviation — the convention the engine uses throughout. */
function stdDev(values: readonly number[]): number {
  const average = mean(values);
  return Math.sqrt(values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length);
}

describe('the clock', () => {
  it('starts on the Monday of week 36, which is where every worked example starts', () => {
    expect(pack.planningDate).toBe('2026-08-31');
    expect(weekOf(0)).toBe('W36');
    // The weeks the walkthrough names, spelled out so a renumbering is caught
    // here rather than in front of an audience.
    expect(weekOf(21)).toBe('W39');
    expect(weekOf(42)).toBe('W42');
  });

  it('plans 26 weeks, which is the shortest horizon a 90-day import is visible in', () => {
    expect(pack.horizonDays).toBe(182);
    expect(pack.horizonDays).toBeGreaterThan(HERO_RM.maintainedLeadTimeDays);
  });
});

describe('the maintained lead-time chains', () => {
  it.each([
    ['RM-30114, the import', HERO_RM],
    ['RM-30112, the local twin', HERO_RM_TWIN],
    ['PM-88431, the bottle', HERO_PM],
  ])('%s sums its four intervals to the number in the material master', (_label, hero) => {
    const chain =
      hero.acknowledgementDays +
      hero.vendorReadinessDays +
      hero.transitDays +
      hero.customsDays +
      hero.grProcessingTimeDays +
      hero.qaQuarantineDays;
    expect(chain).toBe(hero.maintainedLeadTimeDays);
  });

  it('holds for every bought material in the book, not only the pinned three', () => {
    // The convention has to be the same everywhere or the fence and the netting
    // offset disagree — and they disagree quietly, on materials nobody is
    // looking at, in a demo whose whole argument is that the fence is where the
    // decision lives.
    const vendorsByKey = new Map<string, ItemVendor[]>();
    for (const row of snapshot.itemVendors) {
      const key = planKey(row.itemId, row.plantId);
      vendorsByKey.set(key, [...(vendorsByKey.get(key) ?? []), row]);
    }

    let checked = 0;
    for (const master of snapshot.itemPlants) {
      if (master.procurementType !== 'BUY' || master.leadTimeDays === null) continue;
      const vendor = primaryVendor(vendorsByKey.get(planKey(master.itemId, master.plantId)));
      const chain = leadTimeChain(master, vendor);

      // The chain decomposes the master's total rather than exceeding it, which
      // is only true while goods receipt and quality release sit inside it.
      expect(chain.totalDays).toBe(master.leadTimeDays);
      expect(master.leadTimeDays).toBeGreaterThanOrEqual(master.grProcessingTimeDays + master.qaQuarantineDays);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('offsets every planned order by the chain the fence is drawn from', () => {
    const vendorsByKey = new Map<string, ItemVendor[]>();
    for (const row of snapshot.itemVendors) {
      const key = planKey(row.itemId, row.plantId);
      vendorsByKey.set(key, [...(vendorsByKey.get(key) ?? []), row]);
    }
    const masterByKey = new Map(snapshot.itemPlants.map((row) => [planKey(row.itemId, row.plantId), row]));

    let checked = 0;
    for (const [key, orders] of plan.orderExplanations) {
      const master = masterByKey.get(key);
      if (!master || master.procurementType !== 'BUY') continue;
      const chain = leadTimeChain(master, primaryVendor(vendorsByKey.get(key)));
      for (const order of orders) {
        expect(order.totalOffsetDays).toBe(chain.totalDays + master.safetyTimeDays);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('separates the import from its twin by two months of lead time', () => {
    expect(HERO_RM.maintainedLeadTimeDays - HERO_RM_TWIN.maintainedLeadTimeDays).toBe(60);
    expect(HERO_RM.itemCategoryId).toBe(HERO_RM_TWIN.itemCategoryId);
  });
});

describe('the soap chain', () => {
  it('carries every conversion factor as its own bill-of-material step', () => {
    const steps = snapshot.boms.filter(
      (line) =>
        line.plantId === HERO_RM.plantId &&
        (line.componentItemId === CHAIN_ITEMS.noodle.itemId ||
          line.componentItemId === CHAIN_ITEMS.blend.itemId ||
          line.componentItemId === HERO_RM.itemId)
    );
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) expect(step.stepLabel).not.toBeNull();
  });

  it('reaches the imported oil at the factor the worked example states', () => {
    const c = SOAP_CHAIN;
    const soapToNoodle = snapshot.boms.find(
      (line) => line.parentItemId === CHAIN_FG.soap.itemId && line.componentItemId === CHAIN_ITEMS.noodle.itemId
    );
    const noodleToBlend = snapshot.boms.find(
      (line) => line.parentItemId === CHAIN_ITEMS.noodle.itemId && line.componentItemId === CHAIN_ITEMS.blend.itemId
    );
    const blendToPfad = snapshot.boms.find(
      (line) => line.parentItemId === CHAIN_ITEMS.blend.itemId && line.componentItemId === HERO_RM.itemId
    );

    expect(soapToNoodle?.qtyPer).toBeCloseTo(c.barWeightMt * c.noodleFactor, 10);
    expect(noodleToBlend?.qtyPer).toBeCloseTo(c.oilContent, 10);
    expect(noodleToBlend?.operationYieldPct).toBeCloseTo(c.dfaStageYield, 10);
    // The blend ratio and the source split are decisions; the conversion yield
    // is a process property. They are argued about separately, so they are
    // stored separately.
    expect(blendToPfad?.qtyPer).toBeCloseTo(c.pfadBlendShare * c.importSourceShare, 10);
    expect(blendToPfad?.operationYieldPct).toBeCloseTo(c.conversionYield, 10);
  });

  it('splits the same chemistry across two material codes in the maintained ratio', () => {
    const toImport = snapshot.boms.find(
      (line) => line.parentItemId === CHAIN_ITEMS.blend.itemId && line.componentItemId === HERO_RM.itemId
    );
    const toLocal = snapshot.boms.find(
      (line) => line.parentItemId === CHAIN_ITEMS.blend.itemId && line.componentItemId === HERO_RM_TWIN.itemId
    );
    const total = (toImport?.qtyPer ?? 0) + (toLocal?.qtyPer ?? 0);
    expect(total).toBeCloseTo(SOAP_CHAIN.pfadBlendShare, 10);
    expect((toImport?.qtyPer ?? 0) / total).toBeCloseTo(SOAP_CHAIN.importSourceShare, 10);
  });
});

describe('hero A — the position the walkthrough opens on', () => {
  it('is planned, at the low-level code its depth implies', () => {
    expect(heroPlan).toBeDefined();
    expect(heroPlan?.lowLevelCode).toBeGreaterThanOrEqual(2);
  });

  it('opens on the stock and the buffer the material master holds', () => {
    expect(heroPlan?.openingStock).toBe(HERO_RM.openingStock);
    expect(heroPlan?.safetyStock).toBe(HERO_RM.safetyStock);
  });

  it('nets the open order against its delivery lines, not against one header date', () => {
    const receipts = weeklyFlow(heroPlan?.scheduledReceipts as Float64Array, 8);
    // W37 is the quality release; W38 and W41 are the two lines of PO 4700221.
    // Read against the header date alone, all 2,300 MT would land in W41 and
    // three weeks would look covered that are not.
    expect(receipts[1]).toBe(HERO_RM.quarantineQty);
    expect(receipts[2]).toBe(HERO_RM.openPoLines[0].qty);
    expect(receipts[5]).toBe(HERO_RM.openPoLines[1].qty);
    expect(receipts[3]).toBe(0);
    expect(receipts[4]).toBe(0);
  });

  it('rises through the pre-summer build without a step that demand does not explain', () => {
    const gross = weeklyFlow(heroPlan?.grossRequirements as Float64Array, 8);
    expect(mean(gross.slice(0, 3))).toBeGreaterThan(550);
    expect(mean(gross.slice(0, 3))).toBeLessThan(800);
    expect(mean(gross.slice(5, 8))).toBeGreaterThan(850);
    expect(mean(gross.slice(5, 8))).toBeLessThan(1_200);
    // The build rises. A flat or falling series would make the whole worked
    // example an argument about nothing.
    expect(mean(gross.slice(4, 8))).toBeGreaterThan(mean(gross.slice(0, 4)));
  });

  it('breaches safety stock in W39 and goes negative in W42', () => {
    const balance = weeklyLevel(heroPlan?.projectedAvailableFeasible as Float64Array, 8);
    const safetyStock = heroPlan?.safetyStock as number;

    const firstBreach = balance.findIndex((value) => value < safetyStock);
    const firstStockout = balance.findIndex((value) => value < 0);

    expect(weekOf(firstBreach * 7)).toBe('W39');
    expect(weekOf(firstStockout * 7)).toBe('W42');
    // And the breach comes *before* the supply that would fix it, which is the
    // whole reason the week matters.
    expect(firstBreach).toBeLessThan(5);
  });

  it('cannot be fixed by ordering — every proposal needed releasing months ago', () => {
    const orders = plan.orderExplanations.get(heroKey) ?? [];
    expect(orders.length).toBeGreaterThan(0);
    const reachable = orders.filter((order) => !order.isReleaseInPast);
    const firstBreachDay = (heroPlan?.projectedAvailableFeasible as Float64Array).findIndex(
      (value) => value < (heroPlan?.safetyStock as number)
    );
    // Nothing reachable lands before the breach. That is the finding.
    for (const order of reachable) {
      expect(toEpochDay(order.receiptDate) - planningEpoch).toBeGreaterThan(firstBreachDay);
    }
  });

  it('measures 104 days against a maintained 90, on evidence rather than assertion', () => {
    const receipts = snapshot.receiptHistory.filter(
      (row) => row.itemId === HERO_RM.itemId && row.plantId === HERO_RM.plantId && row.matchedLineId !== null
    );
    expect(receipts.length).toBe(HERO_RM.observedTotalDays.length);

    // Reconstructed from the seeded dates, never read off a field beside them.
    const observed = receipts.map((row) => toEpochDay(row.qaReleasedOn as string) - toEpochDay(row.orderedOn));
    expect(mean(observed)).toBeCloseTo(104, 1);
    // Population standard deviation, which is the convention the engine uses
    // everywhere. The sample statistic over the same eight receipts is 11.8;
    // the two differ by the Bessel correction and by nothing else, and a
    // product that quotes one and computes the other has already lost the
    // argument about whether its arithmetic can be checked.
    expect(stdDev(observed)).toBeCloseTo(11.07, 1);
    expect(sampleStdDev(observed)).toBeCloseTo(11.8, 1);
    expect(mean(observed) - HERO_RM.maintainedLeadTimeDays).toBeGreaterThan(10);
  });

  it('splits every measured receipt across the four intervals it is made of', () => {
    for (const row of snapshot.receiptHistory) {
      if (row.acknowledgedOn === null) continue;
      expect(row.orderedOn <= row.acknowledgedOn).toBe(true);
      expect(row.acknowledgedOn <= (row.dispatchedOn as string)).toBe(true);
      expect((row.dispatchedOn as string) <= row.receivedOn).toBe(true);
      expect(row.receivedOn <= (row.qaReleasedOn as string)).toBe(true);
    }
  });
});

describe('hero B — the schedule the builder is built on', () => {
  const key = planKey(HERO_PM.itemId, HERO_PM.plantId);
  const bottlePlan = plan.plans.get(key);

  it('opens on the stock and the buffer the worked example states', () => {
    expect(bottlePlan?.openingStock).toBe(HERO_PM.openingStock);
    expect(bottlePlan?.safetyStock).toBe(HERO_PM.safetyStock);
  });

  it('carries the promotion build the campaign is sized against', () => {
    const gross = weeklyFlow(bottlePlan?.grossRequirements as Float64Array, 7);
    const peak = Math.max(...gross);
    expect(peak).toBeGreaterThan(220_000);
    expect(peak).toBeLessThan(260_000);
    // The vendor could make 250,000 a week. The plant can hold 320,000 at once.
    // That gap is what makes the warehouse, not the vendor, the binding
    // constraint — and it only exists because the peak is close to both.
    expect(HERO_PM.weeklyCapacity).toBeLessThan(HERO_PM.storageCapacity);
  });

  it('proposes an order that can still be placed, unlike hero A', () => {
    const orders = plan.orderExplanations.get(key) ?? [];
    expect(orders.length).toBeGreaterThan(0);
    expect(orders.some((order) => !order.isReleaseInPast)).toBe(true);
  });

  it('has a vendor whose shutdown week is recorded, and only stops production', () => {
    const vendor = snapshot.vendors.find((row) => row.id === HERO_PM.vendorId);
    expect(vendor?.productionShutdownWeeks).toEqual([...HERO_PM.shutdownWeeks]);
    // The shutdown is a whole ISO week, starting on a Monday.
    for (const week of vendor?.productionShutdownWeeks ?? []) {
      expect(toEpochDay(week) % 7).toBe(toEpochDay('2026-08-31') % 7);
    }
  });
});

describe('the book as a whole', () => {
  it('leaves a planner a day of work, not a screen of noise', () => {
    let stockouts = 0;
    let breaches = 0;
    let unreachable = 0;

    for (const [key, itemPlan] of plan.plans) {
      let hasDemand = false;
      for (let day = 0; day <= pack.horizonDays; day += 1) {
        if ((itemPlan.grossRequirements[day] as number) > 0) {
          hasDemand = true;
          break;
        }
      }
      if (!hasDemand) continue;

      let out = false;
      let breach = false;
      for (let day = 0; day <= pack.horizonDays; day += 1) {
        const balance = itemPlan.projectedAvailableFeasible[day] as number;
        if (balance < 0) out = true;
        else if (balance < itemPlan.safetyStock) breach = true;
      }
      if (out) stockouts += 1;
      else if (breach) breaches += 1;
      if ((plan.orderExplanations.get(key) ?? []).some((order) => order.isReleaseInPast)) unreachable += 1;
    }

    // Bands rather than exact counts: the numbers must be stable run to run,
    // which determinism already guarantees, and *plausible* for one planner's
    // morning, which is what these assert.
    expect(stockouts).toBeGreaterThan(4);
    expect(stockouts).toBeLessThan(60);
    expect(breaches).toBeGreaterThan(20);
    expect(breaches).toBeLessThan(200);
    expect(unreachable).toBeGreaterThan(3);
  });

  it('has roughly a third of its open book unacknowledged by anybody', () => {
    const lines = snapshot.supply.flatMap((element) => element.schedule ?? []);
    const unacknowledged = lines.filter((line) => line.confirmedDate === null).length;
    const share = unacknowledged / lines.length;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.5);
  });

  it('keeps every delivery schedule footing to its order', () => {
    for (const element of snapshot.supply) {
      if (!element.schedule || element.schedule.length === 0) continue;
      const total = element.schedule.reduce((sum, line) => sum + line.qty, 0);
      expect(total).toBe(element.qty);
    }
  });

  it('dates the quantity sitting in quality inspection, and foots it', () => {
    for (const position of snapshot.stock) {
      const dated = position.quarantine.reduce((sum, lot) => sum + lot.qty, 0);
      expect(dated).toBe(position.qualityInspection);
      for (const lot of position.quarantine) expect(lot.expectedReleaseDate >= lot.receivedOn).toBe(true);
    }
  });
});

describe('reproducibility', () => {
  it('generates identical data on every run', () => {
    expect(JSON.stringify(pack.generate())).toBe(JSON.stringify(snapshot));
  });

  it('produces the same plan on every run', () => {
    const second = runMrp(snapshot, pack.defaultOptions('baseline'));
    const first = heroPlan?.projectedAvailable as Float64Array;
    expect(Array.from(second.plans.get(heroKey)?.projectedAvailable as Float64Array)).toEqual(Array.from(first));
  });

  it('plans the whole book inside the budget a live re-plan needs', () => {
    expect(plan.elapsedMs).toBeLessThan(2_500);
  });
});

describe('anonymisation', () => {
  it('names no company, brand or trading partner anywhere in the dataset', () => {
    // A release gate, not housekeeping: this dataset is shown to a client.
    const forbidden = /godrej|gcpl|hindustan|unilever|itc|wipro|dabur|marico|nirma|patanjali|colgate/i;
    const text = JSON.stringify({
      items: snapshot.items,
      vendors: snapshot.vendors,
      customers: snapshot.customers,
      plants: snapshot.plants,
    });
    expect(forbidden.test(text)).toBe(false);
  });
});
