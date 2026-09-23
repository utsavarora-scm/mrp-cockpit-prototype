'use client';

/**
 * The top bar.
 *
 * One bar, no sidebar. It carries only what applies everywhere: which run you
 * are looking at, what it is scoped to, and the two controls the walkthrough
 * uses. Movement between materials is by clicking data, not by navigating.
 *
 * The as-of stamp sits in the bar rather than on each screen, because it
 * applies to every screen and because the first question after "why does this
 * look different from Friday" is "am I even looking at the same run".
 */

import { PRODUCT_NAME, formatDateFull } from '@repo/domain';
import { Button } from '@repo/ui/components/button';
import { Separator } from '@repo/ui/components/separator';
import { ThemeToggle } from '@repo/ui/components/theme-toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { cn } from '@repo/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { toast } from 'sonner';

import type { RunHeader } from '@/lib/api-types';
import { useViewState } from '@/lib/view-state';

const TABS = [
  { href: '/', label: 'Position', match: (path: string) => path === '/' },
  {
    href: '/exceptions',
    label: 'Exceptions',
    match: (path: string) => path.startsWith('/exceptions'),
  },
  {
    href: '/adherence',
    label: 'Adherence',
    match: (path: string) => path.startsWith('/adherence'),
  },
  {
    href: '/control-tower',
    label: 'Control tower',
    match: (path: string) => path.startsWith('/control-tower'),
  },
];

export function TopBar() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { plantId, setPlantId } = useViewState();

  const header = useQuery({
    queryKey: ['run-header'],
    queryFn: async (): Promise<RunHeader> => {
      const response = await fetch('/api/plan?scenario=baseline');
      if (!response.ok) throw new Error('The plan could not be read.');
      return response.json();
    },
  });

  const run = useMutation({
    mutationFn: async (): Promise<RunHeader> => {
      const response = await fetch('/api/plan?scenario=baseline', { method: 'POST' });
      if (!response.ok) throw new Error('The plan could not be re-run.');
      return response.json();
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries();
      toast.success(`Re-planned in ${Math.round(result.elapsedMs)} ms`, {
        description: `${result.materialsPlanned.toLocaleString('en-IN')} materials across ${result.horizonDays} days`,
      });
    },
    onError: () => toast.error('The plan could not be re-run.'),
  });

  const reset = useMutation({
    mutationFn: async (): Promise<RunHeader & { resetMs: number }> => {
      const response = await fetch('/api/demo/reset', { method: 'POST' });
      if (!response.ok) throw new Error('Reset failed.');
      return response.json();
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries();
      toast.success(`Reset in ${result.resetMs} ms`, { description: 'Back to the exact starting state.' });
    },
    onError: () => toast.error('The session could not be reset.'),
  });

  const plants = header.data?.plants ?? [];

  // A material or schedule screen is one material at one plant, and the plant
  // is in its address. The selector shows that plant and stays put there:
  // changing it would leave a bar saying one plant over a screen showing
  // another.
  const scopedPlant = /^\/(?:material|schedule)\/[^/]+\/([^/]+)/.exec(pathname)?.[1];
  const pagePlant = scopedPlant ? decodeURIComponent(scopedPlant) : null;

  return (
    <header className='bg-background/95 sticky top-0 z-30 border-b backdrop-blur'>
      <div className='mx-auto flex h-14 max-w-[1680px] items-center gap-3 px-6'>
        <Link href='/' className='flex items-center gap-2.5'>
          <div className='bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md font-mono text-[12px] font-semibold'>
            PS
          </div>
          <span className='text-[14px] font-semibold tracking-tight'>{PRODUCT_NAME}</span>
        </Link>

        <Separator orientation='vertical' className='mx-1 h-5' />

        <nav className='flex items-center gap-0.5' aria-label='Screens'>
          {TABS.map((tab) => {
            const active = tab.match(pathname);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
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

        <Separator orientation='vertical' className='mx-1 h-5' />

        {/* The as-of stamp. Every screen is a view of one run, and this says which. */}
        {header.data ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className='text-muted-foreground hidden items-center gap-1.5 text-[12px] lg:flex'>
                <span className='text-foreground font-medium'>{header.data.planningWeek}</span>
                <span>· as at {formatDateFull(header.data.planningDate)}</span>
                <span className='text-muted-foreground/70'>· {header.data.mpsVersion}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              {header.data.runType} · {header.data.category} · {header.data.materialsPlanned.toLocaleString('en-IN')}{' '}
              materials planned across {header.data.horizonDays} days
            </TooltipContent>
          </Tooltip>
        ) : null}

        <label
          className='ml-auto flex items-center gap-2'
          title={pagePlant ? 'This screen is for one plant. Go back to the position to change plant.' : undefined}
        >
          <span className='sr-only'>Plant</span>
          <select
            value={pagePlant ?? plantId ?? ''}
            disabled={pagePlant !== null}
            onChange={(event) => setPlantId(event.target.value === '' ? null : event.target.value)}
            className='border-input bg-background hover:bg-muted h-8 rounded-md border px-2 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-transparent'
          >
            <option value=''>All plants</option>
            {plants.map((plant) => (
              <option key={plant.id} value={plant.id}>
                {plant.id} · {plant.name}
                {plant.type === 'COPACKER' ? ' (co-packer)' : ''}
              </option>
            ))}
          </select>
        </label>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='outline'
              size='sm'
              className='h-8 gap-1.5 text-[13px]'
              onClick={() => reset.mutate()}
              disabled={reset.isPending}
            >
              <RotateCcw className='size-3.5' />
              Reset
            </Button>
          </TooltipTrigger>
          <TooltipContent>Drops every override and schedule edit made in this session</TooltipContent>
        </Tooltip>

        <Button size='sm' className='h-8 gap-1.5 text-[13px]' onClick={() => run.mutate()} disabled={run.isPending}>
          <Play className='size-3.5' />
          {run.isPending ? 'Planning…' : 'Re-plan'}
        </Button>

        {/* Fixed width so the bar does not shift when the figure appears. */}
        <span className='text-muted-foreground w-[62px] text-right text-[12px] tabular-nums' aria-live='polite'>
          {run.data ? `${Math.round(run.data.elapsedMs)} ms` : ''}
        </span>

        <ThemeToggle />
      </div>
    </header>
  );
}
