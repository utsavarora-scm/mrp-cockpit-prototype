'use client';

/**
 * Screen 2 — the material workbench.
 *
 * The chart and the grid, together, for one material. Everything else on the
 * screen supports them and nothing competes with them for weight: one hero, one
 * card per idea, no card nested inside another.
 *
 * The acceptance test this screen exists to pass: a planner who has never seen
 * it should be able to state, within five minutes and unaided, when the
 * material breaches, by how much, why the system recommends what it recommends,
 * whether that recommendation is even placeable in time, and what they would do
 * about it.
 */

import { formatCurrency, formatDateFull, formatNumber } from '@repo/domain';
import { Skeleton } from '@repo/ui/components/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { cn } from '@repo/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Info } from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import type { MaterialDetail } from '@/lib/api-types';
import { ExplainDrawer } from '@/components/planning/ExplainDrawer';
import type { GridAnchor } from '@/components/planning/PlanningGrid';
import { PlanningGrid } from '@/components/planning/PlanningGrid';
import { ProjectionChart } from '@/components/planning/ProjectionChart';
import { SimulateDialog } from '@/components/planning/SimulateDialog';
import { TierBadge } from '@/components/planning/TierBadge';

export default function MaterialPage() {
  const params = useParams<{ itemId: string; plantId: string }>();
  const itemId = decodeURIComponent(params.itemId);
  const plantId = decodeURIComponent(params.plantId);

  const [showDrift, setShowDrift] = useState(false);

  // Explain is meant to open from any number, and most numbers live on other
  // screens. Rather than every screen carrying its own copy of the drawer and
  // its own fetch of this material, they link here with the cell in the URL —
  // one panel, one payload, and a link a planner can send to somebody else.
  const search = useSearchParams();
  const explainRow = search.get('explain');
  const explainFrom = search.get('from');
  const linkedAnchor: GridAnchor | null =
    explainRow && explainFrom
      ? {
          row: explainRow,
          fromDate: explainFrom,
          toDate: search.get('to') ?? explainFrom,
          label: `${explainRow}, ${explainFrom}`,
        }
      : null;

  // The link opens the drawer; anything the planner does afterwards takes over.
  // Derived rather than synchronised into state by an effect, which would
  // re-open the panel every time the query changed underneath it.
  const [chosen, setChosen] = useState<{ open: boolean; anchor: GridAnchor | null } | null>(null);
  const explainOpen = chosen ? chosen.open : linkedAnchor !== null;
  const anchor = chosen ? chosen.anchor : linkedAnchor;
  const setExplainOpen = (open: boolean): void => setChosen({ open, anchor: open ? anchor : null });
  const openExplain = (cell: GridAnchor | null): void => setChosen({ open: true, anchor: cell });

  const query = useQuery({
    queryKey: ['material', itemId, plantId],
    queryFn: async (): Promise<MaterialDetail> => {
      const response = await fetch(`/api/material/${encodeURIComponent(itemId)}/${encodeURIComponent(plantId)}`);
      if (!response.ok) throw new Error('That material could not be loaded.');
      return response.json();
    },
  });

  if (query.isError) {
    return (
      <Shell>
        <div className='bg-card rounded-lg border p-8'>
          <p className='text-[14px] font-medium'>That material could not be loaded.</p>
          <p className='text-muted-foreground mt-1 text-[13px]'>It may not be planned at this plant.</p>
          <Link href='/' className='text-primary mt-4 inline-block text-[13px] font-medium hover:underline'>
            Back to the planning position
          </Link>
        </div>
      </Shell>
    );
  }

  if (!query.data) {
    return (
      <Shell>
        <Skeleton className='h-8 w-96' />
        <Skeleton className='mt-6 h-[460px] rounded-lg' />
        <Skeleton className='mt-6 h-[320px] rounded-lg' />
      </Shell>
    );
  }

  const detail = query.data;

  return (
    <Shell>
      <Link
        href='/'
        className='text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-[12px]'
      >
        <ArrowLeft className='size-3.5' />
        Planning position
      </Link>

      <header className='mb-5 flex flex-wrap items-start justify-between gap-4'>
        <div>
          <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
            <h1 className='text-[20px] font-semibold tracking-tight'>{detail.description}</h1>
            <span className='text-muted-foreground font-mono text-[12px]'>
              {detail.itemId} · {detail.plantId} · {detail.itemType} · class {detail.abcClass} · low-level code{' '}
              {detail.lowLevelCode}
            </span>
          </div>
          <p className='text-muted-foreground mt-1 text-[12px]'>
            {detail.header.runType} as at {formatDateFull(detail.header.planningDate)} ({detail.header.planningWeek}) ·{' '}
            {detail.header.mpsVersion}
            {detail.itemCategoryId ? ` · item category ${detail.itemCategoryId}` : ''}
          </p>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          {detail.fences.measured ? (
            <button
              type='button'
              onClick={() => setShowDrift((value) => !value)}
              aria-pressed={showDrift}
              className={cn(
                'h-8 rounded-md border px-3 text-[13px] font-medium transition-colors',
                showDrift
                  ? 'border-status-critical text-status-critical bg-status-critical/10'
                  : 'border-input hover:bg-muted',
              )}
            >
              {showDrift ? 'Maintained lead time' : 'Show measured lead time'}
            </button>
          ) : null}
          <SimulateDialog detail={detail} />
          <Link
            href={`/schedule/${encodeURIComponent(itemId)}/${encodeURIComponent(plantId)}`}
            className='bg-primary text-primary-foreground inline-flex h-8 items-center rounded-md px-3 text-[13px] font-medium'
          >
            Build the delivery schedule
          </Link>
        </div>
      </header>

      <VerdictBar detail={detail} onExplain={() => openExplain(null)} />

      <div className='mt-5'>
        <ProjectionChart detail={detail} showDrift={showDrift} />
      </div>

      <div className='mt-5'>
        <PlanningGrid detail={detail} onExplain={(cell) => openExplain(cell ?? null)} />
      </div>

      <div className='mt-5 grid grid-cols-1 gap-5 xl:grid-cols-3'>
        <LeadTimeChain detail={detail} />
        <Parameters detail={detail} />
        <StockAndOrders detail={detail} />
      </div>

      {detail.exceptions.length > 0 ? (
        <section className='bg-card mt-5 rounded-lg border'>
          <div className='border-b px-5 py-3'>
            <h2 className='text-[14px] font-semibold'>What the calculation raised</h2>
            <p className='text-muted-foreground text-[12px]'>
              Every one of these is a named condition on a number above — not a separate rules engine.
            </p>
          </div>
          <ul className='divide-border divide-y'>
            {detail.exceptions.slice(0, 6).map((exception) => (
              <li key={exception.id} className='px-5 py-3'>
                <div className='flex flex-wrap items-baseline justify-between gap-3'>
                  <p className='flex-1 text-[13px] leading-relaxed'>{exception.headline}</p>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                      exception.severity === 'CRITICAL'
                        ? 'bg-status-critical/12 text-status-critical'
                        : exception.severity === 'HIGH'
                          ? 'bg-status-attention/15 text-status-attention'
                          : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {exception.reachableByOrdering ? 'Reachable by ordering' : 'Not reachable by ordering'}
                  </span>
                </div>
                {exception.actions.length > 0 ? (
                  <ul className='text-muted-foreground mt-1.5 space-y-0.5 text-[12px]'>
                    {exception.actions.slice(0, 3).map((action) => (
                      <li key={action}>· {action}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ExplainDrawer detail={detail} open={explainOpen} onOpenChange={setExplainOpen} anchor={anchor} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className='mx-auto max-w-[1680px] px-6 py-6'>{children}</div>;
}

/**
 * The verdict, in one line, before any chart.
 *
 * States what the plan proposes and whether it can still be placed — because
 * the second half is the part no screen a planner has today tells them.
 */
function VerdictBar({ detail, onExplain }: { detail: MaterialDetail; onExplain: () => void }) {
  const recommendation = detail.recommendation;

  return (
    <section className='bg-card flex flex-wrap items-center justify-between gap-4 rounded-lg border px-5 py-4'>
      <div className='flex-1'>
        {recommendation ? (
          <p className='text-[14px] leading-relaxed'>
            The plan proposes{' '}
            <span className='text-[18px] font-semibold tabular-nums'>
              {formatNumber(recommendation.qty)} {detail.baseUom}
            </span>{' '}
            to land {recommendation.receiptWeek} ({formatDateFull(recommendation.receiptDate)}).{' '}
            {recommendation.lotSizingAddition > 0 ? (
              <span className='text-muted-foreground'>
                {formatNumber(recommendation.netRequirement)} {detail.baseUom} of that is requirement;{' '}
                {formatNumber(recommendation.lotSizingAddition)} is the minimum order quantity.{' '}
              </span>
            ) : null}
            {recommendation.isReleaseInPast ? (
              <span className='text-status-critical font-medium'>
                It needed releasing {recommendation.releaseWeek} — {recommendation.weeksLate}{' '}
                {recommendation.weeksLate === 1 ? 'week' : 'weeks'} ago. It cannot now be placed in time.
              </span>
            ) : (
              <span>
                Release it by {formatDateFull(recommendation.releaseDate)} ({recommendation.releaseWeek}).
              </span>
            )}
          </p>
        ) : (
          <p className='text-[14px]'>
            The plan is not proposing anything for this material.{' '}
            {detail.firstBreachDate ? (
              <span className='text-status-critical'>
                It still breaches on {formatDateFull(detail.firstBreachDate)}.
              </span>
            ) : (
              <span className='text-muted-foreground'>Stock and existing orders cover the horizon.</span>
            )}
          </p>
        )}
      </div>
      <button
        type='button'
        onClick={onExplain}
        className='border-input hover:bg-muted inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium'
      >
        <Info className='size-3.5' />
        Explain
      </button>
    </section>
  );
}

/**
 * The lead-time chain, interval by interval.
 *
 * Most systems use the vendor's quoted manufacturing time and silently omit the
 * rest. Showing all six, with an owner beside each, is what turns "the supplier
 * is late" into a statement about which of four functions is.
 */
function LeadTimeChain({ detail }: { detail: MaterialDetail }) {
  const total = detail.chain.reduce((sum, interval) => sum + interval.days, 0);

  return (
    <section className='bg-card rounded-lg border'>
      <div className='border-b px-5 py-3'>
        <h2 className='text-[14px] font-semibold'>Lead-time chain</h2>
        <p className='text-muted-foreground text-[12px]'>
          {total} days from purchase order to available for consumption — not the vendor&rsquo;s quoted time.
        </p>
      </div>
      <ul className='divide-border divide-y'>
        {detail.chain.map((interval) => (
          <li key={interval.key} className='flex items-baseline justify-between gap-3 px-5 py-2'>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className='decoration-muted-foreground/40 cursor-help text-[13px] underline decoration-dotted underline-offset-2'>
                  {interval.label}
                </span>
              </TooltipTrigger>
              <TooltipContent className='max-w-[280px]'>{interval.note}</TooltipContent>
            </Tooltip>
            <span className='flex items-baseline gap-3'>
              <span className='text-muted-foreground text-[11px]'>{interval.owner}</span>
              <span className='w-10 text-right text-[13px] font-medium tabular-nums'>{interval.days} d</span>
            </span>
          </li>
        ))}
      </ul>
      <div className='bg-surface-sunken flex items-baseline justify-between px-5 py-2.5'>
        <span className='text-[13px] font-medium'>Total planning lead time</span>
        <span className='text-[13px] font-semibold tabular-nums'>{total} d</span>
      </div>
      {detail.fences.measured ? (
        <p className='text-muted-foreground border-t px-5 py-2.5 text-[12px]'>
          Measured at {detail.fences.measured.totalDays} days across the reconciled receipts —{' '}
          <span className={detail.fences.driftDays && detail.fences.driftDays > 0 ? 'text-status-critical' : ''}>
            {detail.fences.driftDays !== null && detail.fences.driftDays > 0 ? '+' : ''}
            {detail.fences.driftDays} days
          </span>{' '}
          against what the plan uses.
        </p>
      ) : null}
    </section>
  );
}

function Parameters({ detail }: { detail: MaterialDetail }) {
  return (
    <section className='bg-card rounded-lg border'>
      <div className='border-b px-5 py-3'>
        <h2 className='text-[14px] font-semibold'>Maintained parameters</h2>
        <p className='text-muted-foreground text-[12px]'>Every input carries its source and when it last moved.</p>
      </div>
      <ul className='divide-border divide-y'>
        {detail.parameters.map((row) => (
          <li key={row.field} className='px-5 py-2'>
            <div className='flex items-baseline justify-between gap-3'>
              <span className='text-[13px]'>{row.label}</span>
              <span className='flex items-baseline gap-2'>
                <span className='text-[13px] font-medium tabular-nums'>{row.maintained}</span>
                {row.measured ? (
                  <span className='text-status-critical text-[12px] tabular-nums'>· measured {row.measured}</span>
                ) : null}
              </span>
            </div>
            {row.note ? <p className='text-muted-foreground mt-0.5 text-[11px] leading-snug'>{row.note}</p> : null}
          </li>
        ))}
      </ul>
      <p className='text-muted-foreground border-t px-5 py-2.5 text-[11px]'>
        Last maintained {detail.parameters[0]?.lastChangedOn ?? '—'} in the SAP material master.
      </p>
    </section>
  );
}

function StockAndOrders({ detail }: { detail: MaterialDetail }) {
  return (
    <section className='bg-card rounded-lg border'>
      <div className='border-b px-5 py-3'>
        <h2 className='text-[14px] font-semibold'>Position today</h2>
        <p className='text-muted-foreground text-[12px]'>Material in quality inspection is on site and is not stock.</p>
      </div>
      <ul className='divide-border divide-y'>
        <Line label='Unrestricted' value={detail.stock.unrestricted} uom={detail.baseUom} emphasis />
        <Line label='Quality inspection' value={detail.stock.qualityInspection} uom={detail.baseUom} muted />
        <Line label='Blocked' value={detail.stock.blocked} uom={detail.baseUom} muted />
        <Line label='Safety stock' value={detail.safetyStock} uom={detail.baseUom} />
        <Line label='Days of cover today' value={detail.daysOfCoverToday} uom='days' />
        <li className='flex items-baseline justify-between gap-3 px-5 py-2'>
          <span className='text-[13px]'>Value on hand</span>
          <span className='text-[13px] font-medium tabular-nums'>
            {formatCurrency(detail.stock.unrestricted * detail.standardCost)}
          </span>
        </li>
      </ul>

      {detail.quarantine.length > 0 ? (
        <div className='border-t px-5 py-3'>
          <p className='text-muted-foreground mb-1.5 text-[11px] font-medium tracking-[0.03em] uppercase'>
            In quality inspection
          </p>
          {detail.quarantine.map((lot) => (
            <p key={lot.batchId} className='text-[12px]'>
              {formatNumber(lot.qty)} {detail.baseUom} received {lot.receivedOn}, expected to clear{' '}
              <span className='font-medium'>{lot.expectedReleaseDate}</span>
            </p>
          ))}
        </div>
      ) : null}

      {detail.orders.length > 0 ? (
        <div className='border-t px-5 py-3'>
          <p className='text-muted-foreground mb-2 text-[11px] font-medium tracking-[0.03em] uppercase'>Open orders</p>
          {detail.orders.slice(0, 4).map((order) => (
            <div key={order.id} className='mb-2 last:mb-0'>
              <p className='flex items-baseline justify-between text-[12px]'>
                <span className='font-mono'>{order.id}</span>
                <span className='tabular-nums'>
                  {formatNumber(order.totalQty)} {detail.baseUom}
                </span>
              </p>
              <ul className='mt-1 space-y-1'>
                {order.lines.map((line) => (
                  <li key={line.line} className='flex items-center justify-between gap-2 text-[11px]'>
                    <span className='text-muted-foreground'>
                      line {line.line} · {line.expectedWeek}
                    </span>
                    <span className='flex items-center gap-2'>
                      <span className='tabular-nums'>{formatNumber(line.qty)}</span>
                      <TierBadge tier={line.tier} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Line({
  label,
  value,
  uom,
  emphasis,
  muted,
}: {
  label: string;
  value: number;
  uom: string;
  emphasis?: boolean;
  muted?: boolean;
}) {
  return (
    <li className={cn('flex items-baseline justify-between gap-3 px-5 py-2', muted && 'text-muted-foreground')}>
      <span className='text-[13px]'>{label}</span>
      <span className={cn('text-[13px] tabular-nums', emphasis && 'font-semibold')}>
        {formatNumber(value)} <span className='text-muted-foreground text-[11px]'>{uom}</span>
      </span>
    </li>
  );
}
