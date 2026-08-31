'use client';

/**
 * The batch propose flow.
 *
 * Two steps, deliberately. Step one lists every change with its money attached,
 * because approving eleven norms at once should still show eleven decisions.
 * Step two shows the **exact payload** that would go to SAP, labelled *Preview
 * — nothing was sent*.
 *
 * That label is not decoration. The first question from anyone in IT is whether
 * this thing writes to the system of record, and answering it before it is
 * asked — on screen, in the demo, unprompted — costs one line and removes the
 * objection. Saying it out loud is the point.
 */

import { formatCurrency } from '@repo/domain';
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
import { cn } from '@repo/ui/lib/utils';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import type { NormRow } from '@/lib/api-types';

type Step = 'REVIEW' | 'PAYLOAD';

export function ProposeDialog({ rows, onProposed }: { rows: NormRow[]; onProposed: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('REVIEW');

  const totalImpact = rows.reduce((sum, row) => sum + Math.abs(row.valueImpact), 0);

  const close = (): void => {
    setOpen(false);
    setStep('REVIEW');
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogTrigger asChild>
        <Button disabled={rows.length === 0} className='h-9 text-[13px]'>
          Propose {rows.length > 0 ? `${rows.length} change${rows.length === 1 ? '' : 's'}` : 'selected'}
        </Button>
      </DialogTrigger>

      <DialogContent className='max-h-[80vh] overflow-y-auto sm:max-w-[720px]'>
        <DialogHeader>
          <DialogTitle className='text-[15px] font-semibold'>
            {step === 'REVIEW' ? 'Review the proposed norms' : 'What would be sent'}
          </DialogTitle>
          <DialogDescription className='text-[13px]'>
            {step === 'REVIEW' ? (
              <>
                {rows.length} material{rows.length === 1 ? '' : 's'} ·{' '}
                <span className='text-foreground font-medium'>{formatCurrency(totalImpact)}</span> of capital and
                exposure between them.
              </>
            ) : (
              'The exact payload, as the interface would carry it.'
            )}
          </DialogDescription>
        </DialogHeader>

        {step === 'REVIEW' ? (
          <table className='w-full'>
            <thead>
              <tr className='bg-surface-sunken'>
                <Th>Material</Th>
                <Th align='right'>Stock days</Th>
                <Th align='right'>Order days</Th>
                <Th align='right'>Impact</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.itemId}@${row.plantId}`} className='border-border/50 border-b last:border-0'>
                  <td className='py-2.5 font-mono text-[12px]'>
                    {row.itemId}
                    <span className='text-muted-foreground'> · {row.plantId}</span>
                  </td>
                  <td className='py-2.5 text-right text-[13px] tabular-nums'>
                    <span className='text-muted-foreground'>{row.maintainedStockDays ?? '—'}</span>
                    <ArrowRight className='text-muted-foreground mx-1 inline size-3' />
                    <span className='font-medium'>{row.recommendedStockDays.toFixed(0)}</span>
                  </td>
                  <td className='py-2.5 text-right text-[13px] tabular-nums'>
                    <span className='text-muted-foreground'>{row.maintainedOrderDays ?? '—'}</span>
                    <ArrowRight className='text-muted-foreground mx-1 inline size-3' />
                    <span className='font-medium'>{row.recommendedOrderDays.toFixed(0)}</span>
                  </td>
                  <td
                    className={cn(
                      'py-2.5 text-right text-[13px] font-medium tabular-nums',
                      row.direction === 'EXCESS' ? 'text-status-attention' : 'text-status-critical',
                    )}
                  >
                    {formatCurrency(Math.abs(row.valueImpact))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div>
            <div className='bg-status-settled/10 text-status-settled mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium'>
              <ShieldCheck className='size-4 shrink-0' />
              Preview — nothing was sent.
            </div>
            <pre className='bg-surface-sunken max-h-[320px] overflow-auto rounded-md border p-4 font-mono text-[11px] leading-relaxed'>
              {JSON.stringify(payloadFor(rows), null, 2)}
            </pre>
            <p className='text-muted-foreground mt-3 text-[12px] leading-relaxed'>
              SAP remains the system of record. This prototype computes and proposes; applying a change is a
              person&rsquo;s decision made in SAP, and no credential in this build could write it even if one tried.
            </p>
          </div>
        )}

        <DialogFooter>
          {step === 'REVIEW' ? (
            <>
              <Button variant='ghost' className='text-[13px]' onClick={close}>
                Cancel
              </Button>
              <Button className='text-[13px]' onClick={() => setStep('PAYLOAD')}>
                Continue
              </Button>
            </>
          ) : (
            <>
              <Button variant='ghost' className='text-[13px]' onClick={() => setStep('REVIEW')}>
                Back
              </Button>
              <Button
                className='text-[13px]'
                onClick={() => {
                  toast.success(`${rows.length} norm${rows.length === 1 ? '' : 's'} marked as proposed`, {
                    description: 'Recorded here only — nothing was sent to SAP.',
                  });
                  onProposed();
                  close();
                }}
              >
                Mark as proposed
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The write-back payload.
 *
 * One `SET_ITEM_PLANT_PARAM` per changed field, carrying before and after and
 * the evidence count behind it — the shape a real interface would take, so the
 * conversation about building it can start from something concrete.
 */
function payloadFor(rows: NormRow[]): unknown {
  return {
    type: 'SET_ITEM_PLANT_PARAM',
    source: 'planning-cockpit',
    changes: rows.flatMap((row) => [
      {
        itemId: row.itemId,
        plantId: row.plantId,
        field: 'maintainedStockDays',
        from: row.maintainedStockDays,
        to: Number(row.recommendedStockDays.toFixed(1)),
        evidence: { receipts: row.observations.length, unmatched: row.unmatchedCount },
      },
      {
        itemId: row.itemId,
        plantId: row.plantId,
        field: 'maintainedOrderDays',
        from: row.maintainedOrderDays,
        to: Number(row.recommendedOrderDays.toFixed(1)),
        evidence: { receipts: row.observations.length, unmatched: row.unmatchedCount },
      },
    ]),
    summary: {
      materials: rows.length,
      excessCapitalReleased: rows.reduce((sum, row) => sum + Math.max(0, row.valueImpact), 0),
      exposureClosed: rows.reduce((sum, row) => sum + Math.max(0, -row.valueImpact), 0),
    },
  };
}

function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={cn(
        'text-muted-foreground px-0 py-2 text-[11px] font-medium tracking-[0.04em] uppercase',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}
