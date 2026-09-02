/**
 * Expands the pilot spec into a full planning snapshot.
 *
 * Everything derives from one fixed seed, so the dataset is identical on every
 * machine and every run. The scripted scenarios are *planted as facts* — a norm
 * maintained in 2024 and never revisited, a vendor whose receipts genuinely
 * scatter across thirty days, a purchase-order line nobody has acknowledged —
 * and the engines have to find them. Nothing here injects a finding.
 *
 * Order matters. Demand and bills of material are built first, then exploded to
 * get each item-plant's true daily consumption, and only then are planning
 * parameters and opening positions sized against it. Sizing a norm from a guess
 * instead produces a dataset where everything looks broken, which is not
 * realism — it is noise.
 *
 * The two hero chains are *pinned*: their factors, constraints, opening
 * positions and open orders are written exactly, because the worked examples in
 * the PRD have to be reproducible on screen. Their outputs are still computed —
 * nothing writes down a projected balance or a net requirement.
 */

import {
  addDays,
  fromEpochDay,
  toEpochDay,
  type BomLine,
  type Calendar,
  type Customer,
  type DeliveryLine,
  type DemandElement,
  type Item,
  type ItemPlant,
  type ItemVendor,
  type Plant,
  type PlanningSnapshot,
  type QuarantineLot,
  type ReceiptHistory,
  type StockPosition,
  type SupplyElement,
  type Vendor,
} from '@repo/domain';

import { streamFactory, type Rng } from '../prng';
import {
  CHAIN_FG,
  CHAIN_ITEMS,
  HERO_PM,
  HERO_RM,
  HERO_RM_TWIN,
  PACKAGING_DRIFT,
  PILOT_SPEC,
  SOAP_CHAIN,
  type ItemArchetype,
} from './spec';

const SPEC = PILOT_SPEC;
const PLANNING_EPOCH = toEpochDay(SPEC.planningDate);
const PILOT_PLANT = HERO_RM.plantId;

/**
 * Days of demand generated beyond the planning horizon.
 *
 * Coverage looks forward from the last bucket, so a demand series that stops
 * dead at day 182 makes every material look like it falls off a cliff on day
 * 183.
 */
const DEMAND_TAIL_DAYS = 120;

/** Portfolio size per item type, heroes included. */
const COUNTS = { FG: 96, SFG: 22, RM: 52, PM: 84 } as const;

export const PILOT_COUNTS = COUNTS;

/** Id blocks, chosen so the hero codes fall where the PRD writes them. */
const ID_BASE = { FG: 10001, SFG: 20101, RM: 30101, PM: 88401 } as const;

// ---------------------------------------------------------------------------

