/**
 * Expands the confectionery spec into a full planning snapshot.
 *
 * Everything is derived from one fixed seed, so the dataset is identical on
 * every machine and every run. The scripted demo scenarios are *planted as
 * facts* — a lead time that was maintained years ago, a batch with a real expiry
 * date, an item that genuinely has no planning master — and the engine has to
 * detect them on its own. Nothing here injects an exception row.
 *
 * Order matters. Demand and bills of material are built first, then exploded to
 * get each item-plant's true daily consumption, and only then are planning
 * parameters and opening positions sized against it. Generating lot sizes and
 * safety stocks from a guess instead produces a dataset where nearly everything
 * looks broken — which is not realism, it is noise.
 */

import {
  addDays,
  fromEpochDay,
  startOfWeek,
  toEpochDay,
  zScore,
  type BomLine,
  type Calendar,
  type Customer,
  type DemandElement,
  type Item,
  type ItemPlant,
  type ItemRouting,
  type ItemVendor,
  type LotSizeRule,
  type Plant,
  type PlanningSnapshot,
  type ReceiptHistory,
  type Resource,
  type StockPosition,
  type SubstituteItem,
  type SupplyElement,
  type SystemSnapshot,
  type Vendor,
} from '@repo/domain';

import { attachDeliverySchedules } from '../delivery-schedule';
import { streamFactory, type Rng } from '../prng';
import { CONFECTIONERY_SPEC } from './spec';

const SPEC = CONFECTIONERY_SPEC;

/** Items per archetype, chosen so the planted identifiers exist. */
const RM_COUNTS: Record<string, number> = {
  CL: 12,
  CB: 12,
  CP: 10,
  SG: 12,
  SM: 10,
  WM: 10,
  PO: 10,
  SS: 8,
  LE: 8,
  LS: 6,
  AL: 10,
  PN: 8,
  HP: 6,
  GS: 8,
  IS: 6,
  WP: 8,
  VF: 6,
  SL: 6,
  CA: 6,
  WT: 8,
};
const PM_COUNTS: Record<string, number> = {
  WF: 30,
  CT: 24,
  CG: 18,
  LB: 16,
  LM: 14,
  TR: 12,
  RB: 10,
  TN: 10,
  SH: 10,
  IN: 6,
};
const SFG_COUNTS: Record<string, number> = {
  CM: 18,
  CD: 16,
  CW: 12,
  CC: 12,
  CR: 14,
  PP: 10,
  NG: 10,
  WS: 10,
  CI: 8,
  FC: 10,
};

/**
 * Distinguishing qualifiers appended when an archetype has more items than
 * variants. Without them, repeats read as near-identical descriptions and the
 * duplicate detector fires on hundreds of items that are not duplicates.
 */
const SPEC_QUALIFIERS = ['', ' — West African Origin', ' — South American Origin', ' — Domestic Origin'];

const FG_PLANTS = ['P1', 'P2', 'P3', 'CP1', 'CP2'] as const;
const SFG_PLANTS = ['P1', 'P2', 'P3'] as const;
const PRODUCTION_PLANTS = ['P1', 'P2', 'P3', 'CP1', 'CP2'] as const;

/** Days of finished-goods forecast generated beyond the planning date. */
const FORECAST_WEEKS = 32;
/** Weeks of the near term already converted into firm customer orders. */
const FIRM_WEEKS = 11;
/** Forecast points per week. Three keeps the demand curve smooth without
 *  generating a demand element for every item on every day. */
const FORECAST_POINTS_PER_WEEK = 3;
const FORECAST_WEEKDAYS = [0, 2, 4];

