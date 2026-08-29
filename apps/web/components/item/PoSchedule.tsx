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
import { Button } from '@repo/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/dialog';
import { Input } from '@repo/ui/components/input';
import { Label } from '@repo/ui/components/label';
import { Switch } from '@repo/ui/components/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { cn } from '@repo/ui/lib/utils';
import { Loader2, Pencil, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

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

export function PoSchedule({
  detail,
  onEdit,
  isSaving,
}: {
  detail: ItemDetail;
  onEdit: (edit: ScheduleEdit) => void;
  isSaving: boolean;
}) {
  const [editing, setEditing] = useState<{ order: PurchaseOrderView; line: DeliveryLineView } | null>(null);

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
            <OrderBlock
              key={order.id}
              order={order}
              uom={detail.baseUom}
              onEditLine={(line) => setEditing({ order, line })}
            />
          ))}
        </div>
      )}

      <EditScheduleDialog
        editing={editing}
        uom={detail.baseUom}
        isSaving={isSaving}
        onClose={() => setEditing(null)}
        onSave={(edit) => {
          onEdit(edit);
          setEditing(null);
        }}
      />
    </div>
  );
}

function OrderBlock({
  order,
  uom,
  onEditLine,
}: {
  order: PurchaseOrderView;
  uom: string;
  onEditLine: (line: DeliveryLineView) => void;
}) {
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
              <td className='grid-cell'>
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-5 w-5 p-0 opacity-50 hover:opacity-100'
                  onClick={() => onEditLine(line)}
                  aria-label={`Edit delivery ${line.line} of ${order.id}`}
                >
                  <Pencil className='size-3' />
                </Button>
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

function EditScheduleDialog({
  editing,
  uom,
  isSaving,
  onClose,
  onSave,
}: {
  editing: { order: PurchaseOrderView; line: DeliveryLineView } | null;
  uom: string;
  isSaving: boolean;
  onClose: () => void;
  onSave: (edit: ScheduleEdit) => void;
}) {
  const [date, setDate] = useState('');
  const [qty, setQty] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  // Re-seed the draft whenever a different line is opened.
  const [seededFor, setSeededFor] = useState<string | null>(null);

  const openKey = editing ? `${editing.order.id}#${editing.line.line}` : null;
  if (editing && seededFor !== openKey) {
    setSeededFor(openKey);
    setDate(editing.line.expectedDate);
    setQty(String(editing.line.qty));
    setConfirmed(editing.line.status !== 'PLANNED');
  }

  if (!editing) return null;
  const { order, line } = editing;
  const parsedQty = Number(qty);
  const isValid = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsedQty) && parsedQty > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-[420px]'>
        <DialogHeader>
          <DialogTitle className='text-[14px]'>
            Delivery {line.line} of <span className='mono'>{order.id}</span>
          </DialogTitle>
          <DialogDescription className='text-[12px]'>
            The plan re-runs on this change. Moving a drop out is a planning event, not a note.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-1'>
              <Label htmlFor='delivery-date' className='text-[11.5px]'>
                Delivery date
              </Label>
              <Input
                id='delivery-date'
                type='date'
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className='mono h-7 text-[12px]'
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='delivery-qty' className='text-[11.5px]'>
                Quantity <span className='text-muted-foreground'>({uom})</span>
              </Label>
              <Input
                id='delivery-qty'
                value={qty}
                onChange={(event) => setQty(event.target.value)}
                className='mono h-7 text-[12px]'
              />
            </div>
          </div>

          <div className='flex items-center justify-between rounded-[5px] border px-2.5 py-2'>
            <div>
              <div className='text-[12px] font-medium'>Supplier has confirmed</div>
              <p className='text-muted-foreground text-[11px]'>
                Confirmed quantity counts as supply that is genuinely coming.
              </p>
            </div>
            <Switch checked={confirmed} onCheckedChange={setConfirmed} aria-label='Supplier has confirmed' />
          </div>

          <div className='text-muted-foreground bg-muted/40 rounded-[5px] px-2.5 py-1.5 text-[11.5px]'>
            Currently {formatNumber(line.qty)} {uom} planned for {formatDateShort(line.plannedDate)}
            {line.confirmedDate ? `, confirmed for ${formatDateShort(line.confirmedDate)}` : ', not yet confirmed'}.
          </div>
        </div>

        <DialogFooter>
          <Button variant='ghost' size='sm' className='h-7 text-[12px]' onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            size='sm'
            className='h-7 gap-1.5 text-[12px]'
            disabled={!isValid || isSaving}
            onClick={() =>
              onSave({
                supplyElementId: order.id,
                line: line.line,
                newDate: date,
                newQty: parsedQty,
                confirmed,
              })
            }
          >
            {isSaving ? <Loader2 className='size-3 animate-spin' /> : null}
            Apply and re-plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
