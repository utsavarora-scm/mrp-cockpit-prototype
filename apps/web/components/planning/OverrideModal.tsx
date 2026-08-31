'use client';

/**
 * Override — change a planning parameter and watch the plan move.
 *
 * The demo beat this serves is short and specific: a planner disagrees with a
 * maintained number, types a different one, and the recommendation changes in
 * front of the audience. So the modal is built around **weighing before
 * committing**. Typing a value runs the plan on a cloned snapshot and shows the
 * before-and-after; nothing is recorded until the planner gives a reason and
 * presses the button.
 *
 * The reason is mandatory, and not for bureaucratic reasons. An override
 * without one is indistinguishable from a mistake three weeks later, and the
 * whole argument of this product is that planning decisions should carry their
 * evidence. The dialog would be dishonest if it made the reason optional.
 *
 * The elapsed milliseconds of the trial run are shown deliberately. On video,
 * "re-planned in 41 ms" is the difference between a mock-up and a system.
 */

import { formatNumber } from '@repo/domain';
import { Button } from '@repo/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/dialog';
import { Input } from '@repo/ui/components/input';
import { Textarea } from '@repo/ui/components/textarea';
import { cn } from '@repo/ui/lib/utils';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import type { OverridePreview } from '@/lib/api-types';

export function OverrideModal({
  itemId,
  plantId,
  field,
  label,
  currentValue,
  uom,
  unit = 'qty',
  trigger,
}: {
  itemId: string;
  plantId: string;
  field: string;
  label: string;
  currentValue: number | null;
  uom: string;
  /** Whether the value is a quantity or a number of days — changes the suffix only. */
  unit?: 'qty' | 'days';
  trigger?: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(currentValue === null ? '' : String(currentValue));
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<OverridePreview | null>(null);

  const parsed = Number(draft);
  const isValid = draft.trim() !== '' && Number.isFinite(parsed);
  const changed = isValid && parsed !== currentValue;

  const endpoint = `/api/items/${encodeURIComponent(itemId)}/${encodeURIComponent(plantId)}/mutate`;

  const weigh = useMutation({
    mutationFn: async (): Promise<OverridePreview> => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field, value: parsed, preview: true }),
      });
      if (!response.ok) throw new Error('That value could not be weighed.');
      return response.json();
    },
    onSuccess: setPreview,
    onError: () => toast.error('That value could not be weighed.'),
  });

  const commit = useMutation({
    mutationFn: async (): Promise<unknown> => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field, value: parsed, reason }),
      });
      if (!response.ok) throw new Error('That change could not be applied.');
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      toast.success(`${label} changed`, { description: 'The plan has been re-run on the new value.' });
      close();
    },
    onError: () => toast.error('That change could not be applied.'),
  });

  const close = (): void => {
    setOpen(false);
    setPreview(null);
    setReason('');
    setDraft(currentValue === null ? '' : String(currentValue));
  };

  const suffix = unit === 'days' ? 'days' : uom;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant='outline' size='sm' className='h-8 text-[13px]'>
            Change
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className='sm:max-w-[560px]'>
        <DialogHeader>
          <DialogTitle className='text-[15px] font-semibold'>Change {label.toLowerCase()}</DialogTitle>
          <DialogDescription className='text-[13px]'>
            The plan re-runs on the new value before anything is recorded. Nothing is written back to SAP.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-5 py-1'>
          <div className='flex items-end gap-4'>
            <div>
              <p className='text-muted-foreground text-[12px] font-medium'>Maintained today</p>
              <p className='mt-1 text-[22px] font-semibold tabular-nums'>
                {currentValue === null ? '—' : formatNumber(currentValue)}
                <span className='text-muted-foreground ml-1.5 text-[13px] font-normal'>{suffix}</span>
              </p>
            </div>
            <ArrowRight className='text-muted-foreground mb-2 size-4' />
            <div className='flex-1'>
              <label htmlFor='override-value' className='text-muted-foreground text-[12px] font-medium'>
                Change to
              </label>
              <Input
                id='override-value'
                value={draft}
                inputMode='decimal'
                onChange={(event) => {
                  setDraft(event.target.value);
                  setPreview(null);
                }}
                className='mt-1 h-10 text-[15px] tabular-nums'
              />
            </div>
            <Button
              variant='secondary'
              className='mb-px h-10 text-[13px]'
              disabled={!changed || weigh.isPending}
              onClick={() => weigh.mutate()}
            >
              {weigh.isPending ? 'Weighing…' : 'Weigh it'}
            </Button>
          </div>

          {preview ? <Weighed preview={preview} uom={uom} /> : null}

          <div>
            <label htmlFor='override-reason' className='text-muted-foreground text-[12px] font-medium'>
              Why
            </label>
            <Textarea
              id='override-reason'
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder='e.g. supplier confirmed a shorter transit on the last four shipments'
              className='mt-1 text-[13px]'
            />
            <p className='text-muted-foreground mt-1 text-[12px]'>
              Recorded against the change. An override nobody can explain later is indistinguishable from a mistake.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant='ghost' className='text-[13px]' onClick={close}>
            Cancel
          </Button>
          <Button
            className='text-[13px]'
            disabled={!changed || reason.trim().length === 0 || commit.isPending}
            onClick={() => commit.mutate()}
          >
            {commit.isPending ? 'Applying…' : 'Apply and re-plan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Weighed({ preview, uom }: { preview: OverridePreview; uom: string }) {
  const beforeQty = preview.before?.recommendedQty ?? 0;
  const afterQty = preview.after?.recommendedQty ?? 0;

  return (
    <div className='bg-surface-sunken rounded-md border p-4'>
      <div className='mb-3 flex items-baseline justify-between'>
        <span className='text-muted-foreground text-[12px] font-semibold tracking-[0.04em] uppercase'>
          What changes
        </span>
        <span className='text-muted-foreground text-[12px] tabular-nums'>
          re-planned in {Math.round(preview.elapsedMs)} ms
        </span>
      </div>
      <Delta label='Recommended order' before={beforeQty} after={afterQty} uom={uom} worse={afterQty > beforeQty} />
      <Delta
        label='Worst balance in the horizon'
        before={preview.beforeLowestBalance}
        after={preview.afterLowestBalance}
        uom={uom}
        worse={preview.afterLowestBalance < preview.beforeLowestBalance}
      />
    </div>
  );
}

function Delta({
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
  const same = Math.abs(after - before) < 0.5;
  return (
    <div className='flex items-baseline justify-between gap-4 py-1'>
      <span className='text-muted-foreground text-[13px]'>{label}</span>
      <span className='flex items-baseline gap-2 text-[13px] tabular-nums'>
        <span className='text-muted-foreground'>{formatNumber(before)}</span>
        <ArrowRight className='text-muted-foreground size-3' />
        <span className={cn('font-medium', same ? '' : worse ? 'text-status-critical' : 'text-status-settled')}>
          {formatNumber(after)} <span className='text-muted-foreground font-normal'>{uom}</span>
        </span>
      </span>
    </div>
  );
}