export function generateConfectionerySnapshot(): PlanningSnapshot {
  const stream = streamFactory(SPEC.seed);
  const planningDate = SPEC.planningDate;
  const planningEpochDay = toEpochDay(planningDate);

  const plants = SPEC.plants.map((plant): Plant => ({ ...plant }));
  const calendars = SPEC.calendars.map(
    (calendar): Calendar => ({
      id: calendar.id,
      workingDays: [...calendar.workingDays],
      holidays: [...calendar.holidays],
    })
  );

  const { items, fgProfiles, sfgProfiles, materialProfiles } = buildItems(stream('items'));
  const vendors = buildVendors(stream('vendors'));
  const customers = buildCustomers(stream('customers'));

  // 1. Where things are made and held.
  const placement = assignPlacement(stream('placement'), fgProfiles, sfgProfiles);

  // 2. Independent demand on finished goods.
  const demand = buildDemand(stream('demand'), fgProfiles, placement, customers, planningDate);

  // 3. Recipes. Materials come to exist at exactly the plants that consume them,
  //    which is why there is no drift of stock sitting at plants with no demand.
  const boms = buildBoms(stream('boms'), fgProfiles, sfgProfiles, materialProfiles, placement);

  // 4. What each item-plant actually consumes per day.
  const dailyDemand = estimateDailyDemand(demand, boms, placement, planningEpochDay);

  // 5. Planning parameters, sized against that consumption.
  const itemPlants = buildItemPlants(stream('item-plants'), placement, dailyDemand, items);
  const itemVendors = buildItemVendors(stream('item-vendors'), materialProfiles, placement, vendors, itemPlants);
  const substitutes = buildSubstitutes(materialProfiles, placement);
  const { resources, routings } = buildCapacity(stream('capacity'), fgProfiles, sfgProfiles, placement);
  const receiptHistory = buildReceiptHistory(stream('receipts'), itemPlants, itemVendors, planningDate);
  const { stock, supply } = buildStockAndSupply(
    stream('stock'),
    itemPlants,
    items,
    dailyDemand,
    itemVendors,
    planningDate
  );

  const context: PlantedContext = {
    items,
    itemPlants,
    boms,
    stock,
    supply,
    itemVendors,
    receiptHistory,
    demand,
    substitutes,
    dailyDemand,
    planningDate,
  };
  applyPlantedScenarios(stream('planted'), context);

  // Delivery buckets, last so the planted orders get one too. Derived from each
  // order's own fields rather than from `stream`, which is what keeps the rest
  // of the seeded dataset identical.
  attachDeliverySchedules(context.supply, planningDate);

  const systemSnapshots = buildSystemSnapshots(
    stream('systems'),
    { itemPlants: context.itemPlants, stock: context.stock, demand: context.demand },
    planningDate
  );

  return {
    dataPackId: SPEC.id,
    items: context.items,
    plants,
    itemPlants: context.itemPlants,
    boms: context.boms,
    resources,
    routings,
    vendors,
    itemVendors: context.itemVendors,
    substitutes: context.substitutes,
    calendars,
    receiptHistory: context.receiptHistory,
    stock: context.stock,
    supply: context.supply,
    demand: context.demand,
    customers,
    systemSnapshots,
  };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

interface FgProfile {
  item: Item;
  categoryCode: string;
  seasonalAffinity: 'BASE' | 'SEASONAL' | 'GIFTING';
  grams: number;
  priceIndex: number;
  weeklyVolume: number;
  chocolateShare: number;
  hasFilling: boolean;
  hasWafer: boolean;
  usesTray: boolean;
  usesTin: boolean;
  usesRibbon: boolean;
}

interface SfgProfile {
  item: Item;
  archetypeCode: string;
  consumesSfg: string | null;
}

interface MaterialProfile {
  item: Item;
  archetypeCode: string;
  kind: 'RM' | 'PM';
  /** Position within its archetype, 1-based. Low numbers carry the volume. */
  ordinal: number;
}

function buildItems(rng: Rng): {
  items: Item[];
  fgProfiles: FgProfile[];
  sfgProfiles: SfgProfile[];
  materialProfiles: MaterialProfile[];
} {
  const items: Item[] = [];
  const fgProfiles: FgProfile[] = [];
  const sfgProfiles: SfgProfile[] = [];
  const materialProfiles: MaterialProfile[] = [];
  const createdBase = toEpochDay(SPEC.planningDate);

  const categories = SPEC.fgCategories;
  for (let index = 1; index <= SPEC.counts.fg; index += 1) {
    // Categories cycle, so the numeric part of the id is a global material
    // number — which is how a real system numbers them.
    const slot = index % categories.length;
    const category = categories[slot === 0 ? categories.length - 1 : slot - 1] as (typeof categories)[number];
    const format = rng.pick(SPEC.fgFormats);
    const id = `FG-${category.code}-${String(index).padStart(3, '0')}`;

    const rank = rng.next();
    // Roughly $185M of annual revenue across the range — a regional
    // manufacturer with a long tail of formats. Scale matters: every exposure
    // figure on screen is proportional to it, so this is what decides whether
    // the headline number is honest.
    const weeklyVolume = rank > 0.8 ? rng.int(2_600, 6_400) : rank > 0.5 ? rng.int(520, 1_750) : rng.int(50, 350);
    const abcClass = rank > 0.8 ? 'A' : rank > 0.5 ? 'B' : 'C';

    const item: Item = {
      id,
      description: `${category.name} ${format.name}`,
      type: 'FG',
      baseUom: 'EA',
      abcClass,
      xyzClass: category.seasonalAffinity === 'SEASONAL' ? 'Z' : rng.chance(0.45) ? 'X' : rng.chance(0.6) ? 'Y' : 'Z',
      shelfLifeDays: rng.int(240, 400),
      isPhantom: false,
      standardCost: round(format.priceIndex * rng.float(0.52, 0.68), 4),
      createdOn: fromEpochDay(createdBase - rng.int(200, 2_400)),
    };

    items.push(item);
    fgProfiles.push({
      item,
      categoryCode: category.code,
      seasonalAffinity: category.seasonalAffinity,
      grams: format.grams,
      priceIndex: format.priceIndex,
      weeklyVolume,
      chocolateShare: category.code === 'WF' ? 0.42 : category.code === 'CN' ? 0.55 : rng.float(0.62, 0.88),
      hasFilling: ['FB', 'CB', 'PS'].includes(category.code),
      hasWafer: category.code === 'WF',
      usesTray: format.name.startsWith('Gift Box') || format.name.startsWith('Tin'),
      usesTin: format.name.startsWith('Tin'),
      usesRibbon: format.name.startsWith('Gift Box'),
    });
  }

  for (const archetype of SPEC.sfgArchetypes) {
    const count = SFG_COUNTS[archetype.code] ?? 10;
    for (let index = 1; index <= count; index += 1) {
      const item: Item = {
        id: `SFG-${archetype.code}-${String(index).padStart(3, '0')}`,
        description: describeVariant(archetype.name, archetype.variants, index),
        type: 'SFG',
        baseUom: archetype.baseUom,
        abcClass: index <= 3 ? 'A' : index <= 8 ? 'B' : 'C',
        xyzClass: rng.chance(0.5) ? 'X' : 'Y',
        shelfLifeDays: archetype.shelfLifeDays,
        // A couple of intermediates are phantoms — exploded through, never stocked.
        isPhantom: archetype.code === 'CI' && index > count - 2,
        standardCost: round(archetype.baseCost * rng.float(0.92, 1.14), 4),
        createdOn: fromEpochDay(createdBase - rng.int(400, 2_800)),
      };
      items.push(item);
      sfgProfiles.push({ item, archetypeCode: archetype.code, consumesSfg: archetype.consumesSfg });
    }
  }

  const buildMaterials = (
    archetypes: readonly {
      code: string;
      name: string;
      baseUom: string;
      baseCost: number;
      shelfLifeDays: number | null;
      variants: readonly string[];
    }[],
    kind: 'RM' | 'PM',
    counts: Record<string, number>
  ) => {
    for (const archetype of archetypes) {
      const count = counts[archetype.code] ?? 8;
      for (let index = 1; index <= count; index += 1) {
        const item: Item = {
          id: `${kind}-${archetype.code}-${String(index).padStart(3, '0')}`,
          description: describeVariant(archetype.name, archetype.variants, index),
          type: kind,
          baseUom: archetype.baseUom,
          abcClass: index <= 2 ? 'A' : index <= 6 ? 'B' : 'C',
          xyzClass: rng.chance(0.55) ? 'X' : rng.chance(0.6) ? 'Y' : 'Z',
          shelfLifeDays: archetype.shelfLifeDays,
          isPhantom: false,
          standardCost: round(archetype.baseCost * rng.float(0.88, 1.18), 4),
          createdOn: fromEpochDay(createdBase - rng.int(600, 3_200)),
        };
        items.push(item);
        materialProfiles.push({ item, archetypeCode: archetype.code, kind, ordinal: index });
      }
    }
  };

  buildMaterials(SPEC.rmArchetypes, 'RM', RM_COUNTS);
  buildMaterials(SPEC.pmArchetypes, 'PM', PM_COUNTS);

  return { items, fgProfiles, sfgProfiles, materialProfiles };
}

function describeVariant(name: string, variants: readonly string[], index: number): string {
  const variant = variants[(index - 1) % variants.length] as string;
  const qualifier = SPEC_QUALIFIERS[Math.floor((index - 1) / variants.length) % SPEC_QUALIFIERS.length] ?? '';
  return `${name}, ${variant}${qualifier}`;
}

// ---------------------------------------------------------------------------
// Vendors and customers
// ---------------------------------------------------------------------------

function buildVendors(rng: Rng): Vendor[] {
  const vendors: Vendor[] = [];
  for (let index = 0; index < SPEC.counts.vendors; index += 1) {
    const id = `VEND-${101 + index}`;
    // Synthetic descriptors only — no real trading partner is named anywhere.
    vendors.push({ id, name: `Supplier ${id.slice(5)}`, reliabilityScore: round(rng.float(0.55, 0.98), 3) });
  }
  return vendors;
}

function buildCustomers(rng: Rng): Customer[] {
  return SPEC.accountDescriptors.map((descriptor, index) => {
    const channel =
      descriptor.includes('MT') || descriptor.includes('Grocery') || descriptor.includes('Club')
        ? 'MT'
        : descriptor.includes('Export') || descriptor.includes('Duty Free')
          ? 'EXPORT'
          : descriptor.includes('Online') || descriptor.includes('Consumer') || descriptor.includes('Subscription')
            ? 'ECOM'
            : 'GT';
    return {
      id: `CUST-${String(index + 1).padStart(3, '0')}`,
      name: descriptor,
      channel,
      isKeyAccount: index < 5 || rng.chance(0.15),
    } satisfies Customer;
  });
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

interface Placement {
  /** itemId → plants where it is planned. Materials are filled in by the BOM pass. */
  plantsFor: Map<string, Set<string>>;
  /** FG id → its manufacturing plant. */
  primaryPlant: Map<string, string>;
  /** itemId → item type, for parameter shaping. */
  typeOf: Map<string, 'FG' | 'SFG' | 'RM' | 'PM'>;
  /** itemId → 'MAKE' | 'BUY' | 'TRANSFER' per plant. */
  procurement: Map<string, 'MAKE' | 'BUY' | 'TRANSFER'>;
  /** Transfer source, keyed by `item@plant`. */
  transferSource: Map<string, string>;
}

function assignPlacement(rng: Rng, fgProfiles: FgProfile[], sfgProfiles: SfgProfile[]): Placement {
  const plantsFor = new Map<string, Set<string>>();
  const primaryPlant = new Map<string, string>();
  const typeOf = new Map<string, 'FG' | 'SFG' | 'RM' | 'PM'>();
  const procurement = new Map<string, 'MAKE' | 'BUY' | 'TRANSFER'>();
  const transferSource = new Map<string, string>();

  const place = (itemId: string, plantId: string) => {
    const set = plantsFor.get(itemId);
    if (set) set.add(plantId);
    else plantsFor.set(itemId, new Set([plantId]));
  };

  for (const profile of fgProfiles) {
    const plantId =
      profile.seasonalAffinity === 'SEASONAL'
        ? rng.pick(['CP1', 'CP2', 'P3'])
        : profile.item.abcClass === 'A'
          ? rng.pick(['P1', 'P2'])
          : rng.pick(FG_PLANTS);
    primaryPlant.set(profile.item.id, plantId);
    typeOf.set(profile.item.id, 'FG');
    procurement.set(`${profile.item.id}@${plantId}`, 'MAKE');
    place(profile.item.id, plantId);

    // Fast movers are also held at the distribution centre, replenished by transfer.
    if (profile.item.abcClass === 'A' && rng.chance(0.55)) {
      place(profile.item.id, 'DC1');
      procurement.set(`${profile.item.id}@DC1`, 'TRANSFER');
      transferSource.set(`${profile.item.id}@DC1`, plantId);
    }
  }

  for (const profile of sfgProfiles) {
    typeOf.set(profile.item.id, 'SFG');
    const plantCount = profile.item.abcClass === 'C' ? 2 : 3;
    for (const plantId of rng.shuffle(SFG_PLANTS).slice(0, plantCount)) {
      place(profile.item.id, plantId);
      procurement.set(`${profile.item.id}@${plantId}`, 'MAKE');
    }
  }

  return { plantsFor, primaryPlant, typeOf, procurement, transferSource };
}

// ---------------------------------------------------------------------------
// Bills of material
// ---------------------------------------------------------------------------

function buildBoms(
  rng: Rng,
  fgProfiles: FgProfile[],
  sfgProfiles: SfgProfile[],
  materialProfiles: MaterialProfile[],
  placement: Placement
): BomLine[] {
  const boms: BomLine[] = [];
  const farPast = '2020-01-01';
  const farFuture = '2099-12-31';

  /**
   * Which materials of an archetype are qualified at which plant. Rotating the
   * assignment guarantees every material is used somewhere, while the low
   * ordinals carry the volume — which is what makes ABC classification mean
   * something.
   */
  const qualified = new Map<string, MaterialProfile[]>();
  const byArchetypeCode = new Map<string, MaterialProfile[]>();
  for (const profile of materialProfiles) {
    const bucket = byArchetypeCode.get(profile.archetypeCode);
    if (bucket) bucket.push(profile);
    else byArchetypeCode.set(profile.archetypeCode, [profile]);
  }
  for (const [code, profiles] of byArchetypeCode) {
    const perPlant = Math.ceil(profiles.length / PRODUCTION_PLANTS.length) + 6;
    PRODUCTION_PLANTS.forEach((plantId, plantIndex) => {
      const slice: MaterialProfile[] = [];
      for (let offset = 0; offset < perPlant; offset += 1) {
        const pick = profiles[(plantIndex * perPlant + offset) % profiles.length] as MaterialProfile;
        if (!slice.includes(pick)) slice.push(pick);
      }
      qualified.set(`${code}@${plantId}`, slice);
    });
  }

  const pickMaterial = (code: string, plantId: string): MaterialProfile | null => {
    const pool = qualified.get(`${code}@${plantId}`);
    if (!pool || pool.length === 0) return null;
    // Skewed toward the front of the pool so volume concentrates.
    const index = Math.min(pool.length - 1, Math.floor(Math.abs(rng.normal(0, pool.length / 2.5))));
    return pool[index] as MaterialProfile;
  };

  const place = (itemId: string, plantId: string) => {
    const set = placement.plantsFor.get(itemId);
    if (set) set.add(plantId);
    else placement.plantsFor.set(itemId, new Set([plantId]));
    placement.procurement.set(`${itemId}@${plantId}`, 'BUY');
  };

  const add = (
    parentItemId: string,
    plantId: string,
    component: MaterialProfile | SfgProfile | null,
    qtyPer: number,
    scrap: number,
    alternate = false
  ) => {
    if (!component) return;
    const componentId = component.item.id;
    boms.push({
      parentItemId,
      plantId,
      componentItemId: componentId,
      qtyPer: round(qtyPer, 6),
      componentScrapPct: round(scrap, 4),
      validFrom: farPast,
      validTo: farFuture,
      alternateBomId: alternate ? '2' : '1',
      isAlternate: alternate,
    });
    if ('kind' in component) {
      place(componentId, plantId);
      placement.typeOf.set(componentId, component.kind);
    }
  };

  const byCode = (code: string) => sfgProfiles.filter((profile) => profile.archetypeCode === code);
  const chocolateMasses = [...byCode('CM'), ...byCode('CD'), ...byCode('CW')];
  const coatings = byCode('CC');
  const fillings = [...byCode('CR'), ...byCode('PP'), ...byCode('NG'), ...byCode('FC')];
  const wafers = byCode('WS');
  const inclusions = byCode('CI');

  const atPlant = (profiles: SfgProfile[], plantId: string): SfgProfile | null => {
    const available = profiles.filter((profile) => placement.plantsFor.get(profile.item.id)?.has(plantId));
    return available.length > 0 ? rng.pick(available) : profiles.length > 0 ? rng.pick(profiles) : null;
  };

  // --- Finished goods.
  for (const profile of fgProfiles) {
    const plantId = placement.primaryPlant.get(profile.item.id);
    if (!plantId) continue;

    const chocolateKg = (profile.grams * profile.chocolateShare) / 1000;
    const base =
      profile.categoryCode === 'CN' || profile.categoryCode === 'PS'
        ? atPlant(coatings, plantId)
        : atPlant(chocolateMasses, plantId);
    add(profile.item.id, plantId, base, chocolateKg, rng.float(0.005, 0.02));

    if (profile.hasFilling)
      add(profile.item.id, plantId, atPlant(fillings, plantId), (profile.grams * 0.24) / 1000, rng.float(0.01, 0.03));
    if (profile.hasWafer)
      add(profile.item.id, plantId, atPlant(wafers, plantId), (profile.grams * 0.3) / 1000, rng.float(0.02, 0.05));
    if (rng.chance(0.22))
      add(profile.item.id, plantId, atPlant(inclusions, plantId), (profile.grams * 0.08) / 1000, rng.float(0.01, 0.03));

    add(profile.item.id, plantId, pickMaterial('WF', plantId), (profile.grams / 43) * 0.0125, rng.float(0.01, 0.035));
    add(profile.item.id, plantId, pickMaterial('CT', plantId), 1, rng.float(0.005, 0.02));
    add(profile.item.id, plantId, pickMaterial('CG', plantId), 1 / rng.int(12, 36), rng.float(0.002, 0.01));
    if (rng.chance(0.55)) add(profile.item.id, plantId, pickMaterial('LB', plantId), 1, rng.float(0.005, 0.02));
    if (profile.usesTray) add(profile.item.id, plantId, pickMaterial('TR', plantId), 1, rng.float(0.005, 0.02));
    if (profile.usesTin) add(profile.item.id, plantId, pickMaterial('TN', plantId), 1, rng.float(0.002, 0.01));
    if (profile.usesRibbon)
      add(profile.item.id, plantId, pickMaterial('RB', plantId), rng.float(0.4, 0.9), rng.float(0.01, 0.04));
    if (rng.chance(0.12)) add(profile.item.id, plantId, pickMaterial('SH', plantId), 1, rng.float(0.005, 0.02));
    if (rng.chance(0.1)) add(profile.item.id, plantId, pickMaterial('IN', plantId), 1, 0.005);
    if (rng.chance(0.08))
      add(profile.item.id, plantId, pickMaterial('LM', plantId), (profile.grams / 43) * 0.018, rng.float(0.01, 0.03));

    // An alternate recipe exists for some items — what ALTERNATE_BOM switches to.
    if (rng.chance(0.18))
      add(
        profile.item.id,
        plantId,
        atPlant(chocolateMasses, plantId),
        chocolateKg * 1.02,
        rng.float(0.005, 0.02),
        true
      );
  }

  // --- Coatings consume chocolate mass, giving the BOM its fourth level.
  for (const coating of coatings) {
    for (const plantId of placement.plantsFor.get(coating.item.id) ?? []) {
      add(coating.item.id, plantId, atPlant(chocolateMasses, plantId), rng.float(0.55, 0.75), rng.float(0.005, 0.02));
      add(coating.item.id, plantId, pickMaterial('PO', plantId), rng.float(0.18, 0.3), 0.005);
      add(coating.item.id, plantId, pickMaterial('SG', plantId), rng.float(0.08, 0.16), 0.002);
      add(coating.item.id, plantId, pickMaterial('LE', plantId), rng.float(0.003, 0.006), 0.001);
    }
  }

  // --- Other intermediates consume raw materials.
  const recipes: Record<string, Array<{ code: string; min: number; max: number }>> = {
    CM: [
      { code: 'CL', min: 0.16, max: 0.24 },
      { code: 'CB', min: 0.14, max: 0.2 },
      { code: 'SG', min: 0.4, max: 0.48 },
      { code: 'WM', min: 0.16, max: 0.22 },
      { code: 'LE', min: 0.003, max: 0.005 },
      { code: 'VF', min: 0.0004, max: 0.0009 },
    ],
    CD: [
      { code: 'CL', min: 0.42, max: 0.58 },
      { code: 'CB', min: 0.1, max: 0.16 },
      { code: 'SG', min: 0.3, max: 0.42 },
      { code: 'LE', min: 0.003, max: 0.005 },
    ],
    CW: [
      { code: 'CB', min: 0.28, max: 0.34 },
      { code: 'SG', min: 0.42, max: 0.5 },
      { code: 'WM', min: 0.2, max: 0.26 },
      { code: 'LE', min: 0.003, max: 0.005 },
      { code: 'VF', min: 0.0006, max: 0.0012 },
    ],
    CR: [
      { code: 'SG', min: 0.3, max: 0.38 },
      { code: 'GS', min: 0.24, max: 0.32 },
      { code: 'WM', min: 0.12, max: 0.18 },
      { code: 'PO', min: 0.08, max: 0.14 },
      { code: 'SL', min: 0.002, max: 0.006 },
    ],
    PP: [
      { code: 'HP', min: 0.42, max: 0.55 },
      { code: 'SG', min: 0.3, max: 0.4 },
      { code: 'CB', min: 0.08, max: 0.14 },
    ],
    NG: [
      { code: 'SG', min: 0.34, max: 0.44 },
      { code: 'GS', min: 0.28, max: 0.36 },
      { code: 'WP', min: 0.08, max: 0.14 },
      { code: 'PO', min: 0.05, max: 0.1 },
    ],
    WS: [
      { code: 'WT', min: 0.62, max: 0.72 },
      { code: 'PO', min: 0.1, max: 0.16 },
      { code: 'SG', min: 0.04, max: 0.08 },
      { code: 'SL', min: 0.004, max: 0.009 },
    ],
    CI: [
      { code: 'WT', min: 0.5, max: 0.62 },
      { code: 'SG', min: 0.18, max: 0.26 },
      { code: 'PO', min: 0.06, max: 0.12 },
    ],
    FC: [
      { code: 'SG', min: 0.5, max: 0.62 },
      { code: 'GS', min: 0.2, max: 0.28 },
      { code: 'IS', min: 0.08, max: 0.14 },
      { code: 'CA', min: 0.001, max: 0.004 },
    ],
    SM: [],
  };

  for (const profile of sfgProfiles) {
    const recipe = recipes[profile.archetypeCode];
    if (!recipe || recipe.length === 0) continue;
    for (const plantId of placement.plantsFor.get(profile.item.id) ?? []) {
      for (const line of recipe)
        add(
          profile.item.id,
          plantId,
          pickMaterial(line.code, plantId),
          rng.float(line.min, line.max),
          rng.float(0.002, 0.012)
        );
      if (profile.archetypeCode === 'PP' && rng.chance(0.4)) {
        add(profile.item.id, plantId, pickMaterial('AL', plantId), rng.float(0.1, 0.2), 0.01, true);
      }
      if (rng.chance(0.3)) add(profile.item.id, plantId, pickMaterial('SM', plantId), rng.float(0.05, 0.12), 0.004);
      if (rng.chance(0.2)) add(profile.item.id, plantId, pickMaterial('SS', plantId), rng.float(0.02, 0.06), 0.004);
      if (rng.chance(0.15)) add(profile.item.id, plantId, pickMaterial('LS', plantId), rng.float(0.002, 0.005), 0.002);
      if (rng.chance(0.12)) add(profile.item.id, plantId, pickMaterial('PN', plantId), rng.float(0.04, 0.1), 0.008);
    }
  }

  return boms;
}

// ---------------------------------------------------------------------------
// Demand
// ---------------------------------------------------------------------------

function buildDemand(
  rng: Rng,
  fgProfiles: FgProfile[],
  placement: Placement,
  customers: Customer[],
  planningDate: string
): DemandElement[] {
  const demand: DemandElement[] = [];
  const channelById = new Map(SPEC.channels.map((channel) => [channel.id, channel]));
  const customersByChannel = new Map<string, Customer[]>();
  for (const customer of customers) {
    const bucket = customersByChannel.get(customer.channel);
    if (bucket) bucket.push(customer);
    else customersByChannel.set(customer.channel, [customer]);
  }

  for (const profile of fgProfiles) {
    const plantIds = [...(placement.plantsFor.get(profile.item.id) ?? [])];
    const hasDc = plantIds.includes('DC1');

    for (const plantId of plantIds) {
      // Sell-out sits where the stock is picked from: the distribution centre
      // when there is one, the plant otherwise.
      const share = plantId === 'DC1' ? 0.6 : hasDc ? 0.4 : 1;
      const unitPriceBase = round(profile.priceIndex * rng.float(1.02, 1.24), 4);
      const variability = profile.item.xyzClass === 'X' ? 0.05 : profile.item.xyzClass === 'Y' ? 0.13 : 0.26;

      for (let week = 0; week < FORECAST_WEEKS; week += 1) {
        const weekStart = startOfWeek(addDays(planningDate, week * 7));
        const month = Number(weekStart.slice(5, 7)) - 1;
        const seasonal = SPEC.seasonality[profile.seasonalAffinity][month] ?? 1;
        const weeklyQty = Math.max(
          0,
          Math.round(profile.weeklyVolume * share * seasonal * Math.max(0.2, rng.normal(1, variability)))
        );
        if (weeklyQty <= 0) continue;

        if (week < FIRM_WEEKS) {
          // Firm customer orders, spread across the week's delivery days.
          const orderCount = profile.item.abcClass === 'A' ? 3 : profile.item.abcClass === 'B' ? 2 : 1;
          let remaining = weeklyQty;
          for (let order = 0; order < orderCount; order += 1) {
            const channel = rng.weighted(
              SPEC.channels.map((entry) => entry.id),
              SPEC.channels.map((entry) => entry.share)
            );
            const config = channelById.get(channel);
            const customer = rng.pick(customersByChannel.get(channel) ?? customers);
            const qty = order === orderCount - 1 ? remaining : Math.round(remaining * rng.float(0.3, 0.6));
            remaining -= qty;
            if (qty <= 0) continue;

            const price = round(unitPriceBase * (config?.priceIndex ?? 1), 4);
            demand.push({
              id: `SO-${profile.item.id}-${plantId}-${week}-${order}`,
              type: 'SALES_ORDER',
              itemId: profile.item.id,
              plantId,
              qty,
              requiredDate: addDays(weekStart, FORECAST_WEEKDAYS[order % FORECAST_POINTS_PER_WEEK] as number),
              customerId: customer.id,
              channel,
              marginPerUnit: round(price * (config?.marginRate ?? 0.3), 4),
              pricePerUnit: price,
              priority: customer.isKeyAccount ? 1 : (config?.priority ?? 3),
              parentSupplyElementId: null,
              sourceSystem: 'SAP',
            });
          }
        }

        // Forecast, split across the week so the demand curve is smooth. A
        // single weekly lump makes daily variability look far worse than it is,
        // which then makes every safety stock look misaligned.
        const forecastWeekly = week < FIRM_WEEKS ? Math.round(weeklyQty * rng.float(0.1, 0.25)) : weeklyQty;
        for (let point = 0; point < FORECAST_POINTS_PER_WEEK; point += 1) {
          const qty = Math.round(forecastWeekly / FORECAST_POINTS_PER_WEEK);
          if (qty <= 0) continue;
          demand.push({
            id: `FC-${profile.item.id}-${plantId}-${week}-${point}`,
            type: 'FORECAST',
            itemId: profile.item.id,
            plantId,
            qty,
            requiredDate: addDays(weekStart, FORECAST_WEEKDAYS[point] as number),
            customerId: null,
            channel: null,
            marginPerUnit: round(unitPriceBase * 0.3, 4),
            pricePerUnit: unitPriceBase,
            priority: 5,
            parentSupplyElementId: null,
            sourceSystem: 'O9',
          });
        }
      }
    }
  }

  return demand;
}

/**
 * One-pass explosion of finished-goods demand down the BOM, giving each
 * item-plant's daily consumption profile across the horizon.
 *
 * Everything downstream is sized from this: lot sizes, opening stock, order
 * quantities and — critically — safety stock, which is generated from the same
 * smoothed variability the B8 detector measures. Guessing at that variability
 * instead makes hundreds of perfectly reasonable parameters look misaligned.
 */
export interface DemandProfile {
  /** Daily quantity across the horizon, indexed by day offset. */
  series: Float64Array;
  /** Mean quantity per day. */
  perDay: number;
  /** Standard deviation of the seven-day rolling mean. */
  sigma: number;
}

function estimateDailyDemand(
  demand: DemandElement[],
  boms: BomLine[],
  placement: Placement,
  planningEpochDay: number
): Map<string, DemandProfile> {
  const horizon = SPEC.horizonDays;
  const buckets = horizon + 1;
  const series = new Map<string, Float64Array>();

  const seriesFor = (key: string): Float64Array => {
    let existing = series.get(key);
    if (!existing) {
      existing = new Float64Array(buckets);
      series.set(key, existing);
    }
    return existing;
  };

  const firmWindowDays = FIRM_WEEKS * 7;
  for (const element of demand) {
    const day = toEpochDay(element.requiredDate) - planningEpochDay;
    if (day < 0 || day > horizon) continue;
    // Forecast inside the firm window is entirely consumed by the customer
    // orders that replaced it, so counting it here would double the requirement
    // exactly where the engine has netted it away.
    if (element.type === 'FORECAST' && day < firmWindowDays) continue;
    const target = seriesFor(`${element.itemId}@${element.plantId}`);
    target[day] = (target[day] as number) + element.qty;
  }

  // Stock pulled to the distribution centre is demand at the plant that ships it.
  for (const [key, sourcePlantId] of placement.transferSource) {
    const dcSeries = series.get(key);
    if (!dcSeries) continue;
    const itemId = key.split('@')[0] as string;
    const plantSeries = seriesFor(`${itemId}@${sourcePlantId}`);
    for (let day = 0; day < buckets; day += 1) {
      plantSeries[day] = (plantSeries[day] as number) + (dcSeries[day] as number);
    }
  }

  const bomsByParent = new Map<string, BomLine[]>();
  for (const line of boms) {
    if (line.isAlternate) continue;
    const key = `${line.parentItemId}@${line.plantId}`;
    const bucket = bomsByParent.get(key);
    if (bucket) bucket.push(line);
    else bomsByParent.set(key, [line]);
  }

  // Four passes covers this pack's BOM depth.
  let frontier = [...series.keys()];
  for (let level = 0; level < 4; level += 1) {
    const touched = new Set<string>();
    for (const key of frontier) {
      const lines = bomsByParent.get(key);
      if (!lines) continue;
      const parentSeries = series.get(key);
      if (!parentSeries) continue;
      const plantId = key.split('@')[1] as string;

      for (const line of lines) {
        const childKey = `${line.componentItemId}@${plantId}`;
        const childSeries = seriesFor(childKey);
        const factor = line.qtyPer / (1 - line.componentScrapPct);
        for (let day = 0; day < buckets; day += 1) {
          childSeries[day] = (childSeries[day] as number) + (parentSeries[day] as number) * factor;
        }
        touched.add(childKey);
      }
    }
    if (touched.size === 0) break;
    frontier = [...touched];
  }

  const profiles = new Map<string, DemandProfile>();
  for (const [key, values] of series) {
    profiles.set(key, { series: values, perDay: mean(values), sigma: smoothedStdDev(values) });
  }
  return profiles;
}

/** Mirrors the engine's review period exactly — see `reviewPeriodDays`. */
function reviewPeriod(leadTimeDays: number): number {
  return Math.min(28, Math.max(7, leadTimeDays));
}

function mean(values: Float64Array): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < values.length; i += 1) total += values[i] as number;
  return total / values.length;
}

