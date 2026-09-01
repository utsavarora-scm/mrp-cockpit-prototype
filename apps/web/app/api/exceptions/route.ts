/**
 * Screen 6 — the exception queue.
 *
 * POST dismisses one, with a reason. Dismissals are retained rather than
 * hiding a row: a recurring dismissal usually means a norm is wrong, which is
 * itself a finding.
 */

import { NextResponse } from 'next/server';
import type { ActionGroup } from '@repo/planning-engine';

import { exceptionQueue } from '@/lib/server/exception-queue';
import { dismissException } from '@/lib/server/planning-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const group = url.searchParams.get('group');

  return NextResponse.json(
    exceptionQueue(url.searchParams.get('scenario') ?? 'baseline', {
      plant: url.searchParams.get('plant') ?? undefined,
      group: (group as ActionGroup | null) ?? undefined,
      includeDismissed: url.searchParams.get('dismissed') === 'true',
    }),
  );
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    id?: string;
    itemId?: string;
    plantId?: string;
    reasonCode?: string;
    note?: string;
    scenario?: string;
  };

  if (!body.id || !body.itemId || !body.plantId) {
    return NextResponse.json({ error: 'A dismissal needs an exception.' }, { status: 400 });
  }
  if (!body.reasonCode) {
    return NextResponse.json({ error: 'A dismissal needs a reason.' }, { status: 400 });
  }

  dismissException(body.id, body.itemId, body.plantId, body.reasonCode, body.note ?? '');
  return NextResponse.json(exceptionQueue(body.scenario ?? 'baseline'));
}
