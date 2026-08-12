/**
 * Date arithmetic for the planner.
 *
 * Everything is computed in whole UTC days. Dates are ISO `YYYY-MM-DD` strings
 * at the boundary and integer day offsets internally, so nothing here can drift
 * with a timezone or a daylight-saving change. There is no clock read anywhere
 * in this file — `planningDate` is always supplied by the caller.
 */

import type { Calendar } from './master-data';

const MS_PER_DAY = 86_400_000;

/** ISO `YYYY-MM-DD` → whole days since the Unix epoch. */
export function toEpochDay(iso: string): number {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** Whole days since the Unix epoch → ISO `YYYY-MM-DD`. */
export function fromEpochDay(epochDay: number): string {
  return new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromEpochDay(toEpochDay(iso) + days);
}

/** Calendar days between two ISO dates — negative when `to` precedes `from`. */
export function daysBetween(from: string, to: string): number {
  return toEpochDay(to) - toEpochDay(from);
}

/** Day offset of an ISO date relative to the planning date. May be negative. */
export function toDayOffset(iso: string, planningDate: string): number {
  return toEpochDay(iso) - toEpochDay(planningDate);
}

export function fromDayOffset(offset: number, planningDate: string): string {
  return fromEpochDay(toEpochDay(planningDate) + offset);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(epochDay: number): number {
  // 1970-01-01 was a Thursday (4).
  return (((epochDay + 4) % 7) + 7) % 7;
}

export function isWorkingDay(iso: string, calendar: Calendar): boolean {
  if (calendar.holidays.includes(iso)) return false;
  return calendar.workingDays.includes(dayOfWeek(toEpochDay(iso)));
}

/**
 * Walk backwards over the working calendar. Used for lead-time offsetting —
 * never subtract days naively, or a 21-day lead time lands mid-holiday and the
 * whole release schedule is quietly wrong.
 *
 * Guarded at 10 years of walking so a pathological calendar with no working
 * days cannot hang the engine.
 */
export function subtractWorkingDays(iso: string, workingDays: number, calendar: Calendar): string {
  if (workingDays <= 0) return iso;
  const holidays = new Set(calendar.holidays);
  const working = new Set(calendar.workingDays);
  let epochDay = toEpochDay(iso);
  let remaining = workingDays;
  let guard = 0;
  while (remaining > 0 && guard < 3650) {
    epochDay -= 1;
    guard += 1;
    if (working.has(dayOfWeek(epochDay)) && !holidays.has(fromEpochDay(epochDay))) remaining -= 1;
  }
  return fromEpochDay(epochDay);
}

/** Forward equivalent of `subtractWorkingDays`. */
export function addWorkingDays(iso: string, workingDays: number, calendar: Calendar): string {
  if (workingDays <= 0) return iso;
  const holidays = new Set(calendar.holidays);
  const working = new Set(calendar.workingDays);
  let epochDay = toEpochDay(iso);
  let remaining = workingDays;
  let guard = 0;
  while (remaining > 0 && guard < 3650) {
    epochDay += 1;
    guard += 1;
    if (working.has(dayOfWeek(epochDay)) && !holidays.has(fromEpochDay(epochDay))) remaining -= 1;
  }
  return fromEpochDay(epochDay);
}

/** Monday of the ISO week containing the given date — used for weekly bucketing. */
export function startOfWeek(iso: string): string {
  const epochDay = toEpochDay(iso);
  const dow = dayOfWeek(epochDay);
  const shift = dow === 0 ? 6 : dow - 1;
  return fromEpochDay(epochDay - shift);
}
