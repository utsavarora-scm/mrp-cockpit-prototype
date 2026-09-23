/**
 * Screen 7 — simulate, and commit an override.
 *
 * GET weighs a change without touching anything. POST records it: an override
 * is scoped, dated, attributed and fully audited, and it never silently changes
 * the system of record — write-back is a separate, governed action.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { ItemPlant } from '@repo/domain';

import { note, parseBody, quantity, reasonCode, savingRoute } from '@/lib/server/validation';
import type { SimulationChange } from '@/lib/server/planning-session';

import { SIMULATABLE_FIELDS, simulate } from '@/lib/server/simulate';
import { applyOverride, type OverridableField } from '@/lib/server/planning-session';
import { materialDetail } from '@/lib/server/material';
import { runContext } from '@/lib/server/context';
import { planKey } from '@repo/domain';

export const dynamic = 'force-dynamic';

/**
 * `Object.hasOwn`, not `in`.
 *
 * `SIMULATABLE_FIELDS` is an object literal, so `in` walks the prototype chain:
 * `field=toString`, `field=constructor` and `field=__proto__` all passed this
 * guard and reached the snapshot, where `{ ...master, [field]: value }` wrote
 * them onto the material master.
 */
function isSimulatable(field: string | null): field is OverridableField {
  return field !== null && Object.hasOwn(SIMULATABLE_FIELDS, field);
}

const LOT_RULES = new Set(['LFL', 'FOQ', 'POQ', 'MINMAX', 'EOQ']);

/**
 * What the planner asked to change.
 *
 * Three kinds, because §7.7's list is three kinds: a master-data number, the
 * lot-sizing policy, and the demand in a bucket. A simulation that can only
 * express the first can only rehearse one sort of argument.
 */
function parse(url: URL): SimulationChange | null {
  const field = url.searchParams.get('field');
  const raw = url.searchParams.get('value');

  if (field === 'lotSizeRule') {
    return raw && LOT_RULES.has(raw) ? { kind: 'LOT_RULE', value: raw as NonNullable<ItemPlant['lotSizeRule']> } : null;
  }

  if (field === 'demand') {
    const value = Number(raw);
    const fromDay = Number(url.searchParams.get('fromDay'));
    const toDay = Number(url.searchParams.get('toDay'));
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(fromDay) || !Number.isInteger(toDay)) return null;
    return { kind: 'DEMAND', fromDay, toDay: Math.max(fromDay, toDay), value };
  }

  if (!isSimulatable(field)) return null;
  if (raw === null || raw === '') return { kind: 'PARAM', field, value: null };
  const value = Number(raw);
  return Number.isFinite(value) ? { kind: 'PARAM', field, value } : null;
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
    parsed,
  );
  if (!result) return NextResponse.json({ error: 'No planning record for this material.' }, { status: 404 });
  return NextResponse.json(result);
}

export const POST = savingRoute(async function POST(
  request: Request,
  context: { params: Promise<{ itemId: string; plantId: string }> },
) {
  const { itemId: rawItem, plantId: rawPlant } = await context.params;
  const itemId = decodeURIComponent(rawItem);
  const plantId = decodeURIComponent(rawPlant);

  const parsed = await parseBody(
    request,
    z.object({
      field: z.string(),
      // Checked the way GET checks it. This used to take `body.value ?? null`
      // straight through, so a string, an infinity or a negative lead time was
      // accepted and stored while the same value was rejected on the read path.
      value: quantity.nullable().default(null),
      // A reason is mandatory, and it is one of the codes the domain publishes.
      // An override with a reason nobody can group by is a number nobody can
      // learn anything from later, which defeats the point of recording it.
      reasonCode,
      note,
      /** The day the override starts applying. Defaults to the planning date. */
      effectiveFromDay: z.number().int().min(0).default(0),
      /** The day it stops. Null is open-ended, and is said so on the screen. */
      expiresOnDay: z.number().int().min(0).nullable().default(null),
      scenario: z.string().default('baseline'),
    }),
  );
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  if (!isSimulatable(body.field)) {
    return NextResponse.json({ error: 'That is not an editable planning parameter.' }, { status: 400 });
  }
  if (body.expiresOnDay !== null && body.expiresOnDay < body.effectiveFromDay) {
    return NextResponse.json({ error: 'An override cannot expire before it starts.' }, { status: 400 });
  }

  const scenarioId = body.scenario;
  const facts = runContext(scenarioId).materials.get(planKey(itemId, plantId));
  if (!facts) return NextResponse.json({ error: 'No planning record for this material.' }, { status: 404 });

  const before = (facts.itemPlant as unknown as Record<string, unknown>)[body.field];
  applyOverride(
    itemId,
    plantId,
    body.field,
    body.value,
    typeof before === 'number' ? before : null,
    body.reasonCode,
    body.note,
    { effectiveFromDay: body.effectiveFromDay, expiresOnDay: body.expiresOnDay },
  );

  return NextResponse.json(materialDetail(scenarioId, itemId, plantId));
});
