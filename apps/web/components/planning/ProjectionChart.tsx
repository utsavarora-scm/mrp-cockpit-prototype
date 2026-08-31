'use client';

/**
 * The projection chart.
 *
 * Rebuilt a second time, after the first rebuild still did not read. The fault
 * both times was that the chart described a material that does not exist in
 * this data, and no amount of restyling fixes that.
 *
 * What the data actually says: demand on a raw material like this arrives as
 * **twelve production campaigns of ~600 MT across six months**, not as a daily
 * trickle. Dependent demand is lumpy by construction — the SFG above it is
 * lot-sized into fortnightly runs, so the raw material sits untouched for
 * thirteen days and then loses 604 MT in one. Stock is therefore a **staircase**:
 * long flat treads, sharp drops, sharp jumps when a delivery lands.
 *
 * The previous version drew a straight line between weekly closing balances,
 * which invented a gentle slope that is not there and hid every event that
 * matters. Three things follow, and they are the whole rebuild:
 *
 * 1. **Step interpolation on daily points, not linear on weekly ones.** The
 *    tread-and-riser shape *is* the information. A planner reads "we run on the
 *    3rd, the 17th and the 30th, and the cover has to be standing before each."
 *
 * 2. **Levels and flows get separate panels.** Stock is a level measured at an
 *    instant; receipts and consumption are flows measured over a period. They
 *    share a unit but not a meaning, and overlaying them on one axis is a
 *    category error — it is also why the receipt bars never had a sensible
 *    height. The strip below carries the flows on a shared x-axis and a shared
 *    crosshair, which is how every serious inventory tool does it.
 *
 * 3. **The committed-only line is gone.** It went negative on day four and left
 *    the canvas by week three, and holding an axis open for it cost a fifth of
 *    the plot. It was only ever carrying one fact — the date past which nothing
 *    is committed — and that fact is now a marked date, stated once. In the
 *    strip you can simply see the solid bars stop.
 */

import { formatDateFull, formatDateShort, formatNumber } from '@repo/domain';
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

/** Both panels share these so the two x-axes line up pixel for pixel. */
const AXIS_WIDTH = 60;
const MARGIN = { top: 8, right: 20, bottom: 0, left: 8 };

interface Point {
  date: string;
  /** The plan's own closing balance for the day — the staircase. */
  balance: number;
  norm: number;
  /** Consumption, carried negative so it hangs below the strip's zero line. */
  consumption: number;
  confirmedIn: number;
  unconfirmedIn: number;
  plannedIn: number;
}

function toPoints(detail: ItemDetail, weeks: number): Point[] {
  const days = Math.min(weeks * 7, detail.dates.length);
  const points: Point[] = [];
  for (let day = 0; day < days; day += 1) {
    points.push({
      date: detail.dates[day] as string,
      balance: detail.balanceWithPlanned[day] ?? 0,
      norm: detail.safetyStock,
      consumption: -(detail.grossRequirements[day] ?? 0),
      confirmedIn: detail.confirmedReceipts[day] ?? 0,
      unconfirmedIn: detail.unconfirmedReceipts[day] ?? 0,
      plannedIn: detail.plannedReceipts[day] ?? 0,
    });
  }
  return points;
}

/**
 * Bars are placed on the day they happen, so their width has to come down as
 * the window widens or they merge into a block.
 */
function barSizeFor(weeks: number): number {
  if (weeks <= 4) return 10;
  if (weeks <= 13) return 5;
  return 3;
}