/** Mirrors the engine's variability measure exactly — see `demandStdDev`. */
function smoothedStdDev(values: Float64Array, smoothingDays = 7): number {
  const n = values.length;
  if (n === 0) return 0;
  const smoothed = new Float64Array(n);
  let window = 0;
  for (let i = 0; i < n; i += 1) {
    window += values[i] as number;
    if (i >= smoothingDays) window -= values[i - smoothingDays] as number;
    smoothed[i] = window / Math.min(i + 1, smoothingDays);
  }
  const average = mean(smoothed);
  let variance = 0;
  for (let i = 0; i < n; i += 1) variance += ((smoothed[i] as number) - average) ** 2;
  return Math.sqrt(variance / n);
}

// ---------------------------------------------------------------------------
// Planning parameters — sized against real consumption
// ---------------------------------------------------------------------------

function buildItemPlants(
  rng: Rng,
  placement: Placement,
  dailyDemand: Map<string, DemandProfile>,
  items: Item[]
): ItemPlant[] {
  const itemPlants: ItemPlant[] = [];
  const itemById = new Map(items.map((item) => [item.id, item]));
  const createdBase = toEpochDay(SPEC.planningDate);

  for (const [itemId, plantIds] of placement.plantsFor) {
    const item = itemById.get(itemId);
    if (!item) continue;

    for (const plantId of plantIds) {
      const key = `${itemId}@${plantId}`;
      const profile = dailyDemand.get(key);
      const perDay = profile?.perDay ?? 0;
      const procurementType =
        placement.procurement.get(key) ?? (item.type === 'FG' || item.type === 'SFG' ? 'MAKE' : 'BUY');

      const leadTimeDays =
        procurementType === 'MAKE'
          ? rng.int(2, 7)
          : procurementType === 'TRANSFER'
            ? rng.int(2, 5)
            : item.type === 'RM'
              ? rng.int(10, 45)
              : rng.int(7, 28);

      const serviceLevelTarget = item.abcClass === 'A' ? 0.98 : item.abcClass === 'B' ? 0.96 : 0.92;

      // Safety stock is generated as what the standard formula would produce
      // over this item's *own* measured variability, with noise. The B8 detector
      // then finds the parameters that have genuinely decayed rather than firing
      // on the whole catalogue.
      const sigmaPerDay = profile ? smoothedStdDev(profile.series, reviewPeriod(leadTimeDays)) : 0;
      const formulaSafetyStock = zScore(serviceLevelTarget) * sigmaPerDay * Math.sqrt(Math.max(leadTimeDays, 1));
      const safetyStock = roundSensibly(formulaSafetyStock * rng.float(0.78, 1.28), perDay);

      const rule: LotSizeRule =
        procurementType === 'MAKE'
          ? rng.weighted(['FOQ', 'POQ', 'LFL'] as const, [5, 4, 2])
          : rng.weighted(['LFL', 'FOQ', 'POQ', 'MINMAX', 'EOQ'] as const, [2, 4, 4, 1, 1]);

      // Every lot-sizing parameter is expressed in days of the item's own
      // consumption, which is what stops a slow-moving flavour ending up with a
      // year of cover from a single order.
      const cycleDays = procurementType === 'MAKE' ? rng.int(7, 21) : rng.int(21, 45);
      const lotQty = roundSensibly(perDay * cycleDays, perDay);

      itemPlants.push({
        itemId,
        plantId,
        mrpType: procurementType === 'BUY' && item.abcClass === 'C' && rng.chance(0.12) ? 'VB' : 'PD',
        procurementType,
        lotSizeRule: rule,
        fixedLotSize: rule === 'FOQ' ? Math.max(lotQty, 1) : null,
        minLotSize: rule === 'MINMAX' || rule === 'EOQ' ? Math.max(roundSensibly(perDay * 14, perDay), 1) : null,
        maxLotSize: rule === 'MINMAX' ? Math.max(roundSensibly(perDay * 50, perDay), 2) : null,
        periodsOfSupplyDays: rule === 'POQ' ? cycleDays : null,
        reorderPoint: roundSensibly(perDay * (leadTimeDays + 7), perDay),
        roundingValue: rng.chance(0.55) ? roundingStepFor(perDay) : null,
        leadTimeDays,
        grProcessingTimeDays: procurementType === 'BUY' ? rng.int(0, 3) : rng.chance(0.4) ? 1 : 0,
        safetyStock,
        safetyTimeDays: rng.chance(0.3) ? rng.int(1, 3) : 0,
        scrapPct: procurementType === 'MAKE' ? round(rng.float(0.005, 0.035), 4) : 0,
        serviceLevelTarget,
        plannerCode: `PLN-${rng.int(1, 8)}`,
        sourcePlantId: placement.transferSource.get(key) ?? null,
        isPlanningRelevant: true,
        paramsLastChangedOn: fromEpochDay(createdBase - rng.int(30, 900)),
      });
    }
  }

  // A small share of planning masters are left incomplete. Absence is the signal
  // the B1 detector exists to find, so it has to be genuinely absent.
  const withDemand = itemPlants.filter(
    (record) => (dailyDemand.get(`${record.itemId}@${record.plantId}`)?.perDay ?? 0) > 0
  );
  const incompleteCount = Math.max(1, Math.round(withDemand.length * SPEC.tuning.incompleteMasterRate));
  for (const record of rng.shuffle(withDemand).slice(0, incompleteCount)) {
    const missing = rng.int(1, 3);
    if (missing >= 1) record.leadTimeDays = null;
    if (missing >= 2) record.safetyStock = null;
    if (missing >= 3) record.lotSizeRule = null;
  }

  return itemPlants;
}

