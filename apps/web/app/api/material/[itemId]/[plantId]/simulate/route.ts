/**
 * Screen 7 — simulate, and commit an override.
 *
 * GET weighs a change without touching anything. POST records it: an override
 * is scoped, dated, attributed and fully audited, and it never silently changes
 * the system of record — write-back is a separate, governed action.
 */

import { NextResponse } from 'next/server';

import { SIMULATABLE_FIELDS, simulate } from '@/lib/server/simulate';
import { applyOverride, type OverridableField } from '@/lib/server/planning-session';
import { materialDetail } from '@/lib/server/material';
import { runContext } from '@/lib/server/context';
import { planKey } from '@repo/domain';

export const dynamic = 'force-dynamic';

function parse(url: URL): { field: OverridableField; value: number | null } | null {
  const field = url.searchParams.get('field');
  if (!field || !(field in SIMULATABLE_FIELDS)) return null;
  const raw = url.searchParams.get('value');
  if (raw === null || raw === '') return { field: field as OverridableField, value: null };
  const value = Number(raw);
  return Number.isFinite(value) ? { field: field as OverridableField, value } : null;
}

export async function GET(request: Request, context: { params: Promise<{ itemId: string; plantId: string }> }) {
  const { itemId, plantId } = await context.params;
  const url = new URL(request.url);
  const parsed = parse(url);
  if (!parsed) {
    return NextResponse.json({ error: 'That is not a planning parameter this screen can simulate.' }, { status: 400 });
  }

  const result = simulate(
    url.searchParams.get('scenario') ?? 'baseline',
    decodeURIComponent(itemId),
    decodeURIComponent(plantId),
    parsed.field,
    parsed.value,
  );
  if (!result) return NextResponse.json({ error: 'No planning record for this material.' }, { status: 404 });
  return NextResponse.json(result);
}

export async function POST(request: Request, context: { params: Promise<{ itemId: string; plantId: string }> }) {
  const { itemId: rawItem, plantId: rawPlant } = await context.params;
  const itemId = decodeURIComponent(rawItem);
  const plantId = decodeURIComponent(rawPlant);

  const body = (await request.json()) as {
    field?: string;
    value?: number | null;
    reasonCode?: string;
    note?: string;
    scenario?: string;
  };

  if (!body.field || !(body.field in SIMULATABLE_FIELDS)) {
    return NextResponse.json({ error: 'That is not an editable planning parameter.' }, { status: 400 });
  }
  // A reason is mandatory. An override with no reason is a number nobody can
  // learn anything from later, which defeats the point of recording it.
  if (!body.reasonCode) {
    return NextResponse.json({ error: 'An override needs a reason.' }, { status: 400 });
  }

  const scenarioId = body.scenario ?? 'baseline';
  const facts = runContext(scenarioId).materials.get(planKey(itemId, plantId));
  if (!facts) return NextResponse.json({ error: 'No planning record for this material.' }, { status: 404 });

  const before = (facts.itemPlant as unknown as Record<string, unknown>)[body.field];
  applyOverride(
    itemId,
    plantId,
    body.field as OverridableField,
    body.value ?? null,
    typeof before === 'number' ? before : null,
    body.reasonCode,
    body.note ?? '',
  );

  return NextResponse.json(materialDetail(scenarioId, itemId, plantId));
}
