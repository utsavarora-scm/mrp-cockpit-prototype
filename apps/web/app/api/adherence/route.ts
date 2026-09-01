/** Screen 4 — adherence. */

import { NextResponse } from 'next/server';

import { adherenceView } from '@/lib/server/adherence-view';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  return NextResponse.json(
    adherenceView(url.searchParams.get('scenario') ?? 'baseline', {
      plant: url.searchParams.get('plant') ?? undefined,
      itemId: url.searchParams.get('item') ?? undefined,
    }),
  );
}
