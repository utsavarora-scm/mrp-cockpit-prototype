'use client';

/**
 * Item 360 without an item chosen yet.
 *
 * Rather than an empty search box, this lands on the item-plants that currently
 * carry the most exposure — which is where a planner would go anyway.
 */

import { formatCurrency, formatNumber } from '@repo/domain';
import { Input } from '@repo/ui/components/input';
import { Skeleton } from '@repo/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import type { ExceptionQueryResult } from '@/lib/api-types';

export default function ItemIndexPage() {
  const [search, setSearch] = useState('');

  const exceptions = useQuery({
    queryKey: ['exceptions', 'item-index', search],
    queryFn: async (): Promise<ExceptionQueryResult> => {
      const params = new URLSearchParams({ scenario: 'baseline', limit: '400' });
      if (search) params.set('search', search);
      const response = await fetch(`/api/exceptions?${params.toString()}`);
      if (!response.ok) throw new Error('The item list could not be loaded.');
      return response.json();
    },
    placeholderData: (previous) => previous,
  });

  /** Roll the queue up to one row per item-plant. */
  const items = useMemo(() => {
    const byKey = new Map<
      string,
      { itemId: string; plantId: string; description: string; itemType: string; exposure: number; count: number }
    >();
    for (const row of exceptions.data?.rows ?? []) {
      if (row.itemId === '—') continue;
      const key = `${row.itemId}@${row.plantId}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.exposure += row.impactValue;
        existing.count += 1;
      } else {
        byKey.set(key, {
          itemId: row.itemId,
          plantId: row.plantId,
          description: row.itemDescription,
          itemType: row.itemType,
          exposure: row.impactValue,
          count: 1,
        });
      }
    }
    return [...byKey.values()].sort((a, b) => b.exposure - a.exposure).slice(0, 120);
  }, [exceptions.data]);

  return (
    <div className='mx-auto max-w-4xl px-4 py-5'>
      <h1 className='text-[15px] font-semibold'>Item 360</h1>
      <p className='text-muted-foreground mt-0.5 text-[12.5px]'>
        The items carrying the most exposure right now. Search to find any other.
      </p>

      <div className='relative mt-3'>
        <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder='Item code, description or site'
          className='h-8 pl-8 text-[13px]'
          aria-label='Search items'
        />
      </div>

      <div className='mt-3 rounded-md border'>
        <div className='bg-muted/40 flex border-b'>
          <div className='grid-head w-[92px] text-right'>Exposure</div>
          <div className='grid-head w-[116px]'>Item</div>
          <div className='grid-head flex-1'>Description</div>
          <div className='grid-head w-[52px]'>Site</div>
          <div className='grid-head w-[52px]'>Type</div>
          <div className='grid-head w-[60px] text-right'>Issues</div>
        </div>

        {exceptions.isLoading ? (
          <div className='space-y-px p-2'>
            {Array.from({ length: 12 }).map((_, index) => (
              <Skeleton key={index} className='h-[30px] w-full rounded-none' />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className='text-muted-foreground flex h-40 flex-col items-center justify-center gap-1 text-[13px]'>
            <span className='font-medium'>Nothing matches that search.</span>
            <span>Try an item code such as RM-CB-001, or a site such as P1.</span>
          </div>
        ) : (
          items.map((item) => (
            <Link
              key={`${item.itemId}@${item.plantId}`}
              href={`/item/${encodeURIComponent(item.itemId)}/${encodeURIComponent(item.plantId)}`}
              className='grid-row hover:bg-muted/40 flex items-center last:border-b-0'
            >
              <div className='grid-cell num w-[92px] font-semibold'>{formatCurrency(item.exposure)}</div>
              <div className='grid-cell mono w-[116px] text-[12px]'>{item.itemId}</div>
              <div className='grid-cell text-muted-foreground flex-1 truncate'>{item.description}</div>
              <div className='grid-cell mono w-[52px]'>{item.plantId}</div>
              <div className='grid-cell mono w-[52px] text-[11.5px]'>{item.itemType}</div>
              <div className='grid-cell num w-[60px]'>{formatNumber(item.count)}</div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
