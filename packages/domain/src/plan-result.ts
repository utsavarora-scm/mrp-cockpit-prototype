/**
 * The engine's output. Held server-side only — it carries typed arrays and graph
 * indexes that must never be shipped to the browser wholesale. The API layer
 * projects narrow, serialisable views out of it.
 */

import type { PlanningException } from './exceptions';
import type { Resolution } from './mutations';
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
  scheduledReceipts: Float64Array;
  plannedReceipts: Float64Array;
  projectedAvailable: Float64Array;
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
  /** True when the release date has already passed — the order is unorderable. */
  isReleaseInPast: boolean;
  /** Lead time the run actually used: maintained, or observed under that scenario. */
  effectiveLeadTimeDays: number;
  /** Lead time plus goods-receipt processing plus safety time. */
  totalOffsetDays: number;
}

export interface PeggingAllocation {
  demandElementId: string;
  supplyElementId: string | null;
  /** null supply means the quantity came from opening stock. */
  fromOpeningStock: boolean;
  qty: number;
}

export interface PeggingGraph {
  /** FIFO allocations of supply (and opening stock) to demand, per item-plant. */
  allocations: PeggingAllocation[];
  /** demandElementId → the supply element whose explosion created it. */
  dependentDemandParent: Map<string, string>;
  /** supplyElementId → demand element ids that supply covers. */
  supplyToDemand: Map<string, string[]>;
  /**
   * Independent-demand leaves (sales orders / forecast) reachable upward from a
   * supply element. This is what draws the blast radius.
   */
  traceUp(supplyElementId: string): DemandElement[];
  /** Same, starting from an item-plant shortage rather than a specific order. */
  traceUpFromItemPlant(itemId: string, plantId: string): DemandElement[];
}

export interface PlanKpis {
  totalExposure: number;
  exceptionCount: number;
  /** Share of total exposure carried by the top 12 exceptions, 0–1. */
  top12Share: number;
  /** How many exceptions, ranked by money, it takes to reach 70% of exposure. */
  exceptionsToSeventyPercent: number;
  /** That count as a share of all exceptions, 0–1 — the Pareto in one number. */
  seventyPercentHeadShare: number;
  projectedFillRate: number;
  inventoryValue: number;
  daysOnHand: number;
  excessObsoleteExposure: number;
  expediteSpendMtd: number;
  autoResolvedPct: number;
  exceptionsByClass: Record<'A' | 'B' | 'C' | 'D', number>;
  exposureByClass: Record<'A' | 'B' | 'C' | 'D', number>;
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
  /** Dependent demand the engine generated while exploding BOMs. */
  derivedDemand: DemandElement[];
  exceptions: PlanningException[];
  resolutions: Map<string, Resolution>;
  pegging: PeggingGraph;
  kpis: PlanKpis;
  /** Item-plants whose BOM participates in a cycle — planned around, not thrown on. */
  circularItemPlants: string[];
}

/** Stable key for the per-item-plant maps. */
export function planKey(itemId: string, plantId: string): string {
  return `${itemId}@${plantId}`;
}
