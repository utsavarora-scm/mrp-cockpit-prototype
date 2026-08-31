'use client';

/**
 * Supply Schedule.
 *
 * The screen that answers *"why five lines and why 500 each?"* before anyone
 * asks. The constraints panel is not supplementary — it is the argument, so it
 * sits beside the timeline rather than below the fold, and every constraint
 * shows whether it binds or has slack.
 *
 * The hero is the timeline: each delivery a block on a real time axis, width
 * proportional to quantity, infeasible ones in red with the gap in days written
 * on them. A line that cannot be met is never quietly pushed out to a date that
 * works — that is the whole difference between a plan a planner can act on and
 * one that has already made the decision for them and hidden it.
 *
 * Editing a quantity re-solves the entire schedule. That is what proves it is
 * computed rather than drawn: the line count, the dates and the feasibility all
 * move together, because with a shipment cap, a storage ceiling and a minimum
 * order quantity they are one decision.
 */

import { formatDateFull, formatDateShort, formatNumber, formatPercent } from '@repo/domain';
import { Input } from '@repo/ui/components/input';
import { Skeleton } from '@repo/ui/components/skeleton';
import { cn } from '@repo/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import type { ScheduleLineView, ScheduleView } from '@/lib/api-types';

export default function SupplySchedulePage() {
  const params = useParams<{ orderId: string }>();
  const orderId = decodeURIComponent(params.orderId);

  const [draft, setDraft] = useState('');
  const [applied, setApplied] = useState<number | undefined>(undefined);

  const schedule = useQuery({
    queryKey: ['supply', orderId, applied],
    queryFn: async (): Promise<ScheduleView> => {
      const query = applied === undefined ? '' : `?qty=${applied}`;
      const response = await fetch(`/api/supply/${encodeURIComponent(orderId)}${query}`);
      if (!response.ok) throw new Error('That schedule could not be built.');
      return response.json();
    },
    placeholderData: (previous) => previous,
  });

  if (schedule.isError) {
    return (
      <Shell>
        <div className='bg-card rounded-lg border p-8'>
          <p className='text-[14px] font-medium'>That schedule could not be built.</p>
          <Link href='/' className='text-primary mt-3 inline-block text-[13px] font-medium hover:underline'>
            Back to the cockpit
          </Link>
        </div>
      </Shell>
    );
  }

  if (!schedule.data) {
    return (
      <Shell>
        <Skeleton className='h-9 w-96' />
        <Skeleton className='mt-8 h-[220px] rounded-lg' />
      </Shell>
    );
  }

  const order = schedule.data;

  return (
    <Shell>
      <Link
        href={`/material/${encodeURIComponent(order.itemId)}/${encodeURIComponent(order.plantId)}`}
        className='text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-[12px]'
      >
        <ArrowLeft className='size-3.5' />
        {order.itemId}
      </Link>

      <header className='mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1'>
        <h1 className='text-[22px] font-semibold tracking-tight'>{order.description}</h1>
        <span className='text-muted-foreground font-mono text-[13px]'>
          {order.itemId} · {order.plantId} · {order.vendorName ?? order.vendorId ?? 'unsourced'}
        </span>
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-[12px] font-medium',
            order.isPlanned ? 'bg-primary/12 text-primary' : 'bg-status-settled/12 text-status-settled',
          )}
        >
          {order.isPlanned ? 'Recommended — not yet placed' : 'Purchase order'}
        </span>
      </header>

      <Derivation order={order} draft={draft} setDraft={setDraft} onApply={setApplied} />

      <div className='mt-6'>
        <Timeline order={order} />
      </div>

      <div className='mt-6 grid grid-cols-1 gap-6 xl:grid-cols-12'>
        <div className='xl:col-span-8'>
          <LinesTable order={order} />
        </div>
        <div className='xl:col-span-4'>
          <Constraints order={order} />
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className='mx-auto max-w-[1600px] px-8 py-8'>{children}</div>;
}

/**
 * Where the quantity came from. Shown as arithmetic rather than stated, because
 * the total is the one number a buyer will challenge first.
 */
