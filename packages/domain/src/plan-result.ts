/**
 * The engine's output. Held server-side only — it carries typed arrays and graph
 * indexes that must never be shipped to the browser wholesale. The API layer
 * projects narrow, serialisable views out of it.
 */

import type { DemandElement, SupplyElement } from './transactional';

/** One item at one plant, bucketed daily across the horizon. */
export interface ItemPlantPlan {
  itemId: string;
  plantId: string;
  lowLevelCode: number;
  openingStock: number;
  safetyStock: number;
  /** All arrays are length horizonDays + 1, indexed by day offset from planningDate. */
  grossRequirements: Float64Array;
  /**
   * Requirements as independent demand alone implies them — customer orders and
   * forecast exploded straight down the bill of material, with no lead-time
   * offsetting and no lot sizing.
   *
   * `grossRequirements` is what the plan must actually cover, but it is shaped
   * by decisions taken upstream: a component whose parent is built fortnightly
   * sees violent spikes without its demand being any less predictable. Anything
   * reasoning about *demand variability* — safety stock above all — has to read
   * this series instead, or it mistakes batching for uncertainty.
   */
  underlyingDemand: Float64Array;
  /** Everything already on order: tier 1 + tier 2 + quality releases. */
  scheduledReceipts: Float64Array;
  /**
   * Tier 1 — the vendor has acknowledged this line, or it is already moving.
   *
   * Split from tier 2 in the engine rather than re-derived by a screen, because
   * two screens re-deriving the same split is how they end up disagreeing about
   * which week is safe.
   */
  confirmedReceipts: Float64Array;
  /** Tier 2 — a schedule line exists and nobody has acknowledged it. */
  committedReceipts: Float64Array;
  /**
   * Quantity clearing quality inspection and becoming available, on the day it
   * clears. Part of `scheduledReceipts`, held separately because material in QA
   * is on site and is not stock, and the plan has to be able to say so.
   */
  qaReleases: Float64Array;
  /**
   * The shortfall against the planning threshold in each bucket, before any lot
   * sizing — `(gross requirement + safety stock) − (previous balance +
   * scheduled receipts)`, and the number the sponsor asked for by name.
   *
   * Incremental rather than cumulative, so a bucket's value is that bucket's
   * requirement and the series can be summed across a week. Carried here rather
   * than re-derived from the recommendations it produced: reconstruction loses
   * every requirement lot sizing consolidated and repeats every one it split.
   */
  netRequirements: Float64Array;
  plannedReceipts: Float64Array;
  projectedAvailable: Float64Array;
  /**
   * The balance on stock and existing orders alone, with nothing the engine is
   * merely proposing.
   *
   * The honest position, and the one worth arguing about: showing only the
   * balance *after* planned orders — which most planning tools do — hides the
   * problem behind its own proposed solution.
   */
  projectedBeforePlanned: Float64Array;
  /**
   * The same balance with tier 3 excluded *and* tier 2 excluded — what is left
   * if only supply somebody has actually acknowledged turns up.
   *
   * A breach that only this curve shows is the sponsor's rosy picture, drawn.
   */
  projectedConfirmedOnly: Float64Array;
  /**
   * The balance if orders that would have needed placing in the past are left
   * out — the honest position, and what the stockout detector uses.
   *
   * A textbook MRP run always looks solvable, because it happily plans a receipt
   * for a date it can no longer order for. Keeping both curves is what lets the
   * plan say "this is what we have scheduled" and "this is what will actually
   * arrive" in the same picture.
   */
  projectedAvailableFeasible: Float64Array;
  /** Forward days of demand covered by the balance on that day. */
  daysOfCover: Float64Array;
}

/** One lot-sizing adjustment, as it actually happened. */
export type LotSizingStepKind =
  | 'RULE'
  | 'SCRAP'
  | 'VENDOR_MOQ'
  | 'MIN_LOT'
  | 'VENDOR_INCREMENT'
  | 'ROUNDING'
  | 'MAX_LOT_SPLIT';

/**
 * A step in the sizing of one requirement.
 *
 * `binding` alone is not enough to describe what a step did: a max-lot split
 * binds while leaving the total untouched, which is a change of shape and not of
 * quantity. Anything narrating the order — a banner, an explain row — needs to
 * tell those apart, so both are recorded.
 */
export interface LotSizingStep {
  kind: LotSizingStepKind;
  beforeQty: number;
  /** The total after this step. Not the slice size — see `sliceQtys`. */
  afterQty: number;
  deltaQty: number;
  /** `MAX_LOT_SPLIT` only. A scalar cannot express a split. */
  sliceQtys: number[] | null;
  /** The master-data value that applied, for the label. */
  parameter: number | null;
  source: string;
  /** The step ran at all — the parameter is maintained. */
  applied: boolean;
  changedQuantity: boolean;
  /** The number of orders changed, even where the total did not. */
  changedShape: boolean;
  /** The parameter constrained the outcome. */
  binding: boolean;
}

/**
 * A parameter set that cannot be satisfied — reported rather than resolved by
 * quietly preferring whichever constraint happened to run last.
 */
export interface LotSizingConflict {
  kind: 'INCOMPATIBLE_INCREMENTS' | 'NO_FEASIBLE_PARTITION';
  detail: string;
}

/**
 * One shortage, and everything lot sizing did to it.
 *
 * Held per requirement rather than per order: a max-lot split turns one shortage
 * into several orders, and copying the trace onto each would show three 4,000 MT
 * slices all claiming a 12,000 MT derivation. Orders carry `requirementId` and
 * point here.
 */
