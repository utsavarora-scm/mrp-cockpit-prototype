'use client';

/**
 * Screen 4 — adherence.
 *
 * Three views of the same data: by line, by material, by vendor. The one that
 * changes the conversation is the interval split, which turns a twelve-day slip
 * into four separate slips with four different owners — two of which routinely
 * belong to the buyer rather than the supplier.
 *
 * The screen states its own boundary out loud. It measures; it does not score
 * anyone, propose a lead time or touch master data. Keeping that line visible
 * is what makes the measurement trustworthy enough to act on later.
 */

import { formatCurrency, formatNumber, formatPercent } from '@repo/domain';
import { Skeleton } from '@repo/ui/components/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/tabs';

import { LoadError } from '@/components/general/LoadError';
import { CaptureDialog } from '@/components/adherence/CaptureDialog';
import { cn } from '@repo/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import Link from 'next/link';

import type { AdherenceView, Distribution, IntervalSlip } from '@/lib/api-types';
import { useViewState } from '@/lib/view-state';

export default function AdherencePage() {
  const { plantId } = useViewState();
  const [capturing, setCapturing] = useState<AdherenceView['lines'][number] | null>(null);

  const query = useQuery({
    queryKey: ['adherence', plantId],
    queryFn: async (): Promise<AdherenceView> => {
      const params = new URLSearchParams();
      if (plantId) params.set('plant', plantId);
      const response = await fetch(`/api/adherence?${params.toString()}`);
      if (!response.ok) throw new Error('Adherence could not be loaded.');
      return response.json();
    },
  });

  if (query.isError && !query.data) {
    return (
      <Shell>
        <LoadError
          message='Adherence could not be loaded.'
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </Shell>
    );
  }

  if (!query.data) {
    return (
      <Shell>
        <Skeleton className='h-8 w-72' />
        <Skeleton className='mt-6 h-[560px] rounded-lg' />
      </Shell>
    );
  }

  const view = query.data;

  return (
    <Shell>
      <header className='mb-5'>
        <h1 className='text-[20px] font-semibold tracking-tight'>Adherence</h1>
        <p className='text-muted-foreground mt-1 max-w-4xl text-[13px] leading-relaxed'>
          The schedule builder says what was asked for. This says what happened — and splits every slip across the four
          intervals a lead time is actually made of, because &ldquo;the supplier was late&rdquo; is usually four
          different problems with four different owners.
        </p>
      </header>

      <Tabs defaultValue='material'>
        <TabsList>
          <TabsTrigger value='material'>By material</TabsTrigger>
          <TabsTrigger value='vendor'>By vendor</TabsTrigger>
          <TabsTrigger value='line'>By line</TabsTrigger>
        </TabsList>

        <TabsContent value='material' className='mt-4'>
          <ByMaterial view={view} />
        </TabsContent>
        <TabsContent value='vendor' className='mt-4'>
          <ByVendor view={view} />
        </TabsContent>
        <TabsContent value='line' className='mt-4'>
          <ByLine view={view} onCapture={setCapturing} />
        </TabsContent>
      </Tabs>

      <section className='mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.4fr]'>
        <div className='bg-card rounded-lg border'>
          <div className='border-b px-5 py-3'>
            <h2 className='text-[14px] font-semibold'>Reason codes</h2>
            <p className='text-muted-foreground text-[12px]'>
              A deviation with no reason is a number; a deviation with a reason is a pattern.
            </p>
          </div>
          <ul className='divide-border divide-y'>
            {view.reasonCodes
              .filter((row) => row.count > 0)
              .map((row) => (
                <li key={row.code} className='flex items-baseline justify-between gap-3 px-5 py-2'>
                  <span className='text-[13px]'>{row.label}</span>
                  <span className='flex items-baseline gap-3'>
                    <span className='text-muted-foreground text-[11px]'>{row.owner}</span>
                    <span className='w-10 text-right text-[13px] font-medium tabular-nums'>{row.count}</span>
                  </span>
                </li>
              ))}
          </ul>
        </div>

        <div className='bg-card rounded-lg border p-5'>
          <h2 className='text-[14px] font-semibold'>What this screen does not do</h2>
          <p className='text-muted-foreground mt-1.5 text-[13px] leading-relaxed'>{view.boundary}</p>
          <p className='text-muted-foreground mt-3 text-[13px] leading-relaxed'>
            Every decision recorded here — what was asked for, what was committed, what actually arrived, and why it
            moved — is the dataset that does not exist today. After one ordering cycle it is what tells you what your
            lead times and safety stocks should actually be.
          </p>
        </div>
      </section>

      {capturing ? (
        <CaptureDialog
          target={{
            itemId: capturing.itemId,
            plantId: capturing.plantId,
            orderId: capturing.poId,
            line: capturing.line,
            baseUom: capturing.baseUom,
            requestedDate: capturing.requestedDate,
            confirmedDate: capturing.committedDate,
            grnDate: capturing.grnDate,
            grnQty: capturing.receivedQty,
            qaReleasedOn: capturing.qaReleasedOn,
            reasonCode: capturing.reasonCode,
          }}
          onClose={() => setCapturing(null)}
        />
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className='mx-auto max-w-[1680px] px-6 py-6'>{children}</div>;
}

function ByMaterial({ view }: { view: AdherenceView }) {
  // The decomposition follows the row you are looking at. Pinned to the first
  // one it silently described a different material from the one being read.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = view.byMaterial.find((row) => `${row.itemId}@${row.plantId}` === selectedId) ?? view.byMaterial[0];

  return (
    <div className='bg-card rounded-lg border'>
      <div className='border-b px-5 py-3'>
        <h2 className='text-[14px] font-semibold'>By material</h2>
        <p className='text-muted-foreground text-[12px]'>
          A distribution rather than an average — 104 days reliably is not the same fact as 104 as a coin toss between
          88 and 121.
        </p>
      </div>
      <div className='overflow-x-auto'>
        <table className='w-full min-w-[1080px]'>
          <thead>
            <tr className='bg-surface-sunken border-b'>
              <Th>Material</Th>
              <Th>Description</Th>
              <Th align='right'>Maintained</Th>
              <Th align='right'>Measured</Th>
              <Th align='right'>Drift</Th>
              <Th align='right'>Spread</Th>
              <Th align='right'>Receipts</Th>
              <Th align='right'>Fill</Th>
              <Th>Spread of observations</Th>
            </tr>
          </thead>
          <tbody>
            {view.byMaterial.slice(0, 40).map((row) => (
              <tr
                key={`${row.itemId}-${row.plantId}`}
                onClick={() => setSelectedId(`${row.itemId}@${row.plantId}`)}
                className={cn('grid-row hover:bg-muted/30 cursor-pointer', selected === row && 'bg-primary/[0.06]')}
              >
                <td className='grid-cell'>
                  <Link
                    href={`/material/${encodeURIComponent(row.itemId)}/${encodeURIComponent(row.plantId)}`}
                    className='hover:text-primary font-mono text-[12px] font-medium hover:underline'
                  >
                    {row.itemId}
                  </Link>
                </td>
                <td className='grid-cell max-w-[240px] truncate'>{row.description}</td>
                <td className='grid-cell num'>{row.maintainedDays ?? '—'} d</td>
                <td className='grid-cell num font-medium'>{row.distribution.meanDays} d</td>
                <td
                  className={cn(
                    'grid-cell num',
                    (row.driftDays ?? 0) > 0 ? 'text-status-critical' : 'text-status-settled',
                  )}
                >
                  {row.driftDays === null ? '—' : `${row.driftDays > 0 ? '+' : ''}${row.driftDays} d`}
                </td>
                <td className='grid-cell num'>±{row.distribution.stdDevDays} d</td>
                <td className='grid-cell num'>{row.distribution.count}</td>
                <td className='grid-cell num'>{formatPercent(row.fillRate, 1)}</td>
                <td className='grid-cell'>
                  <Histogram distribution={row.distribution} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected ? <IntervalPanel row={selected} /> : null}
    </div>
  );
}

/**
 * The decomposition, for the material with the widest drift.
 *
 * Placed under the table rather than behind a click because it is the finding,
 * not a detail: two thirds of a typical slip belongs to the buyer.
 */
function IntervalPanel({ row }: { row: AdherenceView['byMaterial'][number] }) {
  if (row.intervals.length === 0) return null;
  const totalMaintained = row.intervals.reduce((sum, interval) => sum + interval.maintainedDays, 0);
  const totalActual = row.intervals.reduce((sum, interval) => sum + interval.actualDays, 0);
  const buyerSlip = row.intervals
    .filter((interval) => interval.owner !== 'Vendor')
    .reduce((sum, interval) => sum + Math.max(0, interval.slipDays), 0);
  const totalSlip = row.intervals.reduce((sum, interval) => sum + Math.max(0, interval.slipDays), 0);

  return (
    <div className='border-t px-5 py-4'>
      <h3 className='text-[13px] font-semibold'>
        Where the time actually goes — {row.itemId}, {row.description}
      </h3>
      <table className='mt-2 w-full max-w-3xl'>
        <thead>
          <tr className='bg-surface-sunken'>
            <Th>Interval</Th>
            <Th align='right'>Maintained</Th>
            <Th align='right'>Actual</Th>
            <Th align='right'>Slip</Th>
            <Th>Owner</Th>
          </tr>
        </thead>
        <tbody>
          {row.intervals.map((interval: IntervalSlip) => (
            <tr key={interval.key} className='grid-row'>
              <td className='grid-cell'>{interval.label}</td>
              <td className='grid-cell num'>{interval.maintainedDays} d</td>
              <td className='grid-cell num'>{interval.actualDays} d</td>
              <td
                className={cn(
                  'grid-cell num font-medium',
                  interval.slipDays > 0 ? 'text-status-critical' : 'text-status-settled',
                )}
              >
                {interval.slipDays > 0 ? '+' : ''}
                {interval.slipDays}
              </td>
              <td className='text-muted-foreground grid-cell text-[12px]'>{interval.owner}</td>
            </tr>
          ))}
          <tr className='bg-surface-sunken font-medium'>
            <td className='grid-cell'>Total planning lead time</td>
            <td className='grid-cell num'>{totalMaintained} d</td>
            <td className='grid-cell num'>{Math.round(totalActual)} d</td>
            <td className='grid-cell num'>
              {Math.round(totalActual - totalMaintained) > 0 ? '+' : ''}
              {Math.round(totalActual - totalMaintained)}
            </td>
            <td className='grid-cell' />
          </tr>
        </tbody>
      </table>
      {totalSlip > 0 ? (
        <p className='text-muted-foreground mt-2 max-w-3xl text-[12px] leading-relaxed'>
          {formatPercent(buyerSlip / totalSlip, 0)} of the slip sits in intervals this business owns, not the
          supplier&rsquo;s — time lost before the vendor was told, and after the material had already arrived. That is
          not an accusation. It is a different set of fixes with a different set of owners, and none of them is chasing
          the vendor harder.
        </p>
      ) : null}
    </div>
  );
}

function ByVendor({ view }: { view: AdherenceView }) {
  return (
    <div className='bg-card rounded-lg border'>
      <div className='border-b px-5 py-3'>
        <h2 className='text-[14px] font-semibold'>By vendor</h2>
        <p className='text-muted-foreground text-[12px]'>
          Median and spread, beside the value they currently hold in the open book. A vendor with a lower price and
          double the spread is cheaper per unit and dearer in the buffer they force somebody else to carry.
        </p>
      </div>
      <div className='overflow-x-auto'>
        <table className='w-full min-w-[980px]'>
          <thead>
            <tr className='bg-surface-sunken border-b'>
              <Th>Vendor</Th>
              <Th align='right'>Materials</Th>
              <Th align='right'>Receipts</Th>
              <Th align='right'>Median</Th>
              <Th align='right'>Spread</Th>
              <Th align='right'>On time</Th>
              <Th align='right'>Fill</Th>
              <Th align='right'>Open book</Th>
              <Th>Spread of observations</Th>
            </tr>
          </thead>
          <tbody>
            {view.byVendor.slice(0, 25).map((row) => (
              <tr key={row.vendorId} className='grid-row hover:bg-muted/30'>
                <td className='grid-cell'>
                  <span className='font-mono text-[12px]'>{row.vendorId}</span>
                  <span className='text-muted-foreground ml-2 text-[12px]'>{row.vendorName}</span>
                </td>
                <td className='grid-cell num'>{row.materials}</td>
                <td className='grid-cell num'>{row.distribution.count}</td>
                <td className='grid-cell num font-medium'>{row.distribution.medianDays} d</td>
                <td className='grid-cell num'>±{row.distribution.stdDevDays} d</td>
                <td className='grid-cell num'>{formatPercent(row.onTimeRate, 0)}</td>
                <td className='grid-cell num'>{formatPercent(row.fillRate, 1)}</td>
                <td className='grid-cell num'>{formatCurrency(row.openBookValue)}</td>
                <td className='grid-cell'>
                  <Histogram distribution={row.distribution} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ByLine({
  view,
  onCapture,
}: {
  view: AdherenceView;
  onCapture: (row: AdherenceView['lines'][number]) => void;
}) {
  return (
    <div className='bg-card rounded-lg border'>
      <div className='border-b px-5 py-3'>
        <h2 className='text-[14px] font-semibold'>By line</h2>
        <p className='text-muted-foreground text-[12px]'>
          The permanent record behind every delivery — requested, committed, received, released, and why it moved.
        </p>
      </div>
      <div className='overflow-x-auto'>
        <table className='w-full min-w-[1180px]'>
          <thead>
            <tr className='bg-surface-sunken border-b'>
              <Th>Material</Th>
              <Th>Order · line</Th>
              <Th align='right'>Requested</Th>
              <Th>Requested date</Th>
              <Th>Vendor committed</Th>
              <Th>Goods receipt</Th>
              <Th>Quality released</Th>
              <Th align='right'>Deviation</Th>
              <Th>Reason</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {view.lines.slice(0, 60).map((row) => (
              <tr key={`${row.poId}-${row.line}`} className='grid-row hover:bg-muted/30'>
                <td className='grid-cell'>
                  <Link
                    href={`/material/${encodeURIComponent(row.itemId)}/${encodeURIComponent(row.plantId)}`}
                    className='hover:text-primary font-mono text-[12px] hover:underline'
                  >
                    {row.itemId}
                  </Link>
                </td>
                <td className='grid-cell font-mono text-[12px]'>
                  {row.poId} · {row.line}
                </td>
                <td className='grid-cell num'>
                  {formatNumber(row.requestedQty)}{' '}
                  <span className='text-muted-foreground text-[10px]'>{row.baseUom}</span>
                </td>
                <td className='grid-cell text-[12px]'>{row.requestedDate}</td>
                <td className='grid-cell text-[12px]'>
                  {row.committedDate ?? <span className='text-status-attention'>not acknowledged</span>}
                </td>
                <td className='grid-cell text-[12px]'>{row.grnDate ?? '—'}</td>
                <td className='grid-cell text-[12px]'>{row.qaReleasedOn ?? '—'}</td>
                <td className={cn('grid-cell num', (row.deviationDays ?? 0) > 0 && 'text-status-critical font-medium')}>
                  {row.deviationDays === null ? '—' : `${row.deviationDays > 0 ? '+' : ''}${row.deviationDays} d`}
                </td>
                <td className='text-muted-foreground grid-cell text-[11px]'>{row.reasonLabel ?? '—'}</td>
                <td className='grid-cell text-right'>
                  <button
                    type='button'
                    onClick={() => onCapture(row)}
                    className='text-primary text-[12px] font-medium hover:underline'
                  >
                    {row.grnDate ? 'Update' : 'Record'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className='text-muted-foreground border-t px-5 py-3 text-[12px] leading-relaxed'>
        Vendor committed date and dispatch date do not exist in a system today, so the planner records them — after the
        call they were already making. Recorded permanently: the log survives a restart, and a receipt recorded twice
        stays one receipt. That is enough to build the dataset, and it costs nothing nobody was already doing.
      </p>
    </div>
  );
}

/** The spread, drawn small. An average with no shape behind it hides the risk. */
function Histogram({ distribution }: { distribution: Distribution }) {
  const peak = Math.max(...distribution.buckets.map((bucket) => bucket.count), 1);
  return (
    <span className='flex h-6 items-end gap-px' title={`${distribution.minDays}–${distribution.maxDays} days`}>
      {distribution.buckets.map((bucket) => (
        <span
          key={bucket.from}
          className='bg-chart-2/70 w-1.5 rounded-t-[1px]'
          style={{ height: `${Math.max(2, (bucket.count / peak) * 22)}px` }}
        />
      ))}
      <span className='text-muted-foreground ml-1.5 self-center text-[10px]'>
        {distribution.minDays}–{distribution.maxDays}
      </span>
    </span>
  );
}

function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={cn('grid-head', align === 'right' ? 'text-right' : 'text-left')}>{children}</th>;
}
