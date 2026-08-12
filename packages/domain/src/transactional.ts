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