/** Rounds to a step that suits the magnitude, so quantities read like real ones. */
function roundSensibly(value: number, scale: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const step = roundingStepFor(scale);
  return Math.max(step, Math.round(value / step) * step);
}

function roundingStepFor(scale: number): number {
  if (scale >= 5_000) return 500;
  if (scale >= 1_000) return 100;
  if (scale >= 200) return 25;
  if (scale >= 20) return 5;
  return 1;
}

// ---------------------------------------------------------------------------
// Sourcing
// ---------------------------------------------------------------------------

function buildItemVendors(
  rng: Rng,
  materialProfiles: MaterialProfile[],
  placement: Placement,
  vendors: Vendor[],
  itemPlants: ItemPlant[]
): ItemVendor[] {
  const itemVendors: ItemVendor[] = [];
  const masterByKey = new Map(itemPlants.map((record) => [`${record.itemId}@${record.plantId}`, record]));

  for (const profile of materialProfiles) {
    const plantIds = placement.plantsFor.get(profile.item.id);
    if (!plantIds) continue;
    const pool = rng.shuffle(vendors).slice(0, rng.int(1, 3));

    for (const plantId of plantIds) {
      const master = masterByKey.get(`${profile.item.id}@${plantId}`);
      if (!master) continue;
      // The maintained lead time is the primary vendor's quoted lead time —
      // divergence between the two is a finding, not the default state.
      const maintained = master.leadTimeDays ?? (profile.kind === 'RM' ? 21 : 14);

      pool.forEach((vendor, index) => {
        const isPrimary = index === 0;
        const expediteAvailable = rng.chance(0.62);
        const leadTime = isPrimary ? maintained : Math.max(5, maintained - rng.int(2, 12));
        itemVendors.push({
          itemId: profile.item.id,
          plantId,
          vendorId: vendor.id,
          isPrimary,
          leadTimeDays: leadTime,
          // Minimums are expressed against the order cycle, so they bind
          // occasionally rather than on every slow-moving item.
          moq: roundSensibly(
            (master.fixedLotSize ?? master.reorderPoint ?? 1_000) * rng.float(0.2, 0.65),
            master.reorderPoint ?? 1_000
          ),
          incrementQty: rng.chance(0.4) ? roundingStepFor(master.reorderPoint ?? 1_000) : 0,
          unitPrice: round(profile.item.standardCost * (isPrimary ? rng.float(0.97, 1.03) : rng.float(1.01, 1.09)), 4),
          dailyCapacity: rng.chance(0.3)
            ? roundSensibly((master.fixedLotSize ?? master.reorderPoint ?? 1_000) * rng.float(0.8, 3), 1_000)
            : null,
          expediteAvailable,
          expediteLeadTimeDays: expediteAvailable ? Math.max(3, Math.round(leadTime * rng.float(0.35, 0.6))) : null,
          expediteUnitPriceUplift: expediteAvailable ? round(rng.float(0.18, 0.45), 3) : null,
        });
      });
    }
  }

  return itemVendors;
}

