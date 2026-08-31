'use client';

/**
 * Explain — the trust layer.
 *
 * The demo lives or dies on one question the last one could not answer: *where
 * does this number come from?* So the drawer has exactly two levels and a hard
 * rule about them.
 *
 * **Level one** is the arithmetic, laid out as arithmetic — right-aligned, a
 * rule above each total — because a planner checking a figure wants to watch it
 * add up, not read a paragraph asserting that it does. Every value is from the
 * run that produced the recommendation; nothing is recomputed for display. A
 * trust panel that can disagree with the plan it explains is worse than none.
 *
 * **Level two** is the raw source behind any input that came from evidence
 * rather than from master data. Today that is the lead time, and clicking it
 * lists the individual goods receipts it was averaged over — with the unmatched
 * ones counted and named as excluded, never quietly dropped. Two levels is the
 * budget: any figure on screen reaches a source in at most two clicks, and if
 * something needs a third it belongs on a screen, not in a drawer.
 */

import { formatDateFull, formatDateShort, formatDays, formatNumber } from '@repo/domain';
import { Button } from '@repo/ui/components/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@repo/ui/components/sheet';
import { cn } from '@repo/ui/lib/utils';
import { ChevronRight, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import type { ItemDetail, LeadTimeEvidence, MrpExplain } from '@/lib/api-types';

export function ExplainDrawer({
  detail,
  explain,
  trigger,
}: {
  detail: ItemDetail;
  explain: MrpExplain;
  trigger?: React.ReactNode;
}) {
  const [showReceipts, setShowReceipts] = useState(false);
  const uom = detail.baseUom;

  return (
    <Sheet onOpenChange={(open) => !open && setShowReceipts(false)}>
      <SheetTrigger asChild>
        {trigger ?? (
          <Button variant='outline' size='sm' className='h-8 text-[13px]'>
            Explain this number
          </Button>
        )}
      </SheetTrigger>

      <SheetContent className='flex w-[480px] flex-col gap-0 overflow-y-auto p-0 sm:max-w-[480px]'>
        <SheetHeader className='space-y-1 border-b px-6 py-5'>
          <SheetTitle className='text-[15px] font-semibold'>
            {showReceipts ? 'Goods receipts behind the lead time' : 'Why this order quantity'}
          </SheetTitle>
          <SheetDescription className='text-[13px]'>
            {showReceipts ? (
              <>
                {detail.itemId} · {detail.plantId} — every receipt the average was taken over.
              </>
            ) : (
              <>
                Recommending{' '}
                <span className='text-foreground font-medium tabular-nums'>
                  {formatNumber(explain.recommendedQty)} {uom}
                </span>{' '}
                for receipt on {formatDateFull(explain.receiptDate)}.
              </>
            )}
          </SheetDescription>
        </SheetHeader>

        {showReceipts ? (
          <Receipts evidence={detail.leadTime} uom={uom} onBack={() => setShowReceipts(false)} />
        ) : (
          <Working detail={detail} explain={explain} onDrillLeadTime={() => setShowReceipts(true)} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Working({
  detail,
  explain,
  onDrillLeadTime,
}: {
  detail: ItemDetail;
  explain: MrpExplain;
  onDrillLeadTime: () => void;
}) {
  const uom = detail.baseUom;
  const evidence = detail.leadTime;
  const drift =
    evidence.observedMeanDays !== null && evidence.maintainedDays !== null
      ? evidence.observedMeanDays - evidence.maintainedDays
      : null;

  return (
    <>
      {explain.isReleaseInPast ? (
        <div className='bg-status-critical/8 text-status-critical flex items-start gap-2.5 border-b px-6 py-3 text-[13px] leading-relaxed'>
          <TriangleAlert className='mt-0.5 size-4 shrink-0' />
          <span>
            To land on {formatDateFull(explain.receiptDate)} this had to be placed on{' '}
            {formatDateFull(explain.releaseDate)} — {formatDays(explain.totalOffsetDays)} ago. The plan is recommending
            an order it is already too late to place.
          </span>
        </div>
      ) : null}

      <Section title='Net requirement' subtitle='What the position is short of the level it has to hold'>
        <Row label='Order-up-to level' value={explain.orderUpToLevel} uom={uom} />
        <Row label='Less effective stock' value={-explain.effectiveStock.total} uom={uom} />
        <Row label='Net requirement' value={explain.netRequirement} uom={uom} total />
      </Section>

      <Section title='Effective stock' subtitle='On hand, plus inbound the plan counts, less what is spoken for'>
        <Row label='Stock on hand' value={explain.effectiveStock.onHand} uom={uom} />
        <Row label='Inbound before this date' value={explain.effectiveStock.inbound} uom={uom} />
        <Row label='Less existing commitments' value={-explain.effectiveStock.commitments} uom={uom} />
        <Row label='Effective stock' value={explain.effectiveStock.total} uom={uom} total />
        {explain.effectiveStock.unconfirmedInbound > 0 ? (
          <p className='text-muted-foreground border-border/60 mt-3 border-t pt-3 text-[12px] leading-relaxed'>
            Of that inbound,{' '}
            <span className='text-foreground font-medium tabular-nums'>
              {formatNumber(explain.effectiveStock.unconfirmedInbound)} {uom}
            </span>{' '}
            has no supplier commitment behind it. The plan is netting against it as though the date were certain.
          </p>
        ) : null}
      </Section>

      {explain.ruleQty !== explain.recommendedQty ? (
        <Section title='Lot sizing' subtitle='What the rule asked for, and what the supplier will actually take'>
          <Row label='Net requirement' value={explain.netRequirement} uom={uom} />
          <Row
            label={`Sized by ${explain.assumptions.lotSizeRule ?? 'the lot-size rule'}`}
            value={explain.ruleQty}
            uom={uom}
          />
          <Row label='After MOQ and rounding' value={explain.recommendedQty} uom={uom} total />
        </Section>
      ) : null}

      <Section title='What it rests on' subtitle='The inputs behind the arithmetic above'>
        <Input label='Average daily demand' value={`${formatNumber(explain.assumptions.averageDailyDemand)} ${uom}`} />
        <Input label='Safety stock' value={`${formatNumber(explain.assumptions.safetyStock)} ${uom}`} />
        <Input label='Inventory norm' value={`${formatNumber(explain.assumptions.inventoryNorm)} ${uom}`} />

        {/* The one input that came from evidence rather than master data, so the
            one that gets a way through to the evidence. */}
        <SourceRow
          label='Lead time'
          value={formatDays(explain.assumptions.leadTimeDays)}
          source={`${evidence.maintainedSource} · maintained ${formatDateShort(evidence.paramsLastChangedOn)}`}
          note={
            drift !== null && Math.abs(drift) >= 1
              ? `${formatDays(evidence.observedMeanDays as number)} actually observed — ${drift > 0 ? '+' : ''}${Math.round(drift)} days`
              : null
          }
          drilldown={`${evidence.matchedCount} receipts matched${
            evidence.unmatchedCount > 0 ? ` · ${evidence.unmatchedCount} unmatched, excluded` : ''
          }`}
          onDrill={evidence.matchedCount > 0 ? onDrillLeadTime : undefined}
        />

        {explain.assumptions.moq ? (
          <Input label='Minimum order quantity' value={`${formatNumber(explain.assumptions.moq)} ${uom}`} />
        ) : null}
      </Section>

      <Section title='Dates' subtitle='When it has to be placed, for when it is needed'>
        <Input label='Receipt needed' value={formatDateFull(explain.receiptDate)} />
        <Input
          label='Place by'
          value={formatDateFull(explain.releaseDate)}
          tone={explain.isReleaseInPast ? 'critical' : undefined}
        />
        <Input label='Total offset' value={formatDays(explain.totalOffsetDays)} />
      </Section>
    </>
  );
}

/** Level two: the receipts themselves. */
function Receipts({ evidence, uom, onBack }: { evidence: LeadTimeEvidence; uom: string; onBack: () => void }) {
  return (
    <>
      <div className='border-b px-6 py-3'>
        <button
          type='button'
          onClick={onBack}
          className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[13px]'
        >
          <ChevronRight className='size-3.5 rotate-180' />
          Back to the working
        </button>
      </div>

      <div className='bg-surface-sunken border-b px-6 py-4'>
        <div className='flex items-baseline justify-between'>
          <span className='text-muted-foreground text-[12px] font-medium'>Observed lead time</span>
          <span className='text-[24px] font-semibold tracking-[-0.02em] tabular-nums'>
            {formatDays(evidence.observedMeanDays ?? 0)}
          </span>
        </div>
        <p className='text-muted-foreground mt-1 text-[12px] leading-relaxed'>
          Mean of {evidence.matchedCount} matched receipts
          {evidence.observedStdDevDays !== null
            ? `, standard deviation ${evidence.observedStdDevDays.toFixed(1)} days`
            : ''}
          .
          {evidence.unmatchedCount > 0 ? (
            <>
              {' '}
              {evidence.unmatchedCount} further receipts could not be reconciled to a delivery line and are excluded —
              they are kept in the unmatched queue, not discarded.
            </>
          ) : null}
        </p>
      </div>

      <table className='w-full'>
        <thead className='bg-surface-sunken sticky top-0'>
          <tr>
            <Th>Order</Th>
            <Th>Ordered</Th>
            <Th>Received</Th>
            <Th align='right'>Days</Th>
          </tr>
        </thead>
        <tbody>
          {evidence.receipts.map((receipt) => {
            const late = evidence.maintainedDays !== null && receipt.actualLeadTimeDays > evidence.maintainedDays;
            return (
              <tr key={receipt.poId} className='border-border/50 border-b'>
                <td className='py-2.5 pl-6 font-mono text-[12px]'>{receipt.poId}</td>
                <td className='text-muted-foreground py-2.5 text-[13px]'>{formatDateShort(receipt.orderedOn)}</td>
                <td className='py-2.5 text-[13px]'>{formatDateShort(receipt.receivedOn)}</td>
                <td
                  className={cn(
                    'py-2.5 pr-6 text-right text-[13px] font-medium tabular-nums',
                    late && 'text-status-attention',
                  )}
                >
                  {receipt.actualLeadTimeDays}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className='text-muted-foreground px-6 py-4 text-[12px] leading-relaxed'>
        Quantities average {formatNumber(evidence.receipts[0]?.qty ?? 0)} {uom} a delivery, from{' '}
        {evidence.receipts[0]?.vendorName ?? evidence.receipts[0]?.vendorId ?? 'the supplier'}. Days are received-on
        less ordered-on, in calendar days — never a value stored alongside the dates.
      </p>
    </>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className='border-b px-6 py-5'>
      <h3 className='text-muted-foreground text-[12px] font-semibold tracking-[0.04em] uppercase'>{title}</h3>
      <p className='text-muted-foreground mt-0.5 mb-3 text-[12px]'>{subtitle}</p>
      {children}
    </section>
  );
}

/** One line of arithmetic. Totals carry a rule, the way they would on paper. */
function Row({ label, value, uom, total }: { label: string; value: number; uom: string; total?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 py-1',
        total && 'border-foreground/25 mt-1 border-t pt-2 font-semibold',
      )}
    >
      <span className={cn('text-[13px]', !total && 'text-muted-foreground')}>{label}</span>
      <span className='text-[13px] tabular-nums'>
        {value < 0 ? '−' : ''}
        {formatNumber(Math.abs(value))} <span className='text-muted-foreground font-normal'>{uom}</span>
      </span>
    </div>
  );
}

function Input({ label, value, tone }: { label: string; value: string; tone?: 'critical' }) {
  return (
    <div className='flex items-baseline justify-between gap-4 py-1'>
      <span className='text-muted-foreground text-[13px]'>{label}</span>
      <span className={cn('text-[13px] tabular-nums', tone === 'critical' && 'text-status-critical font-medium')}>
        {value}
      </span>
    </div>
  );
}

/**
 * An input that carries its provenance: where the value is maintained, what the
 * evidence says instead, and a way through to the evidence itself.
 */
function SourceRow({
  label,
  value,
  source,
  note,
  drilldown,
  onDrill,
}: {
  label: string;
  value: string;
  source: string;
  note: string | null;
  drilldown: string;
  onDrill?: () => void;
}) {
  return (
    <div className='border-border/60 mt-2 border-t pt-3'>
      <div className='flex items-baseline justify-between gap-4'>
        <span className='text-muted-foreground text-[13px]'>{label}</span>
        <span className='text-[13px] font-medium tabular-nums'>{value}</span>
      </div>
      <p className='text-muted-foreground mt-1 text-[12px]'>{source}</p>
      {note ? <p className='text-status-attention mt-1 text-[12px] font-medium'>{note}</p> : null}
      {onDrill ? (
        <button
          type='button'
          onClick={onDrill}
          className='text-primary mt-2 inline-flex items-center gap-1 text-[12px] font-medium hover:underline'
        >
          {drilldown}
          <ChevronRight className='size-3.5' />
        </button>
      ) : (
        <p className='text-muted-foreground mt-2 text-[12px]'>{drilldown}</p>
      )}
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={cn(
        'text-muted-foreground py-2 text-[11px] font-medium tracking-[0.04em] uppercase',
        align === 'right' ? 'pr-6 text-right' : 'pl-6 text-left',
      )}
    >
      {children}
    </th>
  );
}
