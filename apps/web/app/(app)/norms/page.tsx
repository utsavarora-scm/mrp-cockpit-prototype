'use client';

/**
 * Norm Review.
 *
 * The screen that has to answer "is this a black box?" — so the hero is not the
 * table, it is what opens *inside* a row: the histogram of what actually
 * happened, the calculation with this material's own numbers substituted into
 * it, and the receipts underneath. A planner who does not believe the
 * recommendation can get to the evidence in two clicks and disagree with it
 * specifically rather than generally.
 *
 * The half-life control lives here, beside the calculation, because §5.2
 * requires the weighting to be visible and adjustable and no other screen has
 * anywhere honest to put it. Moving it re-reconstructs the distribution in
 * front of the viewer, which is the direct answer to the question.
 */

import { formatCurrency, formatDateFull, formatNumber, formatPercent } from '@repo/domain';
import { Skeleton } from '@repo/ui/components/skeleton';
import { cn } from '@repo/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';

import type { NormRow, NormsQueryResult } from '@/lib/api-types';
import { useViewState } from '@/lib/view-state';
import { ProposeDialog } from '@/components/planning/ProposeDialog';

export default function NormsPage() {
  return (
    <Suspense fallback={<div className='p-8' />}>
      <NormReview />
    </Suspense>
  );
}

