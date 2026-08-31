'use client';

/**
 * The time-phased plan — the numeric readout of the chart above it.
 *
 * It deliberately carries the *same row names* as the chart's legend. Two names
 * for one series across a single screen is a large part of what made the last
 * build unreadable: a planner should never have to work out that "projected
 * available — orderable supply only" and "committed supply" are the same line.
 *
 * **Bucketing has a correctness rule, not a display preference.** A flow (what
 * moved during a period) sums; a level (what is held at an instant) takes the
 * closing value. Summing a stock balance across a week reports seven times the
 * stock, which is the kind of error that survives review because every
 * individual number looks plausible. The rule travels with the row, from the
 * server, as `aggregate`.
 *
 * Three bucket modes, because planners here read all three: daily for the next
 * fortnight, weekly for the quarter, and GCPL's own review periods — 7, 15, 30,
 * 45, 90, 180 days — which is how the norms are actually stated.
 */

import { formatDateShort, formatNumber } from '@repo/domain';
import { cn } from '@repo/ui/lib/utils';
import { ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { ItemDetail, TimePhasedRow } from '@/lib/api-types';

type Mode = 'DAILY' | 'WEEKLY' | 'PERIODS';

/** GCPL states cover in these review periods, so the table can be read in them. */
const GCPL_PERIODS = [7, 15, 30, 45, 90, 180] as const;

const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'DAILY', label: 'Daily' },
  { id: 'WEEKLY', label: 'Weekly' },
  { id: 'PERIODS', label: 'GCPL periods' },
];

interface Bucket {
  label: string;
  /** Day indices this bucket covers, in order. */
  days: number[];
}

function bucketsFor(dates: string[], mode: Mode): Bucket[] {
  if (mode === 'DAILY') {
    // Eight columns is the readable ceiling; daily beyond a fortnight is noise.
    return dates.slice(0, 14).map((date, index) => ({ label: formatDateShort(date), days: [index] }));
  }

  if (mode === 'WEEKLY') {
    const buckets: Bucket[] = [];
    for (let start = 0; start < dates.length && buckets.length < 13; start += 7) {
      const days: number[] = [];
      for (let day = start; day < Math.min(start + 7, dates.length); day += 1) days.push(day);
      buckets.push({ label: formatDateShort(dates[start] as string), days });
    }
    return buckets;
  }

  // Cumulative review periods: each column is "the first N days", which is how
  // a norm stated in days of cover is actually checked.
  let previous = 0;
  const buckets: Bucket[] = [];
  for (const period of GCPL_PERIODS) {
    if (previous >= dates.length) break;
    const end = Math.min(period, dates.length);
    const days: number[] = [];
    for (let day = previous; day < end; day += 1) days.push(day);
    if (days.length > 0) buckets.push({ label: `${period}d`, days });
    previous = end;
  }
  return buckets;
}

function collapse(row: TimePhasedRow, bucket: Bucket): number {
  if (row.aggregate === 'LAST') {
    const closing = bucket.days[bucket.days.length - 1];
    return closing === undefined ? 0 : (row.values[closing] ?? 0);
  }
  let total = 0;
  for (const day of bucket.days) total += row.values[day] ?? 0;
  return total;
}

export function TimePhasedTable({ detail }: { detail: ItemDetail }) {
  const [mode, setMode] = useState<Mode>('WEEKLY');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const buckets = useMemo(() => bucketsFor(detail.dates, mode), [detail.dates, mode]);

  const toggle = (key: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <section className='bg-card rounded-lg border'>
      <header className='flex flex-wrap items-start justify-between gap-4 border-b px-6 py-5'>
        <div>
          <h2 className='text-muted-foreground text-[15px] font-semibold tracking-[0.04em] uppercase'>
            Time-phased plan
          </h2>
          <p className='text-muted-foreground mt-1 text-[12px]'>
            {mode === 'PERIODS'
              ? 'Each column is the next review period, in days'
              : `Closing balances at the end of each ${mode === 'DAILY' ? 'day' : 'week'}`}{' '}
            · {detail.baseUom}
          </p>
        </div>
        <div className='flex gap-1' role='group' aria-label='Bucket'>
          {MODES.map((option) => (
            <button
              key={option.id}
              type='button'
              onClick={() => setMode(option.id)}
              className={cn(
                'rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
                mode === option.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <div className='overflow-x-auto'>
        <table className='w-full min-w-[720px] border-separate border-spacing-0'>
          <thead>
            <tr>
              <th className='bg-surface-sunken sticky left-0 z-20 border-b px-6 py-2.5 text-left text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase'>
                Row
              </th>
              {buckets.map((bucket) => (
                <th
                  key={bucket.label}
                  className='bg-surface-sunken text-muted-foreground border-b px-3 py-2.5 text-right text-[11px] font-medium tracking-[0.04em] uppercase'
                >
                  {bucket.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {detail.grid.map((row) => (
              <Rows
                key={row.key}
                row={row}
                buckets={buckets}
                norm={detail.safetyStock}
                expanded={expanded}
                onToggle={toggle}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Rows({
  row,
  buckets,
  norm,
  expanded,
  onToggle,
}: {
  row: TimePhasedRow;
  buckets: Bucket[];
  norm: number;
  expanded: Set<string>;
  onToggle: (key: string) => void;
}) {
  const isOpen = expanded.has(row.key);
  const hasChildren = (row.children?.length ?? 0) > 0;
  const isBalance = row.emphasis === 'BALANCE';

  return (
    <>
      <tr className={cn('border-border/50 group', isBalance && 'bg-muted/25')}>
        <td
          className={cn(
            'bg-card group-hover:bg-muted/40 sticky left-0 z-10 h-11 border-b border-l-[3px] px-6 text-[13px]',
            isBalance ? 'border-l-primary font-medium' : 'border-l-transparent',
            row.emphasis === 'THRESHOLD' && 'border-l-status-attention text-muted-foreground',
          )}
        >
          {hasChildren ? (
            <button
              type='button'
              onClick={() => onToggle(row.key)}
              className='inline-flex items-center gap-1.5 text-left hover:underline'
            >
              <ChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} />
              {row.label}
            </button>
          ) : (
            <span className={cn(hasChildren ? '' : 'pl-5')}>{row.label}</span>
          )}
        </td>
        {buckets.map((bucket) => {
          const value = collapse(row, bucket);
          const breached = isBalance && value < norm;
          return (
            <td
              key={bucket.label}
              className={cn(
                'h-11 border-b px-3 text-right text-[13px] tabular-nums',
                isBalance && 'font-medium',
                value === 0 && !isBalance && 'text-muted-foreground/40',
                breached && 'text-status-attention',
                isBalance && value < 0 && 'text-status-critical',
              )}
            >
              {formatNumber(value)}
            </td>
          );
        })}
      </tr>

      {isOpen
        ? row.children?.map((child) => (
            <tr key={child.key} className='border-border/50 bg-surface-sunken/40'>
              <td className='bg-surface-sunken/40 text-muted-foreground sticky left-0 z-10 h-11 border-b border-l-[3px] border-l-transparent px-6 pl-12 text-[13px]'>
                {child.label}
              </td>
              {buckets.map((bucket) => {
                const value = collapse(child, bucket);
                return (
                  <td
                    key={bucket.label}
                    className={cn(
                      'text-muted-foreground h-11 border-b px-3 text-right text-[13px] tabular-nums',
                      value === 0 && 'text-muted-foreground/40',
                    )}
                  >
                    {formatNumber(value)}
                  </td>
                );
              })}
            </tr>
          ))
        : null}
    </>
  );
}
