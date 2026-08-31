'use client';

/**
 * Material View.
 *
 * One hero: the projection chart. Everything else on the screen supports it,
 * and nothing competes with it for weight — which is the whole diagnosis of why
 * the previous build read as messy. Three levels of type, one card per idea, no
 * card nested inside another.
 */

import { formatCurrency, formatDateFull, formatNumber } from '@repo/domain';
import { Skeleton } from '@repo/ui/components/skeleton';
import { cn } from '@repo/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import type { ItemDetail } from '@/lib/api-types';
import { ProjectionChart } from '@/components/planning/ProjectionChart';
import { NormRail } from '@/components/planning/NormRail';
import { ExplainDrawer } from '@/components/planning/ExplainDrawer';
import { TimePhasedTable } from '@/components/planning/TimePhasedTable';

export default function MaterialPage() {
  const params = useParams<{ itemId: string; plantId: string }>();
  const itemId = decodeURIComponent(params.itemId);
  const plantId = decodeURIComponent(params.plantId);

  const detail = useQuery({
    queryKey: ['material', itemId, plantId],
    queryFn: async (): Promise<ItemDetail> => {
      const response = await fetch(`/api/items/${encodeURIComponent(itemId)}/${encodeURIComponent(plantId)}`);
      if (!response.ok) throw new Error('That material could not be loaded.');
      return response.json();
    },
  });

  if (detail.isError) {
    return (
      <Shell>
        <div className='bg-card rounded-lg border p-8'>
          <p className='text-[14px] font-medium'>That material could not be loaded.</p>
          <p className='text-muted-foreground mt-1 text-[13px]'>
            It may not be planned at this plant. Go back to the materials list and pick another.
          </p>
          <Link href='/item' className='text-primary mt-4 inline-block text-[13px] font-medium hover:underline'>
            Back to materials
          </Link>
        </div>
      </Shell>
    );
  }

  if (!detail.data) {
    return (
      <Shell>
        <Skeleton className='h-9 w-96' />
        <div className='mt-8 grid grid-cols-12 gap-6'>
          <Skeleton className='col-span-9 h-[460px] rounded-lg' />
          <Skeleton className='col-span-3 h-[460px] rounded-lg' />
        </div>
      </Shell>
    );
  }

  const item = detail.data;

  return (
    <Shell>
      <Link
        href='/item'
        className='text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-[12px]'
      >
        <ArrowLeft className='size-3.5' />
        Materials
      </Link>

      {/* Header — one line, per §6.2 */}
      <header className='mb-8 flex flex-wrap items-baseline gap-x-4 gap-y-1'>
        <h1 className='text-[22px] font-semibold tracking-tight'>{item.description}</h1>
        <span className='text-muted-foreground font-mono text-[13px]'>
          {item.itemId} · {item.plantId} · {item.itemType} · class {item.abcClass}
        </span>
        <StatusPill stockoutDate={item.position.stockoutDate} />
      </header>

      <div className='grid grid-cols-12 gap-6'>
        <div className='col-span-12 xl:col-span-9'>
          <ProjectionChart detail={item} />
        </div>
        <div className='col-span-12 xl:col-span-3'>
          <NormRail detail={item} />
        </div>
      </div>

      {item.recommendation ? (
        <section className='bg-card mt-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border p-6'>
          <div>
            <h2 className='text-muted-foreground text-[15px] font-semibold tracking-[0.04em] uppercase'>
              What the plan recommends
            </h2>
            <p className='mt-2 text-[14px] leading-relaxed'>
              Order{' '}
              <span className='text-[22px] font-semibold tracking-[-0.02em] tabular-nums'>
                {formatNumber(item.recommendation.recommendedQty)} {item.baseUom}
              </span>{' '}
              for receipt on {formatDateFull(item.recommendation.receiptDate)}
              {item.recommendation.isReleaseInPast ? (
                <span className='text-status-critical'>
                  {' '}
                  — which had to be placed on {formatDateFull(item.recommendation.releaseDate)}, already past
                </span>
              ) : (
                <>, placed by {formatDateFull(item.recommendation.releaseDate)}</>
              )}
              .
            </p>
          </div>
          <ExplainDrawer detail={item} explain={item.recommendation} />
        </section>
      ) : null}

      <div className='mt-6'>
        <TimePhasedTable detail={item} />
      </div>

      {/* Supporting figures — 32px, so they never compete with the chart */}
      <section className='mt-8 grid grid-cols-2 gap-6 md:grid-cols-4'>
        <Metric label='Demand over horizon' value={formatNumber(item.position.demand)} uom={item.baseUom} />
        <Metric label='Stock on hand' value={formatNumber(item.stock.unrestricted)} uom={item.baseUom} />
        <Metric
          label='Committed inbound'
          value={formatNumber(item.position.expectedInbound)}
          uom={item.baseUom}
          note={`plus ${formatNumber(item.position.plannedReceipts)} ${item.baseUom} the plan recommends`}
        />
        <Metric
          label='Value on hand'
          value={formatCurrency(item.stock.unrestricted * item.standardCost)}
          note={`at ${formatCurrency(item.standardCost)} per ${item.baseUom}`}
        />
      </section>

      <section className='mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2'>
        <StockByStatus detail={item} />
        <OpenOrders detail={item} />
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className='mx-auto max-w-[1600px] px-8 py-8'>{children}</div>;
}

/**
 * States the position in the same terms the chart plots it. The previous
 * version read `stockoutDate` off the committed-only balance and announced
 * "runs out 03 Sep · short 1,518" directly above a line that never drops below
 * 123 — two true numbers telling a viewer two different stories.
 */
function StatusPill({ stockoutDate }: { stockoutDate: string | null }) {
  if (stockoutDate === null) {
    return (
      <span className='bg-status-settled/12 text-status-settled rounded-full px-2.5 py-0.5 text-[12px] font-medium'>
        Committed supply covers the horizon
      </span>
    );
  }
  return (
    <span className='bg-status-critical/12 text-status-critical rounded-full px-2.5 py-0.5 text-[12px] font-medium'>
      Committed only to {formatDateFull(stockoutDate)}
    </span>
  );
}

function Metric({ label, value, uom, note }: { label: string; value: string; uom?: string; note?: string }) {
  return (
    <div>
      <p className='text-muted-foreground text-[12px] font-medium'>{label}</p>
      <p className='mt-1 text-[32px] font-semibold tracking-[-0.02em] tabular-nums'>
        {value}
        {uom ? <span className='text-muted-foreground ml-1.5 text-[14px] font-normal'>{uom}</span> : null}
      </p>
      {note ? <p className='text-muted-foreground mt-0.5 text-[12px]'>{note}</p> : null}
    </div>
  );
}

function StockByStatus({ detail }: { detail: ItemDetail }) {
  const rows = [
    ['Unrestricted', detail.stock.unrestricted],
    ['In transit', detail.stock.inTransit],
    ['Quality inspection', detail.stock.qualityInspection],
    ['Blocked', detail.stock.blocked],
  ] as const;

  return (
    <div className='bg-card rounded-lg border p-6'>
      <h2 className='text-muted-foreground mb-4 text-[15px] font-semibold tracking-[0.04em] uppercase'>
        Stock by status
      </h2>
      <table className='w-full'>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className='border-border/50 border-b last:border-0'>
              <td className='py-2.5 text-[14px]'>{label}</td>
              <td className='py-2.5 text-right text-[13px] font-medium tabular-nums'>
                {formatNumber(value)} {detail.baseUom}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OpenOrders({ detail }: { detail: ItemDetail }) {
  return (
    <div className='bg-card rounded-lg border p-6'>
      <h2 className='text-muted-foreground mb-4 text-[15px] font-semibold tracking-[0.04em] uppercase'>Open orders</h2>
      {detail.purchaseOrders.length === 0 ? (
        <p className='text-muted-foreground text-[13px]'>
          Nothing on order. The plan is covering this material from stock and from orders it is recommending.
        </p>
      ) : (
        <table className='w-full'>
          <thead>
            <tr className='bg-surface-sunken'>
              <Th>Order</Th>
              <Th>Vendor</Th>
              <Th align='right'>Quantity</Th>
              <Th align='right'>Lines</Th>
              <Th align='right'>Confirmed</Th>
            </tr>
          </thead>
          <tbody>
            {detail.purchaseOrders.slice(0, 6).map((order) => (
              <tr key={order.id} className='border-border/50 border-b last:border-0'>
                <td className='py-2.5 font-mono text-[12px]'>{order.id}</td>
                <td className='py-2.5 text-[13px]'>{order.vendorName ?? order.vendorId ?? '—'}</td>
                <td className='py-2.5 text-right text-[13px] tabular-nums'>{formatNumber(order.totalQty)}</td>
                <td className='py-2.5 text-right text-[13px] tabular-nums'>{order.lines.length}</td>
                <td className='py-2.5 text-right text-[13px] tabular-nums'>
                  {formatNumber(order.confirmedQty)}
                  <span className='text-muted-foreground'> / {formatNumber(order.totalQty)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={cn(
        'text-muted-foreground px-0 py-2 text-[12px] font-medium tracking-[0.04em] uppercase',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}
