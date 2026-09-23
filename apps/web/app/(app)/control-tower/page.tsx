'use client';

/**
 * Screen 8 — the purchase-order control tower.
 *
 * A different reader from the seven screens before it: the category manager,
 * the sourcing lead, the planning head. It answers *how is the whole book
 * behaving* rather than *what should I do about this material*, and it is last
 * because it is worthless until the rest are generating the data it counts.
 *
 * The figure it leads with is the share of the open book nobody has
 * acknowledged. There is no number for that today, and it falls out of Phase 1
 * as a by-product rather than as a project of its own.
 */

import { formatCurrency, formatNumber, formatPercent } from '@repo/domain';
import { Skeleton } from '@repo/ui/components/skeleton';
import { cn } from '@repo/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';

import { LoadError } from '@/components/general/LoadError';
import type { ControlTowerView } from '@/lib/api-types';
import { useViewState } from '@/lib/view-state';

export default function ControlTowerPage() {
  const { plantId } = useViewState();

  const query = useQuery({
    queryKey: ['control-tower', plantId],
    queryFn: async (): Promise<ControlTowerView> => {
      const params = new URLSearchParams();
      if (plantId) params.set('plant', plantId);
      const response = await fetch(`/api/control-tower?${params.toString()}`);
      if (!response.ok) throw new Error('The control tower could not be loaded.');
      return response.json();
    },
  });

  if (query.isError && !query.data) {
    return (
      <Shell>
        <LoadError
          message='The control tower could not be loaded.'
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </Shell>
    );
  }

  if (!query.data) {
    return (
      <Shell>
        <Skeleton className='h-8 w-72' />
        <Skeleton className='mt-6 h-[420px] rounded-lg' />
      </Shell>
    );
  }

  const view = query.data;

  return (
    <Shell>
      <header className='mb-5'>
        <h1 className='text-[20px] font-semibold tracking-tight'>Purchase-order control tower</h1>
        <p className='text-muted-foreground mt-1 max-w-4xl text-[13px] leading-relaxed'>
          {formatNumber(view.openBook.totalLines)} open schedule lines worth {formatCurrency(view.openBook.totalValue)},
          and what happened to the {formatNumber(view.closedBook.totalLines)} received in the last{' '}
          {view.closedBook.windowDays} days.
        </p>
      </header>

      {/* The figure that should stop a category manager. */}
      <section className='bg-card rounded-lg border px-6 py-5'>
        <p className='text-muted-foreground text-[12px] font-medium tracking-[0.03em] uppercase'>
          Open supply nobody has acknowledged
        </p>
        <p className='text-status-attention mt-2 text-[44px] leading-none font-semibold tracking-[-0.02em] tabular-nums'>
          {formatPercent(view.openBook.unconfirmedShare, 1)}
        </p>
        <p className='mt-3 max-w-3xl text-[13px] leading-relaxed'>
          {formatNumber(view.openBook.rows[0]?.lines ?? 0)} of {formatNumber(view.openBook.totalLines)} live schedule
          lines have no vendor acknowledgement behind them, worth {formatCurrency(view.openBook.rows[0]?.value ?? 0)}.
          Until this screen exists there is no number for it at all — and it is the strongest available argument for a
          vendor collaboration portal, produced as a by-product of the planning work rather than as a project of its
          own.
        </p>
      </section>

      <div className='mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2'>
        <Panel title='The open book' note='Where every live schedule line currently sits.'>
          <table className='w-full'>
            <thead>
              <tr className='bg-surface-sunken'>
                <Th>State</Th>
                <Th align='right'>Lines</Th>
                <Th align='right'>Share</Th>
                <Th align='right'>Value</Th>
              </tr>
            </thead>
            <tbody>
              {view.openBook.rows.map((row) => (
                <tr key={row.state} className='grid-row'>
                  <td className='grid-cell'>{row.state}</td>
                  <td className='grid-cell num'>{formatNumber(row.lines)}</td>
                  <td
                    className={cn(
                      'grid-cell num',
                      row.state.startsWith('Awaiting') && 'text-status-attention font-medium',
                      row.state.startsWith('Past due') && 'text-status-critical font-medium',
                    )}
                  >
                    {formatPercent(row.share, 1)}
                  </td>
                  <td className='grid-cell num'>{formatCurrency(row.value)}</td>
                </tr>
              ))}
              <tr className='bg-surface-sunken font-medium'>
                <td className='grid-cell'>Total open</td>
                <td className='grid-cell num'>{formatNumber(view.openBook.totalLines)}</td>
                <td className='grid-cell num'>100%</td>
                <td className='grid-cell num'>{formatCurrency(view.openBook.totalValue)}</td>
              </tr>
            </tbody>
          </table>
        </Panel>

        <Panel title='The closed book' note={`What actually happened, last ${view.closedBook.windowDays} days.`}>
          <table className='w-full'>
            <thead>
              <tr className='bg-surface-sunken'>
                <Th>Outcome against the requested date</Th>
                <Th align='right'>Lines</Th>
                <Th align='right'>Share</Th>
              </tr>
            </thead>
            <tbody>
              {view.closedBook.rows.map((row) => (
                <tr key={row.outcome} className='grid-row'>
                  <td className='grid-cell'>{row.outcome}</td>
                  <td className='grid-cell num'>{formatNumber(row.lines)}</td>
                  <td
                    className={cn(
                      'grid-cell num',
                      row.outcome.startsWith('Late more') && 'text-status-critical font-medium',
                    )}
                  >
                    {formatPercent(row.share, 1)}
                  </td>
                </tr>
              ))}
              <tr className='bg-surface-sunken font-medium'>
                <td className='grid-cell'>Total received</td>
                <td className='grid-cell num'>{formatNumber(view.closedBook.totalLines)}</td>
                <td className='grid-cell num'>100%</td>
              </tr>
            </tbody>
          </table>

          <div className='mt-4 grid grid-cols-2 gap-4'>
            <Figure label='Quantity fill' value={formatPercent(view.closedBook.fillRate, 1)} />
            <Figure label='On time and in full' value={formatPercent(view.closedBook.otif, 1)} tone='attention' />
          </div>
          <p className='text-muted-foreground mt-3 text-[12px] leading-relaxed'>
            Whether that last figure is good or bad is not for this screen to say. It is currently unknown, and a
            planning organisation that does not know it is tuning its norms in the dark.
          </p>
        </Panel>
      </div>

      <div className='mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.5fr]'>
        <Panel title='By plant' note='Where the open book sits, and how much of it is unacknowledged.'>
          <table className='w-full'>
            <thead>
              <tr className='bg-surface-sunken'>
                <Th>Plant</Th>
                <Th align='right'>Lines</Th>
                <Th align='right'>Value</Th>
                <Th align='right'>Unconfirmed</Th>
              </tr>
            </thead>
            <tbody>
              {view.byPlant.map((row) => (
                <tr key={row.id} className='grid-row'>
                  <td className='grid-cell'>
                    <span className='font-mono text-[12px]'>{row.id}</span>
                    <span className='text-muted-foreground ml-2 text-[12px]'>{row.name}</span>
                  </td>
                  <td className='grid-cell num'>{formatNumber(row.lines)}</td>
                  <td className='grid-cell num'>{formatCurrency(row.value)}</td>
                  <td className='grid-cell num'>{formatPercent(row.unconfirmedShare, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className='mt-4'>
            <p className='text-muted-foreground mb-1.5 text-[11px] font-medium tracking-[0.03em] uppercase'>
              Who raised the order
            </p>
            <table className='w-full'>
              <tbody>
                {view.byRaiser.map((row) => (
                  <tr key={row.raiser} className='grid-row'>
                    <td className='grid-cell'>{row.raiser}</td>
                    <td className='grid-cell num'>{formatNumber(row.lines)}</td>
                    <td className='grid-cell num'>{formatPercent(row.share, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title='By vendor'
          note='Median lead time and its spread, beside the value they hold. Two halves of one sourcing conversation.'
        >
          <table className='w-full'>
            <thead>
              <tr className='bg-surface-sunken'>
                <Th>Vendor</Th>
                <Th align='right'>Open lines</Th>
                <Th align='right'>Open value</Th>
                <Th align='right'>Median lead time</Th>
                <Th align='right'>Spread</Th>
              </tr>
            </thead>
            <tbody>
              {view.byVendor.map((row) => (
                <tr key={row.id} className='grid-row'>
                  <td className='grid-cell'>
                    <span className='font-mono text-[12px]'>{row.id}</span>
                    <span className='text-muted-foreground ml-2 text-[12px]'>{row.name}</span>
                  </td>
                  <td className='grid-cell num'>{formatNumber(row.lines)}</td>
                  <td className='grid-cell num'>{formatCurrency(row.value)}</td>
                  <td className='grid-cell num'>{row.medianLeadTimeDays} d</td>
                  <td className={cn('grid-cell num', row.spreadDays > 20 && 'text-status-critical')}>
                    ±{row.spreadDays} d
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <p className='text-muted-foreground mt-5 max-w-4xl text-[12px] leading-relaxed'>{view.boundary}</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className='mx-auto max-w-[1680px] px-6 py-6'>{children}</div>;
}

function Panel({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className='bg-card rounded-lg border'>
      <div className='border-b px-5 py-3'>
        <h2 className='text-[14px] font-semibold'>{title}</h2>
        <p className='text-muted-foreground text-[12px]'>{note}</p>
      </div>
      <div className='px-5 py-3'>{children}</div>
    </section>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'attention' }) {
  return (
    <div>
      <p className='text-muted-foreground text-[11px]'>{label}</p>
      <p
        className={cn(
          'mt-0.5 text-[26px] leading-none font-semibold tabular-nums',
          tone === 'attention' && 'text-status-attention',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={cn('grid-head', align === 'right' ? 'text-right' : 'text-left')}>{children}</th>;
}
