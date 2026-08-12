'use client';

/**
 * The writeback preview.
 *
 * The exact payloads that would be sent, with the real entity sets and field
 * names, and a banner saying plainly that nothing was contacted. Being explicit
 * about that buys more credibility with an IT-adjacent audience than any amount
 * of architecture diagram, and it pre-empts the question outright.
 */

import { Badge } from '@repo/ui/components/badge';
import { Button } from '@repo/ui/components/button';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

import type { SimulationDiff } from '@/lib/api-types';

export function WritebackPreview({
  writebacks,
  onBack,
}: {
  writebacks: SimulationDiff['writebacks'];
  onBack: () => void;
}) {
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='bg-muted/40 sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-1.5'>
        <Button variant='ghost' size='sm' className='h-6 gap-1 px-1.5 text-[11.5px]' onClick={onBack}>
          <ArrowLeft className='size-3.5' />
          Back
        </Button>
        <span className='text-[11px] font-medium tracking-wide uppercase'>Writeback preview</span>
      </div>

      <div className='border-primary/30 bg-primary/8 flex items-start gap-2 border-b px-3 py-2'>
        <ShieldCheck className='text-primary mt-px size-4 shrink-0' />
        <div className='text-[12px] leading-[17px]'>
          <span className='font-semibold'>Preview — no system was contacted.</span>{' '}
          <span className='text-muted-foreground'>
            These are the payloads that would be sent. The adapter layer has no HTTP client in it; every write here is
            staged, and the Kinaxis one lands in a named scenario rather than the live plan.
          </span>
        </div>
      </div>

      {writebacks.length === 0 ? (
        <p className='text-muted-foreground px-3 py-3 text-[12.5px]'>
          This resolution changes the plan without writing to any system of record — there is nothing to send.
        </p>
      ) : (
        <div className='min-h-0 flex-1 divide-y overflow-auto'>
          {writebacks.map((payload, index) => (
            <div key={`${payload.system}-${index}`} className='px-3 py-2.5'>
              <div className='flex items-center gap-2'>
                <Badge variant='outline' className='mono h-4 px-1 text-[10px]'>
                  {payload.system}
                </Badge>
                <span className='mono text-primary text-[11px] font-semibold'>{payload.method}</span>
              </div>
              <div className='mono text-muted-foreground mt-1 break-all text-[11px]'>{payload.endpoint}</div>
              <p className='mt-1 text-[12px]'>{payload.description}</p>
              <pre className='bg-muted/50 mono mt-1.5 max-h-64 overflow-auto rounded-[4px] border p-2 text-[11px] leading-[16px]'>
                {JSON.stringify(payload.body, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
