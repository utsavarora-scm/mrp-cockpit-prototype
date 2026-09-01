'use client';

/**
 * Projected inventory over time.
 *
 * The screen's hero, and the picture a planner currently rebuilds by hand in a
 * spreadsheet one material at a time. Every element on it is load-bearing:
 *
 * **The balance is a stepped line.** Stock changes in discrete events, not
 * smooth curves, and a smoothed line implies a precision the plan does not
 * have.
 *
 * **Two balance lines, not one.** The solid line is the honest position — stock
 * and existing orders, nothing proposed. The dashed one is where the plan would
 * head if everything it recommends were actually done. Most tools draw only the
 * second, which hides the problem behind its own proposed solution.
 *
 * **Supply bars carry their confidence.** Solid where the vendor has
 * acknowledged the line, outlined where a purchase order exists and nothing
 * more, hatched where the system is only proposing it. Visual weight matches
 * how much anybody has actually agreed to.
 *
 * **The lead-time fence.** The vertical line marking the earliest a newly
 * placed order can arrive, labelled in words on the chart rather than in a
 * legend. Everything to its left is unsolvable by ordering, and that is the
 * fact a planner needs in the first three seconds.
 */

import { formatNumber } from '@repo/domain';
import { cn } from '@repo/ui/lib/utils';
import { useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { ChartBucket, FenceView, MaterialDetail } from '@/lib/api-types';

interface Props {
  detail: MaterialDetail;
  /** Draws the measured fence and the ghost line beside the maintained one. */
  showDrift: boolean;
}

export function ProjectionChart({ detail, showDrift }: Props) {
  const data = useMemo(
    () =>
      detail.buckets.map((bucket) => ({
        ...bucket,
        // Demand renders below the axis, so it is carried negative and the
        // sign is undone in the axis formatter and the tooltip.
        demandDown: -bucket.demand,
      })),
    [detail.buckets],
  );

  const maintained = detail.fences.maintained;
  const measured = detail.fences.measured;
  const breachBands = useMemo(() => bands(detail.buckets), [detail.buckets]);
  const zoneBoundaries = detail.buckets.filter((bucket) => bucket.startsZone && bucket.index > 0);

  return (
    <div className='bg-card rounded-lg border'>
      <div className='flex flex-wrap items-baseline justify-between gap-3 border-b px-5 py-3'>
        <div>
          <h2 className='text-[14px] font-semibold'>Projected inventory</h2>
          <p className='text-muted-foreground text-[12px]'>
            {detail.baseUom} · daily to week 4, then weekly · balance is a step, because stock moves in events
          </p>
        </div>
        <Legend detail={detail} showDrift={showDrift} />
      </div>

      <div className='px-2 py-4'>
        <ResponsiveContainer width='100%' height={380}>
          <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 8, left: 8 }}>
            <defs>
              {/* Tier 3 is hatched: the system proposed it and nothing is ordered. */}
              <pattern id='tier3' width='6' height='6' patternTransform='rotate(45)' patternUnits='userSpaceOnUse'>
                <rect width='6' height='6' fill='var(--muted)' />
                <line x1='0' y='0' x2='0' y2='6' stroke='var(--muted-foreground)' strokeWidth='1.6' opacity='0.5' />
              </pattern>
            </defs>

            <CartesianGrid stroke='var(--border)' strokeOpacity={0.5} vertical={false} />

            {/* Breach shading. Amber where the buffer is being eaten, red below zero. */}
            {breachBands.map((band) => (
              <ReferenceArea
                key={`${band.tone}-${band.from}`}
                x1={data[band.from]?.label}
                x2={data[band.to]?.label}
                fill={band.tone === 'STOCK_OUT' ? 'var(--status-critical)' : 'var(--status-attention)'}
                fillOpacity={band.tone === 'STOCK_OUT' ? 0.12 : 0.09}
                ifOverflow='extendDomain'
              />
            ))}

            <XAxis
              dataKey='label'
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              interval='preserveStartEnd'
              minTickGap={22}
              axisLine={{ stroke: 'var(--border)' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              tickFormatter={(value: number) => compact(Math.abs(value))}
              axisLine={false}
              tickLine={false}
              width={54}
              label={{
                value: detail.baseUom,
                angle: -90,
                position: 'insideLeft',
                style: { fontSize: 10, fill: 'var(--muted-foreground)' },
              }}
            />

            <Tooltip content={<BucketTooltip detail={detail} />} cursor={{ fill: 'var(--muted)', opacity: 0.35 }} />

            {/* Where the bucket width changes, so a weekly bar is never mistaken for a daily one. */}
            {zoneBoundaries.map((bucket) => (
              <ReferenceLine
                key={`zone-${bucket.index}`}
                x={bucket.label}
                stroke='var(--border)'
                strokeWidth={1}
                label={{
                  value: bucket.zone === 'SCHEDULING' ? 'weekly buckets' : 'procurement window',
                  position: 'insideTopLeft',
                  style: { fontSize: 9, fill: 'var(--muted-foreground)' },
                }}
              />
            ))}

            <Bar dataKey='confirmed' stackId='supply' fill='var(--status-settled)' fillOpacity={0.85} maxBarSize={22} />
            <Bar
              dataKey='committed'
              stackId='supply'
              fill='var(--status-attention)'
              fillOpacity={0.22}
              stroke='var(--status-attention)'
              strokeWidth={1}
              maxBarSize={22}
            />
            <Bar dataKey='planned' stackId='supply' fill='url(#tier3)' maxBarSize={22} />
            <Bar dataKey='demandDown' fill='var(--chart-3)' fillOpacity={0.5} maxBarSize={22} />

            <ReferenceLine y={0} stroke='var(--foreground)' strokeWidth={1.25} />
            <ReferenceLine
              y={detail.safetyStock}
              stroke='var(--status-attention)'
              strokeDasharray='5 3'
              label={{
                value: `safety stock ${formatNumber(detail.safetyStock)}`,
                position: 'right',
                style: { fontSize: 10, fill: 'var(--status-attention)' },
              }}
            />
            {detail.maxNorm !== null ? (
              <ReferenceLine
                y={detail.maxNorm}
                stroke='var(--muted-foreground)'
                strokeDasharray='2 4'
                label={{
                  value: `max norm ${formatNumber(detail.maxNorm)}`,
                  position: 'right',
                  style: { fontSize: 10, fill: 'var(--muted-foreground)' },
                }}
              />
            ) : null}

            {/* Today. */}
            <ReferenceLine x={data[0]?.label} stroke='var(--foreground)' strokeWidth={1.5} strokeOpacity={0.7} />

            {/*
             * The lead-time fence — the most important line here, and the one
             * most planning tools omit. Labelled in words, not in a legend.
             */}
            <FenceLine fence={maintained} data={data} tone='var(--primary)' label='earliest a new order can land' />
            {showDrift && measured ? (
              <FenceLine
                fence={measured}
                data={data}
                tone='var(--status-critical)'
                label={`measured lead time — ${measured.totalDays} days`}
                dashed
              />
            ) : null}

            <Line
              type='stepAfter'
              dataKey='balanceAfterPlanned'
              stroke='var(--chart-2)'
              strokeWidth={1.5}
              strokeDasharray='4 3'
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type='stepAfter'
              dataKey='balanceBeforePlanned'
              stroke='var(--chart-1)'
              strokeWidth={2.25}
              dot={false}
              isAnimationActive={false}
            />
            {showDrift ? (
              <Line
                type='stepAfter'
                dataKey='balanceConfirmedOnly'
                stroke='var(--status-critical)'
                strokeWidth={1.5}
                strokeDasharray='2 3'
                dot={false}
                isAnimationActive={false}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <FenceNote detail={detail} showDrift={showDrift} />
    </div>
  );
}

function FenceLine({
  fence,
  data,
  tone,
  label,
  dashed,
}: {
  fence: FenceView;
  data: Array<{ label: string }>;
  tone: string;
  label: string;
  dashed?: boolean;
}) {
  const x = data[Math.min(fence.earliestReceiptBucket, data.length - 1)]?.label;
  if (!x) return null;
  return (
    <ReferenceLine
      x={x}
      stroke={tone}
      strokeWidth={1.5}
      strokeDasharray={dashed ? '6 4' : undefined}
      label={{
        value: `${label} · ${fence.earliestReceiptWeek}`,
        position: 'insideTopRight',
        style: { fontSize: 10, fill: tone, fontWeight: 500 },
      }}
    />
  );
}

/**
 * The sentence under the chart.
 *
 * Says out loud what the fence means for this material, because a vertical line
 * a planner has to interpret is a vertical line half of them will not.
 */
function FenceNote({ detail, showDrift }: { detail: MaterialDetail; showDrift: boolean }) {
  const breach = detail.firstBreachDate;
  const fence = detail.fences.maintained;
  const measured = detail.fences.measured;

  const unreachable = breach !== null && breach < fence.earliestReceiptDate;
  const weeks = unreachable
    ? Math.round((Date.parse(fence.earliestReceiptDate) - Date.parse(breach)) / (7 * 86_400_000))
    : 0;

  return (
    <div className='text-muted-foreground space-y-1 border-t px-5 py-3 text-[12px] leading-relaxed'>
      <p>
        A purchase order placed today lands on{' '}
        <span className='text-foreground font-medium'>
          {fence.earliestReceiptDate} ({fence.earliestReceiptWeek})
        </span>{' '}
        at the maintained {fence.totalDays}-day chain.
        {unreachable ? (
          <>
            {' '}
            The position breaches on <span className='text-status-critical font-medium'>{breach}</span> — {weeks}{' '}
            {weeks === 1 ? 'week' : 'weeks'} to the left of the fence.{' '}
            <span className='text-foreground font-medium'>That window cannot be reached by ordering.</span>
          </>
        ) : breach === null ? (
          ' Nothing in the horizon breaches on stock and existing orders.'
        ) : (
          ` The position breaches on ${breach}, which an order placed now can still reach.`
        )}
      </p>
      {showDrift && measured ? (
        <p>
          On the measured {measured.totalDays}-day lead time the fence moves to{' '}
          <span className='text-status-critical font-medium'>
            {measured.earliestReceiptDate} ({measured.earliestReceiptWeek})
          </span>
          {detail.fences.driftDays !== null ? ` — ${Math.abs(detail.fences.driftDays)} days further out` : ''}. The
          dotted balance is what remains if only acknowledged supply turns up.
        </p>
      ) : null}
    </div>
  );
}

function Legend({ detail, showDrift }: { detail: MaterialDetail; showDrift: boolean }) {
  return (
    <div className='text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]'>
      <Key swatch={<span className='bg-chart-1 h-0.5 w-4 rounded-full' />}>balance before planned orders</Key>
      <Key
        swatch={
          <span
            className='h-0.5 w-4 rounded-full'
            style={{ backgroundImage: 'repeating-linear-gradient(90deg, var(--chart-2) 0 4px, transparent 4px 7px)' }}
          />
        }
      >
        after planned orders
      </Key>
      {showDrift ? (
        <Key
          swatch={
            <span
              className='h-0.5 w-4 rounded-full'
              style={{
                backgroundImage: 'repeating-linear-gradient(90deg, var(--status-critical) 0 2px, transparent 2px 5px)',
              }}
            />
          }
        >
          acknowledged supply only
        </Key>
      ) : null}
      <Key swatch={<span className='bg-status-settled size-2.5 rounded-[2px]' />}>confirmed</Key>
      <Key swatch={<span className='border-status-attention size-2.5 rounded-[2px] border' />}>committed</Key>
      <Key
        swatch={
          <span
            className='border-muted-foreground/50 size-2.5 rounded-[2px] border border-dashed'
            style={{
              backgroundImage: 'repeating-linear-gradient(45deg, var(--muted-foreground) 0 1px, transparent 1px 3px)',
              opacity: 0.6,
            }}
          />
        }
      >
        planned
      </Key>
      <Key swatch={<span className='bg-chart-3/50 size-2.5 rounded-[2px]' />}>demand ({detail.baseUom})</Key>
    </div>
  );
}

function Key({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className='inline-flex items-center gap-1.5'>
      {swatch}
      {children}
    </span>
  );
}

/**
 * The complete arithmetic for one bucket: opening, in, out, closing, against
 * safety stock. A hover that shows a single number is a hover nobody trusts.
 */
function BucketTooltip({
  active,
  payload,
  detail,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartBucket }>;
  detail: MaterialDetail;
}) {
  const bucket = payload?.[0]?.payload;
  if (!active || !bucket) return null;

  const index = bucket.index;
  const opening = index === 0 ? detail.stock.unrestricted : (detail.buckets[index - 1]?.balanceBeforePlanned ?? 0);
  const supply = bucket.confirmed + bucket.committed;
  const uom = detail.baseUom;

  return (
    <div className='bg-popover text-popover-foreground w-[300px] rounded-md border p-3 text-[12px] shadow-md'>
      <p className='mb-2 flex items-baseline justify-between font-medium'>
        <span>
          {bucket.label} · {bucket.week}
        </span>
        <span className='text-muted-foreground text-[11px] font-normal'>
          {bucket.kind === 'DAY' ? 'one day' : `${bucket.startDate.slice(5)}–${bucket.endDate.slice(5)}`}
        </span>
      </p>

      <dl className='space-y-0.5'>
        <Row label='Opening balance' value={opening} uom={uom} />
        <Row label='Receipts — confirmed' value={bucket.confirmed} uom={uom} sign='+' />
        <Row label='Receipts — committed' value={bucket.committed} uom={uom} sign='+' />
        {bucket.qaRelease > 0 ? (
          <Row label='of which quality release' value={bucket.qaRelease} uom={uom} muted />
        ) : null}
        <Row label='Gross requirement' value={bucket.demand} uom={uom} sign='−' />
        <div className='border-border/60 mt-1 border-t pt-1'>
          <Row label='Closing balance' value={bucket.balanceBeforePlanned} uom={uom} emphasis />
        </div>
        <Row label='Safety stock' value={bucket.safetyStock} uom={uom} muted />
        <Row
          label='Against safety stock'
          value={bucket.balanceBeforePlanned - bucket.safetyStock}
          uom={uom}
          tone={bucket.balanceBeforePlanned < bucket.safetyStock ? 'bad' : 'good'}
        />
      </dl>

      {bucket.planned > 0 ? (
        <p className='text-muted-foreground mt-2 border-t pt-2 text-[11px]'>
          The plan proposes {formatNumber(bucket.planned)} {uom} here. Nothing has been ordered.
        </p>
      ) : null}

      <p className='text-muted-foreground mt-2 text-[11px]'>
        {opening.toFixed(0)} + {supply.toFixed(0)} − {bucket.demand.toFixed(0)} ={' '}
        {bucket.balanceBeforePlanned.toFixed(0)} · {bucket.fenceZone.toLowerCase()} zone ·{' '}
        {bucket.daysOfCover.toFixed(1)} days of cover
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  uom,
  sign,
  emphasis,
  muted,
  tone,
}: {
  label: string;
  value: number;
  uom: string;
  sign?: '+' | '−';
  emphasis?: boolean;
  muted?: boolean;
  tone?: 'good' | 'bad';
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4', muted && 'text-muted-foreground')}>
      <dt className={cn(emphasis && 'font-medium')}>
        {sign ? <span className='text-muted-foreground mr-1'>{sign}</span> : null}
        {label}
      </dt>
      <dd
        className={cn(
          'tabular-nums',
          emphasis && 'font-medium',
          tone === 'bad' && 'text-status-critical',
          tone === 'good' && 'text-status-settled',
        )}
      >
        {formatNumber(value)} <span className='text-muted-foreground text-[10px]'>{uom}</span>
      </dd>
    </div>
  );
}

/** Contiguous runs of buckets in the same trouble, so shading is one band each. */
function bands(buckets: ChartBucket[]): Array<{ from: number; to: number; tone: 'BREACH' | 'STOCK_OUT' }> {
  const out: Array<{ from: number; to: number; tone: 'BREACH' | 'STOCK_OUT' }> = [];
  let current: { from: number; to: number; tone: 'BREACH' | 'STOCK_OUT' } | null = null;

  for (const bucket of buckets) {
    const tone = bucket.status === 'STOCK_OUT' ? 'STOCK_OUT' : bucket.status === 'BREACH' ? 'BREACH' : null;
    if (tone === null) {
      if (current) out.push(current);
      current = null;
      continue;
    }
    if (current && current.tone === tone) current.to = bucket.index;
    else {
      if (current) out.push(current);
      current = { from: bucket.index, to: bucket.index, tone };
    }
  }
  if (current) out.push(current);
  return out;
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
}
