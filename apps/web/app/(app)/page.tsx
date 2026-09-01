'use client';

/**
 * Screen 1 — the planning position.
 *
 * "What needs me today?", answered in thirty seconds. Six tiles that filter,
 * a drift panel that says what moved since Friday, and a table sorted by time
 * to breach.
 *
 * The drift panel is placed above the table rather than beside it because it is
 * the part most likely to change a planner's daily behaviour: it is the direct
 * answer to rebuilding the position in a spreadsheet every Monday morning.
 */

import { formatCurrency, formatDateFull, formatNumber } from '@repo/domain';
import { Skeleton } from '@repo/ui/components/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { cn } from '@repo/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import type { DriftRow, PlanningPosition, PositionRow, PositionTile } from '@/lib/api-types';
import { TierBadge } from '@/components/planning/TierBadge';
import { useViewState } from '@/lib/view-state';

export default function PositionPage() {
  const { plantId } = useViewState();
  const [tile, setTile] = useState<PositionTile['key'] | null>(null);
  const [search, setSearch] = useState('');

  const query = useQuery({
    queryKey: ['position', plantId, tile, search],
    queryFn: async (): Promise<PlanningPosition> => {
      const params = new URLSearchParams();
      if (plantId) params.set('plant', plantId);
      if (tile) params.set('tile', tile);
      if (search) params.set('search', search);
      const response = await fetch(`/api/position?${params.toString()}`);
      if (!response.ok) throw new Error('The position could not be loaded.');
      return response.json();
    },
  });

  if (!query.data) {
    return (
      <Shell>
        <Skeleton className='h-8 w-80' />
        <div className='mt-6 grid grid-cols-6 gap-4'>
          {[0, 1, 2, 3, 4, 5].map((key) => (
            <Skeleton key={key} className='h-24 rounded-lg' />
          ))}
        </div>
        <Skeleton className='mt-6 h-[520px] rounded-lg' />
      </Shell>
    );
  }

  const { header, tiles, drift, rows, total } = query.data;

  return (
    <Shell>
      <header className='mb-6'>
        <h1 className='text-[20px] font-semibold tracking-tight'>Planning position</h1>
        <p className='text-muted-foreground mt-1 text-[13px]'>
          {header.runType} as at {formatDateFull(header.planningDate)} ({header.planningWeek}) · {header.mpsVersion} ·{' '}
          {header.category} · {formatNumber(header.materialsPlanned)} materials planned across {header.horizonDays} days
          · computed in {header.elapsedMs} ms
        </p>
      </header>

      {/* Six tiles. Each is a filter, not a decoration. */}
      <section className='grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6'>
        {tiles.map((row) => (
          <Tile
            key={row.key}
            tile={row}
            active={tile === row.key}
            onSelect={() => setTile(tile === row.key ? null : row.key)}
          />
        ))}
      </section>

      <DriftPanel rows={drift} />

      <section className='bg-card mt-6 rounded-lg border'>
        <div className='flex items-center justify-between gap-4 border-b px-5 py-3'>
          <div>
            <h2 className='text-[14px] font-semibold'>Materials</h2>
            <p className='text-muted-foreground text-[12px]'>
              Sorted by time to breach — not by material code. {formatNumber(total)} shown
              {tile ? `, filtered to ${tiles.find((row) => row.key === tile)?.label.toLowerCase()}` : ''}.
            </p>
          </div>
          <label className='relative'>
            <Search className='text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2' />
            <span className='sr-only'>Search materials</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder='Material or description'
              className='border-input bg-background h-8 w-64 rounded-md border pl-8 text-[13px]'
            />
          </label>
        </div>
        <MaterialTable rows={rows} />
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className='mx-auto max-w-[1680px] px-6 py-6'>{children}</div>;
}

function Tile({ tile, active, onSelect }: { tile: PositionTile; active: boolean; onSelect: () => void }) {
  const isCount = tile.key !== 'PLANNED';
  return (
    <button
      type='button'
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        'bg-card rounded-lg border px-4 py-3 text-left transition-colors',
        active ? 'border-primary ring-primary/30 ring-1' : 'hover:bg-muted/40',
      )}
    >
      <p className='text-muted-foreground text-[11px] font-medium tracking-[0.03em] uppercase'>{tile.label}</p>
      <p
        className={cn(
          'mt-1.5 text-[28px] leading-none font-semibold tracking-[-0.02em] tabular-nums',
          isCount && tile.count > 0 && (tile.key === 'STOCKOUTS' || tile.key === 'UNREACHABLE')
            ? 'text-status-critical'
            : isCount && tile.count > 0 && (tile.key === 'BREACHES' || tile.key === 'UNCONFIRMED')
              ? 'text-status-attention'
              : '',
        )}
      >
        {formatNumber(tile.count)}
      </p>
      <p className='text-muted-foreground mt-1.5 text-[11px] leading-snug'>{tile.note}</p>
    </button>
  );
}

