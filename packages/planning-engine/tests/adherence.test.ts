/**
 * The adherence engine.
 *
 * The thing worth testing hardest is what happens to the awkward cases. A
 * matcher that reconciles the clean 96% and drops the rest produces cleaner
 * statistics than one that keeps everything — and every one of those cleaner
 * statistics is biased. So the assertions below are mostly about receipts that
 * did *not* match neatly.
 */

import { describe, expect, it } from 'vitest';
import type { ReceiptHistory, SupplyElement } from '@repo/domain';

import { runAdherence } from '../src/adherence';

function receipt(overrides: Partial<ReceiptHistory> & { poId: string }): ReceiptHistory {
  return {
    itemId: 'RM-1',
    plantId: 'P1',
    vendorId: 'V-1',
    orderedOn: '2026-06-01',
    promisedOn: '2026-07-01',
    receivedOn: '2026-07-01',
    qty: 100,
    orderedQty: 100,
    actualLeadTimeDays: 30,
    acknowledgedOn: null,
    dispatchedOn: null,
    qaReleasedOn: null,
    reasonCode: null,
    matchedLineId: `${overrides.poId}-10`,
    ...overrides,
  };
}

function order(
  id: string,
  lines: Array<{ line: number; qty: number; planned: string; confirmed?: string }>
): SupplyElement {
  return {
    id,
    type: 'PO',
    itemId: 'RM-1',
    plantId: 'P1',
    qty: lines.reduce((total, line) => total + line.qty, 0),
    dueDate: lines[lines.length - 1]?.planned ?? '2026-07-01',
    releaseDate: '2026-06-01',
    vendorId: 'V-1',
    sourcePlantId: null,
    isFirm: true,
    sourceSystem: 'SAP',
    schedule: lines.map((line) => ({
      line: line.line,
      qty: line.qty,
      plannedDate: line.planned,
      confirmedDate: line.confirmed ?? null,
      expectedDate: line.confirmed ?? line.planned,
      status: 'RECEIVED' as const,
      releasedOn: '2026-06-01',
      acknowledgedOn: line.confirmed ?? null,
      dispatchedOn: null,
      grnDate: null,
      grnQty: null,
      qaReleasedOn: null,
      reasonCode: null,
      note: null,
    })),
  };
}

describe('adherence engine — matching', () => {
  it('matches exactly on order and line id', () => {
    const result = runAdherence({
      receiptHistory: [receipt({ poId: 'PO-1', matchedLineId: 'PO-1-20' })],
      supply: [
        order('PO-1', [
          { line: 1, qty: 100, planned: '2026-06-20' },
          { line: 2, qty: 100, planned: '2026-07-01' },
        ]),
      ],
    });
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.line).toBe(2);
    expect(result.matched[0]?.method).toBe('EXACT');
  });

  it('falls back to FIFO across open lines, earliest first', () => {
    const result = runAdherence({
      receiptHistory: [receipt({ poId: 'PO-1', matchedLineId: 'PO-1-999' })],
      supply: [
        order('PO-1', [
          { line: 1, qty: 100, planned: '2026-06-20' },
          { line: 2, qty: 100, planned: '2026-07-01' },
        ]),
      ],
    });
    expect(result.matched[0]?.method).toBe('FIFO');
    expect(result.matched[0]?.line).toBe(1);
  });

  it('keeps a receipt that reconciles to nothing, and says why', () => {
    const result = runAdherence({
      receiptHistory: [receipt({ poId: 'PO-1', matchedLineId: null })],
      supply: [order('PO-1', [{ line: 1, qty: 100, planned: '2026-07-01' }])],
    });
    // Never dropped: discarding it would bias every statistic downstream, and
    // do so invisibly.
    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0]?.reason).toBe('NOT_RECONCILED');
  });

  it('measures a historical receipt against its own promised date', () => {
    // Twenty-four months of receipts belong to orders that closed long ago and
    // are not in the open supply book. There is no line left to match, but the
    // promise is still on the receipt, and that is what adherence is measured
    // against.
    const result = runAdherence({
      receiptHistory: [receipt({ poId: 'PO-CLOSED', promisedOn: '2026-06-28', receivedOn: '2026-07-01' })],
      supply: [order('PO-1', [{ line: 1, qty: 100, planned: '2026-07-01' }])],
    });
    expect(result.matched[0]?.method).toBe('PROMISED');
    expect(result.matched[0]?.dateVarianceDays).toBe(3);
    // The ordered quantity closed with the order, so in-full is unknown rather
    // than assumed — reporting it as met would flatter every historical vendor.
    expect(result.matched[0]?.inFull).toBeNull();
    expect(result.matched[0]?.quantityVariance).toBeNull();
    expect(result.byVendor.get('V-1')?.inFullRate).toBeNull();
  });

  it('queues a receipt when every line is already satisfied', () => {
    const result = runAdherence({
      receiptHistory: [
        receipt({ poId: 'PO-1', receivedOn: '2026-06-25' }),
        receipt({ poId: 'PO-1', receivedOn: '2026-06-26', matchedLineId: 'PO-1-999' }),
      ],
      supply: [order('PO-1', [{ line: 1, qty: 100, planned: '2026-07-01' }])],
    });
    expect(result.matched).toHaveLength(1);
    expect(result.unmatched[0]?.reason).toBe('NO_OPEN_LINE');
  });

  it('records an over-receipt rather than refusing it', () => {
    const result = runAdherence({
      receiptHistory: [receipt({ poId: 'PO-1', qty: 130 })],
      supply: [order('PO-1', [{ line: 1, qty: 100, planned: '2026-07-01' }])],
    });
    expect(result.matched[0]?.method).toBe('OVER_RECEIPT');
    expect(result.matched[0]?.quantityVariance).toBe(30);
    expect(result.matched[0]?.inFull).toBe(true);
  });

  it('records a short receipt as partial and not in full', () => {
    const result = runAdherence({
      receiptHistory: [receipt({ poId: 'PO-1', qty: 70 })],
      supply: [order('PO-1', [{ line: 1, qty: 100, planned: '2026-07-01' }])],
    });
    expect(result.matched[0]?.method).toBe('PARTIAL');
    expect(result.matched[0]?.quantityVariance).toBe(-30);
    expect(result.matched[0]?.inFull).toBe(false);
  });
});

