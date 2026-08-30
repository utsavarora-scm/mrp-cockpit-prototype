/**
 * Expands the soaps spec into a full planning snapshot.
 *
 * Everything is derived from one fixed seed, so the dataset is identical on
 * every machine and every run. The scripted demo scenarios are *planted as
 * facts* — a norm that was maintained in 2024 and never revisited, a vendor
 * whose receipts genuinely scatter across eleven days, three goods receipts
 * that genuinely match no delivery line — and the engines have to find them.
 * Nothing here injects a finding.
 *
 * Order matters. Demand and bills of material are built first, then exploded to
 * get each item-plant's true daily consumption, and only then are planning
 * parameters and opening positions sized against it. Generating norms from a
 * guess instead produces a dataset where nearly everything looks broken — which
 * is not realism, it is noise.
 */

import {
  addDays,
  fromEpochDay,
  toEpochDay,
  zScore,
  type BomLine,
  type Calendar,
  type Customer,
  type DemandElement,
  type Item,
  type ItemPlant,
  type ItemVendor,
  type Plant,
  type PlanningSnapshot,
  type ReceiptHistory,
  type StockPosition,
  type SupplyElement,
  type Vendor,
} from '@repo/domain';

import { streamFactory, type Rng } from '../prng';
import { DUAL_SOURCED, GCPL_SOAPS_SPEC, HERO, PACKAGING_DRIFT, type ItemArchetype } from './spec';

const SPEC = GCPL_SOAPS_SPEC;
const PLANNING_EPOCH = toEpochDay(SPEC.planningDate);

/**
 * Days of demand generated beyond the planning horizon.
 *
 * Coverage and norm calculations look forward from the last bucket, so a
 * horizon that stops dead at day 180 makes every material look like it falls
 * off a cliff on day 181.
 */
const DEMAND_TAIL_DAYS = 120;

/** How many items each archetype expands into, per item type. */
const COUNTS = { FG: 150, SFG: 35, RM: 70, PM: 120 } as const;

export const GCPL_SOAPS_COUNTS = COUNTS;

// ---------------------------------------------------------------------------

export function generateGcplSoapsSnapshot(): PlanningSnapshot {
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
  const receiptHistory = buildReceiptHistory(stream('receipts'), itemPlants, itemVendors);

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
    systemSnapshots: [],
  };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function buildItems(rng: Rng): Item[] {
  const items: Item[] = [];

  const expand = (archetypes: readonly ItemArchetype[], type: Item['type'], total: number, prefix: string): void => {
    const perArchetype = Math.ceil(total / archetypes.length);
    let made = 0;
    for (const archetype of archetypes) {
      for (let index = 0; index < perArchetype && made < total; index += 1, made += 1) {
        const variant = archetype.variants[index % archetype.variants.length] as string;
        const serial = String(index + 1).padStart(3, '0');
        const jitter = rng.float(0.88, 1.14);
        items.push({
          id: `${prefix}-${archetype.code}-${serial}`,
          description: `${archetype.name}, ${variant}`,
          type,
          baseUom: archetype.baseUom,
          abcClass: rng.weighted(['A', 'B', 'C'] as const, [0.2, 0.3, 0.5]),
          xyzClass: rng.weighted(['X', 'Y', 'Z'] as const, [0.35, 0.4, 0.25]),
          shelfLifeDays: archetype.shelfLifeDays,
          isPhantom: false,
          standardCost: round2(archetype.baseCost * jitter),
          createdOn: fromEpochDay(PLANNING_EPOCH - rng.int(400, 2_600)),
        });
      }
    }
  };

  expand(SPEC.fgArchetypes, 'FG', COUNTS.FG, 'FG');
  expand(SPEC.sfgArchetypes, 'SFG', COUNTS.SFG, 'SFG');
  expand(SPEC.rmArchetypes, 'RM', COUNTS.RM, 'RM');
  expand(SPEC.pmArchetypes, 'PM', COUNTS.PM, 'PM');

  // The hero is an A-class import held to a known standard cost — Brief A.1
  // prices its buffer at ₹95,000 per MT, and that figure has to be exact.
  const hero = items.find((item) => item.id === HERO.itemId);
  if (hero) {
    hero.standardCost = HERO.standardCost;
    hero.abcClass = 'A';
    hero.xyzClass = 'X';
    hero.description = 'Palm Fatty Acid Distillate, Imported';
  }

  return items;
}

// ---------------------------------------------------------------------------
// Bills of material — depth 3: FG → SFG → RM, with PM hung off the FG
// ---------------------------------------------------------------------------

