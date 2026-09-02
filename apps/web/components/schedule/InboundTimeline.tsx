'use client';

/**
 * The inbound timeline.
 *
 * Each line's state along the pipeline, and where it is late, the delay in days
 * *and* in days of cover — because a five-day delay on a fast mover and a
 * five-day delay on a slow one are not the same event.
 */

import { formatNumber } from '@repo/domain';
import { cn } from '@repo/ui/lib/utils';

import type { DeliveryLineView, ScheduleBuilderView } from '@/lib/api-types';
import { TierBadge } from '@/components/planning/TierBadge';

export function InboundTimeline({
  view,
  onEdit,
  onCapture,
}: {
  view: ScheduleBuilderView;
  onEdit: (line: DeliveryLineView) => void;
  /** Recording what happened to a line, from the screen the line lives on. */
  onCapture: (line: DeliveryLineView) => void;
}) {
  const lines = view.orders.flatMap((order) => order.lines);

  return (
    <section className='bg-card rounded-lg border'>
      <div className='flex flex-wrap items-baseline justify-between gap-3 border-b px-5 py-3'>
        <div>
          <h2 className='text-[14px] font-semibold'>Inbound</h2>
          <p className='text-muted-foreground text-[12px]'>
            PO created → vendor acknowledged → dispatched → in transit → received → quality released → available
          </p>
        </div>
        <p className='text-muted-foreground text-[12px]'>
          {formatNumber(view.orders.reduce((sum, order) => sum + order.confirmedQty, 0))} {view.baseUom} acknowledged ·{' '}
          <span className='text-status-attention font-medium'>
            {formatNumber(view.orders.reduce((sum, order) => sum + order.unconfirmedQty, 0))} {view.baseUom} not
          </span>
        </p>
      </div>

      {lines.length === 0 ? (
        <p className='text-muted-foreground px-5 py-6 text-[13px]'>
          Nothing on order. Everything below is a schedule the plan is proposing.
        </p>
      ) : (
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[1080px]'>
            <thead>
              <tr className='bg-surface-sunken border-b'>
                <Th>Order</Th>
                <Th>Line</Th>
                <Th align='right'>Quantity</Th>
                <Th>Requested</Th>
                <Th>Vendor committed</Th>
                <Th>Expected</Th>
                <Th>Stage</Th>
                <Th>Confidence</Th>
                <Th align='right'>Slip</Th>
                <Th>Reason</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {view.orders.flatMap((order) =>
                order.lines.map((line) => (
                  <tr key={`${order.id}-${line.line}`} className='grid-row hover:bg-muted/30'>
                    <td className='grid-cell font-mono text-[12px]'>{order.id}</td>
                    <td className='grid-cell num'>{line.line}</td>
                    <td className='grid-cell num'>{formatNumber(line.qty)}</td>
                    <td className='grid-cell text-[12px]'>
                      {line.requestedWeek}
                      <span className='text-muted-foreground ml-1.5'>{line.requestedDate.slice(5)}</span>
                    </td>
                    <td className='grid-cell text-[12px]'>
                      {line.committedDate ? (
                        line.committedDate.slice(5)
                      ) : (
                        <span className='text-status-attention'>not acknowledged</span>
                      )}
                    </td>
                    <td className='grid-cell text-[12px]'>
                      {line.expectedWeek}
                      <span className='text-muted-foreground ml-1.5'>{line.expectedDate.slice(5)}</span>
                    </td>
                    <td className='text-muted-foreground grid-cell text-[12px]'>{line.stage}</td>
                    <td className='grid-cell'>
                      <TierBadge tier={line.tier} />
                    </td>
                    <td className={cn('grid-cell num', line.slipDays > 0 && 'text-status-critical font-medium')}>
                      {line.slipDays > 0 ? `+${line.slipDays} d` : '—'}
                    </td>
                    <td className='text-muted-foreground grid-cell text-[11px]'>{line.reasonLabel ?? '—'}</td>
                    <td className='grid-cell text-right whitespace-nowrap'>
                      {line.editable ? (
                        <button
                          type='button'
                          onClick={() => onEdit(line)}
                          className='text-primary text-[12px] font-medium hover:underline'
                        >
                          Move
                        </button>
                      ) : null}
                      <button
                        type='button'
                        onClick={() => onCapture(line)}
                        className='text-primary ml-3 text-[12px] font-medium hover:underline'
                      >
                        {line.grnDate ? 'Update record' : 'Record'}
                      </button>
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={cn('grid-head', align === 'right' ? 'text-right' : 'text-left')}>{children}</th>;
}
