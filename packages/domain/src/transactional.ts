/** Transactional data — stock, supply and demand as they stand at the planning date. */

export type SourceSystem = 'SAP' | 'ENGINE';

export interface StockBatch {
  batchId: string;
  qty: number;
  expiryDate: string | null;
}

/**
 * A quantity sitting in quality inspection, with the date it is due to clear.
 *
 * Undated quarantine is the single most common way a plan flatters itself: the
 * material is on site, so it looks like stock, and it is not stock until the
 * certificate of analysis clears. Dating it puts the release in the bucket it
 * actually lands in — and makes visible the weeks that are only covered
 * *because* a release is assumed to pass.
 */
export interface QuarantineLot {
  batchId: string;
  qty: number;
  /** Gate-in date. */
  receivedOn: string;
  /** When it is expected to clear QC and become available. */
  expectedReleaseDate: string;
}

export interface StockPosition {
  itemId: string;
  plantId: string;
  unrestricted: number;
  blocked: number;
  qualityInspection: number;
  inTransit: number;
  batches: StockBatch[];
  /** The quality-inspection quantity, dated. Sums to `qualityInspection`. */
  quarantine: QuarantineLot[];
}

export type SupplyType = 'PO' | 'PRODUCTION_ORDER' | 'PLANNED_ORDER' | 'STO';

/**
 * How far along the inbound pipeline a single delivery has got.
 *
 * PO created → supplier committed → in transit → received. `DELAYED` is the one
 * that matters: a line whose expected date has already slipped past the date the
 * plan is netting against, so the receipt the plan is counting on will not be
 * there when it assumes.
 */
export type DeliveryStatus = 'PLANNED' | 'CONFIRMED' | 'IN_TRANSIT' | 'RECEIVED' | 'DELAYED';

/**
 * One delivery bucket of an order.
 *
 * An order is rarely a single drop. Holding the schedule rather than a single
 * quantity and date is what lets the cockpit answer "1,000 units by when,
 * exactly" — and show that half of it is committed and half is not.
 */
export interface DeliveryLine {
  /** 1-based, in date order. */
  line: number;
  qty: number;
  /** The date the order document says — what GCPL asked for. */
  plannedDate: string;
  /** The date the supplier has committed to, where they have committed at all. */
  confirmedDate: string | null;
  /** Best current view of arrival — the confirmed date where there is one. */
  expectedDate: string;
  status: DeliveryStatus;

  /**
   * The permanent record behind this line — the quiet foundation of the norms
   * work that comes after.
   *
   * None of this exists in a system at GCPL today, which is the whole point.
   * The planner already makes the phone call; recording its answer here costs
   * them nothing they were not already doing, and after one ordering cycle it
   * is the only dataset from which a lead time can be measured rather than
   * remembered.
   */
  /** When the purchase order line was released. */
  releasedOn: string | null;
  /** When the vendor acknowledged it, where they have. */
  acknowledgedOn: string | null;
  /** When it left the vendor, where that is known at all. */
  dispatchedOn: string | null;
  /** Goods receipt — gate-in. */
  grnDate: string | null;
  /** What actually arrived, against `qty` requested. */
  grnQty: number | null;
  /** Quality release against the COA — when it became available stock. */
  qaReleasedOn: string | null;
  /** Why the line moved or the receipt deviated. See REASON_CODES. */
  reasonCode: string | null;
  /** The planner's own note, alongside the code and never instead of it. */
  note: string | null;
}

export interface SupplyElement {
  id: string;
  type: SupplyType;
  itemId: string;
  plantId: string;
  qty: number;
  /** Receipt date. */
  dueDate: string;
  releaseDate: string;
  vendorId: string | null;
  sourcePlantId: string | null;
  isFirm: boolean;
  sourceSystem: 'SAP' | 'KINAXIS' | 'ENGINE';
  /**
   * The delivery buckets this order is split into. Absent on planned orders,
   * which have not been placed and so have nothing to schedule yet.
   *
   * Quantities always sum to `qty` and the last line always lands on `dueDate`,
   * so the engine's view of this order is unchanged by the split.
   */
  schedule?: DeliveryLine[];
}

export type DemandType = 'SALES_ORDER' | 'FORECAST' | 'DEPENDENT' | 'STO_DEMAND' | 'SAFETY_STOCK';

export type Channel = 'MT' | 'GT' | 'ECOM' | 'EXPORT' | 'INTERNAL';

export interface DemandElement {
  id: string;
  type: DemandType;
  itemId: string;
  plantId: string;
  qty: number;
  requiredDate: string;
  customerId: string | null;
  channel: Channel | null;
  marginPerUnit: number;
  /** Selling price per base UoM — used for revenue at risk. */
  pricePerUnit: number;
  /** 1 = highest. */
  priority: number;
  /** Set for DEPENDENT demand — this is the pegging link across BOM levels. */
  parentSupplyElementId: string | null;
  sourceSystem: SourceSystem;
}

export interface Customer {
  id: string;
  name: string;
  channel: Channel;
  /** Key accounts carry reputational weight beyond their order value. */
  isKeyAccount: boolean;
}
