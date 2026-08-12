/**
 * The shapes the browser actually receives.
 *
 * Deliberately narrow. The plan holds typed arrays, graph indexes and the whole
 * snapshot; none of that crosses the wire. Every screen reads a projection sized
 * for what it draws.
 */

import type {
  EvidenceFact,
  ExceptionClass,
  ExceptionCode,
  ImpactBreakdown,
  ResolutionType,
  Severity,
  TargetSystem,
} from '@repo/domain';

export interface KpiDelta {
  value: number;
  /** Change since the previous run, or null when there is no previous run. */
  delta: number | null;
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
