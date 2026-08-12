'use client';

/**
 * The projected balance chart.
 *
 * Two balance lines, deliberately. The solid one is what the plan schedules;
 * the dashed one is what will actually arrive once orders that needed placing
 * in the past are left out. Where they separate is exactly where the plan is
 * telling itself a story, and shading that gap is the most useful thing this
 * chart does.
 */

import { formatCurrency, formatDateShort, formatQty } from '@repo/domain';
import { type ChartConfig, ChartContainer, ChartTooltip } from '@repo/ui/components/chart';
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from 'recharts';

import type { ItemDetail } from '@/lib/api-types';

const chartConfig = {
  grossRequirements: { label: 'Gross requirements', color: 'var(--chart-4)' },
  receipts: { label: 'Receipts', color: 'var(--chart-2)' },
  projectedAvailable: { label: 'Projected balance', color: 'var(--chart-1)' },
  projectedAvailableFeasible: { label: 'Orderable supply only', color: 'var(--destructive)' },
} satisfies ChartConfig;

export function PabChart({ detail }: { detail: ItemDetail }) {
  const data = detail.dates.map((date, index) => ({
    date,
    day: index,
    // Requirements read below the axis, receipts above — the convention a
    // planner already has in their head from MD04.
    grossRequirements: -(detail.grossRequirements[index] ?? 0),
    receipts: (detail.scheduledReceipts[index] ?? 0) + (detail.plannedReceipts[index] ?? 0),
    projectedAvailable: detail.projectedAvailable[index] ?? 0,
    projectedAvailableFeasible: detail.projectedAvailableFeasible[index] ?? 0,
    safetyStock: detail.safetyStock,
    shortfall: Math.min(0, detail.projectedAvailableFeasible[index] ?? 0),
  }));

  return (
    <ChartContainer config={chartConfig} className='h-[248px] w-full'>
      <ComposedChart data={data} margin={{ left: 4, right: 10, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray='2 3' />
        <XAxis
          dataKey='day'
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          interval={14}
          tick={{ fontSize: 10 }}
          tickFormatter={(day: number) => formatDateShort(detail.dates[day] ?? '')}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={56}
          tick={{ fontSize: 10 }}
          tickFormatter={(value: number) => formatQty(value)}
        />
        <ChartTooltip
          content={<PabTooltip detail={detail} />}
          cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }}
        />

        {/* Anything below zero is unmet demand — shaded so it cannot be missed. */}
        <Area
          dataKey='shortfall'
          fill='var(--destructive)'
          fillOpacity={0.16}
          stroke='none'
          isAnimationActive={false}
        />

        <Bar dataKey='grossRequirements' fill='var(--color-grossRequirements)' isAnimationActive={false} />
        <Bar dataKey='receipts' fill='var(--color-receipts)' isAnimationActive={false} />

        <ReferenceLine y={0} stroke='var(--foreground)' strokeWidth={1} />
        <ReferenceLine
          y={detail.safetyStock}
          stroke='var(--muted-foreground)'
          strokeDasharray='4 3'
          label={{ value: 'safety stock', position: 'insideTopLeft', fontSize: 10, fill: 'var(--muted-foreground)' }}
        />

        <Line
          dataKey='projectedAvailable'
          type='stepAfter'
          stroke='var(--color-projectedAvailable)'
          strokeWidth={1.75}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey='projectedAvailableFeasible'
          type='stepAfter'
          stroke='var(--color-projectedAvailableFeasible)'
          strokeWidth={1.5}
          strokeDasharray='4 3'
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

interface TooltipRow {
  payload?: {
    day: number;
    date: string;
    grossRequirements: number;
    receipts: number;
    projectedAvailable: number;
    projectedAvailableFeasible: number;
  };
}

function PabTooltip({ active, payload, detail }: { active?: boolean; payload?: TooltipRow[]; detail: ItemDetail }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  const gap = point.projectedAvailable - point.projectedAvailableFeasible;

  return (
    <div className='bg-popover text-popover-foreground min-w-[220px] rounded-md border px-2.5 py-2 text-[12px] shadow-md'>
      <div className='mono mb-1 font-semibold'>
        Day {point.day} · {formatDateShort(point.date)}
      </div>
      <Row label='Gross requirements' value={formatQty(-point.grossRequirements, detail.baseUom)} />
      <Row label='Receipts' value={formatQty(point.receipts, detail.baseUom)} />
      <Row label='Projected balance' value={formatQty(point.projectedAvailable, detail.baseUom)} />
      <Row label='Orderable supply only' value={formatQty(point.projectedAvailableFeasible, detail.baseUom)} />
      {gap > 1 ? (
        <div className='text-destructive mt-1 border-t pt-1 text-[11px]'>
          {formatQty(gap, detail.baseUom)} of the scheduled balance depends on orders that needed placing in the past.
        </div>
      ) : null}
      <div className='text-muted-foreground mt-1 border-t pt-1 text-[11px]'>
        At standard cost, that balance is {formatCurrency(point.projectedAvailableFeasible * detail.standardCost)}.
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex justify-between gap-4'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='mono'>{value}</span>
    </div>
  );
}
