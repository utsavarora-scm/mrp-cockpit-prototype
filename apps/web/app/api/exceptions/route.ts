/**
 * The exception queue.
 *
 * Filtering and faceting happen server-side against the in-memory plan; only the
 * visible page of rows crosses the wire.
 */

import { NextResponse } from 'next/server';

import { queryExceptions, type ExceptionFilters } from '@/lib/server/projections';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const list = (name: string): string[] | undefined => {
    const raw = params
      .getAll(name)
      .flatMap((value) => value.split(','))
      .filter(Boolean);
    return raw.length > 0 ? raw : undefined;
  };

  const filters: ExceptionFilters = {
    plant: list('plant'),
    exceptionClass: list('exceptionClass'),
    itemType: list('itemType'),
    abcClass: list('abcClass'),
    plannerCode: list('plannerCode'),
    timeToImpact: list('timeToImpact'),
    autoResolvableOnly: params.get('autoResolvableOnly') === 'true',
    search: params.get('search') ?? undefined,
    limit: params.get('limit') ? Number(params.get('limit')) : undefined,
    offset: params.get('offset') ? Number(params.get('offset')) : undefined,
  };

  return NextResponse.json(queryExceptions(params.get('scenario') ?? 'baseline', filters));
}
