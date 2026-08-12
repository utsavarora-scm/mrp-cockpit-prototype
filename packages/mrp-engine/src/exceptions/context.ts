/**
 * Shared plumbing for the four exception passes: lookups, memoised pegging, id
 * generation and the impact roll-up. Each class module stays focused on its own
 * detection rules.
 */

import {
  type DemandElement,
  type EvidenceFact,
  type ExceptionCode,
  type ImpactBreakdown,
  type Item,
  type ItemPlant,
  type ItemPlantPlan,
  type MrpOptions,
  type PeggingGraph,
  type PlanningException,
  type PlanningSnapshot,
  type Severity,
  type SupplyElement,
  exceptionClassOf,
  fromEpochDay,
  planKey,
} from '@repo/domain';

import type { EngineIndex } from '../run-mrp';
import { emptyImpact } from './impact';

/** Codes that mean supply has genuinely failed, not merely degraded. */
const SUPPLY_FAILURE_CODES = new Set<ExceptionCode>(['A1-PROJECTED-STOCKOUT', 'A8-ORDER-IN-PAST', 'A4-RESCHEDULE-IN']);

/**
 * How much of the downstream revenue a *latent* defect carries — one that is
 * real but has not yet cost anything. Small on purpose: it is the difference
 * between the dozen findings that matter this month and the twelve hundred that
 * are housekeeping.
 */
const LATENT_DEFECT_FACTOR = 0.06;

export interface ExceptionDraft {
  code: ExceptionCode;
  severity: Severity;
  itemId: string;
  plantId: string;
  bucketDay: number;
  narrative: string;
  evidence: EvidenceFact[];
  impact?: ImpactBreakdown;
  peggedDemand?: DemandElement[];
  /** Appended to the id when one item-plant can raise the same code twice. */
  discriminator?: string;
}

export class ExceptionContext {
  readonly snapshot: PlanningSnapshot;
  readonly options: MrpOptions;
  readonly plans: Map<string, ItemPlantPlan>;
  readonly index: EngineIndex;
  readonly pegging: PeggingGraph;
  readonly plannedOrders: SupplyElement[];
  readonly derivedDemand: DemandElement[];
  readonly circular: string[];
  readonly forecastConsumed: Map<string, number>;
  readonly planningEpochDay: number;
  readonly horizonDays: number;

  private readonly emitted: PlanningException[] = [];
  private readonly peggingCache = new Map<string, DemandElement[]>();
  private readonly supplyFailures = new Set<string>();

  constructor(init: {
    snapshot: PlanningSnapshot;
    options: MrpOptions;
    plans: Map<string, ItemPlantPlan>;
    index: EngineIndex;
    pegging: PeggingGraph;
    plannedOrders: SupplyElement[];
    derivedDemand: DemandElement[];
    circular: string[];
    forecastConsumed: Map<string, number>;
  }) {
    this.snapshot = init.snapshot;
    this.options = init.options;
    this.plans = init.plans;
    this.index = init.index;
    this.pegging = init.pegging;
    this.plannedOrders = init.plannedOrders;
    this.derivedDemand = init.derivedDemand;
    this.circular = init.circular;
    this.forecastConsumed = init.forecastConsumed;
    this.planningEpochDay = init.index.planningEpochDay;
    this.horizonDays = init.options.horizonDays;
  }

  item(itemId: string): Item | undefined {
    return this.index.itemById.get(itemId);
  }

  itemPlant(itemId: string, plantId: string): ItemPlant | undefined {
    return this.index.itemPlantByKey.get(planKey(itemId, plantId));
  }

  plan(itemId: string, plantId: string): ItemPlantPlan | undefined {
    return this.plans.get(planKey(itemId, plantId));
  }

  /** ISO date for a day offset from the planning date. */
  dateOf(day: number): string {
    return fromEpochDay(this.planningEpochDay + day);
  }

  /**
   * Independent demand reachable upward from an item-plant. Cached — the blast
   * radius of a widely-used raw material is expensive to walk and several
   * exceptions on the same item ask for it.
   */
  peggedDemandFor(itemId: string, plantId: string): DemandElement[] {
    const key = planKey(itemId, plantId);
    const cached = this.peggingCache.get(key);
    if (cached) return cached;
    const traced = this.pegging.traceUpFromItemPlant(itemId, plantId);
    this.peggingCache.set(key, traced);
    return traced;
  }

  emit(draft: ExceptionDraft): PlanningException {
    const peggedDemand = draft.peggedDemand ?? [];
    const impact = draft.impact ?? emptyImpact();

    const fgItems = new Set<string>();
    for (const demand of peggedDemand) {
      if (this.index.itemById.get(demand.itemId)?.type === 'FG') fgItems.add(demand.itemId);
    }

    const exception: PlanningException = {
      id: `EXC-${draft.code}-${draft.itemId}-${draft.plantId}-${draft.bucketDay}${draft.discriminator ? `-${draft.discriminator}` : ''}`,
      code: draft.code,
      exceptionClass: exceptionClassOf(draft.code),
      severity: draft.severity,
      itemId: draft.itemId,
      plantId: draft.plantId,
      bucketDay: draft.bucketDay,
      narrative: draft.narrative,
      evidence: draft.evidence,
      impact,
      impactValue: impact.total,
      peggedDemandIds: peggedDemand.map((d) => d.id),
      peggedFgCount: fgItems.size,
      resolutionIds: [],
      autoResolvable: false,
    };

    this.emitted.push(exception);
    if (SUPPLY_FAILURE_CODES.has(draft.code)) this.supplyFailures.add(planKey(draft.itemId, draft.plantId));
    return exception;
  }

  /**
   * Whether this item-plant's supply has actually broken in this run.
   *
   * This is what separates a defect from a loss. A lead time that stopped being
   * true is worth correcting, but it is not worth the revenue of everything the
   * material touches — not until it has actually put a receipt out of reach.
   * Where it has, the same parameter is suddenly the most expensive row in the
   * queue. Class A runs first so this is populated by the time B and D value
   * their findings.
   */
  hasSupplyFailure(itemId: string, plantId: string): boolean {
    return this.supplyFailures.has(planKey(itemId, plantId));
  }

  /** Scales a defect's exposure down unless it has already broken something. */
  consequenceFactor(itemId: string, plantId: string): number {
    return this.hasSupplyFailure(itemId, plantId) ? 1 : LATENT_DEFECT_FACTOR;
  }

  results(): PlanningException[] {
    return this.emitted;
  }
}

/**
 * Joins clauses into a causal narrative. Every clause is built by its detector
 * from computed values — this only handles the punctuation, so no exception
 * ever reads as boilerplate with the numbers swapped out.
 */
export function narrate(clauses: string[]): string {
  return clauses
    .map((clause) => clause.trim())
    .filter(Boolean)
    .join(' ');
}
