'use client';

/**
 * The planning position, in one line.
 *
 * The seven figures a planner reads before deciding whether this material needs
 * them at all: what is wanted, what is held, what is ordered, how much of that
 * is genuinely coming, what the plan is adding, where the balance lands, and
 * whether that clears the buffer.
 *
 * Deliberately above the chart. The chart answers "when"; this answers
 * "whether", and that is the question that comes first.
 */

import { formatDateFull, formatNumber } from '@repo/domain';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { cn } from '@repo/ui/lib/utils';

import type { ItemDetail } from '@/lib/api-types';

export function PositionBar({ detail }: { detail: ItemDetail }) {
  const { position } = detail;
  const shortfall = position.shortfall;

  return (
    <div className='flex flex-wrap items-stretch gap-px border-b'>
      <Cell
        label='Demand'
        value={formatNumber(position.demand)}
        uom={detail.baseUom}
        hint='Gross requirements across the whole horizon — sales orders, net forecast and dependent demand.'
      />
      <Cell
        label='Stock on hand'
        value={formatNumber(detail.stock.unrestricted)}
        uom={detail.baseUom}
        hint='Unrestricted stock. Blocked and inspection stock are held back and shown separately below.'
      />
      <Cell
        label='Open PO'
        value={formatNumber(position.openPo)}
        uom={detail.baseUom}
        hint='Everything on order, whether or not a supplier has committed to a date for it.'
      />
      <Cell
        label='Expected inbound'
        value={formatNumber(position.expectedInbound)}
        uom={detail.baseUom}
        emphasis={position.expectedInbound < position.openPo ? 'WEAK' : 'NONE'}
        hint='The part of the open quantity a supplier has confirmed, shipped or delivered. Where this is below open PO, the plan is counting on supply nobody has promised.'
      />
      <Cell
        label='Planned receipts'
        value={formatNumber(position.plannedReceipts)}
        uom={detail.baseUom}
        hint='Supply the engine is recommending but which has not been ordered.'
      />
      <Cell
        label='Safety stock'
        value={formatNumber(detail.safetyStock)}
        uom={detail.baseUom}
        hint='The buffer the plan defends. Net requirements arise wherever the balance falls below it.'
      />
      <Cell
        label='Lowest balance'
        value={formatNumber(position.lowestBalance)}
        uom={detail.baseUom}
        emphasis={position.lowestBalance < 0 ? 'BAD' : position.lowestBalance < detail.safetyStock ? 'WEAK' : 'NONE'}
        hint='The worst point the balance reaches on orderable supply alone — the honest low, not the one the plan schedules towards.'
      />
      <Cell
        label={shortfall < 0 ? 'Shortfall vs buffer' : 'Cover above buffer'}
        value={formatNumber(Math.abs(shortfall))}
        uom={detail.baseUom}
        emphasis={shortfall < 0 ? 'BAD' : 'NONE'}
        hint='Distance between the lowest balance and safety stock. Negative means the buffer is breached at some point in the horizon.'
      />
      {position.stockoutDate ? (
        <Cell
          label='Projected stock-out'
          value={formatDateFull(position.stockoutDate)}
          emphasis='BAD'
          hint='First date the balance goes negative once orders that could no longer be placed in time are left out.'
        />
      ) : null}
    </div>
  );
}

function Cell({
  label,
  value,
  uom,
  hint,
  emphasis = 'NONE',
}: {
  label: string;
  value: string;
  uom?: string;
  hint: string;
  emphasis?: 'NONE' | 'WEAK' | 'BAD';
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className='min-w-[104px] flex-1 cursor-help px-3 py-1.5'>
          <div className='text-muted-foreground text-[10px] font-medium tracking-wide uppercase'>{label}</div>
          <div
            className={cn(
              'mono mt-0.5 text-[13px] font-semibold',
              emphasis === 'BAD' && 'text-destructive',
              emphasis === 'WEAK' && 'text-primary',
            )}
          >
            {value}
            {uom ? <span className='text-muted-foreground/70 ml-1 text-[10.5px] font-normal'>{uom}</span> : null}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent className='max-w-xs'>{hint}</TooltipContent>
    </Tooltip>
  );
}
