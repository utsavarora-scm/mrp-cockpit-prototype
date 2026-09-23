/**
 * Whether a receipt could actually be taken, on the date it is proposed for.
 *
 * Lead time says when an order *could* land. It says nothing about whether the
 * vendor can make it that week, whether the warehouse can hold it, or whether
 * the material would still be good by the time it was consumed. A recovery
 * proposal that clears the lead-time fence and fails one of these is not a
 * recovery — and counting it as one prices exposure as recoverable on the
 * strength of an order nobody can place, which is the same defect as valuing a
 * lot-sized quantity as a shortfall, one layer down.
 *
 * Extracted from the delivery-schedule builder rather than reimplemented beside
 * it: two copies of a ceiling is how a schedule and a recommendation come to
 * disagree about the same week.
 */

import type { ConstraintKey } from './delivery-schedule';

const QTY_EPSILON = 1e-6;

export interface ReceiptCeilingInput {
  /** Most the vendor can produce in a week; null when unmaintained. */
  weeklyCapacity: number | null;
  /** Most the site can hold. See `receiptCeiling` for which balance it is asked of. */
  storageCapacity: number | null;
  /** Days the material keeps — a ceiling on cover, not on space. */
  shelfLifeDays: number | null;
  /** A ceiling on the delivery itself: tankage, a vessel parcel. */
  maxLotSize: number | null;
  dailyDemandMean: number;
}

export interface ReceiptCeiling {
  /** The most that can be delivered into this period. */
  limit: number;
  /** Which ceiling produced it, where one did. */
  binds: ConstraintKey | null;
}

/**
 * The most that can be delivered into a period, and which ceiling says so.
 *
 * Two kinds, and the interesting one is rarely the expected one: vendor
 * capacity limits what can be made, the warehouse limits what can be held.
 *
 * Which balance the storage question is asked of depends on how the receipt
 * arrives, and the caller has to say:
 *
 * - **One drop** (`heldAtArrival` given): the stock on the floor when it lands.
 *   A truck arrives before the period's consumption has made room for it, and
 *   crediting that consumption in advance approves a delivery that cannot be
 *   put away.
 * - **Called off through the period** (`heldAtArrival` omitted): the balance
 *   the period closes on. Drops made day by day alongside consumption move
 *   the stock steadily from opening to close, so the closing balance *is* the
 *   peak — exact for call-offs, and optimistic for a single drop. A caller
 *   using this has to say so on the screen.
 */
export function receiptCeiling(
  input: ReceiptCeilingInput,
  openingBalance: number,
  requirement: number,
  heldAtArrival?: number
): ReceiptCeiling {
  let limit = Number.POSITIVE_INFINITY;
  let binds: ConstraintKey | null = null;

  if (input.storageCapacity !== null && input.storageCapacity > 0) {
    limit = Math.max(
      0,
      heldAtArrival === undefined
        ? input.storageCapacity - openingBalance + requirement
        : input.storageCapacity - heldAtArrival
    );
    binds = 'STORAGE_CAP';
  }
  // Shelf life is the raw material's version of the warehouse ceiling: not how
  // much fits, but how much can be consumed before it stops being material.
  // That one *is* a question about cover, so the period's consumption counts.
  if (input.shelfLifeDays !== null && input.shelfLifeDays > 0 && input.dailyDemandMean > 0) {
    const keeps = input.shelfLifeDays * input.dailyDemandMean;
    const shelfLimit = Math.max(0, keeps - openingBalance + requirement);
    if (shelfLimit < limit) {
      limit = shelfLimit;
      binds = 'SHELF_LIFE';
    }
  }
  if (input.weeklyCapacity !== null && input.weeklyCapacity > 0 && input.weeklyCapacity < limit) {
    limit = input.weeklyCapacity;
    binds = 'VENDOR_CAPACITY';
  }
  if (input.maxLotSize !== null && input.maxLotSize > 0 && input.maxLotSize < limit) {
    limit = input.maxLotSize;
    binds = 'MAX_LOT';
  }
  return { limit, binds };
}

export interface ReceiptVerdict {
  ok: boolean;
  /** The most that could have been taken. */
  limit: number;
  /** Named only when the receipt was refused. */
  blockedBy: ConstraintKey | null;
  detail: string | null;
}

/**
 * Whether a specific quantity can land in a specific week.
 *
 * A shutdown is absolute — the vendor's plant produces nothing, so no quantity
 * clears it. Everything else is a ceiling, and a quantity above it is refused
 * with the ceiling named rather than quietly trimmed: the caller decides
 * whether a smaller order is worth proposing.
 */
export function checkReceipt(
  input: ReceiptCeilingInput,
  args: {
    qty: number;
    openingBalance: number;
    requirement: number;
    isShutdownWeek: boolean;
    /** Stock on the floor when a single drop lands. See `receiptCeiling`. */
    heldAtArrival?: number;
  }
): ReceiptVerdict {
  if (args.isShutdownWeek) {
    return {
      ok: false,
      limit: 0,
      blockedBy: 'VENDOR_SHUTDOWN',
      detail: "The vendor's plant is shut that week. It can produce nothing.",
    };
  }

  const ceiling = receiptCeiling(input, args.openingBalance, args.requirement, args.heldAtArrival);
  if (args.qty > ceiling.limit + QTY_EPSILON) {
    return {
      ok: false,
      limit: ceiling.limit,
      blockedBy: ceiling.binds,
      detail: `${args.qty} exceeds the ${ceiling.limit} that week can take.`,
    };
  }
  return { ok: true, limit: ceiling.limit, blockedBy: null, detail: null };
}
