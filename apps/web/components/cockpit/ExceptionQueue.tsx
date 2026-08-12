'use client';

/**
 * The exception queue.
 *
 * Sorted by money by default, because that is the product's argument. Rows are
 * virtualised — the queue is well over a thousand rows and a planner scrolls it
 * the way a trader scrolls a book, so it has to stay smooth.
 */

import { EXCEPTION_LABELS, formatCurrency, formatDateShort, formatNumber, formatPercent } from '@repo/domain';
import { Badge } from '@repo/ui/components/badge';
import { Button } from '@repo/ui/components/button';
import { Skeleton } from '@repo/ui/components/skeleton';
import { cn } from '@repo/ui/lib/utils';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, ExternalLink, Network } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';

import type { ExceptionQueryResult, ExceptionRow } from '@/lib/api-types';
import { Sparkline } from './Sparkline';

const ROW_HEIGHT = 30;
const EXPANDED_HEIGHT = 128;

const COLUMNS = [
  { key: 'impact', label: 'Impact', className: 'w-[92px] text-right' },
  { key: 'code', label: 'Code', className: 'w-[132px]' },
  { key: 'item', label: 'Item', className: 'w-[112px]' },
  { key: 'description', label: 'Description', className: 'flex-1 min-w-[180px]' },
  { key: 'plant', label: 'Site', className: 'w-[52px]' },
  { key: 'need', label: 'Need date', className: 'w-[84px]' },
  { key: 'days', label: 'Days', className: 'w-[52px] text-right' },
  { key: 'class', label: 'ABC/XYZ', className: 'w-[64px]' },
  { key: 'fg', label: 'FG', className: 'w-[40px] text-right' },
  { key: 'resolution', label: 'Best resolution', className: 'w-[220px]' },
  { key: 'confidence', label: 'Conf.', className: 'w-[52px] text-right' },
] as const;

export function ExceptionQueue({ data, isLoading }: { data: ExceptionQueryResult | undefined; isLoading: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = data?.rows ?? [];
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      (rows[index] as ExceptionRow | undefined)?.id === expanded ? ROW_HEIGHT + EXPANDED_HEIGHT : ROW_HEIGHT,
    overscan: 12,
  });

  if (isLoading && rows.length === 0) {
    return (
      <div className='space-y-px p-2'>
        {Array.from({ length: 14 }).map((_, index) => (
          <Skeleton key={index} className='h-[30px] w-full rounded-none' />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className='text-muted-foreground flex h-64 flex-col items-center justify-center gap-1 text-[13px]'>
        <span className='font-medium'>Nothing matches those filters.</span>
        <span>Clear one to widen the queue.</span>
      </div>
    );
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='bg-muted/40 flex border-b'>
        {COLUMNS.map((column) => (
          <div key={column.key} className={cn('grid-head', column.className)}>
            {column.label}
          </div>
        ))}
        <div className='grid-head w-[76px]' />
      </div>

      <div ref={scrollRef} className='min-h-0 flex-1 overflow-auto'>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index] as ExceptionRow;
            const isExpanded = expanded === row.id;
            return (
              <div
                key={row.id}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <QueueRow row={row} isExpanded={isExpanded} onToggle={() => setExpanded(isExpanded ? null : row.id)} />
              </div>
            );
          })}
        </div>
      </div>

      <div className='text-muted-foreground flex items-center gap-3 border-t px-3 py-1.5 text-[11.5px]'>
        <span>
          <span className='mono text-foreground'>{formatNumber(rows.length)}</span> shown of{' '}
          <span className='mono text-foreground'>{formatNumber(data?.total ?? 0)}</span>
        </span>
        <span className='text-border'>·</span>
        <span>
          <span className='mono text-foreground'>{formatCurrency(data?.filteredExposure ?? 0)}</span> exposure in this
          view
        </span>
      </div>
    </div>
  );
}