function Derivation({
  order,
  draft,
  setDraft,
  onApply,
}: {
  order: ScheduleView;
  draft: string;
  setDraft: (value: string) => void;
  onApply: (value: number | undefined) => void;
}) {
  const d = order.derivation;
  return (
    <section className='bg-card rounded-lg border p-6'>
      <div className='flex flex-wrap items-end justify-between gap-6'>
        <div>
          <h2 className='text-muted-foreground text-[15px] font-semibold tracking-[0.04em] uppercase'>
            Order quantity
          </h2>
          <p className='mt-2 text-[48px] leading-none font-semibold tracking-[-0.02em] tabular-nums'>
            {formatNumber(order.totalQty)}
            <span className='text-muted-foreground ml-2 text-[16px] font-normal'>{order.baseUom}</span>
          </p>
          <p className='text-muted-foreground mt-3 max-w-[62ch] text-[13px] leading-relaxed'>
            {formatNumber(d.demandInWindow)} needed over the next {d.orderWindowDays} days, plus{' '}
            {formatNumber(d.targetClosing)} to restore the buffer, less {formatNumber(d.openingStock)} on hand and{' '}
            {formatNumber(d.committedInWindow)} already committed.
            {d.isOverridden ? ' Overridden by hand — the plan derived ' + formatNumber(d.derivedTotal) + '.' : ''}
          </p>
        </div>

        <label className='flex items-end gap-2'>
          <span className='sr-only'>Change the order quantity</span>
          <div>
            <span className='text-muted-foreground mb-1 block text-[12px] font-medium'>Try a different quantity</span>
            <Input
              value={draft}
              inputMode='decimal'
              placeholder={String(Math.round(order.totalQty))}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                const value = Number(draft);
                onApply(Number.isFinite(value) && value > 0 ? value : undefined);
              }}
              className='h-9 w-36 text-[14px] tabular-nums'
            />
          </div>
          <button
            type='button'
            onClick={() => {
              setDraft('');
              onApply(undefined);
            }}
            className='text-muted-foreground hover:text-foreground h-9 px-2 text-[13px]'
          >
            Reset
          </button>
        </label>
      </div>
    </section>
  );
}

