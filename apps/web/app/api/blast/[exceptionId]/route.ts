import { NextResponse } from 'next/server';

import { blastRadius } from '@/lib/server/projections';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ exceptionId: string }> }) {
  const { exceptionId } = await context.params;
  const scenarioId = new URL(request.url).searchParams.get('scenario') ?? 'baseline';
  const radius = blastRadius(scenarioId, decodeURIComponent(exceptionId));
  if (!radius) return NextResponse.json({ error: 'This exception is no longer in the current plan.' }, { status: 404 });
  return NextResponse.json(radius);
}
