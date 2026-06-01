'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@repo/ui/components/chart';
import { Skeleton } from '@repo/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts';
import { revenueSeries } from '@/lib/mock-data/dashboard';
import { fakeLatency } from '@/lib/mock';

const chartConfig = {
  revenue: { label: 'Revenue', color: 'var(--chart-1)' },
} satisfies ChartConfig;

export function RevenueChart() {
  const { data, isLoading } = useQuery({
    queryKey: ['revenue-series'],
    queryFn: () => fakeLatency(revenueSeries, 800),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Revenue</CardTitle>
        <CardDescription>Last 6 months</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <Skeleton className='h-[240px] w-full' />
        ) : (
          <ChartContainer config={chartConfig} className='h-[240px] w-full'>
            <AreaChart data={data} margin={{ left: 12, right: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey='month' tickLine={false} axisLine={false} tickMargin={8} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
              <Area
                dataKey='revenue'
                type='natural'
                fill='var(--color-revenue)'
                fillOpacity={0.25}
                stroke='var(--color-revenue)'
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
