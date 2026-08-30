'use client';

/**
 * Planning Cockpit — placeholder.
 *
 * The v1 exception queue that stood here has been removed. The real cockpit —
 * the excess ↔ exposure hero, gap attribution and the needs-attention table —
 * is built in Checkpoint C2, on top of the norms engine that computes those two
 * figures. Until then this screen states what it will hold rather than
 * pretending to hold it.
 */

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import type { CockpitSummary } from '@/lib/api-types';

export default function CockpitPage() {
  const summary = useQuery({
    queryKey: ['plan-summary', 'baseline'],
    queryFn: async (): Promise<CockpitSummary> => {
      const response = await fetch('/api/plan?scenario=baseline');
      if (!response.ok) throw new Error('The plan could not be loaded.');
      return response.json();
    },
  });

  const position = summary.data?.planningPosition;

  return (
    <div className='mx-auto max-w-[1600px] px-8 py-10'>
      <h1 className='text-[15px] font-semibold tracking-[0.04em] uppercase'>Planning Cockpit</h1>
      <p className='text-muted-foreground mt-2 max-w-[62ch] text-[14px]'>
        The cockpit is rebuilt in Checkpoint C2, once the norms engine can compute the two figures it leads with: excess
        capital and unprotected exposure.
      </p>

      <dl className='mt-8 grid max-w-[720px] grid-cols-3 gap-6'>
        {[
          { label: 'Materials planned', value: position?.mrpMaterials },
          { label: 'At risk', value: position?.atRisk },
          { label: 'Open orders', value: position?.openPos },
        ].map((tile) => (
          <div key={tile.label}>
            <dt className='text-muted-foreground text-[12px] font-medium'>{tile.label}</dt>
            <dd className='mt-1 text-[32px] font-semibold tabular-nums'>
              {tile.value === undefined ? '—' : tile.value.toLocaleString('en-IN')}
            </dd>
          </div>
        ))}
      </dl>

      <Link href='/item' className='text-primary mt-8 inline-block text-[14px] font-medium hover:underline'>
        Open materials →
      </Link>
    </div>
  );
}
