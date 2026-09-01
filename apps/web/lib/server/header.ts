/**
 * The run header, which every screen carries.
 *
 * Not administrative hygiene. The parallel spreadsheet exists partly because
 * nobody can tell whether two numbers came from the same run — so every screen
 * says which run it is looking at, what version of the plan fed it, and how
 * long ago that was.
 */

import { weekLabel } from '@repo/domain';

import type { RunHeader } from '../api-types';
import { packLabel, type RunContext } from './context';

export function runHeader(context: RunContext): RunHeader {
  return {
    planningDate: context.planningDate,
    planningWeek: weekLabel(context.planningDate),
    runType: 'Full regenerative run',
    // The plan is versioned so two planners looking at two numbers can always
    // find out whether they are looking at two plans.
    mpsVersion: `MPS-${context.planningDate.replace(/-/g, '')}-01`,
    category: packLabel(),
    pilotPlantId: context.pilotPlantId,
    horizonDays: context.horizonDays,
    materialsPlanned: context.materials.size,
    elapsedMs: Math.round(context.elapsedMs),
    plants: context.snapshot.plants.map((plant) => ({ id: plant.id, name: plant.name, type: plant.type })),
  };
}
