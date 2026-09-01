/**
 * Working-calendar arithmetic, precomputed once per run.
 *
 * Lead-time offsetting is the single hottest operation in the engine — every
 * planned order at every BOM level walks backwards over a plant calendar. Doing
 * that by stepping day-by-day is correct but quadratic in practice, so the
 * window is flattened into two integer arrays up front and every subsequent
 * walk is an array lookup.
 *
 * The window deliberately extends well before the planning date: release dates
 * that land in the past are not an error to be avoided, they are the A8
 * exception the demo is built around, and they must be computed exactly.
 */

import { type Calendar, dayOfWeek, fromEpochDay, toEpochDay } from '@repo/domain';

/** Days of history the window covers before the planning date. */
const LOOKBACK_DAYS = 730;
/** Days of slack the window covers beyond the horizon. */
const LOOKAHEAD_SLACK_DAYS = 400;

export class WorkingCalendar {
  readonly id: string;
  private readonly windowStart: number;
  private readonly windowEnd: number;
  /** Epoch days that are working days, ascending. */
  private readonly workingDays: Int32Array;
  /** For each day in the window: how many working days fall strictly before it. */
  private readonly countBefore: Int32Array;
  /** For each day in the window: how many working days fall at or before it. */
  private readonly countAtOrBefore: Int32Array;

  constructor(calendar: Calendar, planningDate: string, horizonDays: number) {
    this.id = calendar.id;
    const planningEpochDay = toEpochDay(planningDate);
    this.windowStart = planningEpochDay - LOOKBACK_DAYS;
    this.windowEnd = planningEpochDay + horizonDays + LOOKAHEAD_SLACK_DAYS;

    const span = this.windowEnd - this.windowStart + 1;
    const holidays = new Set(calendar.holidays);
    const working = new Set(calendar.workingDays);

    const collected: number[] = [];
    this.countBefore = new Int32Array(span);
    this.countAtOrBefore = new Int32Array(span);

    let running = 0;
    for (let i = 0; i < span; i += 1) {
      const epochDay = this.windowStart + i;
      this.countBefore[i] = running;
      const isWorking = working.has(dayOfWeek(epochDay)) && !holidays.has(fromEpochDay(epochDay));
      if (isWorking) {
        collected.push(epochDay);
        running += 1;
      }
      this.countAtOrBefore[i] = running;
    }
    this.workingDays = Int32Array.from(collected);
  }

  private index(epochDay: number): number {
    const i = epochDay - this.windowStart;
    if (i < 0) return 0;
    if (i >= this.countBefore.length) return this.countBefore.length - 1;
    return i;
  }

  isWorkingDay(epochDay: number): boolean {
    const i = this.index(epochDay);
    return (this.countAtOrBefore[i] as number) > (this.countBefore[i] as number);
  }

  /**
   * The n-th working day strictly before `epochDay`. With a 7-day working
   * calendar and no holidays this reduces exactly to `epochDay - n`, which is
   * what makes the §6.2 worked example reproduce day-for-day.
   */
  subtractWorkingDays(epochDay: number, n: number): number {
    if (n <= 0) return epochDay;
    const target = (this.countBefore[this.index(epochDay)] as number) - n;
    if (target < 0) {
      // Ran off the front of the window. Falling back to calendar subtraction
      // keeps the order visible as A8 rather than silently disappearing.
      return epochDay - n;
    }
    return this.workingDays[target] as number;
  }

  /** The n-th working day strictly after `epochDay`. */
  addWorkingDays(epochDay: number, n: number): number {
    if (n <= 0) return epochDay;
    const target = (this.countAtOrBefore[this.index(epochDay)] as number) + n - 1;
    if (target >= this.workingDays.length) return epochDay + n;
    return this.workingDays[target] as number;
  }

  /** `epochDay` itself if it is a working day, otherwise the next one. */
  nextWorkingDayOnOrAfter(epochDay: number): number {
    if (this.isWorkingDay(epochDay)) return epochDay;
    return this.addWorkingDays(epochDay, 1);
  }

  /** Working days in the inclusive range — used for capacity and coverage checks. */
  /**
   * The last day on or before this one that the site is open.
   *
   * Used for a release date: a purchase order raised on a Sunday is a purchase
   * order raised on Monday, and dating it to the Sunday quietly gives the
   * planner a day they do not have.
   */
  previousWorkingDayOnOrBefore(epochDay: number): number {
    let day = epochDay;
    let guard = 0;
    while (!this.isWorkingDay(day) && guard < 400) {
      day -= 1;
      guard += 1;
    }
    return day;
  }

  countWorkingDaysBetween(fromEpochDay: number, toEpochDayInclusive: number): number {
    if (toEpochDayInclusive < fromEpochDay) return 0;
    const hi = this.countAtOrBefore[this.index(toEpochDayInclusive)] as number;
    const lo = this.countBefore[this.index(fromEpochDay)] as number;
    return hi - lo;
  }
}

/** Builds one precomputed calendar per calendar id, keyed for O(1) lookup. */
export function buildCalendars(
  calendars: Calendar[],
  planningDate: string,
  horizonDays: number
): Map<string, WorkingCalendar> {
  const map = new Map<string, WorkingCalendar>();
  for (const calendar of calendars) {
    map.set(calendar.id, new WorkingCalendar(calendar, planningDate, horizonDays));
  }
  return map;
}

/** Fallback used when a plant references a calendar that does not exist. */
export const FALLBACK_CALENDAR: Calendar = {
  id: '__FALLBACK__',
  workingDays: [1, 2, 3, 4, 5],
  holidays: [],
};
