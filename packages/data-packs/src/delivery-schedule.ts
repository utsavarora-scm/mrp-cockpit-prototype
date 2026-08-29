/**
 * Splitting an order into the delivery buckets it will actually arrive in.
 *
 * A planner is never asking "is there a PO for 1,000?" — they are asking when
 * the 1,000 lands and how much of it the supplier has actually committed to.
 * A single quantity and a single date cannot answer that, so every open order
 * carries a schedule.
 *
 * Derived, deliberately, from the order's own fields rather than from the
 * generator's random stream: this runs as a pass over supply that is already
 * built, and drawing from the shared `Rng` here would shift every subsequent
 * value in the dataset. The hash below is the whole reason the seeded snapshot
 * stays byte-identical to what it was before schedules existed.
 *
 * Two invariants hold, and the engine depends on both: line quantities sum to
 * the order quantity, and the last line falls on the order's due date. Netting
 * therefore sees exactly the order it saw before.
 */

import { type DeliveryLine, type DeliveryStatus, type SupplyElement, addDays, daysBetween } from '@repo/domain';

/** Deliveries closer than this are in transit rather than merely committed. */
const IN_TRANSIT_WINDOW_DAYS = 7;

/** Gap between the drops of a split order. */
const DROP_GAP_DAYS = 5;

/** Share of placed orders a supplier has come back and confirmed. */
const CONFIRMATION_RATE = 0.68;

/** FNV-1a, so a given order id always produces the same schedule. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** A stable 0–1 draw for one order and one purpose. */
function draw(seed: string, purpose: string): number {
  return hash(`${seed}:${purpose}`) / 0x100000000;
}

/**
 * How many drops this order arrives in.
 *
 * Small orders come in one; larger ones split, because that is how a supplier
 * with finite weekly capacity actually ships. Production and transfer orders
 * are single drops — the split is a supplier-scheduling behaviour.
 */
function dropCount(element: SupplyElement): number {
  if (element.type !== 'PO') return 1;
  const roll = draw(element.id, 'drops');
  if (roll < 0.42) return 1;
  if (roll < 0.85) return 2;
  return 3;
}

function statusFor(element: SupplyElement, expectedDate: string, planningDate: string, seed: string): DeliveryStatus {
  const daysOut = daysBetween(planningDate, expectedDate);
  if (daysOut < 0) {
    // Already past its date. Some of it genuinely landed; the rest is the
    // overdue inbound a planner needs at the top of the screen.
    return draw(seed, 'landed') < 0.55 ? 'RECEIVED' : 'DELAYED';
  }
  if (draw(seed, 'confirmed') >= CONFIRMATION_RATE) return 'PLANNED';
  return daysOut <= IN_TRANSIT_WINDOW_DAYS ? 'IN_TRANSIT' : 'CONFIRMED';
}

/**
 * The delivery schedule for one order.
 *
 * Quantities are split evenly with the remainder carried by the final line, so
 * they sum exactly. Earlier drops are walked backwards from the due date, which
 * keeps the last line on the date the engine already nets against.
 */
export function buildDeliverySchedule(element: SupplyElement, planningDate: string): DeliveryLine[] {
  const drops = dropCount(element);
  const lines: DeliveryLine[] = [];

  const per = Math.round(element.qty / drops);
  let allocated = 0;

  for (let index = 0; index < drops; index += 1) {
    const isLast = index === drops - 1;
    const qty = isLast ? element.qty - allocated : per;
    allocated += qty;

    // The last drop sits on the due date; earlier ones lead it.
    const plannedDate = addDays(element.dueDate, -(drops - 1 - index) * DROP_GAP_DAYS);
    const seed = `${element.id}#${index}`;
    const status = statusFor(element, plannedDate, planningDate, seed);

    // A delayed line is one the supplier has committed to a *later* date for —
    // that slip is the whole signal, so it has to show as a confirmed date that
    // no longer matches the plan.
    const slipDays = status === 'DELAYED' ? 3 + Math.floor(draw(seed, 'slip') * 18) : 0;
    const confirmedDate = status === 'PLANNED' ? null : slipDays > 0 ? addDays(plannedDate, slipDays) : plannedDate;

    lines.push({
      line: index + 1,
      qty,
      plannedDate,
      confirmedDate,
      expectedDate: confirmedDate ?? plannedDate,
      status,
    });
  }

  return lines;
}

/**
 * Attaches a schedule to every open order in place.
 *
 * Orders that already carry one are left alone — a planted scenario that has
 * spelled out its own delivery buckets means them.
 */
export function attachDeliverySchedules(supply: SupplyElement[], planningDate: string): void {
  for (const element of supply) {
    if (element.schedule && element.schedule.length > 0) continue;
    element.schedule = buildDeliverySchedule(element, planningDate);
  }
}
