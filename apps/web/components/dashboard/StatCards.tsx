'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/card';
import { Skeleton } from '@repo/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { stats } from '@/lib/mock-data/dashboard';
import { fakeLatency } from '@/lib/mock';

export function StatCards() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => fakeLatency(stats),
  });

  if (isLoading || !data) {
    return (
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className='h-28 w-full rounded-xl' />
        ))}
      </div>
    );
  }

  return (
    <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
      {data.map((stat) => {
        const up = stat.delta >= 0;
        return (
          <Card key={stat.label}>
            <CardHeader className='pb-2'>
              <CardTitle className='text-muted-foreground text-sm font-medium'>{stat.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>{stat.value}</div>
              <div
                className={`mt-1 flex items-center gap-1 text-xs font-medium ${
                  up ? 'text-primary' : 'text-destructive'
                }`}
              >
                {up ? <ArrowUpRight className='size-3.5' /> : <ArrowDownRight className='size-3.5' />}
                {Math.abs(stat.delta)}% vs last month
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
