/**
 * The planning session.
 *
 * Everything the app knows lives here, in memory, on the server. There is no
 * database: the dataset is generated from a fixed seed, so storing a copy of
 * something reproducible in a few hundred milliseconds would buy nothing and
 * cost a migration step before every demo. Reset is therefore genuinely
 * instant — drop the overlay, keep the generated base.
 *
 * The singleton is pinned to `globalThis` so it survives module reloads in
 * development. Without that, every hot reload silently re-runs the engine and
 * the elapsed-time readout stops meaning anything.
 *
 * Two things are kept beside the plan and both are the point of the product
 * rather than plumbing: the **previous run**, so "what changed since Friday"
 * is a diff of two real plans, and the **decision log**, so every override and
 * every schedule edit is recorded with its reason. The second is the dataset
 * the norms work runs on, and it does not exist anywhere at GCPL today.
 */

import { getDataPack, type DataPack, type PlanChange } from '@repo/data-packs';
import type { ItemPlant, MrpOptions, MrpResult, PlanningSnapshot, SnapshotMutation } from '@repo/domain';
import { runMrp } from '@repo/planning-engine';

/**
 * A planner decision, as recorded.
 *
 * Who, what, when, why, before and after — all six. The spreadsheet behaviour
 * this replaces is invisible today, and capturing it is what later tells us
 * which norms are systematically wrong: a material overridden nine times in ten
 * has a broken norm, and that is a finding rather than a complaint about the
 * planner.
 */
export interface RecordedDecision {
  id: string;
  /** Sequence stands in for a clock — the planning date is fixed by design. */
  sequence: number;
  kind: 'PARAMETER_OVERRIDE' | 'SCHEDULE_EDIT' | 'EXCEPTION_DISMISSED' | 'ADHERENCE_CAPTURED';
  itemId: string;
  plantId: string;
  /** What was changed — a parameter name, an order line, an exception id. */
  target: string;
  before: string | null;
  after: string | null;
  reasonCode: string | null;
  note: string;
  actor: string;
}

export type OverridableField = Extract<SnapshotMutation, { kind: 'SET_ITEM_PLANT_PARAM' }>['field'];

/** A parameter a planner has overridden for one material. */
interface ParamOverride {
  itemId: string;
  plantId: string;
  field: OverridableField;
  value: number | null;
}

/** A schedule line a planner has moved or resized, keyed `orderId#line`. */
export interface ScheduleEdit {
  orderId: string;
  line: number;
  qty: number | null;
  date: string | null;
  reasonCode: string;
  note: string;
}

interface SessionState {
  pack: DataPack;
  baseSnapshot: PlanningSnapshot;
  previousSnapshot: PlanningSnapshot;
  changesSinceLastRun: PlanChange[];
  overrides: ParamOverride[];
  scheduleEdits: Map<string, ScheduleEdit>;
  decisions: RecordedDecision[];
  dismissed: Set<string>;
  planCache: Map<string, MrpResult>;
  /** Elapsed milliseconds of the most recent full run, for the UI readout. */
  lastRunMs: number;
  sequence: number;
}

const GLOBAL_KEY = Symbol.for('gcpl-scheduling.session');

type GlobalWithSession = typeof globalThis & { [GLOBAL_KEY]?: SessionState };

