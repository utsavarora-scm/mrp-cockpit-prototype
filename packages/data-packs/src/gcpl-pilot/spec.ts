/**
 * The pilot data pack specification — one category, one lead plant, complete
 * depth, exactly as §11 of the PRD recommends.
 *
 * Pure data: vocabulary, archetypes, seasonality, constraints and the pinned
 * scenarios the demo runs through. The generator expands it; the engine and the
 * UI never see any of this terminology.
 *
 * Two hero materials run through the whole thing, because the same engine has
 * to behave very differently for each and that difference *is* the domain:
 *
 *   - a long-lead imported raw material whose real problem is that no purchase
 *     order placed today can reach the shortage at all, and
 *   - a short-lead local packaging material whose real problem is that empty
 *     bottles are mostly air and the warehouse fills before the vendor does.
 *
 * Nothing here is a magic number without a reason beside it. Where a figure is
 * load-bearing for a demo beat, the comment says which beat.
 */

// ---------------------------------------------------------------------------
// The clock. Fixed, never derived — the demo has to repeat exactly.
// ---------------------------------------------------------------------------

/** Monday 31 August 2026. ISO week 36, which is where every worked example starts. */
export const PLANNING_DATE = '2026-08-31';

/** 26 weeks. A raw material on a 90-day lead time is structurally blind below this. */
export const HORIZON_DAYS = 182;

// ---------------------------------------------------------------------------
// Hero A — the long-lead import, and the local twin nothing links it to
// ---------------------------------------------------------------------------

/**
 * RM-30114, PFAD Import.
 *
 * The property that shapes everything is the twin: the same chemistry is
 * available on a 30-day lead time under a different material code, in the same
 * item category. When the import cannot reach a shortage, the twin sometimes
 * can — and that lever is invisible on every planning screen today because
 * nothing joins the two codes anywhere except the material master.
 *
 * The lead-time chain is decomposed rather than quoted as one number, because
 * the whole adherence argument is that a 90-day lead time is four intervals
 * with four different owners and only one of them is the vendor.
 */
export const HERO_RM = {
  itemId: 'RM-30114',
  description: 'Palm Fatty Acid Distillate — Import',
  itemCategoryId: 'CAT-PFAD',
  plantId: 'M014',
  baseUom: 'MT',
  /** Rupees per MT. */
  standardCost: 95_000,

  /** The maintained chain, summing to the 90 days in the material master. */
  vendorId: 'V-IMP-01',
  acknowledgementDays: 3,
  vendorReadinessDays: 35,
  transitDays: 34,
  customsDays: 12,
  grProcessingTimeDays: 2,
  qaQuarantineDays: 4,
  /** 3 + 35 + 34 + 12 + 2 + 4. Asserted in calibration rather than trusted. */
  maintainedLeadTimeDays: 90,

  /** Lot sizing: a vessel parcel is the floor, and it moves in quarter-parcels. */
  moq: 1_000,
  roundingValue: 250,
  /** Tankage. */
  maxLotSize: 4_000,
  safetyStock: 1_400,
  maintainedStockDays: 90,
  maintainedOrderDays: 90,
  maxNormDays: 120,
  paramsLastChangedOn: '2024-03-14',
  paramsLastChangedBy: 'Category planning',
  serviceLevelTarget: 0.95,
  storageCapacity: 6_000,
  dailyReceivingCapacity: 400,
  shelfLifeDays: 365,

  /** Opening position. §5 step 7 opens here. */
  openingStock: 2_750,
  /** Held pending release against the certificate of analysis. Lands in W37. */
  quarantineQty: 250,
  quarantineReleaseDate: '2026-09-10',

  /**
   * The open order the plan is leaning on, and the reason it should not lean
   * so hard. Line 10 is acknowledged; line 20 is not — and line 20 is the only
   * thing standing between the plan and a stock-out.
   */
  openPoId: '4700221',
  openPoLines: [
    { line: 10, qty: 1_150, requestedDate: '2026-09-14', confirmed: true },
    { line: 20, qty: 1_150, requestedDate: '2026-10-05', confirmed: false },
  ],

  /**
   * The eight receipts the measured lead time is reconstructed from, in days
   * from purchase-order release to quality release.
   *
   * Mean 104.0, population standard deviation 11.8 — fourteen days longer than
   * the maintained 90, which is what slides the lead-time fence from W49 to W51
   * when the drift toggle is thrown. Two weeks, on a material where two weeks
   * is a vessel.
   */
  observedTotalDays: [88, 112, 97, 121, 103, 94, 118, 99] as const,

  /**
   * Weekly gross requirement the pre-summer noodle build implies, in MT.
   *
   * The PRD's own table, and the series the whole worked example is read off.
   * Not documentation: the soap ramp above is derived from it by dividing
   * through the chain, so this is what the hero actually nets on.
   */
  weeklyRequirement: [660, 690, 720, 800, 890, 970, 1_030, 1_030] as const,
} as const;