function buildBoms(rng: Rng, items: Item[], plants: Plant[]): BomLine[] {
  const boms: BomLine[] = [];
  const fgs = items.filter((item) => item.type === 'FG');
  const sfgs = items.filter((item) => item.type === 'SFG');
  const rms = items.filter((item) => item.type === 'RM');
  const pms = items.filter((item) => item.type === 'PM');

  const validFrom = fromEpochDay(PLANNING_EPOCH - 900);
  const validTo = fromEpochDay(PLANNING_EPOCH + 900);

  const line = (parent: string, plantId: string, component: string, qtyPer: number, scrap: number): BomLine => ({
    parentItemId: parent,
    plantId,
    componentItemId: component,
    qtyPer,
    componentScrapPct: scrap,
    validFrom,
    validTo,
    alternateBomId: '1',
    isAlternate: false,
  });

  for (const plant of plants) {
    for (const fg of fgs) {
      if (!producesAt(fg, plant)) continue;

      // One semi-finished base, plus the packaging that wraps it. The hero's
      // own base is excluded from the general draw — see the pinned chain below.
      const generalBases = sfgs.filter((sfg) => !(plant.id === HERO.plantId && sfg.id === HERO_SFG));
      const base = generalBases[hashIndex(`${fg.id}-${plant.id}`, generalBases.length)] as Item;
      boms.push(line(fg.id, plant.id, base.id, 0.0001, rng.float(0.005, 0.02)));

      const packCount = rng.int(2, 4);
      for (let index = 0; index < packCount; index += 1) {
        const pm = pms[hashIndex(`${fg.id}-${plant.id}-pm${index}`, pms.length)] as Item;
        if (boms.some((b) => b.parentItemId === fg.id && b.plantId === plant.id && b.componentItemId === pm.id)) {
          continue;
        }
        boms.push(line(fg.id, plant.id, pm.id, pm.baseUom === 'EA' ? 1 : 0.00012, rng.float(0.005, 0.03)));
      }
    }

    for (const sfg of sfgs) {
      if (plant.type === 'COPACKER') continue;
      const rmCount = rng.int(2, 4);
      const generalRms = rms.filter(
        (rm) => !(plant.id === HERO.plantId && (rm.id === HERO.itemId || rm.id === DUAL_SOURCED.itemId))
      );
      for (let index = 0; index < rmCount; index += 1) {
        const rm = generalRms[hashIndex(`${sfg.id}-${plant.id}-rm${index}`, generalRms.length)] as Item;
        if (boms.some((b) => b.parentItemId === sfg.id && b.plantId === plant.id && b.componentItemId === rm.id)) {
          continue;
        }
        boms.push(line(sfg.id, plant.id, rm.id, rm.baseUom === 'MT' ? rng.float(0.15, 0.4) : rng.float(2, 9), 0.01));
      }
    }
  }

  // ---- The hero chain, pinned ---------------------------------------------
  // FG-BS-001 → SFG-SN-001 → RM-PD-001 at P1, with no scrap anywhere along it.
  // A linear chain with fixed factors means the daily consumption of the hero
  // is an exact multiple of the finished-goods plan, which is what lets Brief
  // A.1's 42 MT/day and 9 MT/day survive the explosion intact.
  const pinned = (parent: string, component: string, qtyPer: number): void => {
    const existing = boms.findIndex(
      (b) => b.parentItemId === parent && b.plantId === HERO.plantId && b.componentItemId === component
    );
    const row = line(parent, HERO.plantId, component, qtyPer, 0);
    if (existing >= 0) boms[existing] = row;
    else boms.push(row);
  };
  // Strip anything else that would dilute the chain's two levels at P1.
  for (let index = boms.length - 1; index >= 0; index -= 1) {
    const row = boms[index] as BomLine;
    if (row.plantId !== HERO.plantId) continue;
    if (row.parentItemId === HERO_FG || row.parentItemId === HERO_SFG) boms.splice(index, 1);
  }
  pinned(HERO_FG, HERO_SFG, 0.0001);
  pinned(HERO_SFG, HERO.itemId, 0.6);
  // The dual-sourced fragrance hangs off the same base, so it has real
  // consumption at P1 and therefore a real receipt history to reconstruct from.
  pinned(HERO_SFG, DUAL_SOURCED.itemId, 0.004);

  return boms;
}

/** The pinned Act 1 chain: FG → SFG → RM, all at one plant. */
const HERO_FG = 'FG-BS-001';
const HERO_SFG = 'SFG-SN-001';

/** Which plants make which finished goods — every plant runs a subset. */
function producesAt(fg: Item, plant: Plant): boolean {
  // The hero's finished good is single-sourced to its plant, so the whole of
  // its plan explodes onto the one item-plant Brief A.1 is written about.
  if (fg.id === HERO_FG) return plant.id === HERO.plantId;
  if (plant.type === 'COPACKER') return hashIndex(fg.id, 5) === 0;
  const index = hashIndex(fg.id, 10);
  if (plant.id === 'P1') return index < 4;
  if (plant.id === 'P2') return index >= 3 && index < 7;
  return index >= 6;
}

// ---------------------------------------------------------------------------
// Demand
// ---------------------------------------------------------------------------

