/**
 * The shapes the browser actually receives.
 *
 * Deliberately narrow. The plan holds typed arrays, graph indexes and the whole
 * snapshot; none of that crosses the wire. Every screen reads a projection sized
 * for what it draws.
 */

import type { DeliveryStatus, SupplyType } from '@repo/domain';

/**
 * The planning position in six numbers.
 *
 * Deliberately counts of materials and orders rather than money: this is the
 * "how does the plan stand" question, which a planner asks before the "what is
 * it worth" question the exposure tiles answer.
 */
export interface PlanningPosition {
  /** Item-plants the engine actually planned. */
  mrpMaterials: number;
  /** Those carrying at least one open exception. */
  atRisk: number;
  /** Those whose orderable-supply balance goes negative inside the horizon. */
  projectedStockouts: number;
  /** Those holding materially more than the horizon needs. */
  excessMaterials: number;
  openPos: number;
  /** Delivery lines the supplier has already pushed past the date the plan uses. */
  delayedInbound: number;
  /** Share of committed demand the plan covers, and the buffers behind it. */
  coverage: {
    inventory: number;
    demand: number;
    supply: number;
    safetyStock: number;
  };
}

/** A plant the top-bar filter can scope to. */
export interface PlantOption {
  id: string;
  name: string;
  type: 'OWN' | 'COPACKER';
}

export interface CockpitSummary {
  scenarioId: string;
  planningDate: string;
  horizonDays: number;
  /** Plants in the active pack, for the top-bar filter. */
  plants: PlantOption[];
  /** Wall-clock milliseconds of the run behind this summary. */
  elapsedMs: number;
  planningPosition: PlanningPosition;
}

/**
 * One row of the materials table — the planning position for a single
 * item-plant, in the terms the planner reads first.
 */
export interface MaterialRow {
  itemId: string;
  plantId: string;
  description: string;
  itemType: string;
  baseUom: string;
  abcClass: string;
  plannerCode: string | null;
  /** Gross requirements across the horizon. */
  demand: number;
  /** Unrestricted stock on hand. */
  stock: number;
  /** Open order quantity still to arrive. */
  openPo: number;
  /** The part of that open quantity the supplier has confirmed or shipped. */
  expectedInbound: number;
  safetyStock: number;
  /** Closing balance on orderable supply — the honest one. */
  projectedBalance: number;
  /** The worst balance across the horizon, which is where the trouble is. */
  lowestBalance: number;
  /** First date the orderable balance goes negative. */
  stockoutDate: string | null;
  status: 'HEALTHY' | 'WATCH' | 'AT_RISK' | 'EXCESS';
  /** Money the projected shortfall puts at stake, at standard cost. */
  exposure: number;
}

export interface MaterialsQueryResult {
  rows: MaterialRow[];
  total: number;
  counts: { all: number; atRisk: number; watch: number; excess: number; healthy: number };
}

export interface ParameterHealth {
  field: string;
  label: string;
  maintained: string;
  observed: string | null;
  status: 'FRESH' | 'DRIFTED' | 'MISSING';
  note: string | null;
}

export interface TimePhasedRow {
  key: string;
  label: string;
  /** One value per day. */
  values: number[];
  /** Rows the UI can expand into, e.g. gross requirements by demand type. */
  children?: TimePhasedRow[];
  editable?: boolean;
  emphasis?: 'BALANCE' | 'THRESHOLD' | 'NONE';
  /**
   * How the row collapses when days are bucketed into weeks or periods.
   *
   * A flow (what moved) sums; a level (what is held at an instant) takes the
   * closing value. Getting this wrong is not a rounding difference — summing a
   * stock balance over a week reports seven times the stock.
   */
  aggregate: 'SUM' | 'LAST';
}

export interface DeliveryLineView {
  line: number;
  qty: number;
  plannedDate: string;
  confirmedDate: string | null;
  expectedDate: string;
  status: DeliveryStatus;
  /** Days the confirmed date sits after the planned one. Zero when on schedule. */
  slipDays: number;
}

/**
 * An open order as the schedule screen shows it: the total, and the drops it
 * actually arrives in.
 */
export interface PurchaseOrderView {
  id: string;
  type: SupplyType;
  vendorId: string | null;
  vendorName: string | null;
  totalQty: number;
  dueDate: string;
  isFirm: boolean;
  sourceSystem: string;
  lines: DeliveryLineView[];
  /** Quantity confirmed, in transit or received — supply that is genuinely coming. */
  confirmedQty: number;
  /** Quantity with no supplier commitment behind it. */
  unconfirmedQty: number;
  /** Worst slip across the lines, in days. */
  worstSlipDays: number;
}

/**
 * The working behind a recommended order, in the order a planner reads it.
 *
 * Two nested subtractions: order-up-to less effective stock gives the net
 * requirement, and effective stock is itself on-hand plus confirmed inbound
 * less what is already committed. Everything here comes from the run that
 * produced the recommendation, never from a recalculation.
 */
