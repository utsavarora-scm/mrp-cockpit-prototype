/**
 * Simulation.
 *
 * Clones the snapshot, applies the resolution, re-runs the engine and returns
 * the diff — including the exceptions the fix *creates*. Nothing is committed
 * and nothing is sent.
 */

import { NextResponse } from 'next/server';

import { simulateResolution } from '@/lib/server/projections';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json()) as { exceptionId?: string; resolutionId?: string; scenario?: string };
  if (!body.exceptionId || !body.resolutionId) {
    return NextResponse.json({ error: 'Both an exception and a resolution are needed to simulate.' }, { status: 400 });
  }

  const diff = simulateResolution(body.scenario ?? 'baseline', body.exceptionId, body.resolutionId);
  if (!diff)
    return NextResponse.json({ error: 'That resolution is no longer available in the current plan.' }, { status: 404 });
  return NextResponse.json(diff);
}
