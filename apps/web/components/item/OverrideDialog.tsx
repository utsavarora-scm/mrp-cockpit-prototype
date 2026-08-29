'use client';

/**
 * Planner override.
 *
 * The point of this dialog is that the planner sees the consequence before they
 * accept it. "Weigh it" runs the engine on a cloned snapshot and shows the same
 * arithmetic they would get by applying the change — original requirement
 * against recalculated, and what it does to the worst balance in the horizon.
 *
 * The reason field is not decoration. A system that lets a parameter be
 * overridden without recording why is a system whose master data nobody can
 * audit six months later.
 */

import { formatCurrency, formatNumber } from '@repo/domain';
import { Badge } from '@repo/ui/components/badge';
import { Button } from '@repo/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/dialog';
import { Input } from '@repo/ui/components/input';
import { Label } from '@repo/ui/components/label';
import { Textarea } from '@repo/ui/components/textarea';
import { cn } from '@repo/ui/lib/utils';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useState } from 'react';

import type { OverridePreview, ParameterHealth } from '@/lib/api-types';

export function OverrideDialog({
  parameter,
  uom,
  preview,
  isPreviewing,
  isSaving,
  onPreview,
  onApply,
  onClose,
}: {
  parameter: ParameterHealth | null;
  uom: string;
  preview: OverridePreview | null;
  isPreviewing: boolean;
  isSaving: boolean;
  onPreview: (value: number | null) => void;
  onApply: (value: number | null, reason: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [reason, setReason] = useState('');
  const [seededFor, setSeededFor] = useState<string | null>(null);

  // Seeded during render rather than in an effect: this is the "adjust state
  // when a prop changes" case, and doing it in an effect renders the dialog
  // once with the previous parameter's value still in the field.
  if (parameter && seededFor !== parameter.field) {
    setSeededFor(parameter.field);
    setDraft(parameter.maintained.replace(/[^0-9.-]/g, ''));
    setReason('');
  }

  if (!parameter) return null;

  const parsed = draft.trim() === '' ? null : Number(draft);
  const isValid = parsed === null || Number.isFinite(parsed);
  const unchanged = draft.trim() === parameter.maintained.replace(/[^0-9.-]/g, '').trim();

  // The observed figure is the strongest argument for an override, so offer it
  // as a one-click starting point rather than making it be retyped.
  const observedNumber = parameter.observed ? Number(parameter.observed.replace(/[^0-9.-]/g, '')) : NaN;
  const canAdoptObserved = Number.isFinite(observedNumber) && String(observedNumber) !== draft.trim();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-[520px]'>
        <DialogHeader>
          <DialogTitle className='text-[14px]'>Override {parameter.label.toLowerCase()}</DialogTitle>
          <DialogDescription className='text-[12px]'>
            The system value stands until you replace it. Weigh the change first — the plan will be re-run for real.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div className='grid grid-cols-[1fr_auto_1fr] items-end gap-2'>
            <div className='space-y-1'>
              <Label className='text-[11.5px]'>System value</Label>
              <div className='bg-muted/50 mono flex h-7 items-center rounded-[5px] border px-2 text-[12px]'>
                {parameter.maintained}
              </div>
            </div>
            <ArrowRight className='text-muted-foreground mb-2 size-3.5' />
            <div className='space-y-1'>
              <Label htmlFor='override-value' className='text-[11.5px]'>
                Planner override
              </Label>
              <Input
                id='override-value'
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className='mono h-7 text-[12px]'
              />
            </div>
          </div>

          {parameter.observed ? (
            <div className='flex items-center gap-2 text-[11.5px]'>
              <span className='text-muted-foreground'>Observed:</span>
              <Badge variant='outline' className='health-drifted mono h-4 px-1 text-[10px] font-normal'>
                {parameter.observed}
              </Badge>
              {canAdoptObserved ? (
                <Button
                  variant='link'
                  size='sm'
                  className='h-4 px-0 text-[11.5px]'
                  onClick={() => setDraft(String(observedNumber))}
                >
                  use what actually happens
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className='space-y-1'>
            <Label htmlFor='override-reason' className='text-[11.5px]'>
              Reason
            </Label>
            <Textarea
              id='override-reason'
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder='Expected demand increase, supplier performance, seasonal build…'
              className='min-h-[52px] text-[12px]'
            />
          </div>

          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              className='h-7 gap-1.5 text-[12px]'
              disabled={!isValid || unchanged || isPreviewing}
              onClick={() => onPreview(parsed)}
            >
              {isPreviewing ? <Loader2 className='size-3 animate-spin' /> : null}
              Weigh this change
            </Button>
            {preview ? (
              <span className='text-muted-foreground mono text-[11px]'>
                re-planned in {Math.round(preview.elapsedMs)} ms
              </span>
            ) : null}
          </div>

          {preview ? <PreviewBlock preview={preview} uom={uom} /> : null}
        </div>

        <DialogFooter>
          <Button variant='ghost' size='sm' className='h-7 text-[12px]' onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            size='sm'
            className='h-7 gap-1.5 text-[12px]'
            disabled={!isValid || unchanged || isSaving}
            onClick={() => onApply(parsed, reason)}
          >
            {isSaving ? <Loader2 className='size-3 animate-spin' /> : null}
            Apply override
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewBlock({ preview, uom }: { preview: OverridePreview; uom: string }) {
  const beforeQty = preview.before?.recommendedQty ?? 0;
  const afterQty = preview.after?.recommendedQty ?? 0;

  return (
    <div className='divide-y rounded-[5px] border'>
      <Row label='Recommended order' before={beforeQty} after={afterQty} uom={uom} worse={afterQty > beforeQty} />
      <Row
        label='Net requirement'
        before={preview.before?.netRequirement ?? 0}
        after={preview.after?.netRequirement ?? 0}
        uom={uom}
        worse={(preview.after?.netRequirement ?? 0) > (preview.before?.netRequirement ?? 0)}
      />
      <Row
        label='Lowest balance'
        before={preview.beforeLowestBalance}
        after={preview.afterLowestBalance}
        uom={uom}
        worse={preview.afterLowestBalance < preview.beforeLowestBalance}
      />
      <div className='flex items-baseline justify-between px-2.5 py-1.5 text-[12px]'>
        <span className='text-muted-foreground'>Across the whole plan</span>
        <span className='mono'>
          <span className={cn(preview.exceptionCountDelta > 0 ? 'text-destructive' : 'text-primary')}>
            {preview.exceptionCountDelta > 0 ? '+' : ''}
            {preview.exceptionCountDelta} exceptions
          </span>
          <span className='text-muted-foreground'> · </span>
          <span className={cn(preview.exposureDelta > 0 ? 'text-destructive' : 'text-primary')}>
            {preview.exposureDelta > 0 ? '+' : '−'}
            {formatCurrency(Math.abs(preview.exposureDelta))}
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * One before-and-after line.
 *
 * A row that did not move is rendered flat and grey — colouring an unchanged
 * figure green reads as "this helped", which is precisely the kind of small lie
 * that makes a planner stop believing the rest of the panel.
 */
function Row({
  label,
  before,
  after,
  uom,
  worse,
}: {
  label: string;
  before: number;
  after: number;
  uom: string;
  worse: boolean;
}) {
  const moved = Math.abs(after - before) >= 0.5;

  return (
    <div className='grid grid-cols-[1fr_auto_auto] items-baseline gap-2 px-2.5 py-1.5 text-[12px]'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='mono text-muted-foreground'>
        {formatNumber(before)} {uom}
      </span>
      <span
        className={cn(
          'mono flex items-baseline gap-1',
          moved ? (worse ? 'text-destructive font-semibold' : 'text-primary font-semibold') : 'text-muted-foreground',
        )}
      >
        <ArrowRight className='size-3 self-center' />
        {moved ? (
          <>
            {formatNumber(after)} {uom}
          </>
        ) : (
          'unchanged'
        )}
      </span>
    </div>
  );
}
