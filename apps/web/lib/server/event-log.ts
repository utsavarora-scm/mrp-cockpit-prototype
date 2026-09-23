/**
 * The decision log, on disk.
 *
 * Everything else in this prototype is regenerated from a seed, which is why
 * there is no database. Planner decisions are the one thing that cannot be:
 * they are the dataset GCPL does not have today, and §6.5 asks for them to be
 * recorded *permanently*. An in-memory map is not a permanent record — it is a
 * record that lasts until somebody restarts the server, which is the opposite
 * of the claim the screen makes.
 *
 * So decisions are appended to a JSONL file and replayed on boot. Append-only:
 * the history stays whole and the state is the fold of it. That is what makes
 * an audit an audit — a log you can rewrite is a log that proves nothing.
 *
 * **Deployment assumption, stated rather than implied.** This is durable for
 * the local, single-process deployment this prototype targets. On ephemeral or
 * serverless hosting the filesystem does not survive the instance, and this
 * would need a real store. Nothing here pretends otherwise.
 */

import { accessSync, appendFileSync, constants, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { OverridableField } from './planning-session';

/**
 * Bumped when the envelope changes shape.
 *
 * Replay skips anything it does not recognise rather than throwing: a log
 * written by an older build should cost a lost decision, never a demo.
 */
export const EVENT_SCHEMA_VERSION = 1;

/** What a decision actually changed. Replayed to rebuild the session. */
export type SessionMutation =
  | {
      kind: 'PARAMETER_OVERRIDE';
      itemId: string;
      plantId: string;
      field: OverridableField;
      value: number | null;
      /** The window the override applies over. Absent on events written before it existed. */
      effectiveFromDay?: number;
      expiresOnDay?: number | null;
    }
  | {
      kind: 'SCHEDULE_EDIT';
      itemId: string;
      plantId: string;
      orderId: string;
      line: number;
      qty: number | null;
      date: string | null;
      reasonCode: string;
      note: string;
    }
  | {
      kind: 'BUILDER_EDIT';
      itemId: string;
      plantId: string;
      line: number;
      qty: number | null;
      reasonCode: string;
      note: string;
    }
  | { kind: 'EXCEPTION_DISMISSED'; id: string; itemId: string; plantId: string }
  | {
      kind: 'ADHERENCE_CAPTURED';
      itemId: string;
      plantId: string;
      orderId: string;
      line: number;
      capture: AdherenceCapture;
    }
  | { kind: 'SCHEDULE_PREPARED'; itemId: string; plantId: string };

/**
 * What a planner recorded against one delivery line.
 *
 * Two kinds of date, and conflating them is the mistake worth naming. The
 * *lifecycle* events — acknowledged, dispatched, received, released — happen in
 * that order and are validated as a chain. The *promise* dates are not part of
 * it: `confirmedDate` is the delivery date the vendor promised, and a vendor can
 * promise a date earlier than the one they acknowledge on. Deviation is
 * measured from the promise to the actual availability, never along the chain.
 */
export interface AdherenceCapture {
  /** The delivery date the vendor promised. A promise, not an event. */
  confirmedDate: string | null;
  acknowledgedOn: string | null;
  dispatchedOn: string | null;
  grnDate: string | null;
  grnQty: number | null;
  qaReleasedOn: string | null;
  reasonCode: string;
  note: string;
}

/** One line of the log. */
export interface StoredEvent {
  eventId: string;
  schemaVersion: number;
  /** Wall clock — when the record was written, not the planning date. */
  recordedAt: string;
  actor: string;
  target: string;
  before: string | null;
  after: string | null;
  reasonCode: string | null;
  note: string;
  mutation: SessionMutation;
}

/**
 * Where the log lives.
 *
 * Overridable so a test never touches the real one. Read once per call rather
 * than cached, because a test sets it before the session is first built and
 * caching would freeze whichever value happened to be there at import time.
 */
export function logPath(): string {
  return resolve(process.env.MRP_EVENT_LOG ?? resolve(process.cwd(), '.data', 'decisions.jsonl'));
}

/**
 * A decision the log could not take.
 *
 * Raised rather than swallowed: a decision that reaches the screen and not the
 * file is on this instance only, and the next restart — or the next instance
 * behind the same address — silently loses it.
 */
export class DecisionNotSavedError extends Error {
  constructor(cause: unknown) {
    super(
      'That decision was not saved: this server cannot write its decision log. Nothing was changed. ' +
        'The demo needs a single, long-running server with a writable disk.',
      { cause },
    );
    this.name = 'DecisionNotSavedError';
  }
}

export function appendEvent(event: StoredEvent): void {
  const path = logPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(event)}\n`, 'utf8');
  } catch (cause) {
    throw new DecisionNotSavedError(cause);
  }
}

/**
 * Whether this server can keep what planners record.
 *
 * Checked by asking the filesystem, not by reading the deployment's name: a
 * read-only disk is the failure that matters, whatever it is hosted on. It
 * cannot see whether the disk outlives the instance — only a restart shows
 * that — so the answer is necessary, not sufficient.
 */
export function logStatus(): { path: string; writable: boolean; events: number; detail: string | null } {
  const path = logPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    accessSync(dirname(path), constants.W_OK);
    if (existsSync(path)) accessSync(path, constants.W_OK);
    return { path, writable: true, events: readEvents().length, detail: null };
  } catch (cause) {
    return {
      path,
      writable: false,
      events: 0,
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/** Every event, oldest first. A malformed line is skipped, never fatal. */
export function readEvents(): StoredEvent[] {
  const path = logPath();
  if (!existsSync(path)) return [];

  const events: StoredEvent[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      const parsed = JSON.parse(line) as StoredEvent;
      if (parsed.schemaVersion !== EVENT_SCHEMA_VERSION) continue;
      events.push(parsed);
    } catch {
      // A half-written last line after a crash. Losing it is correct; refusing
      // to start because of it is not.
      continue;
    }
  }
  return events;
}

/** Demo reset. The one operation that is allowed to remove history. */
export function truncateEvents(): void {
  const path = logPath();
  if (existsSync(path)) rmSync(path);
}
