/**
 * Editing a planning parameter from the material screen.
 *
 * This is the "change that number and re-run it" answer. The override is
 * recorded with its reason and its before/after, the plan cache drops, and the
 * next read re-plans — which is why every screen moves behind you.
 */

import { NextResponse } from 'next/server';

import { recordOverride, snapshotFor, type OverridableField } from '@/lib/server/planning-session';
import { itemDetail, previewOverride } from '@/lib/server/projections';

export const dynamic = 'force-dynamic';

/** Only planning parameters may be edited this way — never derived values. */
const EDITABLE_FIELDS = new Set([
  'leadTimeDays',
  'safetyStock',
  'fixedLotSize',
  'minLotSize',
  'maxLotSize',
  'roundingValue',
  'periodsOfSupplyDays',
  'reorderPoint',
  'safetyTimeDays',
  'grProcessingTimeDays',
  'scrapPct',
  'serviceLevelTarget',
]);

export async function POST(request: Request, context: { params: Promise<{ itemId: string; plantId: string }> }) {
  const { itemId: rawItem, plantId: rawPlant } = await context.params;
  const itemId = decodeURIComponent(rawItem);
  const plantId = decodeURIComponent(rawPlant);

  const body = (await request.json()) as {
    field?: string;
    value?: number | null;
    scenario?: string;
    /** Weigh the change without committing it. */
    preview?: boolean;
    /** Why the planner is overriding the system value. Recorded on the change. */
    reason?: string;
  };
  const scenarioId = body.scenario ?? 'baseline';

  if (!body.field || !EDITABLE_FIELDS.has(body.field)) {
    return NextResponse.json(
      { error: `"${body.field ?? 'that field'}" is not an editable planning parameter.` },
      { status: 400 },
    );
  }
  if (body.value !== null && (typeof body.value !== 'number' || !Number.isFinite(body.value))) {
    return NextResponse.json({ error: 'That value is not a number the plan can use.' }, { status: 400 });
  }

  const field = body.field as OverridableField;

  // Weighing it is a real run on a cloned snapshot — nothing is committed, and
  // the planner sees the same arithmetic they would get by applying it.
  if (body.preview) {
    const preview = previewOverride(scenarioId, itemId, plantId, field, body.value ?? null);
    if (!preview) return NextResponse.json({ error: 'That item has no planning master to override.' }, { status: 404 });
    return NextResponse.json(preview);
  }

  const reason = body.reason?.trim();
  if (!reason) {
    return NextResponse.json({ error: 'An override needs a reason before it can be applied.' }, { status: 400 });
  }

  const master = snapshotFor().itemPlants.find((entry) => entry.itemId === itemId && entry.plantId === plantId);
  if (!master) return NextResponse.json({ error: 'That item has no planning master to override.' }, { status: 404 });

  recordOverride({
    itemId,
    plantId,
    field,
    before: (master[field] as number | null) ?? null,
    after: body.value ?? null,
    reason,
    actor: 'planner',
  });

  const detail = itemDetail(scenarioId, itemId, plantId);
  if (!detail)
    return NextResponse.json({ error: 'The item could not be re-planned after that edit.' }, { status: 404 });
  return NextResponse.json(detail);
}
