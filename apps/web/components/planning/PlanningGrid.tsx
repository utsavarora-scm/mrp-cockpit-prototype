'use client';

/**
 * The classic planning table, made legible.
 *
 * Rows are fixed and in the order a planner who has used one of these for
 * twenty years reads them by position. Three of them are not in the usual
 * layout and each is there for a reason:
 *
 *   - **Projected balance before planned orders** — the honest position, with
 *     nothing the system is merely proposing in it.
 *   - **of which added by lot sizing** — need and rule, separated, so nobody
 *     has to work out which part of an order is which.
 *   - **Planned order release** — red where the date has already passed, which
 *     is the single most useful cell on the screen and appears on none today.
 *
 * Every cell opens its explanation. The bucket columns are the same buckets the
 * chart draws, so the two can be read against each other without translation.
 */

import { formatNumber } from '@repo/domain';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { cn } from '@repo/ui/lib/utils';
import { useMemo, useState } from 'react';

import type { ChartBucket, GridCell, GridRow, MaterialDetail } from '@/lib/api-types';

const STATUS_WORD: Record<ChartBucket['status'], string> = {
  OK: 'OK',
  TIGHT: 'Tight',
  BREACH: 'Breach',
  STOCK_OUT: 'Stock-out',
  EXCESS: 'Excess',
};

export interface GridAnchor {
  row: string;
  /** The days the cell covers — a date, not an index, because the weekly
   * collapse renumbers buckets and an index would explain the wrong one. */
  fromDate: string;
  toDate: string;
  label: string;
}

