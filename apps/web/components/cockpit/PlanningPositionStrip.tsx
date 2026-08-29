'use client';

/**
 * The planning position, above the money.
 *
 * Six counts and four coverage bars. The exposure tiles answer "what is this
 * worth"; this answers "how does the plan stand", which is the question a
 * planner actually opens the screen with. Counts, not currency — deliberately a
 * different register from the strip above it.
 *
 * Each tile is a link into the materials table already filtered to what it
 * counts, so reading a number and acting on it are the same gesture.
 */

import { formatNumber, formatPercent } from '@repo/domain';
import { Skeleton } from '@repo/ui/components/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { cn } from '@repo/ui/lib/utils';
import Link from 'next/link';

import type { CockpitSummary } from '@/lib/api-types';

export function PlanningPositionStrip({ summary }: { summary: CockpitSummary | undefined }) {
  if (!summary) {
    return (
      <div className='grid grid-cols-10 gap-px border-b'>
        {Array.from({ length: 10 }).map((_, index) => (
          <Skeleton key={index} className='h-[46px] rounded-none' />
        ))}
      </div>
    );
  }

  const position = summary.planningPosition;

  const tiles = [
    {
      label: 'MRP materials',
      value: position.mrpMaterials,
      href: '/item',
      tone: 'NONE' as const,
      hint: 'Item-plants the engine planned this run.',
    },
    {
      // Not labelled "at risk": the materials table uses that for a balance
      // that actually goes negative, and two different counts under one name is
      // the first thing someone spots in a demo.
      label: 'With exceptions',
      value: position.atRisk,
      href: '/exceptions',
      tone: 'BAD' as const,
      hint: 'Materials carrying at least one open exception of any class — including master data and cross-system issues that are not yet a balance problem.',
    },
    {
      label: 'Projected stock-outs',
      value: position.projectedStockouts,
      href: '/item?status=AT_RISK',
      tone: 'BAD' as const,
      hint: 'Materials whose balance goes negative inside the horizon, counting only supply that can still be ordered in time.',
    },
    {
      label: 'Excess materials',
      value: position.excessMaterials,
      href: '/item?status=EXCESS',
      tone: 'WEAK' as const,
      hint: 'Materials holding materially more than the horizon will consume.',
    },
    {
      label: 'Open POs',
      value: position.openPos,
      href: '/item',
      tone: 'NONE' as const,
      hint: 'Purchase orders still open across the network.',
    },
    {
      label: 'Delayed inbound',
      value: position.delayedInbound,
      href: '/item?status=AT_RISK',
      tone: 'BAD' as const,
      hint: 'Delivery lines a supplier has already pushed past the date the plan is netting against. Open a material to see its supply schedule.',
    },
  ];

  return (
    <div className='flex items-stretch gap-px border-b'>
      {tiles.map((tile) => (
        <Tooltip key={tile.label}>
          <TooltipTrigger asChild>
            <Link href={tile.href} className='hover:bg-muted/50 min-w-[112px] flex-1 px-3 py-1.5 transition-colors'>
              <div className='text-muted-foreground text-[10px] font-medium tracking-wide uppercase'>{tile.label}</div>
              <div
                className={cn(
                  'mono mt-0.5 text-[16px] font-semibold',
                  tile.tone === 'BAD' && tile.value > 0 && 'text-destructive',
                  tile.tone === 'WEAK' && tile.value > 0 && 'text-primary',
                )}
              >
                {formatNumber(tile.value)}
              </div>
            </Link>
          </TooltipTrigger>
          <TooltipContent className='max-w-xs'>{tile.hint}</TooltipContent>
        </Tooltip>
      ))}

      {/* Coverage as bars: four ratios read faster side by side than as four
          more figures competing with the counts. */}
      <div className='flex min-w-[290px] flex-col justify-center gap-[3px] border-l px-3 py-1.5'>
        <div className='text-muted-foreground text-[10px] font-medium tracking-wide uppercase'>Planning health</div>
        <div className='grid grid-cols-2 gap-x-3 gap-y-[3px]'>
          <CoverageBar label='Inventory' fraction={position.coverage.inventory} />
          <CoverageBar label='Demand' fraction={position.coverage.demand} />
          <CoverageBar label='Supply' fraction={position.coverage.supply} />
          <CoverageBar label='Safety stock' fraction={position.coverage.safetyStock} />
        </div>
      </div>
    </div>
  );
}

function CoverageBar({ label, fraction }: { label: string; fraction: number }) {
  const percent = Math.max(0, Math.min(1, fraction));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className='flex cursor-help items-center gap-1.5'>
          <span className='text-muted-foreground w-[62px] shrink-0 text-[10.5px]'>{label}</span>
          <span className='bg-muted h-1 flex-1 overflow-hidden rounded-full'>
            <span
              className={cn('block h-full', percent < 0.85 ? 'bg-destructive/70' : 'bg-primary')}
              style={{ width: `${percent * 100}%` }}
            />
          </span>
          <span className='mono w-[34px] shrink-0 text-right text-[10.5px]'>{formatPercent(percent, 0)}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {label === 'Inventory'
          ? 'Materials whose stock on hand covers at least the next 30 days of demand.'
          : label === 'Demand'
            ? 'Share of committed customer order quantity the plan can serve.'
            : label === 'Supply'
              ? 'Materials that never go negative inside the horizon.'
              : 'Materials that stay above their safety stock throughout.'}
      </TooltipContent>
    </Tooltip>
  );
}
