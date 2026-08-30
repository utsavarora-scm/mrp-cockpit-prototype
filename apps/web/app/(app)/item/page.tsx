'use client';

/**
 * The materials table.
 *
 * One row per planned item-plant, in the columns a planner reads across before
 * opening anything: what is wanted, what is held, what is ordered, how much of
 * that is genuinely coming, and where the balance lands. Rolling the exception
 * queue up by item answered a different question — it could only ever show
 * materials that already had a problem, which is no way to see a position.
 *
 * Sorted trouble-first, so the top of the table is always the work.
 */

import { formatCurrency, formatDateShort, formatNumber } from '@repo/domain';
import { Badge } from '@repo/ui/components/badge';
import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { Skeleton } from '@repo/ui/components/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { cn } from '@repo/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import type { MaterialRow, MaterialsQueryResult } from '@/lib/api-types';

type StatusFilter = 'ALL' | MaterialRow['status'];

const STATUS_LABEL: Record<MaterialRow['status'], string> = {
  AT_RISK: 'At risk',
  WATCH: 'Watch',
  EXCESS: 'Excess',
  HEALTHY: 'Healthy',
};

function statusClass(status: MaterialRow['status']): string {
  if (status === 'AT_RISK') return 'sev-critical';
  if (status === 'WATCH') return 'sev-high';
  if (status === 'EXCESS') return 'sev-medium';
  return 'sev-low';
}

export default function MaterialsPage() {
  return (
    <Suspense fallback={<div className='p-4' />}>
      <MaterialsTable />
    </Suspense>
  );
}

