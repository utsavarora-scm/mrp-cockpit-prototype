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

import { LoadError } from '@/components/general/LoadError';
import type { MaterialDetail, SimulationView } from '@/lib/api-types';

const FIELDS = [
  { field: 'leadTimeDays', label: 'Total planning lead time', uom: 'days' },
  { field: 'safetyStock', label: 'Safety stock', uom: null },
  { field: 'minLotSize', label: 'Minimum order quantity', uom: null },
  { field: 'roundingValue', label: 'Rounding value', uom: null },
  { field: 'maxLotSize', label: 'Maximum lot', uom: null },
  { field: 'periodsOfSupplyDays', label: 'Fixed period, days', uom: 'days' },
  { field: 'grProcessingTimeDays', label: 'Goods receipt processing', uom: 'days' },
  { field: 'qaQuarantineDays', label: 'Quality inspection', uom: 'days' },
  // Not master-data numbers. §7.7 asks for these by name, and a simulation
  // that can only move a lead time can only rehearse one kind of argument.
  { field: 'lotSizeRule', label: 'Lot-sizing policy', uom: null },
  { field: 'demand', label: 'Demand in a week', uom: null },
] as const;

const LOT_RULES = [
  { value: 'LFL', label: 'Lot for lot — order exactly what is needed' },
  { value: 'FOQ', label: 'Fixed order quantity' },
  { value: 'POQ', label: 'Fixed period — one order per campaign' },
  { value: 'MINMAX', label: 'Min–max' },
  { value: 'EOQ', label: 'Economic order quantity' },
] as const;