describe('adherence engine — variance and reliability', () => {
  it('measures lateness against the planned date', () => {
    const result = runAdherence({
      receiptHistory: [receipt({ poId: 'PO-1', receivedOn: '2026-07-06' })],
      supply: [order('PO-1', [{ line: 1, qty: 100, planned: '2026-07-01' }])],
    });
    expect(result.matched[0]?.dateVarianceDays).toBe(5);
    expect(result.matched[0]?.onTime).toBe(false);
  });

  it('tracks confirmation adherence apart from delivery adherence', () => {
    // A vendor who confirms late and then hits what they confirmed is a
    // different problem from one who misses their own date.
    const result = runAdherence({
      receiptHistory: [receipt({ poId: 'PO-1', receivedOn: '2026-07-10' })],
      supply: [order('PO-1', [{ line: 1, qty: 100, planned: '2026-07-01', confirmed: '2026-07-10' }])],
    });
    const matched = result.matched[0];
    expect(matched?.dateVarianceDays).toBe(9);
    expect(matched?.onTime).toBe(false);
    expect(matched?.confirmationVarianceDays).toBe(0);

    const vendor = result.byVendor.get('V-1');
    expect(vendor?.onTimeRate).toBe(0);
    expect(vendor?.confirmationAdherence).toBe(1);
  });

  it('reports no confirmation adherence for a vendor who confirms nothing', () => {
    const result = runAdherence({
      receiptHistory: [receipt({ poId: 'PO-1' })],
      supply: [order('PO-1', [{ line: 1, qty: 100, planned: '2026-07-01' }])],
    });
    const vendor = result.byVendor.get('V-1');
    expect(vendor?.confirmationAdherence).toBeNull();
    expect(vendor?.unconfirmedReceipts).toBe(1);
  });

  it('rolls up per vendor, per vendor-material and per vendor-plant separately', () => {
    // The same vendor, reliable on one material and late on the other. A single
    // blended score hides exactly the variance the norms engine needs.
    const result = runAdherence({
      receiptHistory: [
        receipt({ poId: 'PO-1', itemId: 'RM-1', receivedOn: '2026-07-01' }),
        receipt({ poId: 'PO-2', itemId: 'RM-2', receivedOn: '2026-07-11' }),
      ],
      supply: [
        order('PO-1', [{ line: 1, qty: 100, planned: '2026-07-01' }]),
        { ...order('PO-2', [{ line: 1, qty: 100, planned: '2026-07-01' }]), itemId: 'RM-2' },
      ],
    });

    expect(result.byVendor.get('V-1')?.onTimeRate).toBe(0.5);
    expect(result.byVendor.get('V-1')?.otifRate).toBe(0.5);
    expect(result.byVendorMaterial.get('V-1@RM-1')?.onTimeRate).toBe(1);
    expect(result.byVendorMaterial.get('V-1@RM-2')?.onTimeRate).toBe(0);
    expect(result.byVendorPlant.get('V-1@P1')?.receipts).toBe(2);
  });

  it('computes the spread of lateness, not just its average', () => {
    const result = runAdherence({
      receiptHistory: [
        receipt({ poId: 'PO-1', receivedOn: '2026-06-27' }),
        receipt({ poId: 'PO-2', receivedOn: '2026-07-05' }),
      ],
      supply: [
        order('PO-1', [{ line: 1, qty: 100, planned: '2026-07-01' }]),
        order('PO-2', [{ line: 1, qty: 100, planned: '2026-07-01' }]),
      ],
    });
    const vendor = result.byVendor.get('V-1');
    // −4 and +4: on average on time, and never actually on time.
    expect(vendor?.meanDateVarianceDays).toBe(0);
    expect(vendor?.stdDevDateVarianceDays).toBe(4);
  });
});
