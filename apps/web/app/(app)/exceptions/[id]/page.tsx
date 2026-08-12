'use client';

/**
 * S3 — the resolution workbench.
 *
 * Three columns: why it happened, what can be done, and what each option would
 * actually do to the plan. The right-hand column always shows the exceptions a
 * fix *creates* alongside the ones it closes — a tool that only shows the upside
 * is selling, not planning.
 */

import { EXCEPTION_LABELS, formatCurrency, formatDays, formatPercent } from '@repo/domain';
import { Badge } from '@repo/ui/components/badge';
import { Button } from '@repo/ui/components/button';
import { Separator } from '@repo/ui/components/separator';
import { Skeleton } from '@repo/ui/components/skeleton';
import { cn } from '@repo/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Loader2, Network, Play } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import type { ExceptionDetail, ResolutionCard, SimulationDiff } from '@/lib/api-types';
import { SimulationPanel } from '@/components/workbench/SimulationPanel';
import { WritebackPreview } from '@/components/workbench/WritebackPreview';

export default function WorkbenchPage() {
  const params = useParams<{ id: string }>();
  const exceptionId = decodeURIComponent(params.id);
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<SimulationDiff | null>(null);
  const [writebacks, setWritebacks] = useState<SimulationDiff['writebacks'] | null>(null);

  const detail = useQuery({
    queryKey: ['exception', exceptionId],
    queryFn: async (): Promise<ExceptionDetail> => {
      const response = await fetch(`/api/exceptions/${encodeURIComponent(exceptionId)}`);
      if (!response.ok) throw new Error((await response.json()).error ?? 'That exception could not be loaded.');
      return response.json();
    },
  });

  const simulate = useMutation({
    mutationFn: async (resolutionId: string): Promise<SimulationDiff> => {
      const response = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exceptionId, resolutionId }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? 'The simulation could not be run.');
      return response.json();
    },
    onSuccess: (result) => {
      setDiff(result);
      setWritebacks(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const commit = useMutation({
    mutationFn: async (resolutionId: string) => {
      const response = await fetch('/api/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exceptionId, resolutionId }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? 'That resolution could not be committed.');
      return response.json() as Promise<{ writebacks: SimulationDiff['writebacks']; notice: string }>;
    },
    onSuccess: async (result) => {
      setWritebacks(result.writebacks);
      await queryClient.invalidateQueries({ queryKey: ['plan-summary'] });
      await queryClient.invalidateQueries({ queryKey: ['exceptions'] });
      toast.success('Committed to the plan', { description: result.notice });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (detail.isLoading) {
    return (
      <div className='grid grid-cols-3 gap-2 p-4'>
        <Skeleton className='h-96' />
        <Skeleton className='h-96' />
        <Skeleton className='h-96' />
      </div>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <div className='flex h-96 flex-col items-center justify-center gap-2 text-[13px]'>
        <span className='font-medium'>{detail.error?.message ?? 'That exception could not be loaded.'}</span>
        <Button asChild variant='outline' size='sm'>
          <Link href='/'>Back to the cockpit</Link>
        </Button>
      </div>
    );
  }

  const { row, impact, trace, resolutions } = detail.data;
  const activeResolution = resolutions.find((entry) => entry.id === selected) ?? null;

  return (
    <div className='flex h-[calc(100svh-3rem)] flex-col'>
      <div className='flex items-center gap-3 border-b px-4 py-2'>
        <Button asChild variant='ghost' size='sm' className='h-6 gap-1 px-1.5 text-[11.5px]'>
          <Link href='/'>
            <ArrowLeft className='size-3.5' />
            Cockpit
          </Link>
        </Button>
        <span className='mono text-[13px] font-semibold'>{row.code}</span>
        <span className='text-muted-foreground text-[13px]'>{EXCEPTION_LABELS[row.code]}</span>
        <Separator orientation='vertical' className='h-4' />
        <Link
          href={`/item/${encodeURIComponent(row.itemId)}/${encodeURIComponent(row.plantId)}`}
          className='mono hover:text-primary flex items-center gap-1 text-[12.5px]'
        >
          {row.itemId} @ {row.plantId}
          <ExternalLink className='size-3' />
        </Link>
        <span className='text-muted-foreground truncate text-[12.5px]'>{row.itemDescription}</span>

        <div className='ml-auto flex items-center gap-3'>
          {row.peggedFgCount > 0 ? (
            <Button asChild size='sm' variant='outline' className='h-6 gap-1 px-2 text-[11.5px]'>
              <Link href={`/blast/${encodeURIComponent(row.id)}`}>
                <Network className='size-3' />
                {row.peggedFgCount} finished goods affected
              </Link>
            </Button>
          ) : null}
          <span className='mono text-[16px] font-semibold'>{formatCurrency(row.impactValue)}</span>
        </div>
      </div>

      <div className='grid min-h-0 flex-1 grid-cols-[minmax(300px,1fr)_minmax(340px,1.1fr)_minmax(360px,1.3fr)]'>
        {/* Left — how it happened. */}
        <section className='flex min-h-0 flex-col overflow-auto border-r'>
          <SectionHeader title='Root cause' subtitle='Each line is a record, not a template' />
          <div className='px-3 py-2'>
            <p className='text-[12.5px] leading-[19px]'>{row.narrative}</p>
          </div>
          <div className='divide-y border-t'>
            {trace.map((line, index) => (
              <div key={`${line.label}-${index}`} className='px-3 py-2'>
                <div className='flex items-baseline justify-between gap-2'>
                  <span className='text-muted-foreground text-[11px] font-medium tracking-wide uppercase'>
                    {line.label}
                  </span>
                  <Badge variant='outline' className='h-4 px-1 text-[9.5px] font-normal'>
                    {line.kind.toLowerCase()}
                  </Badge>
                </div>
                <div className='mono mt-0.5 text-[12.5px]'>
                  {line.link?.type === 'ITEM' ? (
                    <Link
                      href={`/item/${encodeURIComponent(line.link.itemId)}/${encodeURIComponent(line.link.plantId)}`}
                      className='hover:text-primary underline underline-offset-2'
                    >
                      {line.value}
                    </Link>
                  ) : (
                    line.value
                  )}
                </div>
                {line.detail ? (
                  <p className='text-muted-foreground mt-0.5 text-[11.5px] leading-tight'>{line.detail}</p>
                ) : null}
              </div>
            ))}
          </div>

          <SectionHeader title='What it costs' subtitle='Every component computed from pegged facts' />
          <div className='divide-y border-t'>
            <ImpactRow label='Revenue at risk' value={impact.revenueAtRisk} />
            <ImpactRow label='Margin at risk' value={impact.marginAtRisk} />
            <ImpactRow label='Excess inventory' value={impact.excessInventoryValue} />
            <ImpactRow label='Expedite exposure' value={impact.expediteCostExposure} />
            <ImpactRow label='Obsolescence exposure' value={impact.obsolescenceExposure} />
            <ImpactRow label='Total' value={impact.total} emphasis />
          </div>
        </section>

        {/* Centre — what can be done. */}
        <section className='flex min-h-0 flex-col overflow-auto border-r'>
          <SectionHeader
            title={`${resolutions.length} resolution${resolutions.length === 1 ? '' : 's'}`}
            subtitle='Ranked by service recovered, cost and confidence'
          />
          <div className='divide-y'>
            {resolutions.map((resolution) => (
              <ResolutionRow
                key={resolution.id}
                resolution={resolution}
                isSelected={selected === resolution.id}
                isSimulating={simulate.isPending && selected === resolution.id}
                onSimulate={() => {
                  setSelected(resolution.id);
                  simulate.mutate(resolution.id);
                }}
              />
            ))}
          </div>
        </section>

        {/* Right — what it would actually do. */}
        <section className='flex min-h-0 flex-col overflow-auto'>
          {writebacks ? (
            <WritebackPreview writebacks={writebacks} onBack={() => setWritebacks(null)} />
          ) : (
            <SimulationPanel
              diff={diff}
              isSimulating={simulate.isPending}
              resolution={activeResolution}
              onCommit={() => activeResolution && commit.mutate(activeResolution.id)}
              isCommitting={commit.isPending}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className='bg-muted/40 sticky top-0 z-10 border-b px-3 py-1.5'>
      <div className='text-[11px] font-medium tracking-wide uppercase'>{title}</div>
      <div className='text-muted-foreground text-[10.5px]'>{subtitle}</div>
    </div>
  );
}

function ImpactRow({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between px-3 py-1.5 text-[12.5px]',
        emphasis && 'bg-muted/30 font-semibold',
      )}
    >
      <span className={cn(!emphasis && 'text-muted-foreground')}>{label}</span>
      <span className='mono'>
        {value > 0 ? formatCurrency(value) : <span className='text-muted-foreground/50'>—</span>}
      </span>
    </div>
  );
}

function ResolutionRow({
  resolution,
  isSelected,
  isSimulating,
  onSimulate,
}: {
  resolution: ResolutionCard;
  isSelected: boolean;
  isSimulating: boolean;
  onSimulate: () => void;
}) {
  return (
    <div className={cn('px-3 py-2.5', isSelected && 'bg-accent/40')}>
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <div className='text-[13px] font-medium'>{resolution.label}</div>
          <div className='text-muted-foreground mono mt-0.5 text-[10.5px] tracking-wide uppercase'>
            {resolution.type.replace(/_/g, ' ').toLowerCase()}
          </div>
        </div>
        <Button
          size='sm'
          variant={isSelected ? 'default' : 'outline'}
          className='h-6 shrink-0 gap-1 px-2 text-[11.5px]'
          onClick={onSimulate}
          disabled={isSimulating}
        >
          {isSimulating ? <Loader2 className='size-3 animate-spin' /> : <Play className='size-3' />}
          Simulate
        </Button>
      </div>

      <p className='text-muted-foreground mt-1.5 text-[12px] leading-[17px]'>{resolution.rationale}</p>

      <div className='mt-2 grid grid-cols-4 gap-2 text-[11px]'>
        <Metric label='Cost' value={resolution.estimatedCost > 0 ? formatCurrency(resolution.estimatedCost) : 'none'} />
        <Metric label='Δ service' value={formatPercent(resolution.estimatedServiceImpact, 0)} />
        <Metric label='To effect' value={formatDays(resolution.leadTimeToEffect)} />
        <Metric label='Confidence' value={formatPercent(resolution.confidence, 0)} />
      </div>

      {resolution.writebackTargets.length > 0 ? (
        <div className='mt-1.5 flex items-center gap-1'>
          <span className='text-muted-foreground text-[10.5px]'>writes to</span>
          {resolution.writebackTargets.map((target) => (
            <Badge key={target} variant='outline' className='mono h-4 px-1 text-[9.5px] font-normal'>
              {target}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className='text-muted-foreground text-[10px] tracking-wide uppercase'>{label}</div>
      <div className='mono text-[12px]'>{value}</div>
    </div>
  );
}
