'use client';

/**
 * A ranked exception list, used wherever a screen needs one chosen before it can
 * show anything. Better than an empty state: the highest-exposure exceptions are
 * where a planner would start anyway.
 */

import { EXCEPTION_LABELS, formatCurrency } from '@repo/domain';
import { Input } from '@repo/ui/components/input';
import { Skeleton } from '@repo/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import type { ExceptionQueryResult, ExceptionRow } from '@/lib/api-types';

export function ExceptionPicker({
  title,
  subtitle,
  hrefFor,
  filter,
}: {
  title: string;
  subtitle: string;
  hrefFor: (row: ExceptionRow) => string;
  filter?: (row: ExceptionRow) => boolean;
}) {
  const [search, setSearch] = useState('');

  const exceptions = useQuery({
    queryKey: ['exceptions', 'picker', search],
    queryFn: async (): Promise<ExceptionQueryResult> => {
      const params = new URLSearchParams({ scenario: 'baseline', limit: '200' });
      if (search) params.set('search', search);
      const response = await fetch(`/api/exceptions?${params.toString()}`);
      if (!response.ok) throw new Error('The exception list could not be loaded.');
      return response.json();
    },
    placeholderData: (previous) => previous,
  });

  const rows = (exceptions.data?.rows ?? []).filter((row) => (filter ? filter(row) : true)).slice(0, 80);

  return (
    <div className='mx-auto max-w-4xl px-4 py-5'>
      <h1 className='text-[15px] font-semibold'>{title}</h1>
      <p className='text-muted-foreground mt-0.5 text-[12.5px]'>{subtitle}</p>

      <div className='relative mt-3'>
        <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder='Item code, exception code or site'
          className='h-8 pl-8 text-[13px]'
          aria-label='Search exceptions'
        />
      </div>

      <div className='mt-3 rounded-md border'>
        <div className='bg-muted/40 flex border-b'>
          <div className='grid-head w-[92px] text-right'>Impact</div>
          <div className='grid-head w-[150px]'>Code</div>
          <div className='grid-head w-[116px]'>Item</div>
          <div className='grid-head flex-1'>Description</div>
          <div className='grid-head w-[52px]'>Site</div>
          <div className='grid-head w-[44px] text-right'>FG</div>
        </div>

        {exceptions.isLoading ? (
          <div className='space-y-px p-2'>
            {Array.from({ length: 12 }).map((_, index) => (
              <Skeleton key={index} className='h-[30px] w-full rounded-none' />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className='text-muted-foreground flex h-40 flex-col items-center justify-center gap-1 text-[13px]'>
            <span className='font-medium'>Nothing matches that search.</span>
            <span>Try an item code such as RM-CB-001, or a code such as A8.</span>
          </div>
        ) : (
          rows.map((row) => (
            <Link
              key={row.id}
              href={hrefFor(row)}
              className='grid-row hover:bg-muted/40 flex items-center last:border-b-0'
            >
              <div className='grid-cell num w-[92px] font-semibold'>{formatCurrency(row.impactValue)}</div>
              <div className='grid-cell w-[150px] truncate text-[12px]'>
                <span className='mono'>{row.code.split('-')[0]}</span>
                <span className='text-muted-foreground ml-1.5'>{EXCEPTION_LABELS[row.code]}</span>
              </div>
              <div className='grid-cell mono w-[116px] text-[12px]'>{row.itemId}</div>
              <div className='grid-cell text-muted-foreground flex-1 truncate'>{row.itemDescription}</div>
              <div className='grid-cell mono w-[52px]'>{row.plantId}</div>
              <div className='grid-cell num w-[44px]'>{row.peggedFgCount || '—'}</div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
