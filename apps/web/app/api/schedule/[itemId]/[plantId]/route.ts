/**
 * Screen 3 — the supply timeline and the schedule builder.
 *
 * Three writes, and they are different things. `move` re-dates a line on an
 * order that already exists. `line` pins a quantity on a schedule the plan is
 * still proposing. `export` produces the payload that would be sent — and
 * refuses to, while the schedule carries a violation it cannot explain.
 *
 * Every one of them is validated against the constraint rather than against
 * presence. A body that names a field is not a body that means anything.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { scheduleBuilder } from '@/lib/server/schedule';
import { applyBuilderEdit, applyScheduleEdit, recordDecision } from '@/lib/server/planning-session';
import { isoDate, note, parseBody, quantity, reasonCode, savingRoute } from '@/lib/server/validation';
import { runContext } from '@/lib/server/context';
import { planKey } from '@repo/domain';

export const dynamic = 'force-dynamic';

const moveBody = z.object({
  action: z.literal('move'),
  orderId: z.string().min(1),
  line: z.number().int().nonnegative(),
  qty: quantity.positive('A delivery of nothing is a cancellation, not a move.'),
  date: isoDate,
  reasonCode,
  note,
  before: z.string().default(''),
  scenario: z.string().default('baseline'),
});

const lineBody = z.object({
  action: z.literal('line'),
  line: z.number().int().nonnegative(),
  /** Null clears the planner's edit and hands the line back to the engine. */
  qty: quantity.nullable(),
  reasonCode,
  note,
  scenario: z.string().default('baseline'),
});

const exportBody = z.object({
  action: z.literal('export'),
  /** Advisories are findings a planner may accept. Accepting them is recorded. */
  acknowledge: z.boolean().default(false),
  reasonCode: reasonCode.nullable().default(null),
  note,
  scenario: z.string().default('baseline'),
});

const body = z.discriminatedUnion('action', [moveBody, lineBody, exportBody]);

export async function GET(request: Request, context: { params: Promise<{ itemId: string; plantId: string }> }) {
  const { itemId, plantId } = await context.params;
  const url = new URL(request.url);
  const raw = Number(url.searchParams.get('windowDays'));
  const windowDays = Number.isFinite(raw) && raw > 0 ? raw : undefined;

  const view = scheduleBuilder(
    url.searchParams.get('scenario') ?? 'baseline',
    decodeURIComponent(itemId),
    decodeURIComponent(plantId),
    { windowDays },
  );
  if (!view) return NextResponse.json({ error: 'No planning record for this material.' }, { status: 404 });
  return NextResponse.json(view);
}

export const POST = savingRoute(async function POST(
  request: Request,
  context: { params: Promise<{ itemId: string; plantId: string }> },
) {
  const { itemId: rawItem, plantId: rawPlant } = await context.params;
  const itemId = decodeURIComponent(rawItem);
  const plantId = decodeURIComponent(rawPlant);

  const parsed = await parseBody(request, body);
  if (parsed.error) return parsed.error;
  const input = parsed.data;

  const current = scheduleBuilder(input.scenario, itemId, plantId);
  if (!current) return NextResponse.json({ error: 'No planning record for this material.' }, { status: 404 });

  if (input.action === 'move') {
    // The order and the line have to exist, and they have to belong to *this*
    // material. Without that check a POST to one material's URL re-dates
    // another's line and the log attributes it to the wrong one.
    const line = current.orders
      .find((order) => order.id === input.orderId)
      ?.lines.find((row) => row.line === input.line);
    if (!line) {
      return NextResponse.json(
        { error: `${input.orderId} line ${input.line} is not a delivery line on ${itemId} at ${plantId}.` },
        { status: 404 },
      );
    }

    applyScheduleEdit(
      itemId,
      plantId,
      {
        orderId: input.orderId,
        line: input.line,
        qty: input.qty,
        date: input.date,
        reasonCode: input.reasonCode,
        note: input.note,
      },
      input.before || `${line.qty} on ${line.expectedDate}`,
    );
    return NextResponse.json(scheduleBuilder(input.scenario, itemId, plantId));
  }

  if (input.action === 'line') {
    const existing = current.lines.find((row) => row.line === input.line);
    if (!existing) {
      return NextResponse.json(
        { error: `Line ${input.line} is not part of the schedule for ${itemId} at ${plantId}.` },
        { status: 404 },
      );
    }

    applyBuilderEdit(
      itemId,
      plantId,
      { line: input.line, qty: input.qty as number, reasonCode: input.reasonCode, note: input.note },
      `${existing.committedQty} in ${existing.week}`,
    );
    return NextResponse.json(scheduleBuilder(input.scenario, itemId, plantId));
  }

  // --- export --------------------------------------------------------------
  //
  // A schedule that cannot name the constraint behind every unit it moved is
  // not sendable, and no acknowledgement makes it so. An advisory is different:
  // the packaging hero's own worked answer ends 20,000 short of the buffer, and
  // a planner may send that with their eyes open and a reason recorded.
  if (current.blockingViolations.length > 0) {
    return NextResponse.json(
      {
        error: 'This schedule cannot be sent yet.',
        blockingViolations: current.blockingViolations,
      },
      { status: 409 },
    );
  }

  if (current.advisories.length > 0 && (!input.acknowledge || input.reasonCode === null)) {
    return NextResponse.json(
      {
        error: 'This schedule carries findings that have to be acknowledged before it is sent.',
        advisories: current.advisories,
      },
      { status: 409 },
    );
  }

  const run = runContext(input.scenario);
  const facts = run.materials.get(planKey(itemId, plantId));
  const plant = run.snapshot.plants.find((row) => row.id === plantId);

  recordDecision({
    kind: 'SCHEDULE_EDIT',
    itemId,
    plantId,
    target: 'delivery schedule prepared',
    before: null,
    after: `${current.lines.filter((line) => line.committedQty > 0).length} deliveries, ${current.totals.committed} ${current.baseUom}`,
    reasonCode: input.reasonCode,
    note: input.note,
    actor: 'Planner',
  });

  return NextResponse.json({
    itemId,
    plantId,
    description: current.description,
    baseUom: current.baseUom,
    vendorId: current.vendorId,
    vendorName: current.vendorName,
    shipFrom: facts?.vendorName ?? current.vendorName,
    shipTo: plant?.name ?? plantId,
    preparedBy: 'Planner',
    reasonCode: input.reasonCode,
    note: input.note,
    lines: current.lines
      .filter((line) => line.committedQty > 0)
      .map((line) => ({
        line: line.line,
        qty: line.committedQty,
        requestedDeliveryDate: line.date,
        dispatchBy: line.dispatchDate,
        changeFromPrevious:
          line.delta === 0
            ? null
            : `${line.delta > 0 ? '+' : ''}${line.delta} — ${line.constraintLabel ?? 'planner edit'}`,
      })),
    acknowledged: input.acknowledge ? current.advisories : [],
  });
});
