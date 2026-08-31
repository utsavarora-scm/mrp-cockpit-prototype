'use client';

/**
 * The norm rail.
 *
 * Maintained against recommended, and the money in the gap. Today it can only
 * show what is maintained: computing the recommendation is the norms engine's
 * job, and it arrives in Checkpoint B. The rail says so plainly rather than
 * showing a plausible-looking placeholder — an invented number here is exactly
 * what killed the last demo.
 *
 * The vendor split sits in this rail rather than in a card of its own. It is
 * four numbers, it belongs to the same question the rail asks ("what is this
 * material's supply shaped like?"), and the scheduling engine will split orders
 * across exactly these shares in Checkpoint B — so seeing 60/40 here means the
 * schedule splitting 60/40 later reads as consequence rather than coincidence.
 */

import { formatCurrency, formatDateFull, formatNumber, formatPercent } from '@repo/domain';

import type { ItemDetail } from '@/lib/api-types';
import { OverrideModal } from '@/components/planning/OverrideModal';

export function NormRail({ detail }: { detail: ItemDetail }) {
  const dailyDemand =
    detail.grossRequirements.reduce((total, value) => total + value, 0) / Math.max(detail.dates.length, 1);
  const normDays = dailyDemand > 0 ? detail.safetyStock / dailyDemand : 0;
  const evidence = detail.leadTime;
  const drift =
    evidence.observedMeanDays !== null && evidence.maintainedDays !== null
      ? evidence.observedMeanDays - evidence.maintainedDays
      : null;

  return (
    <aside className='bg-card flex flex-col gap-5 rounded-lg border p-6'>
      <div className='flex items-baseline justify-between gap-2'>
        <h2 className='text-muted-foreground text-[15px] font-semibold tracking-[0.04em] uppercase'>Norm</h2>
        <OverrideModal
          itemId={detail.itemId}
          plantId={detail.plantId}
          field='safetyStock'
          label='Safety stock'
          currentValue={detail.safetyStock}
          uom={detail.baseUom}
        />
      </div>

      <Figure label='Maintained buffer' value={`${formatNumber(detail.safetyStock)} ${detail.baseUom}`} />
      <Figure label='Which is cover of' value={`${normDays.toFixed(1)} days`} />
      <Figure
        label='Maintained lead time'
        value={evidence.maintainedDays === null ? '—' : `${formatNumber(evidence.maintainedDays)} days`}
        note={
          evidence.observedMeanDays === null
            ? undefined
            : `${evidence.observedMeanDays.toFixed(1)} days observed across ${evidence.matchedCount} receipts`
        }
        tone={drift !== null && Math.abs(drift) >= 2 ? 'attention' : undefined}
      />
      <Figure
        label='Stock value at standard cost'
        value={formatCurrency(detail.stock.unrestricted * detail.standardCost)}
      />

      {detail.vendors.length > 0 ? (
        <div className='border-t pt-4'>
          <p className='text-muted-foreground mb-2 text-[12px] font-medium'>Where it is sourced</p>
          <table className='w-full'>
            <tbody>
              {detail.vendors.map((vendor) => (
                <tr key={vendor.vendorId}>
                  <td className='py-1 text-[13px]'>
                    {vendor.vendorName ?? vendor.vendorId}
                    {vendor.isImport ? <span className='text-muted-foreground text-[12px]'> · import</span> : null}
                  </td>
                  <td className='py-1 text-right text-[13px] font-medium tabular-nums'>
                    {formatPercent(vendor.allocationShare, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className='border-t pt-4'>
        <p className='text-muted-foreground text-[12px] leading-relaxed'>
          <span className='text-foreground font-medium'>Recommended norm — not yet computed.</span> Reconstructing it
          from this material’s own goods receipts is the norms engine’s job, and it lands in the next checkpoint. The
          gap between the two, priced, is what the cockpit will lead with.
        </p>
      </div>

      <p className='text-muted-foreground text-[12px]'>
        Parameters last maintained{' '}
        <span className='text-foreground font-medium'>{formatDateFull(detail.paramsLastChangedOn)}</span>
      </p>
    </aside>
  );
}

function Figure({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'attention' }) {
  return (
    <div>
      <p className='text-muted-foreground text-[12px] font-medium'>{label}</p>
      <p className='mt-1 text-[22px] font-semibold tabular-nums'>{value}</p>
      {note ? (
        <p
          className={
            tone === 'attention'
              ? 'text-status-attention mt-0.5 text-[12px]'
              : 'text-muted-foreground mt-0.5 text-[12px]'
          }
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}
