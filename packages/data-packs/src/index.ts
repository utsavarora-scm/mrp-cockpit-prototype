/**
 * Data pack registry.
 *
 * The engine, the API layer and every screen are written against the domain
 * model alone — no pack-specific vocabulary reaches any of them. Adding a second
 * pack is a matter of writing another generator and registering it here.
 *
 * `NEXT_PUBLIC_DATA_PACK` picks the pack the app *boots* with. It does not
 * constrain what the app can reach: the category switcher calls `getDataPack`
 * at runtime, which is what lets Act 1 and Act 2 be one unbroken take rather
 * than two recordings joined in an edit.
 */

import type { MrpOptions, PlanningSnapshot } from '@repo/domain';

import { GCPL_SOAPS_COUNTS, generateGcplSoapsSnapshot } from './gcpl-soaps/generate';
import { GCPL_SOAPS_SPEC } from './gcpl-soaps/spec';

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

const soaps: DataPack = {
  id: GCPL_SOAPS_SPEC.id,
  label: GCPL_SOAPS_SPEC.label,
  planningDate: GCPL_SOAPS_SPEC.planningDate,
  horizonDays: GCPL_SOAPS_SPEC.horizonDays,
  seed: GCPL_SOAPS_SPEC.seed,
  generate: generateGcplSoapsSnapshot,
  defaultOptions: (scenarioId: string): MrpOptions => ({
    planningDate: GCPL_SOAPS_SPEC.planningDate,
    horizonDays: GCPL_SOAPS_SPEC.horizonDays,
    bucketing: 'DAY',
    forecastConsumption: { backwardDays: 20, forwardDays: 10 },
    useActualLeadTimes: false,
    scenarioId,
  }),
};

const REGISTRY: Record<string, DataPack> = {
  [soaps.id]: soaps,
};

export const DEFAULT_DATA_PACK_ID = soaps.id;

export function getDataPack(id: string | undefined = DEFAULT_DATA_PACK_ID): DataPack {
  return REGISTRY[id ?? DEFAULT_DATA_PACK_ID] ?? soaps;
}

export function listDataPacks(): DataPack[] {
  return Object.values(REGISTRY);
}

export { GCPL_SOAPS_COUNTS, GCPL_SOAPS_SPEC };
export { HERO, PACKAGING_DRIFT, DUAL_SOURCED } from './gcpl-soaps/spec';
export { mulberry32, streamFactory, type Rng } from './prng';
export { attachDeliverySchedules, buildDeliverySchedule } from './delivery-schedule';
