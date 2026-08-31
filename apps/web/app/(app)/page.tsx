'use client';

/**
 * Planning Cockpit.
 *
 * One hero, and it is a *pair*: excess capital on the left, unprotected
 * exposure on the right, with one line beneath spanning both. Two numbers
 * rather than one because the argument is that they have the same cause — norms
 * set once and never revisited — and a single blended figure would lose exactly
 * that. This is the 0:00 beat and it has three seconds to land.
 *
 * Everything below the hero supports it and is sized not to compete: 32px
 * figures, not 48. Ranking is by rupees and nothing else. The previous build
 * ranked by an exception severity that was itself derived from rupees, which
 * asked the client to learn a vocabulary in order to read a list they could
 * already read.
 */

import { formatCurrency, formatNumber, formatPercent } from '@repo/domain';
import { Skeleton } from '@repo/ui/components/skeleton';
import { cn } from '@repo/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import type { AttentionRow, CockpitSummary, GapSegment } from '@/lib/api-types';

export default function CockpitPage() {
  const summary = useQuery({
    queryKey: ['cockpit-summary'],
    queryFn: async (): Promise<CockpitSummary> => {
      const response = await fetch('/api/plan?scenario=baseline');
      if (!response.ok) throw new Error('The plan could not be loaded.');
      return response.json();
    },
  });

  if (!summary.data) {
    return (
      <Shell>
        <Skeleton className='h-[180px] w-full rounded-lg' />
        <div className='mt-8 grid grid-cols-4 gap-6'>
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className='h-20 rounded-lg' />
          ))}
        </div>
      </Shell>
    );
  }

  const { norms, gapAttribution, needsAttention, planningPosition } = summary.data;

  return (
    <Shell>
      {/* The hero. Two figures, one cause. */}
      <section className='bg-card rounded-lg border'>
        <div className='grid grid-cols-1 md:grid-cols-2'>
          <Hero
            label='Excess capital'
            value={norms.excessCapital}
            note={`${formatNumber(norms.materialsInExcess)} materials holding more than they need`}
            href='/norms?filter=excess'
          />
          <div className='border-t md:border-t-0 md:border-l'>
            <Hero
              label='Unprotected exposure'
              value={norms.unprotectedExposure}
              note={`${formatNumber(norms.materialsBelowNorm)} materials buffered below what their lead time demands`}
              href='/norms?filter=exposure'
              tone='critical'
            />
          </div>
        </div>
        <p className='border-t px-8 py-4 text-[14px]'>
          Both caused by the same thing: <span className='font-medium'>norms that were set once and never moved.</span>
        </p>
      </section>

      {/* Supporting metrics — 32px, so they never compete with the hero. */}
      <section className='mt-8 grid grid-cols-2 gap-6 lg:grid-cols-4'>
        <Metric label='Materials under management' value={formatNumber(planningPosition.mrpMaterials)} />
        <Metric label='Coverage against norm' value={formatPercent(norms.coverageAgainstNorm, 0)} />
        <Metric label='Materials below norm' value={formatNumber(norms.materialsBelowNorm)} />
        <Metric label='Materials in excess' value={formatNumber(norms.materialsInExcess)} />
      </section>

      <div className='mt-8 grid grid-cols-1 gap-6 xl:grid-cols-12'>
        <div className='xl:col-span-7'>
          <GapAttribution segments={gapAttribution} />
        </div>
        <div className='xl:col-span-5'>
          <NeedsAttention rows={needsAttention} />
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className='mx-auto max-w-[1600px] px-8 py-8'>{children}</div>;
}

function Hero({
  label,
  value,
  note,
  href,
  tone,
}: {
  label: string;
  value: number;
  note: string;
  href: string;
  tone?: 'critical';
}) {
  return (
    <Link href={href} className='hover:bg-muted/30 group block px-8 py-7 transition-colors'>
      <p className='text-muted-foreground text-[12px] font-medium tracking-[0.04em] uppercase'>{label}</p>
      <p
        className={cn(
          'mt-2 text-[48px] leading-none font-semibold tracking-[-0.02em] tabular-nums',
          tone === 'critical' && 'text-status-critical',
        )}
      >
        {formatCurrency(value)}
      </p>
      <p className='text-muted-foreground mt-3 flex items-center gap-1.5 text-[13px]'>
        {note}
        <ArrowRight className='size-3.5 opacity-0 transition-opacity group-hover:opacity-100' />
      </p>
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className='text-muted-foreground text-[12px] font-medium'>{label}</p>
      <p className='mt-1 text-[32px] font-semibold tracking-[-0.02em] tabular-nums'>{value}</p>
    </div>
  );
}