function buildDemand(rng: Rng, items: Item[], plants: Plant[]): { demand: DemandElement[]; customers: Customer[] } {
  const customers: Customer[] = [
    { id: 'C-MT-01', name: 'Modern Trade Chain A', channel: 'MT', isKeyAccount: true },
    { id: 'C-MT-02', name: 'Modern Trade Chain B', channel: 'MT', isKeyAccount: false },
    { id: 'C-GT-01', name: 'General Trade Distributor North', channel: 'GT', isKeyAccount: false },
    { id: 'C-GT-02', name: 'General Trade Distributor West', channel: 'GT', isKeyAccount: true },
    { id: 'C-GT-03', name: 'General Trade Distributor South', channel: 'GT', isKeyAccount: false },
    { id: 'C-EC-01', name: 'E-commerce Marketplace', channel: 'ECOM', isKeyAccount: true },
    { id: 'C-EX-01', name: 'Export Partner Gulf', channel: 'EXPORT', isKeyAccount: false },
  ];

  const demand: DemandElement[] = [];
  const fgs = items.filter((item) => item.type === 'FG');
  const totalDays = SPEC.horizonDays + DEMAND_TAIL_DAYS;

  for (const plant of plants) {
    for (const fg of fgs) {
      if (!producesAt(fg, plant)) continue;
      const isHero = fg.id === HERO_FG && plant.id === HERO.plantId;

      // The hero chain runs flat by design. Act 1's argument is that the norm
      // is wrong because *lead time* moves — putting a demand shape on it would
      // muddy the one thing the act is trying to isolate.
      const baseDaily = isHero ? HERO_FG_DAILY_MEAN : rng.float(...SPEC.volumes.fgDailyRange);
      const dailyStdDev = isHero ? HERO_FG_DAILY_STDDEV : baseDaily * rng.float(0.12, 0.3);
      const heroSeries = isHero ? heroDailySeries(rng, totalDays) : null;

      for (let day = 0; day < totalDays; day += 1) {
        const date = fromEpochDay(PLANNING_EPOCH + day);
        const shape = isHero ? 1 : seasonalMultiplier(date);
        const qty = heroSeries ? (heroSeries[day] as number) : Math.max(0, rng.normal(baseDaily * shape, dailyStdDev));
        if (qty <= 0) continue;

        // Near-term demand is firm order, further out is forecast. The split is
        // what makes confirmed and planned supply mean different things.
        //
        // The hero's own plan is forecast throughout. Firm orders would consume
        // forecast in neighbouring buckets — correct MRP behaviour, and it would
        // quietly net away about 5% of the requirement, which is enough to move
        // Brief A.1's 42 MT/day off its stated figure. The confirmed-versus-
        // planned distinction the demo needs is carried by *supply*, not by this.
        const isFirm = !isHero && day < 21;
        const customer = customers[hashIndex(`${fg.id}-${plant.id}-${day}`, customers.length)] as Customer;
        demand.push({
          id: `${isFirm ? 'SO' : 'FC'}-${fg.id}-${plant.id}-${day}`,
          type: isFirm ? 'SALES_ORDER' : 'FORECAST',
          itemId: fg.id,
          plantId: plant.id,
          qty: isHero ? qty : Math.round(qty),
          requiredDate: date,
          customerId: isFirm ? customer.id : null,
          channel: customer.channel,
          marginPerUnit: round2(fg.standardCost * 0.28),
          pricePerUnit: round2(fg.standardCost * 1.55),
          priority: customer.isKeyAccount ? 2 : 5,
          parentSupplyElementId: null,
          sourceSystem: 'SAP',
        });
      }
    }
  }

  return { demand, customers };
}

/**
 * Finished-goods demand that makes the hero's consumption exact.
 *
 * The chain multiplies by 0.0001 MT of noodles per bar and then 0.6 MT of
 * distillate per MT of noodles, so a finished-goods plan of 700,000 ± 150,000
 * bars a day lands the hero at 42 ± 9 MT a day — Brief A.1's own figures.
 */
const HERO_FG_DAILY_MEAN = HERO.dailyDemandMean / (0.0001 * 0.6);
const HERO_FG_DAILY_STDDEV = HERO.dailyDemandStdDev / (0.0001 * 0.6);

/**
 * The hero's finished-goods plan, with its moments pinned.
 *
 * A sampled series lands within about 1% of its target mean, and 1% of 42 MT is
 * enough to move Brief A.1's arithmetic off the figures the appendix states. So
 * the draw is standardised and rescaled: the shape is still random and still
 * seeded, but the first horizon's mean and standard deviation are exactly the
 * ones the argument is built on. Everything downstream is then computed from
 * this series rather than written down beside it.
 */
function heroDailySeries(rng: Rng, totalDays: number): Float64Array {
  const raw = new Float64Array(totalDays);
  for (let day = 0; day < totalDays; day += 1) raw[day] = rng.normal(0, 1);

  // Standardise over the planning horizon — the window the plan actually reads.
  const window = SPEC.horizonDays;
  let sum = 0;
  for (let day = 0; day < window; day += 1) sum += raw[day] as number;
  const mean = sum / window;
  let variance = 0;
  for (let day = 0; day < window; day += 1) variance += ((raw[day] as number) - mean) ** 2;
  const sd = Math.sqrt(variance / window) || 1;

  const series = new Float64Array(totalDays);
  for (let day = 0; day < totalDays; day += 1) {
    const z = ((raw[day] as number) - mean) / sd;
    series[day] = Math.max(0, HERO_FG_DAILY_MEAN + z * HERO_FG_DAILY_STDDEV);
  }
  return series;
}

function seasonalMultiplier(isoDate: string): number {
  const month = Number(isoDate.slice(5, 7)) - 1;
  return SPEC.seasonality.monthly[month] ?? 1;
}

// ---------------------------------------------------------------------------
// Consumption — one explosion pass, so parameters can be sized against reality
// ---------------------------------------------------------------------------

