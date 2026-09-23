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
import {
  fromEpochDay,
  toEpochDay,
  type ItemPlant,
  type MrpOptions,
  type MrpResult,
  type PlanningSnapshot,
  type SnapshotMutation,
} from '@repo/domain';
import { runMrp } from '@repo/planning-engine';

import {
  appendEvent,
  EVENT_SCHEMA_VERSION,
  readEvents,
  truncateEvents,
  type AdherenceCapture,
  type SessionMutation,
  type StoredEvent,
} from './event-log';

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

/**
 * A parameter a planner has overridden for one material.
 *
 * Scoped, dated and expiring — which the dialog has claimed since it was
 * written and the record could not support. An override with no window applies
 * to every bucket forever, and "dated" then describes the audit line beside it
 * rather than the change itself.
 */
interface ParamOverride {
  itemId: string;
  plantId: string;
  field: OverridableField;
  value: number | null;
  /** Day offset from the planning date the override starts applying. */
  effectiveFromDay: number;
  /** Day offset it stops. Null is open-ended, and the screen says so. */
  expiresOnDay: number | null;
  actor: string;
}

/**
 * A builder line the planner has set by hand, keyed `itemId@plantId`.
 *
 * Distinct from a `ScheduleEdit`, which moves a line on an order that already
 * exists. These are edits to a schedule the plan is still *proposing*, so they
 * live against the material rather than against a purchase order.
 */
export interface BuilderEdit {
  line: number;
  qty: number;
  reasonCode: string;
  note: string;
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
  /**
   * The shape this session was built against.
   *
   * The singleton is pinned to `globalThis` so it survives module reloads —
   * which is right for the plan cache and wrong the moment the *shape* changes:
   * a reload after adding a field leaves a session missing it, and the first
   * read of that field fails with a type error nobody can place. Bumping this
   * makes a stale session rebuild itself instead.
   */
  shape: number;
  pack: DataPack;
  baseSnapshot: PlanningSnapshot;
  previousSnapshot: PlanningSnapshot;
  changesSinceLastRun: PlanChange[];
  overrides: ParamOverride[];
  scheduleEdits: Map<string, ScheduleEdit>;
  /** Builder lines the planner has pinned, keyed `itemId@plantId`. */
  builderEdits: Map<string, BuilderEdit[]>;
  /**
   * What a planner recorded against each delivery line, keyed
   * `itemId@plantId#orderId#line`.
   *
   * Folded rather than accumulated: recording a goods receipt twice leaves one
   * record, so the measured lead time does not move twice for one arrival.
   */
  adherenceCaptures: Map<string, AdherenceCapture>;
  decisions: RecordedDecision[];
  dismissed: Set<string>;
  planCache: Map<string, MrpResult>;
  /** Elapsed milliseconds of the most recent full run, for the UI readout. */
  lastRunMs: number;
  sequence: number;
}

const GLOBAL_KEY = Symbol.for('gcpl-scheduling.session');

/** Bumped whenever `SessionState` gains or loses a field. */
const SESSION_SHAPE = 3;

type GlobalWithSession = typeof globalThis & { [GLOBAL_KEY]?: SessionState };

function createState(): SessionState {
  const pack = getDataPack(process.env.NEXT_PUBLIC_DATA_PACK);
  const baseSnapshot = pack.generate();
  const previous = pack.generatePrevious(baseSnapshot);
  return {
    shape: SESSION_SHAPE,
    pack,
    baseSnapshot,
    previousSnapshot: previous.snapshot,
    changesSinceLastRun: previous.changes,
    overrides: [],
    scheduleEdits: new Map(),
    builderEdits: new Map(),
    adherenceCaptures: new Map(),
    decisions: [],
    dismissed: new Set(),
    planCache: new Map(),
    lastRunMs: 0,
    sequence: 0,
  };
}

/**
 * Rebuilds the session from the log.
 *
 * State is the fold of the history, so a restart costs nothing. Applied in
 * order, so the last write to any key wins — which is what makes recording the
 * same goods receipt twice idempotent rather than cumulative.
 */