/**
 * RM-30112, PFAD Local — the twin.
 *
 * Same chemistry, same item category, different material code, 30 days instead
 * of 90. It cannot reach W39 or W40 either, but it can reach W41, and it is the
 * only lever on the screen that can.
 */
export const HERO_RM_TWIN = {
  itemId: 'RM-30112',
  description: 'Palm Fatty Acid Distillate — Local',
  itemCategoryId: 'CAT-PFAD',
  plantId: 'M014',
  baseUom: 'MT',
  standardCost: 101_500,
  vendorId: 'V-CHM-01',
  acknowledgementDays: 2,
  vendorReadinessDays: 16,
  transitDays: 8,
  customsDays: 0,
  grProcessingTimeDays: 2,
  qaQuarantineDays: 2,
  maintainedLeadTimeDays: 30,
  moq: 250,
  roundingValue: 50,
  maxLotSize: 2_000,
  safetyStock: 700,
  maintainedStockDays: 45,
  maintainedOrderDays: 45,
  maxNormDays: 70,
  paramsLastChangedOn: '2024-03-14',
  paramsLastChangedBy: 'Category planning',
  serviceLevelTarget: 0.95,
  storageCapacity: 3_000,
  dailyReceivingCapacity: 300,
  shelfLifeDays: 365,
  openingStock: 1_180,
  observedTotalDays: [31, 28, 34, 30, 29, 33, 27, 32] as const,
} as const;

// ---------------------------------------------------------------------------
// Hero B — the short-lead packaging material where the warehouse binds
// ---------------------------------------------------------------------------

/**
 * PM-88431, 45 ml refill bottle.
 *
 * The schedule-builder hero. Two constraints bind and the interesting one is
 * not the one a planner expects: the vendor could supply 250,000 a week, but
 * the plant can only hold 320,000 of this item at once, because empty bottles
 * are almost entirely air. The delta ledger has to name the warehouse, not the
 * vendor — that is the whole beat at 3:45.
 *
 * The vendor's annual maintenance shutdown falls in W39 and stops *production*,
 * not dispatch. Encoding that distinction is what turns a residual exposure a
 * planner has to absorb into one they can close with a phone call.
 */
