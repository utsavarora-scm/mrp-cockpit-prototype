'use client';

/**
 * The two schedules and the reconciliation between them.
 *
 * Side by side: what the plan wants, what can actually be asked for, and every
 * unit of difference attributed to a named constraint. The committed column is
 * the planner's to change — and where their edit breaks something, the thing it
 * breaks is named against the line that broke it rather than swallowed.
 *
 * The sentence under the totals is computed, not asserted. It used to read "the
 * two totals match" whether or not they did, above a delta column printing the
 * difference in red.
 */

import { formatNumber } from '@repo/domain';
import { Button } from '@repo/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { cn } from '@repo/ui/lib/utils';
import { AlertTriangle, Pencil } from 'lucide-react';
import Link from 'next/link';

import type { ScheduleBuilderView, ScheduleLineView } from '@/lib/api-types';

export function DeliveryLedger({
  view,
  onEditLine,
  onPrepare,
}: {
  view: ScheduleBuilderView;
  onEditLine: (line: ScheduleLineView) => void;
  onPrepare: () => void;
}) {
  const pinned = new Set(view.plannerLines.map((line) => line.line));
  const blocked = view.blockingViolations.length > 0;

  return (
    <section className='mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.55fr_1fr]'>
      <div className='bg-card rounded-lg border'>
        <div className='flex flex-wrap items-baseline justify-between gap-3 border-b px-5 py-3'>
          <div>
            <h2 className='text-[14px] font-semibold'>Ideal against committable</h2>
            <p className='text-muted-foreground text-[12px]'>
              The left column is the statement of need. The right is what can actually be asked for — and what you can
              change. All quantities in {view.baseUom}.
            </p>
          </div>
          <Button size='sm' className='h-8 text-[13px]' onClick={onPrepare}>
            Prepare schedule
          </Button>
        </div>

        <div className='overflow-x-auto'>
          <table className='w-full min-w-[900px]'>
            <thead>
              <tr className='bg-surface-sunken border-b'>
                <Th>Line</Th>
                <Th>Delivery</Th>
                <Th>Dispatch by</Th>
                <Th align='right'>Requirement</Th>
                <Th align='right'>Ideal</Th>
                <Th align='right'>Committed</Th>
                <Th align='right'>Δ</Th>
                <Th align='right'>Balance after</Th>
                <Th>Constraint that moved it</Th>
              </tr>
            </thead>
            <tbody>
              {view.lines.map((line) => (
                <ScheduleRow
                  key={line.line}
                  line={line}
                  safetyStock={view.safetyStock}
                  uom={view.baseUom}
                  itemId={view.itemId}
                  plantId={view.plantId}
                  pinned={pinned.has(line.line)}
                  violations={view.blockingViolations.filter((row) => row.line === line.line)}
                  onEdit={() => onEditLine(line)}
                />
              ))}
              <tr className='bg-surface-sunken font-medium'>
                <td className='grid-cell' colSpan={4}>
                  Total
                </td>
                <td className='grid-cell num'>{formatNumber(view.totals.ideal)}</td>
                <td className='grid-cell num'>{formatNumber(view.totals.committed)}</td>
                <td className={cn('grid-cell num', view.totals.delta !== 0 && 'text-status-critical')}>
                  {view.totals.delta === 0 ? '0' : formatNumber(view.totals.delta)}
                </td>
                <td className='grid-cell' colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>

        <p
          className={cn(
            'border-t px-5 py-2.5 text-[11px]',
            view.totals.delta === 0 ? 'text-muted-foreground' : 'text-status-critical',
          )}
        >
          {view.totals.delta === 0
            ? 'The two totals match: constraints move quantity between weeks, they do not quietly delete it.'
            : `The committed schedule carries ${formatNumber(Math.abs(view.totals.delta))} ${view.totals.delta < 0 ? 'less' : 'more'} than the ideal one. That difference is named below, or the schedule does not go out.`}{' '}
          Opening balance {formatNumber(view.openingBalance)} {view.baseUom}, safety stock{' '}
          {formatNumber(view.safetyStock)}.
        </p>
      </div>

      <div className='space-y-5'>
        {blocked ? <ViolationPanel view={view} /> : null}
        {view.proposedCorrections.length > 0 ? <CorrectionPanel view={view} /> : null}

        <div className='bg-card rounded-lg border'>
          <div className='border-b px-5 py-3'>
            <h2 className='text-[14px] font-semibold'>The ledger</h2>
            <p className='text-muted-foreground text-[12px]'>Every unit of difference, attributed.</p>
          </div>
          <ul className='divide-border divide-y'>
            {view.ledger.map((entry, index) => (
              <li key={index} className='px-5 py-3 text-[13px] leading-relaxed'>
                {entry}
              </li>
            ))}
          </ul>

          {view.options.length > 0 ? (
            <div className='border-t px-5 py-3'>
              <p className='text-muted-foreground mb-1.5 text-[11px] font-medium tracking-[0.03em] uppercase'>
                Ways to close the residual
              </p>
              <ol className='space-y-1.5 text-[12px] leading-relaxed'>
                {view.options.map((option, index) => (
                  <li key={index} className='flex gap-2'>
                    <span className='text-muted-foreground shrink-0'>{index + 1}.</span>
                    <span>{option}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>

        <div className='bg-card rounded-lg border'>
          <div className='border-b px-5 py-3'>
            <h2 className='text-[14px] font-semibold'>Constraints</h2>
            <p className='text-muted-foreground text-[12px]'>
              Shown whether or not they bound — a constraint that did not bind is a fact worth knowing.
            </p>
          </div>
          <ul className='divide-border divide-y'>
            {view.constraints.map((constraint) => (
              <li key={constraint.key} className='px-5 py-2.5'>
                <div className='flex items-baseline justify-between gap-3'>
                  <span
                    className={cn(
                      'text-[13px]',
                      constraint.binding ? 'text-status-critical font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {constraint.label}
                  </span>
                  <span className='flex items-baseline gap-2'>
                    {constraint.value !== null ? (
                      <span className='text-[12px] tabular-nums'>{formatNumber(constraint.value)}</span>
                    ) : null}
                    <span
                      className={cn(
                        'rounded px-1.5 py-px text-[10px] font-medium',
                        constraint.binding
                          ? 'bg-status-critical/12 text-status-critical'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {constraint.binding ? 'binds' : 'slack'}
                    </span>
                  </span>
                </div>
                <p className='text-muted-foreground mt-0.5 text-[11px] leading-snug'>{constraint.note}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** What stops this schedule going out, named against the line that caused it. */
function ViolationPanel({ view }: { view: ScheduleBuilderView }) {
  return (
    <div className='border-status-critical/40 bg-status-critical/[0.04] rounded-lg border'>
      <div className='border-status-critical/25 border-b px-5 py-3'>
        <h2 className='text-status-critical text-[14px] font-semibold'>This schedule cannot be sent</h2>
        <p className='text-muted-foreground text-[12px]'>
          Every one of these has to be resolved first. None of them is a warning.
        </p>
      </div>
      <ul className='divide-border divide-y'>
        {view.blockingViolations.map((violation, index) => (
          <li key={`${violation.week}-${index}`} className='px-5 py-3'>
            <p className='text-[12px] font-medium'>
              {violation.line !== null ? `Line ${violation.line} · ` : ''}
              {violation.week} · {violation.constraintLabel}
            </p>
            <p className='text-muted-foreground mt-0.5 text-[12px] leading-snug'>{violation.message}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What the engine would do elsewhere. Offered, never applied. */
function CorrectionPanel({ view }: { view: ScheduleBuilderView }) {
  return (
    <div className='bg-card rounded-lg border'>
      <div className='border-b px-5 py-3'>
        <h2 className='text-[14px] font-semibold'>What it would have done</h2>
        <p className='text-muted-foreground text-[12px]'>
          Your lines are left exactly as you set them. This is what the engine would put on the others.
        </p>
      </div>
      <ul className='divide-border divide-y'>
        {view.proposedCorrections.map((correction) => (
          <li key={correction.line} className='px-5 py-2.5 text-[12px] leading-snug'>
            <span className='font-medium'>
              Line {correction.line}, {correction.week}
            </span>{' '}
            <span className='text-muted-foreground'>
              {formatNumber(correction.from)} → {formatNumber(correction.to)} {view.baseUom}. {correction.reason}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScheduleRow({
  line,
  safetyStock,
  uom,
  itemId,
  plantId,
  pinned,
  violations,
  onEdit,
}: {
  line: ScheduleLineView;
  safetyStock: number;
  uom: string;
  itemId: string;
  plantId: string;
  pinned: boolean;
  violations: ScheduleBuilderView['blockingViolations'];
  onEdit: () => void;
}) {
  const below = line.balanceAfter < safetyStock;

  return (
    <tr className={cn('grid-row', violations.length > 0 && 'bg-status-critical/[0.05]')}>
      <td className='grid-cell num'>{line.line}</td>
      <td className='grid-cell text-[12px]'>
        <span className='font-medium'>{line.week}</span>
        <span className='text-muted-foreground ml-1.5'>{line.date.slice(5)}</span>
        {line.insideFence ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertTriangle className='text-status-critical ml-1.5 inline size-3 align-[-1px]' />
            </TooltipTrigger>
            <TooltipContent className='max-w-[280px]'>
              Required {line.unreachableByDays} days before a newly placed order could arrive. The date is left where it
              is rather than pushed out, because knowing it is impossible in time is the whole point.
            </TooltipContent>
          </Tooltip>
        ) : null}
      </td>
      <td className='text-muted-foreground grid-cell text-[12px]'>{line.dispatchDate.slice(5)}</td>
      <td className='text-muted-foreground grid-cell num'>
        <Link
          href={`/material/${encodeURIComponent(itemId)}/${encodeURIComponent(plantId)}?explain=gross&from=${line.date}`}
          className='hover:text-primary hover:underline'
          title='Explain this requirement'
        >
          {formatNumber(line.requirement)}
        </Link>
      </td>
      <td className='grid-cell num'>
        {formatNumber(line.idealQty)}
        {line.lotSizingAddition > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className='text-muted-foreground ml-1 cursor-help text-[10px]'>
                +{formatNumber(line.lotSizingAddition)}
              </span>
            </TooltipTrigger>
            <TooltipContent className='max-w-[280px]'>
              {formatNumber(line.needQty)} is requirement; {formatNumber(line.lotSizingAddition)} was added by a
              lot-sizing rule. Need and rule are never merged.
            </TooltipContent>
          </Tooltip>
        ) : null}
      </td>

      <td className='grid-cell num'>
        <button
          type='button'
          onClick={onEdit}
          aria-label={`Edit line ${line.line}, currently ${line.committedQty} ${uom}`}
          className={cn(
            'hover:border-input inline-flex items-center gap-1.5 rounded border border-transparent px-1.5 py-0.5 font-medium tabular-nums',
            pinned && 'border-primary/40 bg-primary/[0.06]',
          )}
        >
          {line.committedQty === 0 ? '—' : formatNumber(line.committedQty)}
          <Pencil className='text-muted-foreground size-3' />
        </button>
        {pinned ? <span className='text-primary mt-0.5 block text-[10px]'>set by you</span> : null}
      </td>

      <td
        className={cn(
          'grid-cell num',
          line.delta < 0 && 'text-status-critical',
          line.delta > 0 && 'text-status-settled',
        )}
      >
        {line.delta === 0 ? '0' : `${line.delta > 0 ? '+' : ''}${formatNumber(line.delta)}`}
      </td>
      <td className={cn('grid-cell num', below && 'text-status-attention font-medium')}>
        {formatNumber(line.balanceAfter)}
      </td>
      <td className='text-muted-foreground grid-cell max-w-[280px] text-[11px] leading-snug'>
        {violations.length > 0 ? (
          <span className='text-status-critical font-medium'>
            {violations.map((row) => row.constraintLabel).join(' · ')}
          </span>
        ) : line.constraintLabel ? (
          <>
            <span className='text-foreground font-medium'>{line.constraintLabel}</span>
            {line.note ? ` — ${line.note}` : ''}
          </>
        ) : (
          '—'
        )}
      </td>
    </tr>
  );
}

function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={cn('grid-head', align === 'right' ? 'text-right' : 'text-left')}>{children}</th>;
}
