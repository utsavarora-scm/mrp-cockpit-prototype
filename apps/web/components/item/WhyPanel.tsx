'use client';

/**
 * "Why this quantity?" — the trust layer.
 *
 * Two nested subtractions and the assumptions underneath them. The arithmetic is
 * laid out as arithmetic, right-aligned with a rule above each total, because a
 * planner checking a number wants to see it add up, not read a paragraph
 * claiming that it does.
 *
 * Every figure comes from the run that produced the recommendation. Nothing here
 * is recomputed for display — a trust panel that can disagree with the plan it
 * is explaining is worse than no panel.
 */

import { formatDateFull, formatDays, formatNumber } from '@repo/domain';
import { Badge } from '@repo/ui/components/badge';
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
import { Calculator, TriangleAlert } from 'lucide-react';

import type { MrpExplain } from '@/lib/api-types';

export function WhyPanel({ explain, uom, itemId }: { explain: MrpExplain; uom: string; itemId: string }) {
  const driftDays =
    explain.assumptions.observedLeadTimeDays === null
      ? null
      : explain.assumptions.observedLeadTimeDays - explain.assumptions.leadTimeDays;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant='outline' size='sm' className='h-6 gap-1.5 px-2 text-[11.5px]'>
          <Calculator className='size-3' />
          Why this recommendation?
        </Button>
      </SheetTrigger>

      <SheetContent className='flex w-[440px] flex-col gap-0 overflow-y-auto p-0 sm:max-w-[440px]'>
        <SheetHeader className='border-b px-4 py-3'>
          <SheetTitle className='text-[14px]'>
            Recommended order{' '}
            <span className='mono'>
              {formatNumber(explain.recommendedQty)} {uom}
            </span>
          </SheetTitle>
          <SheetDescription className='text-[12px]'>
            <span className='mono'>{itemId}</span> — every figure below is from the run that raised it.
          </SheetDescription>
        </SheetHeader>

        {explain.isReleaseInPast ? (
          <div className='sev-critical flex items-start gap-2 border-b px-4 py-2 text-[11.5px]'>
            <TriangleAlert className='mt-px size-3.5 shrink-0' />
            <span>
              To land on {formatDateFull(explain.receiptDate)} this had to be released on{' '}
              {formatDateFull(explain.releaseDate)} — {formatDays(explain.totalOffsetDays)} of lead time, goods receipt
              and safety time ago. The plan is recommending an order it is already too late to place.
            </span>
          </div>
        ) : null}

        {/* The headline subtraction. */}
        <Section title='Net requirement' subtitle='What the position is short of the level it must hold'>
          <Line label='Order-up-to level' value={explain.orderUpToLevel} uom={uom} />
          <Line label='Effective stock' value={-explain.effectiveStock.total} uom={uom} />
          <Line label='Net requirement' value={explain.netRequirement} uom={uom} total />
        </Section>

        {/* …and what "effective stock" is actually made of. */}
        <Section
          title='Effective stock'
          subtitle='Stock on hand, plus inbound the plan counts, less what is spoken for'
        >
          <Line label='On-hand stock' value={explain.effectiveStock.onHand} uom={uom} />
          <Line label='Inbound before this date' value={explain.effectiveStock.inbound} uom={uom} />
          <Line label='Existing commitments' value={-explain.effectiveStock.commitments} uom={uom} />
          <Line label='Effective stock' value={explain.effectiveStock.total} uom={uom} total />

          {/* The caveat on the inbound line, not a term in it. */}
          {explain.effectiveStock.unconfirmedInbound > 0 ? (
            <p className='text-muted-foreground mt-1.5 border-t pt-1.5 text-[11.5px] leading-tight'>
              Of that inbound,{' '}
              <span className='mono text-primary font-medium'>
                {formatNumber(explain.effectiveStock.unconfirmedInbound)} {uom}
              </span>{' '}
              has no supplier commitment behind it. The plan is netting against it as though the date were certain.
            </p>
          ) : null}
        </Section>

        {explain.ruleQty !== explain.recommendedQty ? (
          <Section title='Lot sizing' subtitle='What the rule asked for, and what the supplier will actually take'>
            <Line label='Net requirement' value={explain.netRequirement} uom={uom} />
            <Line
              label={`Sized by ${explain.assumptions.lotSizeRule ?? 'the lot-size rule'}`}
              value={explain.ruleQty}
              uom={uom}
            />
            <Line label='After MOQ and rounding' value={explain.recommendedQty} uom={uom} total />
          </Section>
        ) : null}

        <Section title='Source assumptions' subtitle='The master data this recommendation rests on'>
          <Assumption
            label='Average daily demand'
            value={`${formatNumber(explain.assumptions.averageDailyDemand)} ${uom}`}
          />
          <Assumption label='Safety stock' value={`${formatNumber(explain.assumptions.safetyStock)} ${uom}`} />
          <Assumption label='Inventory norm' value={`${formatNumber(explain.assumptions.inventoryNorm)} ${uom}`} />
          <Assumption
            label='Lead time'
            value={formatDays(explain.assumptions.leadTimeDays)}
            drift={
              driftDays !== null && Math.abs(driftDays) >= 2
                ? `${driftDays > 0 ? '+' : ''}${Math.round(driftDays)}d against ${formatDays(
                    explain.assumptions.observedLeadTimeDays ?? 0,
                  )} actually observed`
                : null
            }
          />
          {explain.assumptions.lotSizeRule ? (
            <Assumption label='Lot-size rule' value={explain.assumptions.lotSizeRule} />
          ) : null}
          {explain.assumptions.moq ? (
            <Assumption label='Minimum order quantity' value={`${formatNumber(explain.assumptions.moq)} ${uom}`} />
          ) : null}
        </Section>

        <Section title='Dates' subtitle='When it has to be placed for when it is needed'>
          <Assumption label='Receipt needed' value={formatDateFull(explain.receiptDate)} />
          <Assumption
            label='Release by'
            value={formatDateFull(explain.releaseDate)}
            drift={explain.isReleaseInPast ? 'already passed' : null}
          />
          <Assumption label='Total offset' value={formatDays(explain.totalOffsetDays)} />
        </Section>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className='border-b'>
      <div className='bg-muted/40 px-4 py-1.5'>
        <div className='text-[11px] font-medium tracking-wide uppercase'>{title}</div>
        <div className='text-muted-foreground text-[10.5px]'>{subtitle}</div>
      </div>
      <div className='px-4 py-1.5'>{children}</div>
    </section>
  );
}

/**
 * One line of arithmetic. Negatives print with a leading minus and totals carry
 * a rule above them, so the column reads the way it would on paper.
 */
function Line({ label, value, uom, total }: { label: string; value: number; uom: string; total?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between py-[3px] text-[12.5px]',
        total && 'border-foreground/20 mt-0.5 border-t pt-1 font-semibold',
      )}
    >
      <span className={cn(!total && 'text-muted-foreground')}>{label}</span>
      <span className='mono'>
        {value < 0 ? '−' : ''}
        {formatNumber(Math.abs(value))} <span className='text-muted-foreground/70 font-normal'>{uom}</span>
      </span>
    </div>
  );
}

function Assumption({ label, value, drift }: { label: string; value: string; drift?: string | null }) {
  return (
    <div className='flex items-baseline justify-between gap-2 py-[3px] text-[12.5px]'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='flex items-baseline gap-1.5 text-right'>
        <span className='mono'>{value}</span>
        {drift ? (
          <Badge variant='outline' className='health-drifted h-4 shrink-0 px-1 text-[10px] font-normal'>
            {drift}
          </Badge>
        ) : null}
      </span>
    </div>
  );
}