export const HERO_PM = {
  itemId: 'PM-88431',
  description: '45 ml Refill Bottle — HDPE',
  itemCategoryId: 'CAT-BOTTLE-45',
  plantId: 'M014',
  baseUom: 'EA',
  standardCost: 2.4,

  vendorId: 'V-PKG-01',
  acknowledgementDays: 1,
  vendorReadinessDays: 5,
  transitDays: 2,
  customsDays: 0,
  grProcessingTimeDays: 1,
  qaQuarantineDays: 1,
  /** 1 + 5 + 2 + 1 + 1. */
  maintainedLeadTimeDays: 10,

  /** MOQ per call-off, and one pallet as the rounding value. */
  moq: 100_000,
  roundingValue: 10_000,
  safetyStock: 100_000,
  maintainedStockDays: 21,
  maintainedOrderDays: 21,
  maxNormDays: 35,
  paramsLastChangedOn: '2023-11-02',
  paramsLastChangedBy: 'Packaging development',
  serviceLevelTarget: 0.95,

  /** The volumetric ceiling. Dominant for packaging, and the binding one here. */
  storageCapacity: 320_000,
  dailyReceivingCapacity: 120_000,
  shelfLifeDays: null,

  /** Most the vendor can produce in a week. Deliberately *above* the ceiling. */
  weeklyCapacity: 250_000,
  /** Confirmed on 14 Aug. Production stops; dispatch of built stock does not. */
  shutdownWeeks: ['2026-09-21'] as const,
  minGapDays: 4,

  /**
   * Sized so the campaign opens on the 260,000 pcs the worked example states.
   *
   * W36 carries only the tail of the last promotion — 18,000 pcs — so the
   * position entering W37, which is where the six-week schedule starts, is
   * 278,000 − 18,000. The ceiling still binds and the vendor still does not:
   * 260,000 − 180,000 + 240,000 is exactly the 320,000 the floor holds, which
   * is the finding the worked example exists to produce.
   */
  openingStock: 278_000,
  /** Six-week campaign — fixed-period lot sizing. */
  fixedPeriodDays: 42,

  /**
   * Weekly gross requirement from W36, in pieces — the promotion build the
   * six-week campaign is sized against. Held flat after the promotion ends.
   *
   * W37 onward is the PRD's own table. The refill finished good above is seeded
   * from these figures grossed up for line scrap, so what the *bottle* nets on
   * is exactly what the worked example says it is.
   */
  // The promotion starts in W37; this week carries only the tail of the last one.
  weeklyRequirement: [18_000, 180_000, 210_000, 240_000, 240_000, 200_000, 180_000, 180_000] as const,

  observedTotalDays: [11, 9, 13, 10, 12, 10, 14, 10] as const,
} as const;

// ---------------------------------------------------------------------------
// The soap chain — the conversion factors the explain panel walks back through
// ---------------------------------------------------------------------------

/**
 * Every factor between a soap number the sponsor recognises and a tonne of
 * imported oil.
 *
 * Yields and decisions are kept apart on purpose. The two conversion losses are
 * *process* properties of the distillation and splitting stages; the blend
 * ratio and the source split are *decisions*. A planner disputing the
 * requirement needs to know which of the four they are actually arguing with,
 * and the explain panel separates them because the BOM does.
 */
export const SOAP_CHAIN = {
  /** One 100 g bar, in MT of soap. */
  barWeightMt: 0.0001,
  /** Soap → noodle. A decision about formulation. */
  noodleFactor: 0.9,
  /** Oil content of noodle. A decision about formulation. */
  oilContent: 0.775,
  /** DFA-stage yield. A process property. */
  dfaStageYield: 0.991,
  /** Raw → CFA/DFA conversion yield. A process property. */
  conversionYield: 0.897,
  /** PFAD's share of the hardstearine blend. A decision. */
  pfadBlendShare: 0.5,
  /** Palm kernel oil's share of the same blend. */
  palmKernelBlendShare: 0.3,
  /** Tallow substitute's share. The three sum to one. */
  tallowBlendShare: 0.2,
  /** The 60:40 nobody can defend. A decision, and the subject of Phase 2. */
  importSourceShare: 0.6,
} as const;

/** The intermediates the pinned chain runs through. */
export const CHAIN_ITEMS = {
  noodle: { itemId: 'SFG-20101', description: 'Soap Noodles 80/20 Grade', baseUom: 'MT', cost: 78_000 },
  blend: { itemId: 'SFG-20111', description: 'Hardstearine Oil Blend', baseUom: 'MT', cost: 88_000 },
  /** The horizontal check: the other oils in the same blend. */
  palmKernel: { itemId: 'RM-30121', description: 'Palm Kernel Oil — Import', baseUom: 'MT', cost: 108_000 },
  tallow: { itemId: 'RM-30131', description: 'Tallow Substitute — Blended', baseUom: 'MT', cost: 89_000 },
} as const;

