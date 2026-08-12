import { NextResponse } from 'next/server';

import { itemDetail } from '@/lib/server/projections';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ itemId: string; plantId: string }> }) {
  const { itemId, plantId } = await context.params;
  const scenarioId = new URL(request.url).searchParams.get('scenario') ?? 'baseline';
  const detail = itemDetail(scenarioId, decodeURIComponent(itemId), decodeURIComponent(plantId));
  if (!detail)
    return NextResponse.json({ error: 'No planning record exists for this item at this plant.' }, { status: 404 });
  return NextResponse.json(detail);
}