export interface MrpExplain {
  recommendedQty: number;
  /** What lot sizing asked for before MOQ and rounding — shown when it differs. */
  ruleQty: number;
  orderUpToLevel: number;
  netRequirement: number;
  effectiveStock: {
    onHand: number;
    /** Receipts the netting walk counted before the bucket that breached. */
    inbound: number;
    commitments: number;
    /** Equals onHand + inbound − commitments, and is the engine's own balance. */
    total: number;
    /**
     * The part of `inbound` no supplier has committed to a date for. Not a term
     * in the subtraction — a caveat on it. The plan is netting against this
     * quantity as though it were certain, and it is not.
     */
    unconfirmedInbound: number;
  };
  assumptions: {
    averageDailyDemand: number;
    safetyStock: number;
    inventoryNorm: number;
    leadTimeDays: number;
    observedLeadTimeDays: number | null;
    lotSizeRule: string | null;
    moq: number | null;
  };
  receiptDate: string;
  releaseDate: string;
  /** True when the release date has already passed — the order cannot be placed in time. */
  isReleaseInPast: boolean;
  totalOffsetDays: number;
}

/** One goods receipt, as the Explain drawer lists it. */
export interface LeadTimeReceipt {
  poId: string;
  vendorId: string;
  vendorName: string | null;
  orderedOn: string;
  promisedOn: string;
  receivedOn: string;
  qty: number;
  actualLeadTimeDays: number;
}

/**
 * What the observed lead time is reconstructed from.
 *
 * The drawer's second level: a planner who does not believe the number clicks
 * once more and reads the receipts it was averaged over. Unmatched receipts are
 * counted and named as excluded rather than quietly dropped — a figure that
 * hides its own exclusions is the kind that loses an audience.
 */
export interface LeadTimeEvidence {
  maintainedDays: number | null;
  observedMeanDays: number | null;
  observedStdDevDays: number | null;
  matchedCount: number;
  unmatchedCount: number;
  /** The matched receipts, most recent first. */
  receipts: LeadTimeReceipt[];
  paramsLastChangedOn: string;
  /** Where the maintained value lives in the system of record. */
  maintainedSource: string;
}

/**
 * One approved source for a material, and the share of volume it carries.
 *
 * The allocation share is what the scheduling engine splits an order across in
 * Checkpoint B, so it is worth showing here rather than inventing later: a
 * planner who can see 60/40 on the screen is not surprised when the schedule
 * splits 60/40.
 */
export interface VendorSplit {
  vendorId: string;
  vendorName: string | null;
  isPrimary: boolean;
  /** 0–1. */
  allocationShare: number;
  leadTimeDays: number;
  isImport: boolean;
}

/** The planning position for one material, for the detail header. */
export interface ItemPosition {
  demand: number;
  openPo: number;
  expectedInbound: number;
  plannedReceipts: number;
  projectedBalance: number;
  lowestBalance: number;
  stockoutDate: string | null;
  /** Negative = shortfall against the buffer, positive = cover above it. */
  shortfall: number;
}

export interface ItemDetail {
  itemId: string;
  plantId: string;
  /** The fixed planning date this view was computed against. */
  planningDate: string;
  horizonDays: number;
  description: string;
  itemType: string;
  baseUom: string;
  abcClass: string;
  xyzClass: string;
  standardCost: number;
  plannerCode: string | null;
  procurementType: string | null;
  lowLevelCode: number;
  stock: { unrestricted: number; blocked: number; qualityInspection: number; inTransit: number };
  safetyStock: number;
  /** ISO date the planning parameters were last maintained. */
  paramsLastChangedOn: string;
  /** Bucket dates, aligned with every series below. */
  dates: string[];
  grossRequirements: number[];
  scheduledReceipts: number[];
  plannedReceipts: number[];
  /** Receipts a supplier has acknowledged, or that are already in transit. */
  confirmedReceipts: number[];
  /** Order lines with no supplier commitment behind them yet. */
  unconfirmedReceipts: number[];
  /**
   * Balance counting only confirmed supply — the honest one.
   *
   * Kept separate from `balanceWithPlanned` throughout. Merging them is the
   * "rosy picture" the buyer warned about, so the chart draws two lines and
   * never one.
   */
  balanceConfirmed: number[];
  /** Balance including unconfirmed order lines and engine-planned orders. */
  balanceWithPlanned: number[];
  projectedAvailable: number[];
  projectedAvailableFeasible: number[];
  daysOfCover: number[];
  grid: TimePhasedRow[];
  parameters: ParameterHealth[];
  leadTime: LeadTimeEvidence;
  vendors: VendorSplit[];
  healthScore: number;
  position: ItemPosition;
  purchaseOrders: PurchaseOrderView[];
  /** Null when the plan is not recommending anything for this item-plant. */
  recommendation: MrpExplain | null;
}

/**
 * A parameter override weighed before it is applied: the same recommendation,
 * computed on the current value and on the proposed one.
 */
export interface OverridePreview {
  field: string;
  label: string;
  systemValue: number | null;
  overrideValue: number | null;
  before: MrpExplain | null;
  after: MrpExplain | null;
  /** Projected balance on orderable supply, before and after. */
  beforeBalance: number[];
  afterBalance: number[];
  dates: string[];
  /** Worst balance across the horizon either side — the stockout in one number. */
  beforeLowestBalance: number;
  afterLowestBalance: number;
  elapsedMs: number;
}