/** The finished goods the pinned chain hangs off. */
export const CHAIN_FG = {
  soap: { itemId: 'FG-10001', description: 'Beauty Soap Bar 100g — Floral', baseUom: 'EA', cost: 22 },
  refill: { itemId: 'FG-10041', description: 'Liquid Handwash Refill 45ml', baseUom: 'EA', cost: 24 },
} as const;

// ---------------------------------------------------------------------------
// The portfolio around the heroes
// ---------------------------------------------------------------------------

export interface ItemArchetype {
  readonly name: string;
  readonly baseUom: string;
  /** Cost per base UoM, in rupees, before per-variant variation. */
  readonly baseCost: number;
  readonly shelfLifeDays: number | null;
  readonly variants: readonly string[];
  /** Materials sharing this are interchangeable in the plan. */
  readonly itemCategoryId?: string;
}

export const PILOT_SPEC = {
  id: 'gcpl-pilot',
  label: 'Soaps and personal wash — pilot category',
  /** Fixed for reproducibility. Never derive this from a clock. */
  seed: 20260831,
  planningDate: PLANNING_DATE,
  horizonDays: HORIZON_DAYS,
  currency: 'INR',

  /**
   * The pilot plant plus the plants its noodle supplies. M014 is where every
   * worked example lives; the others give the control tower a book to count.
   */
  plants: [
    { id: 'M014', name: 'Malanpur', country: 'IN', type: 'OWN', calendarId: 'CAL-PLANT-N' },
    { id: 'P021', name: 'South Region Soap Plant', country: 'IN', type: 'OWN', calendarId: 'CAL-PLANT-S' },
    { id: 'P034', name: 'East Region Soap Plant', country: 'IN', type: 'OWN', calendarId: 'CAL-PLANT-N' },
    { id: 'C041', name: 'North Region Contract Packer', country: 'IN', type: 'COPACKER', calendarId: 'CAL-CP' },
  ],

  /**
   * Plant receiving calendars and vendor dispatch calendars, kept apart.
   *
   * A delivery cannot be scheduled into a day the plant cannot receive on, and
   * a dispatch cannot be scheduled out of a day the vendor is closed. The
   * import origin runs a five-day week, which is why import dispatch windows
   * slip in ways a domestic lane does not.
   */
  calendars: [
    {
      id: 'CAL-PLANT-N',
      /** Six-day week — Sunday off. */
      workingDays: [1, 2, 3, 4, 5, 6],
      holidays: [
        '2026-10-02',
        '2026-10-20',
        '2026-11-08',
        '2026-11-09',
        '2026-12-25',
        '2027-01-26',
        '2027-03-04',
        '2025-10-02',
        '2025-10-21',
        '2025-11-01',
        '2025-12-25',
        '2026-01-26',
        '2026-03-14',
        '2026-08-15',
      ],
    },
    {
      id: 'CAL-PLANT-S',
      workingDays: [1, 2, 3, 4, 5, 6],
      holidays: [
        '2026-10-02',
        '2026-11-08',
        '2026-12-25',
        '2027-01-14',
        '2027-01-26',
        '2025-10-02',
        '2025-12-25',
        '2026-01-14',
        '2026-01-26',
        '2026-08-15',
      ],
    },
    {
      id: 'CAL-CP',
      workingDays: [1, 2, 3, 4, 5, 6],
      holidays: ['2026-10-02', '2026-11-08', '2027-01-26', '2025-10-02', '2026-01-26'],
    },
    {
      /** Import origin — a five-day week. */
      id: 'CAL-VENDOR-IMPORT',
      workingDays: [1, 2, 3, 4, 5],
      holidays: ['2026-12-25', '2027-01-01', '2026-01-01', '2026-05-01', '2026-10-01', '2026-10-02'],
    },
    {
      id: 'CAL-VENDOR-DOM',
      workingDays: [1, 2, 3, 4, 5, 6],
      holidays: ['2026-10-02', '2026-11-08', '2026-12-25', '2027-01-26', '2026-01-26', '2026-08-15'],
    },
  ],

  fgArchetypes: [
    {
      name: 'Beauty Soap Bar 100g',
      baseUom: 'EA',
      baseCost: 22,
      shelfLifeDays: 900,
      variants: ['Floral', 'Sandal', 'Rose', 'Jasmine', 'Almond', 'Milk Cream'],
    },
    {
      name: 'Herbal Soap Bar 100g',
      baseUom: 'EA',
      baseCost: 26,
      shelfLifeDays: 900,
      variants: ['Neem', 'Tulsi', 'Turmeric', 'Aloe'],
    },
    {
      name: 'Glycerine Soap Bar 75g',
      baseUom: 'EA',
      baseCost: 34,
      shelfLifeDays: 720,
      variants: ['Clear', 'Honey', 'Olive'],
    },
    {
      name: 'Carbolic Wash Bar 125g',
      baseUom: 'EA',
      baseCost: 18,
      shelfLifeDays: 900,
      variants: ['Standard', 'Extra'],
    },
    {
      name: 'Body Wash 250ml',
      baseUom: 'EA',
      baseCost: 96,
      shelfLifeDays: 730,
      variants: ['Moisturising', 'Refreshing', 'Sensitive'],
    },
    {
      name: 'Liquid Handwash 200ml',
      baseUom: 'EA',
      baseCost: 58,
      shelfLifeDays: 730,
      variants: ['Germ Protect', 'Moisture', 'Citrus'],
    },
  ],

  sfgArchetypes: [
    {
      name: 'Soap Noodles',
      baseUom: 'MT',
      baseCost: 78_000,
      shelfLifeDays: 365,
      variants: ['90/10 Grade', 'Translucent Grade'],
    },
    {
      name: 'Perfume Compound',
      baseUom: 'KG',
      baseCost: 2_400,
      shelfLifeDays: 540,
      variants: ['Floral', 'Woody', 'Citrus'],
    },
    { name: 'Billet Base', baseUom: 'MT', baseCost: 82_000, shelfLifeDays: 240, variants: ['White', 'Cream'] },
    {
      name: 'Surfactant Slurry',
      baseUom: 'MT',
      baseCost: 64_000,
      shelfLifeDays: 180,
      variants: ['Standard', 'Concentrated'],
    },
  ],

  rmArchetypes: [
    {
      name: 'Caustic Soda Lye',
      baseUom: 'MT',
      baseCost: 41_000,
      shelfLifeDays: null,
      variants: ['Domestic', 'Membrane Grade'],
    },
    { name: 'Glycerine', baseUom: 'MT', baseCost: 87_000, shelfLifeDays: 540, variants: ['Refined', 'Technical'] },
    {
      name: 'Fragrance Concentrate',
      baseUom: 'KG',
      baseCost: 3_100,
      shelfLifeDays: 540,
      variants: ['Import Floral', 'Import Woody', 'Import Fresh', 'Local Floral'],
      itemCategoryId: 'CAT-FRAGRANCE',
    },
    {
      name: 'Additive Premix',
      baseUom: 'KG',
      baseCost: 640,
      shelfLifeDays: 400,
      variants: ['Whitener', 'Preservative', 'Chelator', 'Opacifier'],
    },
    {
      name: 'Colourant',
      baseUom: 'KG',
      baseCost: 1_150,
      shelfLifeDays: 600,
      variants: ['Green', 'Pink', 'Ivory', 'Amber'],
    },
    {
      name: 'Sodium Silicate',
      baseUom: 'MT',
      baseCost: 28_000,
      shelfLifeDays: null,
      variants: ['Neutral', 'Alkaline'],
    },
    {
      name: 'Coconut Fatty Acid',
      baseUom: 'MT',
      baseCost: 112_000,
      shelfLifeDays: 365,
      variants: ['Import', 'Local'],
      itemCategoryId: 'CAT-CFA',
    },
  ],

  pmArchetypes: [
    {
      name: 'Printed Carton',
      baseUom: 'EA',
      baseCost: 3.4,
      shelfLifeDays: null,
      variants: ['75g', '100g', '125g', 'Multipack'],
    },
    {
      name: 'Wrapper Film',
      baseUom: 'KG',
      baseCost: 168,
      shelfLifeDays: null,
      variants: ['Metallised', 'Pearlised', 'Matte'],
    },
    {
      name: 'Label Roll',
      baseUom: 'EA',
      baseCost: 0.9,
      shelfLifeDays: null,
      variants: ['Front', 'Back', 'Neck', 'Promo'],
    },
    { name: 'Shipper Carton', baseUom: 'EA', baseCost: 24, shelfLifeDays: null, variants: ['48s', '72s', '96s'] },
    { name: 'Bottle', baseUom: 'EA', baseCost: 11, shelfLifeDays: null, variants: ['250ml', '500ml', 'Pump 200ml'] },
    {
      name: 'Closure and Pump',
      baseUom: 'EA',
      baseCost: 6.2,
      shelfLifeDays: null,
      variants: ['Flip Top', 'Pump Head', 'Screw Cap'],
    },
    { name: 'Laminate Roll', baseUom: 'KG', baseCost: 212, shelfLifeDays: null, variants: ['3-Ply', '4-Ply'] },
  ],

  /**
   * Vendor pools. Names are synthetic descriptors — no trading partner appears
   * anywhere in this dataset, and a test asserts it.
   */
  vendors: {
    import: { count: 6, prefix: 'V-IMP', leadTimeRange: [45, 105] as const, stdDevRange: [8, 16] as const },
    domesticChemical: { count: 7, prefix: 'V-CHM', leadTimeRange: [18, 35] as const, stdDevRange: [3, 6] as const },
    packaging: { count: 11, prefix: 'V-PKG', leadTimeRange: [7, 21] as const, stdDevRange: [1, 4] as const },
    contract: { count: 3, prefix: 'V-CON', leadTimeRange: [10, 20] as const, stdDevRange: [2, 4] as const },
  },

  /**
   * Demand shape. Soaps are only mildly seasonal, which is exactly the point:
   * the hero's problem is that *lead time* moves, not that demand does.
   */
  seasonality: {
    /** Multiplier by calendar month, January = index 0. */
    monthly: [0.94, 0.93, 1.0, 1.08, 1.15, 1.12, 1.0, 0.98, 1.06, 1.18, 1.1, 0.96] as const,
  },

  /** Months of purchase-order and goods-receipt history to synthesise. */
  historyMonths: 18,

  volumes: {
    /** Daily finished-goods offtake per SKU-plant, units. */
    fgDailyRange: [1_800, 9_000] as const,
    fgStockDaysByClass: { A: [5, 8], B: [9, 14], C: [14, 22] } as const,
    sfgStockDaysRange: [7, 13] as const,
    /** Bought-in cover against the maintained norm. A real book runs from
     * thin to well over its own ceiling, and both ends are findings. */
    boughtStockDaysMultiplier: [0.55, 1.7] as const,
  },
} as const;

/**
 * The drifted block behind the lead-time exceptions on Screen 1.
 *
 * A run of domestic packaging maintained as though it behaved like an import.
 * Without it, "at least one material with lead-time drift greater than 20%" —
 * a stated success criterion — has nothing behind it but the hero.
 */
export const PACKAGING_DRIFT = {
  count: 24,
  maintainedLeadTimeDays: 30,
  observedLeadTimeMean: 18,
  observedLeadTimeStdDev: 4,
} as const;
