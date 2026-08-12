/**
 * An honest placeholder.
 *
 * Not a 404 and not a fake screen. A dead click in front of this audience is
 * worse than a missing feature, but so is a screen that pretends to work — this
 * says exactly what will be here, what it will read from, and that the data
 * behind it already exists.
 */

import { Button } from '@repo/ui/components/button';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export function NotBuiltYet({
  title,
  purpose,
  willShow,
  dataReady,
}: {
  title: string;
  purpose: string;
  willShow: string[];
  dataReady: string;
}) {
  return (
    <div className='mx-auto max-w-2xl px-4 py-10'>
      <div className='rounded-md border p-5'>
        <div className='text-muted-foreground text-[11px] font-medium tracking-wide uppercase'>Next build pass</div>
        <h1 className='mt-1 text-[16px] font-semibold'>{title}</h1>
        <p className='text-muted-foreground mt-1.5 text-[13px] leading-[19px]'>{purpose}</p>

        <div className='mt-4'>
          <div className='text-[11px] font-medium tracking-wide uppercase'>What goes here</div>
          <ul className='mt-1.5 space-y-1'>
            {willShow.map((entry) => (
              <li key={entry} className='text-muted-foreground flex gap-2 text-[12.5px] leading-[18px]'>
                <span className='text-primary mt-[7px] size-1 shrink-0 rounded-full bg-current' />
                {entry}
              </li>
            ))}
          </ul>
        </div>

        <div className='bg-muted/40 mt-4 rounded-[5px] border px-3 py-2'>
          <div className='text-[11px] font-medium tracking-wide uppercase'>Already computed</div>
          <p className='text-muted-foreground mt-1 text-[12.5px] leading-[18px]'>{dataReady}</p>
        </div>

        <Button asChild variant='outline' size='sm' className='mt-4 gap-1.5'>
          <Link href='/'>
            <ArrowLeft className='size-3.5' />
            Back to the cockpit
          </Link>
        </Button>
      </div>
    </div>
  );
}