function buildSubstitutes(materialProfiles: MaterialProfile[], placement: Placement): SubstituteItem[] {
  const substitutes: SubstituteItem[] = [];
  const pairs: Array<[string, string, number, string]> = [
    [
      'LE',
      'LS',
      1.04,
      'Sunflower lecithin approved as a like-for-like emulsifier; declaration change required on pack.',
    ],
    ['PO', 'SS', 1.08, 'Shea stearin approved for the same fat fraction; tempering profile adjusts by two degrees.'],
    ['SM', 'WP', 1.15, 'Whey powder approved in caramel and nougat applications only, not in chocolate mass.'],
    [
      'AL',
      'PN',
      0.92,
      'Peanut kernels approved as a cost alternate in coated formats; allergen labelling already covers both.',
    ],
    ['GS', 'IS', 1.02, 'Invert sugar syrup approved as a direct alternate in fondant and caramel.'],
  ];

  for (const [fromCode, toCode, factor, note] of pairs) {
    const sources = materialProfiles.filter((profile) => profile.archetypeCode === fromCode);
    const targets = materialProfiles.filter((profile) => profile.archetypeCode === toCode);
    if (sources.length === 0 || targets.length === 0) continue;

    for (let index = 0; index < Math.min(sources.length, 4); index += 1) {
      const source = sources[index] as MaterialProfile;
      const target = targets[index % targets.length] as MaterialProfile;
      for (const plantId of placement.plantsFor.get(source.item.id) ?? []) {
        substitutes.push({
          itemId: source.item.id,
          substituteItemId: target.item.id,
          plantId,
          conversionFactor: factor,
          approvalStatus: index === 1 ? 'CONDITIONAL' : 'APPROVED',
          note,
        });
      }
    }
  }

  return substitutes;
}

function buildCapacity(
  rng: Rng,
  fgProfiles: FgProfile[],
  sfgProfiles: SfgProfile[],
  placement: Placement
): { resources: Resource[]; routings: ItemRouting[] } {
  const resources: Resource[] = [];
  const routings: ItemRouting[] = [];

  const lines = [
    { suffix: 'MOULD', name: 'Moulding Line', hours: 21 },
    { suffix: 'ENROB', name: 'Enrobing Line', hours: 20 },
    { suffix: 'WRAP', name: 'Wrapping Line', hours: 22 },
    { suffix: 'PACK', name: 'Secondary Packing Line', hours: 18 },
    { suffix: 'CONCH', name: 'Conching Line', hours: 23 },
  ];

  for (const plantId of [...FG_PLANTS, 'DC1']) {
    for (const line of lines) {
      if (plantId === 'DC1' && line.suffix !== 'PACK') continue;
      resources.push({
        id: `${plantId}-${line.suffix}`,
        plantId,
        name: `${line.name} · ${plantId}`,
        dailyCapacityHours: line.hours,
      });
    }
  }

  for (const profile of fgProfiles) {
    const plantId = placement.primaryPlant.get(profile.item.id);
    if (!plantId) continue;
    routings.push({
      itemId: profile.item.id,
      plantId,
      resourceId: `${plantId}-${rng.pick(['MOULD', 'ENROB', 'WRAP'])}`,
      hoursPerBaseUom: round(rng.float(0.00004, 0.00016), 8),
    });
  }

  for (const profile of sfgProfiles) {
    for (const plantId of placement.plantsFor.get(profile.item.id) ?? []) {
      if (plantId === 'DC1') continue;
      routings.push({
        itemId: profile.item.id,
        plantId,
        resourceId: `${plantId}-CONCH`,
        hoursPerBaseUom: round(rng.float(0.0002, 0.0009), 8),
      });
    }
  }

  return { resources, routings };
}

// ---------------------------------------------------------------------------
// Receipt history — the evidence behind lead time drift
// ---------------------------------------------------------------------------

function buildReceiptHistory(
  rng: Rng,
  itemPlants: ItemPlant[],
  itemVendors: ItemVendor[],
  planningDate: string
): ReceiptHistory[] {
  const history: ReceiptHistory[] = [];
  const primaryByKey = new Map<string, ItemVendor>();
  for (const link of itemVendors) if (link.isPrimary) primaryByKey.set(`${link.itemId}@${link.plantId}`, link);

  const buyKeys = itemPlants
    .filter((record) => record.procurementType === 'BUY' && primaryByKey.has(`${record.itemId}@${record.plantId}`))
    .map((record) => `${record.itemId}@${record.plantId}`);

  const driftTargets = new Set(
    rng.shuffle(buyKeys).slice(0, Math.round(buyKeys.length * SPEC.tuning.leadTimeDriftRate))
  );
  const masterByKey = new Map(itemPlants.map((record) => [`${record.itemId}@${record.plantId}`, record]));

  for (const key of buyKeys) {
    const vendor = primaryByKey.get(key);
    const master = masterByKey.get(key);
    if (!vendor || !master) continue;

    // Receipts are generated against the *maintained* parameter, so an item only
    // shows drift when it has genuinely been drifting.
    const maintained = master.leadTimeDays ?? vendor.leadTimeDays;
    const hasDrifted = driftTargets.has(key);
    const receiptCount = rng.int(6, 9);

    for (let index = 0; index < receiptCount; index += 1) {
      const receivedOn = addDays(planningDate, -(index * rng.int(16, 32) + rng.int(3, 12)));
      const actual = hasDrifted
        ? Math.round(maintained * rng.float(1.45, 1.9))
        : Math.max(1, Math.round(maintained * rng.float(0.93, 1.09)));

      history.push({
        itemId: master.itemId,
        plantId: master.plantId,
        vendorId: vendor.vendorId,
        poId: `PO-H-${master.itemId}-${master.plantId}-${index}`,
        orderedOn: addDays(receivedOn, -actual),
        promisedOn: addDays(receivedOn, -actual + maintained),
        receivedOn,
        qty: roundSensibly(rng.float(4_000, 40_000), 1_000),
        actualLeadTimeDays: actual,
      });
    }
  }

  return history;
}

// ---------------------------------------------------------------------------
// Stock and open supply
// ---------------------------------------------------------------------------

