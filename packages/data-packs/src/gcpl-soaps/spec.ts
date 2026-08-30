/**
 * The soaps and personal wash data pack specification.
 *
 * Pure data — vocabulary, archetypes, seasonality and tuning knobs. The
 * generator expands it; the engine and the UI never see any of this
 * terminology, which is what lets a second pack be dropped in beside it.
 *
 * Anonymisation is enforced here rather than left to discipline: no company,
 * brand, trading-partner or customer name appears anywhere in this file. Plants
 * are P1–P4 with region labels only, descriptions are generic category
 * descriptors, and every identifier is synthetic. This dataset is shown to the
 * client, so that is a release gate rather than housekeeping.
 */

export interface ItemArchetype {
  /** Two-letter code used in item ids, e.g. 'PD' → RM-PD-001. */
  readonly code: string;
  readonly name: string;
  readonly baseUom: string;
  /** Cost per base UoM, in rupees, before per-variant variation. */
  readonly baseCost: number;
  readonly shelfLifeDays: number | null;
  /** Descriptive qualifiers that turn one archetype into many items. */
  readonly variants: readonly string[];
}

/**
 * The hero material of Act 1 — an imported palm derivative at one plant.
 *
 * Every figure here is load-bearing and traces to Brief Appendix A.1. The
 * fourteen observed lead times below have a mean of exactly 47.0 days and a
 * population standard deviation of exactly 11.0, which is what makes the
 * naive and combined safety-stock answers come out at 121 MT and 914 MT — a
 * factor of 7.6, with 98% of the buffer attributable to lead-time movement
 * rather than demand movement.
 *
 * Population rather than sample standard deviation is deliberate and is the
 * convention the engine already uses (`summariseObservedLeadTimes`). It also
 * happens to be the only one reachable here: with an integer mean and integer
 * observations, a sample standard deviation of exactly 11 is arithmetically
 * impossible, because the sum of squared deviations would have to be odd.
 */
export const HERO = {
  itemId: 'RM-PD-001',
  plantId: 'P1',
  vendorId: 'V-IMP-01',
  /** Rupees per MT. */
  standardCost: 95_000,
  /** Mean daily consumption, MT. */
  dailyDemandMean: 42,
  /** Standard deviation of daily consumption, MT. */
  dailyDemandStdDev: 9,
  /** What a category manager maintained, and has not revisited since. */
  maintainedStockDays: 45,
  maintainedOrderDays: 45,
  paramsLastChangedOn: '2024-03-14',
  serviceLevelTarget: 0.975,

  /**
   * The fourteen receipts the recommendation is reconstructed from, in the
   * order they arrived — most recent first. Mean 47.0, population standard
   * deviation 11.0, verified in the calibration test rather than trusted.
   *
   * The order is load-bearing, not cosmetic. Sorted ascending, the most recent
   * receipts would be the *shortest*, and any recency weighting — the norms
   * engine defaults to a 90-day half-life — would reconstruct about 36 days
   * instead of 47, quietly destroying the finding. Interleaving high and low
   * leaves the series with no time trend: every trailing window averages ~47,
   * so the answer is stable however the evidence is weighted.
   */
  observedLeadTimes: [64, 32, 62, 32, 61, 34, 55, 35, 55, 41, 51, 43, 50, 43] as const,

  /**
   * Receipts that will not match a delivery line — a goods receipt against a
   * cancelled line, a consolidated delivery, a returned-and-reissued batch.
   *
   * Seeded on purpose. Roughly 4% of receipts fail to match in any real feed,
   * and an unmatched queue with nothing in it demonstrates nothing. These are
   * excluded from the lead-time reconstruction, which is why seventeen receipts
   * are seeded to produce the fourteen the demo clicks through.
   */
  unmatchedLeadTimes: [39, 48, 58] as const,

  /** Order-splitting constraints, Brief §6 Act 1 at 2:10 and 2:45. */
  requirementMt: 2_520,
  moq: 200,
  incrementQty: 20,
  maxShipmentQty: 600,
  /**
   * Plant storage, MT. Peak on-hand under the five-line split is the computed
   * buffer (914 MT) plus one line (500 MT) = 1,414 MT, so storage binds on peak
   * holding. Set at 1,300 rather than 1,400 to leave a ~9% margin: at 1,400 the
   * overage is 1%, and a demo beat that disappears when the engine is retuned
   * by a hair is not a demo beat.
   */
  storageCapacity: 1_300,
  dailyReceivingCapacity: 120,
  transitDays: 12,
  /**
   * The vendor cannot dispatch for 19 days. The first line is required 7 days
   * before that is physically possible — Brief §6 Act 1 at 2:45.
   */
  earliestDispatchDays: 19,
  infeasibleGapDays: 7,
} as const;

