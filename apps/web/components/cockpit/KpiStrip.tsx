'use client';

/**
 * The header strip.
 *
 * The line that matters is the first one: how many exceptions, how much money,
 * and how little of the queue carries most of it. Everything else on this screen
 * is elaboration of that sentence.
 */

import { formatCurrency, formatDays, formatDelta, formatNumber, formatPercent } from '@repo/domain';
import { Skeleton } from '@repo/ui/components/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { cn } from '@repo/ui/lib/utils';

import type { CockpitSummary, KpiDelta } from '@/lib/api-types';
import { Sparkline } from './Sparkline';

interface Tile {
  label: string;
  value: string;
  metric: KpiDelta;
  /** Whether an increase is a good thing, for colouring the delta. */
  higherIsBetter: boolean;
  format: (value: number) => string;
  series?: number[];
  hint: string;
}

export function KpiStrip({ summary }: { summary: CockpitSummary | undefined }) {
  if (!summary) {
    return (
      <div className='grid grid-cols-6 gap-px border-b'>
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className='h-[74px] rounded-none' />
        ))}
      </div>
    );
  }

  const tiles: Tile[] = [
    {
      label: 'Exposure at risk',
      value: formatCurrency(summary.totalExposure.value),
      metric: summary.totalExposure,
      higherIsBetter: false,
      format: formatCurrency,
      series: summary.sparklines.exposure,
      hint: 'Revenue and margin at risk, excess stock, expedite premium and write-off exposure, summed across every open exception.',
    },
    {
      label: 'Projected fill rate',
      value: formatPercent(summary.projectedFillRate.value),
      metric: summary.projectedFillRate,
      higherIsBetter: true,
      format: (value) => formatPercent(value),
      hint: 'Share of committed customer order quantity the plan can serve, judged on supply that can actually be ordered in time.',
    },
    {
      label: 'Inventory value',
      value: formatCurrency(summary.inventoryValue.value),
      metric: summary.inventoryValue,
      higherIsBetter: false,
      format: formatCurrency,
      series: summary.sparklines.cover,
      hint: 'All stock at standard cost — unrestricted, blocked, in inspection and in transit.',
    },
    {
      label: 'Days on hand',
      value: formatDays(summary.daysOnHand.value),
      metric: summary.daysOnHand,
      higherIsBetter: false,
      format: formatDays,
      hint: 'Inventory value divided by daily cost of goods across the horizon.',
    },
    {
      label: 'Excess & obsolete',
      value: formatCurrency(summary.excessObsoleteExposure.value),
      metric: summary.excessObsoleteExposure,
      higherIsBetter: false,
      format: formatCurrency,
      hint: 'Stock beyond a 90-day cover threshold, valued at standard cost.',
    },
    {
      label: 'Auto-resolvable',
      value: formatPercent(summary.autoResolvedPct.value, 0),
      metric: summary.autoResolvedPct,
      higherIsBetter: true,
      format: (value) => formatPercent(value, 0),
      hint: 'Exceptions the agent policy could close unattended: low value, high confidence, B or C class, allowlisted resolution type.',
    },
  ];

  return (
    <div>
      <div className='flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b px-4 py-2.5'>
        <span className='mono text-[15px] font-semibold'>{formatNumber(summary.exceptionCount)}</span>
        <span className='text-muted-foreground text-[13px]'>exceptions</span>
        <span className='text-border'>·</span>
        <span className='mono text-[15px] font-semibold'>{formatCurrency(summary.totalExposure.value)}</span>
        <span className='text-muted-foreground text-[13px]'>at risk</span>
        <span className='text-border'>·</span>
        <span className='text-[13px]'>
          <span className='mono text-primary font-semibold'>{formatNumber(summary.exceptionsToSeventyPercent)}</span>
          <span className='text-muted-foreground'> of them — </span>
          <span className='mono text-primary font-semibold'>{formatPercent(summary.seventyPercentHeadShare, 1)}</span>
          <span className='text-muted-foreground'> of the queue — carry 70% of it</span>
        </span>
        <span className='text-muted-foreground ml-auto text-[12px]'>
          Planned {summary.planningDate} · {summary.horizonDays}-day horizon ·{' '}
          <span className='mono'>{Math.round(summary.elapsedMs)} ms</span>
        </span>
      </div>

      <div className='bg-border grid grid-cols-6 gap-px border-b'>
        {tiles.map((tile) => (
          <Tooltip key={tile.label}>
            <TooltipTrigger asChild>
              <div className='bg-background flex flex-col gap-1 px-3 py-2 text-left'>
                <span className='text-muted-foreground text-[11px] font-medium tracking-wide uppercase'>
                  {tile.label}
                </span>
                <div className='flex items-end justify-between gap-2'>
                  <span className='mono text-[17px] leading-none font-semibold'>{tile.value}</span>
                  {tile.series ? <Sparkline values={tile.series} className='h-6 w-16 shrink-0' /> : null}
                </div>
                <DeltaLabel metric={tile.metric} higherIsBetter={tile.higherIsBetter} format={tile.format} />
              </div>
            </TooltipTrigger>
            <TooltipContent className='max-w-xs'>{tile.hint}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

function DeltaLabel({
  metric,
  higherIsBetter,
  format,
}: {
  metric: KpiDelta;
  higherIsBetter: boolean;
  format: (value: number) => string;
}) {
  if (metric.delta === null) {
    return <span className='text-muted-foreground/70 text-[11px]'>no previous run</span>;
  }
  if (Math.abs(metric.delta) < 1e-9) {
    return <span className='text-muted-foreground/70 text-[11px]'>unchanged</span>;
  }

  const improved = higherIsBetter ? metric.delta > 0 : metric.delta < 0;
  const relative = metric.value - metric.delta !== 0 ? metric.delta / Math.abs(metric.value - metric.delta) : 0;

  return (
    <span className={cn('mono text-[11px]', improved ? 'text-primary' : 'text-destructive')}>
      {metric.delta > 0 ? '+' : '−'}
      {format(Math.abs(metric.delta))}{' '}
      <span className='text-muted-foreground'>({formatDelta(relative, 1)}) vs last run</span>
    </span>
  );
}
