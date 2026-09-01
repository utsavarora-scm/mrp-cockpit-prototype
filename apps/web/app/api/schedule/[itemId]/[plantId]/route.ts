/**
 * Screen 3 — the supply timeline and the schedule builder.
 *
 * POST edits one delivery line. The edit is recorded with its reason, the plan
 * cache drops, and the next read re-plans — which is why every other screen
 * moves behind the planner.
 */

import { NextResponse } from 'next/server';

import { scheduleBuilder } from '@/lib/server/schedule';
import { applyScheduleEdit } from '@/lib/server/planning-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ itemId: string; plantId: string }> }) {
  const { itemId, plantId } = await context.params;
  const url = new URL(request.url);
  const windowDays = Number(url.searchParams.get('windowDays')) || undefined;

  const view = scheduleBuilder(
    url.searchParams.get('scenario') ?? 'baseline',
    decodeURIComponent(itemId),
    decodeURIComponent(plantId),
    { windowDays },
  );
  if (!view) return NextResponse.json({ error: 'No planning record for this material.' }, { status: 404 });
  return NextResponse.json(view);
}

export async function POST(request: Request, context: { params: Promise<{ itemId: string; plantId: string }> }) {
  const { itemId: rawItem, plantId: rawPlant } = await context.params;
  const itemId = decodeURIComponent(rawItem);
  const plantId = decodeURIComponent(rawPlant);

  const body = (await request.json()) as {
    orderId?: string;
    line?: number;
    qty?: number | null;
    date?: string | null;
    reasonCode?: string;
    note?: string;
    before?: string;
    scenario?: string;
  };

  if (!body.orderId || typeof body.line !== 'number') {
    return NextResponse.json({ error: 'An edit needs an order and a line.' }, { status: 400 });
  }
  if (!body.reasonCode) {
    return NextResponse.json({ error: 'A schedule change needs a reason.' }, { status: 400 });
  }

  applyScheduleEdit(
    itemId,
    plantId,
    {
      orderId: body.orderId,
      line: body.line,
      qty: body.qty ?? null,
      date: body.date ?? null,
      reasonCode: body.reasonCode,
      note: body.note ?? '',
    },
    body.before ?? '',
  );

  return NextResponse.json(scheduleBuilder(body.scenario ?? 'baseline', itemId, plantId));
}
