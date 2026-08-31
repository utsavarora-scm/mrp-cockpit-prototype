/**
 * The lead-time fence — the most important line on the chart, and the one most
 * planning tools omit.
 *
 * It marks the earliest date a *newly placed* order can arrive. Every shortage
 * to the left of it is unsolvable by ordering, and a planner needs to know that
 * in the first three seconds rather than after two phone calls.
 *
 * Two things make this module worth having rather than inlining a subtraction:
 *
 * **The chain is not the vendor's quoted number.** Most systems use the
 * manufacturing time and silently omit acknowledgement, transit, customs,
 * goods receipt and quality release. That is a large, systematic
 * understatement, and it is why plans that look fine on paper break at the
 * dock. Every interval is named here and every one is displayed.
 *
 * **It is computed twice.** Once on what the material master says, once on what
 * the receipts actually measured. The gap between those two fences is what a
 * planner's master data is costing them, and putting both on the same chart is
 * the single strongest argument for measuring norms at all.
 */

import { fromEpochDay, type ItemPlant, type ItemVendor } from '@repo/domain';

import type { WorkingCalendar } from './calendar';

/**
 * How long after a review cycle a plan stops being merely tight and becomes
 * genuinely changeable. One week: the cadence a weekly planning run implies.
 */
export const REVIEW_CYCLE_DAYS = 7;

/** One interval of the chain, with the function that owns it. */
export interface ChainInterval {
  key: 'response' | 'readiness' | 'transit' | 'customs' | 'goodsReceipt' | 'qaRelease';
  label: string;
  days: number;
  owner: string;
  note: string;
}

export interface LeadTimeChain {
  intervals: ChainInterval[];
  /** Purchase-order release to available for consumption. What MRP should use. */
  totalDays: number;
  /** What the vendor quotes, and what most systems mistake for the whole thing. */
  vendorQuotedDays: number;
}

/**
 * The maintained chain for one material at one plant.
 *
 * Where the vendor record and the material master disagree about the total, the
 * material master wins — it is the number the engine actually nets on — and the
 * difference lands on the vendor readiness interval, which is the one nobody
 * measures independently anyway. That keeps the intervals summing to the total
 * a planner can look up in SAP, which matters more than any one interval being
 * separately defensible.
 */
export function leadTimeChain(itemPlant: ItemPlant, vendor: ItemVendor | null): LeadTimeChain {
  const response = vendor?.acknowledgementDays ?? 0;
  const transit = vendor?.transitDays ?? 0;
  const customs = vendor?.customsDays ?? 0;
  const goodsReceipt = itemPlant.grProcessingTimeDays;
  const qaRelease = itemPlant.qaQuarantineDays;

  const maintainedTotal = itemPlant.leadTimeDays ?? 0;
  const accountedFor = response + transit + customs + goodsReceipt + qaRelease;
  const readiness = Math.max(0, maintainedTotal - accountedFor);

  const intervals = (
    [
      {
        key: 'response',
        label: 'Vendor response',
        days: response,
        owner: 'Sourcing',
        note: 'Purchase order released to vendor acknowledgement. Time lost before the vendor has been told.',
      },
      {
        key: 'readiness',
        label: 'Vendor readiness',
        days: readiness,
        owner: 'Vendor',
        note: 'Acknowledgement to dispatch. The only interval the vendor actually owns.',
      },
      {
        key: 'transit',
        label: 'Transit',
        days: transit,
        owner: 'Logistics',
        note: 'Dispatch to arrival at the gate.',
      },
      {
        key: 'customs',
        label: 'Customs and clearance',
        days: customs,
        owner: 'Logistics',
        note: 'Import clearance. Zero on a domestic lane.',
      },
      {
        key: 'goodsReceipt',
        label: 'Goods receipt',
        days: goodsReceipt,
        owner: 'Plant',
        note: 'Gate-in, unloading and put-away.',
      },
      {
        key: 'qaRelease',
        label: 'Quality release',
        days: qaRelease,
        owner: 'Plant / QC',
        note: 'Quarantine and release against the certificate of analysis. Until it clears, it is not stock.',
      },
    ] as ChainInterval[]
  ).filter((interval) => interval.days > 0 || interval.key === 'readiness');

  return {
    intervals,
    totalDays: intervals.reduce((sum, interval) => sum + interval.days, 0),
    vendorQuotedDays: readiness,
  };
}

