'use client';

/**
 * The projection chart.
 *
 * The most valuable single visual in the product, and the one Act 1 is read
 * off. Three decisions carry it, and getting any of them wrong makes the chart
 * unreadable no matter how it is styled:
 *
 * 1. **Weekly buckets, not daily.** 180 daily points turn receipt bars into
 *    hairlines and the balance into noise. Planners read replenishment in
 *    periods, and the sawtooth only becomes visible once it is bucketed.
 *
 * 2. **The y-axis is scaled to the working range**, which means the norm band
 *    and the stock it governs stay legible. This is the one that matters most:
 *    a safety stock of 121 MT is invisible on an axis stretched to −6,000, and
 *    an invisible norm band makes the whole chart pointless.
 *
 * 3. **The confirmed-only line stops where it stops carrying information.**
 *    Suppliers confirm perhaps three weeks out, so "confirmed only" over six
 *    months is really "if we never place another order again" — true, useless,
 *    and it drags the axis into the basement. Its actual information is a
 *    single fact: the date cover runs out. So the line is drawn to that point
 *    and marked there, rather than plotted into a void.
 *
 * What remains is the picture planners actually use: stock drawing down against
 * a visible buffer, receipts arriving, and the balance sawtoothing around the
 * norm — with the honest and the hopeful views never merged into one line.
 */

