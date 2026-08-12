/**
 * The planning session.
 *
 * Everything the app knows lives here, in memory, on the server. There is no
 * database: the dataset is generated from a fixed seed, so storing a copy of
 * something reproducible in 300ms would buy nothing and cost a migration step
 * before every demo. Reset is therefore genuinely instant — drop the overlay,
 * keep the base.
 *
 * The singleton is pinned to `globalThis` so it survives module reloads in
 * development. Without that, every hot reload silently re-runs the engine and
 * the elapsed-time readout stops meaning anything.
 */

import { createAdapters, type AdapterSet } from '@repo/adapters';
import { getDataPack, type DataPack } from '@repo/data-packs';
import type { MrpOptions, MrpResult, PlanningSnapshot, SnapshotMutation } from '@repo/domain';
import { applyMutations, runMrp } from '@repo/mrp-engine';

export interface CommittedChange {
  id: string;
  /** Sequence number — the session has no clock of its own. */
  sequence: number;
  exceptionId: string;
  resolutionId: string;
  label: string;
  mutations: SnapshotMutation[];
  /** Set when the autonomous agent applied it rather than a planner. */
  appliedByAgent: boolean;
  policyRule?: string;
  estimatedImpact: number;
  reversed: boolean;
}

export interface Scenario {
  id: string;
  label: string;
  description: string;
  /** Change ids from the log that this scenario includes. */
  changeIds: string[];
  optionOverrides: Partial<MrpOptions>;
  isBaseline: boolean;
}

interface SessionState {
  pack: DataPack;
  baseSnapshot: PlanningSnapshot;
  adapters: AdapterSet;
  changes: CommittedChange[];
  scenarios: Map<string, Scenario>;
  planCache: Map<string, MrpResult>;
  /** Elapsed milliseconds of the most recent full run, for the UI readout. */
  lastRunMs: number;
  /** KPIs from the previous run, so the strip can show a delta. */
  previousKpis: MrpResult['kpis'] | null;
  sequence: number;
}

const GLOBAL_KEY = Symbol.for('mrp-cockpit.session');

type GlobalWithSession = typeof globalThis & { [GLOBAL_KEY]?: SessionState };

function createState(): SessionState {
  const pack = getDataPack(process.env.NEXT_PUBLIC_DATA_PACK);
  const baseSnapshot = pack.generate();

  const state: SessionState = {
    pack,
    baseSnapshot,
    adapters: createAdapters(baseSnapshot, pack.planningDate),
    changes: [],
    scenarios: new Map(),
    planCache: new Map(),
    lastRunMs: 0,
    previousKpis: null,
    sequence: 0,
  };

  seedScenarios(state);
  return state;
}

function seedScenarios(state: SessionState): void {
  const scenarios: Scenario[] = [
    {
      id: 'baseline',
      label: 'Baseline',
      description: 'The working plan: maintained master data, plus every resolution committed this session.',
      changeIds: [],
      optionOverrides: {},
      isBaseline: true,
    },
    {
      id: 'observed-lead-times',
      label: 'Observed lead times',
      description:
        'The same plan, rebuilt on what suppliers have actually been doing rather than on the maintained figures.',
      changeIds: [],
      optionOverrides: { useActualLeadTimes: true },
      isBaseline: false,
    },
    {
      id: 'pristine',
      label: 'Untouched plan',
      description: 'The plan as generated, before any resolution was committed this session — the comparison point.',
      changeIds: [],
      optionOverrides: {},
      isBaseline: false,
    },
  ];
  for (const scenario of scenarios) state.scenarios.set(scenario.id, scenario);
}

export function session(): SessionState {
  const scope = globalThis as GlobalWithSession;
  if (!scope[GLOBAL_KEY]) scope[GLOBAL_KEY] = createState();
  return scope[GLOBAL_KEY];
}

// ---------------------------------------------------------------------------

export function planningOptions(scenarioId: string, overrides: Partial<MrpOptions> = {}): MrpOptions {
  const state = session();
  const scenario = state.scenarios.get(scenarioId);
  return {
    ...state.pack.defaultOptions(scenarioId),
    ...(scenario?.optionOverrides ?? {}),
    ...overrides,
  };
}

