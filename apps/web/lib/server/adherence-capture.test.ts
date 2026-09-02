/**
 * Capture, restart, replay.
 *
 * The claim on the screen is that a schedule line records what happened to it
 * *permanently*. An in-memory map keeps that promise until somebody restarts
 * the server, so the test that matters is not "does the capture appear" but
 * "does it survive the process it was recorded in".
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HERO_RM } from '@repo/data-packs';

import { POST as capture, GET as readAdherence } from '@/app/api/adherence/route';
import { adherenceCaptures, decisionLog, resetDemo } from './planning-session';
import { readEvents } from './event-log';
import type { AdherenceView } from '../api-types';

const SESSION_KEY = Symbol.for('gcpl-scheduling.session');

/** What a restart does: drop the process's memory and let the log rebuild it. */
function coldBoot(): void {
  delete (globalThis as Record<symbol, unknown>)[SESSION_KEY];
}

function post(body: unknown): Promise<Response> {
  return capture(
    new Request('http://localhost/api/adherence', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function view(): Promise<AdherenceView> {
  const response = await readAdherence(
    new Request(`http://localhost/api/adherence?item=${HERO_RM.itemId}&plant=${HERO_RM.plantId}`),
  );
  return response.json();
}

/** The full record: acknowledgement, dispatch, receipt and release. */
const fullCapture = {
  itemId: HERO_RM.itemId,
  plantId: HERO_RM.plantId,
  orderId: HERO_RM.openPoId,
  line: 10,
  confirmedDate: '2026-09-18',
  acknowledgedOn: '2026-06-27',
  dispatchedOn: '2026-08-03',
  grnDate: '2026-09-22',
  grnQty: 1_120,
  qaReleasedOn: '2026-09-26',
  reasonCode: 'VESSEL_ROLL',
  note: 'Vessel roll at transhipment port',
};

beforeEach(() => resetDemo());
afterEach(() => resetDemo());

describe('recording what happened to a line', () => {
  it('refuses a chain that runs backwards', async () => {
    // A receipt is not released before it arrives, and it does not arrive
    // before it is dispatched.
    for (const broken of [
      { ...fullCapture, qaReleasedOn: '2026-09-01' },
      { ...fullCapture, dispatchedOn: '2026-06-01' },
      { ...fullCapture, grnDate: null, grnQty: 1_120 },
      { ...fullCapture, reasonCode: 'NOT_A_CODE' },
    ]) {
      const response = await post(broken);
      expect(response.status, JSON.stringify(broken.reasonCode)).toBe(400);
    }
  });

  it('will not record against a line that is not on this material', async () => {
    const response = await post({ ...fullCapture, line: 99 });
    expect(response.status).toBe(404);
  });

  it('survives a restart, because the record is the log rather than the memory', async () => {
    expect((await post(fullCapture)).status).toBe(200);

    const before = await view();
    const recordedLine = before.lines.find((row) => row.poId === HERO_RM.openPoId && row.line === 10);
    expect(recordedLine?.grnDate).toBe('2026-09-22');
    expect(recordedLine?.qaReleasedOn).toBe('2026-09-26');
    expect(recordedLine?.receivedQty).toBe(1_120);

    // Drop everything the process was holding. Only the file survives.
    coldBoot();

    const after = await view();
    const replayed = after.lines.find((row) => row.poId === HERO_RM.openPoId && row.line === 10);
    expect(replayed?.grnDate).toBe('2026-09-22');
    expect(replayed?.qaReleasedOn).toBe('2026-09-26');
    // And the four-interval split is computable off it, which is the point of
    // recording all four boundaries rather than only the receipt.
    expect(replayed?.intervals.length).toBeGreaterThan(0);
    expect(adherenceCaptures().size).toBe(1);
    expect(decisionLog().some((row) => row.kind === 'ADHERENCE_CAPTURED')).toBe(true);
  });

  it('moves the measured lead time, and moves it once however often it is recorded', async () => {
    const measured = async (): Promise<{ count: number; mean: number }> => {
      const row = (await view()).byMaterial.find((entry) => entry.itemId === HERO_RM.itemId);
      return { count: row?.distribution.count ?? 0, mean: row?.distribution.meanDays ?? 0 };
    };

    const before = await measured();
    expect(before.count).toBe(HERO_RM.observedTotalDays.length);

    await post(fullCapture);
    const once = await measured();
    expect(once.count).toBe(before.count + 1);
    expect(once.mean).not.toBe(before.mean);

    // The same arrival, recorded again — a planner correcting a typo, or two
    // people entering the same call. One receipt, not two.
    await post(fullCapture);
    await post({ ...fullCapture, note: 'corrected' });
    const twice = await measured();

    expect(twice.count).toBe(once.count);
    expect(twice.mean).toBe(once.mean);
    expect(adherenceCaptures().size).toBe(1);

    // Three decisions, one observation. The history is whole; the state is the
    // fold of it.
    expect(readEvents().filter((event) => event.mutation.kind === 'ADHERENCE_CAPTURED')).toHaveLength(3);
  });

  it('is gone after a demo reset, log and all', async () => {
    await post(fullCapture);
    expect(readEvents().length).toBeGreaterThan(0);

    resetDemo();
    coldBoot();

    expect(readEvents()).toEqual([]);
    expect(adherenceCaptures().size).toBe(0);
    expect(decisionLog()).toEqual([]);
  });
});
