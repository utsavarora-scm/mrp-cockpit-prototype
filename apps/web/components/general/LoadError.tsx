'use client';

/**
 * What a screen shows when its request fails.
 *
 * A skeleton that never resolves reads as a plan that is still thinking, and a
 * planner who waits on it long enough concludes the numbers are unreliable
 * rather than that one request fell over. Saying so, with a way to try again,
 * keeps those two apart.
 */

import { Button } from '@repo/ui/components/button';
import { cn } from '@repo/ui/lib/utils';
import { RotateCcw } from 'lucide-react';
import Link from 'next/link';

export function LoadError({
  message,
  detail,
  onRetry,
  retrying = false,
  back,
  compact = false,
}: {
  message: string;
  detail?: string;
  onRetry: () => void;
  retrying?: boolean;
  back?: { href: string; label: string };
  /** Inline, inside a panel, rather than as the whole screen. */
  compact?: boolean;
}) {
  return (
    <div role='alert' className={cn(compact ? 'px-6 py-8' : 'bg-card rounded-lg border p-8')}>
      <p className='text-[14px] font-medium'>{message}</p>
      <p className='text-muted-foreground mt-1 text-[13px]'>
        {detail ?? 'The request failed. Nothing you recorded has been lost.'}
      </p>
      <div className='mt-4 flex items-center gap-4'>
        <Button variant='outline' size='sm' className='h-8 gap-1.5 text-[13px]' onClick={onRetry} disabled={retrying}>
          <RotateCcw className='size-3.5' />
          {retrying ? 'Retrying…' : 'Try again'}
        </Button>
        {back ? (
          <Link href={back.href} className='text-primary text-[13px] font-medium hover:underline'>
            {back.label}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
