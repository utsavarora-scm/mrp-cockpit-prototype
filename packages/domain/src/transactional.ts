/** Transactional data — stock, supply and demand as they stand at the planning date. */

export type SourceSystem = 'SAP' | 'KINAXIS' | 'O9' | 'ENGINE';

export interface StockBatch {
  batchId: string;
  qty: number;
  expiryDate: string | null;
}

export interface StockPosition {
  itemId: string;
  plantId: string;
  unrestricted: number;
  blocked: number;
  qualityInspection: number;
  inTransit: number;
  batches: StockBatch[];
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
  /** The date the order document says. */
  plannedDate: string;
  /** The date the supplier has committed to, where they have committed at all. */
  confirmedDate: string | null;
  /** Best current view of arrival — the confirmed date where there is one. */
  expectedDate: string;
  status: DeliveryStatus;
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

/**
 * The same logical fact, as each system currently believes it. Diffing these
 * produces the class-C cross-system reconciliation exceptions.
 */
export interface SystemSnapshot {
  system: 'SAP' | 'KINAXIS' | 'O9';
  lastSyncAt: string;
  /** Hours after which this system's sync is considered stale. */
  syncSlaHours: number;
  recordCount: number;
  itemPlantParams: Array<{
    itemId: string;
    plantId: string;
    leadTimeDays: number | null;
    safetyStock: number | null;
    lotSizeRule: string | null;
  }>;
  onHand: Array<{ itemId: string; plantId: string; qty: number }>;
  demandBuckets: Array<{ itemId: string; plantId: string; weekStart: string; qty: number }>;
  plannedOrders: Array<{ itemId: string; plantId: string; qty: number; dueDate: string; createdAt: string }>;
}
