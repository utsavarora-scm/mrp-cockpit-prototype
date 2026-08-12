'use client';

/**
 * The top bar.
 *
 * Nine screens as tabs, so the full window width goes to the grids and the
 * graph. The Run MRP button lives here permanently and shows the elapsed
 * milliseconds of the last run — a full re-plan in well under a second is worth
 * seeing happen, not worth hiding behind a spinner.
 */

import { Button } from '@repo/ui/components/button';
import { Separator } from '@repo/ui/components/separator';
import { ThemeToggle } from '@repo/ui/components/theme-toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Play, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { cn } from '@repo/ui/lib/utils';

import type { CockpitSummary } from '@/lib/api-types';

const TABS = [
  { href: '/', label: 'Cockpit', match: (path: string) => path === '/' },
  { href: '/item', label: 'Item 360', match: (path: string) => path.startsWith('/item') },
  { href: '/exceptions', label: 'Resolve', match: (path: string) => path.startsWith('/exceptions') },
  { href: '/blast', label: 'Blast radius', match: (path: string) => path.startsWith('/blast') },
  { href: '/master-data', label: 'Master data', match: (path: string) => path.startsWith('/master-data') },
  { href: '/reconciliation', label: 'Reconciliation', match: (path: string) => path.startsWith('/reconciliation') },
  { href: '/scenarios', label: 'Scenarios', match: (path: string) => path.startsWith('/scenarios') },
  { href: '/integration', label: 'Integration', match: (path: string) => path.startsWith('/integration') },
  { href: '/agent', label: 'Agent', match: (path: string) => path.startsWith('/agent') },
];

export function TopNav() {
  const pathname = usePathname();
  const queryClient = useQueryClient();

  const run = useMutation({
    mutationFn: async (): Promise<CockpitSummary> => {
      const response = await fetch('/api/plan?scenario=baseline', { method: 'POST' });
      if (!response.ok) throw new Error('The plan could not be re-run.');
      return response.json();
    },
    onSuccess: async (summary) => {
      await queryClient.invalidateQueries();
      toast.success(`Re-planned in ${Math.round(summary.elapsedMs)} ms`, {
        description: `${summary.exceptionCount.toLocaleString('en-US')} exceptions across ${summary.horizonDays} days`,
      });
    },
    onError: () => toast.error('The plan could not be re-run.'),
  });

  const reset = useMutation({
    mutationFn: async (): Promise<CockpitSummary & { resetMs: number }> => {
      const response = await fetch('/api/demo/reset', { method: 'POST' });
      if (!response.ok) throw new Error('Reset failed.');
      return response.json();
    },
    onSuccess: async (summary) => {
      await queryClient.invalidateQueries();
      toast.success(`Demo reset in ${summary.resetMs} ms`, { description: 'Back to the exact starting state.' });
    },
    onError: () => toast.error('The demo could not be reset.'),
  });

  return (
    <header className='bg-background/95 sticky top-0 z-30 border-b backdrop-blur'>
      <div className='flex h-12 items-center gap-1 px-3'>
        <div className='flex items-center gap-2 pr-3'>
          <div className='bg-primary text-primary-foreground mono flex size-6 items-center justify-center rounded-[4px] text-[11px] font-semibold'>
            EC
          </div>
          <span className='text-[13px] font-semibold tracking-tight'>Exception Cockpit</span>
        </div>

        <Separator orientation='vertical' className='mr-1 h-5' />

        <nav className='flex items-center gap-0.5' aria-label='Screens'>
          {TABS.map((tab) => {
            const active = tab.match(pathname);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-[5px] px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <div className='ml-auto flex items-center gap-1.5'>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='outline'
                size='sm'
                className='h-7 gap-1.5 px-2 text-[12px]'
                onClick={() => reset.mutate()}
                disabled={reset.isPending}
              >
                <RotateCcw className='size-3.5' />
                Reset demo
              </Button>
            </TooltipTrigger>
            <TooltipContent>Returns every screen to the exact starting state</TooltipContent>
          </Tooltip>

          <Button
            size='sm'
            className='h-7 gap-1.5 px-2.5 text-[12px]'
            onClick={() => run.mutate()}
            disabled={run.isPending}
          >
            <Play className='size-3.5' />
            {run.isPending ? 'Planning…' : 'Run MRP'}
          </Button>

          {run.data ? (
            <span className='mono text-muted-foreground w-[74px] text-right text-[11.5px]' aria-live='polite'>
              {Math.round(run.data.elapsedMs)} ms
            </span>
          ) : (
            <span className='w-[74px]' />
          )}

          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
