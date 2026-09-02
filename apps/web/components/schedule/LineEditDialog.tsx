'use client';

/**
 * One line, edited, with a reason.
 *
 * The same form serves both halves of the screen because they are the same act
 * with different subjects: moving a delivery on an order that exists, and
 * setting a quantity on one the plan is still proposing. Both change what a
 * vendor will be asked for, and neither is allowed to happen without a reason —
 * a deviation with no reason is a number, and a deviation with a reason is a
 * pattern.
 */

import { formatDateFull, formatNumber, REASON_CODES } from '@repo/domain';
import { Button } from '@repo/ui/components/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@repo/ui/components/dialog';
import { useState, type ReactNode } from 'react';

export interface LineEditSubmission {
  qty: number | null;
  date?: string;
  reasonCode: string;
  note: string;
}

export function LineEditDialog({
  title,
  standfirst,
  uom,
  initialQty,
  initialDate,
  defaultReason,
  allowClear,
  footnote,
  pending,
  onSubmit,
  onClose,
}: {
  title: string;
  standfirst: ReactNode;
  uom: string;
  initialQty: number;
  /** Present only where the date is the planner's to move. */
  initialDate?: string;
  defaultReason: string;
  /** True on a proposed line, where clearing hands it back to the engine. */
  allowClear: boolean;
  footnote: ReactNode;
  pending: boolean;
  onSubmit: (submission: LineEditSubmission) => void;
  onClose: () => void;
}) {
  const [qty, setQty] = useState(String(initialQty));
  const [date, setDate] = useState(initialDate ?? '');
  const [reasonCode, setReasonCode] = useState(defaultReason);
  const [note, setNote] = useState('');

  const parsed = Number(qty);
  const qtyValid = qty.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className='sm:max-w-[520px]'>
        <DialogHeader>
          <DialogTitle className='text-[15px]'>{title}</DialogTitle>
        </DialogHeader>

        <p className='text-muted-foreground text-[12px]'>{standfirst}</p>

        <div className={initialDate ? 'mt-3 grid grid-cols-2 gap-3' : 'mt-3'}>
          <label className='block'>
            <span className='text-muted-foreground mb-1 block text-[12px]'>Quantity ({uom})</span>
            <input
              value={qty}
              onChange={(event) => setQty(event.target.value)}
              inputMode='numeric'
              aria-invalid={!qtyValid}
              className='border-input bg-background aria-[invalid=true]:border-destructive h-9 w-full rounded-md border px-2 text-[13px] tabular-nums'
            />
            {!qtyValid ? (
              <span className='text-destructive mt-1 block text-[11px]'>
                A quantity is a number, and never a negative one.
              </span>
            ) : null}
          </label>

          {initialDate ? (
            <label className='block'>
              <span className='text-muted-foreground mb-1 block text-[12px]'>Requested delivery date</span>
              <input
                type='date'
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className='border-input bg-background h-9 w-full rounded-md border px-2 text-[13px]'
              />
            </label>
          ) : null}
        </div>

        <label className='mt-3 block'>
          <span className='text-muted-foreground mb-1 block text-[12px]'>Reason (required)</span>
          <select
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value)}
            className='border-input bg-background h-9 w-full rounded-md border px-2 text-[13px]'
          >
            {REASON_CODES.map((row) => (
              <option key={row.code} value={row.code}>
                {row.label}
              </option>
            ))}
          </select>
        </label>

        <label className='mt-3 block'>
          <span className='text-muted-foreground mb-1 block text-[12px]'>Note</span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder='What the vendor said, in ten seconds'
            className='border-input bg-background h-9 w-full rounded-md border px-2 text-[13px]'
          />
        </label>

        <p className='text-muted-foreground mt-3 text-[11px] leading-snug'>{footnote}</p>

        <div className='mt-4 flex justify-between gap-2'>
          {allowClear ? (
            <Button
              variant='ghost'
              size='sm'
              className='h-8 text-[13px]'
              disabled={pending}
              onClick={() => onSubmit({ qty: null, reasonCode, note })}
            >
              Hand back to the engine
            </Button>
          ) : (
            <span />
          )}
          <span className='flex gap-2'>
            <Button variant='ghost' size='sm' className='h-8 text-[13px]' onClick={onClose}>
              Cancel
            </Button>
            <Button
              size='sm'
              className='h-8 text-[13px]'
              disabled={pending || !qtyValid}
              onClick={() => onSubmit({ qty: parsed, date: date || undefined, reasonCode, note })}
            >
              {pending ? 'Saving…' : 'Record the change'}
            </Button>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** `1,150 MT on 14 September` — how a line is named in prose. */
export function lineSummary(qty: number, uom: string, date: string): string {
  return `${formatNumber(qty)} ${uom} on ${formatDateFull(date)}`;
}
