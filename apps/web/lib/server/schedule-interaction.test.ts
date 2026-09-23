/**
 * The paths that only exist once something has been written.
 *
 * Everything else in this suite reads a plan. These drive the route handlers —
 * plain functions over a `Request`, so no browser is involved — because the
 * behaviour worth protecting here is a sequence: edit a line, see what it
 * breaks, and be refused. A test that only ever reads cannot see any of it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HERO_PM } from '@repo/data-packs';

import { GET, POST } from '@/app/api/schedule/[itemId]/[plantId]/route';
import { decisionLog, resetDemo } from './planning-session';
import type { ScheduleBuilderView, SchedulePayloadView } from '../api-types';

const params = Promise.resolve({ itemId: HERO_PM.itemId, plantId: HERO_PM.plantId });
const url = `http://localhost/api/schedule/${HERO_PM.itemId}/${HERO_PM.plantId}`;

function post(body: unknown): Promise<Response> {
  return POST(
    new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    {
      params,
    },
  );
}

async function read(): Promise<ScheduleBuilderView> {
  const response = await GET(new Request(url), { params });
  return response.json();
}

beforeEach(() => resetDemo());
afterEach(() => resetDemo());

describe('editing a line, and being told what it breaks', () => {
  it('refuses a body that names a field without meaning anything by it', async () => {
    // Presence is not validation. Each of these used to be accepted and stored.
    //
    // `NaN` is deliberately absent: JSON cannot carry it — it serialises to
    // `null`, which on a proposed line legitimately means "hand this back to
    // the engine". The NaN that reached the snapshot came from `Number(qty)` on
    // an unvalidated text field in the browser, so the guard that matters is
    // the type check below, not a literal NaN nobody can send.
    for (const body of [
      { action: 'line', line: 10, qty: 'quite a lot', reasonCode: 'PLANNER_PULL_IN' },
      { action: 'line', line: 10, qty: -5_000, reasonCode: 'PLANNER_PULL_IN' },
      { action: 'line', line: 10, qty: 100_000, reasonCode: 'NOT_A_REAL_CODE' },
      { action: 'line', line: 10, qty: 100_000 },
      { action: 'move', orderId: 'PO-1', line: 10, qty: 1, date: 'the fourteenth', reasonCode: 'PLANNER_PULL_IN' },
      { action: 'move', orderId: '', line: 10, qty: 1, date: '2026-09-20', reasonCode: 'PLANNER_PULL_IN' },
      { action: 'move', orderId: '4700221', line: 10, qty: 0, date: '2026-09-20', reasonCode: 'PLANNER_PULL_IN' },
    ]) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('will not let one material re-date another material‘s line', async () => {
    const response = await post({
      action: 'move',
      orderId: '4700221',
      line: 10,
      qty: 1_150,
      date: '2026-09-20',
      reasonCode: 'PLANNER_PULL_IN',
    });

    // 4700221 belongs to the imported oil, not to the bottle. Keyed on the
    // order alone this used to succeed, and the decision log recorded it
    // against whichever material the URL happened to name.
    expect(response.status).toBe(404);
    expect(decisionLog()).toHaveLength(0);
  });

  it('keeps the quantity the planner typed, and names the ceiling it breaks', async () => {
    const before = await read();
    expect(before.blockingViolations).toEqual([]);

    const response = await post({
      action: 'line',
      line: 10,
      qty: 400_000,
      reasonCode: 'PLANNER_PULL_IN',
      note: 'Trying to front-load the campaign',
    });
    expect(response.status).toBe(200);

    const after = (await response.json()) as ScheduleBuilderView;
    // Left exactly as typed. A builder that silently corrects a planner has
    // taught them it argues with them.
    expect(after.lines.find((line) => line.line === 10)?.committedQty).toBe(400_000);
    expect(after.plannerLines).toEqual([{ line: 10, qty: 400_000 }]);

    const storage = after.blockingViolations.find((row) => row.line === 10 && row.constraint === 'STORAGE_CAP');
    expect(storage, 'the warehouse ceiling should be named').toBeDefined();
    expect(storage?.message).toMatch(/3,20,000|320,000/);
  });

  it('refuses to prepare a schedule while a violation stands, and prepares it once cleared', async () => {
    await post({ action: 'line', line: 10, qty: 400_000, reasonCode: 'PLANNER_PULL_IN' });

    const refused = await post({ action: 'export', acknowledge: true, reasonCode: 'PLANNER_PULL_IN' });
    expect(refused.status).toBe(409);
    expect((await refused.json()).blockingViolations.length).toBeGreaterThan(0);

    // Hand the line back and the schedule becomes sendable again.
    await post({ action: 'line', line: 10, qty: null, reasonCode: 'PLANNER_PULL_IN' });
    const cleared = await read();
    expect(cleared.blockingViolations).toEqual([]);
    expect(cleared.plannerLines).toEqual([]);
  });
});

describe('preparing the schedule', () => {
  it('will not send a residual exposure unacknowledged, and will with a reason', async () => {
    const view = await read();
    // The worked example's own answer: 20,000 short of the buffer for two
    // weeks. An advisory, not an error — but not something to send blind.
    expect(view.blockingViolations).toEqual([]);
    expect(view.advisories.some((row) => row.kind === 'RESIDUAL_EXPOSURE')).toBe(true);

    const blind = await post({ action: 'export' });
    expect(blind.status).toBe(409);
    expect((await blind.json()).advisories.length).toBeGreaterThan(0);

    const noReason = await post({ action: 'export', acknowledge: true });
    expect(noReason.status).toBe(409);

    const prepared = await post({
      action: 'export',
      acknowledge: true,
      reasonCode: 'PLANNER_PULL_IN',
      note: '0.8 days into a buffer sized for three',
    });
    expect(prepared.status).toBe(200);

    const payload = (await prepared.json()) as SchedulePayloadView;
    expect(payload.lines.map((line) => line.qty)).toEqual([240_000, 210_000, 240_000, 220_000, 180_000]);
    expect(payload.shipTo.length).toBeGreaterThan(0);
    expect(payload.acknowledged.length).toBeGreaterThan(0);

    // And the acknowledgement is on the record, which is the point of asking.
    expect(decisionLog().some((row) => row.target === 'delivery schedule prepared')).toBe(true);
  });
});

describe('the builder and the grid, on the same supply', () => {
  it('nets the open deliveries the grid counts, and closes where the grid would', async () => {
    const { HERO_RM } = await import('@repo/data-packs');
    const { planKey, toEpochDay } = await import('@repo/domain');
    const { runContext } = await import('./context');
    const { scheduleBuilder } = await import('./schedule');

    const view = scheduleBuilder('baseline', HERO_RM.itemId, HERO_RM.plantId)!;
    const context = runContext('baseline');
    const plan = context.materials.get(planKey(HERO_RM.itemId, HERO_RM.plantId))!.plan;
    const fromDay = toEpochDay(view.window.fromDate) - context.planningEpochDay;
    const toDay = toEpochDay(view.window.toDate) - context.planningEpochDay;

    let onOrder = 0;
    for (let day = Math.max(fromDay, 0); day <= toDay; day += 1) onOrder += plan.scheduledReceipts[day] as number;

    // RM-30114 has two 1,150 MT lines inside its window. The builder counts them.
    expect(onOrder).toBeGreaterThanOrEqual(2_300);
    const counted = view.lines.reduce((sum, line) => sum + line.existingReceipts, 0);
    expect(counted).toBeCloseTo(onOrder, 0);

    // With nothing proposed, the builder's closing balance is the grid's.
    const last = view.lines[view.lines.length - 1]!;
    const proposed = view.lines.reduce((sum, line) => sum + line.committedQty, 0);
    expect(last.balanceAfter - proposed).toBeCloseTo(plan.projectedBeforePlanned[toDay] as number, 0);
  });
});
