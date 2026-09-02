'use client';

/**
 * Recording what happened to a delivery line.
 *
 * The quiet half of the schedule feature, and the one Phase 2 depends on
 * entirely. Vendor committed date and dispatch date exist in no system at GCPL
 * today — the planner records them after the call they were already making, and
 * that is enough to build the dataset from which a lead time can be measured
 * rather than remembered.
 *
 * The form separates the two kinds of date on purpose. The **promise** is what
 * the vendor said they would deliver on; the **lifecycle** is what actually
 * happened, in order. Only the second is a chain, and only the second is
 * validated as one — a vendor can promise a date earlier than they acknowledge
 * on, and a form that called that an error would teach planners to lie to it.
 */

import { REASON_CODES } from '@repo/domain';
import { Button } from '@repo/ui/components/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@repo/ui/components/dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

export interface CaptureTarget {
  itemId: string;
  plantId: string;
  orderId: string;
  line: number;
  baseUom: string;
  requestedDate: string;
  confirmedDate: string | null;
  acknowledgedOn?: string | null;
  dispatchedOn?: string | null;
  grnDate: string | null;
  grnQty: number | null;
  qaReleasedOn: string | null;
  reasonCode: string | null;
}

export function CaptureDialog({ target, onClose }: { target: CaptureTarget; onClose: () => void }) {
  const queryClient = useQueryClient();

  const [confirmedDate, setConfirmedDate] = useState(target.confirmedDate ?? '');
  const [acknowledgedOn, setAcknowledgedOn] = useState(target.acknowledgedOn ?? '');
  const [dispatchedOn, setDispatchedOn] = useState(target.dispatchedOn ?? '');
  const [grnDate, setGrnDate] = useState(target.grnDate ?? '');
  const [grnQty, setGrnQty] = useState(target.grnQty === null ? '' : String(target.grnQty));
  const [qaReleasedOn, setQaReleasedOn] = useState(target.qaReleasedOn ?? '');
  const [reasonCode, setReasonCode] = useState<string>(target.reasonCode ?? REASON_CODES[0]?.code ?? '');
  const [note, setNote] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/adherence', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          itemId: target.itemId,
          plantId: target.plantId,
          orderId: target.orderId,
          line: target.line,
          confirmedDate: confirmedDate || null,
          acknowledgedOn: acknowledgedOn || null,
          dispatchedOn: dispatchedOn || null,
          grnDate: grnDate || null,
          grnQty: grnQty === '' ? null : Number(grnQty),
          qaReleasedOn: qaReleasedOn || null,
          reasonCode,
          note,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'That record was not saved.');
      return json;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      toast.success('Recorded', {
        description:
          grnDate && qaReleasedOn
            ? 'The measured lead time has moved. Recorded permanently — it survives a restart.'
            : 'Recorded. The measured lead time moves once the receipt has cleared quality.',
      });
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const qtyValid = grnQty === '' || (Number.isFinite(Number(grnQty)) && Number(grnQty) >= 0);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className='sm:max-w-[560px]'>
        <DialogHeader>
          <DialogTitle className='text-[15px]'>
            {target.orderId} · line {target.line}
          </DialogTitle>
        </DialogHeader>

        <p className='text-muted-foreground text-[12px]'>
          {target.itemId} at {target.plantId}, requested for {target.requestedDate}. Fill in what you know; the rest can
          wait for the next call.
        </p>

        <p className='text-muted-foreground mt-3 text-[11px] font-medium tracking-[0.03em] uppercase'>The promise</p>
        <DateField label='Vendor committed delivery date' value={confirmedDate} onChange={setConfirmedDate} />

        <p className='text-muted-foreground mt-4 text-[11px] font-medium tracking-[0.03em] uppercase'>
          What actually happened
        </p>
        <div className='grid grid-cols-2 gap-3'>
          <DateField label='Acknowledged' value={acknowledgedOn} onChange={setAcknowledgedOn} />
          <DateField label='Dispatched' value={dispatchedOn} onChange={setDispatchedOn} />
          <DateField label='Goods receipt' value={grnDate} onChange={setGrnDate} />
          <label className='block'>
            <span className='text-muted-foreground mb-1 block text-[12px]'>Received quantity ({target.baseUom})</span>
            <input
              value={grnQty}
              onChange={(event) => setGrnQty(event.target.value)}
              inputMode='numeric'
              aria-invalid={!qtyValid}
              className='border-input bg-background aria-[invalid=true]:border-destructive h-9 w-full rounded-md border px-2 text-[13px] tabular-nums'
            />
          </label>
          <DateField label='Quality released — available' value={qaReleasedOn} onChange={setQaReleasedOn} />
        </div>

        <label className='mt-4 block'>
          <span className='text-muted-foreground mb-1 block text-[12px]'>Reason code (required)</span>
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

        <p className='text-muted-foreground mt-3 text-[11px] leading-snug'>
          A deviation with no reason is a number; a deviation with a reason is a pattern. The code is what later lets a
          genuine one-off — a port strike, a plant shutdown — be excluded from a lead-time calculation without anyone
          quietly deleting inconvenient data.
        </p>

        <div className='mt-4 flex justify-end gap-2'>
          <Button variant='ghost' size='sm' className='h-8 text-[13px]' onClick={onClose}>
            Cancel
          </Button>
          <Button
            size='sm'
            className='h-8 text-[13px]'
            disabled={save.isPending || !qtyValid}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Recording…' : 'Record'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className='block'>
      <span className='text-muted-foreground mb-1 block text-[12px]'>{label}</span>
      <input
        type='date'
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className='border-input bg-background h-9 w-full rounded-md border px-2 text-[13px]'
      />
    </label>
  );
}
