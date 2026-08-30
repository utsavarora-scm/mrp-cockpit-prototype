/**
 * The planning session.
 *
 * Everything the app knows lives here, in memory, on the server. There is no
 * database: the dataset is generated from a fixed seed, so storing a copy of
 * something reproducible in 300ms would buy nothing and cost a migration step
 * before every demo. Reset is therefore genuinely instant — drop the cache,
 * keep the base snapshot.
 *
 * The singleton is pinned to `globalThis` so it survives module reloads in
 * development. Without that, every hot reload silently re-runs the engine and
 * the elapsed-time readout stops meaning anything.
 */

import { getDataPack, type DataPack } from '@repo/data-packs';
import type { ItemPlant, MrpOptions, MrpResult, PlanningSnapshot, SnapshotMutation } from '@repo/domain';
import { runMrp } from '@repo/mrp-engine';

/**
 * A planner override, as recorded.
 *
 * Who, what, when, why, before and after — all six, because the override log is
 * not an audit afterthought. The Excel behaviour this product replaces is
 * invisible today, and capturing it is what tells us later which norms are
 * systematically wrong: a material overridden nine times in ten has a broken
 * norm, and that is a finding rather than a complaint about the planner.
 */
export interface RecordedOverride {
  id: string;
  /** Sequence stands in for a clock — the planning date is fixed by design. */
  sequence: number;
  itemId: string;
  plantId: string;
  field: OverridableField;
  before: number | null;
  after: number | null;
  reason: string;
  actor: string;
}

export type OverridableField = Extract<SnapshotMutation, { kind: 'SET_ITEM_PLANT_PARAM' }>['field'];

interface SessionState {
  pack: DataPack;
  baseSnapshot: PlanningSnapshot;
  overrides: RecordedOverride[];
  planCache: Map<string, MrpResult>;
  /** Elapsed milliseconds of the most recent full run, for the UI readout. */
  lastRunMs: number;
  sequence: number;
}

const GLOBAL_KEY = Symbol.for('mrp-cockpit.session');

type GlobalWithSession = typeof globalThis & { [GLOBAL_KEY]?: SessionState };

function createState(): SessionState {
  const pack = getDataPack(process.env.NEXT_PUBLIC_DATA_PACK);
  return { pack, baseSnapshot: pack.generate(), overrides: [], planCache: new Map(), lastRunMs: 0, sequence: 0 };
}

export function session(): SessionState {
  const scope = globalThis as GlobalWithSession;
  if (!scope[GLOBAL_KEY]) scope[GLOBAL_KEY] = createState();
  return scope[GLOBAL_KEY];
}

// ---------------------------------------------------------------------------

export function planningOptions(scenarioId: string, overrides: Partial<MrpOptions> = {}): MrpOptions {
  return { ...session().pack.defaultOptions(scenarioId), ...overrides };
}

/**
 * The snapshot with every recorded override applied.
 *
 * Overrides are replayed onto the pristine base rather than mutated into it, so
 * reset is a matter of dropping the list and the base is always exactly what the
 * seed produced.
 */
export function snapshotFor(): PlanningSnapshot {
  const state = session();
  if (state.overrides.length === 0) return state.baseSnapshot;

  const itemPlants = state.baseSnapshot.itemPlants.map((entry) => {
    const applicable = state.overrides.filter((o) => o.itemId === entry.itemId && o.plantId === entry.plantId);
    if (applicable.length === 0) return entry;
    let next: ItemPlant = { ...entry };
    for (const override of applicable) next = { ...next, [override.field]: override.after };
    return next;
  });

  return { ...state.baseSnapshot, itemPlants };
}

/** Records an override and drops the plan cache, so the next read re-plans. */
export function recordOverride(input: Omit<RecordedOverride, 'id' | 'sequence'>): RecordedOverride {
  const state = session();
  state.sequence += 1;
  const override: RecordedOverride = {
    ...input,
    id: `OVR-${String(state.sequence).padStart(4, '0')}`,
    sequence: state.sequence,
  };
  state.overrides.push(override);
  state.planCache.clear();
  return override;
}

export function overrideLog(): RecordedOverride[] {
  return session().overrides;
}

/** The plan for a scenario, cached on the options that produced it. */
export function planFor(scenarioId: string, overrides: Partial<MrpOptions> = {}): MrpResult {
  const state = session();
  const options = planningOptions(scenarioId, overrides);
  const key = `${scenarioId}|${options.useActualLeadTimes}|${options.horizonDays}|${state.overrides.length}`;

  const cached = state.planCache.get(key);
  if (cached) return cached;

  const result = runMrp(snapshotFor(), options);
  if (scenarioId === 'baseline') state.lastRunMs = result.elapsedMs;
  state.planCache.set(key, result);
  return result;
}

/** Forces a fresh run, which is what the re-plan button does. */
export function rerun(scenarioId = 'baseline'): MrpResult {
  session().planCache.clear();
  return planFor(scenarioId);
}

/**
 * The plan as it would stand with one master-data field changed.
 *
 * Clones only the one item-plant record and re-runs, so the comparison is a
 * genuine second plan rather than a projected estimate of one. Nothing is
 * written back: the caller renders the difference and discards it.
 */
export function planWithParamOverride(
  scenarioId: string,
  itemId: string,
  plantId: string,
  field: Extract<SnapshotMutation, { kind: 'SET_ITEM_PLANT_PARAM' }>['field'],
  value: number | null,
): { plan: MrpResult; snapshot: PlanningSnapshot; master: ItemPlant } | null {
  const base = snapshotFor();
  const index = base.itemPlants.findIndex((entry) => entry.itemId === itemId && entry.plantId === plantId);
  if (index === -1) return null;

  const master: ItemPlant = { ...(base.itemPlants[index] as ItemPlant), [field]: value };
  const itemPlants = [...base.itemPlants];
  itemPlants[index] = master;

  const snapshot: PlanningSnapshot = { ...base, itemPlants };
  return { plan: runMrp(snapshot, planningOptions(scenarioId)), snapshot, master };
}

export function dataPack(): DataPack {
  return session().pack;
}

export function baseSnapshot(): PlanningSnapshot {
  return session().baseSnapshot;
}

/**
 * Back to the exact starting state.
 *
 * The base snapshot is untouched by design, so this is a matter of dropping the
 * cache — no regeneration, no reload, well under the two-second budget.
 */
export function resetDemo(): void {
  const state = session();
  state.overrides = [];
  state.planCache.clear();
  state.lastRunMs = 0;
  state.sequence = 0;
}