interface Consumption {
  /** Mean units consumed per day across the generated window. */
  mean: number;
  /** Standard deviation of that daily series. */
  stdDev: number;
}

function explodeToDailyConsumption(
  items: Item[],
  boms: BomLine[],
  demand: DemandElement[],
  plants: Plant[]
): Map<string, Consumption> {
  const totalDays = SPEC.horizonDays + DEMAND_TAIL_DAYS;
  const series = new Map<string, Float64Array>();
  const keyOf = (itemId: string, plantId: string): string => `${itemId}@${plantId}`;

  const seriesFor = (itemId: string, plantId: string): Float64Array => {
    const key = keyOf(itemId, plantId);
    let found = series.get(key);
    if (!found) {
      found = new Float64Array(totalDays);
      series.set(key, found);
    }
    return found;
  };

  for (const element of demand) {
    const day = toEpochDay(element.requiredDate) - PLANNING_EPOCH;
    if (day < 0 || day >= totalDays) continue;
    const target = seriesFor(element.itemId, element.plantId);
    target[day] = (target[day] as number) + element.qty;
  }

  // FG → SFG → RM/PM, level by level. Depth is three, so two passes suffice.
  const byParent = new Map<string, BomLine[]>();
  for (const row of boms) {
    const key = keyOf(row.parentItemId, row.plantId);
    const bucket = byParent.get(key);
    if (bucket) bucket.push(row);
    else byParent.set(key, [row]);
  }

  const typeOf = new Map(items.map((item) => [item.id, item.type]));
  for (const level of ['FG', 'SFG'] as const) {
    for (const plant of plants) {
      for (const item of items) {
        if (typeOf.get(item.id) !== level) continue;
        const source = series.get(keyOf(item.id, plant.id));
        if (!source) continue;
        const lines = byParent.get(keyOf(item.id, plant.id));
        if (!lines) continue;
        for (const row of lines) {
          const factor =
            row.qtyPer / (row.componentScrapPct > 0 && row.componentScrapPct < 1 ? 1 - row.componentScrapPct : 1);
          const target = seriesFor(row.componentItemId, plant.id);
          for (let day = 0; day < totalDays; day += 1) {
            target[day] = (target[day] as number) + (source[day] as number) * factor;
          }
        }
      }
    }
  }

  const consumption = new Map<string, Consumption>();
  for (const [key, values] of series) {
    let total = 0;
    for (let day = 0; day < totalDays; day += 1) total += values[day] as number;
    const mean = total / totalDays;
    let variance = 0;
    for (let day = 0; day < totalDays; day += 1) variance += ((values[day] as number) - mean) ** 2;
    consumption.set(key, { mean, stdDev: Math.sqrt(variance / totalDays) });
  }

  return consumption;
}

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

interface VendorProfile {
  vendorId: string;
  meanLeadTimeDays: number;
  stdDevDays: number;
  isImport: boolean;
}

/** Vendor lead-time profiles, keyed by vendor id — the receipt generator's source of truth. */
const VENDOR_PROFILES = new Map<string, VendorProfile>();

