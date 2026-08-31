/** The Norm Review table. */

import { NextResponse } from 'next/server';

import { normRows } from '@/lib/server/norm-rows';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const staleDays = url.searchParams.get('staleDays');

  return NextResponse.json(
    normRows(
      {
        search: url.searchParams.get('search') ?? undefined,
        plant: url.searchParams.get('plant') ?? undefined,
        vendor: url.searchParams.get('vendor') ?? undefined,
        abcClass: url.searchParams.get('abc') ?? undefined,
        direction: url.searchParams.get('direction') ?? undefined,
        staleDays: staleDays ? Number(staleDays) : undefined,
        limit: Number(url.searchParams.get('limit')) || undefined,
      },
      url.searchParams.get('scenario') ?? 'baseline',
    ),
  );
}
