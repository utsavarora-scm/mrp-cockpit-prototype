/**
 * Runs the four detection passes and ranks the result by money.
 *
 * The default sort is `impactValue DESC`, not severity. That single choice is
 * the product thesis: a planner facing 1,200 findings needs to know which twelve
 * carry most of the exposure, and no system in the stack tells them.
 */

import type {
  DemandElement,
  MrpOptions,
  ItemPlantPlan,
  PeggingGraph,
  PlanningException,
  PlanningSnapshot,
  SupplyElement,
} from '@repo/domain';

import type { EngineIndex } from '../run-mrp';
import { detectClassA } from './class-a';
import { detectClassB } from './class-b';
import { detectClassC } from './class-c';
import { detectClassD } from './class-d';
import { ExceptionContext } from './context';

export interface GenerateExceptionsInput {
  snapshot: PlanningSnapshot;
  options: MrpOptions;
  plans: Map<string, ItemPlantPlan>;
  index: EngineIndex;
  pegging: PeggingGraph;
  plannedOrders: SupplyElement[];
  derivedDemand: DemandElement[];
  circular: string[];
  forecastConsumed: Map<string, number>;
}

export function generateExceptions(input: GenerateExceptionsInput): PlanningException[] {
  const ctx = new ExceptionContext(input);

  detectClassA(ctx);
  detectClassB(ctx);
  detectClassC(ctx);
  detectClassD(ctx);

  const exceptions = ctx.results();
  exceptions.sort(byImpactThenId);
  return exceptions;
}

/** Money first; id as the tie-break so two runs order identically. */
function byImpactThenId(a: PlanningException, b: PlanningException): number {
  if (b.impactValue !== a.impactValue) return b.impactValue - a.impactValue;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
