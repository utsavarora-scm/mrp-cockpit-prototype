/**
 * The confectionery data pack specification.
 *
 * Pure data — vocabulary, archetypes, seasonality and tuning knobs. The
 * generator expands it; the engine and the UI never see any of this
 * terminology, which is what lets a second pack be dropped in beside it.
 *
 * Anonymisation is enforced here rather than left to discipline: no company,
 * brand, trading-partner or customer name appears anywhere in this file.
 * Descriptions are generic category descriptors, and every identifier is
 * synthetic.
 */

export interface ItemArchetype {
  /** Two-letter code used in item ids, e.g. 'CB' → RM-CB-001. */
  code: string;
  name: string;
  baseUom: string;
  /** Cost per base UoM, before per-variant variation. */
  baseCost: number;
  /** Days of shelf life, or null where it does not apply. */
  shelfLifeDays: number | null;
  /** Descriptive qualifiers that turn one archetype into many items. */
  variants: string[];
}

export const CONFECTIONERY_SPEC = {
  id: 'confectionery',
  label: 'Confectionery manufacturer',
  /** Fixed for reproducibility. Never derive this from a clock. */
  seed: 20260811,
  planningDate: '2026-08-11',
  horizonDays: 180,
  currency: 'USD',

  plants: [
    { id: 'P1', name: 'Northern Moulding Plant', country: 'US', type: 'OWN', calendarId: 'CAL-US' },
    { id: 'P2', name: 'Central Enrobing Plant', country: 'US', type: 'OWN', calendarId: 'CAL-US' },
    { id: 'P3', name: 'Southern Bar Plant', country: 'MX', type: 'OWN', calendarId: 'CAL-MX' },
    { id: 'CP1', name: 'Seasonal Co-packer', country: 'US', type: 'COPACKER', calendarId: 'CAL-US' },
    { id: 'CP2', name: 'Gift Format Co-packer', country: 'MX', type: 'COPACKER', calendarId: 'CAL-MX' },
    { id: 'DC1', name: 'Central Distribution Centre', country: 'US', type: 'OWN', calendarId: 'CAL-US' },
  ],

  calendars: [
    {
      id: 'CAL-US',
      workingDays: [1, 2, 3, 4, 5],
      holidays: [
        '2026-09-07',
        '2026-11-26',
        '2026-11-27',
        '2026-12-24',
        '2026-12-25',
        '2026-12-31',
        '2027-01-01',
        '2027-01-18',
        '2027-02-15',
        '2026-01-01',
        '2026-01-19',
        '2026-02-16',
        '2026-05-25',
        '2026-07-03',
        '2025-09-01',
        '2025-11-27',
        '2025-12-25',
        '2025-01-01',
        '2025-05-26',
        '2025-07-04',
      ],
    },
    {
      id: 'CAL-MX',
      workingDays: [1, 2, 3, 4, 5, 6],
      holidays: [
        '2026-09-16',
        '2026-11-16',
        '2026-12-25',
        '2027-01-01',
        '2027-02-01',
        '2026-02-02',
        '2026-03-16',
        '2026-05-01',
        '2026-12-12',
        '2025-09-16',
        '2025-11-17',
        '2025-12-25',
        '2025-01-01',
        '2025-05-01',
      ],
    },
  ],

  /** Finished goods: category × format, giving a realistic long tail. */
  fgCategories: [
    { code: 'MC', name: 'Milk Chocolate Bar', seasonalAffinity: 'BASE' },
    { code: 'DC', name: 'Dark Chocolate Bar', seasonalAffinity: 'BASE' },
    { code: 'WC', name: 'White Chocolate Bar', seasonalAffinity: 'BASE' },
    { code: 'FB', name: 'Filled Chocolate Bar', seasonalAffinity: 'BASE' },
    { code: 'WF', name: 'Wafer Bar', seasonalAffinity: 'BASE' },
    { code: 'PS', name: 'Praline Selection', seasonalAffinity: 'GIFTING' },
    { code: 'CB', name: 'Caramel Bar', seasonalAffinity: 'BASE' },
    { code: 'CN', name: 'Chocolate Coated Nuts', seasonalAffinity: 'BASE' },
    { code: 'HW', name: 'Seasonal Novelty', seasonalAffinity: 'SEASONAL' },
  ],

  fgFormats: [
    { name: 'Single 43g', grams: 43, priceIndex: 1.0 },
    { name: 'Multipack ×6', grams: 258, priceIndex: 5.2 },
    { name: 'King Size 85g', grams: 85, priceIndex: 1.8 },
    { name: 'Pouch 150g', grams: 150, priceIndex: 3.1 },
    { name: 'Sharing Bag 200g', grams: 200, priceIndex: 3.9 },
    { name: 'Gift Box 250g', grams: 250, priceIndex: 6.4 },
    { name: 'Tin 400g', grams: 400, priceIndex: 10.5 },
    { name: 'Mini Bites 120g', grams: 120, priceIndex: 2.6 },
    { name: 'Twin Pack ×2', grams: 86, priceIndex: 1.9 },
    { name: 'Family Pack 300g', grams: 300, priceIndex: 5.8 },
  ],

  /**
   * Semi-finished goods. `consumesSfg` is what gives the BOM four levels:
   * coating compound is made from chocolate mass, which is made from raws.
   */
  sfgArchetypes: [
    {
      code: 'CM',
      name: 'Milk Chocolate Mass',
      baseUom: 'KG',
      baseCost: 3.42,
      shelfLifeDays: 180,
      variants: ['Standard', 'High Cocoa', 'Reduced Sugar', 'Fine Grind'],
      consumesSfg: null,
    },
    {
      code: 'CD',
      name: 'Dark Chocolate Mass',
      baseUom: 'KG',
      baseCost: 4.05,
      shelfLifeDays: 240,
      variants: ['54% Cocoa', '70% Cocoa', '85% Cocoa', 'Organic Grade'],
      consumesSfg: null,
    },
    {
      code: 'CW',
      name: 'White Chocolate Mass',
      baseUom: 'KG',
      baseCost: 4.6,
      shelfLifeDays: 150,
      variants: ['Standard', 'Vanilla Forward', 'Reduced Sugar'],
      consumesSfg: null,
    },
    {
      code: 'CC',
      name: 'Compound Coating',
      baseUom: 'KG',
      baseCost: 3.1,
      shelfLifeDays: 200,
      variants: ['Milk Base', 'Dark Base', 'White Base', 'Heat Stable'],
      consumesSfg: 'CM',
    },
    {
      code: 'CR',
      name: 'Caramel Filling',
      baseUom: 'KG',
      baseCost: 2.28,
      shelfLifeDays: 120,
      variants: ['Soft Set', 'Chewy', 'Salted', 'Low Water Activity'],
      consumesSfg: null,
    },
    {
      code: 'PP',
      name: 'Praline Paste',
      baseUom: 'KG',
      baseCost: 6.85,
      shelfLifeDays: 150,
      variants: ['Hazelnut', 'Almond', 'Mixed Nut'],
      consumesSfg: null,
    },
    {
      code: 'NG',
      name: 'Nougat Centre',
      baseUom: 'KG',
      baseCost: 2.75,
      shelfLifeDays: 130,
      variants: ['Aerated', 'Dense', 'Honey Style'],
      consumesSfg: null,
    },
    {
      code: 'WS',
      name: 'Wafer Sheet',
      baseUom: 'KG',
      baseCost: 1.94,
      shelfLifeDays: 90,
      variants: ['Plain', 'Cocoa', 'Thin Bake'],
      consumesSfg: null,
    },
    {
      code: 'CI',
      name: 'Crisped Cereal Inclusion',
      baseUom: 'KG',
      baseCost: 2.4,
      shelfLifeDays: 160,
      variants: ['Rice', 'Malt', 'Coated'],
      consumesSfg: null,
    },
    {
      code: 'FC',
      name: 'Fondant Centre',
      baseUom: 'KG',
      baseCost: 1.86,
      shelfLifeDays: 110,
      variants: ['Plain', 'Fruit', 'Mint'],
      consumesSfg: null,
    },
  ] as const satisfies readonly (ItemArchetype & { consumesSfg: string | null })[],

  rmArchetypes: [
    {
      code: 'CL',
      name: 'Cocoa Liquor',
      baseUom: 'KG',
      baseCost: 4.8,
      shelfLifeDays: 365,
      variants: [
        'West African Blend',
        'South American Blend',
        'Natural Process',
        'Alkalised',
        'Fine Flavour',
        'Standard Grade',
        'Organic Certified',
        'Fair Trade Certified',
        'Deodorised',
      ],
    },
    {
      code: 'CB',
      name: 'Cocoa Butter',
      baseUom: 'KG',
      baseCost: 8.2,
      shelfLifeDays: 540,
      variants: [
        'Deodorised',
        'Natural',
        'Pressed Grade A',
        'Pressed Grade B',
        'Organic Certified',
        'Fair Trade Certified',
        'Low Free Fatty Acid',
        'High Stability',
        'Standard',
      ],
    },
    {
      code: 'CP',
      name: 'Cocoa Powder',
      baseUom: 'KG',
      baseCost: 3.6,
      shelfLifeDays: 540,
      variants: [
        '10-12% Fat',
        '20-22% Fat',
        'Alkalised Dark',
        'Alkalised Red',
        'Natural',
        'Black',
        'Low Fat',
        'High Fat',
        'Standard',
      ],
    },
    {
      code: 'SG',
      name: 'Refined Sugar',
      baseUom: 'KG',
      baseCost: 0.72,
      shelfLifeDays: null,
      variants: [
        'Granulated',
        'Caster',
        'Icing',
        'Fine Crystal',
        'Extra Fine',
        'Bulk Liquid',
        'Bakers Special',
        'Coarse',
        'Organic',
      ],
    },
    {
      code: 'SM',
      name: 'Skimmed Milk Powder',
      baseUom: 'KG',
      baseCost: 3.1,
      shelfLifeDays: 365,
      variants: [
        'Low Heat',
        'Medium Heat',
        'High Heat',
        'Instant',
        'Agglomerated',
        'Standard',
        'Organic',
        'Grass Fed',
        'Extra Grade',
      ],
    },
    {
      code: 'WM',
      name: 'Whole Milk Powder',
      baseUom: 'KG',
      baseCost: 3.85,
      shelfLifeDays: 300,
      variants: [
        '26% Fat',
        '28% Fat',
        'Instant',
        'Roller Dried',
        'Spray Dried',
        'Standard',
        'Organic',
        'High Free Fat',
        'Extra Grade',
      ],
    },
    {
      code: 'PO',
      name: 'Palm Oil',
      baseUom: 'KG',
      baseCost: 1.15,
      shelfLifeDays: 270,
      variants: [
        'RBD Stearin',
        'RBD Olein',
        'Fractionated',
        'Fully Hydrogenated',
        'Sustainable Certified',
        'Mid Fraction',
        'Standard',
        'Interesterified',
        'High Melt',
      ],
    },
    {
      code: 'SS',
      name: 'Shea Stearin',
      baseUom: 'KG',
      baseCost: 2.4,
      shelfLifeDays: 300,
      variants: ['Refined', 'Fractionated', 'Sustainable Certified', 'Standard', 'High Stability'],
    },
    {
      code: 'LE',
      name: 'Soy Lecithin',
      baseUom: 'KG',
      baseCost: 2.9,
      shelfLifeDays: 365,
      variants: ['Fluid Grade', 'De-oiled Powder', 'Non-GMO', 'Standard', 'Enzyme Modified'],
    },
    {
      code: 'LS',
      name: 'Sunflower Lecithin',
      baseUom: 'KG',
      baseCost: 3.4,
      shelfLifeDays: 365,
      variants: ['Fluid Grade', 'De-oiled Powder', 'Organic', 'Standard'],
    },
    {
      code: 'AL',
      name: 'Almond Kernels',
      baseUom: 'KG',
      baseCost: 9.5,
      shelfLifeDays: 300,
      variants: [
        'Whole Blanched',
        'Whole Natural',
        'Diced 2-4mm',
        'Slivered',
        'Roasted',
        'Flour',
        'Organic',
        'Extra Grade',
      ],
    },
    {
      code: 'PN',
      name: 'Peanut Kernels',
      baseUom: 'KG',
      baseCost: 2.3,
      shelfLifeDays: 240,
      variants: ['Blanched Splits', 'Roasted Whole', 'Diced', 'Runner Grade', 'Virginia Grade', 'Organic'],
    },
    {
      code: 'HP',
      name: 'Hazelnut Paste',
      baseUom: 'KG',
      baseCost: 11.2,
      shelfLifeDays: 210,
      variants: ['100% Pure', 'Roasted Medium', 'Roasted Dark', 'Blanched', 'Organic'],
    },
    {
      code: 'GS',
      name: 'Glucose Syrup',
      baseUom: 'KG',
      baseCost: 0.95,
      shelfLifeDays: 365,
      variants: ['42 DE', '63 DE', 'High Maltose', 'Low DE', 'Standard'],
    },
    {
      code: 'IS',
      name: 'Invert Sugar Syrup',
      baseUom: 'KG',
      baseCost: 1.1,
      shelfLifeDays: 300,
      variants: ['Standard', 'Total Invert', 'Partial Invert'],
    },
    {
      code: 'WP',
      name: 'Whey Powder',
      baseUom: 'KG',
      baseCost: 2.15,
      shelfLifeDays: 365,
      variants: ['Sweet Whey', 'Demineralised', 'Permeate', 'Concentrate 34%', 'Standard'],
    },
    {
      code: 'VF',
      name: 'Vanilla Flavour',
      baseUom: 'KG',
      baseCost: 46.0,
      shelfLifeDays: 730,
      variants: ['Natural Extract', 'Natural Bourbon', 'Nature Identical', 'Encapsulated'],
    },
    {
      code: 'SL',
      name: 'Salt',
      baseUom: 'KG',
      baseCost: 0.35,
      shelfLifeDays: null,
      variants: ['Fine Vacuum', 'Sea Salt Flake', 'Microniser Grade'],
    },
    {
      code: 'CA',
      name: 'Citric Acid',
      baseUom: 'KG',
      baseCost: 1.9,
      shelfLifeDays: 730,
      variants: ['Anhydrous', 'Monohydrate', 'Fine Granular'],
    },
    {
      code: 'WT',
      name: 'Wafer Flour',
      baseUom: 'KG',
      baseCost: 0.68,
      shelfLifeDays: 180,
      variants: ['Soft Wheat', 'Low Protein', 'Standard'],
    },
  ] as const satisfies readonly ItemArchetype[],

  pmArchetypes: [
    {
      code: 'WF',
      name: 'Wrapper Film',
      baseUom: 'M2',
      baseCost: 0.062,
      shelfLifeDays: null,
      variants: [
        'Metallised BOPP 25µm',
        'Metallised BOPP 30µm',
        'Clear BOPP 25µm',
        'Pearlised BOPP',
        'Flow-wrap Laminate',
        'Cold Seal Coated',
        'Heat Seal Coated',
        'Recyclable Mono-material',
        'Matt Finish',
        'High Barrier',
        'Printed 4-colour',
        'Printed 6-colour',
        'Printed 8-colour',
        'Unprinted Reel',
        'Seasonal Print',
      ],
    },
    {
      code: 'CT',
      name: 'Folding Carton',
      baseUom: 'EA',
      baseCost: 0.084,
      shelfLifeDays: null,
      variants: [
        'GC1 300gsm',
        'GC2 350gsm',
        'FBB 320gsm',
        'Litho Laminated',
        'Foil Blocked',
        'Embossed',
        'Window Patched',
        'Recycled Board',
        'Seasonal Print',
        'Standard Print',
      ],
    },
    {
      code: 'CG',
      name: 'Corrugated Shipper',
      baseUom: 'EA',
      baseCost: 0.31,
      shelfLifeDays: null,
      variants: [
        'B Flute Single Wall',
        'C Flute Single Wall',
        'BC Flute Double Wall',
        'E Flute Retail Ready',
        'Shelf Ready Tray',
        'Printed 1-colour',
        'Printed 2-colour',
        'Kraft Plain',
      ],
    },
    {
      code: 'LB',
      name: 'Pressure Sensitive Label',
      baseUom: 'EA',
      baseCost: 0.021,
      shelfLifeDays: null,
      variants: [
        'Paper Semi-gloss',
        'Clear Polypropylene',
        'White Polypropylene',
        'Tamper Evident',
        'Promotional Overlay',
        'Multilingual',
        'Batch Coded',
      ],
    },
    {
      code: 'LM',
      name: 'Laminate Pouch Web',
      baseUom: 'M2',
      baseCost: 0.148,
      shelfLifeDays: null,
      variants: [
        'PET/ALU/PE',
        'PET/MET-PET/PE',
        'Paper/PE Recyclable',
        'Mono-PE Recyclable',
        'High Barrier Triplex',
        'Standing Pouch Grade',
        'Resealable Grade',
      ],
    },
    {
      code: 'TR',
      name: 'Thermoformed Tray',
      baseUom: 'EA',
      baseCost: 0.096,
      shelfLifeDays: null,
      variants: [
        'rPET Clear',
        'rPET Black',
        'PP Natural',
        'Moulded Fibre',
        'Compostable',
        'Gift Insert 12-cavity',
        'Gift Insert 24-cavity',
      ],
    },
    {
      code: 'RB',
      name: 'Printed Ribbon',
      baseUom: 'M',
      baseCost: 0.018,
      shelfLifeDays: null,
      variants: ['Satin 15mm', 'Satin 25mm', 'Grosgrain 20mm', 'Seasonal Print', 'Metallic'],
    },
    {
      code: 'TN',
      name: 'Lithographed Tin',
      baseUom: 'EA',
      baseCost: 1.24,
      shelfLifeDays: null,
      variants: ['Round 400g', 'Rectangular 400g', 'Hinged Lid', 'Embossed Lid', 'Seasonal Print'],
    },
    {
      code: 'SH',
      name: 'Shrink Sleeve',
      baseUom: 'EA',
      baseCost: 0.034,
      shelfLifeDays: null,
      variants: ['PETG', 'OPS', 'Perforated', 'Full Body', 'Promotional'],
    },
    {
      code: 'IN',
      name: 'Interleaving Sheet',
      baseUom: 'EA',
      baseCost: 0.009,
      shelfLifeDays: null,
      variants: ['Greaseproof', 'Waxed', 'Plain'],
    },
  ] as const satisfies readonly ItemArchetype[],

  /** Channel mix. Margins and priorities differ, which drives the ranking model. */
  channels: [
    { id: 'MT', name: 'Modern Trade', share: 0.42, marginRate: 0.28, priority: 2, priceIndex: 1.0 },
    { id: 'GT', name: 'General Trade', share: 0.31, marginRate: 0.34, priority: 3, priceIndex: 1.06 },
    { id: 'ECOM', name: 'E-commerce', share: 0.14, marginRate: 0.41, priority: 2, priceIndex: 1.18 },
    { id: 'EXPORT', name: 'Export', share: 0.13, marginRate: 0.22, priority: 4, priceIndex: 0.92 },
  ],

  /**
   * Named accounts are synthetic descriptors, never real trading partners. The
   * demo names them out loud, so they must be obviously generic.
   */
  accountDescriptors: [
    'Northeast MT Account',
    'Southeast MT Account',
    'Midwest MT Account',
    'West Coast MT Account',
    'National Grocery Account',
    'Convenience Chain Account',
    'Club Store Account',
    'Regional Wholesaler',
    'Metro Distributor',
    'Value Retail Account',
    'Pharmacy Chain Account',
    'Forecourt Account',
    'Online Marketplace Account',
    'Direct-to-Consumer Store',
    'Subscription Channel',
    'Export Distributor North',
    'Export Distributor South',
    'Duty Free Account',
  ],

  /** Monthly demand multipliers by seasonal affinity. Index 0 = January. */
  seasonality: {
    BASE: [0.96, 1.02, 1.0, 0.94, 0.92, 0.88, 0.86, 0.9, 1.04, 1.12, 1.18, 1.18],
    SEASONAL: [1.15, 1.34, 1.42, 0.62, 0.48, 0.4, 0.44, 0.78, 1.62, 1.94, 1.72, 1.49],
    GIFTING: [1.28, 1.46, 1.1, 0.72, 0.66, 0.6, 0.58, 0.7, 1.06, 1.3, 1.66, 1.88],
  },

  counts: { fg: 450, sfg: 120, rm: 180, pm: 150, vendors: 40 },

  /**
   * Calibration knobs. The target band is roughly 1,200–1,400 exceptions and
   * $17–20M of exposure, with the top 12 carrying about 70% of it. The Pareto
   * shape is the point of the demo, so these are tuned rather than guessed —
   * `pnpm calibrate` prints where a change lands.
   */
  tuning: {
    /** Share of item-plants whose order book under-covers the horizon. */
    shortagePressure: 0.055,
    /** Share whose order book over-covers it — the working-capital side. */
    excessPressure: 0.07,
    /** Materials in genuine trouble: the head of the Pareto. */
    criticalShortageCount: 12,
    /** Share of item-plants with an incomplete planning master. */
    incompleteMasterRate: 0.045,
    /** Share of item-plants with idle stock and no demand. */
    orphanRate: 0.017,
    /** Share of BUY item-plants whose observed lead time has drifted. */
    leadTimeDriftRate: 0.036,
    /** Item-plants whose maintained safety stock no longer matches demand. */
    safetyStockMisalignedCount: 90,
    /** Item-plants whose lead time differs between SAP and Kinaxis. */
    parameterDriftCount: 63,
    /** Kinaxis planned orders with no SAP counterpart. */
    planNotExecutedCount: 18,
    /** Item-plants whose on-hand differs between SAP and Kinaxis. */
    inventoryDivergenceCount: 16,
    /** Item-plant weeks where the three demand figures disagree. */
    demandDivergenceCount: 55,
    /** Packaging items given an oversized fixed lot. */
    lotSizeExcessCount: 38,
    /** Batches that expire before their pegged consumption. */
    shelfLifeViolationCount: 14,
    /** BOMs expiring inside the horizon with no successor. */
    bomValidityGapCount: 8,
    /** Deliberate near-duplicate item codes. */
    duplicateItemCount: 22,
    /** BOM lines with an implausible cross-UoM quantity. */
    uomInconsistencyCount: 4,
  },

  /**
   * The scripted scenarios the demo narrative depends on. Each is produced by
   * seeded facts, never by injecting an exception row — the engine has to
   * genuinely detect them or the demo does not survive being questioned.
   */
  plantedScenarios: {
    /** Scenario 1 — the hero. Cocoa butter maintained at 21 days, really 38. */
    leadTimeDrift: {
      itemId: 'RM-CB-001',
      plantId: 'P1',
      vendorId: 'VEND-114',
      maintainedLeadTimeDays: 21,
      observedLeadTimeDays: [36, 41, 37, 34, 40, 40],
      paramsLastChangedOn: '2023-06-11',
      safetyStock: 15000,
      fixedLotSize: 25000,
      roundingValue: 1000,
    },
    /** Scenario 2 — a seasonal launch with demand in o9 and Kinaxis, absent in SAP. */
    absentItem: {
      itemId: 'FG-HW-117',
      plantId: 'CP1',
      weeklyQty: 42000,
      weeks: 9,
    },
    /** Scenario 3 — Kinaxis plans on 40,000; SAP holds 12,000 free and 28,000 blocked. */
    inventoryDivergence: {
      itemId: 'SFG-CR-004',
      plantId: 'P2',
      kinaxisQty: 40000,
      sapUnrestricted: 12000,
      sapBlocked: 28000,
    },
    /** Scenario 4 — wrapper film ordered 500,000 at a time against 1,300/day. */
    lotSizeExcess: {
      itemId: 'PM-WF-021',
      plantId: 'P1',
      fixedLotSize: 500000,
      dailyDemand: 1300,
    },
    /** Scenario 5 — a milk powder batch expiring 11 days before it is consumed. */
    shelfLifeViolation: {
      itemId: 'RM-WM-003',
      plantId: 'P2',
      batchQty: 46000,
      daysBeforeConsumption: 11,
    },
    /** Scenario 6 — P1 holds 210 days of caramel cover while P3 stocks out on day 22. */
    crossPlantImbalance: {
      itemId: 'SFG-CR-001',
      richPlantId: 'P1',
      poorPlantId: 'P3',
      richCoverDays: 210,
      poorStockoutDay: 22,
    },
    /** Scenario 7 — lecithin short, with an approved substitute at +4%. */
    substitutableShortage: {
      itemId: 'RM-LE-001',
      substituteItemId: 'RM-LS-001',
      plantId: 'P2',
      costUplift: 0.04,
    },
  },
} as const;

export type ConfectionerySpec = typeof CONFECTIONERY_SPEC;
