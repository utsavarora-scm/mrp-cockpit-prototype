/**
 * Data pack registry.
 *
 * The engine, the API layer and every screen are written against the domain
 * model alone — no pack-specific vocabulary reaches any of them. Adding a
 * second category is a matter of writing another generator and registering it
 * here.
 */

import type { MrpOptions, PlanningSnapshot } from '@repo/domain';

import { generatePilotSnapshot, PILOT_COUNTS } from './gcpl-pilot/generate';
import { PILOT_SPEC } from './gcpl-pilot/spec';

export interface DataPack {
  id: string;
  label: string;
  /** Fixed planning date — never read from a clock, or the demo stops repeating. */
  planningDate: string;
  horizonDays: number;
  seed: number;
  generate(): PlanningSnapshot;
  defaultOptions(scenarioId: string): MrpOptions;
}

const pilot: DataPack = {
  id: PILOT_SPEC.id,
  label: PILOT_SPEC.label,
  planningDate: PILOT_SPEC.planningDate,
  horizonDays: PILOT_SPEC.horizonDays,
  seed: PILOT_SPEC.seed,
  generate: generatePilotSnapshot,
  defaultOptions: (scenarioId: string): MrpOptions => ({
    planningDate: PILOT_SPEC.planningDate,
    horizonDays: PILOT_SPEC.horizonDays,
    bucketing: 'DAY',
    // No forecast consumption. The engine's entry point is an agreed master
    // production schedule — independent demand already resolved into a
    // producible plan — so there is no forecast left to net a sales order
    // against. Running a consumption pass over an MPS does not clean it up; it
    // quietly deletes demand.
    forecastConsumption: { backwardDays: 0, forwardDays: 0 },
    useActualLeadTimes: false,
    scenarioId,
  }),
};

const REGISTRY: Record<string, DataPack> = {
  [pilot.id]: pilot,
};

export const DEFAULT_DATA_PACK_ID = pilot.id;

export function getDataPack(id: string | undefined = DEFAULT_DATA_PACK_ID): DataPack {
  return REGISTRY[id ?? DEFAULT_DATA_PACK_ID] ?? pilot;
}

export function listDataPacks(): DataPack[] {
  return Object.values(REGISTRY);
}

export { PILOT_COUNTS, PILOT_SPEC };
export {
  CHAIN_FG,
  CHAIN_ITEMS,
  HERO_PM,
  HERO_RM,
  HERO_RM_TWIN,
  HORIZON_DAYS,
  PACKAGING_DRIFT,
  PLANNING_DATE,
  SOAP_CHAIN,
} from './gcpl-pilot/spec';
export { mulberry32, streamFactory, type Rng } from './prng';