function buildStockAndSupply(
  rng: Rng,
  itemPlants: ItemPlant[],
  items: Item[],
  dailyDemand: Map<string, DemandProfile>,
  itemVendors: ItemVendor[],
  planningDate: string
): { stock: StockPosition[]; supply: SupplyElement[] } {
  const stock: StockPosition[] = [];
  const supply: SupplyElement[] = [];
  const itemById = new Map(items.map((item) => [item.id, item]));
  const primaryByKey = new Map<string, ItemVendor>();
  for (const link of itemVendors) if (link.isPrimary) primaryByKey.set(`${link.itemId}@${link.plantId}`, link);

  const tuning = SPEC.tuning;
  const pastDueTargets = new Set(
    rng.shuffle(itemPlants.map((record) => `${record.itemId}@${record.plantId}`)).slice(0, 60)
  );

  for (const itemPlant of itemPlants) {
    const key = `${itemPlant.itemId}@${itemPlant.plantId}`;
    const item = itemById.get(itemPlant.itemId);
    if (!item) continue;

    const perDay = dailyDemand.get(key)?.perDay ?? 0;
    const safety = itemPlant.safetyStock ?? 0;
    const leadTime = itemPlant.leadTimeDays ?? primaryByKey.get(key)?.leadTimeDays ?? 14;

    // Opening cover, then a deliberate bias on how well the order book closes
    // the rest of the horizon. Generating stock and orders independently of
    // demand is what leaves a dataset in permanent surplus or permanent famine;
    // this is the knob that decides how many item-plants are genuinely in
    // trouble and how many are sitting on money.
    const roll = rng.next();
    const isOrphan = roll < tuning.orphanRate;
    const coverDays = isOrphan ? rng.float(200, 600) : rng.float(18, 62);

    const coverageBias =
      roll < tuning.orphanRate + tuning.shortagePressure
        ? rng.float(0.84, 0.96)
        : roll > 1 - tuning.excessPressure
          ? rng.float(1.14, 1.38)
          : rng.float(0.97, 1.05);

    const unrestricted =
      perDay > 0
        ? roundSensibly(perDay * coverDays, perDay)
        : roundSensibly(safety * rng.float(0.6, 2.0), safety || 100);
    const blocked = rng.chance(0.07) ? roundSensibly(unrestricted * rng.float(0.04, 0.16), unrestricted) : 0;
    const qualityInspection = rng.chance(0.1) ? roundSensibly(unrestricted * rng.float(0.03, 0.1), unrestricted) : 0;
    const inTransit = rng.chance(0.12) ? roundSensibly(unrestricted * rng.float(0.05, 0.2), unrestricted) : 0;

    const batches: StockPosition['batches'] = [];
    if (item.shelfLifeDays !== null && unrestricted > 0) {
      const batchCount = rng.int(1, 3);
      let remaining = unrestricted;
      for (let index = 0; index < batchCount; index += 1) {
        const qty = index === batchCount - 1 ? remaining : roundSensibly(remaining * rng.float(0.3, 0.6), remaining);
        remaining = Math.max(0, remaining - qty);
        if (qty <= 0) continue;
        batches.push({
          batchId: `B-${itemPlant.itemId.slice(-6)}-${itemPlant.plantId}-${index + 1}`,
          qty,
          // Natural batches are consumed well inside their life; violations are planted.
          expiryDate: addDays(planningDate, rng.int(Math.round(item.shelfLifeDays * 0.55), item.shelfLifeDays)),
        });
      }
    }

    stock.push({
      itemId: itemPlant.itemId,
      plantId: itemPlant.plantId,
      unrestricted,
      blocked,
      qualityInspection,
      inTransit,
      batches,
    });

    if (perDay <= 0) continue;

    // What the horizon still needs once opening stock is spent, biased.
    //
    // Components consume later than a steady-state average implies: nothing is
    // drawn until the parent actually builds, and parents open the horizon with
    // stock of their own. Ordering against the flat average leaves every
    // component in surplus, which floods the queue with cancellable orders.
    const consumingDays = item.type === 'FG' ? SPEC.horizonDays : SPEC.horizonDays * 0.86;
    const horizonRequirement = perDay * consumingDays + safety;
    const toOrder = Math.max(0, (horizonRequirement - unrestricted) * coverageBias);
    if (toOrder <= 0) continue;

    const cycleDays =
      itemPlant.periodsOfSupplyDays ??
      Math.max(14, Math.round((itemPlant.fixedLotSize ?? perDay * 30) / Math.max(perDay, 1e-6)));
    const orderCount = Math.max(1, Math.min(3, Math.ceil(toOrder / Math.max(perDay * cycleDays, 1e-6))));
    const perOrder = toOrder / orderCount;
    const isBuy = itemPlant.procurementType === 'BUY';
    const vendor = primaryByKey.get(key);

    for (let index = 0; index < orderCount; index += 1) {
      // Placed to arrive as the position runs down, which is what a working
      // order book looks like — and what stops every receipt reading as early.
      const dueOffset = Math.round(coverDays + index * cycleDays + rng.float(-4, 6));
      if (dueOffset > SPEC.horizonDays) break;

      supply.push({
        id: `${isBuy ? 'PO' : itemPlant.procurementType === 'TRANSFER' ? 'STO' : 'PRD'}-${itemPlant.itemId}-${itemPlant.plantId}-${index}`,
        type: isBuy ? 'PO' : itemPlant.procurementType === 'TRANSFER' ? 'STO' : 'PRODUCTION_ORDER',
        itemId: itemPlant.itemId,
        plantId: itemPlant.plantId,
        qty: roundSensibly(perOrder * rng.float(0.92, 1.08), perDay),
        dueDate: addDays(planningDate, Math.max(1, dueOffset)),
        releaseDate: addDays(planningDate, Math.max(1, dueOffset) - leadTime),
        vendorId: isBuy ? (vendor?.vendorId ?? null) : null,
        sourcePlantId: itemPlant.sourcePlantId,
        isFirm: rng.chance(0.7),
        sourceSystem: rng.chance(0.85) ? 'SAP' : 'KINAXIS',
      });
    }

    // A controlled number of orders are already late. Every real order book has some.
    if (pastDueTargets.has(key)) {
      supply.push({
        id: `${isBuy ? 'PO' : 'PRD'}-${itemPlant.itemId}-${itemPlant.plantId}-LATE`,
        type: isBuy ? 'PO' : 'PRODUCTION_ORDER',
        itemId: itemPlant.itemId,
        plantId: itemPlant.plantId,
        qty: roundSensibly(perDay * rng.float(8, 18), perDay),
        dueDate: addDays(planningDate, -rng.int(2, 24)),
        releaseDate: addDays(planningDate, -rng.int(25, 60)),
        vendorId: isBuy ? (vendor?.vendorId ?? null) : null,
        sourcePlantId: itemPlant.sourcePlantId,
        isFirm: true,
        sourceSystem: 'SAP',
      });
    }
  }

  return { stock, supply };
}

// ---------------------------------------------------------------------------
// Planted scenarios
// ---------------------------------------------------------------------------

interface PlantedContext {
  items: Item[];
  itemPlants: ItemPlant[];
  boms: BomLine[];
  stock: StockPosition[];
  supply: SupplyElement[];
  itemVendors: ItemVendor[];
  receiptHistory: ReceiptHistory[];
  demand: DemandElement[];
  substitutes: SubstituteItem[];
  dailyDemand: Map<string, DemandProfile>;
  planningDate: string;
}

