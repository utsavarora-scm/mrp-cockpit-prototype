'use client';

/**
 * The top bar.
 *
 * One bar, no sidebar. The previous build's nine nav destinations are the main
 * reason it read as confusing, so movement between screens is by clicking data
 * and the bar carries only what applies everywhere: what you are looking at,
 * what it is scoped to, and the two controls the demo runs on.
 *
 * The re-plan button shows the elapsed milliseconds of the last run. A full
 * re-plan in well under a second is worth watching happen — on video it is the
 * difference between "a mock-up" and "it computed that".
 *
 * The category switcher is deliberately present and disabled. Insecticides
 * arrive with the second data pack in Checkpoint D; showing the control now,
 * greyed and labelled, is honest, whereas adding it later moves the bar's
 * layout in the middle of the recording.
 */

import { PRODUCT_NAME } from '@repo/domain';
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

import type { CockpitSummary } from '@/lib/api-types';
import { useViewState } from '@/lib/view-state';

const TABS = [
  { href: '/', label: 'Cockpit', match: (path: string) => path === '/' },
  {
    href: '/item',
    label: 'Materials',
    match: (path: string) => path.startsWith('/item') || path.startsWith('/material'),
  },
];

export function TopBar() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { plantId, setPlantId } = useViewState();

  const summary = useQuery({
    queryKey: ['cockpit-summary'],
    queryFn: async (): Promise<CockpitSummary> => {
      const response = await fetch('/api/plan?scenario=baseline');
      if (!response.ok) throw new Error('The plan could not be read.');
      return response.json();
    },
  });

  const run = useMutation({
    mutationFn: async (): Promise<CockpitSummary> => {
      const response = await fetch('/api/plan?scenario=baseline', { method: 'POST' });
      if (!response.ok) throw new Error('The plan could not be re-run.');
      return response.json();
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries();
      toast.success(`Re-planned in ${Math.round(result.elapsedMs)} ms`, {
        description: `${result.planningPosition.mrpMaterials.toLocaleString('en-IN')} materials across ${result.horizonDays} days`,
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
    onSuccess: async (result) => {
      await queryClient.invalidateQueries();
      toast.success(`Demo reset in ${result.resetMs} ms`, { description: 'Back to the exact starting state.' });
    },
    onError: () => toast.error('The demo could not be reset.'),
  });

  const plants = summary.data?.plants ?? [];

  return (
    <header className='bg-background/95 sticky top-0 z-30 border-b backdrop-blur'>
      <div className='mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-8'>
        <div className='flex items-center gap-2.5'>
          <div className='bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md font-mono text-[12px] font-semibold'>
            PC
          </div>
          <span className='text-[14px] font-semibold tracking-tight'>{PRODUCT_NAME}</span>
        </div>

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

        <CategorySwitcher />

        <Select
          label='Plant'
          value={plantId ?? ''}
          onChange={(value) => setPlantId(value === '' ? null : value)}
          options={[
            { value: '', label: 'All plants' },
            ...plants.map((plant) => ({
              value: plant.id,
              label: `${plant.id} · ${plant.name}${plant.type === 'COPACKER' ? ' (co-packer)' : ''}`,
            })),
          ]}
        />

        <div className='ml-auto flex items-center gap-2'>
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
            <TooltipContent>Returns every screen to the exact starting state</TooltipContent>
          </Tooltip>

          <Button size='sm' className='h-8 gap-1.5 text-[13px]' onClick={() => run.mutate()} disabled={run.isPending}>
            <Play className='size-3.5' />
            {run.isPending ? 'Planning…' : 'Re-plan'}
          </Button>

          {/* Fixed width so the bar does not shift when the figure appears. */}
          <span className='text-muted-foreground w-[68px] text-right text-[12px] tabular-nums' aria-live='polite'>
            {run.data ? `${Math.round(run.data.elapsedMs)} ms` : ''}
          </span>

          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

/**
 * Soaps today, insecticides in Checkpoint D. Rendered disabled rather than
 * hidden so the bar's layout is already final when Act 1 is recorded.
 */
function CategorySwitcher() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className='text-muted-foreground bg-muted/50 flex h-8 cursor-not-allowed items-center gap-1.5 rounded-md px-2.5 text-[13px]'>
          <span className='text-foreground font-medium'>Soaps</span>
          <span className='text-muted-foreground/70'>· Insecticides</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>Household Insecticides arrives with the seasonal pack</TooltipContent>
    </Tooltip>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className='flex items-center gap-2'>
      <span className='sr-only'>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className='border-input bg-background hover:bg-muted h-8 rounded-md border px-2 text-[13px] transition-colors'
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
