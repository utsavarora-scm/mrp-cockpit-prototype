/**
 * Back to the exact starting state.
 *
 * The generated base is untouched by design, so this drops the overlay rather
 * than regenerating anything.
 */

import { NextResponse } from 'next/server';

import { runContext } from '@/lib/server/context';
import { runHeader } from '@/lib/server/header';
import { resetDemo } from '@/lib/server/planning-session';

export const dynamic = 'force-dynamic';

export async function POST() {
  const started = performance.now();
  resetDemo();
  const header = runHeader(runContext('baseline'));
  return NextResponse.json({ ...header, resetMs: Math.round(performance.now() - started) });
}
