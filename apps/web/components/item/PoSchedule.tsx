'use client';

/**
 * The supply schedule.
 *
 * An order is not a quantity and a date — it is a set of drops, each at its own
 * stage of actually happening. The distinction the planner needs is between
 * quantity that is *ordered* and quantity a supplier has *committed to*, because
 * the plan nets against both as though they were the same thing.
 *
 * Editing a line commits a real mutation and re-runs the plan behind it. The
 * whole point is that moving a drop out by a fortnight is a planning event.
 */

import { formatDateShort, formatNumber, formatQty } from '@repo/domain';
import { Badge } from '@repo/ui/components/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { cn } from '@repo/ui/lib/utils';
import { TriangleAlert } from 'lucide-react';

import type { DeliveryLineView, ItemDetail, PurchaseOrderView } from '@/lib/api-types';

export interface ScheduleEdit {
  supplyElementId: string;
  line: number;
  newDate: string;
  newQty: number | null;
  confirmed: boolean;
}

/**
 * The inbound pipeline, in the order a delivery travels it. Kept as one ordered
 * list rather than per-status labels so a planner can see how far along a drop
 * is, not merely what it is called.
 */
const PIPELINE: Array<{ status: DeliveryLineView['status']; label: string }> = [
  { status: 'PLANNED', label: 'PO created' },
  { status: 'CONFIRMED', label: 'Supplier committed' },
  { status: 'IN_TRANSIT', label: 'In transit' },
  { status: 'RECEIVED', label: 'Goods received' },
];

const STAGE_OF: Record<DeliveryLineView['status'], number> = {
  PLANNED: 0,
  CONFIRMED: 1,
  IN_TRANSIT: 2,
  RECEIVED: 3,
  // A delayed line has been committed to — just not to the date the plan uses.
  DELAYED: 1,
};

const STATUS_LABEL: Record<DeliveryLineView['status'], string> = {
  PLANNED: 'Not confirmed',
  CONFIRMED: 'Confirmed',
  IN_TRANSIT: 'In transit',
  RECEIVED: 'Received',
  DELAYED: 'Delayed',
};

function statusClass(status: DeliveryLineView['status']): string {
  if (status === 'DELAYED') return 'sev-critical';
  if (status === 'IN_TRANSIT') return 'sev-high';
  if (status === 'CONFIRMED') return 'sev-medium';
  return 'sev-low';
}

