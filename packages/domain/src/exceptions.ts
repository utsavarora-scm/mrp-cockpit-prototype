/**
 * Exception taxonomy — four classes, 27 named codes plus one structural guard.
 *
 * Class A is supply continuity, B is master data integrity, C is cross-system
 * reconciliation (the white space), D is feasibility.
 */

export type ExceptionClass = 'A' | 'B' | 'C' | 'D';

export type SupplyContinuityCode =
  | 'A1-PROJECTED-STOCKOUT'
  | 'A2-SAFETY-STOCK-BREACH'
  | 'A3-COVERAGE-BELOW-TARGET'
  | 'A4-RESCHEDULE-IN'
  | 'A5-RESCHEDULE-OUT'
  | 'A6-CANCEL-EXCESS'
  | 'A7-PAST-DUE-SUPPLY'
  | 'A8-ORDER-IN-PAST';

export type MasterDataCode =
  | 'B1-INCOMPLETE-PLANNING-MASTER'
  | 'B2-NO-SOURCE-OF-SUPPLY'
  | 'B3-ABSENT-ITEM'
  | 'B4-ORPHAN-ITEM'
  | 'B5-BOM-VALIDITY-GAP'
  | 'B6-EMPTY-PHANTOM'
  | 'B7-LEAD-TIME-DRIFT'
  | 'B8-SAFETY-STOCK-MISALIGNED'
  | 'B9-UOM-INCONSISTENCY'
  | 'B10-DUPLICATE-ITEM'
  | 'B-CIRCULAR-BOM';

export type ReconciliationCode =
  | 'C1-DEMAND-DIVERGENCE'
  | 'C2-INVENTORY-DIVERGENCE'
  | 'C3-PARAMETER-DRIFT'
  | 'C4-PLAN-NOT-EXECUTED'
  | 'C5-STALE-SYNC';

export type FeasibilityCode =
  | 'D1-VENDOR-CONSTRAINT'
  | 'D2-CAPACITY-OVERLOAD'
  | 'D3-SHELF-LIFE-VIOLATION'
  | 'D4-LOT-SIZE-INDUCED-EXCESS';

export type ExceptionCode = SupplyContinuityCode | MasterDataCode | ReconciliationCode | FeasibilityCode;

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * A single verifiable fact underpinning an exception. Narratives are composed
 * from these at render time — never from a template string, because templated
 * prose is the fastest way to make a prototype feel fake.
 */
export interface EvidenceFact {
  kind: 'PARAMETER' | 'OBSERVATION' | 'CALCULATION' | 'RECORD' | 'DIVERGENCE';
  label: string;
  value: string;
  /** Supporting context — a distribution, a date, a source system. */
  detail?: string;
  /** Lets the UI navigate to the underlying record. */
  ref?: EvidenceRef;
}

export type EvidenceRef =
  | { type: 'ITEM_PLANT'; itemId: string; plantId: string }
  | { type: 'SUPPLY_ELEMENT'; supplyElementId: string }
  | { type: 'DEMAND_ELEMENT'; demandElementId: string }
  | { type: 'VENDOR'; vendorId: string }
  | { type: 'RECEIPT_HISTORY'; itemId: string; plantId: string; vendorId: string }
  | { type: 'SYSTEM_SNAPSHOT'; system: 'SAP' | 'KINAXIS' | 'O9' }
  | { type: 'BOM'; parentItemId: string; plantId: string };

/** The money model, broken out so the cockpit can show what drives a ranking. */
export interface ImpactBreakdown {
  revenueAtRisk: number;
  marginAtRisk: number;
  excessInventoryValue: number;
  expediteCostExposure: number;
  obsolescenceExposure: number;
  total: number;
}

export interface PlanningException {
  id: string;
  code: ExceptionCode;
  exceptionClass: ExceptionClass;
  severity: Severity;
  itemId: string;
  plantId: string;
  /** Day offset from planningDate. −1 where the exception is not time-phased. */
  bucketDay: number;
  /** Composed from `evidence` — see EvidenceFact. */
  narrative: string;
  evidence: EvidenceFact[];
  impact: ImpactBreakdown;
  impactValue: number;
  /** Independent-demand elements reachable upward through the pegging graph. */
  peggedDemandIds: string[];
  peggedFgCount: number;
  resolutionIds: string[];
  /** True when the autonomous agent's policy allowlist can close this unattended. */
  autoResolvable: boolean;
}

export const EXCEPTION_CLASS_LABELS: Record<ExceptionClass, string> = {
  A: 'Supply continuity',
  B: 'Master data integrity',
  C: 'Cross-system reconciliation',
  D: 'Feasibility',
};

/** Short human labels, used in table chips and facet lists. */
export const EXCEPTION_LABELS: Record<ExceptionCode, string> = {
  'A1-PROJECTED-STOCKOUT': 'Projected stockout',
  'A2-SAFETY-STOCK-BREACH': 'Safety stock breach',
  'A3-COVERAGE-BELOW-TARGET': 'Coverage below target',
  'A4-RESCHEDULE-IN': 'Reschedule in',
  'A5-RESCHEDULE-OUT': 'Reschedule out',
  'A6-CANCEL-EXCESS': 'Cancel excess',
  'A7-PAST-DUE-SUPPLY': 'Past due supply',
  'A8-ORDER-IN-PAST': 'Order in the past',
  'B1-INCOMPLETE-PLANNING-MASTER': 'Incomplete planning master',
  'B2-NO-SOURCE-OF-SUPPLY': 'No source of supply',
  'B3-ABSENT-ITEM': 'Absent item',
  'B4-ORPHAN-ITEM': 'Orphan item',
  'B5-BOM-VALIDITY-GAP': 'BOM validity gap',
  'B6-EMPTY-PHANTOM': 'Empty phantom',
  'B7-LEAD-TIME-DRIFT': 'Lead time drift',
  'B8-SAFETY-STOCK-MISALIGNED': 'Safety stock misaligned',
  'B9-UOM-INCONSISTENCY': 'UoM inconsistency',
  'B10-DUPLICATE-ITEM': 'Duplicate item',
  'B-CIRCULAR-BOM': 'Circular BOM',
  'C1-DEMAND-DIVERGENCE': 'Demand divergence',
  'C2-INVENTORY-DIVERGENCE': 'Inventory divergence',
  'C3-PARAMETER-DRIFT': 'Parameter drift',
  'C4-PLAN-NOT-EXECUTED': 'Plan not executed',
  'C5-STALE-SYNC': 'Stale sync',
  'D1-VENDOR-CONSTRAINT': 'Vendor constraint',
  'D2-CAPACITY-OVERLOAD': 'Capacity overload',
  'D3-SHELF-LIFE-VIOLATION': 'Shelf-life violation',
  'D4-LOT-SIZE-INDUCED-EXCESS': 'Lot-size induced excess',
};

export function exceptionClassOf(code: ExceptionCode): ExceptionClass {
  const prefix = code.charAt(0);
  if (prefix === 'A' || prefix === 'B' || prefix === 'C' || prefix === 'D') return prefix;
  throw new Error(`Unclassifiable exception code: ${code}`);
}