function QueueRow({ row, isExpanded, onToggle }: { row: ExceptionRow; isExpanded: boolean; onToggle: () => void }) {
  return (
    <div className={cn('grid-row bg-background hover:bg-muted/40', isExpanded && 'bg-muted/30')}>
      <div
        className='flex cursor-pointer items-center'
        onClick={onToggle}
        role='button'
        tabIndex={0}
        onKeyDown={(event) => event.key === 'Enter' && onToggle()}
      >
        <div className='grid-cell num w-[92px] font-semibold'>{formatCurrency(row.impactValue)}</div>
        <div className='grid-cell w-[132px]'>
          <span className={cn('mono rounded-[3px] border px-1 py-px text-[10.5px]', severityClass(row.severity))}>
            {row.code.split('-')[0]}
          </span>
          <span className='text-muted-foreground ml-1.5 text-[11.5px]'>{EXCEPTION_LABELS[row.code]}</span>
        </div>
        <div className='grid-cell mono w-[112px] text-[12px]'>{row.itemId}</div>
        <div className='grid-cell text-muted-foreground min-w-[180px] flex-1 truncate'>{row.itemDescription}</div>
        <div className='grid-cell mono w-[52px]'>{row.plantId}</div>
        <div className='grid-cell mono w-[84px] text-[12px]'>{row.needDate ? formatDateShort(row.needDate) : '—'}</div>
        <div className='grid-cell num w-[52px]'>{row.daysToImpact ?? '—'}</div>
        <div className='grid-cell mono w-[64px] text-[11.5px]'>
          {row.abcClass}/{row.xyzClass}
        </div>
        <div className='grid-cell num w-[40px]'>{row.peggedFgCount || '—'}</div>
        <div className='grid-cell text-muted-foreground w-[220px] truncate text-[12px]'>
          {row.bestResolutionLabel ?? '—'}
        </div>
        <div className='grid-cell num w-[52px]'>
          {row.bestResolutionConfidence ? formatPercent(row.bestResolutionConfidence, 0) : '—'}
        </div>
        <div className='grid-cell flex w-[76px] items-center gap-1'>
          {row.autoResolvable ? (
            <Badge variant='secondary' className='h-4 px-1 text-[9.5px] font-medium'>
              AUTO
            </Badge>
          ) : null}
          {isExpanded ? (
            <ChevronDown className='size-3.5 opacity-60' />
          ) : (
            <ChevronRight className='size-3.5 opacity-40' />
          )}
        </div>
      </div>

      {isExpanded ? (
        <div className='bg-muted/20 flex gap-4 border-t px-3 py-2.5'>
          <div className='min-w-0 flex-1'>
            <p className='text-[12.5px] leading-[18px]'>{row.narrative}</p>
            <div className='mt-2 flex gap-1.5'>
              <Button asChild size='sm' variant='default' className='h-6 gap-1 px-2 text-[11.5px]'>
                <Link href={`/exceptions/${encodeURIComponent(row.id)}`}>Open workbench</Link>
              </Button>
              <Button asChild size='sm' variant='outline' className='h-6 gap-1 px-2 text-[11.5px]'>
                <Link href={`/item/${encodeURIComponent(row.itemId)}/${encodeURIComponent(row.plantId)}`}>
                  <ExternalLink className='size-3' />
                  Item 360
                </Link>
              </Button>
              {row.peggedFgCount > 0 ? (
                <Button asChild size='sm' variant='outline' className='h-6 gap-1 px-2 text-[11.5px]'>
                  <Link href={`/blast/${encodeURIComponent(row.id)}`}>
                    <Network className='size-3' />
                    Blast radius
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
          <div className='w-64 shrink-0'>
            <div className='text-muted-foreground mb-1 text-[10.5px] font-medium tracking-wide uppercase'>
              Projected balance · orderable supply only
            </div>
            <Sparkline values={row.sparkline} showZero className='h-14 w-full' />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function severityClass(severity: ExceptionRow['severity']): string {
  switch (severity) {
    case 'CRITICAL':
      return 'sev-critical';
    case 'HIGH':
      return 'sev-high';
    case 'MEDIUM':
      return 'sev-medium';
    default:
      return 'sev-low';
  }
}
