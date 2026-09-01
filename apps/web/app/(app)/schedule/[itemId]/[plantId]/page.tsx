'use client';

/**
 * Screen 3 — the supply timeline and the purchase-order schedule builder.
 *
 * Two halves. Above, the inbound timeline: every open order, every schedule
 * line, the stage it has reached and the slip against what was asked for.
 * Below, the builder: the ideal schedule beside the committable one, with a
 * ledger that attributes every unit of difference to a named constraint.
 *
 * The ledger is the part that decides whether a planner trusts any of this, so
 * it is given the width and placed where it is read after the numbers rather
 * than before them.
 */

import { formatDateFull, formatNumber, REASON_CODES } from '@repo/domain';
import { Button } from '@repo/ui/components/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@repo/ui/components/dialog';
import { Skeleton } from '@repo/ui/components/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { cn } from '@repo/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import type { DeliveryLineView, ScheduleBuilderView, ScheduleLineView } from '@/lib/api-types';
import { TierBadge } from '@/components/planning/TierBadge';

export default function SchedulePage() {
  const params = useParams<{ itemId: string; plantId: string }>();
  const itemId = decodeURIComponent(params.itemId);
  const plantId = decodeURIComponent(params.plantId);
  const [editing, setEditing] = useState<DeliveryLineView | null>(null);

  const query = useQuery({
    queryKey: ['schedule', itemId, plantId],
    queryFn: async (): Promise<ScheduleBuilderView> => {
      const response = await fetch(`/api/schedule/${encodeURIComponent(itemId)}/${encodeURIComponent(plantId)}`);
      if (!response.ok) throw new Error('That schedule could not be built.');
      return response.json();
    },
  });

  if (!query.data) {
    return (
      <Shell>
        <Skeleton className='h-8 w-96' />
        <Skeleton className='mt-6 h-[240px] rounded-lg' />
        <Skeleton className='mt-6 h-[420px] rounded-lg' />
      </Shell>
    );
  }

  const view = query.data;

  return (
    <Shell>
      <Link
        href={`/material/${encodeURIComponent(itemId)}/${encodeURIComponent(plantId)}`}
        className='text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-[12px]'
      >
        <ArrowLeft className='size-3.5' />
        {itemId}
      </Link>

      <header className='mb-5'>
        <h1 className='text-[20px] font-semibold tracking-tight'>Delivery schedule — {view.description}</h1>
        <p className='text-muted-foreground mt-1 text-[13px]'>
          {view.itemId} · {view.plantId} · {view.vendorName ?? view.vendorId ?? 'no approved source'} ·{' '}
          {view.window.fromWeek} to {view.window.toWeek} ({view.window.days} days) · {view.window.reason}
        </p>
      </header>

      <InboundTimeline view={view} onEdit={setEditing} />

      <Builder view={view} />

      {editing ? (
        <EditLineDialog
          line={editing}
          itemId={itemId}
          plantId={plantId}
          uom={view.baseUom}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className='mx-auto max-w-[1680px] px-6 py-6'>{children}</div>;
}

/**
 * The inbound timeline.
 *
 * Each line's state along the pipeline, and where it is late, the delay in days
 * *and* in days of cover — because a five-day delay on a fast mover and a
 * five-day delay on a slow one are not the same event.
 */
function InboundTimeline({ view, onEdit }: { view: ScheduleBuilderView; onEdit: (line: DeliveryLineView) => void }) {
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
                    <td className='grid-cell text-right'>
                      {line.editable ? (
                        <button
                          type='button'
                          onClick={() => onEdit(line)}
                          className='text-primary text-[12px] font-medium hover:underline'
                        >
                          Move
                        </button>
                      ) : null}
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

/** The two schedules and the reconciliation between them. */
function Builder({ view }: { view: ScheduleBuilderView }) {
  return (
    <section className='mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.55fr_1fr]'>
      <div className='bg-card rounded-lg border'>
        <div className='border-b px-5 py-3'>
          <h2 className='text-[14px] font-semibold'>Ideal against committable</h2>
          <p className='text-muted-foreground text-[12px]'>
            The left column is the statement of need. The right is what can actually be asked for, given everything that
            is true. All quantities in {view.baseUom}.
          </p>
        </div>

        <div className='overflow-x-auto'>
          <table className='w-full min-w-[840px]'>
            <thead>
              <tr className='bg-surface-sunken border-b'>
                <Th>Line</Th>
                <Th>Delivery</Th>
                <Th>Dispatch by</Th>
                <Th align='right'>Requirement</Th>
                <Th align='right'>Ideal</Th>
                <Th align='right'>Committed</Th>
                <Th align='right'>Δ</Th>
                <Th align='right'>Balance after</Th>
                <Th>Constraint that moved it</Th>
              </tr>
            </thead>
            <tbody>
              {view.lines.map((line) => (
                <ScheduleRow key={line.line} line={line} safetyStock={view.safetyStock} />
              ))}
              <tr className='bg-surface-sunken font-medium'>
                <td className='grid-cell' colSpan={4}>
                  Total
                </td>
                <td className='grid-cell num'>{formatNumber(view.totals.ideal)}</td>
                <td className='grid-cell num'>{formatNumber(view.totals.committed)}</td>
                <td className={cn('grid-cell num', view.totals.delta !== 0 && 'text-status-critical')}>
                  {view.totals.delta === 0 ? '0' : formatNumber(view.totals.delta)}
                </td>
                <td className='grid-cell' colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>

        <p className='text-muted-foreground border-t px-5 py-2.5 text-[11px]'>
          The two totals match: constraints move quantity between weeks, they do not quietly delete it. Opening balance{' '}
          {formatNumber(view.openingBalance)} {view.baseUom}, safety stock {formatNumber(view.safetyStock)}.
        </p>
      </div>

      <div className='space-y-5'>
        <div className='bg-card rounded-lg border'>
          <div className='border-b px-5 py-3'>
            <h2 className='text-[14px] font-semibold'>The ledger</h2>
            <p className='text-muted-foreground text-[12px]'>Every unit of difference, attributed.</p>
          </div>
          <ul className='divide-border divide-y'>
            {view.ledger.map((entry, index) => (
              <li key={index} className='px-5 py-3 text-[13px] leading-relaxed'>
                {entry}
              </li>
            ))}
          </ul>

          {view.options.length > 0 ? (
            <div className='border-t px-5 py-3'>
              <p className='text-muted-foreground mb-1.5 text-[11px] font-medium tracking-[0.03em] uppercase'>
                Ways to close the residual
              </p>
              <ol className='space-y-1.5 text-[12px] leading-relaxed'>
                {view.options.map((option, index) => (
                  <li key={index} className='flex gap-2'>
                    <span className='text-muted-foreground shrink-0'>{index + 1}.</span>
                    <span>{option}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>

        <div className='bg-card rounded-lg border'>
          <div className='border-b px-5 py-3'>
            <h2 className='text-[14px] font-semibold'>Constraints</h2>
            <p className='text-muted-foreground text-[12px]'>
              Shown whether or not they bound — a constraint that did not bind is a fact worth knowing.
            </p>
          </div>
          <ul className='divide-border divide-y'>
            {view.constraints.map((constraint) => (
              <li key={constraint.key} className='px-5 py-2.5'>
                <div className='flex items-baseline justify-between gap-3'>
                  <span
                    className={cn(
                      'text-[13px]',
                      constraint.binding ? 'text-status-critical font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {constraint.label}
                  </span>
                  <span className='flex items-baseline gap-2'>
                    {constraint.value !== null ? (
                      <span className='text-[12px] tabular-nums'>{formatNumber(constraint.value)}</span>
                    ) : null}
                    <span
                      className={cn(
                        'rounded px-1.5 py-px text-[10px] font-medium',
                        constraint.binding
                          ? 'bg-status-critical/12 text-status-critical'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {constraint.binding ? 'binds' : 'slack'}
                    </span>
                  </span>
                </div>
                <p className='text-muted-foreground mt-0.5 text-[11px] leading-snug'>{constraint.note}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function ScheduleRow({ line, safetyStock }: { line: ScheduleLineView; safetyStock: number }) {
  const below = line.balanceAfter < safetyStock;
  return (
    <tr className='grid-row'>
      <td className='grid-cell num'>{line.line}</td>
      <td className='grid-cell text-[12px]'>
        <span className='font-medium'>{line.week}</span>
        <span className='text-muted-foreground ml-1.5'>{line.date.slice(5)}</span>
        {line.insideFence ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertTriangle className='text-status-critical ml-1.5 inline size-3 align-[-1px]' />
            </TooltipTrigger>
            <TooltipContent className='max-w-[280px]'>
              Required {line.unreachableByDays} days before a newly placed order could arrive. The date is left where it
              is rather than pushed out, because knowing it is impossible in time is the whole point.
            </TooltipContent>
          </Tooltip>
        ) : null}
      </td>
      <td className='text-muted-foreground grid-cell text-[12px]'>{line.dispatchDate.slice(5)}</td>
      <td className='text-muted-foreground grid-cell num'>{formatNumber(line.requirement)}</td>
      <td className='grid-cell num'>
        {formatNumber(line.idealQty)}
        {line.lotSizingAddition > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className='text-muted-foreground ml-1 cursor-help text-[10px]'>
                +{formatNumber(line.lotSizingAddition)}
              </span>
            </TooltipTrigger>
            <TooltipContent className='max-w-[280px]'>
              {formatNumber(line.needQty)} is requirement; {formatNumber(line.lotSizingAddition)} was added by a
              lot-sizing rule. Need and rule are never merged.
            </TooltipContent>
          </Tooltip>
        ) : null}
      </td>
      <td className='grid-cell num font-medium'>{line.committedQty === 0 ? '—' : formatNumber(line.committedQty)}</td>
      <td
        className={cn(
          'grid-cell num',
          line.delta < 0 && 'text-status-critical',
          line.delta > 0 && 'text-status-settled',
        )}
      >
        {line.delta === 0 ? '0' : `${line.delta > 0 ? '+' : ''}${formatNumber(line.delta)}`}
      </td>
      <td className={cn('grid-cell num', below && 'text-status-attention font-medium')}>
        {formatNumber(line.balanceAfter)}
      </td>
      <td className='text-muted-foreground grid-cell max-w-[280px] text-[11px] leading-snug'>
        {line.constraintLabel ? (
          <>
            <span className='text-foreground font-medium'>{line.constraintLabel}</span>
            {line.note ? ` — ${line.note}` : ''}
          </>
        ) : (
          '—'
        )}
      </td>
    </tr>
  );
}

/**
 * Moving one line.
 *
 * A reason is mandatory. Re-dating a line also clears the vendor's
 * acknowledgement, because asking for a new date does not mean the vendor has
 * agreed to it — and pretending otherwise is exactly the rosy picture this
 * product exists to remove.
 */
function EditLineDialog({
  line,
  itemId,
  plantId,
  uom,
  onClose,
}: {
  line: DeliveryLineView;
  itemId: string;
  plantId: string;
  uom: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [qty, setQty] = useState(String(line.qty));
  const [date, setDate] = useState(line.expectedDate);
  const [reasonCode, setReasonCode] = useState('PLANNER_PULL_IN');
  const [note, setNote] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/schedule/${encodeURIComponent(itemId)}/${encodeURIComponent(plantId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderId: line.orderId,
          line: line.line,
          qty: Number(qty),
          date,
          reasonCode,
          note,
          before: `${line.qty} ${uom} on ${line.expectedDate}`,
        }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? 'The line was not moved.');
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      toast.success('Schedule line updated', {
        description: 'Recorded with its reason. The vendor has not agreed to the new date until they acknowledge it.',
      });
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className='sm:max-w-[520px]'>
        <DialogHeader>
          <DialogTitle className='text-[15px]'>
            {line.orderId} · line {line.line}
          </DialogTitle>
        </DialogHeader>

        <p className='text-muted-foreground text-[12px]'>
          Currently {formatNumber(line.qty)} {uom} on {formatDateFull(line.expectedDate)}, requested for{' '}
          {formatDateFull(line.requestedDate)}.
        </p>

        <div className='mt-3 grid grid-cols-2 gap-3'>
          <label className='block'>
            <span className='text-muted-foreground mb-1 block text-[12px]'>Quantity ({uom})</span>
            <input
              value={qty}
              onChange={(event) => setQty(event.target.value)}
              inputMode='numeric'
              className='border-input bg-background h-9 w-full rounded-md border px-2 text-[13px] tabular-nums'
            />
          </label>
          <label className='block'>
            <span className='text-muted-foreground mb-1 block text-[12px]'>Requested delivery date</span>
            <input
              type='date'
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className='border-input bg-background h-9 w-full rounded-md border px-2 text-[13px]'
            />
          </label>
        </div>

        <label className='mt-3 block'>
          <span className='text-muted-foreground mb-1 block text-[12px]'>Reason (required)</span>
          <select
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value)}
            className='border-input bg-background h-9 w-full rounded-md border px-2 text-[13px]'
          >
            {REASON_CODES.map((row) => (
              <option key={row.code} value={row.code}>
                {row.label}
              </option>
            ))}
          </select>
        </label>

        <label className='mt-3 block'>
          <span className='text-muted-foreground mb-1 block text-[12px]'>Note</span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder='What the vendor said, in ten seconds'
            className='border-input bg-background h-9 w-full rounded-md border px-2 text-[13px]'
          />
        </label>

        <p className='text-muted-foreground mt-3 text-[11px] leading-snug'>
          Moving a line clears the vendor&rsquo;s acknowledgement. Asking for a new date is not the same as being given
          one, and the plan will treat it as unconfirmed until they say otherwise.
        </p>

        <div className='mt-4 flex justify-end gap-2'>
          <Button variant='ghost' size='sm' className='h-8 text-[13px]' onClick={onClose}>
            Cancel
          </Button>
          <Button size='sm' className='h-8 text-[13px]' disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Record the change'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={cn('grid-head', align === 'right' ? 'text-right' : 'text-left')}>{children}</th>;
}
