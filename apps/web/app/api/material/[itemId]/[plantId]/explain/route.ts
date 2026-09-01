/** Screen 5 — explain. Opens from any number, never a separate destination. */

import { NextResponse } from 'next/server';

import { explain } from '@/lib/server/material';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ itemId: string; plantId: string }> }) {
  const { itemId, plantId } = await context.params;
  const scenarioId = new URL(request.url).searchParams.get('scenario') ?? 'baseline';
  const payload = explain(scenarioId, decodeURIComponent(itemId), decodeURIComponent(plantId));
  if (!payload) return NextResponse.json({ error: 'Nothing to explain for this material.' }, { status: 404 });
  return NextResponse.json(payload);
}