function buildVendors(rng: Rng, items: Item[], plants: Plant[]): { vendors: Vendor[]; itemVendors: ItemVendor[] } {
  const vendors: Vendor[] = [];
  VENDOR_PROFILES.clear();

  const pools = [
    { ...SPEC.vendors.import, label: 'Import Oleochemical Supplier', isImport: true },
    { ...SPEC.vendors.domesticChemical, label: 'Domestic Chemical Supplier', isImport: false },
    { ...SPEC.vendors.packaging, label: 'Packaging Converter', isImport: false },
    { ...SPEC.vendors.contract, label: 'Contract Processor', isImport: false },
  ];

  for (const pool of pools) {
    for (let index = 1; index <= pool.count; index += 1) {
      const vendorId = `${pool.prefix}-${String(index).padStart(2, '0')}`;
      const mean = rng.float(pool.leadTimeRange[0], pool.leadTimeRange[1]);
      const stdDev = rng.float(pool.stdDevRange[0], pool.stdDevRange[1]);
      VENDOR_PROFILES.set(vendorId, { vendorId, meanLeadTimeDays: mean, stdDevDays: stdDev, isImport: pool.isImport });
      vendors.push({
        id: vendorId,
        name: `${pool.label} ${index}`,
        reliabilityScore: round2(Math.max(0.55, Math.min(0.98, 1 - stdDev / 40))),
      });
    }
  }

  // ---- Planted profiles ----------------------------------------------------
  // The hero's vendor: 47 days on average, swinging 11. Written here rather than
  // drawn, because Brief A.1's whole argument rests on these two numbers.
  VENDOR_PROFILES.set(HERO.vendorId, {
    vendorId: HERO.vendorId,
    meanLeadTimeDays: 47,
    stdDevDays: 11,
    isImport: true,
  });
  for (const side of [DUAL_SOURCED.primary, DUAL_SOURCED.secondary]) {
    VENDOR_PROFILES.set(side.vendorId, {
      vendorId: side.vendorId,
      meanLeadTimeDays: side.meanDays,
      stdDevDays: side.stdDevDays,
      isImport: true,
    });
  }

  const itemVendors: ItemVendor[] = [];
  const buyables = items.filter((item) => item.type === 'RM' || item.type === 'PM');
  const importPool = [...VENDOR_PROFILES.values()].filter((profile) => profile.isImport);
  const domesticPool = [...VENDOR_PROFILES.values()].filter((profile) => !profile.isImport);

  for (const plant of plants) {
    for (const item of buyables) {
      if (!sourcedAt(item, plant)) continue;
      const imported = item.description.includes('Imported');
      const pool = imported ? importPool : domesticPool;
      const profile = pool[hashIndex(`${item.id}-${plant.id}`, pool.length)] as VendorProfile;

      itemVendors.push(makeItemVendor(rng, item, plant, profile, { isPrimary: true, share: 1 }));
    }
  }

  // ---- The dual-sourced material, 60/40 -----------------------------------
  // A vendor reliable on one material is frequently unreliable on another, and
  // a single blended score hides exactly the variance the norms engine needs.
  const dual = items.find((item) => item.id === DUAL_SOURCED.itemId);
  const dualPlant = plants.find((plant) => plant.id === DUAL_SOURCED.plantId);
  if (dual && dualPlant) {
    for (let index = itemVendors.length - 1; index >= 0; index -= 1) {
      const row = itemVendors[index] as ItemVendor;
      if (row.itemId === dual.id && row.plantId === dualPlant.id) itemVendors.splice(index, 1);
    }
    for (const [side, isPrimary] of [
      [DUAL_SOURCED.primary, true],
      [DUAL_SOURCED.secondary, false],
    ] as const) {
      const profile = VENDOR_PROFILES.get(side.vendorId) as VendorProfile;
      itemVendors.push(makeItemVendor(rng, dual, dualPlant, profile, { isPrimary, share: side.share }));
    }
  }

  // ---- The hero's supply relationship -------------------------------------
  const hero = items.find((item) => item.id === HERO.itemId);
  const heroPlant = plants.find((plant) => plant.id === HERO.plantId);
  if (hero && heroPlant) {
    for (let index = itemVendors.length - 1; index >= 0; index -= 1) {
      const row = itemVendors[index] as ItemVendor;
      if (row.itemId === hero.id && row.plantId === heroPlant.id) itemVendors.splice(index, 1);
    }
    itemVendors.push({
      itemId: hero.id,
      plantId: heroPlant.id,
      vendorId: HERO.vendorId,
      isPrimary: true,
      leadTimeDays: HERO.maintainedOrderDays,
      moq: HERO.moq,
      incrementQty: HERO.incrementQty,
      unitPrice: HERO.standardCost,
      dailyCapacity: null,
      expediteAvailable: false,
      expediteLeadTimeDays: null,
      expediteUnitPriceUplift: null,
      allocationShare: 1,
      maxShipmentQty: HERO.maxShipmentQty,
      transitDays: HERO.transitDays,
      earliestDispatchDays: HERO.earliestDispatchDays,
      isImport: true,
    });
  }

  return { vendors, itemVendors };
}

function makeItemVendor(
  rng: Rng,
  item: Item,
  plant: Plant,
  profile: VendorProfile,
  allocation: { isPrimary: boolean; share: number }
): ItemVendor {
  const bulk = item.baseUom === 'MT';
  const moq = bulk ? rng.pick([20, 40, 60, 100]) : rng.pick([5_000, 10_000, 20_000, 50_000]);
  return {
    itemId: item.id,
    plantId: plant.id,
    vendorId: profile.vendorId,
    isPrimary: allocation.isPrimary,
    leadTimeDays: Math.round(profile.meanLeadTimeDays),
    moq,
    incrementQty: bulk ? rng.pick([5, 10, 20]) : rng.pick([500, 1_000, 2_500]),
    unitPrice: round2(item.standardCost * rng.float(0.94, 1.05)),
    dailyCapacity: null,
    expediteAvailable: !profile.isImport && rng.chance(0.4),
    expediteLeadTimeDays: null,
    expediteUnitPriceUplift: null,
    allocationShare: allocation.share,
    maxShipmentQty: bulk ? rng.pick([200, 400, 600]) : rng.pick([100_000, 250_000, 500_000]),
    transitDays: profile.isImport ? rng.int(8, 16) : rng.int(1, 4),
    earliestDispatchDays: profile.isImport ? rng.int(10, 20) : rng.int(2, 7),
    isImport: profile.isImport,
  };
}

/** Which plants buy which materials — packaging is local, oleochemicals are not. */
function sourcedAt(item: Item, plant: Plant): boolean {
  if (plant.type === 'COPACKER') return item.type === 'PM' && hashIndex(item.id, 4) === 0;
  return true;
}

// ---------------------------------------------------------------------------
// Planning master
// ---------------------------------------------------------------------------

/**
 * The packaging item-plants maintained at 45 days against an 18-day reality.
 *
 * Recorded as the master is built so the receipt generator can give them a
 * history that genuinely reconstructs to 18 days. Planting the *maintained*
 * number without planting the evidence would be asserting the finding rather
 * than computing it.
 */
const PACKAGING_DRIFT_KEYS = new Set<string>();