export function PoSchedule({ detail }: { detail: ItemDetail }) {
  const orders = detail.purchaseOrders;
  const totalUnconfirmed = orders.reduce((sum, order) => sum + order.unconfirmedQty, 0);
  const delayedLines = orders.reduce(
    (sum, order) => sum + order.lines.filter((line) => line.status === 'DELAYED').length,
    0,
  );

  return (
    <div className='flex min-h-0 flex-col'>
      <div className='bg-muted/40 flex items-center gap-2 border-y px-3 py-1.5'>
        <span className='text-[11px] font-medium tracking-wide uppercase'>Supply schedule</span>
        <span className='text-muted-foreground text-[11px]'>
          {orders.length} open order{orders.length === 1 ? '' : 's'}
        </span>
        {totalUnconfirmed > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant='outline' className='h-4 cursor-help px-1 text-[10px] font-normal'>
                {formatNumber(totalUnconfirmed)} {detail.baseUom} unconfirmed
              </Badge>
            </TooltipTrigger>
            <TooltipContent className='max-w-xs'>
              Quantity the plan is netting against that no supplier has yet committed to a date for.
            </TooltipContent>
          </Tooltip>
        ) : null}
        {delayedLines > 0 ? (
          <Badge variant='outline' className='sev-critical h-4 gap-1 px-1 text-[10px] font-normal'>
            <TriangleAlert className='size-2.5' />
            {delayedLines} delayed
          </Badge>
        ) : null}
      </div>

      {orders.length === 0 ? (
        <p className='text-muted-foreground px-3 py-3 text-[11.5px]'>
          Nothing on order for this item — the plan is covering it from stock and from orders it is recommending.
        </p>
      ) : (
        <div className='divide-y'>
          {orders.map((order) => (
            <OrderBlock key={order.id} order={order} uom={detail.baseUom} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrderBlock({ order, uom }: { order: PurchaseOrderView; uom: string }) {
  const confirmedShare = order.totalQty > 0 ? order.confirmedQty / order.totalQty : 0;

  return (
    <div className='px-3 py-2'>
      <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
        <span className='mono text-[12.5px] font-semibold'>{order.id}</span>
        <Badge variant='outline' className='mono h-4 px-1 text-[9.5px] font-normal'>
          {order.type.replace(/_/g, ' ').toLowerCase()}
        </Badge>
        {order.vendorName ? <span className='text-muted-foreground text-[11.5px]'>{order.vendorName}</span> : null}
        <span className='text-muted-foreground text-[11.5px]'>
          total <span className='mono text-foreground'>{formatQty(order.totalQty, uom)}</span>
        </span>
        <span className='text-muted-foreground text-[11.5px]'>
          due <span className='mono text-foreground'>{formatDateShort(order.dueDate)}</span>
        </span>

        {/* Committed against ordered, as a bar rather than a second number —
            the ratio is the point, and a ratio reads faster than a fraction. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className='ml-auto flex cursor-help items-center gap-1.5'>
              <span className='bg-muted h-1.5 w-16 overflow-hidden rounded-full'>
                <span className='bg-primary block h-full' style={{ width: `${Math.round(confirmedShare * 100)}%` }} />
              </span>
              <span className='mono text-muted-foreground text-[10.5px]'>
                {Math.round(confirmedShare * 100)}% committed
              </span>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {formatQty(order.confirmedQty, uom)} confirmed, in transit or received of {formatQty(order.totalQty, uom)}{' '}
            ordered
          </TooltipContent>
        </Tooltip>
      </div>

      <table className='mt-1.5 w-full text-[12px]'>
        <thead>
          <tr className='text-muted-foreground'>
            <th className='grid-head w-[74px] text-left'>Delivery</th>
            <th className='grid-head w-[100px] text-right'>Qty</th>
            <th className='grid-head w-[86px] text-left'>Planned</th>
            <th className='grid-head w-[86px] text-left'>Confirmed</th>
            <th className='grid-head w-[86px] text-left'>Expected</th>
            <th className='grid-head text-left'>Inbound status</th>
            <th className='grid-head w-[34px]' />
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => (
            <tr key={line.line} className='grid-row'>
              <td className='grid-cell mono'>{line.line}</td>
              <td className='grid-cell num'>{formatNumber(line.qty)}</td>
              <td className='grid-cell mono'>{formatDateShort(line.plannedDate)}</td>
              <td className='grid-cell mono'>
                {line.confirmedDate ? (
                  <span className={cn(line.slipDays > 0 && 'text-destructive font-medium')}>
                    {formatDateShort(line.confirmedDate)}
                  </span>
                ) : (
                  <span className='text-muted-foreground/50'>—</span>
                )}
              </td>
              <td className='grid-cell mono'>{formatDateShort(line.expectedDate)}</td>
              <td className='grid-cell'>
                <div className='flex items-center gap-2'>
                  <Badge variant='outline' className={cn('h-4 px-1 text-[10px] font-normal', statusClass(line.status))}>
                    {STATUS_LABEL[line.status]}
                  </Badge>
                  <PipelineTrack status={line.status} />
                  {line.slipDays > 0 ? (
                    <span className='text-destructive text-[11px]'>
                      +{line.slipDays}d against the date the plan uses
                    </span>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Four dots: how far along the inbound pipeline this drop has actually got. */
function PipelineTrack({ status }: { status: DeliveryLineView['status'] }) {
  const stage = STAGE_OF[status];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='flex cursor-help items-center gap-[3px]' aria-label={`${PIPELINE[stage]?.label ?? ''} stage`}>
          {PIPELINE.map((step, index) => (
            <span
              key={step.status}
              className={cn(
                'h-1 w-3 rounded-full',
                index <= stage ? (status === 'DELAYED' ? 'bg-destructive/70' : 'bg-primary') : 'bg-muted-foreground/20',
              )}
            />
          ))}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className='space-y-0.5 text-[11.5px]'>
          {PIPELINE.map((step, index) => (
            <div key={step.status} className={cn(index > stage && 'text-muted-foreground')}>
              {index <= stage ? '●' : '○'} {step.label}
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
