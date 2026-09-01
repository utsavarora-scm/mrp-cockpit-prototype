/**
 * The decision log.
 *
 * Every override, schedule edit and dismissal, with who, what, why and the
 * before and after. This is the dataset the norms work runs on, and it does not
 * exist anywhere today.
 */

import { NextResponse } from 'next/server';
import { reasonLabel } from '@repo/domain';

import type { DecisionView } from '@/lib/api-types';
import { decisionLog } from '@/lib/server/planning-session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rows: DecisionView[] = decisionLog()
    .slice()
    .reverse()
    .map((decision) => ({
      id: decision.id,
      kind: decision.kind,
      itemId: decision.itemId,
      plantId: decision.plantId,
      target: decision.target,
      before: decision.before,
      after: decision.after,
      reasonCode: decision.reasonCode,
      reasonLabel: reasonLabel(decision.reasonCode),
      note: decision.note,
      actor: decision.actor,
    }));

  return NextResponse.json({ decisions: rows });
}
