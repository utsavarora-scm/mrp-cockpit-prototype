'use client';

/**
 * S2 — Item 360.
 *
 * The MD04 replacement, and the screen that has to prove domain depth. Edit a
 * planning parameter in the rail and the plan re-runs behind it, which is the
 * answer to "change that number and re-run it".
 */

import { EXCEPTION_LABELS, formatCurrency, formatDateShort, formatNumber, formatQty } from '@repo/domain';
import { Badge } from '@repo/ui/components/badge';
import { Button } from '@repo/ui/components/button';
import { Skeleton } from '@repo/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Network } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import type { ItemDetail, OverridePreview, ParameterHealth } from '@/lib/api-types';
import { OverrideDialog } from '@/components/item/OverrideDialog';
import { PabChart } from '@/components/item/PabChart';
import { ParameterRail } from '@/components/item/ParameterRail';
import { PositionBar } from '@/components/item/PositionBar';
import { PoSchedule, type ScheduleEdit } from '@/components/item/PoSchedule';
import { TimePhasedGrid } from '@/components/item/TimePhasedGrid';
import { WhyPanel } from '@/components/item/WhyPanel';

export default function Item360Page() {
  const params = useParams<{ itemId: string; plantId: string }>();
  const itemId = decodeURIComponent(params.itemId);
  const plantId = decodeURIComponent(params.plantId);
  const queryClient = useQueryClient();

  const [overriding, setOverriding] = useState<ParameterHealth | null>(null);
  const [preview, setPreview] = useState<OverridePreview | null>(null);

  const detail = useQuery({
    queryKey: ['item', itemId, plantId],
    queryFn: async (): Promise<ItemDetail> => {
      const response = await fetch(`/api/items/${encodeURIComponent(itemId)}/${encodeURIComponent(plantId)}`);
      if (!response.ok) throw new Error((await response.json()).error ?? 'The item could not be loaded.');
      return response.json();
    },
  });

  /** Everything else on the board moved too, so nothing may be left cached. */
  const invalidateBoard = async () => {
    await queryClient.invalidateQueries({ queryKey: ['plan-summary'] });
    await queryClient.invalidateQueries({ queryKey: ['exceptions'] });
    await queryClient.invalidateQueries({ queryKey: ['materials'] });
  };

  const edit = useMutation({
    mutationFn: async ({
      field,
      value,
      reason,
    }: {
      field: string;
      value: number | null;
      reason?: string;
    }): Promise<ItemDetail> => {
      const response = await fetch(`/api/items/${encodeURIComponent(itemId)}/${encodeURIComponent(plantId)}/mutate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, value, reason }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? 'That edit could not be applied.');
      return response.json();
    },
    onSuccess: async (updated, variables) => {
      queryClient.setQueryData(['item', itemId, plantId], updated);
      await invalidateBoard();
      setOverriding(null);
      setPreview(null);
      toast.success(`${variables.field} updated — plan re-run`, {
        description: `${updated.exceptions.length} exception${updated.exceptions.length === 1 ? '' : 's'} now on this item.`,
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  /** Weigh an override without committing it — a real run on a cloned snapshot. */
  const weigh = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: number | null }): Promise<OverridePreview> => {
      const response = await fetch(`/api/items/${encodeURIComponent(itemId)}/${encodeURIComponent(plantId)}/mutate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, value, preview: true }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? 'That change could not be weighed.');
      return response.json();
    },
    onSuccess: setPreview,
    onError: (error: Error) => toast.error(error.message),
  });

  const reschedule = useMutation({
    mutationFn: async (change: ScheduleEdit): Promise<ItemDetail> => {
      const response = await fetch(`/api/items/${encodeURIComponent(itemId)}/${encodeURIComponent(plantId)}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? 'That delivery could not be moved.');
      return response.json();
    },
    onSuccess: async (updated, variables) => {
      queryClient.setQueryData(['item', itemId, plantId], updated);
      await invalidateBoard();
      toast.success(`${variables.supplyElementId} delivery ${variables.line} moved — plan re-run`, {
        description: `${updated.exceptions.length} exception${updated.exceptions.length === 1 ? '' : 's'} now on this item.`,
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (detail.isLoading) {
    return (
      <div className='space-y-2 p-4'>
        <Skeleton className='h-16 w-full' />
        <Skeleton className='h-64 w-full' />
        <Skeleton className='h-72 w-full' />
      </div>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <div className='flex h-96 flex-col items-center justify-center gap-2 text-[13px]'>
        <span className='font-medium'>{detail.error?.message ?? 'That item could not be loaded.'}</span>
        <Button asChild variant='outline' size='sm'>
          <Link href='/'>Back to the cockpit</Link>
        </Button>
      </div>
    );
  }

  const item = detail.data;
  const totalStock = item.stock.unrestricted + item.stock.blocked + item.stock.qualityInspection + item.stock.inTransit;

  return (
    <div className='flex h-[calc(100svh-3rem)] flex-col'>
      <div className='flex items-center gap-3 border-b px-4 py-2'>
        <Button asChild variant='ghost' size='sm' className='h-6 gap-1 px-1.5 text-[11.5px]'>
          <Link href='/'>
            <ArrowLeft className='size-3.5' />
            Cockpit
          </Link>
        </Button>
        <div className='flex items-baseline gap-2'>
          <span className='mono text-[15px] font-semibold'>{item.itemId}</span>
          <span className='text-[13px]'>{item.description}</span>
          <Badge variant='outline' className='mono h-4 px-1 text-[10px]'>
            {item.itemType}
          </Badge>
          <Badge variant='outline' className='mono h-4 px-1 text-[10px]'>
            {item.abcClass}/{item.xyzClass}
          </Badge>
        </div>

        {item.position.stockoutDate ? (
          <Badge variant='outline' className='sev-critical h-5 px-1.5 text-[11px] font-medium'>
            Projected stock-out {formatDateShort(item.position.stockoutDate)}
          </Badge>
        ) : null}

        <div className='text-muted-foreground ml-auto flex items-center gap-4 text-[11.5px]'>
          <Stat label='Site' value={item.plantId} />
          <Stat label='Planner' value={item.plannerCode ?? '—'} />
          <Stat label='Procurement' value={item.procurementType ?? '—'} />
          <Stat label='BOM level' value={String(item.lowLevelCode)} />
          <Stat label='Std cost' value={formatCurrency(item.standardCost)} />
          <Stat label='On hand' value={formatQty(totalStock, item.baseUom)} />
          {item.recommendation ? (
            <WhyPanel explain={item.recommendation} uom={item.baseUom} itemId={item.itemId} />
          ) : null}
        </div>
      </div>

      <PositionBar detail={item} />

      <div className='flex items-center gap-4 border-b px-4 py-1.5 text-[11.5px]'>
        <StockSplit label='Unrestricted' value={item.stock.unrestricted} uom={item.baseUom} />
        <StockSplit label='Blocked' value={item.stock.blocked} uom={item.baseUom} />
        <StockSplit label='Quality inspection' value={item.stock.qualityInspection} uom={item.baseUom} />
        <StockSplit label='In transit' value={item.stock.inTransit} uom={item.baseUom} />
        <StockSplit label='Safety stock' value={item.safetyStock} uom={item.baseUom} />
      </div>

      <div className='flex min-h-0 flex-1'>
        <div className='flex min-w-0 flex-1 flex-col'>
          <div className='px-2 pt-2'>
            <PabChart detail={item} />
          </div>

          {item.exceptions.length > 0 ? (
            <div className='flex flex-wrap items-center gap-1.5 border-t px-4 py-2'>
              <span className='text-muted-foreground text-[11px] font-medium tracking-wide uppercase'>
                {item.exceptions.length} exception{item.exceptions.length === 1 ? '' : 's'}
              </span>
              {item.exceptions.map((exception) => (
                <Link
                  key={exception.id}
                  href={`/exceptions/${encodeURIComponent(exception.id)}`}
                  className='hover:bg-muted flex items-center gap-1.5 rounded-[4px] border px-1.5 py-0.5 text-[11.5px]'
                >
                  <span className='mono'>{exception.code.split('-')[0]}</span>
                  <span className='text-muted-foreground'>{EXCEPTION_LABELS[exception.code]}</span>
                  <span className='mono font-semibold'>{formatCurrency(exception.impactValue)}</span>
                </Link>
              ))}
              {item.exceptions[0] && item.exceptions[0].peggedFgCount > 0 ? (
                <Button asChild size='sm' variant='outline' className='ml-1 h-5 gap-1 px-1.5 text-[11px]'>
                  <Link href={`/blast/${encodeURIComponent(item.exceptions[0].id)}`}>
                    <Network className='size-3' />
                    Blast radius
                  </Link>
                </Button>
              ) : null}
            </div>
          ) : (
            <div className='text-muted-foreground border-t px-4 py-2 text-[11.5px]'>
              No exceptions on this item — the plan covers it with orderable supply throughout the horizon.
            </div>
          )}

          <PoSchedule detail={item} onEdit={(change) => reschedule.mutate(change)} isSaving={reschedule.isPending} />

          <TimePhasedGrid detail={item} />
        </div>

        <ParameterRail
          detail={item}
          onEdit={(field, value) => edit.mutate({ field, value })}
          onOverride={(parameter) => {
            setPreview(null);
            setOverriding(parameter);
          }}
          isSaving={edit.isPending}
        />
      </div>

      <OverrideDialog
        parameter={overriding}
        uom={item.baseUom}
        preview={preview}
        isPreviewing={weigh.isPending}
        isSaving={edit.isPending}
        onPreview={(value) => overriding && weigh.mutate({ field: overriding.field, value })}
        onApply={(value, reason) => overriding && edit.mutate({ field: overriding.field, value, reason })}
        onClose={() => {
          setOverriding(null);
          setPreview(null);
        }}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      {label} <span className='mono text-foreground'>{value}</span>
    </span>
  );
}

function StockSplit({ label, value, uom }: { label: string; value: number; uom: string }) {
  return (
    <span className='text-muted-foreground'>
      {label} <span className='mono text-foreground'>{formatNumber(value)}</span>{' '}
      <span className='text-muted-foreground/70'>{uom}</span>
    </span>
  );
}