/** The hero: deliveries on a real time axis. */
function Timeline({ order }: { order: ScheduleView }) {
  const start = Date.parse(`${order.planningDate}T00:00:00Z`);
  const end = Date.parse(`${order.lines[order.lines.length - 1]?.requiredByDate ?? order.horizonEndDate}T00:00:00Z`);
  const span = Math.max(end - start, 86_400_000);

  const position = (iso: string): number => ((Date.parse(`${iso}T00:00:00Z`) - start) / span) * 100;
  const largest = order.lines.reduce((max, line) => Math.max(max, line.qty), 1);

  return (
    <section className='bg-card rounded-lg border p-6'>
      <h2 className='text-muted-foreground text-[15px] font-semibold tracking-[0.04em] uppercase'>Delivery timeline</h2>
      <p className='text-muted-foreground mt-1 text-[12px]'>
        Each block is one delivery, positioned on the date it is needed and sized by quantity
      </p>

      <div className='relative mt-8 h-[132px]'>
        {/* The axis */}
        <div className='bg-border absolute top-[92px] right-0 left-0 h-px' />
        <div className='absolute top-0 bottom-0 left-0 w-px border-l border-dashed border-foreground/40'>
          <span className='text-muted-foreground absolute top-[100px] left-1.5 text-[11px] whitespace-nowrap'>
            Today · {formatDateShort(order.planningDate)}
          </span>
        </div>

        {order.lines.map((line) => {
          const left = Math.min(Math.max(position(line.requiredByDate), 0), 97);
          const height = 24 + (line.qty / largest) * 44;
          const infeasible = line.infeasibleByDays > 0;
          return (
            <div
              key={line.line}
              className='absolute'
              style={{ left: `${left}%`, top: `${92 - height}px` }}
              title={`Line ${line.line} — ${formatNumber(line.qty)} ${order.baseUom} by ${line.requiredByDate}`}
            >
              <div
                className={cn(
                  'w-11 rounded-t-[3px] border-t-2',
                  infeasible ? 'border-status-critical bg-status-critical/25' : 'border-primary bg-primary/25',
                )}
                style={{ height: `${height}px` }}
              />
              <span
                className={cn(
                  'absolute -top-5 left-0 text-[11px] font-medium tabular-nums whitespace-nowrap',
                  infeasible && 'text-status-critical',
                )}
              >
                {formatNumber(line.qty)}
              </span>
              <span className='text-muted-foreground absolute top-[6px] left-0 text-[11px] whitespace-nowrap'>
                {formatDateShort(line.requiredByDate)}
              </span>
              {infeasible ? (
                <span className='text-status-critical absolute top-[24px] left-0 text-[11px] font-medium whitespace-nowrap'>
                  {line.infeasibleByDays}d late
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {order.infeasibleLines > 0 ? (
        <div className='bg-status-critical/8 text-status-critical mt-4 flex items-start gap-2.5 rounded-md px-4 py-3 text-[13px] leading-relaxed'>
          <TriangleAlert className='mt-0.5 size-4 shrink-0' />
          <span>
            {order.infeasibleLines} of {order.lineCount} deliveries are needed before this vendor can physically
            dispatch them. They are shown where they are needed, not moved to a date that works — the gap is the
            decision.
          </span>
        </div>
      ) : null}
    </section>
  );
}

function LinesTable({ order }: { order: ScheduleView }) {
  return (
    <section className='bg-card overflow-hidden rounded-lg border'>
      <h2 className='text-muted-foreground border-b px-6 py-4 text-[15px] font-semibold tracking-[0.04em] uppercase'>
        Delivery lines
      </h2>
      <table className='w-full'>
        <thead>
          <tr className='bg-surface-sunken'>
            <Th>Line</Th>
            <Th align='right'>Quantity</Th>
            <Th align='right'>Required by</Th>
            <Th align='right'>Dispatch by</Th>
            <Th align='right'>Covers</Th>
            <Th align='right'>Confidence</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => (
            <LineRow key={line.line} line={line} uom={order.baseUom} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function LineRow({ line, uom }: { line: ScheduleLineView; uom: string }) {
  const infeasible = line.infeasibleByDays > 0;
  // Newly-violated constraints flash once. Once, deliberately: a control that
  // keeps pulsing stops being information and becomes decoration.
  const [flash, setFlash] = useState(false);
  const previous = useRef(infeasible);

  useEffect(() => {
    if (infeasible && !previous.current) {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 900);
      return () => clearTimeout(timer);
    }
    previous.current = infeasible;
    return undefined;
  }, [infeasible]);

  return (
    <tr
      className={cn(
        'border-border/50 border-b transition-colors duration-200 last:border-0',
        flash && 'bg-status-critical/15',
      )}
    >
      <td
        className={cn(
          'h-11 border-l-[3px] py-0 pl-6 text-[13px]',
          infeasible ? 'border-l-status-critical' : 'border-l-transparent',
        )}
      >
        {line.line}
      </td>
      <td className='h-11 py-0 text-right text-[13px] font-medium tabular-nums'>
        {formatNumber(line.qty)} <span className='text-muted-foreground font-normal'>{uom}</span>
      </td>
      <td className='h-11 py-0 text-right text-[13px] tabular-nums'>{formatDateFull(line.requiredByDate)}</td>
      <td
        className={cn(
          'h-11 py-0 text-right text-[13px] tabular-nums',
          infeasible && 'text-status-critical font-medium',
        )}
      >
        {formatDateFull(line.requestedDispatchDate)}
      </td>
      <td className='text-muted-foreground h-11 py-0 text-right text-[13px] tabular-nums'>
        {line.coverDays.toFixed(1)} days
      </td>
      <td className='h-11 py-0 text-right text-[13px] tabular-nums'>{formatPercent(line.confidence, 0)}</td>
      <td className='h-11 py-0 pr-6 pl-4'>
        {infeasible ? (
          <span className='bg-status-critical/12 text-status-critical rounded-full px-2 py-0.5 text-[11px] font-medium'>
            {line.infeasibleByDays}d too late
          </span>
        ) : (
          <span className='text-muted-foreground text-[12px]'>Can be met</span>
        )}
      </td>
    </tr>
  );
}

/** Not supplementary — this panel is the argument. */
function Constraints({ order }: { order: ScheduleView }) {
  const sorted = [...order.constraints].sort((a, b) => Number(b.binding) - Number(a.binding));

  return (
    <section className='bg-card rounded-lg border p-6'>
      <h2 className='text-muted-foreground text-[15px] font-semibold tracking-[0.04em] uppercase'>
        What shaped this split
      </h2>

      <ul className='mt-4 space-y-3.5'>
        {sorted.map((constraint) => (
          <li key={constraint.kind}>
            <div className='flex items-baseline justify-between gap-2'>
              <span className='flex items-center gap-2 text-[14px]'>
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    constraint.binding ? 'bg-status-critical' : 'bg-muted-foreground/40',
                  )}
                />
                {constraint.label}
              </span>
              <span className='text-[13px] tabular-nums'>{constraint.value}</span>
            </div>
            <p className='text-muted-foreground mt-0.5 pl-3.5 text-[12px] leading-relaxed'>
              <span className={cn('font-medium', constraint.binding ? 'text-status-critical' : '')}>
                {constraint.binding ? 'Binding.' : 'Slack.'}
              </span>{' '}
              {constraint.note}
            </p>
          </li>
        ))}
      </ul>

      <div className='mt-5 border-t pt-4'>
        <p className='text-[13px] leading-relaxed'>{order.rationale}</p>
      </div>
    </section>
  );
}

function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={cn(
        'text-muted-foreground px-0 py-2.5 text-[11px] font-medium tracking-[0.04em] uppercase',
        align === 'right' ? 'text-right' : 'pl-6 text-left',
      )}
    >
      {children}
    </th>
  );
}
