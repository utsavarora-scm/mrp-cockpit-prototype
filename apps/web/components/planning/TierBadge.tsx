'use client';

/**
 * Supply confidence, drawn.
 *
 * The visual weight matches the confidence: solid for a line the vendor has
 * acknowledged, outlined for one that exists on an order and nothing more,
 * hatched for one the system is merely proposing. The word is always there
 * beside it, because colour never carries meaning alone and planners print
 * these screens.
 */

import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { cn } from '@repo/ui/lib/utils';

import type { TierView } from '@/lib/api-types';

const NOTE: Record<1 | 2 | 3, string> = {
  1: 'Confirmed — the vendor has acknowledged this line, date and quantity, or has already dispatched against it.',
  2: 'Committed — a schedule line exists on a purchase order. Nobody has acknowledged it.',
  3: 'Planned — the system is proposing this. Nothing has been ordered.',
};

export function TierBadge({ tier, className }: { tier: TierView; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
            tier.tier === 1
              ? 'bg-status-settled/12 text-status-settled'
              : tier.tier === 2
                ? 'text-status-attention border-status-attention/40 border'
                : 'text-muted-foreground border-muted-foreground/30 border border-dashed',
            className,
          )}
        >
          <Swatch tier={tier} />
          {tier.label}
        </span>
      </TooltipTrigger>
      <TooltipContent className='max-w-[280px]'>{NOTE[tier.tier]}</TooltipContent>
    </Tooltip>
  );
}

/** The same three fills the chart uses, so the legend needs no explaining. */
export function Swatch({ tier }: { tier: TierView }) {
  if (tier.fill === 'SOLID') return <span className='bg-status-settled size-2 rounded-[2px]' />;
  if (tier.fill === 'OUTLINE') return <span className='border-status-attention size-2 rounded-[2px] border' />;
  return (
    <span
      className='border-muted-foreground/50 size-2 rounded-[2px] border border-dashed'
      style={{
        backgroundImage:
          'repeating-linear-gradient(45deg, currentColor 0, currentColor 1px, transparent 1px, transparent 3px)',
        opacity: 0.55,
      }}
    />
  );
}
