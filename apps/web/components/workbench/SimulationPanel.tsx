'use client';

/**
 * The simulation result.
 *
 * Exceptions closed in one column, exceptions *created* in the other — always,
 * even when the list is empty, because the absence of new problems is itself
 * worth stating. Every real resolution moves a problem somewhere; showing only
 * the upside is what makes a demo feel like a sales deck.
 */

import { EXCEPTION_LABELS, formatCurrency, formatDays, formatNumber, formatPercent } from '@repo/domain';
import { Button } from '@repo/ui/components/button';
import { Skeleton } from '@repo/ui/components/skeleton';
import { cn } from '@repo/ui/lib/utils';
import { CheckCircle2, Loader2, TriangleAlert } from 'lucide-react';
import Link from 'next/link';

import type { ResolutionCard, SimulationDiff } from '@/lib/api-types';

export function SimulationPanel({
  diff,
  isSimulating,
  resolution,
  onCommit,
  isCommitting,
}: {
  diff: SimulationDiff | null;
  isSimulating: boolean;
  resolution: ResolutionCard | null;
  onCommit: () => void;
  isCommitting: boolean;
}) {
  if (isSimulating) {
    return (
      <div className='flex flex-col gap-2 p-3'>
        <div className='text-muted-foreground flex items-center gap-2 text-[12.5px]'>
          <Loader2 className='size-3.5 animate-spin' />
          Re-planning the whole network with this change applied…
        </div>
        <Skeleton className='h-32 w-full' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  if (!diff) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center'>
        <span className='text-[13px] font-medium'>Nothing simulated yet</span>
        <span className='text-muted-foreground text-[12px] leading-[18px]'>
          Pick a resolution and press Simulate. The engine clones the plan, applies the change and re-runs — you will
          see what it fixes and what it breaks.
        </span>
      </div>
    );
  }

  const netExposure = diff.kpiDelta.totalExposure;

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='bg-muted/40 sticky top-0 z-10 border-b px-3 py-1.5'>
        <div className='flex items-baseline justify-between'>
          <span className='text-[11px] font-medium tracking-wide uppercase'>Simulation result</span>
          <span className='mono text-muted-foreground text-[10.5px]'>
            re-planned in {Math.round(diff.elapsedMs)} ms
          </span>
        </div>
        <div className='text-muted-foreground truncate text-[10.5px]'>{diff.resolutionLabel}</div>
      </div>

      <div className='grid grid-cols-3 divide-x border-b'>
        <DeltaTile
          label='Exposure'
          value={formatCurrency(Math.abs(netExposure))}
          sign={netExposure}
          betterWhenNegative
        />
        <DeltaTile
          label='Exceptions'
          value={formatNumber(Math.abs(diff.kpiDelta.exceptionCount))}
          sign={diff.kpiDelta.exceptionCount}
          betterWhenNegative
        />
        <DeltaTile
          label='Fill rate'
          value={formatPercent(Math.abs(diff.kpiDelta.projectedFillRate), 2)}
          sign={diff.kpiDelta.projectedFillRate}
          betterWhenNegative={false}
        />
      </div>

      <div className='grid grid-cols-3 divide-x border-b'>
        <DeltaTile
          label='Inventory'
          value={formatCurrency(Math.abs(diff.kpiDelta.inventoryValue))}
          sign={diff.kpiDelta.inventoryValue}
          betterWhenNegative
        />
        <DeltaTile
          label='Days on hand'
          value={formatDays(Math.abs(diff.kpiDelta.daysOnHand))}
          sign={diff.kpiDelta.daysOnHand}
          betterWhenNegative
        />
        <DeltaTile
          label='Excess & obsolete'
          value={formatCurrency(Math.abs(diff.kpiDelta.excessObsoleteExposure))}
          sign={diff.kpiDelta.excessObsoleteExposure}
          betterWhenNegative
        />
      </div>

      <BeforeAfter diff={diff} />

      <div className='min-h-0 flex-1 overflow-auto'>
        <DiffList
          title='Resolved'
          tone='good'
          icon={<CheckCircle2 className='text-primary size-3.5' />}
          entries={diff.resolved}
          emptyMessage='This change closes nothing outright — it moves the plan without removing an exception.'
        />
        <DiffList
          title='Created'
          tone='bad'
          icon={<TriangleAlert className='text-destructive size-3.5' />}
          entries={diff.created}
          emptyMessage='Nothing new appears anywhere in the network as a result of this change.'
        />
        <div className='text-muted-foreground border-t px-3 py-2 text-[11.5px]'>
          {formatNumber(diff.unchanged)} exceptions elsewhere are unaffected.
        </div>
      </div>

      <div className='border-t p-2.5'>
        <Button className='w-full gap-1.5' size='sm' onClick={onCommit} disabled={isCommitting || !resolution}>
          {isCommitting ? <Loader2 className='size-3.5 animate-spin' /> : null}
          Commit — show the writeback payloads
        </Button>
        <p className='text-muted-foreground mt-1 text-center text-[10.5px]'>
          Committing changes this plan. It contacts nothing.
        </p>
      </div>
    </div>
  );
}

