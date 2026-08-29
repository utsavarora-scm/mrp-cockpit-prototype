/**
 * Data pack registry.
 *
 * The engine, the API layer and every screen are written against the domain
 * model alone — no pack-specific vocabulary reaches any of them. Adding a second
 * pack is a matter of writing another generator and registering it here.
 *
 * Selected by `NEXT_PUBLIC_DATA_PACK`, defaulting to the confectionery pack.
 */

import type { MrpOptions, PlanningSnapshot } from '@repo/domain';

import { CONFECTIONERY_COUNTS, generateConfectionerySnapshot } from './confectionery/generate';
import { CONFECTIONERY_SPEC } from './confectionery/spec';

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

const confectionery: DataPack = {
  id: CONFECTIONERY_SPEC.id,
  label: CONFECTIONERY_SPEC.label,
  planningDate: CONFECTIONERY_SPEC.planningDate,
  horizonDays: CONFECTIONERY_SPEC.horizonDays,
  seed: CONFECTIONERY_SPEC.seed,
  generate: generateConfectionerySnapshot,
  defaultOptions: (scenarioId: string): MrpOptions => ({
    planningDate: CONFECTIONERY_SPEC.planningDate,
    horizonDays: CONFECTIONERY_SPEC.horizonDays,
    bucketing: 'DAY',
    forecastConsumption: { backwardDays: 20, forwardDays: 10 },
    useActualLeadTimes: false,
    scenarioId,
  }),
};

const REGISTRY: Record<string, DataPack> = {
  [confectionery.id]: confectionery,
};

export const DEFAULT_DATA_PACK_ID = confectionery.id;

export function getDataPack(id: string | undefined = DEFAULT_DATA_PACK_ID): DataPack {
  return REGISTRY[id ?? DEFAULT_DATA_PACK_ID] ?? confectionery;
}

export function listDataPacks(): DataPack[] {
  return Object.values(REGISTRY);
}

export { CONFECTIONERY_COUNTS, CONFECTIONERY_SPEC };
export { mulberry32, streamFactory, type Rng } from './prng';
export { attachDeliverySchedules, buildDeliverySchedule } from './delivery-schedule';
