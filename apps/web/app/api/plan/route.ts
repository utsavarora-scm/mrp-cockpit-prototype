/**
 * The plan endpoint.
 *
 * GET returns the current summary. POST forces a fresh run — that is the Run MRP
 * button, and the elapsed time it reports is measured here, not estimated.
 */

import { NextResponse } from 'next/server';

import { cockpitSummary } from '@/lib/server/projections';
import { rerun } from '@/lib/server/planning-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const scenarioId = new URL(request.url).searchParams.get('scenario') ?? 'baseline';
  return NextResponse.json(cockpitSummary(scenarioId));
}

export async function POST(request: Request) {
  const scenarioId = new URL(request.url).searchParams.get('scenario') ?? 'baseline';
  rerun(scenarioId);
  return NextResponse.json(cockpitSummary(scenarioId));
}