export function ProjectionChart({ detail }: { detail: ItemDetail }) {
  const [weeks, setWeeks] = useState<number>(13);
  const points = toPoints(detail, weeks);
  const barSize = barSizeFor(weeks);

  const peak = points.reduce((max, point) => Math.max(max, point.balance), detail.safetyStock);
  const trough = points.reduce((min, point) => Math.min(min, point.balance), 0);
  const flowPeak = points.reduce(
    (max, point) => Math.max(max, point.confirmedIn + point.unconfirmedIn + point.plannedIn, -point.consumption),
    1,
  );

  const lastDate = points[points.length - 1]?.date ?? '';
  const stockoutDate = detail.position.stockoutDate;
  const markCover = stockoutDate !== null && stockoutDate <= lastDate;

  return (
    <section className='bg-card rounded-lg border p-6'>
      <header className='mb-1 flex flex-wrap items-start justify-between gap-4'>
        <div>
          <h2 className='text-muted-foreground text-[15px] font-semibold tracking-[0.04em] uppercase'>
            Projected stock position
          </h2>
          <p className='text-muted-foreground mt-1 text-[12px]'>
            Daily, from {formatDateShort(detail.planningDate)} · {detail.baseUom}
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

      {/* The one sentence that reconciles the header's warning with this chart. */}
      <p className='mt-3 mb-4 max-w-[62ch] text-[13px] leading-relaxed'>
        {markCover ? (
          <>
            Committed supply covers this material to{' '}
            <span className='text-status-critical font-medium'>{formatDateFull(stockoutDate as string)}</span>. The line
            below stays above the floor only because it counts{' '}
            <span className='font-medium'>{formatNumber(detail.position.plannedReceipts)} MT</span> the plan is
            recommending — orders nobody has placed yet.
          </>
        ) : (
          <>
            The line below is the plan&rsquo;s own position, counting both committed deliveries and the orders it is
            recommending. It stays above the norm across the whole window.
          </>
        )}
      </p>

      <Legend />

      {/* Levels — the staircase */}
      <div className='mt-4 h-[264px] w-full'>
        <ResponsiveContainer width='100%' height='100%'>
          <ComposedChart data={points} margin={MARGIN} syncId='projection'>
            {/* Below the norm is the zone the plan is not supposed to enter. */}
            <ReferenceArea
              y1={Math.min(trough, 0)}
              y2={detail.safetyStock}
              fill='var(--status-attention)'
              fillOpacity={0.1}
              stroke='none'
            />
            <CartesianGrid vertical={false} stroke='var(--grid-line)' />
            <XAxis dataKey='date' hide />
            <YAxis
              domain={[Math.min(trough * 1.1, 0), Math.ceil((peak * 1.08) / 100) * 100]}
              tickFormatter={(value: number) => formatNumber(value)}
              tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
              tickLine={false}
              axisLine={false}
              width={AXIS_WIDTH}
            />

            <Area
              dataKey='balance'
              type='stepAfter'
              fill='var(--primary)'
              fillOpacity={0.12}
              stroke='none'
              isAnimationActive={false}
            />
            <Line
              dataKey='balance'
              type='stepAfter'
              stroke='var(--primary)'
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />

            <ReferenceLine
              y={detail.safetyStock}
              stroke='var(--status-attention)'
              strokeDasharray='4 3'
              label={{
                value: `Norm ${formatNumber(detail.safetyStock)}`,
                position: 'insideTopRight',
                fontSize: 11,
                fill: 'var(--status-attention)',
              }}
            />
            {trough < 0 ? <ReferenceLine y={0} stroke='var(--foreground)' strokeWidth={1} /> : null}
            {markCover ? (
              <ReferenceLine
                x={stockoutDate as string}
                stroke='var(--status-critical)'
                strokeWidth={1.5}
                strokeDasharray='3 3'
              />
            ) : null}

            <Tooltip
              content={<Readout uom={detail.baseUom} />}
              cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Flows — what goes out and what comes in, on the day it happens */}
      <div className='mt-2 h-[104px] w-full'>
        <ResponsiveContainer width='100%' height='100%'>
          <ComposedChart data={points} margin={{ ...MARGIN, top: 4, bottom: 4 }} syncId='projection'>
            <XAxis
              dataKey='date'
              tickFormatter={formatDateShort}
              tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
            />
            <YAxis
              domain={[-flowPeak * 1.1, flowPeak * 1.1]}
              tickFormatter={(value: number) => formatNumber(Math.abs(value))}
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              tickLine={false}
              axisLine={false}
              width={AXIS_WIDTH}
              ticks={[-flowPeak, 0, flowPeak]}
            />
            <ReferenceLine y={0} stroke='var(--grid-line)' />

            {/* Down: consumed by a production run. Up: received. */}
            <Bar
              dataKey='consumption'
              barSize={barSize}
              fill='var(--muted-foreground)'
              fillOpacity={0.45}
              isAnimationActive={false}
            />
            <Bar dataKey='confirmedIn' stackId='in' barSize={barSize} fill='var(--primary)' isAnimationActive={false} />
            <Bar
              dataKey='unconfirmedIn'
              stackId='in'
              barSize={barSize}
              fill='var(--primary)'
              fillOpacity={0.4}
              isAnimationActive={false}
            />
            <Bar
              dataKey='plannedIn'
              stackId='in'
              barSize={barSize}
              fill='var(--surface-sunken)'
              stroke='var(--primary)'
              strokeWidth={1}
              strokeDasharray='2 2'
              isAnimationActive={false}
            />
            {markCover ? (
              <ReferenceLine
                x={stockoutDate as string}
                stroke='var(--status-critical)'
                strokeWidth={1.5}
                strokeDasharray='3 3'
              />
            ) : null}
            <Tooltip content={() => null} cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className='text-muted-foreground mt-2 ml-[60px] text-[11px]'>
        Below the axis, material consumed by a production run · above it, material arriving
      </p>
    </section>
  );
}

