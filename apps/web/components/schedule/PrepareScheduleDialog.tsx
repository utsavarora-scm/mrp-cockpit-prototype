'use client';

/**
 * Preparing the schedule a planner would send.
 *
 * "Prepare", not "send": no network call is made anywhere in this prototype,
 * and a button that claims otherwise is a promise the product cannot keep. What
 * this produces is the payload — purchase order, line, quantity, requested
 * delivery date, ship-from, ship-to, and the reason for each change.
 *
 * Two gates, and they are different. A **blocking violation** cannot be
 * acknowledged away: a schedule that cannot name the constraint behind a moved
 * unit is not a schedule. An **advisory** can: the packaging hero's own answer
 * ends 20,000 short of its buffer, and a planner may send that with their eyes
 * open — with a reason, recorded.
 */

import { formatNumber, REASON_CODES } from '@repo/domain';
import { Button } from '@repo/ui/components/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@repo/ui/components/dialog';
import { useState } from 'react';

import type { SchedulePayloadView, ScheduleBuilderView } from '@/lib/api-types';

export function PrepareScheduleDialog({
  view,
  pending,
  payload,
  onPrepare,
  onClose,
}: {
  view: ScheduleBuilderView;
  pending: boolean;
  payload: SchedulePayloadView | null;
  onPrepare: (input: { acknowledge: boolean; reasonCode: string | null; note: string }) => void;
  onClose: () => void;
}) {
  const [acknowledge, setAcknowledge] = useState(false);
  const [reasonCode, setReasonCode] = useState<string>(REASON_CODES[0]?.code ?? '');
  const [note, setNote] = useState('');

  const blocked = view.blockingViolations.length > 0;
  const needsAcknowledgement = view.advisories.length > 0;
  const ready = !blocked && (!needsAcknowledgement || acknowledge);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className='sm:max-w-[620px]'>
        <DialogHeader>
          <DialogTitle className='text-[15px]'>
            {payload ? 'Schedule prepared' : `Prepare the schedule — ${view.itemId}`}
          </DialogTitle>
        </DialogHeader>

        {payload ? (
          <PreparedPayload payload={payload} uom={view.baseUom} />
        ) : (
          <>
            {blocked ? (
              <div className='border-status-critical/40 bg-status-critical/[0.05] mt-1 rounded-md border px-3 py-2.5'>
                <p className='text-status-critical text-[12px] font-medium'>
                  {view.blockingViolations.length} thing{view.blockingViolations.length === 1 ? '' : 's'} to fix first
                </p>
                <ul className='mt-1.5 space-y-1'>
                  {view.blockingViolations.map((violation, index) => (
                    <li key={index} className='text-[12px] leading-snug'>
                      {violation.line !== null ? `Line ${violation.line}: ` : ''}
                      {violation.message}
                    </li>
                  ))}
                </ul>
                <p className='text-muted-foreground mt-2 text-[11px] leading-snug'>
                  These cannot be acknowledged away. A schedule that cannot say why a unit moved is one nobody can
                  check.
                </p>
              </div>
            ) : null}

            {needsAcknowledgement ? (
              <div className='border-status-attention/40 bg-status-attention/[0.05] mt-3 rounded-md border px-3 py-2.5'>
                <p className='text-[12px] font-medium'>What you would be sending with your eyes open</p>
                <ul className='mt-1.5 space-y-1'>
                  {view.advisories.map((advisory, index) => (
                    <li key={index} className='text-[12px] leading-snug'>
                      {advisory.message}
                    </li>
                  ))}
                </ul>
                <label className='mt-2.5 flex items-start gap-2 text-[12px]'>
                  <input
                    type='checkbox'
                    checked={acknowledge}
                    onChange={(event) => setAcknowledge(event.target.checked)}
                    className='mt-0.5'
                  />
                  <span>I accept these and want to prepare the schedule anyway.</span>
                </label>
              </div>
            ) : null}

            {needsAcknowledgement ? (
              <>
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
                    placeholder='Why this exposure is acceptable'
                    className='border-input bg-background h-9 w-full rounded-md border px-2 text-[13px]'
                  />
                </label>
              </>
            ) : null}

            <p className='text-muted-foreground mt-3 text-[11px] leading-snug'>
              Nothing is transmitted. This produces the payload that would be sent, and records the decision against the
              material.
            </p>
          </>
        )}

        <div className='mt-4 flex justify-end gap-2'>
          <Button variant='ghost' size='sm' className='h-8 text-[13px]' onClick={onClose}>
            {payload ? 'Close' : 'Cancel'}
          </Button>
          {payload ? null : (
            <Button
              size='sm'
              className='h-8 text-[13px]'
              disabled={pending || !ready}
              onClick={() =>
                onPrepare({
                  acknowledge,
                  reasonCode: needsAcknowledgement ? reasonCode : null,
                  note,
                })
              }
            >
              {pending ? 'Preparing…' : 'Prepare'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreparedPayload({ payload, uom }: { payload: SchedulePayloadView; uom: string }) {
  return (
    <div className='mt-1'>
      <p className='text-muted-foreground text-[12px]'>
        {payload.description} · ship from {payload.shipFrom ?? 'no approved source'} · ship to {payload.shipTo}
      </p>

      <div className='mt-3 overflow-x-auto rounded-md border'>
        <table className='w-full'>
          <thead>
            <tr className='bg-surface-sunken border-b'>
              <th className='grid-head text-left'>Line</th>
              <th className='grid-head text-right'>Quantity</th>
              <th className='grid-head text-left'>Requested</th>
              <th className='grid-head text-left'>Dispatch by</th>
              <th className='grid-head text-left'>Change</th>
            </tr>
          </thead>
          <tbody>
            {payload.lines.map((line) => (
              <tr key={line.line} className='grid-row'>
                <td className='grid-cell num'>{line.line}</td>
                <td className='grid-cell num'>
                  {formatNumber(line.qty)} {uom}
                </td>
                <td className='grid-cell text-[12px]'>{line.requestedDeliveryDate}</td>
                <td className='text-muted-foreground grid-cell text-[12px]'>{line.dispatchBy}</td>
                <td className='text-muted-foreground grid-cell text-[11px]'>{line.changeFromPrevious ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {payload.acknowledged.length > 0 ? (
        <p className='text-muted-foreground mt-3 text-[11px] leading-snug'>
          Sent with {payload.acknowledged.length} acknowledged finding
          {payload.acknowledged.length === 1 ? '' : 's'}, recorded against {payload.reasonCode}.
        </p>
      ) : null}
    </div>
  );
}
