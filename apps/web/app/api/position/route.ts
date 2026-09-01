/** Screen 1 — the planning position. */

import { NextResponse } from 'next/server';

import { planningPosition, type PositionFilters } from '@/lib/server/position';

export const dynamic = 'force-dynamic';

const TILES = new Set(['PLANNED', 'STOCKOUTS', 'BREACHES', 'UNREACHABLE', 'UNCONFIRMED', 'EXCESS']);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tile = url.searchParams.get('tile');

  const filters: PositionFilters = {
    plant: url.searchParams.get('plant') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    tile: tile && TILES.has(tile) ? (tile as PositionFilters['tile']) : undefined,
    limit: Number(url.searchParams.get('limit')) || undefined,
  };

  return NextResponse.json(planningPosition(url.searchParams.get('scenario') ?? 'baseline', filters));
}