export function SimulateDialog({ detail }: { detail: MaterialDetail }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<string>('leadTimeDays');
  const [value, setValue] = useState<string>('');
  const [reasonCode, setReasonCode] = useState<string>('');
  // Scoped, dated and expiring, which is what an override has to be to be
  // auditable. Day offsets from the planning date: 0 is this run.
  const [effectiveFromDay, setEffectiveFromDay] = useState('0');
  const [expiresOnDay, setExpiresOnDay] = useState('');
  const [note, setNote] = useState('');

  const current = detail.parameters.find((row) => row.field === field);
  // The measured lead time is the change worth trying first, so it is offered
  // rather than left for the planner to type from another screen.
  const suggestion =
    field === 'leadTimeDays' && detail.fences.measured ? String(detail.fences.measured.totalDays) : null;

  // Which week the demand change applies to. Weekly, because a planner argues
  // about a week's requirement and never about a Tuesday's.
  const weeks = detail.buckets.filter(
    (bucket, index) => detail.buckets.findIndex((row) => row.week === bucket.week) === index,
  );
  const [demandWeek, setDemandWeek] = useState<string>(weeks[1]?.week ?? weeks[0]?.week ?? '');

  const isPolicy = field === 'lotSizeRule';
  const isDemand = field === 'demand';

  const parsed = value === '' ? null : Number(value);
  const valid = value === '' || isPolicy || Number.isFinite(parsed);

  const simulation = useQuery({
    queryKey: ['simulate', detail.itemId, detail.plantId, field, value, demandWeek],
    enabled: open && value !== '' && valid,
    queryFn: async (): Promise<SimulationView> => {
      const params = new URLSearchParams({ field, value });
      if (isDemand) {
        const days = detail.buckets.filter((bucket) => bucket.week === demandWeek);
        const first = days[0];
        const last = days[days.length - 1];
        const planningDate = detail.header.planningDate;
        const dayOf = (date: string): number => Math.round((Date.parse(date) - Date.parse(planningDate)) / 86_400_000);
        params.set('fromDay', String(dayOf(first?.startDate ?? planningDate)));
        params.set('toDay', String(dayOf(last?.endDate ?? planningDate)));
      }
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
          body: JSON.stringify({
            field,
            value: parsed,
            reasonCode,
            note,
            effectiveFromDay: Number(effectiveFromDay) || 0,
            expiresOnDay: expiresOnDay === '' ? null : Number(expiresOnDay),
          }),
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
              <span className='text-muted-foreground mb-1 block text-[12px]'>
                {isPolicy ? 'Today' : isDemand ? 'Week' : 'Maintained'}
              </span>
              {isDemand ? (
                <select
                  value={demandWeek}
                  onChange={(event) => setDemandWeek(event.target.value)}
                  className='border-input bg-background h-9 rounded-md border px-2 text-[13px]'
                >
                  {weeks.slice(0, 26).map((bucket) => (
                    <option key={bucket.week} value={bucket.week}>
                      {bucket.week}
                    </option>
                  ))}
                </select>
              ) : (
                <p className='h-9 text-[15px] leading-9 font-medium tabular-nums'>
                  {isPolicy
                    ? (detail.parameters.find((row) => row.field === 'lotSizeRule')?.maintained ?? '—')
                    : (current?.maintained ?? '—')}
                </p>
              )}
            </div>
            <ArrowRight className='text-muted-foreground mb-2.5 size-4' />
            <label className='block flex-1'>
              <span className='text-muted-foreground mb-1 block text-[12px]'>Simulate at</span>
              {isPolicy ? (
                <select
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  className='border-input bg-background h-9 w-full rounded-md border px-2 text-[13px]'
                >
                  <option value=''>Choose a policy…</option>
                  {LOT_RULES.map((rule) => (
                    <option key={rule.value} value={rule.value}>
                      {rule.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  inputMode='decimal'
                  placeholder={isDemand ? `${demandWeek} requirement` : (current?.maintained ?? '')}
                  className={cn(
                    'border-input bg-background h-9 w-full rounded-md border px-2 text-[13px] tabular-nums',
                    !valid && 'border-status-critical',
                  )}
                />
              )}
            </label>
            {suggestion ? (
              <Button variant='ghost' size='sm' className='mb-0.5 h-8 text-[12px]' onClick={() => setValue(suggestion)}>
                Use measured ({suggestion} d)
              </Button>
            ) : null}
          </div>
          {isDemand ? (
            <p className='text-muted-foreground mt-2 text-[11px] leading-snug'>
              Demand is a simulation only — it is what the plan is being asked to cover, not a parameter this screen
              maintains, so there is nothing here to override.
            </p>
          ) : null}
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
            {/* The payload has carried both curves since it was written and
                nothing drew them. A table of deltas answers "how much"; the
                chart is what answers "where". */}
            <BeforeAfterChart data={simulation.data} />
            <p className='text-muted-foreground border-t px-4 py-2 text-[11px]'>
              Both sides are full planning runs, computed in {simulation.data.elapsedMs} ms. The fence moves from{' '}
              {simulation.data.beforeFence.earliestReceiptWeek} to {simulation.data.afterFence.earliestReceiptWeek}.
            </p>
          </div>
        ) : simulation.isError ? (
          <div className='mt-4'>
            <LoadError
              message='That change could not be simulated.'
              detail='Nothing has been committed. Try again, or change the value.'
              onRetry={() => void simulation.refetch()}
              retrying={simulation.isFetching}
            />
          </div>
        ) : value !== '' && !valid ? (
          <p className='text-muted-foreground mt-4 text-[13px]'>Enter a number to see the consequence.</p>
        ) : value !== '' ? (
          <p className='text-muted-foreground mt-4 text-[13px]'>Re-planning…</p>
        ) : (
          <p className='text-muted-foreground mt-4 text-[13px]'>
            Enter a value to see the consequence before committing to it.
          </p>
        )}

        <div className='mt-4 border-t pt-4'>
          <div className='mb-3 grid grid-cols-2 gap-3'>
            <label className='block'>
              <span className='text-muted-foreground mb-1 block text-[12px]'>Applies from (days from today)</span>
              <input
                value={effectiveFromDay}
                onChange={(event) => setEffectiveFromDay(event.target.value)}
                inputMode='numeric'
                className='border-input bg-background h-9 w-full rounded-md border px-2 text-[13px] tabular-nums'
              />
            </label>
            <label className='block'>
              <span className='text-muted-foreground mb-1 block text-[12px]'>Expires after (blank = no end)</span>
              <input
                value={expiresOnDay}
                onChange={(event) => setExpiresOnDay(event.target.value)}
                inputMode='numeric'
                placeholder='open-ended'
                className='border-input bg-background h-9 w-full rounded-md border px-2 text-[13px] tabular-nums'
              />
            </label>
          </div>
          {Number(effectiveFromDay) > 0 ? (
            <p className='text-muted-foreground mb-3 text-[11px] leading-snug'>
              A run is a snapshot of one day, so an override that starts later is recorded and shown as pending — it
              does not change this plan until its window opens.
            </p>
          ) : null}

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
              disabled={!simulation.data || !reasonCode || commit.isPending || isDemand}
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

/**
 * The two balance curves, drawn against each other.
 *
 * Deliberately small and deliberately unlabelled beyond its ends: the question
 * it answers is *where* the plan moved, not by how much — the table above
 * already says that, and a second set of numbers here would compete with it.
 */
function BeforeAfterChart({ data }: { data: SimulationView }) {
  const points = data.beforeBalance.length;
  if (points < 2) return null;

  const values = [...data.beforeBalance, ...data.afterBalance];
  const top = Math.max(...values, 0);
  const bottom = Math.min(...values, 0);
  const span = top - bottom || 1;

  const path = (series: number[]): string =>
    series
      .map((value, index) => {
        const x = (index / (points - 1)) * 100;
        const y = 100 - ((value - bottom) / span) * 100;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');

  const zero = 100 - ((0 - bottom) / span) * 100;

  return (
    <div className='border-t px-4 py-3'>
      <div className='mb-1.5 flex items-baseline justify-between'>
        <span className='text-muted-foreground text-[11px] font-medium tracking-[0.03em] uppercase'>
          Projected balance
        </span>
        <span className='text-muted-foreground text-[11px]'>
          <span className='text-foreground'>——</span> now · <span className='text-primary'>——</span> simulated
        </span>
      </div>
      <svg
        viewBox='0 0 100 100'
        preserveAspectRatio='none'
        className='h-24 w-full'
        role='img'
        aria-label='Projected balance before and after the change'
      >
        {bottom < 0 ? (
          <line
            x1='0'
            y1={zero}
            x2='100'
            y2={zero}
            stroke='currentColor'
            strokeWidth='0.4'
            className='text-destructive/50'
          />
        ) : null}
        <path
          d={path(data.beforeBalance)}
          fill='none'
          stroke='currentColor'
          strokeWidth='1'
          vectorEffect='non-scaling-stroke'
          className='text-muted-foreground'
        />
        <path
          d={path(data.afterBalance)}
          fill='none'
          stroke='currentColor'
          strokeWidth='1.5'
          vectorEffect='non-scaling-stroke'
          className='text-primary'
        />
      </svg>
      <div className='text-muted-foreground mt-1 flex justify-between text-[10px]'>
        <span>{data.bucketLabels[0]}</span>
        <span>{data.bucketLabels[data.bucketLabels.length - 1]}</span>
      </div>
    </div>
  );
}
