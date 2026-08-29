/**
 * Editing one delivery bucket of an open order.
 *
 * The change is committed to the session like any other, so the plan re-runs
 * behind it and the cockpit reorders — moving a drop out by a fortnight is a
 * planning event, not a cosmetic one, and the prototype has to show that.
 */

import { NextResponse } from 'next/server';
import type { SnapshotMutation } from '@repo/domain';

import { commitChange } from '@/lib/server/planning-session';
import { itemDetail } from '@/lib/server/projections';

export const dynamic = 'force-dynamic';

interface Body {
  supplyElementId?: string;
  line?: number;
  newDate?: string;
  newQty?: number | null;
  confirmed?: boolean;
  scenario?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request, context: { params: Promise<{ itemId: string; plantId: string }> }) {
  const { itemId: rawItem, plantId: rawPlant } = await context.params;
  const itemId = decodeURIComponent(rawItem);
  const plantId = decodeURIComponent(rawPlant);

  const body = (await request.json()) as Body;
  const scenarioId = body.scenario ?? 'baseline';

  if (!body.supplyElementId) {
    return NextResponse.json({ error: 'No order was named for that edit.' }, { status: 400 });
  }
  if (typeof body.line !== 'number' || body.line < 1) {
    return NextResponse.json({ error: 'No delivery line was named for that edit.' }, { status: 400 });
  }
  if (!body.newDate || !ISO_DATE.test(body.newDate)) {
    return NextResponse.json({ error: 'That delivery date is not a date the plan can use.' }, { status: 400 });
  }
  if (body.newQty !== undefined && body.newQty !== null && (!Number.isFinite(body.newQty) || body.newQty <= 0)) {
    return NextResponse.json({ error: 'A delivery has to carry a positive quantity.' }, { status: 400 });
  }

  const mutation: SnapshotMutation = {
    kind: 'RESCHEDULE_DELIVERY_LINE',
    supplyElementId: body.supplyElementId,
    line: body.line,
    newDate: body.newDate,
    ...(body.newQty ? { newQty: body.newQty } : {}),
    ...(body.confirmed ? { confirmed: true } : {}),
  };

  commitChange({
    exceptionId: '—',
    resolutionId: '—',
    label: `${body.supplyElementId} delivery ${body.line} moved to ${body.newDate}`,
    mutations: [mutation],
    appliedByAgent: false,
    estimatedImpact: 0,
  });

  const detail = itemDetail(scenarioId, itemId, plantId);
  if (!detail) {
    return NextResponse.json({ error: 'The item could not be re-planned after that edit.' }, { status: 404 });
  }
  return NextResponse.json(detail);
}
