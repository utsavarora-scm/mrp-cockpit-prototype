'use client';

/**
 * S1 — the planner cockpit.
 *
 * The landing screen and the first beat of the demo: how many exceptions, how
 * much money, and how little of the queue carries most of it.
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import type { CockpitSummary, ExceptionQueryResult } from '@/lib/api-types';
import { EMPTY_FACETS, Facets, type FacetState } from '@/components/cockpit/Facets';
import { ExceptionQueue } from '@/components/cockpit/ExceptionQueue';
import { KpiStrip } from '@/components/cockpit/KpiStrip';
import { PlanningPositionStrip } from '@/components/cockpit/PlanningPositionStrip';
import { ParetoChart } from '@/components/cockpit/ParetoChart';

export default function CockpitPage() {
  const [facetState, setFacetState] = useState<FacetState>(EMPTY_FACETS);

  const summary = useQuery({
    queryKey: ['plan-summary', 'baseline'],
    queryFn: async (): Promise<CockpitSummary> => {
      const response = await fetch('/api/plan?scenario=baseline');
      if (!response.ok) throw new Error('The plan could not be loaded.');
      return response.json();
    },
  });

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ scenario: 'baseline', limit: '400' });
    for (const key of ['plant', 'exceptionClass', 'itemType', 'abcClass', 'plannerCode', 'timeToImpact'] as const) {
      const values = facetState[key];
      if (values.length > 0) params.set(key, values.join(','));
    }
    if (facetState.autoResolvableOnly) params.set('autoResolvableOnly', 'true');
    if (facetState.search) params.set('search', facetState.search);
    return params.toString();
  }, [facetState]);

  const exceptions = useQuery({
    queryKey: ['exceptions', queryString],
    queryFn: async (): Promise<ExceptionQueryResult> => {
      const response = await fetch(`/api/exceptions?${queryString}`);
      if (!response.ok) throw new Error('The exception queue could not be loaded.');
      return response.json();
    },
    placeholderData: (previous) => previous,
  });

  if (summary.isError) {
    return (
      <div className='flex h-96 flex-col items-center justify-center gap-2 text-[13px]'>
        <span className='font-medium'>The plan could not be loaded.</span>
        <span className='text-muted-foreground'>Use Run MRP in the top bar to try again.</span>
      </div>
    );
  }

  return (
    <div className='flex h-[calc(100svh-3rem)] flex-col'>
      <KpiStrip summary={summary.data} />
      <PlanningPositionStrip summary={summary.data} />
      <ParetoChart summary={summary.data} />
      <div className='flex min-h-0 flex-1'>
        <Facets facets={exceptions.data?.facets} state={facetState} onChange={setFacetState} />
        <div className='flex min-w-0 flex-1 flex-col'>
          <ExceptionQueue data={exceptions.data} isLoading={exceptions.isLoading} />
        </div>
      </div>
    </div>
  );
}
