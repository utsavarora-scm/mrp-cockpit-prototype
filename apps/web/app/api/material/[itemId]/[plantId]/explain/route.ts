/**
 * Screen 5 — Explain.
 *
 * Opens from any number, so it accepts the number it was opened from: a grid
 * row key and the dates the cell covers. Without those the panel can only describe the
 * material's first recommendation, which is the right answer to one of the
 * fifteen rows and the wrong answer to the rest.
 */

import { NextResponse } from 'next/server';

import { explain } from '@/lib/server/material';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ itemId: string; plantId: string }> }) {
  const { itemId, plantId } = await context.params;
  const url = new URL(request.url);

  const payload = explain(
    url.searchParams.get('scenario') ?? 'baseline',
    decodeURIComponent(itemId),
    decodeURIComponent(plantId),
    {
      row: url.searchParams.get('row') ?? undefined,
      fromDate: url.searchParams.get('from') ?? undefined,
      toDate: url.searchParams.get('to') ?? undefined,
    },
  );

  if (!payload) return NextResponse.json({ error: 'Nothing to explain for this material.' }, { status: 404 });
  return NextResponse.json(payload);
}
