/**
 * The materials table.
 *
 * One row per planned item-plant rather than one per exception: this is the
 * "how does the plan stand" question, which a planner asks before they ask
 * which problems are worth money.
 */

import { NextResponse } from 'next/server';

import { materialsTable, type MaterialFilters } from '@/lib/server/projections';

export const dynamic = 'force-dynamic';

const STATUSES = new Set(['ALL', 'AT_RISK', 'WATCH', 'EXCESS', 'HEALTHY']);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const scenarioId = url.searchParams.get('scenario') ?? 'baseline';

  const status = url.searchParams.get('status');
  const filters: MaterialFilters = {
    search: url.searchParams.get('search') ?? undefined,
    status: status && STATUSES.has(status) ? (status as MaterialFilters['status']) : undefined,
    plant: url.searchParams.get('plant') ?? undefined,
    limit: Number(url.searchParams.get('limit')) || undefined,
  };

  return NextResponse.json(materialsTable(scenarioId, filters));
}