export function PlanningGrid({
  detail,
  onExplain,
}: {
  detail: MaterialDetail;
  /** Opened from a cell, and told which one. */
  onExplain?: (anchor?: GridAnchor) => void;
}) {
  // The near horizon is bucketed daily, which is right for a dock-level
  // decision and far too wide for reading a plan across. Collapsing rolls the
  // daily buckets up into the weeks they belong to — and it *rolls them up*
  // rather than dropping them, because the first four weeks are where the
  // whole story usually is.
  const [weeksOnly, setWeeksOnly] = useState(true);
  const visible = useMemo(
    () => (weeksOnly ? collapseToWeeks(detail) : { buckets: detail.buckets, rows: detail.grid }),
    [weeksOnly, detail],
  );

  return (
    <section className='bg-card rounded-lg border'>
      <div className='flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3'>
        <div>
          <h2 className='text-[14px] font-semibold'>Time-phased plan</h2>
          <p className='text-muted-foreground text-[12px]'>
            All quantities in {detail.baseUom}. Every cell traces to the calculation that produced it.
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <button
            type='button'
            onClick={() => setWeeksOnly((value) => !value)}
            className='border-input hover:bg-muted h-7 rounded-md border px-2.5 text-[12px] font-medium'
          >
            {weeksOnly ? 'Show daily buckets' : 'Weekly buckets only'}
          </button>
          {onExplain ? (
            <button
              type='button'
              onClick={() => onExplain()}
              className='bg-primary text-primary-foreground h-7 rounded-md px-2.5 text-[12px] font-medium'
            >
              Explain this
            </button>
          ) : null}
        </div>
      </div>

      <div className='overflow-x-auto'>
        <table className='w-full border-collapse'>
          <thead>
            <tr className='bg-surface-sunken border-b'>
              <th className='grid-head bg-surface-sunken sticky left-0 z-10 min-w-[260px] text-left'>Row</th>
              {visible.buckets.map((bucket) => (
                <th
                  key={bucket.index}
                  className={cn(
                    'grid-head min-w-[74px] text-right whitespace-nowrap',
                    bucket.startsZone && bucket.index > 0 && 'border-border border-l',
                  )}
                >
                  <span className='block'>{bucket.kind === 'DAY' ? bucket.label.slice(4) : bucket.week}</span>
                  <span className='text-muted-foreground/70 block text-[9px] font-normal normal-case'>
                    {bucket.startDate.slice(5)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.rows.map((row) => (
              <Row key={row.key} row={row} buckets={visible.buckets} uom={detail.baseUom} onExplain={onExplain} />
            ))}
            <StatusRow buckets={visible.buckets} />
          </tbody>
        </table>
      </div>

      <p className='text-muted-foreground border-t px-5 py-3 text-[12px] leading-relaxed'>
        Read the two balance rows together. The first is where inventory is heading on stock and existing orders alone.
        The second is where it would head if every order the plan proposes were actually placed — including the ones
        whose release week has already passed, which is why the release row above it matters. Showing only the second is
        how a planning screen hides a problem behind its own answer.
      </p>
    </section>
  );
}

function Row({
  row,
  buckets,
  uom,
  onExplain,
}: {
  row: GridRow;
  buckets: ChartBucket[];
  uom: string;
  onExplain?: (anchor?: GridAnchor) => void;
}) {
  const emphasised = row.emphasis !== 'NONE';

  return (
    <tr
      className={cn(
        'grid-row',
        row.emphasis === 'BALANCE' && 'bg-muted/25',
        row.emphasis === 'ANSWER' && 'bg-primary/[0.06]',
        row.emphasis === 'THRESHOLD' && 'text-muted-foreground',
      )}
    >
      <th
        scope='row'
        className={cn(
          'bg-card sticky left-0 z-10 grid-cell border-border/60 border-r text-left font-normal',
          row.indent === 1 && 'text-muted-foreground pl-6 text-[12px] italic',
          emphasised && row.indent === 0 && 'font-medium',
        )}
      >
        {row.note ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className='decoration-muted-foreground/40 cursor-help underline decoration-dotted underline-offset-2'>
                {row.label}
              </span>
            </TooltipTrigger>
            <TooltipContent className='max-w-[320px]'>{row.note}</TooltipContent>
          </Tooltip>
        ) : (
          row.label
        )}
      </th>

      {buckets.map((bucket, position) => {
        const value = row.values[position] ?? 0;
        // A balance below safety stock is a breach on either balance row, not
        // only on the honest one — the row that shows the plan's own answer has
        // to admit when the answer still leaves the buffer broken.
        const isBalance = row.tone === 'NEGATIVE_IS_BAD';
        const bad = isBalance && (value < 0 || value < bucket.safetyStock);
        const annotations = row.cells?.[position] ?? [];

        // Every cell opens its own explanation. The claim was in this file's
        // docstring for a long time before any `<td>` could act on it.
        const explainThis = onExplain
          ? () =>
              onExplain({
                row: row.key,
                fromDate: bucket.startDate,
                toDate: bucket.endDate,
                label: `${row.label}, ${bucket.kind === 'DAY' ? bucket.label : bucket.week}`,
              })
          : undefined;

        if (row.cells) {
          return (
            <td
              key={bucket.index}
              className={cn(
                'grid-cell num whitespace-nowrap',
                bucket.startsZone && position > 0 && 'border-border border-l',
                annotations.length === 0 && 'text-muted-foreground/45',
              )}
            >
              {annotations.length === 0 ? '—' : <ReleaseCells cells={annotations} uom={uom} />}
            </td>
          );
        }

        return (
          <td
            key={bucket.index}
            className={cn(
              'grid-cell num whitespace-nowrap p-0',
              bucket.startsZone && position > 0 && 'border-border border-l',
            )}
          >
            <button
              type='button'
              onClick={explainThis}
              aria-label={`Explain ${row.label} in ${bucket.week}`}
              className={cn(
                'hover:bg-primary/[0.07] focus-visible:ring-ring block h-full w-full px-2 py-1 text-right tabular-nums focus-visible:ring-2 focus-visible:outline-none',
                emphasised && 'font-medium',
                bad && 'text-status-critical',
                value === 0 && 'text-muted-foreground/45',
              )}
            >
              {value === 0 ? '—' : formatNumber(value)}
            </button>
          </td>
        );
      })}
      <td className='sr-only'>{uom}</td>
    </tr>
  );
}

/**
 * The week an order had to be released, under the week it is needed.
 *
 * More than one can share a bucket: a requirement above the maximum lot is cut
 * into several orders, and each has its own release date. They are listed
 * rather than merged, because "two parcels, both already late" is a different
 * sentence from "one parcel, already late".
 */
function ReleaseCells({ cells, uom }: { cells: GridCell[]; uom: string }) {
  return (
    <span className='inline-flex flex-col items-end gap-0.5'>
      {cells.map((cell, index) => (
        <Tooltip key={`${cell.releaseDate}-${index}`}>
          <TooltipTrigger asChild>
            <span
              className={cn(
                'cursor-help whitespace-nowrap',
                cell.tone === 'PAST' ? 'text-status-critical font-semibold' : 'text-foreground',
              )}
            >
              {cell.text}
              {cell.tone === 'PAST' ? ' ⚠' : ''}
            </span>
          </TooltipTrigger>
          <TooltipContent className='max-w-[300px]'>
            {formatNumber(cell.qty)} {uom} has to be released on {cell.releaseDate} to land in this bucket.{' '}
            {cell.tone === 'PAST'
              ? `That date passed ${cell.weeksLate} ${cell.weeksLate === 1 ? 'week' : 'weeks'} ago, so this order cannot be placed in time. It is shown rather than dropped, because the fact that it is late is the point.`
              : 'That date is still ahead, so this one can still be placed.'}
          </TooltipContent>
        </Tooltip>
      ))}
    </span>
  );
}

/** Status carries a word, never colour alone. Planners print these screens. */
function StatusRow({ buckets }: { buckets: ChartBucket[] }) {
  return (
    <tr className='grid-row'>
      <th scope='row' className='bg-card sticky left-0 z-10 grid-cell border-border/60 border-r text-left font-medium'>
        Status
      </th>
      {buckets.map((bucket) => (
        <td
          key={bucket.index}
          className={cn(
            'grid-cell text-right text-[11px] font-medium whitespace-nowrap',
            bucket.startsZone && bucket.index > 0 && 'border-border border-l',
            bucket.status === 'STOCK_OUT' && 'text-status-critical',
            bucket.status === 'BREACH' && 'text-status-attention',
            bucket.status === 'TIGHT' && 'text-muted-foreground',
            bucket.status === 'OK' && 'text-status-settled',
            bucket.status === 'EXCESS' && 'text-muted-foreground',
          )}
        >
          {STATUS_WORD[bucket.status]}
        </td>
      ))}
    </tr>
  );
}

/**
 * Rolls the daily buckets up into the weeks they belong to.
 *
 * A flow sums and a level takes the closing value — the one rule that is not
 * cosmetic, because summing a stock balance across seven days reports seven
 * times the stock and reports it confidently. Each row carries which it is, so
 * this does not have to guess.
 */
function collapseToWeeks(detail: MaterialDetail): { buckets: ChartBucket[]; rows: GridRow[] } {
  const groups: number[][] = [];
  const order: string[] = [];
  const byWeek = new Map<string, number[]>();

  for (const bucket of detail.buckets) {
    const existing = byWeek.get(bucket.week);
    if (existing) existing.push(bucket.index);
    else {
      byWeek.set(bucket.week, [bucket.index]);
      order.push(bucket.week);
    }
  }
  for (const week of order) groups.push(byWeek.get(week) as number[]);

  const buckets: ChartBucket[] = groups.map((indexes, position) => {
    const first = detail.buckets[indexes[0] as number] as ChartBucket;
    const last = detail.buckets[indexes[indexes.length - 1] as number] as ChartBucket;
    const members = indexes.map((index) => detail.buckets[index] as ChartBucket);
    // The week takes the worst status any day in it reached: a mid-week dip a
    // closing balance hides is exactly what a weekly view must not lose.
    const severity: Array<ChartBucket['status']> = ['STOCK_OUT', 'BREACH', 'TIGHT', 'EXCESS', 'OK'];
    const status = severity.find((value) => members.some((member) => member.status === value)) ?? 'OK';

    return {
      ...last,
      index: position,
      kind: 'WEEK',
      label: first.week,
      startDate: first.startDate,
      endDate: last.endDate,
      startsZone: members.some((member) => member.startsZone) && position > 0,
      demand: members.reduce((sum, member) => sum + member.demand, 0),
      confirmed: members.reduce((sum, member) => sum + member.confirmed, 0),
      committed: members.reduce((sum, member) => sum + member.committed, 0),
      planned: members.reduce((sum, member) => sum + member.planned, 0),
      qaRelease: members.reduce((sum, member) => sum + member.qaRelease, 0),
      status,
    };
  });

  const rows: GridRow[] = detail.grid.map((row) => ({
    ...row,
    values: groups.map((indexes) =>
      row.aggregate === 'SUM'
        ? indexes.reduce((sum, index) => sum + (row.values[index] ?? 0), 0)
        : (row.values[indexes[indexes.length - 1] as number] ?? 0),
    ),
    // Annotations concatenate — a week holds every release date its days held.
    // Dropping them here is how the "W26, ten weeks ago" beat would vanish the
    // moment the grid was switched to weeks, which is how it is usually read.
    ...(row.cells ? { cells: groups.map((indexes) => indexes.flatMap((index) => row.cells?.[index] ?? [])) } : {}),
  }));

  return { buckets, rows };
}
