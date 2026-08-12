/**
 * Commit.
 *
 * Applies a resolution to the session and returns the payloads that *would* be
 * sent to each system. Nothing is transmitted: there is no HTTP client anywhere
 * in the adapter layer, and the preview panel says so on screen.
 */

import { proposeWritebacks } from '@repo/adapters';
import { NextResponse } from 'next/server';

import { commitChange, dataPack, planFor } from '@/lib/server/planning-session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json()) as { exceptionId?: string; resolutionId?: string; scenario?: string };
  const scenarioId = body.scenario ?? 'baseline';
  if (!body.exceptionId || !body.resolutionId) {
    return NextResponse.json({ error: 'Both an exception and a resolution are needed to commit.' }, { status: 400 });
  }

  const plan = planFor(scenarioId);
  const resolution = plan.resolutions.get(body.resolutionId);
  const exception = plan.exceptions.find((entry) => entry.id === body.exceptionId);
  if (!resolution || !exception) {
    return NextResponse.json({ error: 'That resolution is no longer available in the current plan.' }, { status: 404 });
  }

  const writebacks = proposeWritebacks(resolution.mutations, dataPack().planningDate);

  const change = commitChange({
    exceptionId: exception.id,
    resolutionId: resolution.id,
    label: resolution.label,
    mutations: resolution.mutations,
    appliedByAgent: false,
    estimatedImpact: exception.impactValue,
  });

  return NextResponse.json({
    change,
    writebacks,
    // Stated in the response as well as on screen, so it is impossible to
    // mistake this for an integration that fired.
    notice: 'Preview only — no system was contacted.',
  });
}
