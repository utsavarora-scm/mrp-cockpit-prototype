'use client';

/**
 * The projection chart.
 *
 * The most valuable single visual in the product, and the one the whole of Act 1
 * is read off. Built deliberately rather than accepting Recharts defaults —
 * seven layers, in a fixed back-to-front order, each answering a question a
 * planner actually asks.
 *
 * The rule that matters most: the confirmed balance and the with-planned
 * balance are drawn as two separate lines and are never merged. One is what a
 * supplier has committed to; the other is what we are hoping for. A single
 * blended line is precisely the rosy picture the buyer warned about.
 */

import { formatDateShort, formatNumber } from '@repo/domain';
import { cn } from '@repo/ui/lib/utils';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { ItemDetail } from '@/lib/api-types';

interface Point {
  date: string;
  norm: number;
  confirmedIn: number;
  plannedIn: number;
  balanceConfirmed: number;
  balanceWithPlanned: number;
  /** Only the negative part, so the shortfall shades to the axis floor. */
  shortfall: number;
  requirement: number;
}

function buildSeries(detail: ItemDetail): Point[] {
  return detail.dates.map((date, day) => {
    const balanceConfirmed = detail.balanceConfirmed[day] ?? 0;
    return {
      date,
      // A flat maintained norm today. The norms engine replaces this with a
      // per-bucket curve, and the band then renders as a shape rather than a
      // line — which is the entire Act 2 argument in one visual.
      norm: detail.safetyStock,
      confirmedIn: detail.confirmedReceipts[day] ?? 0,
      plannedIn: (detail.plannedReceipts[day] ?? 0) + (detail.unconfirmedReceipts[day] ?? 0),
      balanceConfirmed,
      balanceWithPlanned: detail.balanceWithPlanned[day] ?? 0,
      shortfall: Math.min(0, balanceConfirmed),
      requirement: detail.grossRequirements[day] ?? 0,
    };
  });
}

export function ProjectionChart({ detail }: { detail: ItemDetail }) {
  const data = buildSeries(detail);
  const stockoutDate = detail.position.stockoutDate;

  return (
    <section className='bg-card rounded-lg border p-6'>
      <header className='mb-4 flex items-baseline justify-between gap-4'>
        <div>
          <h2 className='text-muted-foreground text-[15px] font-semibold tracking-[0.04em] uppercase'>
            Projected stock position
          </h2>
          <p className='text-muted-foreground mt-1 text-[12px]'>
            {detail.horizonDays} days from {formatDateShort(detail.planningDate)}, in {detail.baseUom}
          </p>
        </div>
        <Legend />
      </header>

      <div className='h-[360px] w-full'>
        <ResponsiveContainer width='100%' height='100%'>
          <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 48 }}>
            {/* 1 — norm band: from zero to the norm level */}
            <Area
              dataKey='norm'
              baseValue={0}
              fill='var(--muted-foreground)'
              fillOpacity={0.16}
              stroke='none'
              isAnimationActive={false}
            />

            {/* 2 — the shortfall, shaded to the axis floor */}
            <Area
              dataKey='shortfall'
              baseValue={0}
              fill='var(--status-critical)'
              fillOpacity={0.18}
              stroke='none'
              isAnimationActive={false}
            />

            <CartesianGrid vertical={false} stroke='var(--grid-line)' strokeWidth={1} />
            <XAxis
              dataKey='date'
              tickFormatter={formatDateShort}
              tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
              tickLine={false}
              axisLine={false}
              minTickGap={48}
            />
            <YAxis
              tickFormatter={(value: number) => formatNumber(value)}
              tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
              tickLine={false}
              axisLine={false}
              width={72}
            />

            {/* 3 — receipt bars: solid where committed, outlined where not */}
            <Bar dataKey='confirmedIn' barSize={12} fill='var(--primary)' fillOpacity={0.6} isAnimationActive={false} />
            <Bar
              dataKey='plannedIn'
              barSize={12}
              fill='transparent'
              stroke='var(--primary)'
              strokeWidth={1}
              isAnimationActive={false}
            />

            <ReferenceLine y={0} stroke='var(--foreground)' strokeWidth={1} />

            {/* 6 — today */}
            <ReferenceLine
              x={detail.dates[0]}
              stroke='var(--foreground)'
              strokeOpacity={0.3}
              strokeDasharray='4 3'
              label={{ value: 'Today', position: 'insideTopLeft', fontSize: 11, fill: 'var(--muted-foreground)' }}
            />

            {/* 7 — the date the confirmed balance runs out */}
            {stockoutDate ? (
              <ReferenceLine
                x={stockoutDate}
                stroke='var(--status-critical)'
                strokeWidth={1}
                label={{
                  value: `Runs out ${formatDateShort(stockoutDate)}`,
                  position: 'insideTopRight',
                  fontSize: 11,
                  fill: 'var(--status-critical)',
                }}
              />
            ) : null}

            {/* 5 — with planned supply: dashed, and deliberately faint */}
            <Line
              dataKey='balanceWithPlanned'
              type='linear'
              stroke='var(--primary)'
              strokeOpacity={0.45}
              strokeWidth={2}
              strokeDasharray='5 4'
              dot={false}
              isAnimationActive={false}
            />

            {/* 4 — confirmed supply only: the honest line, drawn on top */}
            <Line
              dataKey='balanceConfirmed'
              type='linear'
              stroke='var(--primary)'
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />

            <Tooltip
              content={<Readout uom={detail.baseUom} />}
              cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