function replay(state: SessionState): void {
  for (const event of readEvents()) {
    applyMutation(state, event.mutation);
    state.sequence += 1;
    state.decisions.push({
      id: event.eventId,
      sequence: state.sequence,
      kind: kindOf(event.mutation),
      itemId: 'itemId' in event.mutation ? event.mutation.itemId : '',
      plantId: 'plantId' in event.mutation ? event.mutation.plantId : '',
      target: event.target,
      before: event.before,
      after: event.after,
      reasonCode: event.reasonCode,
      note: event.note,
      actor: event.actor,
    });
  }
}

function kindOf(mutation: SessionMutation): RecordedDecision['kind'] {
  switch (mutation.kind) {
    case 'PARAMETER_OVERRIDE':
      return 'PARAMETER_OVERRIDE';
    case 'EXCEPTION_DISMISSED':
      return 'EXCEPTION_DISMISSED';
    case 'ADHERENCE_CAPTURED':
      return 'ADHERENCE_CAPTURED';
    default:
      return 'SCHEDULE_EDIT';
  }
}

/** The one place a mutation changes state, so replay and live writes agree. */
function applyMutation(state: SessionState, mutation: SessionMutation): void {
  switch (mutation.kind) {
    case 'PARAMETER_OVERRIDE':
      state.overrides.push({
        itemId: mutation.itemId,
        plantId: mutation.plantId,
        field: mutation.field,
        value: mutation.value,
        effectiveFromDay: mutation.effectiveFromDay ?? 0,
        expiresOnDay: mutation.expiresOnDay ?? null,
        actor: 'Planner',
      });
      return;

    case 'SCHEDULE_EDIT':
      state.scheduleEdits.set(scheduleEditKey(mutation.itemId, mutation.plantId, mutation.orderId, mutation.line), {
        orderId: mutation.orderId,
        line: mutation.line,
        qty: mutation.qty,
        date: mutation.date,
        reasonCode: mutation.reasonCode,
        note: mutation.note,
      });
      return;

    case 'BUILDER_EDIT': {
      const key = `${mutation.itemId}@${mutation.plantId}`;
      const remaining = (state.builderEdits.get(key) ?? []).filter((row) => row.line !== mutation.line);
      if (mutation.qty === null) {
        if (remaining.length === 0) state.builderEdits.delete(key);
        else state.builderEdits.set(key, remaining);
      } else {
        state.builderEdits.set(
          key,
          [
            ...remaining,
            { line: mutation.line, qty: mutation.qty, reasonCode: mutation.reasonCode, note: mutation.note },
          ].sort((a, b) => a.line - b.line),
        );
      }
      return;
    }

    case 'EXCEPTION_DISMISSED':
      state.dismissed.add(mutation.id);
      return;

    case 'ADHERENCE_CAPTURED':
      state.adherenceCaptures.set(
        scheduleEditKey(mutation.itemId, mutation.plantId, mutation.orderId, mutation.line),
        mutation.capture,
      );
      return;

    case 'SCHEDULE_PREPARED':
      return;
  }
}