function MaterialsTable() {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<StatusFilter | null>(null);

  // The cockpit tiles link straight in with a filter already applied. Derived
  // rather than synced into state, so arriving from a tile and then clicking a
  // filter both work without an effect racing the first render.
  const requested = searchParams.get('status');
  const status: StatusFilter = chosen ?? (requested && requested in STATUS_LABEL ? (requested as StatusFilter) : 'ALL');
  const setStatus = setChosen;

  const materials = useQuery({
    queryKey: ['materials', search, status],
    queryFn: async (): Promise<MaterialsQueryResult> => {
      const params = new URLSearchParams({ scenario: 'baseline', limit: '250' });
      if (search) params.set('search', search);
      if (status !== 'ALL') params.set('status', status);
      const response = await fetch(`/api/materials?${params.toString()}`);
      if (!response.ok) throw new Error('The materials table could not be loaded.');
      return response.json();
    },
    placeholderData: (previous) => previous,
  });

  const counts = materials.data?.counts;
  const filters: Array<{ value: StatusFilter; label: string; count: number | undefined }> = [
    { value: 'ALL', label: 'All', count: counts?.all },
    { value: 'AT_RISK', label: 'At risk', count: counts?.atRisk },
    { value: 'WATCH', label: 'Watch', count: counts?.watch },
    { value: 'EXCESS', label: 'Excess', count: counts?.excess },
    { value: 'HEALTHY', label: 'Healthy', count: counts?.healthy },
  ];

  return (
    <div className='flex h-[calc(100svh-3rem)] flex-col'>
      <div className='flex items-center gap-3 border-b px-4 py-2'>
        <div>
          <h1 className='text-[13px] font-semibold'>Materials</h1>
          <p className='text-muted-foreground text-[11.5px]'>
            The planning position for every material the engine planned. Trouble first.
          </p>
        </div>

        <div className='ml-auto flex items-center gap-2'>
          <div className='flex gap-0.5'>
            {filters.map((filter) => (
              <Button
                key={filter.value}
                variant={status === filter.value ? 'default' : 'ghost'}
                size='sm'
                className='h-6 gap-1.5 px-2 text-[11.5px]'
                onClick={() => setStatus(filter.value)}
              >
                {filter.label}
                {filter.count === undefined ? null : (
                  <span className='mono opacity-60'>{formatNumber(filter.count)}</span>
                )}
              </Button>
            ))}
          </div>

          <div className='relative w-[248px]'>
            <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2' />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder='Material, description or site'
              className='h-7 pl-7 text-[12.5px]'
              aria-label='Search materials'
            />
          </div>
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-auto'>
        <table className='w-full border-separate border-spacing-0'>
          <thead className='sticky top-0 z-10'>
            <tr>
              <Th className='w-[118px] text-left'>Material</Th>
              <Th className='text-left'>Description</Th>
              <Th className='w-[46px] text-left'>Site</Th>
              <Th className='w-[44px] text-left'>Type</Th>
              <Th className='w-[96px] text-right'>Demand</Th>
              <Th className='w-[96px] text-right'>Stock</Th>
              <Th className='w-[96px] text-right'>Open PO</Th>
              <Th className='w-[110px] text-right'>Expected inbound</Th>
              <Th className='w-[96px] text-right'>Safety stock</Th>
              <Th className='w-[104px] text-right'>Projected balance</Th>
              <Th className='w-[86px] text-left'>Stock-out</Th>
              <Th className='w-[78px] text-left'>Status</Th>
              <Th className='w-[86px] text-right'>Exposure</Th>
            </tr>
          </thead>
          <tbody>
            {materials.isLoading ? (
              Array.from({ length: 18 }).map((_, index) => (
                <tr key={index}>
                  <td colSpan={13} className='px-2 py-1'>
                    <Skeleton className='h-[22px] w-full' />
                  </td>
                </tr>
              ))
            ) : materials.data && materials.data.rows.length > 0 ? (
              materials.data.rows.map((row) => <MaterialRowView key={`${row.itemId}@${row.plantId}`} row={row} />)
            ) : (
              <tr>
                <td colSpan={13} className='text-muted-foreground px-4 py-16 text-center text-[13px]'>
                  <div className='font-medium'>Nothing matches that.</div>
                  <div className='mt-0.5'>Try a material code such as RM-CB-001, or a site such as P1.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {materials.data ? (
        <div className='text-muted-foreground border-t px-4 py-1.5 text-[11.5px]'>
          Showing <span className='mono text-foreground'>{formatNumber(materials.data.rows.length)}</span> of{' '}
          <span className='mono text-foreground'>{formatNumber(materials.data.total)}</span> materials
          {status !== 'ALL' ? ` in ${STATUS_LABEL[status].toLowerCase()}` : ''}.
        </div>
      ) : null}
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn('grid-head bg-muted/60 border-b', className)}>{children}</th>;
}

function MaterialRowView({ row }: { row: MaterialRow }) {
  // Open PO the supplier has not committed to is the gap this table exists to
  // expose, so it is marked on the row rather than left to the detail screen.
  const uncommitted = row.openPo - row.expectedInbound;

  return (
    <tr className='hover:bg-muted/40 group'>
      <Td className='mono text-left text-[12px]'>
        <Link href={`/material/${encodeURIComponent(row.itemId)}/${encodeURIComponent(row.plantId)}`} className='block'>
          {row.itemId}
        </Link>
      </Td>
      <Td className='text-muted-foreground max-w-0 truncate text-left'>
        <Link
          href={`/material/${encodeURIComponent(row.itemId)}/${encodeURIComponent(row.plantId)}`}
          className='block truncate'
        >
          {row.description}
        </Link>
      </Td>
      <Td className='mono text-left'>{row.plantId}</Td>
      <Td className='mono text-left text-[11.5px]'>{row.itemType}</Td>
      <Td className='num'>{formatNumber(row.demand)}</Td>
      <Td className='num'>{formatNumber(row.stock)}</Td>
      <Td className='num'>{row.openPo > 0 ? formatNumber(row.openPo) : <Dash />}</Td>
      <Td className='num'>
        {row.openPo > 0 ? (
          uncommitted > 0.5 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className='text-primary cursor-help'>{formatNumber(row.expectedInbound)}</span>
              </TooltipTrigger>
              <TooltipContent>
                {formatNumber(uncommitted)} {row.baseUom} on order with no supplier commitment behind it.
              </TooltipContent>
            </Tooltip>
          ) : (
            formatNumber(row.expectedInbound)
          )
        ) : (
          <Dash />
        )}
      </Td>
      <Td className='num text-muted-foreground'>{formatNumber(row.safetyStock)}</Td>
      <Td
        className={cn(
          'num font-semibold',
          row.projectedBalance < 0 && 'text-destructive',
          row.projectedBalance >= 0 && row.projectedBalance < row.safetyStock && 'text-primary',
        )}
      >
        {formatNumber(row.projectedBalance)}
      </Td>
      <Td className='mono text-destructive text-left'>
        {row.stockoutDate ? formatDateShort(row.stockoutDate) : <Dash />}
      </Td>
      <Td className='text-left'>
        <Badge variant='outline' className={cn('h-4 px-1 text-[10px] font-normal', statusClass(row.status))}>
          {STATUS_LABEL[row.status]}
        </Badge>
      </Td>
      <Td className='num'>{row.exposure > 0 ? formatCurrency(row.exposure) : <Dash />}</Td>
    </tr>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={cn('grid-cell border-b border-b-[color-mix(in_oklab,var(--border)_70%,transparent)]', className)}>
      {children}
    </td>
  );
}

function Dash() {
  return <span className='text-muted-foreground/40'>—</span>;
}
