'use client';

/**
 * The planning parameter rail.
 *
 * Green where the maintained value still matches observation, amber where it has
 * drifted — with both figures shown side by side — and red where it was never
 * maintained at all. This is where master data decay stops being a concept and
 * becomes a number someone has to explain.
 */

import { Badge } from '@repo/ui/components/badge';
import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { cn } from '@repo/ui/lib/utils';
import { Check, Pencil, SlidersHorizontal, X } from 'lucide-react';
import { useState } from 'react';

import type { ItemDetail, ParameterHealth } from '@/lib/api-types';

const EDITABLE = new Set([
  'leadTimeDays',
  'safetyStock',
  'fixedLotSize',
  'minLotSize',
  'maxLotSize',
  'roundingValue',
  'periodsOfSupplyDays',
  'reorderPoint',
  'safetyTimeDays',
  'grProcessingTimeDays',
  'scrapPct',
  'serviceLevelTarget',
]);

export function ParameterRail({
  detail,
  onEdit,
  onOverride,
  isSaving,
}: {
  detail: ItemDetail;
  onEdit: (field: string, value: number | null) => void;
  /** Opens the weighed override — reason captured, consequence shown first. */
  onOverride: (parameter: ParameterHealth) => void;
  isSaving: boolean;
}) {
  const drifted = detail.parameters.filter((row) => row.status === 'DRIFTED').length;
  const missing = detail.parameters.filter((row) => row.status === 'MISSING').length;

  return (
    <aside className='flex w-[288px] shrink-0 flex-col border-l'>
      <div className='border-b px-3 py-2'>
        <div className='flex items-baseline justify-between'>
          <span className='text-[11px] font-medium tracking-wide uppercase'>Planning parameters</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className='mono cursor-help text-[13px] font-semibold'>{detail.healthScore}</span>
            </TooltipTrigger>
            <TooltipContent className='max-w-xs'>
              Master data health, 0–100: completeness (40%), freshness (30%), and consistency with the other systems
              (30%).
            </TooltipContent>
          </Tooltip>
        </div>
        <p className='text-muted-foreground mt-0.5 text-[11.5px]'>
          {drifted > 0 || missing > 0 ? (
            <>
              {drifted > 0 ? <span className='text-foreground font-medium'>{drifted} drifted</span> : null}
              {drifted > 0 && missing > 0 ? ' · ' : null}
              {missing > 0 ? <span className='text-destructive font-medium'>{missing} unmaintained</span> : null}
            </>
          ) : (
            'Every parameter still matches observation.'
          )}
        </p>
      </div>

      <div className='flex-1 divide-y overflow-auto'>
        {detail.parameters.map((row) => (
          <ParameterRow
            key={row.field}
            row={row}
            editable={EDITABLE.has(row.field)}
            onEdit={onEdit}
            onOverride={onOverride}
            isSaving={isSaving}
          />
        ))}
      </div>
    </aside>
  );
}

function ParameterRow({
  row,
  editable,
  onEdit,
  onOverride,
  isSaving,
}: {
  row: ParameterHealth;
  editable: boolean;
  onEdit: (field: string, value: number | null) => void;
  onOverride: (parameter: ParameterHealth) => void;
  isSaving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const start = () => {
    setDraft(row.maintained.replace(/[^0-9.-]/g, ''));
    setEditing(true);
  };

  const save = () => {
    const parsed = draft.trim() === '' ? null : Number(draft);
    if (parsed !== null && !Number.isFinite(parsed)) return;
    onEdit(row.field, parsed);
    setEditing(false);
  };

  return (
    <div className='group px-3 py-1.5'>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-muted-foreground text-[11.5px]'>{row.label}</span>
        <div className='flex items-center gap-1'>
          <StatusDot status={row.status} />
          {editable && !editing ? (
            <>
              {/* Two paths, deliberately. The pencil is the quick correction;
                  the sliders open the weighed override, where the planner sees
                  the consequence and records why before anything is applied. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-4 w-4 p-0 opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100'
                    onClick={start}
                    aria-label={`Edit ${row.label}`}
                  >
                    <Pencil className='size-3' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Change it now</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-4 w-4 p-0 opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100'
                    onClick={() => onOverride(row)}
                    aria-label={`Override ${row.label} with a reason`}
                  >
                    <SlidersHorizontal className='size-3' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Override — weigh it first, and record why</TooltipContent>
              </Tooltip>
            </>
          ) : null}
        </div>
      </div>

      {editing ? (
        <div className='mt-1 flex items-center gap-1'>
          <Input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save();
              if (event.key === 'Escape') setEditing(false);
            }}
            className='mono h-6 text-[12px]'
            disabled={isSaving}
          />
          <Button size='sm' className='h-6 w-6 p-0' onClick={save} disabled={isSaving} aria-label='Save'>
            <Check className='size-3' />
          </Button>
          <Button
            size='sm'
            variant='ghost'
            className='h-6 w-6 p-0'
            onClick={() => setEditing(false)}
            aria-label='Cancel'
          >
            <X className='size-3' />
          </Button>
        </div>
      ) : (
        <div className='flex items-baseline justify-between gap-2'>
          <span className={cn('mono text-[12.5px]', row.status === 'MISSING' && 'text-destructive')}>
            {row.maintained}
          </span>
          {row.observed ? (
            <Badge
              variant='outline'
              className={cn('h-4 px-1 text-[10px] font-normal', row.status === 'DRIFTED' && 'health-drifted')}
            >
              {row.observed}
            </Badge>
          ) : null}
        </div>
      )}

      {row.note ? <p className='text-muted-foreground/80 mt-0.5 text-[10.5px] leading-tight'>{row.note}</p> : null}
    </div>
  );
}

function StatusDot({ status }: { status: ParameterHealth['status'] }) {
  const label =
    status === 'FRESH' ? 'Matches observation' : status === 'DRIFTED' ? 'Drifted from observation' : 'Never maintained';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'size-1.5 rounded-full',
            status === 'FRESH' && 'bg-primary',
            status === 'DRIFTED' && 'bg-primary/40 ring-primary/60 ring-1',
            status === 'MISSING' && 'bg-destructive',
          )}
          aria-label={label}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
