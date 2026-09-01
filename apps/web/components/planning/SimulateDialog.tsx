'use client';

/**
 * Screen 7 — simulate, then override.
 *
 * One parameter, changed, with the consequence shown before anything is
 * committed. Both sides are genuine planning runs, so what is compared is what
 * would actually happen rather than an estimate of it.
 *
 * The override half is deliberately heavier than the simulation half: a reason
 * is mandatory, the before and after are always shown, and the dialog says out
 * loud that nothing is written back to the system of record. Decision support,
 * not a black box.
 */

import { REASON_CODES } from '@repo/domain';
import { Button } from '@repo/ui/components/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@repo/ui/components/dialog';
import { cn } from '@repo/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import type { MaterialDetail, SimulationView } from '@/lib/api-types';

const FIELDS = [
  { field: 'leadTimeDays', label: 'Total planning lead time', uom: 'days' },
  { field: 'safetyStock', label: 'Safety stock', uom: null },
  { field: 'minLotSize', label: 'Minimum order quantity', uom: null },
  { field: 'roundingValue', label: 'Rounding value', uom: null },
  { field: 'maxLotSize', label: 'Maximum lot', uom: null },
  { field: 'qaQuarantineDays', label: 'Quality inspection', uom: 'days' },
] as const;

export function SimulateDialog({ detail }: { detail: MaterialDetail }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<string>('leadTimeDays');
  const [value, setValue] = useState<string>('');
  const [reasonCode, setReasonCode] = useState<string>('');
  const [note, setNote] = useState('');

  const current = detail.parameters.find((row) => row.field === field);
  // The measured lead time is the change worth trying first, so it is offered
  // rather than left for the planner to type from another screen.
  const suggestion =
    field === 'leadTimeDays' && detail.fences.measured ? String(detail.fences.measured.totalDays) : null;

  const parsed = value === '' ? null : Number(value);
  const valid = value === '' || Number.isFinite(parsed);

  const simulation = useQuery({
    queryKey: ['simulate', detail.itemId, detail.plantId, field, value],
    enabled: open && value !== '' && valid,
    queryFn: async (): Promise<SimulationView> => {
      const params = new URLSearchParams({ field, value });
      const response = await fetch(
        `/api/material/${encodeURIComponent(detail.itemId)}/${encodeURIComponent(detail.plantId)}/simulate?${params}`,
      );
      if (!response.ok) throw new Error('That change could not be simulated.');
      return response.json();
    },
  });

  const commit = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/material/${encodeURIComponent(detail.itemId)}/${encodeURIComponent(detail.plantId)}/simulate`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ field, value: parsed, reasonCode, note }),
        },
      );
      if (!response.ok) throw new Error((await response.json()).error ?? 'The override was not applied.');
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      toast.success('Override recorded', {
        description: 'Scoped to this material, attributed, and logged with its reason. Nothing was written back.',
      });
      setOpen(false);
      setValue('');
      setReasonCode('');
      setNote('');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant='outline' size='sm' className='h-8 text-[13px]'>
          Simulate a change
        </Button>
      </DialogTrigger>
      <DialogContent className='max-h-[86vh] overflow-y-auto sm:max-w-[720px]'>
        <DialogHeader>
          <DialogTitle className='text-[15px]'>
            Simulate — {detail.itemId} at {detail.plantId}
          </DialogTitle>
        </DialogHeader>

        <div className='grid grid-cols-[200px_1fr] items-end gap-3'>
          <label className='block'>
            <span className='text-muted-foreground mb-1 block text-[12px]'>Parameter</span>
            <select
              value={field}
              onChange={(event) => {
                setField(event.target.value);
                setValue('');
              }}
              className='border-input bg-background h-9 w-full rounded-md border px-2 text-[13px]'
            >
              {FIELDS.map((row) => (
                <option key={row.field} value={row.field}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>

          <div className='flex items-end gap-3'>
            <div>
              <span className='text-muted-foreground mb-1 block text-[12px]'>Maintained</span>
              <p className='h-9 text-[15px] leading-9 font-medium tabular-nums'>{current?.maintained ?? '—'}</p>
            </div>
            <ArrowRight className='text-muted-foreground mb-2.5 size-4' />
            <label className='block flex-1'>
              <span className='text-muted-foreground mb-1 block text-[12px]'>Simulate at</span>
              <input
                value={value}
                onChange={(event) => setValue(event.target.value)}
                inputMode='decimal'
                placeholder={current?.maintained ?? ''}
                className={cn(
                  'border-input bg-background h-9 w-full rounded-md border px-2 text-[13px] tabular-nums',
                  !valid && 'border-status-critical',
                )}
              />
            </label>
            {suggestion ? (
              <Button variant='ghost' size='sm' className='mb-0.5 h-8 text-[12px]' onClick={() => setValue(suggestion)}>
                Use measured ({suggestion} d)
              </Button>
            ) : null}
          </div>
        </div>

        {simulation.data ? (
          <div className='mt-4 rounded-lg border'>
            <div className='bg-surface-sunken grid grid-cols-[1fr_140px_140px_120px] gap-2 border-b px-4 py-2'>
              <span className='grid-head'>Effect</span>
              <span className='grid-head text-right'>Now</span>
              <span className='grid-head text-right'>Simulated</span>
              <span className='grid-head text-right'>Change</span>
            </div>
            {simulation.data.metrics.map((metric) => (
              <div
                key={metric.label}
                className='grid-row grid grid-cols-[1fr_140px_140px_120px] items-baseline gap-2 px-4 py-2'
              >
                <span className='text-[13px]'>{metric.label}</span>
                <span className='text-right text-[13px] tabular-nums'>{metric.before}</span>
                <span
                  className={cn(
                    'text-right text-[13px] font-medium tabular-nums',
                    metric.direction === 'WORSE' && 'text-status-critical',
                    metric.direction === 'BETTER' && 'text-status-settled',
                  )}
                >
                  {metric.after}
                </span>
                <span className='text-muted-foreground text-right text-[11px]'>
                  {metric.direction === 'SAME' ? 'unchanged' : metric.delta}
                </span>
              </div>
            ))}
            <p className='text-muted-foreground border-t px-4 py-2 text-[11px]'>
              Both sides are full planning runs, computed in {simulation.data.elapsedMs} ms. The fence moves from{' '}
              {simulation.data.beforeFence.earliestReceiptWeek} to {simulation.data.afterFence.earliestReceiptWeek}.
            </p>
          </div>
        ) : value !== '' ? (
          <p className='text-muted-foreground mt-4 text-[13px]'>Re-planning…</p>
        ) : (
          <p className='text-muted-foreground mt-4 text-[13px]'>
            Enter a value to see the consequence before committing to it.
          </p>
        )}

        <div className='mt-4 border-t pt-4'>
          <div className='grid grid-cols-[220px_1fr] gap-3'>
            <label className='block'>
              <span className='text-muted-foreground mb-1 block text-[12px]'>Reason (required to override)</span>
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
            <label className='block'>
              <span className='text-muted-foreground mb-1 block text-[12px]'>Note</span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder='Free text, alongside the code and never instead of it'
                className='border-input bg-background h-9 w-full rounded-md border px-2 text-[13px]'
              />
            </label>
          </div>

          <div className='mt-4 flex items-center justify-between gap-4'>
            <p className='text-muted-foreground text-[11px] leading-snug'>
              An override is scoped to this material, dated, attributed and logged with its before and after. It never
              silently changes the system of record — write-back is a separate, governed action.
            </p>
            <Button
              size='sm'
              className='h-8 shrink-0 text-[13px]'
              disabled={!simulation.data || !reasonCode || commit.isPending}
              onClick={() => commit.mutate()}
            >
              {commit.isPending ? 'Applying…' : 'Apply override'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