function DeltaTile({
  label,
  value,
  sign,
  betterWhenNegative,
}: {
  label: string;
  value: string;
  sign: number;
  betterWhenNegative: boolean;
}) {
  const neutral = Math.abs(sign) < 1e-9;
  const improved = betterWhenNegative ? sign < 0 : sign > 0;

  return (
    <div className='px-2.5 py-1.5'>
      <div className='text-muted-foreground text-[10px] tracking-wide uppercase'>{label}</div>
      <div
        className={cn(
          'mono text-[13px] font-semibold',
          neutral ? 'text-muted-foreground' : improved ? 'text-primary' : 'text-destructive',
        )}
      >
        {neutral ? '—' : `${sign > 0 ? '+' : '−'}${value}`}
      </div>
    </div>
  );
}

function BeforeAfter({ diff }: { diff: SimulationDiff }) {
  if (diff.before.length < 2 || diff.after.length < 2) return null;

  const width = 100;
  const height = 46;
  const all = [...diff.before, ...diff.after, 0];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;

  const path = (values: number[]) =>
    values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * width;
        const y = height - ((value - min) / span) * height;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');

  const zeroY = height - ((0 - min) / span) * height;

  return (
    <div className='border-b px-3 py-2'>
      <div className='text-muted-foreground mb-1 flex items-center justify-between text-[10.5px] font-medium tracking-wide uppercase'>
        <span>Projected balance · before and after</span>
        <span className='flex items-center gap-2 normal-case'>
          <span className='text-muted-foreground flex items-center gap-1'>
            <span className='bg-muted-foreground/50 inline-block h-px w-3' /> before
          </span>
          <span className='text-primary flex items-center gap-1'>
            <span className='bg-primary inline-block h-px w-3' /> after
          </span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio='none'
        className='h-[46px] w-full'
        role='img'
        aria-label='Projected balance before and after'
      >
        <line
          x1={0}
          x2={width}
          y1={zeroY}
          y2={zeroY}
          className='stroke-destructive/40'
          strokeWidth={0.5}
          strokeDasharray='2 2'
        />
        <path
          d={path(diff.before)}
          className='fill-none stroke-muted-foreground/50'
          strokeWidth={1}
          strokeDasharray='3 2'
        />
        <path d={path(diff.after)} className='stroke-primary fill-none' strokeWidth={1.5} />
      </svg>
    </div>
  );
}

function DiffList({
  title,
  tone,
  icon,
  entries,
  emptyMessage,
}: {
  title: string;
  tone: 'good' | 'bad';
  icon: React.ReactNode;
  entries: SimulationDiff['resolved'];
  emptyMessage: string;
}) {
  return (
    <div className='border-t'>
      <div className='flex items-center gap-1.5 px-3 py-1.5'>
        {icon}
        <span className='text-[11px] font-medium tracking-wide uppercase'>
          {title} · {formatNumber(entries.length)}
        </span>
        {entries.length > 0 ? (
          <span className={cn('mono ml-auto text-[11.5px]', tone === 'good' ? 'text-primary' : 'text-destructive')}>
            {formatCurrency(entries.reduce((sum, entry) => sum + entry.impactValue, 0))}
          </span>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <p className='text-muted-foreground px-3 pb-2 text-[11.5px]'>{emptyMessage}</p>
      ) : (
        <div className='divide-y'>
          {entries.map((entry) => (
            <Link
              key={entry.id}
              href={`/exceptions/${encodeURIComponent(entry.id)}`}
              className='hover:bg-muted/40 block px-3 py-1.5'
            >
              <div className='flex items-baseline justify-between gap-2'>
                <span className='mono truncate text-[11.5px]'>
                  {entry.itemId} @ {entry.plantId}
                </span>
                <span className='mono text-[11.5px]'>{formatCurrency(entry.impactValue)}</span>
              </div>
              <div className='text-muted-foreground truncate text-[11px]'>{EXCEPTION_LABELS[entry.code]}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