import { formatDateShort, formatNumber } from '@repo/domain';
import { cn } from '@repo/ui/lib/utils';
import {
  Area,
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
import { useState } from 'react';

import type { ItemDetail } from '@/lib/api-types';

const HORIZONS = [
  { weeks: 4, label: '4 weeks' },
  { weeks: 13, label: '13 weeks' },
  { weeks: 26, label: '26 weeks' },
] as const;

interface Bucket {
  weekStart: string;
  norm: number;
  requirement: number;
  confirmedIn: number;
  plannedIn: number;
  /** Closing balance for the week, counting only committed supply. */
  balanceConfirmed: number | null;
  /** Closing balance including unconfirmed lines and engine-planned orders. */
  balanceWithPlanned: number;
  shortfall: number;
}

function toWeeks(detail: ItemDetail, weeks: number, floor: number): Bucket[] {
  const buckets: Bucket[] = [];
  const days = Math.min(weeks * 7, detail.dates.length);

  for (let start = 0; start < days; start += 7) {
    const end = Math.min(start + 6, days - 1);
    let requirement = 0;
    let confirmedIn = 0;
    let plannedIn = 0;
    for (let day = start; day <= end; day += 1) {
      requirement += detail.grossRequirements[day] ?? 0;
      confirmedIn += detail.confirmedReceipts[day] ?? 0;
      plannedIn += (detail.plannedReceipts[day] ?? 0) + (detail.unconfirmedReceipts[day] ?? 0);
    }

    const balanceConfirmed = detail.balanceConfirmed[end] ?? 0;
    const balanceWithPlanned = detail.balanceWithPlanned[end] ?? 0;

    buckets.push({
      weekStart: detail.dates[start] as string,
      norm: detail.safetyStock,
      requirement,
      confirmedIn,
      plannedIn,
      // Once it falls past the floor it has stopped saying anything the marker
      // does not already say, so the line ends rather than running off-scale.
      balanceConfirmed: balanceConfirmed < floor ? null : balanceConfirmed,
      balanceWithPlanned,
      shortfall: Math.min(0, balanceWithPlanned),
    });
  }

  return buckets;
}

/**
 * The axis is scaled to the plan's own position and its buffer — never to the
 * confirmed-only line, which by construction heads to minus infinity.
 */
function verticalRange(detail: ItemDetail, weeks: number): { floor: number; ceiling: number } {
  const days = Math.min(weeks * 7, detail.dates.length);
  let peak = detail.safetyStock;
  let trough = 0;
  for (let day = 0; day < days; day += 1) {
    const value = detail.balanceWithPlanned[day] ?? 0;
    if (value > peak) peak = value;
    if (value < trough) trough = value;
  }
  const headroom = Math.max(peak * 0.15, detail.safetyStock * 0.5);
  return {
    floor: Math.min(trough * 1.2, -Math.max(peak * 0.3, detail.safetyStock * 1.5)),
    ceiling: peak + headroom,
  };
}

export function ProjectionChart({ detail }: { detail: ItemDetail }) {
  const [weeks, setWeeks] = useState<number>(13);
  const { floor, ceiling } = verticalRange(detail, weeks);
  const data = toWeeks(detail, weeks, floor);
  const stockoutDate = detail.position.stockoutDate;
  const withinView = stockoutDate ? stockoutDate <= (data[data.length - 1]?.weekStart ?? '') : false;

  return (
    <section className='bg-card rounded-lg border p-6'>
      <header className='mb-5 flex flex-wrap items-start justify-between gap-4'>
        <div>
          <h2 className='text-muted-foreground text-[15px] font-semibold tracking-[0.04em] uppercase'>
            Projected stock position
          </h2>
          <p className='text-muted-foreground mt-1 text-[12px]'>
            Weekly, from {formatDateShort(detail.planningDate)} · {detail.baseUom}
          </p>
        </div>
        <div className='flex gap-1' role='group' aria-label='Horizon'>
          {HORIZONS.map((option) => (
            <button
              key={option.weeks}
              type='button'
              onClick={() => setWeeks(option.weeks)}
              className={cn(
                'rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
                weeks === option.weeks
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <Legend />

      <div className='mt-4 h-[340px] w-full'>
        <ResponsiveContainer width='100%' height='100%'>
          <ComposedChart data={data} margin={{ top: 16, right: 16, bottom: 4, left: 8 }}>
            {/* 1 — the norm band, drawn as a region so it reads as a zone to stay above */}
            <ReferenceArea
              y1={0}
              y2={detail.safetyStock}
              fill='var(--muted-foreground)'
              fillOpacity={0.14}
              stroke='none'
            />

            {/* 2 — shortfall, only where the plan's own position goes negative */}
            <Area
              dataKey='shortfall'
              baseValue={0}
              fill='var(--status-critical)'
              fillOpacity={0.18}
              stroke='none'
              isAnimationActive={false}
            />

            <CartesianGrid vertical={false} stroke='var(--grid-line)' />
            <XAxis
              dataKey='weekStart'
              tickFormatter={formatDateShort}
              tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis
              domain={[floor, ceiling]}
              tickFormatter={(value: number) => formatNumber(value)}
              tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
              tickLine={false}
              axisLine={false}
              width={64}
            />

            {/* 3 — receipts: solid where a supplier has committed, outlined where not */}
            <Bar
              dataKey='confirmedIn'
              barSize={14}
              fill='var(--primary)'
              fillOpacity={0.55}
              isAnimationActive={false}
            />
            <Bar
              dataKey='plannedIn'
              barSize={14}
              fill='transparent'
              stroke='var(--primary)'
              strokeWidth={1}
              isAnimationActive={false}
            />

            <ReferenceLine y={0} stroke='var(--foreground)' strokeWidth={1} />
            <ReferenceLine
              y={detail.safetyStock}
              stroke='var(--muted-foreground)'
              strokeDasharray='4 3'
              label={{
                value: `Norm ${formatNumber(detail.safetyStock)}`,
                position: 'right',
                fontSize: 11,
                fill: 'var(--muted-foreground)',
              }}
            />

            {/* 4 — the date committed supply runs out, labelled below the axis */}
            {withinView && stockoutDate ? (
              <ReferenceLine
                x={data.find((bucket) => bucket.weekStart >= stockoutDate)?.weekStart}
                stroke='var(--status-critical)'
                strokeWidth={1.5}
                label={{
                  value: `Cover runs out ${formatDateShort(stockoutDate)}`,
                  position: 'insideBottomLeft',
                  fontSize: 11,
                  fill: 'var(--status-critical)',
                }}
              />
            ) : null}

            {/* 5 — the plan's own position: the main series */}
            <Line
              dataKey='balanceWithPlanned'
              type='linear'
              stroke='var(--primary)'
              strokeWidth={2}
              dot={{ r: 2.5, fill: 'var(--primary)', strokeWidth: 0 }}
              isAnimationActive={false}
            />

            {/* 6 — committed supply only, ending where it stops informing */}
            <Line
              dataKey='balanceConfirmed'
              type='linear'
              stroke='var(--status-critical)'
              strokeWidth={2}
              strokeDasharray='5 4'
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />

            <Tooltip
              content={<Readout uom={detail.baseUom} />}
              cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className='text-muted-foreground mt-3 text-[12px] leading-relaxed'>
        The dashed red line counts{' '}
        <span className='text-foreground font-medium'>only supply a supplier has committed to</span>. It ends once it
        stops saying anything new — beyond that point nothing further is confirmed, so it simply falls by a day’s
        consumption every day. The solid line is the plan’s own position, which assumes every order it recommends gets
        placed on time.
      </p>
    </section>
  );
}

function Legend() {
  return (
    <ul className='flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]'>
      <Key swatch={<span className='bg-primary h-[2px] w-5 rounded-full' />}>Balance · plan’s position</Key>
      <Key
        swatch={
          <span className='flex w-5 items-center gap-[3px]'>
            <span className='bg-status-critical h-[2px] w-[7px]' />
            <span className='bg-status-critical h-[2px] w-[7px]' />
          </span>
        }
      >
        Balance · committed supply only
      </Key>
      <Key swatch={<span className='bg-primary/55 h-3 w-2.5 rounded-[1px]' />}>Confirmed receipt</Key>
      <Key swatch={<span className='border-primary h-3 w-2.5 rounded-[1px] border' />}>Planned receipt</Key>
      <Key swatch={<span className='bg-muted-foreground/20 h-3 w-3 rounded-[2px]' />}>Norm band</Key>
    </ul>
  );
}

function Key({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className='text-muted-foreground flex items-center gap-2'>
      {swatch}
      {children}
    </li>
  );
}

interface ReadoutProps {
  active?: boolean;
  payload?: Array<{ payload: Bucket }>;
  uom: string;
}

function Readout({ active, payload, uom }: ReadoutProps) {
  if (!active || !payload?.length) return null;
  const bucket = payload[0]?.payload;
  if (!bucket) return null;

  const rows: Array<[string, string, string?]> = [
    ['Requirement', `${formatNumber(bucket.requirement)} ${uom}`],
    ['Confirmed in', `${formatNumber(bucket.confirmedIn)} ${uom}`],
    ['Planned in', `${formatNumber(bucket.plannedIn)} ${uom}`],
    ['Norm', `${formatNumber(bucket.norm)} ${uom}`],
    [
      'Closing · plan',
      `${formatNumber(bucket.balanceWithPlanned)} ${uom}`,
      bucket.balanceWithPlanned < bucket.norm ? 'text-status-attention' : undefined,
    ],
    [
      'Closing · committed only',
      bucket.balanceConfirmed === null ? 'nothing confirmed' : `${formatNumber(bucket.balanceConfirmed)} ${uom}`,
      'text-status-critical',
    ],
  ];

  return (
    <div className='bg-popover min-w-[240px] rounded-md border p-3 shadow-md'>
      <p className='mb-2 text-[12px] font-semibold'>Week of {formatDateShort(bucket.weekStart)}</p>
      <dl className='space-y-1'>
        {rows.map(([label, value, tone]) => (
          <div key={label} className='flex items-baseline justify-between gap-6'>
            <dt className='text-muted-foreground text-[12px]'>{label}</dt>
            <dd className={cn('text-[13px] font-medium tabular-nums', tone)}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
