'use client';

/**
 * Explain.
 *
 * Opens from any number, never a separate destination. Three tiers, disclosed
 * progressively, because a planner who accepts the first sentence should not
 * have to scroll past the arithmetic to get on with their day, and one who does
 * not should be able to reach a source field without leaving.
 *
 *   1. One sentence, before any table.
 *   2. The arithmetic, one line per operand, each with its own provenance.
 *   3. The checks a planner would do next — where the requirement came from,
 *      what else carries the same chemistry, what else goes into the same
 *      parent, and what the receipts actually measured.
 *
 * No language model anywhere in this. Tier 1 is a template filled from the
 * calculation and it is deterministic: the same numbers always produce the same
 * sentence. A generated narrative that cannot be reproduced is the opposite of
 * a trust layer.
 */

import { formatNumber } from '@repo/domain';
import { Button } from '@repo/ui/components/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@repo/ui/components/sheet';
import { cn } from '@repo/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import type { ChainStep, ExplainLine, ExplainPayload, MaterialDetail } from '@/lib/api-types';
import type { GridAnchor } from './PlanningGrid';

export function ExplainDrawer({
  detail,
  trigger,
  open,
  onOpenChange,
  anchor,
}: {
  detail: MaterialDetail;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The cell this was opened from, where it was opened from one. */
  anchor?: GridAnchor | null;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const query = useQuery({
    // The anchor is part of the identity: two cells on the same material are
    // two different explanations, and a key that cannot tell them apart serves
    // the first one it cached for both.
    queryKey: ['explain', detail.itemId, detail.plantId, anchor?.row ?? null, anchor?.fromDate ?? null],
    enabled: isOpen,
    queryFn: async (): Promise<ExplainPayload> => {
      const params = new URLSearchParams();
      if (anchor) {
        params.set('row', anchor.row);
        params.set('from', anchor.fromDate);
        params.set('to', anchor.toDate);
      }
      const response = await fetch(
        `/api/material/${encodeURIComponent(detail.itemId)}/${encodeURIComponent(detail.plantId)}/explain?${params.toString()}`,
      );
      if (!response.ok) throw new Error('That could not be explained.');
      return response.json();
    },
  });

  return (
    <Sheet open={isOpen} onOpenChange={setOpen}>
      {trigger ? <SheetTrigger asChild>{trigger}</SheetTrigger> : null}
      <SheetContent side='right' className='flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[620px]'>
        <SheetHeader className='border-b px-6 py-4'>
          <SheetTitle className='text-[15px]'>
            {detail.itemId} · {detail.description}
          </SheetTitle>
          <p className='text-muted-foreground text-[12px]'>
            {anchor ? `${anchor.label} · ` : ''}
            {detail.plantId} · every operand below traces to a source field in at most four steps
          </p>
        </SheetHeader>

        {query.data ? <Body payload={query.data} detail={detail} /> : <Loading />}
      </SheetContent>
    </Sheet>
  );
}

function Loading() {
  return <p className='text-muted-foreground px-6 py-8 text-[13px]'>Reading the calculation…</p>;
}

function Body({ payload, detail }: { payload: ExplainPayload; detail: MaterialDetail }) {
  return (
    <div className='divide-border divide-y'>
      {/* Tier 1 — one sentence, before any table. */}
      <section className='bg-primary/[0.05] px-6 py-5'>
        <p className='text-[14px] leading-relaxed'>{payload.sentence}</p>
      </section>

      {/* Tier 2 — the arithmetic. */}
      <Section title='The arithmetic' note='Displayed components sum to displayed totals. Rounding is its own line.'>
        <div className='space-y-0.5 font-mono text-[12px]'>
          {payload.arithmetic.map((line, index) => (
            <ArithmeticRow key={`${line.label}-${index}`} line={line} />
          ))}
        </div>
      </Section>

      {/* Tier 3 — the checks a planner would do next. */}
      {payload.chain.length > 0 ? (
        <Section
          title='Where the requirement came from'
          note='Yields are properties of the process; ratios and splits are decisions somebody made. They are argued about with different people, so they are shown apart.'
        >
          <ol className='space-y-2'>
            {payload.chain.map((step, index) => (
              <ChainRow key={`${step.itemId}-${index}`} step={step} isLast={index === payload.chain.length - 1} />
            ))}
          </ol>
        </Section>
      ) : null}

      {payload.categoryCheck.length > 0 ? (
        <Section
          title='Same chemistry, different material code'
          note='The lever nothing on a planning screen shows today. The item category exists in the material master and nowhere in the plan.'
        >
          <table className='w-full'>
            <tbody>
              {payload.categoryCheck.map((row) => (
                <tr key={row.itemId} className='grid-row'>
                  <td className='grid-cell font-mono text-[12px]'>{row.itemId}</td>
                  <td className='grid-cell'>{row.description}</td>
                  <td className='grid-cell num'>{row.leadTimeDays} d</td>
                  <td className='grid-cell text-right text-[12px]'>
                    <span
                      className={row.reachesTheBreach ? 'text-status-settled font-medium' : 'text-muted-foreground'}
                    >
                      {row.earliestReceiptWeek}
                    </span>
                  </td>
                  <td className='grid-cell text-right text-[11px]'>
                    {row.reachesTheBreach ? (
                      <span className='text-status-settled'>reaches it</span>
                    ) : (
                      <span className='text-muted-foreground'>too late</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {payload.horizontalCheck.length > 0 ? (
        <Section
          title='The other components of the same parent'
          note='Expediting one component of a set whose partner cannot move just fills the warehouse.'
        >
          <table className='w-full'>
            <tbody>
              {payload.horizontalCheck.map((row) => (
                <tr key={row.itemId} className='grid-row'>
                  <td className='grid-cell font-mono text-[12px]'>{row.itemId}</td>
                  <td className='grid-cell max-w-[220px] truncate'>{row.description}</td>
                  <td className='grid-cell text-right text-[12px]'>
                    {row.firstBreachDate ? (
                      <span className={row.blocked ? 'text-status-critical font-medium' : 'text-status-attention'}>
                        breaches {row.firstBreachDate.slice(5)}
                      </span>
                    ) : (
                      <span className='text-status-settled'>covered</span>
                    )}
                  </td>
                  <td className='grid-cell text-right text-[11px]'>
                    {row.blocked ? <span className='text-status-critical'>cannot move</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      <Section
        title='Maintained against measured'
        note='Phase 1 measures. Proposing a new value is the norms calculator, and keeping those apart is what makes this worth acting on.'
      >
        <div className='mb-3 grid grid-cols-3 gap-3 text-[13px]'>
          <Figure
            label='Maintained'
            value={payload.realityCheck.maintainedDays === null ? '—' : `${payload.realityCheck.maintainedDays} d`}
          />
          <Figure
            label='Measured'
            value={payload.realityCheck.measuredDays === null ? '—' : `${payload.realityCheck.measuredDays} d`}
            tone={
              payload.realityCheck.measuredDays !== null &&
              payload.realityCheck.maintainedDays !== null &&
              payload.realityCheck.measuredDays > payload.realityCheck.maintainedDays
                ? 'bad'
                : undefined
            }
          />
          <Figure
            label='Spread'
            value={payload.realityCheck.stdDevDays === null ? '—' : `±${payload.realityCheck.stdDevDays} d`}
          />
        </div>
        <p className='text-muted-foreground mb-2 text-[11px]'>
          {payload.realityCheck.matchedCount} receipts reconciled to a delivery line.{' '}
          {payload.realityCheck.unmatchedCount > 0
            ? `${payload.realityCheck.unmatchedCount} excluded — they match no line, so they carry no reliable release date.`
            : 'Nothing excluded.'}
        </p>
        <table className='w-full'>
          <thead>
            <tr className='bg-surface-sunken'>
              <th className='grid-head text-left'>Order</th>
              <th className='grid-head text-left'>Released</th>
              <th className='grid-head text-left'>Available</th>
              <th className='grid-head text-right'>Days</th>
              <th className='grid-head text-right'>vs plan</th>
              <th className='grid-head text-left'>Reason</th>
            </tr>
          </thead>
          <tbody>
            {payload.realityCheck.receipts.slice(0, 10).map((receipt) => (
              <tr key={receipt.poId} className='grid-row'>
                <td className='grid-cell font-mono text-[11px]'>{receipt.poId}</td>
                <td className='grid-cell text-[11px]'>{receipt.orderedOn}</td>
                <td className='grid-cell text-[11px]'>{receipt.qaReleasedOn ?? receipt.receivedOn}</td>
                <td className='grid-cell num'>{receipt.totalDays}</td>
                <td className={cn('grid-cell num', receipt.deviationDays > 0 && 'text-status-critical')}>
                  {receipt.deviationDays > 0 ? '+' : ''}
                  {receipt.deviationDays}
                </td>
                <td className='text-muted-foreground grid-cell text-[11px]'>{receipt.reasonLabel ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title='Provenance' note='System, field, value, and when it was last touched.'>
        <table className='w-full'>
          <tbody>
            {payload.provenance.map((row) => (
              <tr key={row.field} className='grid-row'>
                <td className='grid-cell'>{row.field}</td>
                <td className='grid-cell num'>{row.value}</td>
                <td className='text-muted-foreground grid-cell text-right text-[11px]'>{row.system}</td>
                <td
                  className={cn(
                    'grid-cell text-right text-[11px]',
                    row.ageDays > 365 ? 'text-status-attention' : 'text-muted-foreground',
                  )}
                >
                  {row.lastChangedOn}
                  {row.changedBy ? ` · ${row.changedBy}` : ''}
                  {row.ageDays > 365 ? ` · ${Math.round(row.ageDays / 365)}y ago` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <div className='px-6 py-4'>
        <p className='text-muted-foreground text-[11px]'>
          {detail.itemId} at {detail.plantId} · low-level code {detail.lowLevelCode} · every figure above comes from the
          run stamped {detail.header.mpsVersion}.
        </p>
      </div>
    </div>
  );
}

function ArithmeticRow({ line }: { line: ExplainLine }) {
  return (
    <div
      className={cn('flex items-baseline gap-2', line.emphasis && 'border-border/70 mt-1 border-t pt-1 font-semibold')}
    >
      <span className='text-muted-foreground w-3 shrink-0 text-right'>{line.operator}</span>
      <span className='flex-1 truncate'>{line.label}</span>
      <span className='w-28 shrink-0 text-right tabular-nums'>
        {line.value === null ? '' : `${formatNumber(line.value)} ${line.uom}`}
      </span>
      {line.source ? (
        <span className='text-muted-foreground w-[190px] shrink-0 truncate text-[10px]' title={line.source}>
          ← {line.source}
        </span>
      ) : (
        <span className='w-[190px] shrink-0' />
      )}
    </div>
  );
}

function ChainRow({ step, isLast }: { step: ChainStep; isLast: boolean }) {
  return (
    <li className='flex items-baseline gap-3'>
      <span
        className={cn(
          'mt-0.5 size-1.5 shrink-0 rounded-full',
          step.kind === 'PROCESS' ? 'bg-status-attention' : 'bg-primary',
        )}
      />
      <div className='flex-1'>
        <p className={cn('text-[13px]', isLast && 'font-medium')}>
          {formatNumber(step.resultQty)} <span className='text-muted-foreground text-[11px]'>{step.uom}</span>{' '}
          <span className='text-muted-foreground'>· {step.itemId}</span>
        </p>
        <p className='text-muted-foreground text-[11px]'>
          {step.label} — {step.factorLabel}
          <span
            className={cn(
              'ml-2 rounded px-1 py-px text-[10px]',
              step.kind === 'PROCESS' ? 'bg-status-attention/15 text-status-attention' : 'bg-primary/10 text-primary',
            )}
          >
            {step.kind === 'PROCESS' ? 'process' : 'decision'}
          </span>
        </p>
      </div>
    </li>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className='px-6 py-5'>
      <h3 className='text-[13px] font-semibold'>{title}</h3>
      {note ? (
        <p className='text-muted-foreground mt-0.5 mb-3 text-[11px] leading-snug'>{note}</p>
      ) : (
        <div className='mb-3' />
      )}
      {children}
    </section>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div>
      <p className='text-muted-foreground text-[11px]'>{label}</p>
      <p className={cn('text-[18px] font-semibold tabular-nums', tone === 'bad' && 'text-status-critical')}>{value}</p>
    </div>
  );
}

export function ExplainButton({ detail }: { detail: MaterialDetail }) {
  return (
    <ExplainDrawer
      detail={detail}
      trigger={
        <Button variant='outline' size='sm' className='h-8 text-[13px]'>
          Explain
        </Button>
      }
    />
  );
}