function applyPlantedScenarios(rng: Rng, ctx: PlantedContext): void {
  const scenarios = SPEC.plantedScenarios;
  const tuning = SPEC.tuning;
  const findMaster = (itemId: string, plantId: string) =>
    ctx.itemPlants.find((record) => record.itemId === itemId && record.plantId === plantId);
  const findStock = (itemId: string, plantId: string) =>
    ctx.stock.find((record) => record.itemId === itemId && record.plantId === plantId);

  // --- 1. Cocoa butter lead time drift. The hero.
  const drift = scenarios.leadTimeDrift;
  const driftMaster = findMaster(drift.itemId, drift.plantId);
  if (driftMaster) {
    Object.assign(driftMaster, {
      mrpType: 'PD',
      procurementType: 'BUY',
      lotSizeRule: 'FOQ',
      fixedLotSize: drift.fixedLotSize,
      minLotSize: null,
      maxLotSize: null,
      periodsOfSupplyDays: null,
      roundingValue: drift.roundingValue,
      leadTimeDays: drift.maintainedLeadTimeDays,
      grProcessingTimeDays: 0,
      safetyTimeDays: 3,
      safetyStock: drift.safetyStock,
      scrapPct: 0,
      paramsLastChangedOn: drift.paramsLastChangedOn,
      isPlanningRelevant: true,
    } satisfies Partial<ItemPlant>);
  }

  ctx.itemVendors = ctx.itemVendors.filter((link) => !(link.itemId === drift.itemId && link.plantId === drift.plantId));
  ctx.itemVendors.push({
    itemId: drift.itemId,
    plantId: drift.plantId,
    vendorId: drift.vendorId,
    isPrimary: true,
    leadTimeDays: drift.maintainedLeadTimeDays,
    moq: 20_000,
    incrementQty: 1_000,
    unitPrice: 8.42,
    dailyCapacity: 12_000,
    expediteAvailable: true,
    expediteLeadTimeDays: 11,
    expediteUnitPriceUplift: 0.35,
  });
  // A faster approved alternate, so the workbench has a real option to simulate.
  ctx.itemVendors.push({
    itemId: drift.itemId,
    plantId: drift.plantId,
    vendorId: 'VEND-127',
    isPrimary: false,
    leadTimeDays: 12,
    moq: 15_000,
    incrementQty: 1_000,
    unitPrice: 8.94,
    dailyCapacity: 8_000,
    expediteAvailable: false,
    expediteLeadTimeDays: null,
    expediteUnitPriceUplift: null,
  });

  ctx.receiptHistory = ctx.receiptHistory.filter(
    (receipt) => !(receipt.itemId === drift.itemId && receipt.plantId === drift.plantId)
  );
  drift.observedLeadTimeDays.forEach((actual, index) => {
    const receivedOn = addDays(ctx.planningDate, -(index * 24 + 9));
    ctx.receiptHistory.push({
      itemId: drift.itemId,
      plantId: drift.plantId,
      vendorId: drift.vendorId,
      poId: `PO-4500${71203 + index}`,
      orderedOn: addDays(receivedOn, -actual),
      promisedOn: addDays(receivedOn, -actual + drift.maintainedLeadTimeDays),
      receivedOn,
      qty: 25_000,
      actualLeadTimeDays: actual,
    });
  });

  // The opening position is expressed in days of this item's own consumption,
  // and deliberately set *below* the maintained buffer.
  //
  // Sizing it against average demand alone is not enough: component
  // requirements arrive in batches, so an item can sit untouched for three
  // weeks and never breach. Starting under the buffer makes the net requirement
  // land in the first bucket, where offsetting a 21-day lead time plus three
  // days of safety time necessarily puts the release date in the past. That is
  // the whole demo — the parameter is wrong, and it has already put a receipt
  // out of reach — so it has to hold whatever the surrounding demand does.
  const driftPerDay = ctx.dailyDemand.get(`${drift.itemId}@${drift.plantId}`)?.perDay ?? 0;
  const driftStock = findStock(drift.itemId, drift.plantId);
  if (driftStock && driftPerDay > 0) {
    const opening = roundSensibly(driftPerDay * 14, driftPerDay);
    driftStock.unrestricted = opening;
    driftStock.blocked = 0;
    driftStock.qualityInspection = 0;
    driftStock.inTransit = 0;
    driftStock.batches = [{ batchId: 'B-CB001-P1-1', qty: opening, expiryDate: addDays(ctx.planningDate, 420) }];
    if (driftMaster) {
      driftMaster.safetyStock = roundSensibly(driftPerDay * 21, driftPerDay);
      driftMaster.fixedLotSize = roundSensibly(driftPerDay * 25, driftPerDay);
      driftMaster.reorderPoint = roundSensibly(driftPerDay * 21, driftPerDay);
    }
  }
  ctx.supply = ctx.supply.filter((element) => !(element.itemId === drift.itemId && element.plantId === drift.plantId));
  if (driftPerDay > 0) {
    // The one open order, arriving day 9 — enough to mask the gap briefly and
    // then leave it wide open, which is what makes the trace legible.
    const driftPoQty = roundSensibly(driftPerDay * 10, driftPerDay);
    const firstDrop = roundSensibly(driftPoQty / 2, driftPerDay);

    ctx.supply.push({
      id: 'PO-4500071288',
      type: 'PO',
      itemId: drift.itemId,
      plantId: drift.plantId,
      qty: driftPoQty,
      dueDate: addDays(ctx.planningDate, 9),
      releaseDate: addDays(ctx.planningDate, -12),
      vendorId: drift.vendorId,
      sourcePlantId: null,
      isFirm: true,
      sourceSystem: 'SAP',
      // Spelled out rather than derived: this is the order the demo opens, and
      // the split has to make the point. Half of it the supplier has committed
      // to, half of it they have not answered on — and the plan is netting
      // against the whole quantity as though both were certain.
      schedule: [
        {
          line: 1,
          qty: firstDrop,
          plannedDate: addDays(ctx.planningDate, 4),
          confirmedDate: addDays(ctx.planningDate, 4),
          expectedDate: addDays(ctx.planningDate, 4),
          status: 'IN_TRANSIT',
        },
        {
          line: 2,
          qty: driftPoQty - firstDrop,
          plannedDate: addDays(ctx.planningDate, 9),
          confirmedDate: null,
          expectedDate: addDays(ctx.planningDate, 9),
          status: 'PLANNED',
        },
      ],
    });
  }

  // --- 2. Absent item: demand in o9 and Kinaxis, no planning master in SAP.
  const absent = scenarios.absentItem;
  ctx.itemPlants = ctx.itemPlants.filter((r) => !(r.itemId === absent.itemId && r.plantId === absent.plantId));
  ctx.stock = ctx.stock.filter((r) => !(r.itemId === absent.itemId && r.plantId === absent.plantId));
  ctx.supply = ctx.supply.filter((r) => !(r.itemId === absent.itemId && r.plantId === absent.plantId));

  // --- 3. Inventory divergence: Kinaxis sees free stock that SAP has blocked.
  const divergence = scenarios.inventoryDivergence;
  const divergenceStock = findStock(divergence.itemId, divergence.plantId);
  if (divergenceStock) {
    divergenceStock.unrestricted = divergence.sapUnrestricted;
    divergenceStock.blocked = divergence.sapBlocked;
    divergenceStock.qualityInspection = 0;
    divergenceStock.batches = [
      { batchId: 'B-CR004-P2-1', qty: divergence.sapUnrestricted, expiryDate: addDays(ctx.planningDate, 90) },
    ];
  }

  // --- 4. Packaging ordered half a million at a time against 1,300 a day.
  const excess = scenarios.lotSizeExcess;
  const excessMaster = findMaster(excess.itemId, excess.plantId);
  if (excessMaster) {
    Object.assign(excessMaster, {
      lotSizeRule: 'FOQ',
      fixedLotSize: excess.fixedLotSize,
      minLotSize: null,
      maxLotSize: null,
      periodsOfSupplyDays: null,
      roundingValue: 10_000,
      safetyStock: 40_000,
    } satisfies Partial<ItemPlant>);
  }

  // A wider set of packaging items carry the same working-capital problem, so
  // the finding reads as systemic rather than anecdotal.
  const packagingMasters = ctx.itemPlants.filter(
    (record) =>
      record.itemId.startsWith('PM-') && (ctx.dailyDemand.get(`${record.itemId}@${record.plantId}`)?.perDay ?? 0) > 50
  );
  for (const record of rng.shuffle(packagingMasters).slice(0, tuning.lotSizeExcessCount)) {
    const perDay = ctx.dailyDemand.get(`${record.itemId}@${record.plantId}`)?.perDay ?? 0;
    record.lotSizeRule = 'FOQ';
    record.fixedLotSize = roundSensibly(perDay * rng.float(150, 320), perDay);
    record.periodsOfSupplyDays = null;
    record.minLotSize = null;
    record.maxLotSize = null;
  }

  // --- 5. Batches that expire before their pegged consumption.
  const shelfLife = scenarios.shelfLifeViolation;
  const shelfStock = findStock(shelfLife.itemId, shelfLife.plantId);
  if (shelfStock) {
    shelfStock.unrestricted = shelfLife.batchQty;
    shelfStock.batches = [
      { batchId: 'B-WM003-P2-1', qty: shelfLife.batchQty, expiryDate: addDays(ctx.planningDate, 34) },
    ];
  }
  const perishable = ctx.stock.filter((position) => {
    const item = ctx.items.find((candidate) => candidate.id === position.itemId);
    const perDay = ctx.dailyDemand.get(`${position.itemId}@${position.plantId}`)?.perDay ?? 0;
    return (
      item?.shelfLifeDays !== null && position.batches.length > 0 && perDay > 0 && position.unrestricted / perDay > 40
    );
  });
  for (const position of rng.shuffle(perishable).slice(0, tuning.shelfLifeViolationCount)) {
    const first = position.batches[0];
    if (first) first.expiryDate = addDays(ctx.planningDate, rng.int(12, 30));
  }

  // --- 6. Cross-plant imbalance: one plant rich, another short.
  const imbalance = scenarios.crossPlantImbalance;
  const richStock = findStock(imbalance.itemId, imbalance.richPlantId);
  const poorStock = findStock(imbalance.itemId, imbalance.poorPlantId);
  const richPerDay = ctx.dailyDemand.get(`${imbalance.itemId}@${imbalance.richPlantId}`)?.perDay ?? 0;
  const poorPerDay = ctx.dailyDemand.get(`${imbalance.itemId}@${imbalance.poorPlantId}`)?.perDay ?? 0;
  if (richStock && richPerDay > 0)
    richStock.unrestricted = roundSensibly(richPerDay * imbalance.richCoverDays, richPerDay);
  if (poorStock && poorPerDay > 0)
    poorStock.unrestricted = roundSensibly(poorPerDay * imbalance.poorStockoutDay * 0.7, poorPerDay);

  // --- 7. A shortage with an approved substitute available.
  const substitutable = scenarios.substitutableShortage;
  const substitutableStock = findStock(substitutable.itemId, substitutable.plantId);
  const substitutablePerDay = ctx.dailyDemand.get(`${substitutable.itemId}@${substitutable.plantId}`)?.perDay ?? 0;
  if (substitutableStock && substitutablePerDay > 0) {
    substitutableStock.unrestricted = roundSensibly(substitutablePerDay * 4, substitutablePerDay);
  }
  if (
    !ctx.substitutes.some((entry) => entry.itemId === substitutable.itemId && entry.plantId === substitutable.plantId)
  ) {
    ctx.substitutes.push({
      itemId: substitutable.itemId,
      substituteItemId: substitutable.substituteItemId,
      plantId: substitutable.plantId,
      conversionFactor: 1 + substitutable.costUplift,
      approvalStatus: 'APPROVED',
      note: 'Sunflower lecithin approved as a like-for-like emulsifier; declaration change required on pack.',
    });
  }

  // --- 8. A small number of genuine crises.
  //
  // Real exception queues are not flat: a handful of materials are in serious
  // trouble and the rest is housekeeping. Without this the Pareto the whole
  // product argues for simply is not there — and the ones chosen are the
  // materials that actually carry volume, so the blast radius is real.
  const criticalCandidates = ctx.itemPlants
    .filter(
      (record) =>
        record.itemId.startsWith('RM-') && record.procurementType === 'BUY' && (record.leadTimeDays ?? 0) >= 24
    )
    .map((record) => ({ record, perDay: ctx.dailyDemand.get(`${record.itemId}@${record.plantId}`)?.perDay ?? 0 }))
    .filter((entry) => entry.perDay > 0)
    .sort((a, b) => b.perDay - a.perDay)
    .slice(0, 60);

  for (const { record, perDay } of rng.shuffle(criticalCandidates).slice(0, tuning.criticalShortageCount)) {
    const position = findStock(record.itemId, record.plantId);
    if (!position) continue;
    // Cover runs out inside the lead time, so no order placed today can recover it.
    position.unrestricted = roundSensibly(perDay * rng.float(5, 11), perDay);
    position.batches =
      position.batches.length > 0
        ? [
            {
              ...(position.batches[0] as { batchId: string; qty: number; expiryDate: string | null }),
              qty: position.unrestricted,
            },
          ]
        : [];
    // Strip most of the inbound cover so the gap is real rather than cosmetic.
    let kept = 0;
    ctx.supply = ctx.supply.filter((element) => {
      if (element.itemId !== record.itemId || element.plantId !== record.plantId) return true;
      kept += 1;
      return kept <= 1;
    });
  }

  // --- 9. Safety stock that no longer matches the demand profile.
  const misalignCandidates = ctx.itemPlants.filter(
    (record) =>
      (record.safetyStock ?? 0) > 0 &&
      record.leadTimeDays !== null &&
      (ctx.dailyDemand.get(`${record.itemId}@${record.plantId}`)?.perDay ?? 0) > 0
  );
  for (const record of rng.shuffle(misalignCandidates).slice(0, tuning.safetyStockMisalignedCount)) {
    record.safetyStock = roundSensibly((record.safetyStock ?? 0) * 0.3, record.safetyStock ?? 1);
    record.paramsLastChangedOn = '2022-11-04';
  }

  // --- 9. Genuine duplicate item codes, planted so the detector has something real to find.
  const duplicateCandidates = ctx.items.filter((item) => item.type === 'RM' || item.type === 'PM');
  const byBucket = new Map<string, Item[]>();
  for (const item of duplicateCandidates) {
    const bucketKey = `${item.type}|${item.baseUom}`;
    const bucket = byBucket.get(bucketKey);
    if (bucket) bucket.push(item);
    else byBucket.set(bucketKey, [item]);
  }
  let planted = 0;
  for (const bucket of byBucket.values()) {
    if (planted >= tuning.duplicateItemCount) break;
    const shuffled = rng.shuffle(bucket);
    for (let index = 0; index + 1 < shuffled.length && planted < tuning.duplicateItemCount; index += 2) {
      const original = shuffled[index] as Item;
      const clone = shuffled[index + 1] as Item;
      // The classic case: the same material re-created under a second code with
      // a cosmetically different description.
      clone.description = `${original.description.replace(/,/g, '')} Grade`;
      clone.standardCost = original.standardCost;
      planted += 1;
    }
  }

  // --- 10. BOM lines whose quantity implies a unit conversion nobody defined.
  const crossUom = ctx.boms.filter((line) => {
    if (line.isAlternate) return false;
    const parent = ctx.items.find((item) => item.id === line.parentItemId);
    const component = ctx.items.find((item) => item.id === line.componentItemId);
    return parent && component && parent.baseUom !== component.baseUom;
  });
  for (const line of rng.shuffle(crossUom).slice(0, tuning.uomInconsistencyCount)) {
    line.qtyPer = round(line.qtyPer * 1000, 6);
  }

  // --- 11. Recipes that expire inside the horizon with no successor.
  const parents = [
    ...new Set(ctx.boms.filter((line) => !line.isAlternate).map((line) => `${line.parentItemId}@${line.plantId}`)),
  ];
  for (const parentKey of rng.shuffle(parents).slice(0, tuning.bomValidityGapCount)) {
    const [parentItemId, plantId] = parentKey.split('@') as [string, string];
    const expiry = addDays(ctx.planningDate, rng.int(45, SPEC.horizonDays - 25));
    for (const line of ctx.boms) {
      if (line.parentItemId === parentItemId && line.plantId === plantId && !line.isAlternate) line.validTo = expiry;
    }
  }
}

