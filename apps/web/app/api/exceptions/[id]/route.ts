import { NextResponse } from 'next/server';

import { exceptionDetail } from '@/lib/server/projections';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const scenarioId = new URL(request.url).searchParams.get('scenario') ?? 'baseline';
  const detail = exceptionDetail(scenarioId, decodeURIComponent(id));
  if (!detail) return NextResponse.json({ error: 'This exception is no longer in the current plan.' }, { status: 404 });
  return NextResponse.json(detail);
}