/**
 * What changed since the previous run.
 *
 * Every row names its cause, because "your cover moved" is a shrug and "a
 * delivery line moved out fourteen days" is a phone call.
 */
function DriftPanel({ rows }: { rows: DriftRow[] }) {
  const material = rows.filter((row) => Math.abs(row.coverLost) >= 0.5);
  if (material.length === 0) return null;

  const worst = material[0] as DriftRow;

  return (
    <section className='bg-card mt-6 rounded-lg border'>
      <div className='flex items-baseline gap-3 border-b px-5 py-3'>
        <h2 className='text-[14px] font-semibold'>What changed since the last run</h2>
        <p className='text-muted-foreground text-[12px]'>
          {material.length} {material.length === 1 ? 'material' : 'materials'} moved materially — the worst lost{' '}
          {worst.coverLost.toFixed(1)} days of cover.
        </p>
      </div>
      <div className='overflow-x-auto'>
        <table className='w-full min-w-[900px]'>
          <thead>
            <tr className='bg-surface-sunken border-b'>
              <Th>Material</Th>
              <Th>Cause</Th>
              <Th>What happened</Th>
              <Th align='right'>Cover then</Th>
              <Th align='right'>Cover now</Th>
              <Th align='right'>Days lost</Th>
              <Th>First breach moved</Th>
            </tr>
          </thead>
          <tbody>
            {material.slice(0, 8).map((row) => (
              <tr key={`${row.itemId}-${row.plantId}-${row.cause}`} className='grid-row hover:bg-muted/30'>
                <td className='grid-cell'>
                  <Link
                    href={`/material/${encodeURIComponent(row.itemId)}/${encodeURIComponent(row.plantId)}`}
                    className='hover:text-primary font-medium hover:underline'
                  >
                    {row.itemId}
                  </Link>
                  <span className='text-muted-foreground ml-2'>{row.description}</span>
                </td>
                <td className='grid-cell text-[12px]'>{row.causeLabel}</td>
                <td className='text-muted-foreground grid-cell text-[12px]'>{row.detail}</td>
                <td className='grid-cell num'>{row.coverBefore.toFixed(1)}</td>
                <td className='grid-cell num'>{row.coverAfter.toFixed(1)}</td>
                <td className={cn('grid-cell num font-medium', row.coverLost > 0 ? 'text-status-critical' : '')}>
                  {row.coverLost > 0 ? (
                    <span className='inline-flex items-center gap-1'>
                      <ArrowDownRight className='size-3' />
                      {row.coverLost.toFixed(1)}
                    </span>
                  ) : (
                    row.coverLost.toFixed(1)
                  )}
                </td>
                <td className='grid-cell text-[12px]'>
                  {row.breachBefore === null && row.breachAfter === null ? (
                    <span className='text-muted-foreground'>No breach either way</span>
                  ) : (
                    <>
                      <span className='text-muted-foreground'>{row.breachBefore ?? 'none'}</span>
                      <span className='text-muted-foreground mx-1.5'>→</span>
                      <span className={row.breachAfter ? 'text-status-critical font-medium' : ''}>
                        {row.breachAfter ?? 'none'}
                      </span>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MaterialTable({ rows }: { rows: PositionRow[] }) {
  if (rows.length === 0) {
    return <p className='text-muted-foreground px-5 py-8 text-[13px]'>Nothing matches that filter.</p>;
  }

  return (
    <div className='overflow-x-auto'>
      <table className='w-full min-w-[1180px]'>
        <thead>
          <tr className='bg-surface-sunken border-b'>
            <Th>Material</Th>
            <Th>Description</Th>
            <Th>Plant</Th>
            <Th>Type</Th>
            <Th align='right'>First breach</Th>
            <Th align='right'>Days out</Th>
            <Th align='right'>Cover today</Th>
            <Th align='right'>Quantity at risk</Th>
            <Th align='right'>Value at risk</Th>
            <Th>Next receipt</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.itemId}-${row.plantId}`} className='grid-row hover:bg-muted/30'>
              <td className='grid-cell'>
                <Link
                  href={`/material/${encodeURIComponent(row.itemId)}/${encodeURIComponent(row.plantId)}`}
                  className='hover:text-primary font-mono text-[12px] font-medium hover:underline'
                >
                  {row.itemId}
                </Link>
              </td>
              <td className='grid-cell max-w-[280px] truncate'>{row.description}</td>
              <td className='text-muted-foreground grid-cell text-[12px]'>{row.plantId}</td>
              <td className='text-muted-foreground grid-cell text-[12px]'>{row.itemType}</td>
              <td className='grid-cell num'>
                {row.firstBreachDate ? (
                  <span>
                    {row.firstBreachWeek}
                    <span className='text-muted-foreground ml-1.5 text-[11px]'>{row.firstBreachDate.slice(5)}</span>
                  </span>
                ) : (
                  <span className='text-muted-foreground'>—</span>
                )}
              </td>
              <td className='grid-cell num'>{row.daysToBreach ?? '—'}</td>
              <td className='grid-cell num'>{row.daysOfCover.toFixed(1)}</td>
              <td className='grid-cell num'>
                {row.qtyAtRisk > 0 ? (
                  <>
                    {formatNumber(row.qtyAtRisk)}
                    <span className='text-muted-foreground ml-1 text-[11px]'>{row.baseUom}</span>
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td className='grid-cell num'>{row.valueAtRisk > 0 ? formatCurrency(row.valueAtRisk) : '—'}</td>
              <td className='grid-cell'>
                {row.nextReceipt ? (
                  <span className='flex items-center gap-2'>
                    <span className='text-[12px] tabular-nums'>{row.nextReceipt.week}</span>
                    <TierBadge tier={row.nextReceipt.tier} />
                  </span>
                ) : (
                  <span className='text-muted-foreground text-[12px]'>Nothing on order</span>
                )}
              </td>
              <td className='grid-cell'>
                <StatusPill row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Colour never carries meaning alone: every status has a word beside it. */
function StatusPill({ row }: { row: PositionRow }) {
  const tone =
    row.status === 'STOCK_OUT' || row.status === 'UNREACHABLE'
      ? 'bg-status-critical/12 text-status-critical'
      : row.status === 'BREACH'
        ? 'bg-status-attention/15 text-status-attention'
        : row.status === 'EXCESS'
          ? 'bg-muted text-muted-foreground'
          : 'bg-status-settled/12 text-status-settled';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', tone)}>
          {row.statusLabel}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {row.reachableByOrdering
          ? 'An order placed now can still reach this.'
          : 'Inside the lead-time fence — no order placed today can reach it.'}
      </TooltipContent>
    </Tooltip>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={cn('grid-head', align === 'right' ? 'text-right' : 'text-left')}>{children}</th>;
}