function Legend() {
  return (
    <ul className='flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]'>
      <Key swatch={<span className='bg-primary h-[2px] w-5 rounded-full' />}>Stock on hand</Key>
      <Key
        swatch={
          <span className='flex w-5 items-center gap-[3px]'>
            <span className='bg-status-attention h-[2px] w-[7px]' />
            <span className='bg-status-attention h-[2px] w-[7px]' />
          </span>
        }
      >
        Norm
      </Key>
      <Key swatch={<span className='bg-primary h-3 w-2 rounded-[1px]' />}>Confirmed</Key>
      <Key swatch={<span className='bg-primary/40 h-3 w-2 rounded-[1px]' />}>Ordered, not confirmed</Key>
      <Key swatch={<span className='border-primary h-3 w-2 rounded-[1px] border border-dashed' />}>
        Recommended by the plan
      </Key>
      <Key swatch={<span className='bg-muted-foreground/45 h-3 w-2 rounded-[1px]' />}>Consumed</Key>
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

function Readout({ active, payload, uom }: ReadoutProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  const movements: Array<[string, number, string]> = [
    ['Consumed by production', -point.consumption, 'text-muted-foreground'],
    ['Received · confirmed', point.confirmedIn, 'text-primary'],
    ['Received · not yet confirmed', point.unconfirmedIn, 'text-primary'],
    ['Recommended by the plan', point.plannedIn, 'text-primary'],
  ];
  const moved = movements.filter(([, quantity]) => quantity > 0);

  return (
    <div className='bg-popover min-w-[236px] rounded-md border p-3 shadow-md'>
      <p className='text-[12px] font-semibold'>{formatDateFull(point.date)}</p>
      <div className='mt-2 flex items-baseline justify-between gap-6'>
        <span className='text-muted-foreground text-[12px]'>Stock on hand</span>
        <span
          className={cn(
            'text-[13px] font-medium tabular-nums',
            point.balance < point.norm ? 'text-status-attention' : undefined,
          )}
        >
          {formatNumber(point.balance)} {uom}
        </span>
      </div>
      <div className='flex items-baseline justify-between gap-6'>
        <span className='text-muted-foreground text-[12px]'>Norm</span>
        <span className='text-[13px] tabular-nums'>
          {formatNumber(point.norm)} {uom}
        </span>
      </div>
      {moved.length > 0 ? (
        <dl className='border-border/60 mt-2 space-y-1 border-t pt-2'>
          {moved.map(([label, quantity, tone]) => (
            <div key={label} className='flex items-baseline justify-between gap-6'>
              <dt className='text-muted-foreground text-[12px]'>{label}</dt>
              <dd className={cn('text-[13px] font-medium tabular-nums', tone)}>
                {formatNumber(quantity)} {uom}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className='text-muted-foreground border-border/60 mt-2 border-t pt-2 text-[12px]'>
          Nothing moves on this day.
        </p>
      )}
    </div>
  );
}
