/**
 * The plan endpoint.
 *
 * GET returns the run header. POST forces a fresh run — that is the re-plan
 * button, and the elapsed time it reports is measured here, not estimated.
 */

import { NextResponse } from 'next/server';

import { runContext } from '@/lib/server/context';
import { runHeader } from '@/lib/server/header';
import { rerun } from '@/lib/server/planning-session';

export const dynamic = 'force-dynamic';

function scenarioOf(request: Request): string {
  return new URL(request.url).searchParams.get('scenario') ?? 'baseline';
}

export async function GET(request: Request) {
  return NextResponse.json(runHeader(runContext(scenarioOf(request))));
}

export async function POST(request: Request) {
  const scenarioId = scenarioOf(request);
  rerun(scenarioId);
  return NextResponse.json(runHeader(runContext(scenarioId)));
}