/** Inline and horizontal, above the chart — never a boxed legend in a corner. */
function Legend() {
  return (
    <ul className='flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]'>
      <Key swatch={<span className='bg-primary h-[2px] w-5 rounded-full' />}>Balance · confirmed supply only</Key>
      <Key
        swatch={
          <span className='flex h-[2px] w-5 items-center gap-[3px]'>
            <span className='bg-primary/45 h-[2px] w-[6px]' />
            <span className='bg-primary/45 h-[2px] w-[6px]' />
            <span className='bg-primary/45 h-[2px] w-[5px]' />
          </span>
        }
      >
        Balance · including planned
      </Key>
      <Key swatch={<span className='bg-primary/60 h-3 w-2.5 rounded-[1px]' />}>Confirmed receipt</Key>
      <Key swatch={<span className='border-primary h-3 w-2.5 rounded-[1px] border' />}>Planned receipt</Key>
      <Key swatch={<span className='bg-muted-foreground/25 h-3 w-3 rounded-[2px]' />}>Norm</Key>
      <Key swatch={<span className='bg-status-critical/25 h-3 w-3 rounded-[2px]' />}>Shortfall</Key>
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
  payload?: Array<{ payload: Point }>;
  uom: string;
}

/**
 * Every component at that date, not just the series under the cursor.
 *
 * A planner reading this chart is asking "what happens here, and why" — which
 * needs the whole bucket, opening through closing, in one place.
 */
function Readout({ active, payload, uom }: ReadoutProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  const rows: Array<[string, number, string?]> = [
    ['Requirement', point.requirement],
    ['Confirmed in', point.confirmedIn],
    ['Planned in', point.plannedIn],
    ['Norm', point.norm],
    ['Balance · confirmed', point.balanceConfirmed, point.balanceConfirmed < 0 ? 'text-status-critical' : undefined],
    ['Balance · with planned', point.balanceWithPlanned],
  ];

  return (
    <div className='bg-popover min-w-[220px] rounded-md border p-3 shadow-md'>
      <p className='mb-2 text-[12px] font-semibold'>{formatDateShort(point.date)}</p>
      <dl className='space-y-1'>
        {rows.map(([label, value, tone]) => (
          <div key={label} className='flex items-baseline justify-between gap-6'>
            <dt className='text-muted-foreground text-[12px]'>{label}</dt>
            <dd className={cn('text-[13px] font-medium tabular-nums', tone)}>
              {formatNumber(value)} {uom}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