function NormReview() {
  const searchParams = useSearchParams();
  const plantId = useViewState((state) => state.plantId);

  const [direction, setDirection] = useState<string>(searchParams.get('filter') ?? 'all');
  const [vendor, setVendor] = useState<string>('');
  const [abc, setAbc] = useState<string>('');
  const [stale, setStale] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const norms = useQuery({
    queryKey: ['norms', direction, vendor, abc, stale, plantId],
    queryFn: async (): Promise<NormsQueryResult> => {
      const params = new URLSearchParams({ scenario: 'baseline', limit: '200' });
      if (direction !== 'all') params.set('direction', direction);
      if (vendor) params.set('vendor', vendor);
      if (abc) params.set('abc', abc);
      if (stale) params.set('staleDays', '365');
      if (plantId) params.set('plant', plantId);
      const response = await fetch(`/api/norms?${params.toString()}`);
      if (!response.ok) throw new Error('The norms could not be loaded.');
      return response.json();
    },
    placeholderData: (previous) => previous,
  });

  const data = norms.data;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const chosen = useMemo(() => rows.filter((row) => selected.has(key(row))), [rows, selected]);

  const toggle = (row: NormRow): void => {
    setSelected((current) => {
      const next = new Set(current);
      const id = key(row);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className='mx-auto max-w-[1600px] px-8 py-8'>
      <header className='mb-6 flex flex-wrap items-end justify-between gap-4'>
        <div>
          <h1 className='text-[22px] font-semibold tracking-tight'>Norm review</h1>
          <p className='text-muted-foreground mt-1 text-[13px]'>
            {norms.data ? (
              <>
                {formatNumber(norms.data.total)} materials carry a recommendation ·{' '}
                <span className='text-foreground font-medium'>{formatCurrency(norms.data.excessCapital)}</span> of
                excess capital and{' '}
                <span className='text-status-critical font-medium'>
                  {formatCurrency(norms.data.unprotectedExposure)}
                </span>{' '}
                of exposure
              </>
            ) : (
              'Reconstructing lead times…'
            )}
          </p>
        </div>
        <ProposeDialog rows={chosen} onProposed={() => setSelected(new Set())} />
      </header>

      {/* Inline chips, not a sidebar — the filters are secondary to the table. */}
      <div className='mb-5 flex flex-wrap items-center gap-2'>
        <ChipGroup
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'all', label: 'All' },
            { value: 'excess', label: 'Excess capital' },
            { value: 'exposure', label: 'Exposure' },
          ]}
        />
        <Divider />
        <ChipGroup
          value={abc}
          onChange={setAbc}
          options={[
            { value: '', label: 'All classes' },
            { value: 'A', label: 'A' },
            { value: 'B', label: 'B' },
            { value: 'C', label: 'C' },
          ]}
        />
        <Divider />
        <select
          value={vendor}
          onChange={(event) => setVendor(event.target.value)}
          className='border-input bg-background h-8 rounded-md border px-2 text-[13px]'
        >
          <option value=''>All vendors</option>
          {(norms.data?.vendors ?? []).map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
        <button
          type='button'
          onClick={() => setStale((current) => !current)}
          className={cn(
            'h-8 rounded-md px-2.5 text-[13px] font-medium transition-colors',
            stale ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
          )}
        >
          Not touched in a year
        </button>
      </div>

      <div className='bg-card overflow-hidden rounded-lg border'>
        <table className='w-full'>
          <thead>
            <tr className='bg-surface-sunken'>
              <Th className='w-10' />
              <Th>Material</Th>
              <Th align='right'>Order days</Th>
              <Th align='right'>Stock days</Th>
              <Th align='right'>Gap</Th>
              <Th align='right'>₹ impact</Th>
              <Th>Confidence</Th>
              <Th className='w-10' />
            </tr>
          </thead>
          <tbody>
            {!norms.data
              ? [0, 1, 2, 3, 4].map((row) => (
                  <tr key={row}>
                    <td colSpan={8} className='px-6 py-3'>
                      <Skeleton className='h-6 w-full' />
                    </td>
                  </tr>
                ))
              : rows.map((row) => (
                  <Row
                    key={key(row)}
                    row={row}
                    isExpanded={expanded === key(row)}
                    isSelected={selected.has(key(row))}
                    onExpand={() => setExpanded(expanded === key(row) ? null : key(row))}
                    onSelect={() => toggle(row)}
                  />
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function key(row: NormRow): string {
  return `${row.itemId}@${row.plantId}`;
}

function Row({
  row,
  isExpanded,
  isSelected,
  onExpand,
  onSelect,
}: {
  row: NormRow;
  isExpanded: boolean;
  isSelected: boolean;
  onExpand: () => void;
  onSelect: () => void;
}) {
  const excess = row.direction === 'EXCESS';

  return (
    <>
      <tr
        className={cn(
          'border-border/50 cursor-pointer border-b transition-colors',
          isExpanded ? 'bg-muted/40' : 'hover:bg-muted/25',
        )}
        onClick={onExpand}
      >
        <td className='py-0 pl-6'>
          <input
            type='checkbox'
            checked={isSelected}
            onChange={onSelect}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Select ${row.itemId}`}
            className='size-3.5 align-middle'
          />
        </td>
        <td className='h-11 py-0'>
          <span className='font-mono text-[12px]'>{row.itemId}</span>
          <span className='text-muted-foreground text-[12px]'> · {row.plantId}</span>
          <span className='text-muted-foreground ml-2 text-[13px]'>{row.description}</span>
        </td>
        <td className='h-11 py-0 text-right text-[13px] tabular-nums'>
          <span className='text-muted-foreground'>{row.maintainedOrderDays ?? '—'}</span>
          <span className='text-muted-foreground/60'> → </span>
          <span className='font-medium'>{row.recommendedOrderDays.toFixed(0)}</span>
        </td>
        <td className='h-11 py-0 text-right text-[13px] tabular-nums'>
          <span className='text-muted-foreground'>{row.maintainedStockDays ?? '—'}</span>
          <span className='text-muted-foreground/60'> → </span>
          <span className='font-medium'>{row.recommendedStockDays.toFixed(0)}</span>
        </td>
        <td
          className={cn(
            'h-11 py-0 text-right text-[13px] font-medium tabular-nums',
            excess ? 'text-status-attention' : 'text-status-critical',
          )}
        >
          {row.stockDaysGap === null ? '—' : `${row.stockDaysGap > 0 ? '+' : ''}${row.stockDaysGap.toFixed(0)}d`}
        </td>
        <td className='h-11 py-0 text-right text-[13px] font-semibold tabular-nums'>
          {formatCurrency(Math.abs(row.valueImpact))}
        </td>
        <td className='h-11 py-0 pl-3'>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-medium',
              excess ? 'bg-status-attention/12 text-status-attention' : 'bg-status-critical/12 text-status-critical',
            )}
          >
            {excess ? 'Excess' : 'Exposed'}
          </span>
        </td>
        <td className='h-11 py-0 pr-6 text-right'>
          <ChevronRight className={cn('inline size-4 transition-transform', isExpanded && 'rotate-90')} />
        </td>
      </tr>

      {isExpanded ? (
        <tr className='bg-surface-sunken/50 border-b'>
          <td colSpan={8} className='p-6'>
            <Expansion row={row} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** The reasoning, in three parts side by side, with the receipts beneath. */
function Expansion({ row }: { row: NormRow }) {
  const [halfLife, setHalfLife] = useState<number | null>(null);

  // Re-weighted in the browser from the observations already on the row, so
  // moving the control is instant rather than a round trip.
  const weighted = useMemo(() => reweight(row, halfLife), [row, halfLife]);

  return (
    <div className='space-y-6'>
      <div className='grid grid-cols-1 gap-6 lg:grid-cols-3'>
        <div>
          <SectionTitle>What actually happened</SectionTitle>
          <Histogram observations={row.observations} maintained={row.maintainedOrderDays} mean={weighted.mean} />
          <p className='text-muted-foreground mt-3 text-[12px] leading-relaxed'>
            {row.observations.length} matched receipts, {weighted.mean.toFixed(1)} days on average, varying by{' '}
            {weighted.stdDev.toFixed(1)}.
            {row.unmatchedCount > 0 ? ` ${row.unmatchedCount} unmatched, excluded.` : ''}
            {row.maintainedOrderDays !== null ? ` Planned on ${row.maintainedOrderDays}.` : ''}
          </p>

          <div className='mt-4'>
            <p className='text-muted-foreground mb-1.5 text-[12px] font-medium'>Weight recent receipts more</p>
            <div className='flex gap-1'>
              {[
                { value: null, label: 'Equally' },
                { value: 180, label: '180d' },
                { value: 90, label: '90d' },
                { value: 30, label: '30d' },
              ].map((option) => (
                <button
                  key={option.label}
                  type='button'
                  onClick={() => setHalfLife(option.value)}
                  className={cn(
                    'rounded-md px-2 py-1 text-[12px] font-medium transition-colors',
                    halfLife === option.value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className='text-muted-foreground mt-1.5 text-[12px] leading-relaxed'>
              Half-life. The default weights every receipt equally — planners already over-weight what happened last,
              and the model has to be able to show what that does.
            </p>
          </div>
        </div>

        <div>
          <SectionTitle>The calculation</SectionTitle>
          <Calculation row={row} />
        </div>

        <div>
          <SectionTitle>What constrains it</SectionTitle>
          <ul className='space-y-2'>
            {[...row.constraints]
              .sort((a, b) => Number(b.binding) - Number(a.binding))
              .map((constraint) => (
                <li key={constraint.kind} className='flex items-baseline gap-2'>
                  <span
                    className={cn(
                      'mt-1 size-1.5 shrink-0 rounded-full',
                      constraint.binding ? 'bg-status-attention' : 'bg-muted-foreground/40',
                    )}
                  />
                  <div className='flex-1'>
                    <div className='flex items-baseline justify-between gap-2'>
                      <span className='text-[13px]'>{constraint.label}</span>
                      <span className='text-[12px] tabular-nums'>{constraint.value}</span>
                    </div>
                    <p className='text-muted-foreground text-[12px] leading-relaxed'>
                      {constraint.binding ? 'Binding. ' : 'Slack. '}
                      {constraint.note}
                    </p>
                  </div>
                </li>
              ))}
            {row.constraints.length === 0 ? (
              <li className='text-muted-foreground text-[13px]'>Nothing constrains this norm.</li>
            ) : null}
          </ul>
          <p className='text-muted-foreground mt-4 text-[12px]'>
            Parameters last maintained{' '}
            <span className='text-foreground font-medium'>{formatDateFull(row.paramsLastChangedOn)}</span>
          </p>
        </div>
      </div>

      <div>
        <SectionTitle>The receipts underneath</SectionTitle>
        <div className='flex flex-wrap gap-1.5'>
          {row.receipts.map((receipt) => (
            <span
              key={receipt.poId}
              className='bg-card rounded-md border px-2 py-1 font-mono text-[11px]'
              title={`${receipt.poId} received ${receipt.receivedOn}`}
            >
              {receipt.actualLeadTimeDays}d
            </span>
          ))}
        </div>
        <Link
          href={`/material/${encodeURIComponent(row.itemId)}/${encodeURIComponent(row.plantId)}`}
          className='text-primary mt-3 inline-block text-[13px] font-medium hover:underline'
        >
          Open {row.itemId} →
        </Link>
      </div>
    </div>
  );
}

/** Exponential decay applied to the observations already on the row. */
function reweight(row: NormRow, halfLifeDays: number | null): { mean: number; stdDev: number } {
  const values = row.observations;
  if (values.length === 0) return { mean: 0, stdDev: 0 };
  if (halfLifeDays === null) {
    return { mean: row.calculation.leadTimeMean, stdDev: row.calculation.leadTimeStdDev };
  }

  // Receipts arrive most recent first, so the index stands in for age. The
  // spacing is the pack's own 37-day cadence.
  let weightTotal = 0;
  let weighted = 0;
  const weights = values.map((_, index) => Math.pow(0.5, (40 + index * 37) / halfLifeDays));
  values.forEach((value, index) => {
    const weight = weights[index] as number;
    weightTotal += weight;
    weighted += weight * value;
  });
  const mean = weighted / weightTotal;

  let spread = 0;
  values.forEach((value, index) => {
    spread += (weights[index] as number) * (value - mean) ** 2;
  });
  return { mean, stdDev: Math.sqrt(spread / weightTotal) };
}

function Histogram({
  observations,
  maintained,
  mean,
}: {
  observations: number[];
  maintained: number | null;
  mean: number;
}) {
  if (observations.length === 0) return <p className='text-muted-foreground text-[13px]'>No receipts.</p>;

  const low = Math.min(...observations, maintained ?? Infinity);
  const high = Math.max(...observations, maintained ?? -Infinity);
  const span = Math.max(high - low, 1);
  const bucketCount = 8;
  const buckets = new Array<number>(bucketCount).fill(0);
  for (const value of observations) {
    const index = Math.min(Math.floor(((value - low) / span) * bucketCount), bucketCount - 1);
    buckets[index] = (buckets[index] as number) + 1;
  }
  const peak = Math.max(...buckets, 1);

  const position = (value: number): number => ((value - low) / span) * 100;

  return (
    <div>
      <div className='relative flex h-[120px] items-end gap-[3px]'>
        {buckets.map((count, index) => (
          <div
            key={index}
            className='bg-primary/35 flex-1 rounded-t-[2px]'
            style={{ height: `${Math.max((count / peak) * 100, count > 0 ? 6 : 0)}%` }}
          />
        ))}

        {/* The maintained parameter drawn across the evidence. This is the
            picture that makes drift undeniable. */}
        {maintained !== null ? (
          <div
            className='bg-status-critical absolute top-0 bottom-0 w-px'
            style={{ left: `${Math.min(Math.max(position(maintained), 0), 100)}%` }}
          >
            <span className='text-status-critical absolute -top-0.5 left-1.5 text-[11px] font-medium whitespace-nowrap'>
              planned {maintained}d
            </span>
          </div>
        ) : null}
        <div
          className='bg-foreground absolute top-0 bottom-0 w-px'
          style={{ left: `${Math.min(Math.max(position(mean), 0), 100)}%` }}
        >
          <span className='absolute -bottom-5 left-1.5 text-[11px] font-medium whitespace-nowrap'>
            actual {mean.toFixed(0)}d
          </span>
        </div>
      </div>
      <div className='text-muted-foreground mt-6 flex justify-between text-[11px] tabular-nums'>
        <span>{low.toFixed(0)}d</span>
        <span>{high.toFixed(0)}d</span>
      </div>
    </div>
  );
}

function Calculation({ row }: { row: NormRow }) {
  const c = row.calculation;
  return (
    <div className='space-y-4 text-[13px]'>
      <div>
        <p className='text-muted-foreground mb-1 text-[12px]'>Treating lead time as fixed — how it was set</p>
        <p className='font-mono text-[12px] leading-relaxed'>
          {c.z.toFixed(2)} × {c.dailyDemandStdDev.toFixed(1)} × √{c.leadTimeMean.toFixed(0)} ={' '}
          <span className='font-semibold'>{formatNumber(c.naiveQty)}</span> {row.baseUom}
        </p>
      </div>

      <div>
        <p className='text-muted-foreground mb-1 text-[12px]'>Accounting for lead time moving too</p>
        <p className='font-mono text-[12px] leading-relaxed'>
          {c.z.toFixed(2)} × √({c.leadTimeMean.toFixed(0)} × {c.dailyDemandStdDev.toFixed(1)}² +{' '}
          {c.dailyDemandMean.toFixed(0)}² × {c.leadTimeStdDev.toFixed(0)}²) ={' '}
          <span className='font-semibold'>{formatNumber(c.combinedQty)}</span> {row.baseUom}
        </p>
      </div>

      <div className='border-t pt-3'>
        <p className='text-[14px]'>
          The two answers differ by <span className='font-semibold'>{c.ratio.toFixed(1)}×</span>.
        </p>
        <p className='text-muted-foreground mt-1.5 text-[12px] leading-relaxed'>
          Of the {formatNumber(c.demandTerm + c.leadTimeTerm)} under that root,{' '}
          <span className='text-foreground font-medium'>{formatNumber(c.leadTimeTerm)}</span> comes from lead time and{' '}
          {formatNumber(c.demandTerm)} from demand — {formatPercent(c.leadTimeShare, 0)} of the buffer exists because
          the lead time moves, not because demand does.
        </p>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className='text-muted-foreground mb-3 text-[12px] font-semibold tracking-[0.04em] uppercase'>{children}</h3>;
}

function ChipGroup({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className='flex gap-1'>
      {options.map((option) => (
        <button
          key={option.value}
          type='button'
          onClick={() => onChange(option.value)}
          className={cn(
            'h-8 rounded-md px-2.5 text-[13px] font-medium transition-colors',
            value === option.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Divider() {
  return <span className='bg-border h-5 w-px' />;
}

function Th({
  children,
  align = 'left',
  className,
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <th
      className={cn(
        'text-muted-foreground border-b px-0 py-2.5 text-[11px] font-medium tracking-[0.04em] uppercase',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}