export function session(): SessionState {
  const scope = globalThis as GlobalWithSession;
  if (!scope[GLOBAL_KEY] || scope[GLOBAL_KEY].shape !== SESSION_SHAPE) {
    const state = createState();
    replay(state);
    scope[GLOBAL_KEY] = state;
  }
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
  if (state.overrides.length === 0 && state.scheduleEdits.size === 0 && state.adherenceCaptures.size === 0) {
    return state.baseSnapshot;
  }

  let itemPlants = state.baseSnapshot.itemPlants;
  if (state.overrides.length > 0) {
    itemPlants = itemPlants.map((entry) => {
      // Only the overrides whose window contains the planning date.
      //
      // A run is a snapshot as of one day, and a master-data parameter is one
      // value for the whole of it — so an override dated to start next month is
      // recorded, shown as pending, and does not touch this run. Applying it
      // anyway would be the same bug in the other direction: a plan built on a
      // number that is not true yet.
      const applicable = state.overrides.filter(
        (row) =>
          row.itemId === entry.itemId &&
          row.plantId === entry.plantId &&
          row.effectiveFromDay <= 0 &&
          (row.expiresOnDay === null || row.expiresOnDay >= 0),
      );
      if (applicable.length === 0) return entry;
      let next: ItemPlant = { ...entry };
      for (const override of applicable) next = { ...next, [override.field]: override.value };
      return next;
    });
  }

  let supply = state.baseSnapshot.supply;
  const arrivals: CapturedArrival[] = [];
  if (state.scheduleEdits.size > 0 || state.adherenceCaptures.size > 0) {
    supply = supply.map((element) => {
      if (!element.schedule || element.schedule.length === 0) return element;
      let touched = false;
      const schedule = element.schedule.map((line) => {
        const key = scheduleEditKey(element.itemId, element.plantId, element.id, line.line);
        const edit = state.scheduleEdits.get(key);
        const capture = state.adherenceCaptures.get(key);
        if (!edit && !capture) return line;
        touched = true;

        let next = line;
        if (edit) {
          const date = edit.date ?? line.expectedDate;
          next = {
            ...next,
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
        }

        if (capture) {
          // A receipt the feed already had is already in its stock. Only one
          // the planner is recording for the first time moves material.
          const alreadyReceived = line.status === 'RECEIVED' || line.grnDate !== null;

          // What the planner recorded after the call they were already making.
          // Only the fields they filled in — an absent date stays absent rather
          // than overwriting what the feed already knew.
          next = {
            ...next,
            confirmedDate: capture.confirmedDate ?? next.confirmedDate,
            // The vendor's date is the plan's date. A confirmation later than
            // the order asked for moves the receipt in the grid, and the
            // late-confirmation exception says what that costs; left on the
            // old date, the plan counts material on a day nobody promised it.
            expectedDate: capture.confirmedDate ?? next.expectedDate,
            status: capture.confirmedDate && next.status === 'PLANNED' ? 'CONFIRMED' : next.status,
            acknowledgedOn: capture.acknowledgedOn ?? next.acknowledgedOn,
            dispatchedOn: capture.dispatchedOn ?? next.dispatchedOn,
            grnDate: capture.grnDate ?? next.grnDate,
            grnQty: capture.grnQty ?? next.grnQty,
            qaReleasedOn: capture.qaReleasedOn ?? next.qaReleasedOn,
            reasonCode: capture.reasonCode || next.reasonCode,
            note: capture.note || next.note,
          };

          if (capture.grnDate && !alreadyReceived) {
            const received = capture.grnQty ?? next.qty;
            arrivals.push({
              itemId: element.itemId,
              plantId: element.plantId,
              batchId: `GRN-${element.id}-${line.line}`,
              qty: received,
              grnDate: capture.grnDate,
              qaReleasedOn: capture.qaReleasedOn,
            });
            // Closed only when it has all arrived. A short receipt leaves the
            // balance open on the line's own date, still owed and still netted.
            if (received >= next.qty) next = { ...next, status: 'RECEIVED' };
          }
        }

        return next;
      });
      if (!touched) return element;
      return { ...element, qty: schedule.reduce((sum, line) => sum + line.qty, 0), schedule };
    });
  }

  return {
    ...state.baseSnapshot,
    itemPlants,
    supply,
    stock: withCapturedArrivals(state.baseSnapshot.stock, arrivals, itemPlants, state.pack.planningDate),
    receiptHistory: withCapturedReceipts(state, supply),
  };
}

/** A goods receipt the planner recorded, on its way into stock. */
interface CapturedArrival {
  itemId: string;
  plantId: string;
  batchId: string;
  qty: number;
  grnDate: string;
  qaReleasedOn: string | null;
}

/**
 * Stock, with what the planner recorded as received folded in.
 *
 * A receipt is not available the day it arrives. It becomes stock on the day
 * quality releases it — the recorded release where there is one, the
 * material's quarantine period after the receipt where there is not — and
 * until then it is a dated quality lot, exactly as the feed's own quarantine
 * is. Released by the planning date, it is unrestricted stock.
 *
 * Rebuilt from the pristine base on every read, so recording the same receipt
 * twice lands it once.
 */
function withCapturedArrivals(
  base: PlanningSnapshot['stock'],
  arrivals: CapturedArrival[],
  itemPlants: ItemPlant[],
  planningDate: string,
): PlanningSnapshot['stock'] {
  if (arrivals.length === 0) return base;

  const planningDay = toEpochDay(planningDate);
  const byKey = new Map<string, PlanningSnapshot['stock'][number]>(
    base.map((position) => [`${position.itemId}@${position.plantId}`, position]),
  );
  const touched = new Set<string>();

  for (const arrival of arrivals) {
    const key = `${arrival.itemId}@${arrival.plantId}`;
    const quarantineDays =
      itemPlants.find((row) => row.itemId === arrival.itemId && row.plantId === arrival.plantId)?.qaQuarantineDays ?? 0;
    const releaseDate = arrival.qaReleasedOn ?? fromEpochDay(toEpochDay(arrival.grnDate) + quarantineDays);

    const current = byKey.get(key) ?? {
      itemId: arrival.itemId,
      plantId: arrival.plantId,
      unrestricted: 0,
      blocked: 0,
      qualityInspection: 0,
      inTransit: 0,
      batches: [],
      quarantine: [],
    };

    byKey.set(
      key,
      toEpochDay(releaseDate) <= planningDay
        ? {
            ...current,
            unrestricted: current.unrestricted + arrival.qty,
            batches: [...current.batches, { batchId: arrival.batchId, qty: arrival.qty, expiryDate: null }],
          }
        : {
            ...current,
            qualityInspection: current.qualityInspection + arrival.qty,
            quarantine: [
              ...current.quarantine,
              {
                batchId: arrival.batchId,
                qty: arrival.qty,
                receivedOn: arrival.grnDate,
                expectedReleaseDate: releaseDate,
              },
            ],
          },
    );
    touched.add(key);
  }

  const unseen = [...touched].filter((key) => !base.some((row) => `${row.itemId}@${row.plantId}` === key));
  return [
    ...base.map((position) => byKey.get(`${position.itemId}@${position.plantId}`) ?? position),
    ...unseen.map((key) => byKey.get(key) as PlanningSnapshot['stock'][number]),
  ];
}

/**
 * The measured history, with what the planner recorded folded in.
 *
 * A capture only becomes an observation once the receipt has both arrived and
 * cleared quality — the interval this dataset measures is purchase-order
 * release to *available*, and a goods receipt on its own cannot close it.
 *
 * Written in place, keyed on the delivery line: recording the same arrival
 * twice updates one row rather than adding a second, so the mean does not move
 * because somebody corrected a typo.
 */
function withCapturedReceipts(
  state: SessionState,
  supply: PlanningSnapshot['supply'],
): PlanningSnapshot['receiptHistory'] {
  if (state.adherenceCaptures.size === 0) return state.baseSnapshot.receiptHistory;

  const rows = [...state.baseSnapshot.receiptHistory];
  const indexByLine = new Map(rows.map((row, index) => [row.matchedLineId, index] as const));

  for (const element of supply) {
    for (const line of element.schedule ?? []) {
      const key = scheduleEditKey(element.itemId, element.plantId, element.id, line.line);
      if (!state.adherenceCaptures.has(key)) continue;
      if (line.grnDate === null || line.qaReleasedOn === null) continue;

      const orderedOn = line.releasedOn ?? element.releaseDate;
      const row = {
        itemId: element.itemId,
        plantId: element.plantId,
        vendorId: element.vendorId ?? '',
        poId: element.id,
        orderedOn,
        promisedOn: line.plannedDate,
        receivedOn: line.grnDate,
        qty: line.grnQty ?? line.qty,
        orderedQty: line.qty,
        actualLeadTimeDays: toEpochDay(line.grnDate) - toEpochDay(orderedOn),
        acknowledgedOn: line.acknowledgedOn,
        dispatchedOn: line.dispatchedOn,
        qaReleasedOn: line.qaReleasedOn,
        reasonCode: line.reasonCode,
        matchedLineId: key,
      };

      const existing = indexByLine.get(key);
      if (existing === undefined) {
        indexByLine.set(key, rows.length);
        rows.push(row);
      } else {
        rows[existing] = row;
      }
    }
  }

  return rows;
}

/**
 * Applies a decision: mutates the session, writes it to the log, drops the
 * plan cache.
 *
 * One path for every write, so what a restart replays is exactly what happened.
 * A writer that mutates the state without coming through here produces a
 * session the log cannot reconstruct — which is how an audit quietly stops
 * being one.
 */
export function record(
  mutation: SessionMutation,
  audit: { target: string; before: string | null; after: string | null; reasonCode: string | null; note: string },
): RecordedDecision {
  const state = session();
  const sequence = state.sequence + 1;

  const event: StoredEvent = {
    eventId: `DEC-${String(sequence).padStart(4, '0')}`,
    schemaVersion: EVENT_SCHEMA_VERSION,
    recordedAt: new Date().toISOString(),
    actor: 'Planner',
    ...audit,
  } as StoredEvent;
  event.mutation = mutation;

  // Written before it is applied. If the log refuses it, the session is
  // untouched and the planner is told — rather than shown a decision that
  // exists on this instance only and is gone at the next restart.
  appendEvent(event);
  state.sequence = sequence;
  applyMutation(state, mutation);

  const decision: RecordedDecision = {
    id: event.eventId,
    sequence: state.sequence,
    kind: kindOf(mutation),
    itemId: 'itemId' in mutation ? mutation.itemId : '',
    plantId: 'plantId' in mutation ? mutation.plantId : '',
    target: audit.target,
    before: audit.before,
    after: audit.after,
    reasonCode: audit.reasonCode,
    note: audit.note,
    actor: 'Planner',
  };
  state.decisions.push(decision);
  state.planCache.clear();
  return decision;
}

/** Records a decision that changes nothing but the record itself. */
export function recordDecision(input: Omit<RecordedDecision, 'id' | 'sequence'>): RecordedDecision {
  return record(
    { kind: 'SCHEDULE_PREPARED', itemId: input.itemId, plantId: input.plantId },
    {
      target: input.target,
      before: input.before,
      after: input.after,
      reasonCode: input.reasonCode,
      note: input.note,
    },
  );
}

export function applyOverride(
  itemId: string,
  plantId: string,
  field: OverridableField,
  value: number | null,
  before: number | null,
  reasonCode: string,
  note: string,
  window: { effectiveFromDay: number; expiresOnDay: number | null } = { effectiveFromDay: 0, expiresOnDay: null },
): RecordedDecision {
  const period =
    window.effectiveFromDay === 0 && window.expiresOnDay === null
      ? ''
      : ` (day ${window.effectiveFromDay}${window.expiresOnDay === null ? ' onward' : ` to ${window.expiresOnDay}`})`;

  return record(
    { kind: 'PARAMETER_OVERRIDE', itemId, plantId, field, value, ...window },
    {
      target: field,
      before: before === null ? null : String(before),
      after: (value === null ? 'cleared' : String(value)) + period,
      reasonCode,
      note,
    },
  );
}

/** Every override on one material, as they stand. */
export function overridesFor(
  itemId: string,
  plantId: string,
): Array<{
  field: OverridableField;
  value: number | null;
  effectiveFromDay: number;
  expiresOnDay: number | null;
  actor: string;
}> {
  return session()
    .overrides.filter((row) => row.itemId === itemId && row.plantId === plantId)
    .map(({ field, value, effectiveFromDay, expiresOnDay, actor }) => ({
      field,
      value,
      effectiveFromDay,
      expiresOnDay,
      actor,
    }));
}

export function applyScheduleEdit(
  itemId: string,
  plantId: string,
  edit: ScheduleEdit,
  before: string,
): RecordedDecision {
  // Namespaced by material. Keyed on the order alone, a POST to one material's
  // route could re-date another material's line and the decision log would
  // attribute it to the first.
  return record(
    { kind: 'SCHEDULE_EDIT', itemId, plantId, ...edit },
    {
      target: `${edit.orderId} line ${edit.line}`,
      before,
      after: `${edit.qty ?? '—'} on ${edit.date ?? '—'}`,
      reasonCode: edit.reasonCode,
      note: edit.note,
    },
  );
}

/**
 * What a planner recorded against one delivery line, after the call they were
 * already making.
 *
 * Folded on `orderId#line`, so recording the same goods receipt twice leaves
 * one record and the measured lead time moves once.
 */
export function captureAdherence(
  itemId: string,
  plantId: string,
  orderId: string,
  line: number,
  capture: AdherenceCapture,
  before: string,
): RecordedDecision {
  return record(
    { kind: 'ADHERENCE_CAPTURED', itemId, plantId, orderId, line, capture },
    {
      target: `${orderId} line ${line}`,
      before,
      after:
        [
          capture.acknowledgedOn ? `ack ${capture.acknowledgedOn}` : null,
          capture.dispatchedOn ? `dispatched ${capture.dispatchedOn}` : null,
          capture.grnDate ? `GRN ${capture.grnDate}` : null,
          capture.qaReleasedOn ? `released ${capture.qaReleasedOn}` : null,
        ]
          .filter(Boolean)
          .join(', ') || 'no dates',
      reasonCode: capture.reasonCode,
      note: capture.note,
    },
  );
}

/** Everything a planner has recorded, keyed `itemId@plantId#orderId#line`. */
export function adherenceCaptures(): Map<string, AdherenceCapture> {
  return session().adherenceCaptures;
}

export function dismissException(id: string, itemId: string, plantId: string, reasonCode: string, note: string): void {
  // A recurring dismissal is itself a finding: it usually means a norm is
  // wrong. So dismissals are retained rather than simply hiding a row.
  record(
    { kind: 'EXCEPTION_DISMISSED', id, itemId, plantId },
    { target: id, before: null, after: null, reasonCode, note },
  );
}

export function decisionLog(): RecordedDecision[] {
  return session().decisions;
}

export function dismissedExceptions(): Set<string> {
  return session().dismissed;
}

/** `itemId@plantId#orderId#line` — the material is part of the identity. */
export function scheduleEditKey(itemId: string, plantId: string, orderId: string, line: number): string {
  return `${itemId}@${plantId}#${orderId}#${line}`;
}

export function scheduleEdits(): Map<string, ScheduleEdit> {
  return session().scheduleEdits;
}

/** The builder lines a planner has pinned on one material. */
export function builderEditsFor(itemId: string, plantId: string): BuilderEdit[] {
  return session().builderEdits.get(`${itemId}@${plantId}`) ?? [];
}

/**
 * Pins one builder line, or clears it when `qty` is null.
 *
 * The plan cache is dropped through `recordDecision`, so the chart, the grid
 * and the position all move behind the edit rather than needing to be told.
 */
export function applyBuilderEdit(
  itemId: string,
  plantId: string,
  edit: BuilderEdit | { line: number; qty: null; reasonCode: string; note: string },
  before: string,
): RecordedDecision {
  return record(
    {
      kind: 'BUILDER_EDIT',
      itemId,
      plantId,
      line: edit.line,
      qty: edit.qty,
      reasonCode: edit.reasonCode,
      note: edit.note,
    },
    {
      target: `proposed line ${edit.line}`,
      before,
      after: edit.qty === null ? 'cleared' : String(edit.qty),
      reasonCode: edit.reasonCode,
      note: edit.note,
    },
  );
}

export function changesSinceLastRun(): PlanChange[] {
  return session().changesSinceLastRun;
}

/** The plan for a scenario, cached on the options and decisions that produced it. */
export function planFor(scenarioId: string, overrides: Partial<MrpOptions> = {}): MrpResult {
  const state = session();
  const options = planningOptions(scenarioId, overrides);
  // Keyed on the decision sequence rather than on collection sizes: editing the
  // same line twice leaves every size unchanged, and a key that cannot see that
  // serves a stale plan the moment anything writes without clearing the cache.
  const key = `${scenarioId}|${options.useActualLeadTimes}|${options.horizonDays}|${state.sequence}`;

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
/**
 * What a planner can change and see the consequence of.
 *
 * More than a master-data number, because §7.7's list is more than that: a
 * demand bucket and a lot-sizing policy change the plan as surely as a lead
 * time does, and a simulation that cannot express them can only rehearse one
 * kind of argument.
 */
export type SimulationChange =
  | { kind: 'PARAM'; field: OverridableField; value: number | null }
  | { kind: 'LOT_RULE'; value: NonNullable<ItemPlant['lotSizeRule']> }
  | { kind: 'DEMAND'; fromDay: number; toDay: number; value: number };

export function planWithChange(
  scenarioId: string,
  itemId: string,
  plantId: string,
  change: SimulationChange,
): { plan: MrpResult; snapshot: PlanningSnapshot; master: ItemPlant } | null {
  const base = snapshotFor();
  const index = base.itemPlants.findIndex((entry) => entry.itemId === itemId && entry.plantId === plantId);
  if (index === -1) return null;

  const current = base.itemPlants[index] as ItemPlant;
  let master = current;
  let snapshot: PlanningSnapshot = base;

  if (change.kind === 'PARAM') {
    master = { ...current, [change.field]: change.value };
  } else if (change.kind === 'LOT_RULE') {
    master = { ...current, lotSizeRule: change.value };
  }

  if (master !== current) {
    const itemPlants = [...base.itemPlants];
    itemPlants[index] = master;
    snapshot = { ...base, itemPlants };
  }

  if (change.kind === 'DEMAND') {
    // The requirement itself, moved. Scaled across the elements already in the
    // window rather than replaced by one synthetic line, so the demand keeps
    // the shape the plan gave it and only its size changes.
    const planningEpochDay = toEpochDay(session().pack.planningDate);
    const from = planningEpochDay + change.fromDay;
    const to = planningEpochDay + change.toDay;

    const inWindow = snapshot.demand.filter(
      (element) =>
        element.itemId === itemId &&
        element.plantId === plantId &&
        toEpochDay(element.requiredDate) >= from &&
        toEpochDay(element.requiredDate) <= to,
    );
    const currentQty = inWindow.reduce((sum, element) => sum + element.qty, 0);

    const demand =
      inWindow.length === 0
        ? [
            ...snapshot.demand,
            {
              id: `SIM-${itemId}-${plantId}-${change.fromDay}`,
              type: 'FORECAST' as const,
              itemId,
              plantId,
              qty: change.value,
              requiredDate: fromEpochDay(from),
              customerId: null,
              channel: null,
              marginPerUnit: 0,
              pricePerUnit: 0,
              priority: 3,
              parentSupplyElementId: null,
              sourceSystem: 'ENGINE' as const,
            },
          ]
        : snapshot.demand.map((element) =>
            inWindow.includes(element)
              ? {
                  ...element,
                  qty: currentQty > 0 ? (element.qty * change.value) / currentQty : change.value / inWindow.length,
                }
              : element,
          );

    snapshot = { ...snapshot, demand };
  }

  return { plan: runMrp(snapshot, planningOptions(scenarioId)), snapshot, master };
}

/** The master-data case, kept for the callers that only ever want it. */
export function planWithParamOverride(
  scenarioId: string,
  itemId: string,
  plantId: string,
  field: OverridableField,
  value: number | null,
): { plan: MrpResult; snapshot: PlanningSnapshot; master: ItemPlant } | null {
  return planWithChange(scenarioId, itemId, plantId, { kind: 'PARAM', field, value });
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
  state.builderEdits = new Map();
  state.adherenceCaptures = new Map();
  state.decisions = [];
  state.dismissed = new Set();
  state.planCache.clear();
  state.lastRunMs = 0;
  state.sequence = 0;
  // The one operation allowed to remove history. Reset is a demo affordance,
  // not a planner one.
  truncateEvents();
}
