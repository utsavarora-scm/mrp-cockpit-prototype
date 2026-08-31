/** A generated purchase schedule, and the re-solve behind a quantity edit. */

import { NextResponse } from 'next/server';

import { supplySchedule } from '@/lib/server/supply-schedule';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params;
  const url = new URL(request.url);
  const qty = url.searchParams.get('qty');

  const schedule = supplySchedule(
    decodeURIComponent(orderId),
    qty ? Number(qty) : undefined,
    url.searchParams.get('scenario') ?? 'baseline',
  );

  if (!schedule) return NextResponse.json({ error: 'No such order.' }, { status: 404 });
  return NextResponse.json(schedule);
}
