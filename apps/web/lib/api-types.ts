/**
 * The shapes the browser actually receives.
 *
 * Deliberately narrow. The plan holds typed arrays, graph indexes and the whole
 * snapshot; none of that crosses the wire. Every screen reads a projection sized
 * for what it draws.
 */

import type {
  DeliveryStatus,
  EvidenceFact,
  ExceptionClass,
  ExceptionCode,
  ImpactBreakdown,
  ResolutionType,
  Severity,
  SupplyType,
  TargetSystem,
} from '@repo/domain';

export interface KpiDelta {
  value: number;
  /** Change since the previous run, or null when there is no previous run. */
  delta: number | null;
}

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

export interface CockpitSummary {
  scenarioId: string;
  planningDate: string;
  horizonDays: number;
  elapsedMs: number;
  exceptionCount: number;
  totalExposure: KpiDelta;
  projectedFillRate: KpiDelta;
  inventoryValue: KpiDelta;
  daysOnHand: KpiDelta;
  excessObsoleteExposure: KpiDelta;
  expediteSpendMtd: KpiDelta;
  autoResolvedPct: KpiDelta;
  /** How many exceptions carry 70% of the exposure, and what share of the queue that is. */
  exceptionsToSeventyPercent: number;
  seventyPercentHeadShare: number;
  exceptionsByClass: Record<ExceptionClass, number>;
  exposureByClass: Record<ExceptionClass, number>;
  pareto: ParetoPoint[];
  sparklines: Record<string, number[]>;
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
  exceptionCount: number;
  exposure: number;
}

export interface MaterialsQueryResult {
  rows: MaterialRow[];
  total: number;
  counts: { all: number; atRisk: number; watch: number; excess: number; healthy: number };
}

export interface ParetoPoint {
  rank: number;
  impactValue: number;
  cumulativeShare: number;
  code: ExceptionCode;
  itemId: string;
  plantId: string;
}

export interface ExceptionRow {
  id: string;
  code: ExceptionCode;
  exceptionClass: ExceptionClass;
  severity: Severity;
  impactValue: number;
  itemId: string;
  itemDescription: string;
  itemType: string;
  plantId: string;
  abcClass: string;
  xyzClass: string;
  plannerCode: string | null;
  bucketDay: number;
  needDate: string | null;
  daysToImpact: number | null;
  peggedFgCount: number;
  narrative: string;
  bestResolutionLabel: string | null;
  bestResolutionConfidence: number | null;
  autoResolvable: boolean;
  /** A short projected-balance series for the inline row expansion. */
  sparkline: number[];
}

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

export interface ExceptionQueryResult {
  rows: ExceptionRow[];
  total: number;
  filteredExposure: number;
  facets: {
    plant: FacetOption[];
    exceptionClass: FacetOption[];
    itemType: FacetOption[];
    abcClass: FacetOption[];
    plannerCode: FacetOption[];
    timeToImpact: FacetOption[];
  };
}

export interface TraceLine {
  label: string;
  value: string;
  detail?: string;
  kind: EvidenceFact['kind'];
  /** Where clicking this line goes, when it leads somewhere. */
  link?: { type: 'ITEM'; itemId: string; plantId: string } | { type: 'SYSTEM'; system: TargetSystem };
}

export interface ResolutionCard {
  id: string;
  type: ResolutionType;
  label: string;
  rationale: string;
  estimatedCost: number;
  estimatedServiceImpact: number;
  estimatedInventoryImpact: number;
  leadTimeToEffect: number;
  confidence: number;
  writebackTargets: TargetSystem[];
  score: number;
}

export interface ExceptionDetail {
  row: ExceptionRow;
  impact: ImpactBreakdown;
  trace: TraceLine[];
  resolutions: ResolutionCard[];
  peggedDemandCount: number;
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
  /** One value per bucket. */
  values: number[];
  /** Rows the UI can expand into, e.g. gross requirements by demand type. */
  children?: TimePhasedRow[];
  editable?: boolean;
  emphasis?: 'BALANCE' | 'THRESHOLD' | 'NONE';
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
  /** Bucket dates, aligned with every series below. */
  dates: string[];
  grossRequirements: number[];
  scheduledReceipts: number[];
  plannedReceipts: number[];
  projectedAvailable: number[];
  projectedAvailableFeasible: number[];
  daysOfCover: number[];
  grid: TimePhasedRow[];
  parameters: ParameterHealth[];
  exceptions: ExceptionRow[];
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
  exceptionCountDelta: number;
  exposureDelta: number;
  /** Worst balance across the horizon either side — the stockout in one number. */
  beforeLowestBalance: number;
  afterLowestBalance: number;
  elapsedMs: number;
}

export interface BlastRadiusNode {
  id: string;
  kind: 'COMPONENT' | 'INTERMEDIATE' | 'FINISHED' | 'ORDER';
  label: string;
  sublabel: string;
  valueAtRisk: number;
  level: number;
}

export interface BlastRadiusEdge {
  id: string;
  source: string;
  target: string;
  qty: number;
}

export interface AffectedOrder {
  id: string;
  /** Committed customer orders and forecast are both at risk, but not equally. */
  kind: 'COMMITTED' | 'FORECAST';
  customerName: string;
  channel: string | null;
  itemId: string;
  itemDescription: string;
  qty: number;
  value: number;
  marginValue: number;
  requiredDate: string;
  isKeyAccount: boolean;
}

export interface BlastRadius {
  rootItemId: string;
  rootPlantId: string;
  nodes: BlastRadiusNode[];
  edges: BlastRadiusEdge[];
  orders: AffectedOrder[];
  finishedGoodsCount: number;
  totalValueAtRisk: number;
  totalMarginAtRisk: number;
  /** Split out, because committed and forecast demand carry different weight. */
  committedValue: number;
  forecastValue: number;
  committedOrderCount: number;
  keyAccountCount: number;
}

export interface SimulationDiff {
  resolutionId: string;
  resolutionLabel: string;
  elapsedMs: number;
  resolved: Array<{
    id: string;
    code: ExceptionCode;
    itemId: string;
    plantId: string;
    impactValue: number;
    narrative: string;
  }>;
  created: Array<{
    id: string;
    code: ExceptionCode;
    itemId: string;
    plantId: string;
    impactValue: number;
    narrative: string;
  }>;
  unchanged: number;
  kpiDelta: {
    totalExposure: number;
    exceptionCount: number;
    projectedFillRate: number;
    inventoryValue: number;
    daysOnHand: number;
    excessObsoleteExposure: number;
  };
  /** Before and after projected balance for the exception's own item-plant. */
  before: number[];
  after: number[];
  dates: string[];
  writebacks: Array<{ system: TargetSystem; method: string; endpoint: string; description: string; body: unknown }>;
}