export type FenceZone = 'FROZEN' | 'FIRM' | 'FREE';

export const ZONE_MEANING: Record<FenceZone, { label: string; meaning: string; allowed: string }> = {
  FROZEN: {
    label: 'Frozen',
    meaning: 'Inside the lead time.',
    allowed: 'Nothing new can be ordered to land here. Expedite, substitute, spot-buy or reschedule production.',
  },
  FIRM: {
    label: 'Firm',
    meaning: 'Lead time, plus one review cycle.',
    allowed: 'Existing orders can be pulled in or pushed out. A new order is tight but possible.',
  },
  FREE: {
    label: 'Free',
    meaning: 'Beyond the review cycle.',
    allowed: 'The plan is fully changeable.',
  },
};

export interface Fence {
  /** The total chain, in calendar days. */
  totalDays: number;
  /** Day offset of the earliest achievable receipt, walked over the calendar. */
  earliestReceiptDay: number;
  earliestReceiptDate: string;
  /** Last day of the firm zone. Beyond it the plan is free. */
  firmUntilDay: number;
}

export interface FenceSet {
  /** On the material master's own numbers. */
  maintained: Fence;
  /**
   * On what the receipts measured. Null where there is not enough history —
   * an absent fence is stated as absent rather than quietly falling back to the
   * maintained one, which would hide exactly the gap this exists to show.
   */
  measured: Fence | null;
  /** measured − maintained, in days. Null where there is no measured fence. */
  driftDays: number | null;
}

export interface FenceInput {
  planningEpochDay: number;
  /** Working days are walked, never subtracted naively. */
  calendar: WorkingCalendar;
  maintainedChainDays: number;
  /** Mean total lead time from matched receipts, where there are enough. */
  measuredTotalDays: number | null;
  horizonDays: number;
}

export function computeFences(input: FenceInput): FenceSet {
  const maintained = fenceFor(input, input.maintainedChainDays);
  const measured = input.measuredTotalDays === null ? null : fenceFor(input, input.measuredTotalDays);
  return {
    maintained,
    measured,
    driftDays: measured === null ? null : measured.totalDays - maintained.totalDays,
  };
}

function fenceFor(input: FenceInput, totalDays: number): Fence {
  const rounded = Math.max(0, Math.round(totalDays));
  // Walked over working days: a lead time that lands mid-shutdown is not a
  // lead time, and naive date arithmetic lands receipts on Sundays.
  const receiptEpochDay = input.calendar.addWorkingDays(input.planningEpochDay, rounded);
  const earliestReceiptDay = receiptEpochDay - input.planningEpochDay;
  return {
    totalDays: rounded,
    earliestReceiptDay,
    earliestReceiptDate: fromEpochDay(receiptEpochDay),
    firmUntilDay: earliestReceiptDay + REVIEW_CYCLE_DAYS,
  };
}

/** Which zone a day offset falls in, against a given fence. */
export function zoneOfDay(fence: Fence, day: number): FenceZone {
  if (day < fence.earliestReceiptDay) return 'FROZEN';
  if (day <= fence.firmUntilDay) return 'FIRM';
  return 'FREE';
}

/**
 * How far a shortage sits inside the frozen zone, in days.
 *
 * Zero or negative means an order placed today can still reach it. A positive
 * number is the size of the window no purchase order can touch — which is the
 * number that reframes the planner's job from "raise three orders" to "choose
 * between the levers that can actually reach this".
 */
export function unreachableByDays(fence: Fence, shortageDay: number): number {
  return fence.earliestReceiptDay - shortageDay;
}