export function generatePilotSnapshot(): PlanningSnapshot {
  const stream = streamFactory(SPEC.seed);

  const plants = SPEC.plants.map((plant) => ({ ...plant }) as Plant);
  const calendars = SPEC.calendars.map((calendar) => ({
    id: calendar.id,
    workingDays: [...calendar.workingDays],
    holidays: [...calendar.holidays],
  })) as Calendar[];

  const items = buildItems(stream('items'));
  const { vendors, itemVendors } = buildVendors(stream('vendors'), items, plants);
  const boms = buildBoms(stream('boms'), items, plants);
  const { demand, customers } = buildDemand(stream('demand'), items, plants);

  // Consumption has to be known before parameters can be sized against it, so
  // the explosion is done here rather than left to the engine.
  const dailyConsumption = explodeToDailyConsumption(items, boms, demand, plants);

  const itemPlants = buildItemPlants(stream('item-plants'), items, plants, itemVendors, dailyConsumption);
  const stock = buildStock(stream('stock'), items, itemPlants, dailyConsumption);
  const supply = buildSupply(stream('supply'), items, itemPlants, itemVendors, dailyConsumption);
  const receiptHistory = buildReceiptHistory(stream('receipts'), itemPlants, itemVendors, items);

  return {
    dataPackId: SPEC.id,
    items,
    plants,
    itemPlants,
    boms,
    resources: [],
    routings: [],
    vendors,
    itemVendors,
    substitutes: [],
    calendars,
    receiptHistory,
    stock,
    supply,
    demand,
    customers,
  };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

interface PinnedItem {
  itemId: string;
  description: string;
  baseUom: string;
  cost: number;
  itemCategoryId?: string;
  shelfLifeDays?: number | null;
}

/**
 * Materials the pinned chain owns outright.
 *
 * Kept out of the randomly generated bills of material so the hero's gross
 * requirement traces to exactly one chain. A planner opening the explain panel
 * has to be able to reach a soap number they recognise; a requirement with a
 * dozen incidental parents hanging off it cannot be walked back to anything.
 */
const RESERVED_COMPONENTS = new Set<string>([
  HERO_RM.itemId,
  HERO_RM_TWIN.itemId,
  HERO_PM.itemId,
  CHAIN_ITEMS.noodle.itemId,
  CHAIN_ITEMS.blend.itemId,
  CHAIN_ITEMS.palmKernel.itemId,
  CHAIN_ITEMS.tallow.itemId,
]);

/** Materials written by hand because a worked example depends on them. */
const PINNED: Record<'FG' | 'SFG' | 'RM' | 'PM', PinnedItem[]> = {
  FG: [
    { ...CHAIN_FG.soap, cost: CHAIN_FG.soap.cost, shelfLifeDays: 900 },
    { ...CHAIN_FG.refill, cost: CHAIN_FG.refill.cost, shelfLifeDays: 730 },
  ],
  SFG: [
    { ...CHAIN_ITEMS.noodle, cost: CHAIN_ITEMS.noodle.cost, shelfLifeDays: 365 },
    { ...CHAIN_ITEMS.blend, cost: CHAIN_ITEMS.blend.cost, shelfLifeDays: 240 },
  ],
  RM: [
    {
      itemId: HERO_RM_TWIN.itemId,
      description: HERO_RM_TWIN.description,
      baseUom: HERO_RM_TWIN.baseUom,
      cost: HERO_RM_TWIN.standardCost,
      itemCategoryId: HERO_RM_TWIN.itemCategoryId,
      shelfLifeDays: HERO_RM_TWIN.shelfLifeDays,
    },
    {
      itemId: HERO_RM.itemId,
      description: HERO_RM.description,
      baseUom: HERO_RM.baseUom,
      cost: HERO_RM.standardCost,
      itemCategoryId: HERO_RM.itemCategoryId,
      shelfLifeDays: HERO_RM.shelfLifeDays,
    },
    { ...CHAIN_ITEMS.palmKernel, cost: CHAIN_ITEMS.palmKernel.cost, shelfLifeDays: 365 },
    { ...CHAIN_ITEMS.tallow, cost: CHAIN_ITEMS.tallow.cost, shelfLifeDays: 365 },
  ],
  PM: [
    {
      itemId: HERO_PM.itemId,
      description: HERO_PM.description,
      baseUom: HERO_PM.baseUom,
      cost: HERO_PM.standardCost,
      itemCategoryId: HERO_PM.itemCategoryId,
      shelfLifeDays: HERO_PM.shelfLifeDays,
    },
  ],
};

function buildItems(rng: Rng): Item[] {
  const items: Item[] = [];
  const pinnedById = new Map<string, PinnedItem>();
  for (const group of Object.values(PINNED)) for (const row of group) pinnedById.set(row.itemId, row);

  const groups: Array<{ type: Item['type']; archetypes: readonly ItemArchetype[]; count: number; base: number }> = [
    { type: 'FG', archetypes: SPEC.fgArchetypes, count: COUNTS.FG, base: ID_BASE.FG },
    { type: 'SFG', archetypes: SPEC.sfgArchetypes, count: COUNTS.SFG, base: ID_BASE.SFG },
    { type: 'RM', archetypes: SPEC.rmArchetypes, count: COUNTS.RM, base: ID_BASE.RM },
    { type: 'PM', archetypes: SPEC.pmArchetypes, count: COUNTS.PM, base: ID_BASE.PM },
  ];

  for (const group of groups) {
    for (let index = 0; index < group.count; index += 1) {
      const id = `${group.type}-${group.base + index}`;
      const pinned = pinnedById.get(id);

      if (pinned) {
        items.push({
          id,
          description: pinned.description,
          type: group.type,
          baseUom: pinned.baseUom,
          itemCategoryId: pinned.itemCategoryId ?? null,
          // Every pinned material is a fast mover the plan depends on.
          abcClass: 'A',
          xyzClass: group.type === 'FG' ? 'Y' : 'X',
          shelfLifeDays: pinned.shelfLifeDays ?? null,
          isPhantom: false,
          standardCost: pinned.cost,
          createdOn: '2019-04-01',
        });
        continue;
      }

      const archetype = group.archetypes[index % group.archetypes.length] as ItemArchetype;
      const variant = archetype.variants[
        Math.floor(index / group.archetypes.length) % archetype.variants.length
      ] as string;

      items.push({
        id,
        description: `${archetype.name} — ${variant}`,
        type: group.type,
        baseUom: archetype.baseUom,
        // Variants of one archetype that name a source are interchangeable.
        itemCategoryId: archetype.itemCategoryId ?? null,
        abcClass: rng.weighted(['A', 'B', 'C'] as const, [0.2, 0.3, 0.5]),
        xyzClass: rng.weighted(['X', 'Y', 'Z'] as const, [0.35, 0.4, 0.25]),
        shelfLifeDays: archetype.shelfLifeDays,
        isPhantom: false,
        standardCost: round2(archetype.baseCost * rng.float(0.9, 1.12)),
        createdOn: fromEpochDay(PLANNING_EPOCH - rng.int(400, 2_400)),
      });
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Bills of material
// ---------------------------------------------------------------------------

function bom(
  parentItemId: string,
  plantId: string,
  componentItemId: string,
  qtyPer: number,
  options: { yieldPct?: number; scrapPct?: number; label?: string } = {}
): BomLine {
  return {
    parentItemId,
    plantId,
    componentItemId,
    qtyPer,
    componentScrapPct: options.scrapPct ?? 0,
    operationYieldPct: options.yieldPct ?? 1,
    stepLabel: options.label ?? null,
    validFrom: '2020-01-01',
    validTo: '2099-12-31',
    alternateBomId: '1',
    isAlternate: false,
  };
}

/**
 * The pinned soap chain, factor for factor.
 *
 * This is the arithmetic the explain panel walks back through to reach a soap
 * number the sponsor recognises, so it is written as four separate BOM levels
 * with the conversion losses on the steps that actually incur them, rather than
 * folded into one convenient multiplier.
 */
/** Bars broken on the soap line, between the finished good and the noodle. */
const SOAP_TO_NOODLE_SCRAP = 0.005;

/**
 * Tonnes of imported oil behind one bar of soap.
 *
 * Every factor between the sponsor's own number and the hero's requirement,
 * multiplied out — the same product the explain panel walks through one step at
 * a time. Derived from `SOAP_CHAIN` rather than written down, so a change to
 * the blend ratio moves the demand that produces the worked example instead of
 * quietly invalidating it.
 */
export const OIL_MT_PER_SOAP_BAR =
  SOAP_CHAIN.barWeightMt *
  SOAP_CHAIN.noodleFactor *
  (1 + SOAP_TO_NOODLE_SCRAP) *
  (SOAP_CHAIN.oilContent / SOAP_CHAIN.dfaStageYield) *
  ((SOAP_CHAIN.pfadBlendShare * SOAP_CHAIN.importSourceShare) / SOAP_CHAIN.conversionYield);

/**
 * The soap bars that draw on the pinned noodle.
 *
 * Shared by the bill-of-material builder and the demand builder, because the
 * hero's requirement is the *sum* of what they all pull: pinning one ramp
 * without knowing the others would land the worked example somewhere close to
 * the PRD's table rather than on it.
 */
function soapBarFgIds(fgs: Item[]): string[] {
  return fgs
    .filter((fg) => fg.description.includes('Soap Bar') || fg.id === CHAIN_FG.soap.itemId)
    .slice(0, 12)
    .map((fg) => fg.id);
}

function heroChainBoms(soapFgIds: string[]): BomLine[] {
  const c = SOAP_CHAIN;
  const lines: BomLine[] = [];

  for (const fgId of soapFgIds) {
    lines.push(
      bom(fgId, PILOT_PLANT, CHAIN_ITEMS.noodle.itemId, c.barWeightMt * c.noodleFactor, {
        label: 'Soap to noodle',
        scrapPct: SOAP_TO_NOODLE_SCRAP,
      })
    );
  }

  lines.push(
    bom(CHAIN_ITEMS.noodle.itemId, PILOT_PLANT, CHAIN_ITEMS.blend.itemId, c.oilContent, {
      yieldPct: c.dfaStageYield,
      label: 'Oil content of the noodle',
    })
  );

  // The blend, split across the oils that make it. The shares sum to one, and
  // the PFAD share is itself split across two material codes by the 60:40.
  lines.push(
    bom(CHAIN_ITEMS.blend.itemId, PILOT_PLANT, HERO_RM.itemId, c.pfadBlendShare * c.importSourceShare, {
      yieldPct: c.conversionYield,
      label: 'PFAD share of the blend, then the import side of the 60:40',
    }),
    bom(CHAIN_ITEMS.blend.itemId, PILOT_PLANT, HERO_RM_TWIN.itemId, c.pfadBlendShare * (1 - c.importSourceShare), {
      yieldPct: c.conversionYield,
      label: 'PFAD share of the blend, then the local side of the 60:40',
    }),
    bom(CHAIN_ITEMS.blend.itemId, PILOT_PLANT, CHAIN_ITEMS.palmKernel.itemId, c.palmKernelBlendShare, {
      yieldPct: c.conversionYield,
      label: 'Palm kernel oil share of the blend',
    }),
    bom(CHAIN_ITEMS.blend.itemId, PILOT_PLANT, CHAIN_ITEMS.tallow.itemId, c.tallowBlendShare, {
      yieldPct: c.conversionYield,
      label: 'Tallow substitute share of the blend',
    })
  );

  // Hero B hangs off the refill finished good: one bottle per unit, plus the
  // siblings a planner has to check before expediting any one of them.
  lines.push(
    // No scrap uplift on the hero's own line, deliberately. A percentage here
    // makes the bottle's requirement a fraction of a pallet away from the
    // campaign it is quoted against, and the schedule builder then rounds a
    // whole 10,000-unit pallet off the warehouse headroom to stay under the
    // ceiling — a ten-thousand-unit answer moving on a five-unit input. The
    // siblings below still carry theirs, so scrap remains visible where it
    // costs nothing to read.
    bom(CHAIN_FG.refill.itemId, PILOT_PLANT, HERO_PM.itemId, 1, { label: 'One bottle per unit' }),
    bom(CHAIN_FG.refill.itemId, PILOT_PLANT, `PM-${ID_BASE.PM + 40}`, 1, {
      label: 'One closure per unit',
      scrapPct: 0.01,
    }),
    bom(CHAIN_FG.refill.itemId, PILOT_PLANT, `PM-${ID_BASE.PM + 12}`, 1, {
      label: 'One label per unit',
      scrapPct: 0.02,
    }),
    bom(CHAIN_FG.refill.itemId, PILOT_PLANT, `PM-${ID_BASE.PM + 3}`, 1 / 48, { label: 'One shipper per 48 units' }),
    bom(CHAIN_FG.refill.itemId, PILOT_PLANT, `SFG-${ID_BASE.SFG + 6}`, 0.000048, { label: 'Slurry per unit' })
  );

  return lines;
}

function buildBoms(rng: Rng, items: Item[], plants: Plant[]): BomLine[] {
  const lines: BomLine[] = [];
  const byType = (type: Item['type']): Item[] => items.filter((item) => item.type === type);

  const fgs = byType('FG');
  const sfgs = byType('SFG');
  const rms = byType('RM');
  const pms = byType('PM');

  const pinnedParents = new Set<string>([
    CHAIN_FG.soap.itemId,
    CHAIN_FG.refill.itemId,
    CHAIN_ITEMS.noodle.itemId,
    CHAIN_ITEMS.blend.itemId,
  ]);

  // Soap bars other than the pinned one also draw on the pinned noodle, which
  // is the point of low-level-code sequencing: a shared intermediate must see
  // every parent's demand before it is netted.
  const soapFgIds = soapBarFgIds(fgs);
  lines.push(...heroChainBoms(soapFgIds));

  for (const plant of plants) {
    for (const fg of fgs) {
      if (!producesAt(fg, plant)) continue;
      if (plant.id === PILOT_PLANT && pinnedParents.has(fg.id)) continue;
      if (plant.id === PILOT_PLANT && soapFgIds.includes(fg.id)) continue;

      // One bulk stage, then a wide list of packaging — the FMCG shape.
      const bulk = pickFree(sfgs, `${fg.id}|${plant.id}|bulk`);
      lines.push(
        bom(fg.id, plant.id, bulk.id, bulk.baseUom === 'MT' ? 0.0001 : 0.012, {
          yieldPct: round4(rng.float(0.965, 0.995)),
          label: 'Bulk per unit',
          scrapPct: round4(rng.float(0.002, 0.01)),
        })
      );

      const packCount = rng.int(3, 5);
      for (let index = 0; index < packCount; index += 1) {
        const pm = pickFree(pms, `${fg.id}|${plant.id}|pm${index}`);
        if (
          lines.some(
            (line) => line.parentItemId === fg.id && line.plantId === plant.id && line.componentItemId === pm.id
          )
        )
          continue;
        lines.push(
          bom(
            fg.id,
            plant.id,
            pm.id,
            pm.baseUom === 'KG' ? round4(rng.float(0.004, 0.02)) : rng.chance(0.25) ? round4(1 / rng.int(24, 96)) : 1,
            {
              label: 'Packaging per unit',
              scrapPct: round4(rng.float(0.005, 0.03)),
            }
          )
        );
      }
    }

    for (const sfg of sfgs) {
      if (plant.id === PILOT_PLANT && pinnedParents.has(sfg.id)) continue;
      const rmCount = rng.int(2, 4);
      for (let index = 0; index < rmCount; index += 1) {
        const rm = pickFree(rms, `${sfg.id}|${plant.id}|rm${index}`);
        if (
          lines.some(
            (line) => line.parentItemId === sfg.id && line.plantId === plant.id && line.componentItemId === rm.id
          )
        )
          continue;
        lines.push(
          bom(sfg.id, plant.id, rm.id, rm.baseUom === 'KG' ? round4(rng.float(2, 30)) : round4(rng.float(0.15, 0.5)), {
            yieldPct: round4(rng.float(0.94, 0.995)),
            label: 'Raw material per unit of bulk',
          })
        );
      }
    }
  }

  return lines;
}

/** A stable pick that never lands on a material the pinned chain owns. */
function pickFree(pool: Item[], label: string): Item {
  const free = pool.filter((item) => !RESERVED_COMPONENTS.has(item.id));
  const source = free.length > 0 ? free : pool;
  return source[hashIndex(label, source.length)] as Item;
}

/** Which plants make which finished goods. Spread, not uniform. */
function producesAt(fg: Item, plant: Plant): boolean {
  // The two finished goods the worked examples hang off are made at the pilot
  // plant and only there, so the chain has one unambiguous home.
  if (fg.id === CHAIN_FG.soap.itemId || fg.id === CHAIN_FG.refill.itemId) return plant.id === PILOT_PLANT;
  const spread = hashIndex(`${fg.id}|produce`, 10);
  if (plant.id === PILOT_PLANT) return spread < 7;
  if (plant.type === 'COPACKER') return spread >= 8;
  return hashIndex(`${fg.id}|${plant.id}`, 10) < 4;
}

// ---------------------------------------------------------------------------
// Demand
// ---------------------------------------------------------------------------

/**
 * Independent demand, as weekly buckets of finished goods.
 *
 * The pinned chains carry an explicit ramp: soap through a pre-summer noodle
 * build, and the refill through a promotion. Everything else is a seasonal
 * baseline with week-to-week noise, because the hero's problem is that lead
 * time moves, not that demand does — and a dataset where demand thrashes would
 * make that argument impossible to see.
 */
function buildDemand(rng: Rng, items: Item[], plants: Plant[]): { demand: DemandElement[]; customers: Customer[] } {
  const demand: DemandElement[] = [];
  const customers: Customer[] = [];
  const channels = ['MT', 'GT', 'ECOM', 'EXPORT'] as const;

  for (let index = 0; index < 22; index += 1) {
    customers.push({
      id: `CU-${String(index + 1).padStart(3, '0')}`,
      name: `${rng.pick(['Northern', 'Western', 'Southern', 'Eastern', 'Central'])} ${rng.pick(['Distribution', 'Retail Group', 'Trade Partner', 'Modern Trade'])} ${index + 1}`,
      channel: rng.pick(channels),
      isKeyAccount: rng.chance(0.25),
    });
  }

  const totalDays = SPEC.horizonDays + DEMAND_TAIL_DAYS;
  const fgs = items.filter((item) => item.type === 'FG');

  // Every raw series first, in one pass, so the seeded draws keep their order.
  // Only then can the pinned soap ramp be solved: the hero's requirement is
  // what *all* the soap bars pull through the shared noodle, so the ramp has to
  // be set against the others rather than beside them.
  const rawByKey = new Map<string, Float64Array>();
  for (const fg of fgs) {
    for (const plant of plants) {
      if (!producesAt(fg, plant)) continue;
      rawByKey.set(`${fg.id}@${plant.id}`, pinnedSeries(fg.id, plant, totalDays) ?? baselineSeries(rng, totalDays));
    }
  }
  const pilot = plants.find((plant) => plant.id === PILOT_PLANT);
  if (pilot) solveSoapRamp(rawByKey, fgs, pilot, totalDays);

  for (const fg of fgs) {
    for (const plant of plants) {
      if (!producesAt(fg, plant)) continue;

      const raw = rawByKey.get(`${fg.id}@${plant.id}`) as Float64Array;
      const series = onWorkingDays(raw, plant, totalDays);
      for (let day = 0; day < totalDays; day += 1) {
        const qty = series[day] as number;
        if (qty <= 0) continue;
        const customer = customers[hashIndex(`${fg.id}|${plant.id}|${day}`, customers.length)] as Customer;
        // Near-term demand is firm orders; beyond the order book it is forecast.
        const isFirm = day <= 21;
        demand.push({
          id: `D-${fg.id}-${plant.id}-${day}`,
          type: isFirm ? 'SALES_ORDER' : 'FORECAST',
          itemId: fg.id,
          plantId: plant.id,
          qty: Math.round(qty),
          requiredDate: fromEpochDay(PLANNING_EPOCH + day),
          customerId: isFirm ? customer.id : null,
          channel: customer.channel,
          marginPerUnit: round2(fg.standardCost * 0.22),
          pricePerUnit: round2(fg.standardCost * 1.45),
          priority: customer.isKeyAccount ? 1 : 3,
          parentSupplyElementId: null,
          sourceSystem: 'SAP',
        });
      }
    }
  }

  return { demand, customers };
}

/**
 * The pinned ramps.
 *
 * Written as a daily series rather than a weekly one because the near horizon
 * is planned daily, and a weekly lump landing every Monday would make the
 * execution zone read as a series of cliffs that are an artefact of bucketing
 * rather than of the plan.
 */
function pinnedSeries(itemId: string, plant: Plant, totalDays: number): Float64Array | null {
  if (plant.id !== PILOT_PLANT) return null;

  if (itemId === CHAIN_FG.soap.itemId) {
    // Soap in bars, sized so that what reaches the imported oil below is
    // exactly the pre-summer build the worked example states. Divided by the
    // chain rather than guessed at, and then reduced by what the other soap
    // bars pull — see `solveSoapRamp`.
    const bars = HERO_RM.weeklyRequirement.map((mt) => mt / OIL_MT_PER_SOAP_BAR);
    return spreadWeekly(bars, plant, totalDays);
  }

  if (itemId === CHAIN_FG.refill.itemId) {
    // The refill's promotion, week by week. One bottle per unit and no scrap
    // on that line, so what the *bottle* nets on is exactly the campaign the
    // schedule-builder example is sized against.
    return spreadWeekly(HERO_PM.weeklyRequirement, plant, totalDays);
  }

  return null;
}

/**
 * The pinned soap ramp, solved against the bars that share its noodle.
 *
 * The hero's requirement is the sum of every soap bar's pull through the
 * shared intermediate — that is the whole point of low-level-code sequencing.
 * So the pinned ramp carries the *residual*: the build the worked example
 * states, less what the others already draw. Set it beside them instead and
 * the demo's first grid row is out by a sixth.
 */
function solveSoapRamp(rawByKey: Map<string, Float64Array>, fgs: Item[], plant: Plant, totalDays: number): void {
  const pinned = rawByKey.get(`${CHAIN_FG.soap.itemId}@${PILOT_PLANT}`);
  if (!pinned) return;

  // Subtract what the others will actually *demand*, not their raw series. They
  // still go through the closed-day carry on the way out, which moves a Sunday
  // into the following week — so subtracting the raw shape leaves the hero's
  // requirement out by a few tonnes a week, growing with the build.
  const others = new Float64Array(totalDays);
  for (const id of soapBarFgIds(fgs)) {
    if (id === CHAIN_FG.soap.itemId) continue;
    const series = rawByKey.get(`${id}@${PILOT_PLANT}`);
    if (!series) continue;
    const emitted = onWorkingDays(series, plant, totalDays);
    for (let day = 0; day < totalDays; day += 1) {
      others[day] = (others[day] as number) + Math.round(emitted[day] as number);
    }
  }

  for (let day = 0; day < totalDays; day += 1) {
    pinned[day] = Math.max(0, (pinned[day] as number) - (others[day] as number));
  }
}

/**
 * A weekly plan spread across the working days of its own week.
 *
 * A week's demand stays in its week. The general path carries a closed day's
 * quantity forward to the next open one, which is honest for a baseline and
 * wrong here: a Sunday carried into Monday moves a seventh of the week across
 * a bucket boundary, and the worked example stops footing by exactly that much.
 */
function spreadWeekly(weekly: readonly number[], plant: Plant, totalDays: number): Float64Array {
  const series = new Float64Array(totalDays);
  const last = weekly[weekly.length - 1] ?? 0;
  const calendar = SPEC.calendars.find((entry) => entry.id === plant.calendarId);
  const working = new Set<number>(calendar?.workingDays ?? [1, 2, 3, 4, 5, 6]);
  const holidays = new Set<string>(calendar?.holidays ?? []);

  for (let week = 0; week * 7 < totalDays; week += 1) {
    const open: number[] = [];
    for (let day = week * 7; day < Math.min((week + 1) * 7, totalDays); day += 1) {
      const epochDay = PLANNING_EPOCH + day;
      const dow = (((epochDay + 4) % 7) + 7) % 7;
      if (working.has(dow) && !holidays.has(fromEpochDay(epochDay))) open.push(day);
    }
    const total = Math.round(weekly[week] ?? last);
    if (open.length === 0 || total <= 0) continue;
    // Whole units, distributed so the week sums to its total exactly. An even
    // split leaves a remainder that each day then rounds away, and a week that
    // is two units short of its plan is a pallet short by the time the schedule
    // builder has rounded the warehouse headroom down to fit.
    const base = Math.floor(total / open.length);
    const remainder = total - base * open.length;
    open.forEach((day, index) => {
      series[day] = base + (index < remainder ? 1 : 0);
    });
  }

  return series;
}

/**
 * Moves demand off days the plant does not run, onto the next day it does.
 *
 * Not cosmetic. Lead-time offsetting walks *working* days, so a requirement
 * sitting on a Sunday is released on the same day as the Saturday one before
 * it. The quantities are conserved, but two days' worth pile onto one release
 * and the week either side of it reads as a spike and a hole — a sawtooth that
 * is an artefact of the calendar and nothing to do with how anything sells.
 * The weekly total is unchanged; only the day it lands on moves.
 */
function onWorkingDays(series: Float64Array, plant: Plant, totalDays: number): Float64Array {
  const calendar = SPEC.calendars.find((entry) => entry.id === plant.calendarId);
  if (!calendar) return series;
  const working = new Set<number>(calendar.workingDays);
  const holidays = new Set<string>(calendar.holidays);

  const out = new Float64Array(totalDays);
  let carried = 0;
  for (let day = 0; day < totalDays; day += 1) {
    const epochDay = PLANNING_EPOCH + day;
    const iso = fromEpochDay(epochDay);
    const dow = (((epochDay + 4) % 7) + 7) % 7;
    const isWorking = working.has(dow) && !holidays.has(iso);
    if (isWorking) {
      out[day] = (series[day] as number) + carried;
      carried = 0;
    } else {
      carried += series[day] as number;
    }
  }
  // Anything carried past the end of the window is dropped rather than dumped
  // on the last day, which would put a spike on the horizon boundary.
  return out;
}

function baselineSeries(rng: Rng, totalDays: number): Float64Array {
  const [low, high] = SPEC.volumes.fgDailyRange;
  const mean = rng.float(low, high);
  const series = new Float64Array(totalDays);
  for (let day = 0; day < totalDays; day += 1) {
    const iso = fromEpochDay(PLANNING_EPOCH + day);
    series[day] = Math.max(0, rng.normal(mean, mean * 0.14) * seasonalMultiplier(iso));
  }
  return series;
}

function seasonalMultiplier(iso: string): number {
  const month = Number(iso.slice(5, 7)) - 1;
  return SPEC.seasonality.monthly[month] ?? 1;
}

// ---------------------------------------------------------------------------
// Consumption — the explosion that parameters are sized against
// ---------------------------------------------------------------------------

interface Consumption {
  mean: number;
  stdDev: number;
  total: number;
}

function explodeToDailyConsumption(
  items: Item[],
  boms: BomLine[],
  demand: DemandElement[],
  plants: Plant[]
): Map<string, Consumption> {
  const days = SPEC.horizonDays + DEMAND_TAIL_DAYS;
  const series = new Map<string, Float64Array>();
  const itemById = new Map(items.map((item) => [item.id, item]));

  const ensure = (key: string): Float64Array => {
    let existing = series.get(key);
    if (!existing) {
      existing = new Float64Array(days);
      series.set(key, existing);
    }
    return existing;
  };

  for (const element of demand) {
    const day = toEpochDay(element.requiredDate) - PLANNING_EPOCH;
    if (day < 0 || day >= days) continue;
    const target = ensure(`${element.itemId}@${element.plantId}`);
    target[day] = (target[day] as number) + element.qty;
  }

  // Level order: finished goods, then bulk, then bought-in. Two passes over a
  // three-level structure is enough, and doing it here rather than calling the
  // engine keeps the generator free of a dependency on it.
  const levels: Array<Item['type']> = ['FG', 'SFG'];
  for (const level of levels) {
    for (const plant of plants) {
      for (const item of items) {
        if (item.type !== level) continue;
        const parent = series.get(`${item.id}@${plant.id}`);
        if (!parent) continue;
        for (const line of boms) {
          if (line.parentItemId !== item.id || line.plantId !== plant.id || line.isAlternate) continue;
          const component = itemById.get(line.componentItemId);
          if (!component) continue;
          const factor = (line.qtyPer / (line.operationYieldPct || 1)) * (1 + line.componentScrapPct);
          const target = ensure(`${line.componentItemId}@${plant.id}`);
          for (let day = 0; day < days; day += 1) {
            target[day] = (target[day] as number) + (parent[day] as number) * factor;
          }
        }
      }
    }
  }

  const result = new Map<string, Consumption>();
  for (const [key, values] of series) {
    let total = 0;
    for (let day = 0; day < days; day += 1) total += values[day] as number;
    const mean = total / days;
    let variance = 0;
    for (let day = 0; day < days; day += 1) variance += ((values[day] as number) - mean) ** 2;
    result.set(key, { mean, stdDev: Math.sqrt(variance / days), total });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

interface VendorProfile {
  meanLeadTimeDays: number;
  stdDevDays: number;
  isImport: boolean;
}

const VENDOR_PROFILES = new Map<string, VendorProfile>();

function buildVendors(rng: Rng, items: Item[], plants: Plant[]): { vendors: Vendor[]; itemVendors: ItemVendor[] } {
  VENDOR_PROFILES.clear();
  const vendors: Vendor[] = [];
  const pools = [
    { ...SPEC.vendors.import, isImport: true, calendarId: 'CAL-VENDOR-IMPORT' },
    { ...SPEC.vendors.domesticChemical, isImport: false, calendarId: 'CAL-VENDOR-DOM' },
    { ...SPEC.vendors.packaging, isImport: false, calendarId: 'CAL-VENDOR-DOM' },
    { ...SPEC.vendors.contract, isImport: false, calendarId: 'CAL-VENDOR-DOM' },
  ];

  for (const pool of pools) {
    for (let index = 1; index <= pool.count; index += 1) {
      const id = `${pool.prefix}-${String(index).padStart(2, '0')}`;
      const meanLeadTimeDays = rng.int(pool.leadTimeRange[0], pool.leadTimeRange[1]);
      const stdDevDays = round2(rng.float(pool.stdDevRange[0], pool.stdDevRange[1]));
      VENDOR_PROFILES.set(id, { meanLeadTimeDays, stdDevDays, isImport: pool.isImport });
      vendors.push({
        id,
        name: `${pool.isImport ? 'Overseas' : 'Domestic'} Supplier ${index} (${pool.prefix.slice(2)})`,
        reliabilityScore: round2(Math.max(0.4, Math.min(0.98, 1 - stdDevDays / 40))),
        calendarId: pool.calendarId,
        productionShutdownWeeks: [],
      });
    }
  }

  // The packaging vendor behind Hero B shuts its plant for annual maintenance
  // in W39. Confirmed on 14 August, which is why the schedule can plan around
  // it rather than discover it.
  const heroPmVendor = vendors.find((vendor) => vendor.id === HERO_PM.vendorId);
  if (heroPmVendor) heroPmVendor.productionShutdownWeeks = [...HERO_PM.shutdownWeeks];

  // The hero import vendor's history is the whole drift argument, so its
  // profile is written rather than drawn.
  const heroObserved = HERO_RM.observedTotalDays;
  const heroMean = heroObserved.reduce((sum, value) => sum + value, 0) / heroObserved.length;
  VENDOR_PROFILES.set(HERO_RM.vendorId, {
    meanLeadTimeDays: heroMean,
    stdDevDays: stdDevOf(heroObserved, heroMean),
    isImport: true,
  });

  const itemVendors = buildItemVendors(rng, items, plants, vendors);
  return { vendors, itemVendors };
}

function buildItemVendors(rng: Rng, items: Item[], plants: Plant[], vendors: Vendor[]): ItemVendor[] {
  const rows: ItemVendor[] = [];
  const importPool = vendors.filter((vendor) => vendor.id.startsWith('V-IMP'));
  const chemPool = vendors.filter((vendor) => vendor.id.startsWith('V-CHM'));
  const packPool = vendors.filter((vendor) => vendor.id.startsWith('V-PKG'));

  const pinned = new Set<string>([
    `${HERO_RM.itemId}@${HERO_RM.plantId}`,
    `${HERO_RM_TWIN.itemId}@${HERO_RM_TWIN.plantId}`,
    `${HERO_PM.itemId}@${HERO_PM.plantId}`,
  ]);

  rows.push(heroItemVendor(HERO_RM), heroItemVendor(HERO_RM_TWIN), heroItemVendor(HERO_PM));

  for (const item of items) {
    if (item.type !== 'RM' && item.type !== 'PM') continue;
    for (const plant of plants) {
      const key = `${item.id}@${plant.id}`;
      if (pinned.has(key)) continue;
      if (!sourcedAt(item, plant)) continue;

      const isImport = item.type === 'RM' && item.description.includes('Import');
      const pool = item.type === 'PM' ? packPool : isImport ? importPool : chemPool;
      const primary = pool[hashIndex(`${key}|primary`, pool.length)] as Vendor;

      // Roughly a third of materials are dual-sourced, which is where the 60:40
      // lives and where its absence of science shows.
      const dual = rng.chance(0.32);
      const secondary = dual ? (pool[hashIndex(`${key}|secondary`, pool.length)] as Vendor) : null;
      const shares = dual && secondary && secondary.id !== primary.id ? [0.6, 0.4] : [1];
      const chosen = shares.length === 2 && secondary ? [primary, secondary] : [primary];

      for (let index = 0; index < chosen.length; index += 1) {
        const vendor = chosen[index] as Vendor;
        const profile = VENDOR_PROFILES.get(vendor.id) as VendorProfile;
        rows.push(makeItemVendor(rng, item, plant, vendor, profile, index === 0, shares[index] as number));
      }
    }
  }

  return rows;
}

type HeroSpec = typeof HERO_RM | typeof HERO_RM_TWIN | typeof HERO_PM;

function heroItemVendor(hero: HeroSpec): ItemVendor {
  const weeklyCapacity = 'weeklyCapacity' in hero ? hero.weeklyCapacity : null;
  const minGapDays = 'minGapDays' in hero ? hero.minGapDays : 0;
  return {
    itemId: hero.itemId,
    plantId: hero.plantId,
    vendorId: hero.vendorId,
    isPrimary: true,
    // The vendor's own quoted manufacturing time — the part most systems use
    // and then wonder why the plan breaks at the dock.
    leadTimeDays: hero.vendorReadinessDays,
    moq: hero.moq,
    incrementQty: hero.roundingValue,
    unitPrice: hero.standardCost,
    dailyCapacity: weeklyCapacity === null ? null : Math.round(weeklyCapacity / 6),
    expediteAvailable: hero.transitDays <= 8,
    expediteLeadTimeDays: hero.transitDays <= 8 ? Math.max(1, hero.vendorReadinessDays - 2) : null,
    expediteUnitPriceUplift: hero.transitDays <= 8 ? 0.18 : null,
    allocationShare: 1,
    maxShipmentQty: null,
    transitDays: hero.transitDays,
    acknowledgementDays: hero.acknowledgementDays,
    customsDays: hero.customsDays,
    weeklyCapacity,
    minGapDays,
    earliestDispatchDays: hero.acknowledgementDays + hero.vendorReadinessDays,
    isImport: hero.customsDays > 0,
  };
}

function makeItemVendor(
  rng: Rng,
  item: Item,
  plant: Plant,
  vendor: Vendor,
  profile: VendorProfile,
  isPrimary: boolean,
  share: number
): ItemVendor {
  const acknowledgementDays = profile.isImport ? rng.int(2, 6) : rng.int(1, 3);
  const customsDays = profile.isImport ? rng.int(8, 16) : 0;
  const transitDays = profile.isImport ? rng.int(24, 40) : rng.int(2, 9);
  const readiness = Math.max(3, Math.round(profile.meanLeadTimeDays - acknowledgementDays - customsDays - transitDays));

  const moqBase =
    item.baseUom === 'EA' ? rng.int(20, 120) * 1_000 : item.baseUom === 'KG' ? rng.int(200, 2_000) : rng.int(50, 400);
  const increment = item.baseUom === 'EA' ? 10_000 : item.baseUom === 'KG' ? 100 : 25;

  return {
    itemId: item.id,
    plantId: plant.id,
    vendorId: vendor.id,
    isPrimary,
    leadTimeDays: readiness,
    moq: moqBase,
    incrementQty: increment,
    unitPrice: round2(item.standardCost * rng.float(0.95, 1.06)),
    dailyCapacity: null,
    expediteAvailable: !profile.isImport && rng.chance(0.6),
    expediteLeadTimeDays: profile.isImport ? null : Math.max(2, readiness - rng.int(2, 5)),
    expediteUnitPriceUplift: profile.isImport ? null : round2(rng.float(0.1, 0.35)),
    allocationShare: share,
    maxShipmentQty: rng.chance(0.4) ? moqBase * rng.int(3, 8) : null,
    transitDays,
    acknowledgementDays,
    customsDays,
    weeklyCapacity: rng.chance(0.55) ? moqBase * rng.int(3, 10) : null,
    minGapDays: rng.chance(0.35) ? rng.int(3, 7) : 0,
    earliestDispatchDays: acknowledgementDays + readiness,
    isImport: profile.isImport,
  };
}

function sourcedAt(item: Item, plant: Plant): boolean {
  return hashIndex(`${item.id}|${plant.id}|source`, 10) < (plant.id === PILOT_PLANT ? 9 : 5);
}

// ---------------------------------------------------------------------------
// Planning parameters — the norms the engine consumes exactly as maintained
// ---------------------------------------------------------------------------

const PACKAGING_DRIFT_KEYS = new Set<string>();

function buildItemPlants(
  rng: Rng,
  items: Item[],
  plants: Plant[],
  itemVendors: ItemVendor[],
  consumption: Map<string, Consumption>
): ItemPlant[] {
  PACKAGING_DRIFT_KEYS.clear();
  const rows: ItemPlant[] = [];
  const vendorByKey = new Map<string, ItemVendor>();
  for (const row of itemVendors) if (row.isPrimary) vendorByKey.set(`${row.itemId}@${row.plantId}`, row);

  const pinnedKeys = new Set([
    `${HERO_RM.itemId}@${HERO_RM.plantId}`,
    `${HERO_RM_TWIN.itemId}@${HERO_RM_TWIN.plantId}`,
    `${HERO_PM.itemId}@${HERO_PM.plantId}`,
    `${CHAIN_ITEMS.noodle.itemId}@${PILOT_PLANT}`,
    `${CHAIN_ITEMS.blend.itemId}@${PILOT_PLANT}`,
    `${CHAIN_FG.soap.itemId}@${PILOT_PLANT}`,
    `${CHAIN_FG.refill.itemId}@${PILOT_PLANT}`,
  ]);

  rows.push(heroItemPlant(HERO_RM, 'FOQ'), heroItemPlant(HERO_RM_TWIN, 'FOQ'), heroItemPlant(HERO_PM, 'POQ'));

  // The made stages of the pinned chain, deliberately transparent.
  //
  // Lot-for-lot, no buffer, and no production offset, so what arrives at the
  // bought materials below is the shape of demand and nothing else. A stage
  // that batched fortnightly would put spikes into the hero's requirement that
  // are an artefact of *its* lot size, and the worked example would then be
  // arguing with the wrong number.
  //
  // The zero offset is the load-bearing part. Every intermediate day of
  // production time shifts the requirement across a bucket boundary, and §15's
  // correctness test is that a projected balance reconciles *exactly* to a
  // hand-worked netting on the same inputs. None of these offsets is drawn on
  // any screen; the ninety days that are, belong to the oil itself and are
  // untouched.
  for (const stage of [
    { itemId: CHAIN_FG.soap.itemId, leadTime: 0 },
    { itemId: CHAIN_FG.refill.itemId, leadTime: 0 },
    { itemId: CHAIN_ITEMS.noodle.itemId, leadTime: 0 },
    { itemId: CHAIN_ITEMS.blend.itemId, leadTime: 0 },
  ]) {
    rows.push({
      itemId: stage.itemId,
      plantId: PILOT_PLANT,
      mrpType: 'PD',
      procurementType: 'MAKE',
      lotSizeRule: 'LFL',
      fixedLotSize: null,
      minLotSize: null,
      maxLotSize: null,
      roundingValue: null,
      periodsOfSupplyDays: null,
      reorderPoint: null,
      leadTimeDays: stage.leadTime,
      grProcessingTimeDays: 0,
      qaQuarantineDays: 0,
      // No buffer at the made stages. A bulk plant that carried one would batch
      // its releases, and those batches would then arrive at the oil below as
      // spikes that have nothing to do with how soap actually sells.
      safetyStock: 0,
      safetyTimeDays: 0,
      scrapPct: 0,
      serviceLevelTarget: 0.95,
      plannerCode: 'PL-1',
      sourcePlantId: null,
      isPlanningRelevant: true,
      paramsLastChangedOn: '2025-04-08',
      paramsLastChangedBy: 'Category planning',
      storageCapacity: null,
      dailyReceivingCapacity: null,
      maintainedStockDays: null,
      maintainedOrderDays: null,
      maxNormDays: null,
      campaignCycleDays: null,
    });
  }

  const driftCandidates: string[] = [];

  for (const item of items) {
    for (const plant of plants) {
      const key = `${item.id}@${plant.id}`;
      if (pinnedKeys.has(key)) continue;
      const used = consumption.get(key);
      if (!used || used.total <= 0) continue;

      const vendor = vendorByKey.get(key);
      const isBought = item.type === 'RM' || item.type === 'PM';
      if (isBought && !vendor) continue;

      const leadTimeDays = isBought
        ? (vendor as ItemVendor).acknowledgementDays +
          (vendor as ItemVendor).leadTimeDays +
          (vendor as ItemVendor).transitDays +
          (vendor as ItemVendor).customsDays
        : item.type === 'SFG'
          ? rng.int(2, 5)
          : rng.int(1, 3);

      const stockDays = isBought
        ? Math.round(leadTimeDays * rng.float(...SPEC.volumes.boughtStockDaysMultiplier))
        : item.type === 'SFG'
          ? rng.int(...SPEC.volumes.sfgStockDaysRange)
          : rng.int(...(SPEC.volumes.fgStockDaysByClass[item.abcClass] as unknown as [number, number]));

      // Safety stock is sized off the *demand* side alone, which is exactly the
      // gap Phase 2 exists to close: nothing in a maintained norm has a term
      // for how badly supply can move.
      const safetyStock = Math.round(used.mean * Math.max(2, stockDays * 0.28));

      rows.push({
        itemId: item.id,
        plantId: plant.id,
        mrpType: 'PD',
        procurementType: isBought ? 'BUY' : 'MAKE',
        lotSizeRule: isBought ? (rng.chance(0.35) ? 'POQ' : 'FOQ') : 'LFL',
        fixedLotSize: null,
        minLotSize: vendor?.moq ?? null,
        maxLotSize: null,
        roundingValue: vendor?.incrementQty ?? null,
        periodsOfSupplyDays: rng.int(7, 28),
        reorderPoint: null,
        leadTimeDays,
        grProcessingTimeDays: isBought ? rng.int(1, 2) : 0,
        qaQuarantineDays: isBought ? (vendor?.isImport ? rng.int(3, 6) : rng.int(0, 2)) : 0,
        safetyStock,
        safetyTimeDays: 0,
        scrapPct: 0,
        serviceLevelTarget: 0.95,
        plannerCode: `PL-${hashIndex(`${item.id}|planner`, 6) + 1}`,
        sourcePlantId: null,
        isPlanningRelevant: true,
        paramsLastChangedOn: fromEpochDay(PLANNING_EPOCH - rng.int(120, 1_100)),
        paramsLastChangedBy: rng.pick(['Category planning', 'Sourcing', 'Plant stores', 'Master data']),
        storageCapacity: isBought ? Math.round(used.mean * rng.float(25, 70)) : null,
        dailyReceivingCapacity: isBought ? Math.round(used.mean * rng.float(3, 9)) : null,
        maintainedStockDays: isBought ? stockDays : null,
        maintainedOrderDays: isBought ? stockDays : null,
        // The ceiling a max-min policy actually sets: a little above target,
        // not half as much again.
        maxNormDays: isBought ? Math.round(stockDays * 1.35) : null,
        campaignCycleDays: null,
      });

      if (item.type === 'PM' && plant.id === PILOT_PLANT) driftCandidates.push(key);
    }
  }

  // `leadTimeDays` is the *complete* chain — release to available — so goods
  // receipt and quality release belong inside it, exactly as the heroes carry
  // them. Folded here rather than in the literal above so the random draws keep
  // their order and the pack stays byte-identical everywhere else.
  // The heroes are pinned from the PRD and already carry the whole chain — the
  // calibration test asserts their six intervals sum to the maintained total —
  // so they are skipped rather than folded a second time.
  for (const row of rows) {
    if (row.procurementType !== 'BUY' || row.leadTimeDays === null) continue;
    if (pinnedKeys.has(`${row.itemId}@${row.plantId}`)) continue;
    row.leadTimeDays += row.grProcessingTimeDays + row.qaQuarantineDays;
  }

  // A block of domestic packaging maintained as though it behaved like an
  // import. The drift is real in the receipt history; nothing labels it.
  const byKey = new Map(rows.map((row) => [`${row.itemId}@${row.plantId}`, row]));
  for (const key of driftCandidates.slice(0, PACKAGING_DRIFT.count)) {
    const row = byKey.get(key);
    if (!row) continue;
    row.leadTimeDays = PACKAGING_DRIFT.maintainedLeadTimeDays;
    row.maintainedStockDays = PACKAGING_DRIFT.maintainedLeadTimeDays;
    row.maintainedOrderDays = PACKAGING_DRIFT.maintainedLeadTimeDays;
    row.paramsLastChangedOn = '2023-06-19';
    row.paramsLastChangedBy = 'Master data';
    PACKAGING_DRIFT_KEYS.add(key);
  }

  return rows;
}

function heroItemPlant(hero: HeroSpec, lotSizeRule: ItemPlant['lotSizeRule']): ItemPlant {
  const fixedPeriodDays = 'fixedPeriodDays' in hero ? hero.fixedPeriodDays : null;
  return {
    itemId: hero.itemId,
    plantId: hero.plantId,
    mrpType: 'PD',
    procurementType: 'BUY',
    lotSizeRule,
    fixedLotSize: null,
    minLotSize: hero.moq,
    maxLotSize: 'maxLotSize' in hero ? hero.maxLotSize : null,
    roundingValue: hero.roundingValue,
    periodsOfSupplyDays: fixedPeriodDays,
    reorderPoint: null,
    leadTimeDays: hero.maintainedLeadTimeDays,
    grProcessingTimeDays: hero.grProcessingTimeDays,
    qaQuarantineDays: hero.qaQuarantineDays,
    safetyStock: hero.safetyStock,
    safetyTimeDays: 0,
    scrapPct: 0,
    serviceLevelTarget: hero.serviceLevelTarget,
    plannerCode: 'PL-1',
    sourcePlantId: null,
    isPlanningRelevant: true,
    paramsLastChangedOn: hero.paramsLastChangedOn,
    paramsLastChangedBy: hero.paramsLastChangedBy,
    storageCapacity: hero.storageCapacity,
    dailyReceivingCapacity: hero.dailyReceivingCapacity,
    maintainedStockDays: hero.maintainedStockDays,
    maintainedOrderDays: hero.maintainedOrderDays,
    maxNormDays: hero.maxNormDays,
    campaignCycleDays: fixedPeriodDays,
  };
}

// ---------------------------------------------------------------------------
// Opening positions
// ---------------------------------------------------------------------------

function buildStock(
  rng: Rng,
  items: Item[],
  itemPlants: ItemPlant[],
  consumption: Map<string, Consumption>
): StockPosition[] {
  const positions: StockPosition[] = [];
  const itemById = new Map(items.map((item) => [item.id, item]));

  for (const row of itemPlants) {
    const key = `${row.itemId}@${row.plantId}`;
    const item = itemById.get(row.itemId);
    if (!item) continue;

    const pinned = pinnedStock(key);
    const used = consumption.get(key);
    const stageCover = CHAIN_STAGE_COVER_DAYS[key];
    const unrestricted =
      pinned?.unrestricted ??
      (stageCover !== undefined
        ? Math.round((used?.mean ?? 0) * stageCover)
        : Math.max(0, Math.round((used?.mean ?? 0) * (row.maintainedStockDays ?? 10) * rng.float(0.55, 1.15))));

    const quarantine: QuarantineLot[] = [];
    if (pinned?.quarantine) {
      quarantine.push(pinned.quarantine);
    } else if (row.qaQuarantineDays > 0 && rng.chance(0.22)) {
      const qty = Math.round((used?.mean ?? 0) * rng.float(2, 6));
      if (qty > 0) {
        const receivedOn = fromEpochDay(PLANNING_EPOCH - rng.int(0, row.qaQuarantineDays));
        quarantine.push({
          batchId: `Q-${row.itemId}-${row.plantId}`,
          qty,
          receivedOn,
          expectedReleaseDate: addDays(receivedOn, row.qaQuarantineDays),
        });
      }
    }

    const qualityInspection = quarantine.reduce((sum, lot) => sum + lot.qty, 0);
    const blocked = rng.chance(0.08) ? Math.round(unrestricted * rng.float(0.01, 0.05)) : 0;
    const inTransit = 0;

    positions.push({
      itemId: row.itemId,
      plantId: row.plantId,
      unrestricted,
      blocked,
      qualityInspection,
      inTransit,
      batches:
        item.shelfLifeDays === null || unrestricted === 0
          ? []
          : [
              {
                batchId: `B-${row.itemId}-${row.plantId}`,
                qty: unrestricted,
                expiryDate: fromEpochDay(PLANNING_EPOCH + Math.round(item.shelfLifeDays * rng.float(0.3, 0.85))),
              },
            ],
      quarantine,
    });
  }

  return positions;
}

function pinnedStock(key: string): { unrestricted: number; quarantine?: QuarantineLot } | null {
  if (key === `${HERO_RM.itemId}@${HERO_RM.plantId}`) {
    return {
      unrestricted: HERO_RM.openingStock,
      quarantine: {
        batchId: `Q-${HERO_RM.itemId}-01`,
        qty: HERO_RM.quarantineQty,
        receivedOn: addDays(HERO_RM.quarantineReleaseDate, -HERO_RM.qaQuarantineDays),
        expectedReleaseDate: HERO_RM.quarantineReleaseDate,
      },
    };
  }
  if (key === `${HERO_RM_TWIN.itemId}@${HERO_RM_TWIN.plantId}`) return { unrestricted: HERO_RM_TWIN.openingStock };
  if (key === `${HERO_PM.itemId}@${HERO_PM.plantId}`) return { unrestricted: HERO_PM.openingStock };
  return null;
}

/**
 * The made stages of the pinned chain hold nothing.
 *
 * A day of cover at an intermediate absorbs the first day of demand and shifts
 * everything below it, which is exactly the kind of quiet offset that stops the
 * worked example footing. They are lot-for-lot with no buffer and no production
 * offset, so demand passes through them unchanged — see `buildItemPlants`.
 */
const CHAIN_STAGE_COVER_DAYS: Record<string, number> = {
  [`${CHAIN_FG.soap.itemId}@${PILOT_PLANT}`]: 0,
  [`${CHAIN_FG.refill.itemId}@${PILOT_PLANT}`]: 0,
  [`${CHAIN_ITEMS.noodle.itemId}@${PILOT_PLANT}`]: 0,
  [`${CHAIN_ITEMS.blend.itemId}@${PILOT_PLANT}`]: 0,
};

// ---------------------------------------------------------------------------
// Open supply — and the adherence record every line carries from birth
// ---------------------------------------------------------------------------

function buildSupply(
  rng: Rng,
  items: Item[],
  itemPlants: ItemPlant[],
  itemVendors: ItemVendor[],
  consumption: Map<string, Consumption>
): SupplyElement[] {
  const supply: SupplyElement[] = [];
  const vendorFor = new Map<string, ItemVendor>();
  for (const row of itemVendors) if (row.isPrimary) vendorFor.set(`${row.itemId}@${row.plantId}`, row);
  const typeOf = new Map(items.map((item) => [item.id, item.type]));

  supply.push(heroOpenOrder());

  // The pinned chain's open supply is written, not drawn. A randomly sized
  // production order landing on a made stage suppresses that stage's planned
  // orders for the week it covers, and the requirement below it then arrives
  // as a hole — an artefact of the generator that would read as a fact of the
  // plan.
  const pinnedKeys = new Set([
    `${HERO_RM.itemId}@${HERO_RM.plantId}`,
    `${CHAIN_FG.soap.itemId}@${PILOT_PLANT}`,
    `${CHAIN_FG.refill.itemId}@${PILOT_PLANT}`,
    `${CHAIN_ITEMS.noodle.itemId}@${PILOT_PLANT}`,
    `${CHAIN_ITEMS.blend.itemId}@${PILOT_PLANT}`,
    // Hero B carries no incidental inbound either. Its whole worked example is
    // the schedule built for one campaign order, and a stray open delivery
    // landing mid-campaign makes the ideal-versus-committed comparison
    // impossible to follow without explaining the stray first.
    `${HERO_PM.itemId}@${HERO_PM.plantId}`,
  ]);

  for (const row of itemPlants) {
    const key = `${row.itemId}@${row.plantId}`;
    if (pinnedKeys.has(key)) continue;
    const used = consumption.get(key);
    if (!used || used.mean <= 0) continue;

    const isBought = typeOf.get(row.itemId) === 'RM' || typeOf.get(row.itemId) === 'PM';
    const leadTime = row.leadTimeDays ?? 14;

    // A material on a 90-day lead time already has roughly 90 days of
    // consumption on order — that is what a replenishment pipeline *is*.
    // Seeding a thin one makes every bought material read as late on day zero
    // and buries the one material whose lateness the demo is about.
    const pipelineDays = isBought ? leadTime * rng.float(0.8, 1.25) : rng.float(3, 8);
    const totalQty = used.mean * pipelineDays;
    if (totalQty <= 0) continue;
    if (!isBought && !rng.chance(0.45)) continue;

    const orders = isBought ? rng.int(2, 4) : 1;
    const perOrder = totalQty / orders;
    const vendor = vendorFor.get(key);

    for (let index = 0; index < orders; index += 1) {
      // Roughly one order in twelve is already past its date with nothing
      // received against it. Any real open book carries these, and a control
      // tower that reports none of them is reporting on a book nobody has.
      const overdue = index === 0 && rng.chance(0.085);
      const dueInDays = overdue
        ? -rng.int(3, 24)
        : Math.max(2, Math.round(((index + 1) / orders) * Math.max(leadTime, 6) * rng.float(0.6, 1.1)));
      const qty = Math.round(perOrder);
      if (qty <= 0) continue;

      const releaseDate = fromEpochDay(PLANNING_EPOCH + dueInDays - leadTime);
      supply.push({
        id: `${47_00000 + hashIndex(`${key}|${index}`, 99_999)}`,
        type: isBought ? 'PO' : 'PRODUCTION_ORDER',
        itemId: row.itemId,
        plantId: row.plantId,
        qty,
        dueDate: fromEpochDay(PLANNING_EPOCH + dueInDays),
        releaseDate,
        vendorId: isBought ? (vendor?.vendorId ?? null) : null,
        sourcePlantId: null,
        isFirm: true,
        sourceSystem: 'SAP',
        schedule: buildLines(rng, qty, dueInDays, releaseDate, isBought, overdue),
      });
    }
  }

  return supply;
}

/**
 * PO 4700221 — the order the hero's plan is leaning on.
 *
 * Line 10 is acknowledged and shipping. Line 20 is not acknowledged by anyone,
 * and it is the only thing standing between the plan and a stock-out. The
 * whole tiering rule exists so that difference is impossible to miss.
 */
function heroOpenOrder(): SupplyElement {
  const lines: DeliveryLine[] = HERO_RM.openPoLines.map((spec) => ({
    line: spec.line,
    qty: spec.qty,
    plannedDate: spec.requestedDate,
    // Acknowledged on the date it was asked for. The slip on this material is
    // in its history, not in the line it is currently leaning on — and mixing
    // the two would put a mid-week dip in front of the week the example is
    // actually about.
    confirmedDate: spec.confirmed ? spec.requestedDate : null,
    expectedDate: spec.requestedDate,
    status: spec.confirmed ? 'CONFIRMED' : 'PLANNED',
    releasedOn: addDays(spec.requestedDate, -HERO_RM.maintainedLeadTimeDays),
    acknowledgedOn: spec.confirmed
      ? addDays(spec.requestedDate, -HERO_RM.maintainedLeadTimeDays + HERO_RM.acknowledgementDays + 4)
      : null,
    dispatchedOn: null,
    grnDate: null,
    grnQty: null,
    qaReleasedOn: null,
    reasonCode: null,
    note: null,
  }));

  const totalQty = lines.reduce((sum, line) => sum + line.qty, 0);
  return {
    id: HERO_RM.openPoId,
    type: 'PO',
    itemId: HERO_RM.itemId,
    plantId: HERO_RM.plantId,
    qty: totalQty,
    dueDate: lines[lines.length - 1]?.plannedDate ?? SPEC.planningDate,
    releaseDate: lines[0]?.releasedOn ?? SPEC.planningDate,
    vendorId: HERO_RM.vendorId,
    sourcePlantId: null,
    isFirm: true,
    sourceSystem: 'SAP',
    schedule: lines,
  };
}

/**
 * Delivery buckets on an order already placed.
 *
 * Roughly a third of lines carry no vendor acknowledgement, which is what makes
 * the control tower's opening figure a real measurement rather than a slogan.
 */
function buildLines(
  rng: Rng,
  qty: number,
  dueInDays: number,
  releaseDate: string,
  isBought: boolean,
  overdue = false
): DeliveryLine[] {
  const count = isBought ? rng.weighted([1, 2, 3], [0.45, 0.37, 0.18]) : 1;
  const per = Math.floor(qty / count);
  const lines: DeliveryLine[] = [];

  for (let index = 0; index < count; index += 1) {
    const isLast = index === count - 1;
    const lineQty = isLast ? qty - per * (count - 1) : per;
    const offset = dueInDays - (count - 1 - index) * rng.int(5, 12);
    // An overdue line keeps its date in the past. Pulling it forward to today
    // is what makes a plan quietly count on supply that has not arrived.
    const plannedDate = fromEpochDay(PLANNING_EPOCH + (overdue ? offset : Math.max(1, offset)));

    const acknowledged = isBought ? rng.chance(0.64) : true;
    const slip = acknowledged && rng.chance(0.24) ? rng.int(2, 11) : 0;
    const confirmedDate = acknowledged ? addDays(plannedDate, slip) : null;
    const inTransit = acknowledged && offset <= 8;

    lines.push({
      line: (index + 1) * 10,
      qty: lineQty,
      plannedDate,
      confirmedDate,
      expectedDate: confirmedDate ?? plannedDate,
      status: !acknowledged ? 'PLANNED' : slip > 0 ? 'DELAYED' : inTransit ? 'IN_TRANSIT' : 'CONFIRMED',
      releasedOn: releaseDate,
      acknowledgedOn: acknowledged ? addDays(releaseDate, rng.int(1, 7)) : null,
      dispatchedOn: inTransit ? fromEpochDay(PLANNING_EPOCH - rng.int(0, 4)) : null,
      grnDate: null,
      grnQty: null,
      qaReleasedOn: null,
      reasonCode: slip > 0 ? rng.pick(['VESSEL_ROLL', 'VENDOR_CAPACITY', 'PORT_CONGESTION']) : null,
      note: null,
    });
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Receipt history — the evidence behind every measured lead time
// ---------------------------------------------------------------------------

/**
 * Eighteen months of purchase orders and goods receipts.
 *
 * The whole product argument rests on this: if lead times do not genuinely
 * reconstruct from here, there is nothing to measure. So receipts are generated
 * from each vendor's real profile, split across the four intervals that make up
 * a total lead time, and the total is computed from the dates rather than
 * written down beside them.
 */
function buildReceiptHistory(
  rng: Rng,
  itemPlants: ItemPlant[],
  itemVendors: ItemVendor[],
  items: Item[]
): ReceiptHistory[] {
  const history: ReceiptHistory[] = [];
  const typeOf = new Map(items.map((item) => [item.id, item.type]));
  const vendorsByKey = new Map<string, ItemVendor[]>();
  for (const row of itemVendors) {
    const list = vendorsByKey.get(`${row.itemId}@${row.plantId}`) ?? [];
    list.push(row);
    vendorsByKey.set(`${row.itemId}@${row.plantId}`, list);
  }

  const windowDays = SPEC.historyMonths * 30;

  for (const row of itemPlants) {
    const key = `${row.itemId}@${row.plantId}`;
    const type = typeOf.get(row.itemId);
    if (type !== 'RM' && type !== 'PM') continue;
    const vendors = vendorsByKey.get(key);
    if (!vendors || vendors.length === 0) continue;

    if (key === `${HERO_RM.itemId}@${HERO_RM.plantId}`) {
      history.push(...pinnedReceipts(HERO_RM, HERO_RM.observedTotalDays));
      continue;
    }
    if (key === `${HERO_RM_TWIN.itemId}@${HERO_RM_TWIN.plantId}`) {
      history.push(...pinnedReceipts(HERO_RM_TWIN, HERO_RM_TWIN.observedTotalDays));
      continue;
    }
    if (key === `${HERO_PM.itemId}@${HERO_PM.plantId}`) {
      history.push(...pinnedReceipts(HERO_PM, HERO_PM.observedTotalDays));
      continue;
    }

    const isDrifted = PACKAGING_DRIFT_KEYS.has(key);
    const count = rng.int(6, 14);

    for (let index = 0; index < count; index += 1) {
      const vendor = vendors[hashIndex(`${key}|${index}|vendor`, vendors.length)] as ItemVendor;
      const profile = VENDOR_PROFILES.get(vendor.vendorId) as VendorProfile;

      const mean = isDrifted ? PACKAGING_DRIFT.observedLeadTimeMean : profile.meanLeadTimeDays;
      const stdDev = isDrifted ? PACKAGING_DRIFT.observedLeadTimeStdDev : profile.stdDevDays;
      // Late-skewed, because supply is. A vessel can be a week late and cannot
      // be a week early; a symmetric distribution would put half the book ahead
      // of schedule and make the closed book meaningless.
      // Five days is the shortest total a four-interval split can carry and
      // still keep every boundary a day apart.
      // Floored just under the promise as well as skewed above it: a vendor
      // rarely beats their own date by much, because a plant that cannot
      // receive early turns the truck away.
      const drawn = Math.round(rng.normal(mean + stdDev * 0.85, stdDev));
      const total = Math.max(5, Math.round(mean - stdDev * 0.2), drawn);

      const receivedOffset = -rng.int(10, windowDays);
      const receivedOn = fromEpochDay(PLANNING_EPOCH + receivedOffset);
      const orderedOn = addDays(receivedOn, -total);

      const intervals = splitIntervals(total, vendor, row.grProcessingTimeDays + row.qaQuarantineDays);
      const orderedQty = Math.max(1, Math.round((row.minLotSize ?? 100) * rng.float(0.9, 2.4)));
      const fill = rng.chance(0.86) ? 1 : rng.float(0.88, 0.99);

      history.push({
        itemId: row.itemId,
        plantId: row.plantId,
        vendorId: vendor.vendorId,
        poId: `${47_00000 + hashIndex(`${key}|hist|${index}`, 99_999)}`,
        orderedOn,
        // What the vendor committed to, which is not what the material master
        // assumes. Measuring arrival against the maintained norm rather than
        // against the promise reports a supplier as early whenever the norm is
        // simply too long — which is the packaging block's whole problem, and
        // an entirely different finding from a supplier being reliable.
        promisedOn: addDays(orderedOn, Math.round(mean)),
        receivedOn: addDays(orderedOn, intervals.toGateIn),
        qty: Math.round(orderedQty * fill),
        orderedQty,
        actualLeadTimeDays: total,
        acknowledgedOn: addDays(orderedOn, intervals.response),
        dispatchedOn: addDays(orderedOn, intervals.response + intervals.readiness),
        qaReleasedOn: addDays(orderedOn, total),
        reasonCode:
          total > (row.leadTimeDays ?? total) + 5
            ? rng.pick(['VESSEL_ROLL', 'VENDOR_CAPACITY', 'PORT_CONGESTION', 'QUALITY_HOLD', 'PO_RAISED_LATE'])
            : null,
        // Roughly one receipt in twenty-five matches no delivery line — a
        // receipt against a cancelled line, a consolidated delivery, a batch
        // returned and reissued. They are kept, never dropped, and excluded
        // from lead-time reconstruction because they carry no reliable
        // ordered-on date.
        matchedLineId: rng.chance(0.96) ? `${key}#${index}` : null,
      });
    }
  }

  return history;
}

/**
 * Splits a total lead time across the four intervals, in the vendor's own
 * proportions.
 *
 * Every boundary is derived from the total rather than computed and rounded
 * independently, so the four intervals sum to the total exactly and the dates
 * always run in order: ordered, acknowledged, dispatched, gate-in, released.
 * Rounding three proportions separately and adding them up produces records
 * where a quality release precedes the goods receipt it follows — displayed
 * components that do not sum to the displayed total, which is the one thing
 * this product cannot do.
 */
function splitIntervals(
  total: number,
  vendor: ItemVendor,
  releaseTailDays: number
): { response: number; readiness: number; toGateIn: number } {
  // Gate-in to available is taken off the end first: it is the interval whose
  // length the plant controls and the one least distorted by a late vessel.
  const tail = clamp(releaseTailDays, 1, Math.max(total - 3, 1));
  const preGateIn = Math.max(total - tail, 3);

  const weightResponse = Math.max(vendor.acknowledgementDays, 0);
  const weightReadiness = Math.max(vendor.leadTimeDays, 0);
  const weightTransit = Math.max(vendor.transitDays + vendor.customsDays, 0);
  const weightTotal = Math.max(weightResponse + weightReadiness + weightTransit, 1);

  const response = clamp(Math.round((preGateIn * weightResponse) / weightTotal), 1, preGateIn - 2);
  const readiness = clamp(Math.round((preGateIn * weightReadiness) / weightTotal), 1, preGateIn - response - 1);
  // Transit is whatever is left, so the split always foots.
  return { response, readiness, toGateIn: preGateIn };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/**
 * The hero receipts, written exactly.
 *
 * The observed totals are the spec's; the interval split is derived from the
 * maintained chain's own proportions, with the overrun landing where it
 * actually lands on an import — some before the vendor is told, some at sea,
 * some at the dock. The four-interval decomposition then *measures* that split
 * rather than being handed it.
 */
function pinnedReceipts(hero: HeroSpec, totals: readonly number[]): ReceiptHistory[] {
  const rows: ReceiptHistory[] = [];
  const quoted = hero.maintainedLeadTimeDays;

  for (let index = 0; index < totals.length; index += 1) {
    const total = totals[index] as number;
    const overrun = total - quoted;

    // Where an import runs over, roughly a third of it is lost before the
    // vendor is even told and another sixth after the material has landed —
    // two-thirds of the slip belonging to the buyer rather than the supplier,
    // which is the finding this decomposition exists to produce.
    //
    // Transit is the residual, so the four intervals sum to the total exactly.
    // Rounding each of them independently puts gate-in after the quality
    // release it precedes, and a record that does not foot cannot be measured.
    const response = clamp(hero.acknowledgementDays + Math.round(overrun * 0.34), 1, total - 3);
    const readiness = clamp(hero.vendorReadinessDays + Math.round(overrun * 0.16), 1, total - response - 2);
    const releaseTail = clamp(
      hero.grProcessingTimeDays + hero.qaQuarantineDays + Math.round(overrun * 0.16),
      1,
      total - response - readiness - 1
    );
    // Transit is the residual, so the four intervals sum to the total exactly.
    const toGateIn = total - releaseTail;

    // Spaced backwards through the history window, most recent first.
    const receivedOn = fromEpochDay(PLANNING_EPOCH - 24 - index * 46);
    const orderedOn = addDays(receivedOn, -toGateIn);
    const qtyRequested = hero.moq;
    const fill = index % 4 === 1 ? 0.974 : 1;

    rows.push({
      itemId: hero.itemId,
      plantId: hero.plantId,
      vendorId: hero.vendorId,
      poId: `${4_700_180 + index * 7}`,
      orderedOn,
      promisedOn: addDays(orderedOn, quoted),
      receivedOn,
      qty: Math.round(qtyRequested * fill),
      orderedQty: qtyRequested,
      actualLeadTimeDays: total,
      acknowledgedOn: addDays(orderedOn, response),
      dispatchedOn: addDays(orderedOn, response + readiness),
      qaReleasedOn: addDays(orderedOn, total),
      reasonCode: overrun > 6 ? 'VESSEL_ROLL' : overrun < -2 ? null : 'PORT_CONGESTION',
      matchedLineId: `${hero.itemId}#${index}`,
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function stdDevOf(values: readonly number[], mean: number): number {
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.round(Math.sqrt(variance) * 10) / 10;
}

/** FNV-1a, so a label always maps to the same slot regardless of call order. */
function hashIndex(label: string, modulo: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < label.length; index += 1) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % Math.max(1, modulo);
}

// ---------------------------------------------------------------------------
// Last week's run — what the drift panel diffs against
// ---------------------------------------------------------------------------

/**
 * A single reason one material's position moved since the previous run.
 *
 * The direct answer to the parallel-spreadsheet problem. When a planner asks
 * "why does this look different from Friday?", the system has to answer with a
 * specific list of changes rather than a shrug — so the changes are modelled as
 * facts, and the *previous snapshot* is derived by undoing them. The drift
 * panel then compares two genuine planning runs rather than describing a
 * difference it was told about.
 */
export interface PlanChange {
  itemId: string;
  plantId: string;
  cause: 'DEMAND_CHANGED' | 'STOCK_CHANGED' | 'GRN_LANDED' | 'GRN_DID_NOT_LAND' | 'NORM_CHANGED' | 'PO_RESCHEDULED';
  detail: string;
}

export const CHANGE_CAUSE_LABEL: Record<PlanChange['cause'], string> = {
  DEMAND_CHANGED: 'Demand changed',
  STOCK_CHANGED: 'Stock changed',
  GRN_LANDED: 'A goods receipt landed',
  GRN_DID_NOT_LAND: 'A goods receipt did not land',
  NORM_CHANGED: 'A norm was changed',
  PO_RESCHEDULED: 'A purchase order was rescheduled',
};

/**
 * The snapshot as it stood at the previous run, with the changes that produced
 * today's.
 *
 * Built by inverting each change against the current snapshot rather than by
 * generating a second dataset: two independently generated datasets would
 * differ everywhere, and a drift panel listing four hundred materials is a
 * drift panel nobody reads.
 */
export function generatePreviousSnapshot(current: PlanningSnapshot): {
  snapshot: PlanningSnapshot;
  changes: PlanChange[];
} {
  const rng = streamFactory(SPEC.seed)('drift');
  const changes: PlanChange[] = [];

  const boughtKeys = current.itemPlants
    .filter((row) => row.procurementType === 'BUY' && row.plantId === PILOT_PLANT)
    .map((row) => `${row.itemId}@${row.plantId}`);
  const picked = new Set<string>();
  const pick = (): string | null => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const key = boughtKeys[rng.int(0, boughtKeys.length - 1)] as string;
      if (!picked.has(key)) {
        picked.add(key);
        return key;
      }
    }
    return null;
  };

  const demandChanged = new Map<string, number>();
  const stockChanged = new Map<string, number>();
  const normChanged = new Map<string, number>();
  const rescheduled = new Map<string, number>();
  const notLanded = new Set<string>();

  for (let index = 0; index < 6; index += 1) {
    const key = pick();
    if (key) demandChanged.set(key, rng.float(0.82, 0.94));
  }
  for (let index = 0; index < 5; index += 1) {
    const key = pick();
    if (key) stockChanged.set(key, rng.float(1.06, 1.3));
  }
  for (let index = 0; index < 2; index += 1) {
    const key = pick();
    if (key) normChanged.set(key, rng.float(0.7, 0.88));
  }

  // The hero's own story: a purchase-order line that has since been pushed out.
  // Last week the plan looked recoverable because that line sat two weeks
  // earlier than it does now.
  const heroKey = `${HERO_RM.itemId}@${HERO_RM.plantId}`;
  rescheduled.set(heroKey, 14);
  picked.add(heroKey);

  for (let index = 0; index < 4; index += 1) {
    const key = pick();
    if (key) rescheduled.set(key, rng.int(4, 12));
  }
  for (let index = 0; index < 3; index += 1) {
    const key = pick();
    if (key) notLanded.add(key);
  }

  const nameOf = new Map(current.items.map((item) => [item.id, item.description]));

  // ---- Demand: the previous run saw a smaller number ----------------------
  const demand = current.demand.map((element) => {
    const key = `${element.itemId}@${element.plantId}`;
    const factor = demandChanged.get(key);
    return factor === undefined ? element : { ...element, qty: Math.round(element.qty * factor) };
  });
  for (const [key, factor] of demandChanged) {
    const [itemId, plantId] = key.split('@') as [string, string];
    changes.push({
      itemId,
      plantId,
      cause: 'DEMAND_CHANGED',
      detail: `Requirement rose ${Math.round((1 / factor - 1) * 100)}% against last week's plan.`,
    });
  }

  // ---- Stock: what was counted then, against what is counted now ----------
  const stock = current.stock.map((position) => {
    const key = `${position.itemId}@${position.plantId}`;
    const factor = stockChanged.get(key);
    return factor === undefined ? position : { ...position, unrestricted: Math.round(position.unrestricted * factor) };
  });
  for (const [key, factor] of stockChanged) {
    const [itemId, plantId] = key.split('@') as [string, string];
    changes.push({
      itemId,
      plantId,
      cause: 'STOCK_CHANGED',
      detail: `On-hand is ${Math.round((1 - 1 / factor) * 100)}% lower than the previous run counted.`,
    });
  }

  // ---- Norms: a parameter somebody moved ----------------------------------
  const itemPlants = current.itemPlants.map((row) => {
    const key = `${row.itemId}@${row.plantId}`;
    const factor = normChanged.get(key);
    if (factor === undefined || row.safetyStock === null) return row;
    return { ...row, safetyStock: Math.round(row.safetyStock * factor) };
  });
  for (const [key] of normChanged) {
    const [itemId, plantId] = key.split('@') as [string, string];
    changes.push({ itemId, plantId, cause: 'NORM_CHANGED', detail: 'Safety stock was raised since the last run.' });
  }

  // ---- Supply: lines pushed out, and receipts that never arrived ----------
  const supply = current.supply.map((element) => {
    const key = `${element.itemId}@${element.plantId}`;
    const pushedBy = rescheduled.get(key);
    const missing = notLanded.has(key);
    if (pushedBy === undefined && !missing) return element;
    if (!element.schedule || element.schedule.length === 0) return element;

    const schedule = element.schedule.map((line, index) => {
      // The previous run saw the last line earlier than it now sits.
      if (pushedBy !== undefined && index === element.schedule!.length - 1) {
        const earlier = addDays(line.expectedDate, -pushedBy);
        return {
          ...line,
          plannedDate: earlier,
          expectedDate: earlier,
          confirmedDate: line.confirmedDate ? earlier : null,
        };
      }
      // And it expected a receipt that has since failed to arrive.
      if (missing && index === 0 && line.status !== 'RECEIVED') {
        return {
          ...line,
          status: 'CONFIRMED' as const,
          expectedDate: line.plannedDate,
          confirmedDate: line.plannedDate,
        };
      }
      return line;
    });
    return { ...element, schedule };
  });

  for (const [key, days] of rescheduled) {
    const [itemId, plantId] = key.split('@') as [string, string];
    changes.push({
      itemId,
      plantId,
      cause: 'PO_RESCHEDULED',
      detail: `A delivery line moved out ${days} days since the previous run.`,
    });
  }
  for (const key of notLanded) {
    const [itemId, plantId] = key.split('@') as [string, string];
    changes.push({
      itemId,
      plantId,
      cause: 'GRN_DID_NOT_LAND',
      detail: `A receipt the previous run counted on has still not arrived.`,
    });
  }

  void nameOf;
  return { snapshot: { ...current, demand, stock, supply, itemPlants }, changes };
}
