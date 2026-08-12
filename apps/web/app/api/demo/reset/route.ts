/**
 * Demo reset.
 *
 * Drops every committed change and the plan cache, keeping the generated base
 * snapshot. No regeneration, no reload — which is what makes it instant enough
 * to use mid-conversation.
 */

import { NextResponse } from 'next/server';

import { resetDemo } from '@/lib/server/planning-session';
import { cockpitSummary } from '@/lib/server/projections';

export const dynamic = 'force-dynamic';

export async function POST() {
  const startedAt = performance.now();
  resetDemo();
  const summary = cockpitSummary('baseline');
  return NextResponse.json({ ...summary, resetMs: Math.round(performance.now() - startedAt) });
}
