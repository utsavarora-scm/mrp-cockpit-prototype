'use client';

/**
 * The time-phased grid — the MD04 replacement.
 *
 * Daily buckets, collapsible to weekly, with gross requirements expandable by
 * demand type and source system and receipts expandable by supply element. The
 * balance rows carry the emphasis, because that is the line a planner reads
 * first and everything else is working.
 */

import { formatDateShort, formatQty } from '@repo/domain';
import { Button } from '@repo/ui/components/button';
import { cn } from '@repo/ui/lib/utils';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import type { ItemDetail, TimePhasedRow } from '@/lib/api-types';

const LABEL_WIDTH = 260;
const CELL_WIDTH = 74;

export function TimePhasedGrid({ detail }: { detail: ItemDetail }) {
  const [weekly, setWeekly] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const buckets = weekly
    ? toWeekly(detail.dates)
    : detail.dates.map((date, index) => ({ label: formatDateShort(date), days: [index] }));

  const toggle = (key: string) => {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpanded(next);
  };

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex items-center gap-2 border-y px-3 py-1.5'>
        <span className='text-[11px] font-medium tracking-wide uppercase'>Time-phased plan</span>
        <div className='ml-auto flex gap-0.5'>
          <Button
            variant={weekly ? 'default' : 'ghost'}
            size='sm'
            className='h-6 px-2 text-[11.5px]'
            onClick={() => setWeekly(true)}
          >
            Weekly
          </Button>
          <Button
            variant={weekly ? 'ghost' : 'default'}
            size='sm'
            className='h-6 px-2 text-[11.5px]'
            onClick={() => setWeekly(false)}
          >
            Daily
          </Button>
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-auto'>
        <table className='border-separate border-spacing-0 text-[12px]'>
          <thead className='sticky top-0 z-10'>
            <tr>
              <th
                className='grid-head bg-muted/60 sticky left-0 z-20 border-b text-left'
                style={{ minWidth: LABEL_WIDTH, width: LABEL_WIDTH }}
              >
                Row
              </th>
              {buckets.map((bucket) => (
                <th
                  key={bucket.label}
                  className='grid-head bg-muted/60 border-b text-right'
                  style={{ minWidth: CELL_WIDTH }}
                >
                  {bucket.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {detail.grid.map((row) => (
              <GridRows
                key={row.key}
                row={row}
                buckets={buckets}
                uom={detail.baseUom}
                expanded={expanded}
                onToggle={toggle}
                safetyStock={detail.safetyStock}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface Bucket {
  label: string;
  days: number[];
}

function GridRows({
  row,
  buckets,
  uom,
  expanded,
  onToggle,
  safetyStock,
  depth = 0,
}: {
  row: TimePhasedRow;
  buckets: Bucket[];
  uom: string;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  safetyStock: number;
  depth?: number;
}) {
  const hasChildren = (row.children?.length ?? 0) > 0;
  const isOpen = expanded.has(row.key);

  return (
    <>
      <tr className={cn('hover:bg-muted/40', row.emphasis === 'BALANCE' && 'font-medium')}>
        <td
          className='bg-background sticky left-0 z-10 border-b px-2 py-[5px]'
          style={{ minWidth: LABEL_WIDTH, width: LABEL_WIDTH, paddingLeft: 8 + depth * 14 }}
        >
          <div className='flex items-center gap-1'>
            {hasChildren ? (
              <button
                onClick={() => onToggle(row.key)}
                className='hover:bg-muted rounded-sm p-0.5'
                aria-label={isOpen ? `Collapse ${row.label}` : `Expand ${row.label}`}
              >
                {isOpen ? <ChevronDown className='size-3' /> : <ChevronRight className='size-3' />}
              </button>
            ) : (
              <span className='w-4' />
            )}
            <span className={cn('truncate', depth > 0 && 'text-muted-foreground text-[11.5px]')}>{row.label}</span>
          </div>
        </td>

        {buckets.map((bucket) => {
          const value = aggregate(row, bucket);
          return (
            <td
              key={bucket.label}
              className={cn(
                'num border-b px-2 py-[5px]',
                row.emphasis === 'BALANCE' && value < 0 && 'text-destructive font-semibold',
                row.emphasis === 'BALANCE' && value >= 0 && value < safetyStock && 'text-primary',
                row.emphasis === 'THRESHOLD' && 'text-muted-foreground',
              )}
            >
              {value === 0 ? <span className='text-muted-foreground/40'>—</span> : formatQty(value, undefined)}
            </td>
          );
        })}
      </tr>

      {isOpen
        ? row.children?.map((child) => (
            <GridRows
              key={child.key}
              row={child}
              buckets={buckets}
              uom={uom}
              expanded={expanded}
              onToggle={onToggle}
              safetyStock={safetyStock}
              depth={depth + 1}
            />
          ))
        : null}
    </>
  );
}

/**
 * Flows sum across a bucket; balances and thresholds take the closing value.
 * Summing a balance would be meaningless, and a grid that does it is a grid a
 * planner stops trusting.
 */
function aggregate(row: TimePhasedRow, bucket: Bucket): number {
  if (row.emphasis === 'BALANCE' || row.emphasis === 'THRESHOLD' || row.key === 'cover') {
    const lastDay = bucket.days[bucket.days.length - 1] ?? 0;
    return row.values[lastDay] ?? 0;
  }
  return bucket.days.reduce((sum, day) => sum + (row.values[day] ?? 0), 0);
}

function toWeekly(dates: string[]): Bucket[] {
  const buckets: Bucket[] = [];
  for (let start = 0; start < dates.length; start += 7) {
    const days: number[] = [];
    for (let offset = 0; offset < 7 && start + offset < dates.length; offset += 1) days.push(start + offset);
    buckets.push({ label: formatDateShort(dates[start] ?? ''), days });
  }
  return buckets;
}