/**
 * Active, non-reversed mutations for a scenario.
 *
 * Every scenario except `pristine` carries the committed changes, because the
 * baseline *is* the working plan — a planner who commits a fix and sees the
 * cockpit unchanged has been shown a toy.
 */
export function mutationsFor(scenarioId: string): SnapshotMutation[] {
  if (scenarioId === 'pristine') return [];
  const state = session();
  return state.changes.filter((change) => !change.reversed).flatMap((change) => change.mutations);
}

export function snapshotFor(scenarioId: string): PlanningSnapshot {
  const state = session();
  const mutations = mutationsFor(scenarioId);
  return mutations.length === 0 ? state.baseSnapshot : applyMutations(state.baseSnapshot, mutations);
}

/**
 * The plan for a scenario, cached on the exact inputs that produced it.
 *
 * The cache key includes every committed change, so a commit invalidates
 * naturally rather than needing to be remembered.
 */
export function planFor(scenarioId: string, overrides: Partial<MrpOptions> = {}): MrpResult {
  const state = session();
  const options = planningOptions(scenarioId, overrides);
  const mutations = mutationsFor(scenarioId);
  const key = `${scenarioId}|${options.useActualLeadTimes}|${options.horizonDays}|${mutations.length}|${state.changes
    .filter((c) => !c.reversed)
    .map((c) => c.id)
    .join(',')}`;

  const cached = state.planCache.get(key);
  if (cached) return cached;

  const snapshot = mutations.length === 0 ? state.baseSnapshot : applyMutations(state.baseSnapshot, mutations);
  const result = runMrp(snapshot, options);

  if (scenarioId === 'baseline') {
    if (state.lastRunMs > 0) state.previousKpis = state.planCache.get(key)?.kpis ?? state.previousKpis;
    state.lastRunMs = result.elapsedMs;
  }

  state.planCache.set(key, result);
  return result;
}

/** Forces a fresh run, which is what the Run MRP button does. */
export function rerun(scenarioId = 'baseline'): MrpResult {
  const state = session();
  const previous = state.planCache.get(cacheKeyFor(scenarioId));
  if (previous) state.previousKpis = previous.kpis;
  state.planCache.clear();
  return planFor(scenarioId);
}

function cacheKeyFor(scenarioId: string): string {
  const state = session();
  const options = planningOptions(scenarioId);
  const mutations = mutationsFor(scenarioId);
  return `${scenarioId}|${options.useActualLeadTimes}|${options.horizonDays}|${mutations.length}|${state.changes
    .filter((c) => !c.reversed)
    .map((c) => c.id)
    .join(',')}`;
}

export function previousKpis(): MrpResult['kpis'] | null {
  return session().previousKpis;
}

// ---------------------------------------------------------------------------

export function commitChange(input: Omit<CommittedChange, 'id' | 'sequence' | 'reversed'>): CommittedChange {
  const state = session();
  state.sequence += 1;
  const change: CommittedChange = {
    ...input,
    id: `CHG-${String(state.sequence).padStart(4, '0')}`,
    sequence: state.sequence,
    reversed: false,
  };
  state.changes.push(change);
  // Any plan that included the previous change set is now stale.
  state.planCache.clear();
  return change;
}

export function reverseChange(changeId: string): CommittedChange | null {
  const state = session();
  const change = state.changes.find((entry) => entry.id === changeId);
  if (!change) return null;
  change.reversed = true;
  state.planCache.clear();
  return change;
}

export function changeLog(): CommittedChange[] {
  return session().changes;
}

export function scenarios(): Scenario[] {
  return [...session().scenarios.values()];
}

export function adapters(): AdapterSet {
  return session().adapters;
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
 * overlay — no regeneration, no reload, well under the two-second budget.
 */
export function resetDemo(): void {
  const state = session();
  state.changes = [];
  state.planCache.clear();
  state.previousKpis = null;
  state.lastRunMs = 0;
  state.sequence = 0;
  state.scenarios.clear();
  seedScenarios(state);
}
