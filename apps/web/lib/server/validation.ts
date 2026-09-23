/**
 * What the routes accept, said once.
 *
 * The routes used to check that a field was present and stop there, which let a
 * `NaN` quantity through into the snapshot and out into every total on every
 * screen, and let an arbitrary string be stored as a reason code the reason-code
 * list had never heard of. Presence is not validation.
 *
 * Two rules run through this file. A quantity is a finite number in the
 * material's own unit, never a string and never `NaN`. And a reason code is one
 * of the codes the domain publishes — the list is short, closed, and set with
 * the planners, so accepting anything else quietly destroys the one field Phase
 * 2 has to learn from.
 */

import { REASON_CODES, toEpochDay } from '@repo/domain';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { DecisionNotSavedError } from './event-log';

const REASON_CODE_VALUES = REASON_CODES.map((row) => row.code) as [string, ...string[]];

/** A closed list, not a free-text field. */
export const reasonCode = z.enum(REASON_CODE_VALUES);

/** An ISO date the calendar can actually parse. `toEpochDay` returns NaN otherwise. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'A date must be written as YYYY-MM-DD.')
  .refine((value) => Number.isFinite(toEpochDay(value)), 'That is not a date on the calendar.');

/** A quantity in the material's own unit. Finite, and never negative. */
export const quantity = z
  .number({ invalid_type_error: 'A quantity must be a number.' })
  .finite('A quantity must be a real number, not NaN or infinity.')
  .nonnegative('A quantity cannot be negative.');

export const note = z.string().max(500).default('');

/**
 * Parses a request body, or returns the 400 that says what was wrong.
 *
 * The message names the field, because "invalid request" tells a planner
 * nothing and tells whoever is debugging it less.
 */
/**
 * Wraps a route that records decisions, so a log that cannot be written comes
 * back as a sentence rather than an empty 500 the screen cannot read.
 */
export function savingRoute<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof DecisionNotSavedError) {
        return NextResponse.json({ error: error.message }, { status: 503 });
      }
      throw error;
    }
  };
}

export async function parseBody<T>(
  request: Request,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<{ data: T; error: null } | { data: null; error: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { data: null, error: NextResponse.json({ error: 'The request body was not JSON.' }, { status: 400 }) };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first?.path.join('.') ?? 'body';
    return {
      data: null,
      error: NextResponse.json({ error: `${field}: ${first?.message ?? 'is not valid.'}` }, { status: 400 }),
    };
  }

  return { data: parsed.data, error: null };
}