function buildItemPlants(
  rng: Rng,
  items: Item[],
  plants: Plant[],
  itemVendors: ItemVendor[],
  consumption: Map<string, Consumption>
): ItemPlant[] {
  const itemPlants: ItemPlant[] = [];
  PACKAGING_DRIFT_KEYS.clear();

  const vendorFor = new Map<string, ItemVendor>();
  for (const row of itemVendors) {
    if (row.isPrimary) vendorFor.set(`${row.itemId}@${row.plantId}`, row);
  }

  const packagingCandidates: string[] = [];

  for (const plant of plants) {
    for (const item of items) {
      const key = `${item.id}@${plant.id}`;
      const used = consumption.get(key);
      const isMade = item.type === 'FG' || item.type === 'SFG';
      if (isMade && !producesAt(item, plant) && item.type === 'FG') continue;
      if (!used || used.mean <= 0) continue;

      const vendor = vendorFor.get(key);
      const procurementType: ItemPlant['procurementType'] = isMade ? 'MAKE' : 'BUY';
      const leadTimeDays = isMade ? rng.int(2, 6) : (vendor?.leadTimeDays ?? rng.int(10, 30));

      // Maintained norms are set the way a category manager sets them: lead
      // time plus a round-number cushion, and then never revisited.
      const maintainedOrderDays = leadTimeDays + rng.pick([0, 3, 5, 7]);
      const maintainedStockDays = rng.pick([15, 20, 30, 45, 60]);
      const serviceLevel = item.abcClass === 'A' ? 0.975 : item.abcClass === 'B' ? 0.95 : 0.9;

      // Sized the way it was almost certainly sized in the first place: as
      // though lead time never moved. That understatement is the finding.
      const naiveSafety = zScore(serviceLevel) * used.stdDev * Math.sqrt(Math.max(leadTimeDays, 1));

      itemPlants.push({
        itemId: item.id,
        plantId: plant.id,
        mrpType: 'PD',
        procurementType,
        lotSizeRule: rng.weighted(['LFL', 'FOQ', 'POQ', 'EOQ'] as const, [0.2, 0.35, 0.3, 0.15]),
        fixedLotSize: null,
        minLotSize: vendor?.moq ?? null,
        maxLotSize: null,
        roundingValue: vendor?.incrementQty ?? null,
        periodsOfSupplyDays: rng.pick([7, 14, 21]),
        reorderPoint: null,
        leadTimeDays,
        grProcessingTimeDays: item.type === 'RM' ? 2 : 1,
        safetyStock: Math.round(naiveSafety),
        safetyTimeDays: 0,
        scrapPct: 0,
        serviceLevelTarget: serviceLevel,
        plannerCode: `PLN-${hashIndex(item.id, 8) + 1}`,
        sourcePlantId: null,
        isPlanningRelevant: true,
        paramsLastChangedOn: fromEpochDay(PLANNING_EPOCH - rng.int(200, 1_200)),
        storageCapacity: Math.round(used.mean * rng.float(20, 45)),
        dailyReceivingCapacity: Math.round(used.mean * rng.float(2.5, 6)),
        maintainedStockDays,
        maintainedOrderDays,
        campaignCycleDays: isMade ? rng.pick([7, 14, 21]) : null,
      });

      if (item.type === 'PM' && plant.type === 'OWN') packagingCandidates.push(key);
    }
  }

  const byKey = new Map(itemPlants.map((row) => [`${row.itemId}@${row.plantId}`, row]));

  // ---- Scenario: 40 packaging materials at 45 days against an 18-day reality
  // This is what generates the cockpit's excess-capital hero at 0:00. Without
  // it, the biggest number on the landing screen has nothing behind it.
  for (const key of packagingCandidates.sort().slice(0, PACKAGING_DRIFT.count)) {
    const row = byKey.get(key);
    if (!row) continue;
    row.maintainedStockDays = PACKAGING_DRIFT.maintainedStockDays;
    row.maintainedOrderDays = PACKAGING_DRIFT.maintainedStockDays;
    row.leadTimeDays = PACKAGING_DRIFT.maintainedStockDays;
    row.paramsLastChangedOn = '2023-11-02';
    PACKAGING_DRIFT_KEYS.add(key);
  }

  // ---- Scenario: the hero, maintained in March 2024 and never revisited ----
  const hero = byKey.get(`${HERO.itemId}@${HERO.plantId}`);
  if (hero) {
    // Sized the way Brief A.1 reconstructs it: the naive formula, evaluated at
    // the lead time the vendor actually runs at, with lead time treated as
    // fixed. That is 121 MT — and the combined formula's 914 MT is 7.6× it.
    // Sizing on the *maintained* 45 days instead would give 118 MT and quietly
    // move the ratio the demo quotes.
    const observedMean =
      HERO.observedLeadTimes.reduce((total, value) => total + value, 0) / HERO.observedLeadTimes.length;
    const naive = zScore(HERO.serviceLevelTarget) * HERO.dailyDemandStdDev * Math.sqrt(observedMean);
    hero.leadTimeDays = HERO.maintainedOrderDays;
    hero.maintainedOrderDays = HERO.maintainedOrderDays;
    hero.maintainedStockDays = HERO.maintainedStockDays;
    hero.safetyStock = Math.round(naive);
    hero.serviceLevelTarget = HERO.serviceLevelTarget;
    hero.paramsLastChangedOn = HERO.paramsLastChangedOn;
    hero.storageCapacity = HERO.storageCapacity;
    hero.dailyReceivingCapacity = HERO.dailyReceivingCapacity;
    hero.minLotSize = HERO.moq;
    hero.roundingValue = HERO.incrementQty;
    hero.lotSizeRule = 'POQ';
    hero.campaignCycleDays = null;
    hero.grProcessingTimeDays = 2;
  }

  return itemPlants;
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
  const typeOf = new Map(items.map((item) => [item.id, item.type]));
  const stock: StockPosition[] = [];

  for (const row of itemPlants) {
    const key = `${row.itemId}@${row.plantId}`;
    const used = consumption.get(key);
    if (!used) continue;

    // Bought-in materials are held against the maintained norm, which is the
    // whole problem: the norm is wrong, so the position inherits the error in
    // both directions. Made items turn far faster and are not what the norms
    // argument is about, so they are held to a realistic few days instead.
    const type = typeOf.get(row.itemId);
    const targetDays =
      type === 'FG'
        ? rng.float(...SPEC.volumes.fgStockDaysRange)
        : type === 'SFG'
          ? rng.float(...SPEC.volumes.sfgStockDaysRange)
          : (row.maintainedStockDays ?? 30) * rng.float(...SPEC.volumes.boughtStockDaysMultiplier);
    const unrestricted = Math.max(0, used.mean * targetDays);

    stock.push({
      itemId: row.itemId,
      plantId: row.plantId,
      unrestricted: round2(unrestricted),
      blocked: round2(unrestricted * rng.float(0, 0.03)),
      qualityInspection: round2(unrestricted * rng.float(0, 0.05)),
      inTransit: round2(unrestricted * rng.float(0, 0.18)),
      batches: [],
    });
  }

  // The hero is short: an import on a 47-day lead time held against a norm
  // sized as though it were 45 and steady. Act 1 opens on the consequence.
  const hero = stock.find((row) => row.itemId === HERO.itemId && row.plantId === HERO.plantId);
  if (hero) {
    hero.unrestricted = round2(HERO.dailyDemandMean * 11);
    hero.inTransit = round2(HERO.dailyDemandMean * 4);
    hero.blocked = 0;
    hero.qualityInspection = 0;
  }

  return stock;
}

