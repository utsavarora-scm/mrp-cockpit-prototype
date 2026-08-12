'use client';

/**
 * The Pareto.
 *
 * Bars are individual exceptions ranked by money; the line is cumulative share.
 * The annotation is computed from the plan, not written into the design — if the
 * dataset changes, the sentence changes with it.
 */

import { formatCurrency, formatNumber, formatPercent } from '@repo/domain';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/card';
import { type ChartConfig, ChartContainer, ChartTooltip } from '@repo/ui/components/chart';
import { Skeleton } from '@repo/ui/components/skeleton';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from 'recharts';

import type { CockpitSummary } from '@/lib/api-types';

const chartConfig = {
  impactValue: { label: 'Exposure', color: 'var(--chart-1)' },
  cumulativeShare: { label: 'Cumulative share', color: 'var(--chart-3)' },
} satisfies ChartConfig;

export function ParetoChart({ summary }: { summary: CockpitSummary | undefined }) {
  if (!summary) return <Skeleton className='h-[220px] w-full' />;

  const data = summary.pareto.map((point) => ({
    rank: point.rank,
    impactValue: point.impactValue,
    cumulativeShare: point.cumulativeShare * 100,
    label: `${point.itemId} @ ${point.plantId}`,
    code: point.code,
  }));

  return (
    <Card className='rounded-none border-0 border-b py-0 shadow-none'>
      <CardHeader className='gap-0 px-4 pt-3 pb-1'>
        <CardTitle className='text-[13px] font-semibold'>
          Where the money is
          <span className='text-muted-foreground ml-2 font-normal'>
            {formatNumber(summary.exceptionsToSeventyPercent)} of {formatNumber(summary.exceptionCount)} exceptions —{' '}
            {formatPercent(summary.seventyPercentHeadShare, 1)} of the queue — carry 70% of the exposure
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className='px-2 pb-3'>
        <ChartContainer config={chartConfig} className='h-[190px] w-full'>
          <ComposedChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray='2 3' />
            <XAxis
              dataKey='rank'
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              interval={9}
              tick={{ fontSize: 10 }}
              label={{ value: 'Exception rank by exposure', position: 'insideBottom', offset: -2, fontSize: 10 }}
            />
            <YAxis
              yAxisId='left'
              tickLine={false}
              axisLine={false}
              width={46}
              tick={{ fontSize: 10 }}
              tickFormatter={(value: number) => formatCurrency(value)}
            />
            <YAxis
              yAxisId='right'
              orientation='right'
              tickLine={false}
              axisLine={false}
              width={34}
              domain={[0, 100]}
              tick={{ fontSize: 10 }}
              tickFormatter={(value: number) => `${value}%`}
            />
            <ChartTooltip content={<ParetoTooltip />} cursor={{ fill: 'var(--muted)' }} />
            <Bar
              yAxisId='left'
              dataKey='impactValue'
              fill='var(--color-impactValue)'
              radius={[1, 1, 0, 0]}
              isAnimationActive={false}
            />
            <Line
              yAxisId='right'
              dataKey='cumulativeShare'
              type='monotone'
              stroke='var(--color-cumulativeShare)'
              strokeWidth={1.75}
              dot={false}
              isAnimationActive={false}
            />
            <ReferenceLine
              yAxisId='right'
              y={70}
              stroke='var(--muted-foreground)'
              strokeDasharray='3 3'
              label={{ value: '70%', position: 'right', fontSize: 10, fill: 'var(--muted-foreground)' }}
            />
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

interface TooltipPayload {
  payload?: { rank: number; impactValue: number; cumulativeShare: number; label: string; code: string };
}

function ParetoTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className='bg-popover text-popover-foreground rounded-md border px-2.5 py-2 text-[12px] shadow-md'>
      <div className='mono font-semibold'>#{point.rank}</div>
      <div className='mono'>{point.label}</div>
      <div className='text-muted-foreground'>{point.code}</div>
      <div className='mt-1 flex gap-3'>
        <span className='mono'>{formatCurrency(point.impactValue)}</span>
        <span className='text-muted-foreground mono'>{point.cumulativeShare.toFixed(1)}% cumulative</span>
      </div>
    </div>
  );
}
