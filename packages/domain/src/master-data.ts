/**
 * Master data — the records a planning system treats as settled truth.
 *
 * Nullability here is deliberate and load-bearing: an absent `leadTimeDays` or
 * `lotSizeRule` is not a modelling oversight, it is the exact signal that drives
 * the class-B master data exceptions. Do not tighten these to non-null.
 */

export type ItemType = 'FG' | 'SFG' | 'RM' | 'PM';
export type ProcurementType = 'MAKE' | 'BUY' | 'TRANSFER';
export type LotSizeRule = 'LFL' | 'FOQ' | 'POQ' | 'MINMAX' | 'EOQ';

/** Deterministic | reorder point | no planning. */
export type MrpType = 'PD' | 'VB' | 'ND';

export type AbcClass = 'A' | 'B' | 'C';
export type XyzClass = 'X' | 'Y' | 'Z';

export interface Item {
  id: string;
  description: string;
  type: ItemType;
  baseUom: string;
  /** By consumption value. */
  abcClass: AbcClass;
  /** By demand variability. */
  xyzClass: XyzClass;
  shelfLifeDays: number | null;
  isPhantom: boolean;
  /** Per base UoM. */
  standardCost: number;
  createdOn: string;
}

export interface Plant {
  id: string;
  name: string;
  country: string;
  type: 'OWN' | 'COPACKER';
  calendarId: string;
}

/** The planning master — one row per item per plant. */
export interface ItemPlant {
  itemId: string;
  plantId: string;
  mrpType: MrpType | null;
  procurementType: ProcurementType | null;
  lotSizeRule: LotSizeRule | null;
  /** FOQ. */
  fixedLotSize: number | null;
  minLotSize: number | null;
  maxLotSize: number | null;
  roundingValue: number | null;
  /** POQ. */
  periodsOfSupplyDays: number | null;
  /** VB. */
  reorderPoint: number | null;
  /** Planned delivery time (BUY) or in-house production time (MAKE). */
  leadTimeDays: number | null;
  /** Goods receipt processing time. */
  grProcessingTimeDays: number;
  safetyStock: number | null;
  safetyTimeDays: number;
  /** Assembly scrap, 0–1. */
  scrapPct: number;
  /** 0–1, used for calculated safety stock. */
  serviceLevelTarget: number;
  plannerCode: string | null;
  /** For TRANSFER procurement. */
  sourcePlantId: string | null;
  isPlanningRelevant: boolean;
  /** ISO date the planning parameters were last maintained. Drives freshness scoring. */
  paramsLastChangedOn: string;

  /**
   * How much of this material the plant can physically hold, in base UoM.
   *
   * A binding constraint on the delivery split rather than on the order
   * quantity: the question is not "can we buy this much" but "can this much be
   * on the ground at once".
   */
  storageCapacity: number | null;
  /** How much can be unloaded and put away in one working day, in base UoM. */
  dailyReceivingCapacity: number | null;
  /**
   * Maintained inventory norm, in days. The number a category manager set by
   * hand — kept beside the computed recommendation so the gap can be priced.
   */
  maintainedStockDays: number | null;
  /** Maintained order coverage, in days. Its counterpart on the order side. */
  maintainedOrderDays: number | null;
  /** Days of production the campaign cycle imposes as a floor on stock days. */
  campaignCycleDays: number | null;
}

export interface BomLine {
  parentItemId: string;
  plantId: string;
  componentItemId: string;
  /** Per 1 base UoM of parent. */
  qtyPer: number;
  /** 0–1. */
  componentScrapPct: number;
  validFrom: string;
  validTo: string;
  /** '1' = primary. */
  alternateBomId: string;
  isAlternate: boolean;
}

/** Light capacity model — enough for a load check, not finite scheduling. */
export interface Resource {
  id: string;
  plantId: string;
  name: string;
  dailyCapacityHours: number;
}

export interface ItemRouting {
  itemId: string;
  plantId: string;
  resourceId: string;
  hoursPerBaseUom: number;
}

export interface Vendor {
  id: string;
  name: string;
  /** 0–1, derived from OTIF history. */
  reliabilityScore: number;
}

export interface ItemVendor {
  itemId: string;
  plantId: string;
  vendorId: string;
  isPrimary: boolean;
  leadTimeDays: number;
  moq: number;
  incrementQty: number;
  unitPrice: number;
  dailyCapacity: number | null;
  expediteAvailable: boolean;
  expediteLeadTimeDays: number | null;
  /** Fraction, e.g. 0.35 = +35% on unit price. */
  expediteUnitPriceUplift: number | null;

  /** Share of this material's volume placed with this vendor, 0–1. */
  allocationShare: number;
  /**
   * Largest quantity that can move in one shipment — a full container, a road
   * tanker, a rail rake. Usually the constraint that decides how many delivery
   * lines an order has to have.
   */
  maxShipmentQty: number | null;
  /** Days in transit after dispatch, separate from the vendor's own lead time. */
  transitDays: number;
  /**
   * Soonest this vendor can dispatch, in days from the planning date.
   *
   * Where the first delivery line is required earlier than this, the line is
   * physically impossible — which is worth saying out loud rather than quietly
   * pushing the date out.
   */
  earliestDispatchDays: number;
  /**
   * Imported rather than domestic.
   *
   * Load-bearing: import and domestic lead times must never be pooled into one
   * distribution. They have different means, different variances and different
   * failure modes, and averaging them describes neither.
   */
  isImport: boolean;
}

/** Observed goods-receipt history — the evidence behind B7-LEAD-TIME-DRIFT. */
export interface ReceiptHistory {
  itemId: string;
  plantId: string;
  vendorId: string;
  poId: string;
  orderedOn: string;
  promisedOn: string;
  receivedOn: string;
  qty: number;
  /** receivedOn − orderedOn, in calendar days. */
  actualLeadTimeDays: number;
  /**
   * The delivery line this receipt reconciles to, or null when nothing matched.
   *
   * A real goods-receipt feed never matches cleanly: a receipt lands against a
   * cancelled line, two deliveries arrive consolidated under one document, a
   * batch is returned and reissued. Roughly 4% fall out. They are kept, never
   * dropped — but they are excluded from lead-time reconstruction, because an
   * unmatched receipt has no reliable ordered-on date behind it.
   */
  matchedLineId: string | null;
}

export interface SubstituteItem {
  itemId: string;
  substituteItemId: string;
  plantId: string;
  conversionFactor: number;
  approvalStatus: 'APPROVED' | 'CONDITIONAL' | 'BLOCKED';
  note: string;
}

export interface Calendar {
  id: string;
  /** 0=Sun … 6=Sat. */
  workingDays: number[];
  /** ISO dates. */
  holidays: string[];
}
