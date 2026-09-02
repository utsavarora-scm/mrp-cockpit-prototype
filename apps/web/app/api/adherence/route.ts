/**
 * Screen 4 — adherence.
 *
 * `GET` is what happened. `POST` is how it gets recorded — the quiet half of
 * the feature, and the one the whole of Phase 2 depends on. Vendor committed
 * date and dispatch date do not exist in a system today; the planner records
 * them after the call they were already making, and that is enough to build the
 * dataset.
 */

import { NextResponse } from 'next/server';
import { toEpochDay } from '@repo/domain';
import { z } from 'zod';

import { adherenceView } from '@/lib/server/adherence-view';
import { captureAdherence } from '@/lib/server/planning-session';
import { runContext } from '@/lib/server/context';
import { isoDate, note, parseBody, quantity, reasonCode } from '@/lib/server/validation';
import { planKey } from '@repo/domain';

export const dynamic = 'force-dynamic';

/**
 * The two kinds of date, kept apart.
 *
 * `confirmedDate` is the delivery date the vendor *promised*. The other four
 * are lifecycle events, and only those form a chain — a vendor can perfectly
 * well promise a date earlier than the one they acknowledge on, so folding the
 * promise into the ordering test would reject honest records.
 */
const captureBody = z
  .object({
    itemId: z.string().min(1),
    plantId: z.string().min(1),
    orderId: z.string().min(1),
    line: z.number().int().nonnegative(),
    confirmedDate: isoDate.nullable().default(null),
    acknowledgedOn: isoDate.nullable().default(null),
    dispatchedOn: isoDate.nullable().default(null),
    grnDate: isoDate.nullable().default(null),
    grnQty: quantity.nullable().default(null),
    qaReleasedOn: isoDate.nullable().default(null),
    reasonCode,
    note,
    scenario: z.string().default('baseline'),
  })
  .superRefine((value, ctx) => {
    const chain: Array<[string, string | null]> = [
      ['acknowledgedOn', value.acknowledgedOn],
      ['dispatchedOn', value.dispatchedOn],
      ['grnDate', value.grnDate],
      ['qaReleasedOn', value.qaReleasedOn],
    ];

    let previousLabel = '';
    let previous = Number.NEGATIVE_INFINITY;
    for (const [label, date] of chain) {
      if (date === null) continue;
      const day = toEpochDay(date);
      if (day < previous) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [label],
          message: `cannot fall before ${previousLabel}. A receipt is not released before it arrives.`,
        });
      }
      previous = day;
      previousLabel = label;
    }

    if (value.grnQty !== null && value.grnDate === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['grnDate'],
        message: 'is needed: a received quantity without a receipt date cannot be measured against anything.',
      });
    }
  });

export async function GET(request: Request) {
  const url = new URL(request.url);
  return NextResponse.json(
    adherenceView(url.searchParams.get('scenario') ?? 'baseline', {
      plant: url.searchParams.get('plant') ?? undefined,
      itemId: url.searchParams.get('item') ?? undefined,
    }),
  );
}

export async function POST(request: Request) {
  const parsed = await parseBody(request, captureBody);
  if (parsed.error) return parsed.error;
  const input = parsed.data;

  // The line has to exist, and it has to belong to the material named.
  const context = runContext(input.scenario);
  const facts = context.materials.get(planKey(input.itemId, input.plantId));
  const order = facts?.orders.find((row) => row.id === input.orderId);
  const line = order?.schedule?.find((row) => row.line === input.line);

  if (!line) {
    return NextResponse.json(
      { error: `${input.orderId} line ${input.line} is not a delivery line on ${input.itemId} at ${input.plantId}.` },
      { status: 404 },
    );
  }

  captureAdherence(
    input.itemId,
    input.plantId,
    input.orderId,
    input.line,
    {
      confirmedDate: input.confirmedDate,
      acknowledgedOn: input.acknowledgedOn,
      dispatchedOn: input.dispatchedOn,
      grnDate: input.grnDate,
      grnQty: input.grnQty,
      qaReleasedOn: input.qaReleasedOn,
      reasonCode: input.reasonCode,
      note: input.note,
    },
    `requested ${line.plannedDate}, ${line.grnDate ? `received ${line.grnDate}` : 'no receipt posted'}`,
  );

  return NextResponse.json(adherenceView(input.scenario, { plant: input.plantId, itemId: input.itemId }));
}