function createState(): SessionState {
  const pack = getDataPack(process.env.NEXT_PUBLIC_DATA_PACK);
  const baseSnapshot = pack.generate();
  const previous = pack.generatePrevious(baseSnapshot);
  return {
    pack,
    baseSnapshot,
    previousSnapshot: previous.snapshot,
    changesSinceLastRun: previous.changes,
    overrides: [],
    scheduleEdits: new Map(),
    decisions: [],
    dismissed: new Set(),
    planCache: new Map(),
    lastRunMs: 0,
    sequence: 0,
  };
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
 * The snapshot with every recorded decision applied.
 *
 * Decisions are replayed onto the pristine base rather than mutated into it, so
 * reset is a matter of dropping the list and the base is always exactly what
 * the seed produced.
 */
export function snapshotFor(): PlanningSnapshot {
  const state = session();
  if (state.overrides.length === 0 && state.scheduleEdits.size === 0) return state.baseSnapshot;

  let itemPlants = state.baseSnapshot.itemPlants;
  if (state.overrides.length > 0) {
    itemPlants = itemPlants.map((entry) => {
      const applicable = state.overrides.filter((row) => row.itemId === entry.itemId && row.plantId === entry.plantId);
      if (applicable.length === 0) return entry;
      let next: ItemPlant = { ...entry };
      for (const override of applicable) next = { ...next, [override.field]: override.value };
      return next;
    });
  }

  let supply = state.baseSnapshot.supply;
  if (state.scheduleEdits.size > 0) {
    supply = supply.map((element) => {
      if (!element.schedule || element.schedule.length === 0) return element;
      let touched = false;
      const schedule = element.schedule.map((line) => {
        const edit = state.scheduleEdits.get(`${element.id}#${line.line}`);
        if (!edit) return line;
        touched = true;
        const date = edit.date ?? line.expectedDate;
        return {
          ...line,
          qty: edit.qty ?? line.qty,
          plannedDate: date,
          expectedDate: date,
          // A line the planner has moved is a request, not an acknowledgement.
          // Re-dating it does not make the vendor agree to the new date, and
          // pretending otherwise is exactly the rosy picture this avoids.
          confirmedDate: null,
          reasonCode: edit.reasonCode,
          note: edit.note,
        };
      });
      if (!touched) return element;
      return { ...element, qty: schedule.reduce((sum, line) => sum + line.qty, 0), schedule };
    });
  }

  return { ...state.baseSnapshot, itemPlants, supply };
}

/** Records a decision, drops the plan cache, and returns what was recorded. */
export function recordDecision(input: Omit<RecordedDecision, 'id' | 'sequence'>): RecordedDecision {
  const state = session();
  state.sequence += 1;
  const decision: RecordedDecision = {
    ...input,
    id: `DEC-${String(state.sequence).padStart(4, '0')}`,
    sequence: state.sequence,
  };
  state.decisions.push(decision);
  state.planCache.clear();
  return decision;
}

export function applyOverride(
  itemId: string,
  plantId: string,
  field: OverridableField,
  value: number | null,
  before: number | null,
  reasonCode: string,
  note: string,
): RecordedDecision {
  const state = session();
  state.overrides.push({ itemId, plantId, field, value });
  return recordDecision({
    kind: 'PARAMETER_OVERRIDE',
    itemId,
    plantId,
    target: field,
    before: before === null ? null : String(before),
    after: value === null ? null : String(value),
    reasonCode,
    note,
    actor: 'Planner',
  });
}

export function applyScheduleEdit(
  itemId: string,
  plantId: string,
  edit: ScheduleEdit,
  before: string,
): RecordedDecision {
  const state = session();
  state.scheduleEdits.set(`${edit.orderId}#${edit.line}`, edit);
  return recordDecision({
    kind: 'SCHEDULE_EDIT',
    itemId,
    plantId,
    target: `${edit.orderId} line ${edit.line}`,
    before,
    after: `${edit.qty ?? '—'} on ${edit.date ?? '—'}`,
    reasonCode: edit.reasonCode,
    note: edit.note,
    actor: 'Planner',
  });
}

export function dismissException(id: string, itemId: string, plantId: string, reasonCode: string, note: string): void {
  const state = session();
  state.dismissed.add(id);
  // A recurring dismissal is itself a finding: it usually means a norm is
  // wrong. So dismissals are retained rather than simply hiding a row.
  recordDecision({
    kind: 'EXCEPTION_DISMISSED',
    itemId,
    plantId,
    target: id,
    before: null,
    after: null,
    reasonCode,
    note,
    actor: 'Planner',
  });
}

export function decisionLog(): RecordedDecision[] {
  return session().decisions;
}

export function dismissedExceptions(): Set<string> {
  return session().dismissed;
}

export function scheduleEdits(): Map<string, ScheduleEdit> {
  return session().scheduleEdits;
}

export function changesSinceLastRun(): PlanChange[] {
  return session().changesSinceLastRun;
}

/** The plan for a scenario, cached on the options and decisions that produced it. */
export function planFor(scenarioId: string, overrides: Partial<MrpOptions> = {}): MrpResult {
  const state = session();
  const options = planningOptions(scenarioId, overrides);
  const key = `${scenarioId}|${options.useActualLeadTimes}|${options.horizonDays}|${state.overrides.length}|${state.scheduleEdits.size}`;

  const cached = state.planCache.get(key);
  if (cached) return cached;

  const result = runMrp(snapshotFor(), options);
  if (scenarioId === 'baseline') state.lastRunMs = result.elapsedMs;
  state.planCache.set(key, result);
  return result;
}

/**
 * Last week's run.
 *
 * A genuine second planning run over the snapshot as it stood then, not a
 * remembered summary of it. That is what lets the drift panel say *what*
 * changed and *by how much* rather than only that something did.
 */
export function previousRun(): MrpResult {
  const state = session();
  const cached = state.planCache.get('previous');
  if (cached) return cached;
  const result = runMrp(state.previousSnapshot, planningOptions('previous'));
  state.planCache.set('previous', result);
  return result;
}

/** Forces a fresh run, which is what the re-plan button does. */
export function rerun(scenarioId = 'baseline'): MrpResult {
  const state = session();
  const previous = state.planCache.get('previous');
  state.planCache.clear();
  // The previous run is not re-run: it is history, and history does not move
  // because somebody pressed re-plan.
  if (previous) state.planCache.set('previous', previous);
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
  field: OverridableField,
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

export function lastRunMs(): number {
  return session().lastRunMs;
}

/**
 * Back to the exact starting state.
 *
 * The base snapshot is untouched by design, so this is a matter of dropping the
 * overlay — no regeneration, no reload.
 */
export function resetDemo(): void {
  const state = session();
  state.overrides = [];
  state.scheduleEdits = new Map();
  state.decisions = [];
  state.dismissed = new Set();
  state.planCache.clear();
  state.lastRunMs = 0;
  state.sequence = 0;
}