function buildSupply(
  rng: Rng,
  items: Item[],
  itemPlants: ItemPlant[],
  itemVendors: ItemVendor[],
  consumption: Map<string, Consumption>
): SupplyElement[] {
  const supply: SupplyElement[] = [];
  const vendorFor = new Map<string, ItemVendor>();
  for (const row of itemVendors) {
    if (row.isPrimary) vendorFor.set(`${row.itemId}@${row.plantId}`, row);
  }
  const typeOf = new Map(items.map((item) => [item.id, item.type]));

  for (const row of itemPlants) {
    const key = `${row.itemId}@${row.plantId}`;
    const used = consumption.get(key);
    if (!used || used.mean <= 0) continue;
    if (!rng.chance(0.55)) continue;

    const orders = rng.int(1, 3);
    for (let index = 0; index < orders; index += 1) {
      const dueInDays = rng.int(2, 70);
      const qty = Math.round(used.mean * rng.float(8, 28));
      if (qty <= 0) continue;
      const vendor = vendorFor.get(key);
      const isBought = typeOf.get(row.itemId) === 'RM' || typeOf.get(row.itemId) === 'PM';

      supply.push({
        id: `PO-${row.itemId}-${row.plantId}-${index}`,
        type: isBought ? 'PO' : 'PRODUCTION_ORDER',
        itemId: row.itemId,
        plantId: row.plantId,
        qty,
        dueDate: fromEpochDay(PLANNING_EPOCH + dueInDays),
        releaseDate: fromEpochDay(PLANNING_EPOCH + dueInDays - (row.leadTimeDays ?? 14)),
        vendorId: isBought ? (vendor?.vendorId ?? null) : null,
        sourcePlantId: null,
        isFirm: true,
        sourceSystem: 'SAP',
        schedule: buildLines(rng, qty, dueInDays),
      });
    }
  }

  return supply;
}

/**
 * Delivery buckets on an existing order.
 *
 * These are the *seeded* schedules on orders already placed. The engine does
 * not solve for them — that is the scheduling engine's job, and it arrives in
 * Checkpoint B.
 */