const SEGMENT_TONE: Record<GapSegment['kind'], string> = {
  NEEDS_PO: 'bg-status-critical',
  ARRIVING_LATE: 'bg-status-attention',
  WRONG_PLANT: 'bg-primary',
};

/**
 * What kind of problem the gap is — asked in terms of the *action* each slice
 * needs. "₹1.4 Cr ordered and arriving late" tells a planner what to do this
 * morning; "₹1.4 Cr critical" does not.
 */
function GapAttribution({ segments }: { segments: GapSegment[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const present = segments.filter((segment) => segment.value > 0);

  return (
    <section className='bg-card rounded-lg border p-6'>
      <div className='flex items-baseline justify-between'>
        <h2 className='text-muted-foreground text-[15px] font-semibold tracking-[0.04em] uppercase'>
          Where the gap sits
        </h2>
        <span className='text-[13px] font-medium tabular-nums'>{formatCurrency(total)}</span>
      </div>
      <p className='text-muted-foreground mt-1 text-[12px]'>
        The shortfall on the day each material first goes short, priced at standard cost
      </p>

      <div className='bg-surface-sunken mt-5 flex h-10 overflow-hidden rounded-md'>
        {present.map((segment) => (
          <div
            key={segment.kind}
            className={cn(SEGMENT_TONE[segment.kind], 'transition-all duration-200')}
            style={{ width: `${segment.share * 100}%` }}
            title={`${segment.label} — ${formatCurrency(segment.value)}`}
          />
        ))}
      </div>

      <ul className='mt-5 space-y-3'>
        {segments.map((segment) => (
          <li key={segment.kind} className='flex items-baseline gap-3'>
            <span className={cn('mt-1 size-2.5 shrink-0 rounded-[2px]', SEGMENT_TONE[segment.kind])} />
            <span className='flex-1 text-[14px]'>{segment.label}</span>
            <span className='text-muted-foreground text-[12px] tabular-nums'>{segment.materials} materials</span>
            <span className='w-11 text-right text-[13px] tabular-nums'>{formatPercent(segment.share, 0)}</span>
            <span className='w-24 text-right text-[13px] font-medium tabular-nums'>
              {formatCurrency(segment.value)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NeedsAttention({ rows }: { rows: AttentionRow[] }) {
  return (
    <section className='bg-card rounded-lg border p-6'>
      <div className='flex items-baseline justify-between'>
        <h2 className='text-muted-foreground text-[15px] font-semibold tracking-[0.04em] uppercase'>
          Needs attention
        </h2>
        <Link href='/item' className='text-primary text-[13px] font-medium hover:underline'>
          View all
        </Link>
      </div>
      <p className='text-muted-foreground mt-1 text-[12px]'>Ranked by money at stake — nothing else</p>

      <ul className='mt-4 divide-y'>
        {rows.map((row) => (
          <li key={`${row.itemId}@${row.plantId}`}>
            <Link
              href={`/material/${encodeURIComponent(row.itemId)}/${encodeURIComponent(row.plantId)}`}
              className='hover:bg-muted/40 -mx-2 block rounded-md px-2 py-3.5 transition-colors'
            >
              <div className='flex items-baseline justify-between gap-3'>
                <span className='font-mono text-[12px]'>
                  {row.itemId} · {row.plantId}
                </span>
                <span className='text-[14px] font-semibold tabular-nums'>{formatCurrency(row.valueAtStake)}</span>
              </div>
              <p className='mt-1 text-[13px] leading-relaxed'>{row.issue}</p>
              <div className='mt-1.5 flex items-baseline justify-between gap-3'>
                <span className='text-primary text-[12px]'>{row.nextStep}</span>
                <span className='text-muted-foreground shrink-0 text-[12px] tabular-nums'>
                  {row.daysToImpact === null
                    ? 'capital tied up'
                    : row.daysToImpact === 0
                      ? 'today'
                      : `${row.daysToImpact} days`}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
