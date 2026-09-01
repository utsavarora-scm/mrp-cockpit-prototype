/** Screen 8 — the purchase-order control tower. */

import { NextResponse } from 'next/server';

import { controlTower } from '@/lib/server/control-tower';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  return NextResponse.json(
    controlTower(url.searchParams.get('scenario') ?? 'baseline', { plant: url.searchParams.get('plant') ?? undefined }),
  );
}