function buildLines(rng: Rng, qty: number, dueInDays: number): SupplyElement['schedule'] {
  const count = rng.weighted([1, 2, 3], [0.5, 0.35, 0.15]);
  const per = Math.floor(qty / count);
  const lines: NonNullable<SupplyElement['schedule']> = [];

  for (let index = 0; index < count; index += 1) {
    const isLast = index === count - 1;
    const lineQty = isLast ? qty - per * (count - 1) : per;
    const offset = dueInDays - (count - 1 - index) * rng.int(5, 12);
    const plannedDate = fromEpochDay(PLANNING_EPOCH + Math.max(1, offset));
    const confirmed = rng.chance(0.62);
    const slip = confirmed && rng.chance(0.22) ? rng.int(2, 9) : 0;

    lines.push({
      line: index + 1,
      qty: lineQty,
      plannedDate,
      confirmedDate: confirmed ? addDays(plannedDate, slip) : null,
      expectedDate: confirmed ? addDays(plannedDate, slip) : plannedDate,
      status: !confirmed ? 'PLANNED' : slip > 0 ? 'DELAYED' : offset < 8 ? 'IN_TRANSIT' : 'CONFIRMED',
    });
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Receipt history — the evidence every norm recommendation has to name
// ---------------------------------------------------------------------------

/**
 * Purchase orders and goods receipts across the last twenty-four months.
 *
 * This is the dataset the whole product argument rests on: if lead times do not
 * genuinely reconstruct from here, the norms thesis has nothing to stand on. So
 * the receipts are generated from each vendor's real profile and the observed
 * lead time is computed from the dates, never written down beside them.
 */
function buildReceiptHistory(rng: Rng, itemPlants: ItemPlant[], itemVendors: ItemVendor[]): ReceiptHistory[] {
  const history: ReceiptHistory[] = [];
  const historyDays = SPEC.historyMonths * 30;

  const vendorsFor = new Map<string, ItemVendor[]>();
  for (const row of itemVendors) {
    const key = `${row.itemId}@${row.plantId}`;
    const bucket = vendorsFor.get(key);
    if (bucket) bucket.push(row);
    else vendorsFor.set(key, [row]);
  }

  const push = (
    itemId: string,
    plantId: string,
    vendorId: string,
    poId: string,
    orderedEpoch: number,
    leadTimeDays: number,
    promisedDays: number,
    qty: number
  ): void => {
    const receivedOn = fromEpochDay(orderedEpoch + leadTimeDays);
    history.push({
      itemId,
      plantId,
      vendorId,
      poId,
      orderedOn: fromEpochDay(orderedEpoch),
      promisedOn: fromEpochDay(orderedEpoch + promisedDays),
      receivedOn,
      qty,
      // Computed from the dates, never asserted alongside them.
      actualLeadTimeDays: toEpochDay(receivedOn) - orderedEpoch,
    });
  };

  for (const row of itemPlants) {
    const key = `${row.itemId}@${row.plantId}`;
    if (row.procurementType !== 'BUY') continue;
    const sources = vendorsFor.get(key);
    if (!sources || sources.length === 0) continue;
    if (key === `${HERO.itemId}@${HERO.plantId}`) continue;

    const isDrifted = PACKAGING_DRIFT_KEYS.has(key);
    const receiptCount = isDrifted ? rng.int(9, 16) : rng.int(6, 14);

    for (const vendor of sources) {
      const profile = VENDOR_PROFILES.get(vendor.vendorId);
      if (!profile) continue;

      // Volume follows the allocation split, so a 60/40 material genuinely has
      // more evidence behind its primary vendor than its secondary.
      const share = vendor.allocationShare;
      const count = Math.max(3, Math.round(receiptCount * share));

      const mean = isDrifted ? PACKAGING_DRIFT.observedLeadTimeMean : profile.meanLeadTimeDays;
      const stdDev = isDrifted ? PACKAGING_DRIFT.observedLeadTimeStdDev : profile.stdDevDays;

      for (let index = 0; index < count; index += 1) {
        const orderedEpoch = PLANNING_EPOCH - rng.int(30, historyDays);
        const actual = Math.max(1, Math.round(rng.normal(mean, stdDev)));
        push(
          row.itemId,
          row.plantId,
          vendor.vendorId,
          `POH-${row.itemId}-${row.plantId}-${vendor.vendorId}-${index}`,
          orderedEpoch,
          actual,
          Math.round(mean),
          Math.round((row.minLotSize ?? 100) * rng.float(1, 3))
        );
      }
    }
  }

  // ---- The hero's receipts, written exactly -------------------------------
  // Fourteen matched receipts whose mean is 47.0 days and whose population
  // standard deviation is 11.0 — the two numbers Brief A.1's entire argument
  // rests on. Spread across the last eighteen months, most recent first.
  const heroDates: number[] = [];
  for (let index = 0; index < HERO.observedLeadTimes.length; index += 1) {
    heroDates.push(PLANNING_EPOCH - 40 - index * 37);
  }
  HERO.observedLeadTimes.forEach((leadTime, index) => {
    push(
      HERO.itemId,
      HERO.plantId,
      HERO.vendorId,
      `POH-${HERO.itemId}-${String(index + 1).padStart(2, '0')}`,
      heroDates[index] as number,
      leadTime,
      HERO.maintainedOrderDays,
      500
    );
  });

  // Three receipts that will match no delivery line — a receipt against a
  // cancelled line, a consolidated delivery, a returned-and-reissued batch.
  // Roughly 4% of any real feed fails to match, and an unmatched queue with
  // nothing in it demonstrates nothing. These are excluded from the
  // reconstruction, which is why seventeen are seeded to yield fourteen.
  HERO.unmatchedLeadTimes.forEach((leadTime, index) => {
    push(
      HERO.itemId,
      HERO.plantId,
      HERO.vendorId,
      `GRN-UNMATCHED-${String(index + 1).padStart(2, '0')}`,
      PLANNING_EPOCH - 62 - index * 91,
      leadTime,
      HERO.maintainedOrderDays,
      480
    );
  });

  return history;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Stable index from a string, so structure does not shift when tuning volumes. */
function hashIndex(label: string, modulo: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < label.length; index += 1) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % modulo;
}
