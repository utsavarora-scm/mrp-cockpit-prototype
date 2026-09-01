'use client';

/**
 * Screen 6 — the exception queue.
 *
 * Grouped by what a planner would actually do about them, because a planner's
 * morning is a sequence of phone calls and not a taxonomy. The group that comes
 * first is the one nothing can be ordered for: knowing that in the first
 * minute is what stops three wasted calls.
 *
 * Every exception is dismissible with a reason, and dismissals are kept. A
 * recurring dismissal is itself a finding — it usually means a norm is wrong.
 */

import { formatCurrency, formatNumber, REASON_CODES } from '@repo/domain';
import { Button } from '@repo/ui/components/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@repo/ui/components/dialog';
import { Skeleton } from '@repo/ui/components/skeleton';
import { cn } from '@repo/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import type { ExceptionQueueView, ExceptionView } from '@/lib/api-types';
import { useViewState } from '@/lib/view-state';

export default function ExceptionsPage() {
  const { plantId } = useViewState();
  const [dismissing, setDismissing] = useState<ExceptionView | null>(null);

  const query = useQuery({
    queryKey: ['exceptions', plantId],
    queryFn: async (): Promise<ExceptionQueueView> => {
      const params = new URLSearchParams();
      if (plantId) params.set('plant', plantId);
      const response = await fetch(`/api/exceptions?${params.toString()}`);
      if (!response.ok) throw new Error('The queue could not be loaded.');
      return response.json();
    },
  });

  if (!query.data) {
    return (
      <Shell>
        <Skeleton className='h-8 w-72' />
        <Skeleton className='mt-6 h-[560px] rounded-lg' />
      </Shell>
    );
  }

  const view = query.data;

  return (
    <Shell>
      <header className='mb-5'>
        <h1 className='text-[20px] font-semibold tracking-tight'>Exceptions</h1>
        <p className='text-muted-foreground mt-1 max-w-4xl text-[13px] leading-relaxed'>
          {formatNumber(view.total)} open, grouped by what you would do about them rather than by type. Every one is a
          named condition on a number the run already computed — which is why every one can explain itself.
        </p>
      </header>

      <div className='space-y-5'>
        {view.groups.map((group) => (
          <section key={group.group} className='bg-card rounded-lg border'>
            <div className='flex flex-wrap items-baseline justify-between gap-3 border-b px-5 py-3'>
              <div>
                <h2 className='text-[14px] font-semibold'>{group.label}</h2>
                <p className='text-muted-foreground text-[12px]'>{group.note}</p>
              </div>
              <p className='text-muted-foreground text-[12px]'>
                {group.count} {group.count === 1 ? 'material' : 'materials'} ·{' '}
                <span className='text-foreground font-medium'>{formatCurrency(group.valueAtStake)}</span> at stake
              </p>
            </div>

            <ul className='divide-border divide-y'>
              {group.exceptions.map((exception) => (
                <li key={exception.id} className='px-5 py-3.5'>
                  <div className='flex flex-wrap items-baseline justify-between gap-3'>
                    <div className='flex-1'>
                      <p className='flex flex-wrap items-baseline gap-2'>
                        <Link
                          href={`/material/${encodeURIComponent(exception.itemId)}/${encodeURIComponent(exception.plantId)}`}
                          className='hover:text-primary font-mono text-[12px] font-medium hover:underline'
                        >
                          {exception.itemId}
                        </Link>
                        <span className='text-muted-foreground text-[11px]'>
                          {exception.plantId} · bites {exception.biteWeek} ({exception.biteDate.slice(5)}) ·{' '}
                          {exception.daysToBite} days out
                        </span>
                      </p>
                      <p className='mt-1 text-[13px] leading-relaxed'>{exception.headline}</p>
                    </div>

                    <div className='shrink-0 text-right'>
                      <p className='text-[15px] font-semibold tabular-nums'>{formatCurrency(exception.valueAtStake)}</p>
                      <p className='text-muted-foreground text-[11px]'>
                        {formatNumber(exception.qtyAtStake)} {exception.baseUom} · {exception.daysAtStake.toFixed(1)}{' '}
                        days of cover
                      </p>
                    </div>
                  </div>

                  {/* The arithmetic, inline. Nothing is a bare alert. */}
                  <div className='mt-2 flex flex-wrap gap-x-5 gap-y-1'>
                    {exception.operands.map((operand) => (
                      <span key={operand.label} className='text-muted-foreground text-[11px]'>
                        {operand.label}{' '}
                        <span className='text-foreground font-medium tabular-nums'>{formatNumber(operand.value)}</span>
                        <span className='text-muted-foreground/70'> ← {operand.source}</span>
                      </span>
                    ))}
                  </div>

                  {exception.actions.length > 0 ? (
                    <ul className='mt-2 space-y-0.5'>
                      {exception.actions.map((action) => (
                        <li key={action} className='text-[12px] leading-relaxed'>
                          <span className='text-muted-foreground mr-1.5'>·</span>
                          {action}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <div className='mt-2 flex items-center gap-3'>
                    <Link
                      href={`/schedule/${encodeURIComponent(exception.itemId)}/${encodeURIComponent(exception.plantId)}`}
                      className='text-primary text-[12px] font-medium hover:underline'
                    >
                      Build a schedule
                    </Link>
                    <button
                      type='button'
                      onClick={() => setDismissing(exception)}
                      className='text-muted-foreground hover:text-foreground text-[12px]'
                    >
                      Dismiss with a reason
                    </button>
                    <span
                      className={cn(
                        'ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium',
                        exception.severity === 'CRITICAL'
                          ? 'bg-status-critical/12 text-status-critical'
                          : exception.severity === 'HIGH'
                            ? 'bg-status-attention/15 text-status-attention'
                            : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {exception.severity.toLowerCase()}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {dismissing ? <DismissDialog exception={dismissing} onClose={() => setDismissing(null)} /> : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className='mx-auto max-w-[1680px] px-6 py-6'>{children}</div>;
}

function DismissDialog({ exception, onClose }: { exception: ExceptionView; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');

  const dismiss = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/exceptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: exception.id,
          itemId: exception.itemId,
          plantId: exception.plantId,
          reasonCode,
          note,
        }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? 'It was not dismissed.');
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      toast.success('Dismissed and recorded', {
        description: 'Kept rather than hidden — a recurring dismissal usually means a norm is wrong.',
      });
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className='sm:max-w-[520px]'>
        <DialogHeader>
          <DialogTitle className='text-[15px]'>Dismiss — {exception.itemId}</DialogTitle>
        </DialogHeader>
        <p className='text-muted-foreground text-[12px] leading-relaxed'>{exception.headline}</p>

        <label className='mt-3 block'>
          <span className='text-muted-foreground mb-1 block text-[12px]'>Reason (required)</span>
          <select
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value)}
            className='border-input bg-background h-9 w-full rounded-md border px-2 text-[13px]'
          >
            <option value=''>Choose a reason…</option>
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
            className='border-input bg-background h-9 w-full rounded-md border px-2 text-[13px]'
          />
        </label>

        <div className='mt-4 flex justify-end gap-2'>
          <Button variant='ghost' size='sm' className='h-8 text-[13px]' onClick={onClose}>
            Cancel
          </Button>
          <Button
            size='sm'
            className='h-8 text-[13px]'
            disabled={!reasonCode || dismiss.isPending}
            onClick={() => dismiss.mutate()}
          >
            {dismiss.isPending ? 'Recording…' : 'Dismiss'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
