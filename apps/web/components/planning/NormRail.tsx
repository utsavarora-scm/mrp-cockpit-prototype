'use client';

/**
 * The norm rail.
 *
 * Maintained against recommended, and the money in the gap. Today it can only
 * show what is maintained: computing the recommendation is the norms engine's
 * job, and it arrives in Checkpoint B. The rail states that plainly rather than
 * showing a plausible-looking placeholder — an invented number here is exactly
 * the thing that killed the last demo.
 */

import { formatCurrency, formatDateFull, formatNumber } from '@repo/domain';
import type { ItemDetail } from '@/lib/api-types';

export function NormRail({ detail }: { detail: ItemDetail }) {
  const dailyDemand =
    detail.grossRequirements.reduce((total, value) => total + value, 0) / Math.max(detail.dates.length, 1);
  const normDays = dailyDemand > 0 ? detail.safetyStock / dailyDemand : 0;
  const leadTime = detail.parameters.find((row) => row.field === 'leadTimeDays');

  return (
    <aside className='bg-card flex flex-col gap-5 rounded-lg border p-6'>
      <h2 className='text-muted-foreground text-[15px] font-semibold tracking-[0.04em] uppercase'>Norm</h2>

      <Figure label='Maintained buffer' value={`${formatNumber(detail.safetyStock)} ${detail.baseUom}`} />
      <Figure label='Which is cover of' value={`${normDays.toFixed(1)} days`} />
      <Figure
        label='Maintained lead time'
        value={leadTime ? leadTime.maintained : '—'}
        note={leadTime?.observed ?? undefined}
        tone={leadTime?.status === 'DRIFTED' ? 'attention' : undefined}
      />
      <Figure
        label='Stock value at standard cost'
        value={formatCurrency(detail.stock.unrestricted * detail.standardCost)}
      />

      <div className='border-t pt-4'>
        <p className='text-muted-foreground text-[12px] leading-relaxed'>
          <span className='text-foreground font-medium'>Recommended norm — not yet computed.</span> Reconstructing it
          from this material’s own goods receipts is the norms engine’s job, and it lands in the next checkpoint. The
          gap between the two, priced, is what the cockpit will lead with.
        </p>
      </div>

      <p className='text-muted-foreground text-[12px]'>
        Parameters last maintained {detail.parameters.length > 0 ? '' : ''}
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
