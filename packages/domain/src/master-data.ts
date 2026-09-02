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
  /**
   * The chemistry or specification this material *is*, independent of who
   * supplies it.
   *
   * Load-bearing, and invisible in every planning screen the client has today.
   * An imported oil and its local twin are two material codes with two lead
   * times and one item category: when the import cannot reach a shortage, the
   * twin sometimes can. Nothing links them on a planning screen today, which is
   * why the lever is never used. Null where a material has no equivalent.
   */
  itemCategoryId: string | null;
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
  /**
   * The complete planning lead time: purchase-order release to available for
   * consumption, in calendar days. **Not** the vendor's quoted number.
   *
   * It is the sum of all six intervals — vendor response, vendor readiness,
   * transit, customs, goods receipt and quality release — so `leadTimeChain`
   * decomposes it and netting offsets by it, and the two cannot disagree. Most
   * systems store the manufacturing time here and omit the rest, which is a
   * large, systematic understatement and the reason plans that look fine on
   * paper break at the dock.
   *
   * It belongs to the **primary planning source** — the vendor MRP nets on. An
   * alternate vendor on the same material has its own chain, summed from that
   * vendor's own record; see `alternateLeadTimeChain`.
   *
   * For MAKE items it is in-house production time, walked in working days.
   */
  leadTimeDays: number | null;
  /** Goods receipt processing time — gate-in to put-away. Inside `leadTimeDays`. */
  grProcessingTimeDays: number;
  /**
   * Days a receipt sits in quality inspection before it counts as stock.
   *
   * Not a rounding detail. Material in QA has not entered available inventory,
   * so a plan that counts it is optimistic by exactly this many days — and when
   * a batch fails and moves to blocked, the quantity leaves the balance at once
   * and every downstream bucket goes negative together.
   *
   * Inside `leadTimeDays`, like `grProcessingTimeDays`. Held separately because
   * the interval has its own owner and its own measured slip.
   */
  qaQuarantineDays: number;
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
   * Who last maintained them.
   *
   * Provenance is a person as well as a date. "Safety stock, set March 2024"
   * invites the question the planner actually has — *by whom, and are they
   * still here* — and a trust layer that cannot answer it has stopped one
   * question short.
   */
  paramsLastChangedBy: string;

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
  /**
   * The upper coverage norm, in days — the line above which stock reads as
   * excess. Drawn on the projection chart opposite safety stock, because a
   * planner defending a floor with no ceiling ends up defending it with cash.
   */
  maxNormDays: number | null;
  /** Days of production the campaign cycle imposes as a floor on stock days. */
  campaignCycleDays: number | null;
}

export interface BomLine {
  parentItemId: string;
  plantId: string;
  componentItemId: string;
  /** Per 1 base UoM of parent. */
  qtyPer: number;
  /**
   * Component scrap — a *material* property. 0–1, applied as × (1 + scrap).
   *
   * Three per cent of a laminate reel is lost to changeover and web waste
   * whatever the line is doing. Kept separate from operation yield because the
   * two behave differently and are argued about differently, and a planner
   * disputing a requirement needs to know which of the two inflated it.
   */
  componentScrapPct: number;
  /**
   * Operation yield — a *process* property. 0–1, applied as ÷ yield.
   *
   * A filling line delivers 97% of theoretical; a splitting stage delivers
   * 89.7%. That is the process, not the material.
   */
  operationYieldPct: number;
  /** What this step is, in the words a planner would use, for the explain panel. */
  stepLabel: string | null;
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
  /**
   * The vendor's own working calendar, which is not the plant's.
   *
   * A dispatch cannot be scheduled out of a day the vendor is closed any more
   * than a receipt can be scheduled into a day the plant cannot receive on.
   * Getting this wrong is the most common reason a technically correct schedule
   * is rejected by the people who have to execute it.
   */
  calendarId: string;
  /**
   * Whole weeks, by Monday date, in which this vendor produces nothing —
   * an annual maintenance shutdown, a statutory close-down.
   *
   * A production shutdown is not a dispatch shutdown: a vendor can still ship
   * finished stock built ahead of it. The two are kept apart deliberately,
   * because that distinction is the difference between a residual exposure a
   * planner has to absorb and one they can close with a phone call.
   */
  productionShutdownWeeks: string[];
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
   * Days from purchase-order release to vendor acknowledgement.
   *
   * The first of the four intervals a total lead time decomposes into, and the
   * one nobody measures — time lost before the vendor has even been told.
   * Sourcing owns it, not the vendor.
   */
  acknowledgementDays: number;
  /** Customs and clearance days on top of transit. Zero on domestic lanes. */
  customsDays: number;
  /**
   * Most this vendor can produce in one week, in base UoM. Ceilings each
   * delivery in the constrained schedule. Null where no ceiling is recorded.
   */
  weeklyCapacity: number | null;
  /** Working days that must separate two deliveries — stops uneconomic dribble. */
  minGapDays: number;
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
  /** What the schedule line asked for, against which `qty` is the fill. */
  orderedQty: number;
  /** receivedOn − orderedOn, in calendar days. */
  actualLeadTimeDays: number;

  /**
   * The four intervals a total lead time is actually made of.
   *
   * A twelve-day slip is not "the supplier was late". Split here, it is four
   * separate slips with four different owners — sourcing, vendor, logistics,
   * plant QC — and two of them are routinely GCPL's own. Storing the boundary
   * dates rather than the durations means the decomposition is measured off the
   * record instead of being asserted beside it.
   */
  acknowledgedOn: string | null;
  dispatchedOn: string | null;
  /** Quality release against the certificate of analysis — when it became stock. */
  qaReleasedOn: string | null;
  /**
   * Why this receipt deviated, where a planner recorded one.
   *
   * A deviation with no reason is a number; a deviation with a reason is a
   * pattern. It is also what lets a genuine one-off — a port strike, a vendor
   * shutdown — be excluded from a lead-time calculation later without anyone
   * quietly deleting inconvenient data.
   */
  reasonCode: string | null;
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