// ---------------------------------------------------------------------------
// System snapshots — the three versions of the truth
// ---------------------------------------------------------------------------

interface SnapshotContext {
  itemPlants: ItemPlant[];
  stock: StockPosition[];
  demand: DemandElement[];
}

function buildSystemSnapshots(rng: Rng, ctx: SnapshotContext, planningDate: string): SystemSnapshot[] {
  const tuning = SPEC.tuning;
  const scenarios = SPEC.plantedScenarios;

  // Baseline: all three systems agree. Divergences are then planted explicitly,
  // in controlled numbers, so the reconciliation screen shows a real seam rather
  // than random noise.
  const baseParams = ctx.itemPlants.map((record) => ({
    itemId: record.itemId,
    plantId: record.plantId,
    leadTimeDays: record.leadTimeDays,
    safetyStock: record.safetyStock,
    lotSizeRule: record.lotSizeRule as string | null,
  }));
  const baseOnHand = ctx.stock.map((record) => ({
    itemId: record.itemId,
    plantId: record.plantId,
    qty: record.unrestricted,
  }));

  const weeklyByKey = new Map<string, number>();
  for (const element of ctx.demand) {
    if (element.type !== 'FORECAST' && element.type !== 'SALES_ORDER') continue;
    const key = `${element.itemId}|${element.plantId}|${startOfWeek(element.requiredDate)}`;
    weeklyByKey.set(key, (weeklyByKey.get(key) ?? 0) + element.qty);
  }
  const baseBuckets = rng
    .shuffle([...weeklyByKey.keys()])
    .slice(0, 900)
    .map((key) => {
      const [itemId, plantId, weekStart] = key.split('|') as [string, string, string];
      return { itemId, plantId, weekStart, qty: weeklyByKey.get(key) ?? 0 };
    });

  const sapParams = baseParams.map((entry) => ({ ...entry }));
  const kinaxisParams = baseParams.map((entry) => ({ ...entry }));
  const o9Params = baseParams.map((entry) => ({ ...entry }));

  for (const index of rng.shuffle(kinaxisParams.map((_, i) => i)).slice(0, tuning.parameterDriftCount)) {
    const entry = kinaxisParams[index] as (typeof kinaxisParams)[number];
    if (entry.leadTimeDays !== null) entry.leadTimeDays += rng.int(3, 16);
    else if (entry.safetyStock !== null)
      entry.safetyStock = roundSensibly(entry.safetyStock * rng.float(1.3, 2.2), entry.safetyStock);
    else entry.lotSizeRule = 'LFL';
  }

  const sapOnHand = baseOnHand.map((entry) => ({ ...entry }));
  const kinaxisOnHand = baseOnHand.map((entry) => ({ ...entry }));
  for (const index of rng.shuffle(kinaxisOnHand.map((_, i) => i)).slice(0, tuning.inventoryDivergenceCount)) {
    const entry = kinaxisOnHand[index] as (typeof kinaxisOnHand)[number];
    const position = ctx.stock.find((record) => record.itemId === entry.itemId && record.plantId === entry.plantId);
    const unavailable = position ? position.blocked + position.qualityInspection : 0;
    entry.qty = roundSensibly(
      entry.qty + (unavailable > 0 ? unavailable : entry.qty * rng.float(0.1, 0.3)),
      entry.qty || 100
    );
  }

  const scripted = kinaxisOnHand.find(
    (entry) =>
      entry.itemId === scenarios.inventoryDivergence.itemId && entry.plantId === scenarios.inventoryDivergence.plantId
  );
  if (scripted) scripted.qty = scenarios.inventoryDivergence.kinaxisQty;

  const sapBuckets = baseBuckets.map((entry) => ({ ...entry }));
  const kinaxisBuckets = baseBuckets.map((entry) => ({ ...entry }));
  const o9Buckets = baseBuckets.map((entry) => ({ ...entry }));
  for (const index of rng.shuffle(o9Buckets.map((_, i) => i)).slice(0, tuning.demandDivergenceCount)) {
    (o9Buckets[index] as (typeof o9Buckets)[number]).qty = Math.round(
      (o9Buckets[index] as (typeof o9Buckets)[number]).qty * rng.float(1.1, 1.35)
    );
    (kinaxisBuckets[index] as (typeof kinaxisBuckets)[number]).qty = Math.round(
      (kinaxisBuckets[index] as (typeof kinaxisBuckets)[number]).qty * rng.float(0.8, 0.94)
    );
  }

  const absent = scenarios.absentItem;
  for (let week = 0; week < absent.weeks; week += 1) {
    const weekStart = startOfWeek(addDays(planningDate, week * 7 + 21));
    o9Buckets.push({ itemId: absent.itemId, plantId: absent.plantId, weekStart, qty: absent.weeklyQty });
    kinaxisBuckets.push({
      itemId: absent.itemId,
      plantId: absent.plantId,
      weekStart,
      qty: Math.round(absent.weeklyQty * 0.96),
    });
  }

  const plannedPool = rng.shuffle(ctx.itemPlants.filter((record) => record.procurementType !== 'TRANSFER'));
  const sapPlannedOrders = plannedPool.slice(0, 220).map((record, index) => ({
    itemId: record.itemId,
    plantId: record.plantId,
    qty: roundSensibly(2_000 + index * 137, 100),
    dueDate: addDays(planningDate, 14 + (index % 60)),
    createdAt: `${addDays(planningDate, -(2 + (index % 9)))}T06:15:00Z`,
  }));
  const kinaxisPlannedOrders = sapPlannedOrders.map((order) => ({ ...order }));
  for (let index = 0; index < tuning.planNotExecutedCount; index += 1) {
    const record = plannedPool[240 + index];
    if (!record) break;
    kinaxisPlannedOrders.push({
      itemId: record.itemId,
      plantId: record.plantId,
      qty: roundSensibly(6_000 + index * 411, 100),
      dueDate: addDays(planningDate, 21 + index),
      createdAt: `${addDays(planningDate, -4)}T22:40:00Z`,
    });
  }

  return [
    {
      system: 'SAP',
      lastSyncAt: `${planningDate}T04:30:00Z`,
      syncSlaHours: 6,
      recordCount: sapParams.length + sapOnHand.length + sapBuckets.length + sapPlannedOrders.length,
      itemPlantParams: sapParams,
      onHand: sapOnHand,
      demandBuckets: sapBuckets,
      plannedOrders: sapPlannedOrders,
    },
    {
      system: 'KINAXIS',
      lastSyncAt: `${planningDate}T02:10:00Z`,
      syncSlaHours: 12,
      recordCount: kinaxisParams.length + kinaxisOnHand.length + kinaxisBuckets.length + kinaxisPlannedOrders.length,
      itemPlantParams: kinaxisParams,
      onHand: kinaxisOnHand,
      demandBuckets: kinaxisBuckets,
      plannedOrders: kinaxisPlannedOrders,
    },
    {
      // Deliberately stale: the consensus plan is the slowest-moving of the three
      // and the one most often planned against after it has gone out of date.
      system: 'O9',
      lastSyncAt: `${addDays(planningDate, -4)}T23:05:00Z`,
      syncSlaHours: 48,
      recordCount: o9Params.length + o9Buckets.length,
      itemPlantParams: o9Params,
      onHand: [],
      demandBuckets: o9Buckets,
      plannedOrders: [],
    },
  ];
}

// ---------------------------------------------------------------------------

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Exposed for the smoke test's record-count assertions. */
export const CONFECTIONERY_COUNTS = {
  fg: SPEC.counts.fg,
  sfg: Object.values(SFG_COUNTS).reduce((sum, count) => sum + count, 0),
  rm: Object.values(RM_COUNTS).reduce((sum, count) => sum + count, 0),
  pm: Object.values(PM_COUNTS).reduce((sum, count) => sum + count, 0),
  plants: SPEC.plants.length,
  vendors: SPEC.counts.vendors,
};