export interface RequirementExplanation {
  requirementId: string;
  itemId: string;
  plantId: string;
  /** Day offset of the bucket that breached. */
  day: number;
  netRequirement: number;
  /** What the lot-sizing rule alone asked for, before scrap and the ceilings. */
  ruleQty: number;
  /** The reconciled total, before splitting. `slices` sum to this. */
  finalOrderQuantity: number;
  slices: number[];
  threshold: number;
  /** The balance the order is topping up from. */
  balanceBefore: number;
  sizingTrace: LotSizingStep[];
}

/**
 * An order that could actually be placed, standing in for ones that cannot.
 *
 * Not a redate of the order it replaces: the quantity is recalculated at the
 * feasible date, because the demand and receipts in between change what is
 * needed. The original keeps its own date and its own impossible release date.
 */
export interface RecoveryOrderResult {
  itemId: string;
  plantId: string;
  /** The reconciled total. `slices` sum to this. */
  qty: number;
  slices: number[];
  receiptDay: number;
  receiptDate: string;
  releaseDate: string;
  /** The unmet requirements this one order stands in for. */
  coversRequirementIds: string[];
  sizingTrace: LotSizingStep[];
}

/** A candidate that cleared the lead time and failed something else. */
export interface BlockedRecoveryResult {
  receiptDay: number;
  qty: number;
  /** A `ConstraintKey` from the schedule builder's vocabulary. */
  blockedBy: string | null;
  detail: string;
}

/**
 * What can still be done about a plan that asked for orders in the past.
 *
 * The split between `unavoidableQty` and `recoverableQty` is what lets an
 * exception say whether ordering helps, instead of deciding it from whether the
 * bite date happens to fall right of the fence.
 */
export interface MaterialRecovery {
  orders: RecoveryOrderResult[];
  blocked: BlockedRecoveryResult[];
  /** Rolled fresh from opening stock, never adjusted off another series. */
  projectedAvailableRecovered: Float64Array;
  /** Deficit before the earliest feasible receipt. No order reaches this. */
  unavoidableQty: number;
  /** How much of the worst shortfall constraint-cleared ordering removes. */
  recoverableQty: number;
  /** Worst shortfall still standing after that, across the whole horizon. */
  residualQty: number;
  /** The part of that falling on days an order could actually have landed on. */
  residualAfterFenceQty: number;
  /** First day the recovered balance is still short, or −1. */
  firstResidualDay: number;
}

/**
 * The working behind one recommended order.
 *
 * Netting knows why it raised an order — the threshold it was defending, the
 * balance it found, and what lot sizing then did to the shortfall — and then
 * throws all of it away, leaving a quantity with no provenance. Keeping the
 * working is what lets a planner ask "why this quantity?" and get an answer
 * from the run rather than from a recalculation that might not agree with it.
 */
export interface PlannedOrderExplanation {
  itemId: string;
  plantId: string;
  /** The quantity actually recommended, after lot sizing, MOQ and rounding. */
  qty: number;
  /** What the lot-sizing rule alone asked for, before MOQ and rounding. */
  ruleQty: number;
  /** Threshold − balance at the bucket that triggered the order. */
  netRequirement: number;
  /** Safety stock, or the reorder point for consumption-based items. */
  threshold: number;
  /** The balance the order is topping up from. */
  balanceBefore: number;
  /** Day offset of the bucket that breached. */
  requirementDay: number;
  receiptDate: string;
  releaseDate: string;
  /**
   * Day offset of the release from the planning date. Negative means the past.
   *
   * Carried rather than re-derived as `requirementDay − totalOffsetDays`: that
   * subtraction ignores the working-calendar snap the walk actually applied,
   * and `requirementDay` is the *receipt* day, so the two disagreed by up to a
   * week on exactly the orders whose lateness is the point.
   */
  releaseDay: number;
  /** True when the release date has already passed — the order is unorderable. */
  isReleaseInPast: boolean;
  /** Lead time the run actually used: maintained, or observed under that scenario. */
  effectiveLeadTimeDays: number;
  /** Lead time plus goods-receipt processing plus safety time. */
  totalOffsetDays: number;
  /**
   * The shortage this order serves, shared by every slice of a split.
   *
   * Anything summing exposure across orders must deduplicate on this: summing
   * `netRequirement` over three slices of one 12,000 MT shortage reports it
   * three times, which is how a 0.64 MT miss came to be priced at ₹7.51 Cr.
   */
  requirementId: string;
}

export interface MrpResult {
  scenarioId: string;
  planningDate: string;
  horizonDays: number;
  /** Wall-clock time of the run. Surfaced in the UI — speed is part of the story. */
  elapsedMs: number;
  plans: Map<string, ItemPlantPlan>;
  plannedOrders: SupplyElement[];
  /** Keyed by `planKey` — the working behind each item-plant's recommendations. */
  orderExplanations: Map<string, PlannedOrderExplanation[]>;
  /** Keyed by `planKey` — one entry per shortage, carrying the sizing trace. */
  requirementExplanations: Map<string, RequirementExplanation[]>;
  /**
   * Keyed by `planKey` — parameter sets that could not be satisfied.
   */
  lotSizingConflicts: Map<string, LotSizingConflict[]>;
  /**
   * Keyed by `planKey` — what can still be done where the plan asked for an
   * order in the past. Absent for materials with nothing to recover.
   */
  recoveries: Map<string, MaterialRecovery>;
  /** Dependent demand the engine generated while exploding BOMs. */
  derivedDemand: DemandElement[];
  /** Item-plants whose BOM participates in a cycle — planned around, not thrown on. */
  circularItemPlants: string[];
}

/** Stable key for the per-item-plant maps. */
export function planKey(itemId: string, plantId: string): string {
  return `${itemId}@${plantId}`;
}