/**
 * The second planted scenario on the norms side: a large block of domestic
 * packaging maintained at 45 days against an 18-day reality.
 *
 * This is what generates the cockpit's excess-capital hero at 0:00. Without it
 * the biggest number on the landing screen has nothing behind it.
 */
export const PACKAGING_DRIFT = {
  count: 40,
  maintainedStockDays: 45,
  observedLeadTimeMean: 18,
  observedLeadTimeStdDev: 4,
} as const;

/**
 * The dual-sourced material where the two vendors are not interchangeable.
 *
 * Same material, same plant, 60/40 split, and an 85th-percentile lead time of
 * 34 days against 71. A single blended vendor score would hide exactly the
 * variance the norms engine needs to see.
 */
export const DUAL_SOURCED = {
  itemId: 'RM-FR-002',
  plantId: 'P1',
  primary: { vendorId: 'V-IMP-02', share: 0.6, p85Days: 34, meanDays: 28, stdDevDays: 6 },
  secondary: { vendorId: 'V-IMP-03', share: 0.4, p85Days: 71, meanDays: 58, stdDevDays: 12.5 },
} as const;

export const GCPL_SOAPS_SPEC = {
  id: 'gcpl-soaps',
  label: 'Soaps and personal wash',
  /** Fixed for reproducibility. Never derive this from a clock. */
  seed: 20260830,
  planningDate: '2026-08-30',
  horizonDays: 180,
  currency: 'INR',

  /** Region labels only — no site names, no locations that identify a real plant. */
  plants: [
    { id: 'P1', name: 'West Region Soap Plant', country: 'IN', type: 'OWN', calendarId: 'CAL-IN' },
    { id: 'P2', name: 'North Region Soap Plant', country: 'IN', type: 'OWN', calendarId: 'CAL-IN' },
    { id: 'P3', name: 'South Region Soap Plant', country: 'IN', type: 'OWN', calendarId: 'CAL-IN-S' },
    { id: 'P4', name: 'East Region Contract Packer', country: 'IN', type: 'COPACKER', calendarId: 'CAL-CP' },
  ],

  calendars: [
    {
      id: 'CAL-IN',
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
        '2027-03-29',
        '2027-08-15',
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
      id: 'CAL-IN-S',
      workingDays: [1, 2, 3, 4, 5, 6],
      holidays: [
        '2026-10-02',
        '2026-11-08',
        '2026-12-25',
        '2027-01-14',
        '2027-01-26',
        '2027-04-14',
        '2027-08-15',
        '2025-10-02',
        '2025-12-25',
        '2026-01-14',
        '2026-01-26',
        '2026-04-14',
        '2026-08-15',
      ],
    },
    {
      id: 'CAL-CP',
      workingDays: [1, 2, 3, 4, 5, 6],
      holidays: ['2026-10-02', '2026-11-08', '2027-01-26', '2027-08-15', '2025-10-02', '2026-01-26'],
    },
    {
      /** Import origin — a five-day week, which is why dispatch windows slip. */
      id: 'CAL-IMPORT',
      workingDays: [1, 2, 3, 4, 5],
      holidays: ['2026-12-25', '2027-01-01', '2026-01-01', '2026-05-01', '2027-05-01'],
    },
  ],

  /** Finished goods: soap bars and personal wash, in the formats a category sells. */
  fgArchetypes: [
    {
      code: 'BS',
      name: 'Beauty Soap Bar',
      baseUom: 'EA',
      baseCost: 22,
      shelfLifeDays: 900,
      variants: ['Floral', 'Sandal', 'Rose', 'Jasmine', 'Almond', 'Milk Cream'],
    },
    {
      code: 'HS',
      name: 'Herbal Soap Bar',
      baseUom: 'EA',
      baseCost: 26,
      shelfLifeDays: 900,
      variants: ['Neem', 'Tulsi', 'Turmeric', 'Aloe'],
    },
    {
      code: 'GS',
      name: 'Glycerine Soap Bar',
      baseUom: 'EA',
      baseCost: 34,
      shelfLifeDays: 720,
      variants: ['Clear', 'Honey', 'Olive'],
    },
    {
      code: 'CW',
      name: 'Carbolic Wash Bar',
      baseUom: 'EA',
      baseCost: 18,
      shelfLifeDays: 900,
      variants: ['Standard', 'Extra'],
    },
    {
      code: 'BW',
      name: 'Body Wash',
      baseUom: 'EA',
      baseCost: 96,
      shelfLifeDays: 730,
      variants: ['Moisturising', 'Refreshing', 'Sensitive'],
    },
    {
      code: 'HW',
      name: 'Hand Wash',
      baseUom: 'EA',
      baseCost: 58,
      shelfLifeDays: 730,
      variants: ['Germ Protect', 'Moisture', 'Citrus'],
    },
  ],

  /** Semi-finished: the intermediate a soap plant actually makes and holds. */
  sfgArchetypes: [
    {
      code: 'SN',
      name: 'Soap Noodles',
      baseUom: 'MT',
      baseCost: 78_000,
      shelfLifeDays: 365,
      variants: ['80/20 Grade', '90/10 Grade', 'Translucent Grade'],
    },
    {
      code: 'PC',
      name: 'Perfume Compound',
      baseUom: 'KG',
      baseCost: 2_400,
      shelfLifeDays: 540,
      variants: ['Floral Blend', 'Woody Blend', 'Citrus Blend'],
    },
    {
      code: 'BB',
      name: 'Billet Base',
      baseUom: 'MT',
      baseCost: 82_000,
      shelfLifeDays: 240,
      variants: ['White', 'Cream', 'Green'],
    },
    {
      code: 'SL',
      name: 'Surfactant Slurry',
      baseUom: 'MT',
      baseCost: 64_000,
      shelfLifeDays: 180,
      variants: ['Standard', 'Concentrated'],
    },
  ],

  /**
   * Raw materials. The imported oleochemicals are the volatile ones: long lead
   * times, wide variance, and priced in a currency nobody here controls.
   */
  rmArchetypes: [
    {
      code: 'PD',
      name: 'Palm Fatty Acid Distillate',
      baseUom: 'MT',
      baseCost: 95_000,
      shelfLifeDays: 365,
      variants: ['Imported', 'Imported Grade II'],
    },
    {
      code: 'PK',
      name: 'Palm Kernel Oil',
      baseUom: 'MT',
      baseCost: 108_000,
      shelfLifeDays: 365,
      variants: ['Imported', 'RBD'],
    },
    {
      code: 'FR',
      name: 'Fragrance Concentrate',
      baseUom: 'KG',
      baseCost: 3_100,
      shelfLifeDays: 540,
      variants: ['Imported Floral', 'Imported Woody', 'Imported Fresh'],
    },
    {
      code: 'CS',
      name: 'Caustic Soda Lye',
      baseUom: 'MT',
      baseCost: 41_000,
      shelfLifeDays: null,
      variants: ['Domestic', 'Membrane Grade'],
    },
    {
      code: 'GL',
      name: 'Glycerine',
      baseUom: 'MT',
      baseCost: 87_000,
      shelfLifeDays: 540,
      variants: ['Refined', 'Technical'],
    },
    {
      code: 'TA',
      name: 'Tallow Substitute',
      baseUom: 'MT',
      baseCost: 89_000,
      shelfLifeDays: 365,
      variants: ['Imported', 'Blended'],
    },
    {
      code: 'AD',
      name: 'Additive Premix',
      baseUom: 'KG',
      baseCost: 640,
      shelfLifeDays: 400,
      variants: ['Whitener', 'Preservative', 'Chelator', 'Opacifier'],
    },
    {
      code: 'CO',
      name: 'Colourant',
      baseUom: 'KG',
      baseCost: 1_150,
      shelfLifeDays: 600,
      variants: ['Green', 'Pink', 'Ivory', 'Amber'],
    },
  ],

  /**
   * Packaging. Domestic, short lead times, tight variance — and maintained as
   * though it behaved like an import. That gap is the cockpit's opening number.
   */
  pmArchetypes: [
    {
      code: 'CT',
      name: 'Printed Carton',
      baseUom: 'EA',
      baseCost: 3.4,
      shelfLifeDays: null,
      variants: ['75g', '100g', '125g', '150g', 'Multipack'],
    },
    {
      code: 'WR',
      name: 'Wrapper Film',
      baseUom: 'KG',
      baseCost: 168,
      shelfLifeDays: null,
      variants: ['Metallised', 'Pearlised', 'Matte'],
    },
    {
      code: 'LB',
      name: 'Label Roll',
      baseUom: 'EA',
      baseCost: 0.9,
      shelfLifeDays: null,
      variants: ['Front', 'Back', 'Neck', 'Promo'],
    },
    {
      code: 'SC',
      name: 'Shipper Carton',
      baseUom: 'EA',
      baseCost: 24,
      shelfLifeDays: null,
      variants: ['48s', '72s', '96s'],
    },
    {
      code: 'BT',
      name: 'Bottle',
      baseUom: 'EA',
      baseCost: 11,
      shelfLifeDays: null,
      variants: ['250ml', '500ml', 'Pump 200ml'],
    },
    {
      code: 'CP',
      name: 'Closure and Pump',
      baseUom: 'EA',
      baseCost: 6.2,
      shelfLifeDays: null,
      variants: ['Flip Top', 'Pump Head', 'Screw Cap'],
    },
    {
      code: 'LM',
      name: 'Laminate Roll',
      baseUom: 'KG',
      baseCost: 212,
      shelfLifeDays: null,
      variants: ['3-Ply', '4-Ply'],
    },
  ],

  /** Vendor pools. Names are synthetic descriptors, never trading partners. */
  vendors: {
    import: { count: 8, prefix: 'V-IMP', leadTimeRange: [35, 70] as const, stdDevRange: [8, 14] as const },
    domesticChemical: { count: 9, prefix: 'V-CHM', leadTimeRange: [12, 25] as const, stdDevRange: [2, 5] as const },
    packaging: { count: 14, prefix: 'V-PKG', leadTimeRange: [7, 22] as const, stdDevRange: [1, 4] as const },
    contract: { count: 4, prefix: 'V-CON', leadTimeRange: [10, 20] as const, stdDevRange: [2, 4] as const },
  },

  /**
   * Demand shape. Soaps are only mildly seasonal — a summer lift on wash
   * frequency and a festive gifting peak — which is exactly the point: Act 1's
   * norm is wrong because *lead time* moves, not because demand does.
   */
  seasonality: {
    /** Multiplier by calendar month, January = index 0. */
    monthly: [0.94, 0.93, 1.0, 1.08, 1.15, 1.12, 1.0, 0.98, 1.06, 1.18, 1.1, 0.96] as const,
    /** Extra lift in the fortnight before the festive peak. */
    festivePeakMultiplier: 1.22,
  },

  /** Months of purchase-order and goods-receipt history to synthesise. */
  historyMonths: 24,

  /**
   * Volume and holding knobs, tuned to land category inventory in the target
   * band below. The hero chain is exempt: its consumption is fixed by Brief
   * A.1 at 42 MT a day and is not a free parameter.
   *
   * Holding days differ sharply by stage, which is the realistic shape and also
   * the reason an untuned dataset lands an order of magnitude high: finished
   * goods and work in progress turn in days, while bought-in materials sit for
   * as long as the maintained norm says they should. Only the last of those is
   * what this product is arguing about.
   */
  volumes: {
    /** Daily finished-goods offtake per SKU-plant, units. */
    fgDailyRange: [300, 1_800] as const,
    fgStockDaysRange: [5, 11] as const,
    sfgStockDaysRange: [2, 5] as const,
    /** Bought-in materials are held against the maintained norm — the story. */
    boughtStockDaysMultiplier: [0.7, 1.25] as const,
  },

  /** Calibration targets, asserted rather than hoped for. */
  targets: {
    categoryInventoryCr: [40, 60] as const,
    normGapCr: [8, 14] as const,
  },
} as const;
