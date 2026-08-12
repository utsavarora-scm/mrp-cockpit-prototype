'use client';

/**
 * Facets.
 *
 * Counts are computed against every other active filter but not against the
 * facet's own dimension, so selecting one site does not make every other site
 * read zero — which is the behaviour that makes faceted filtering usable rather
 * than merely present.
 */

import { formatNumber } from '@repo/domain';
import { Button } from '@repo/ui/components/button';
import { Checkbox } from '@repo/ui/components/checkbox';
import { Input } from '@repo/ui/components/input';
import { Label } from '@repo/ui/components/label';
import { ScrollArea } from '@repo/ui/components/scroll-area';
import { Switch } from '@repo/ui/components/switch';
import { Search, X } from 'lucide-react';

import type { ExceptionQueryResult, FacetOption } from '@/lib/api-types';

export interface FacetState {
  plant: string[];
  exceptionClass: string[];
  itemType: string[];
  abcClass: string[];
  plannerCode: string[];
  timeToImpact: string[];
  autoResolvableOnly: boolean;
  search: string;
}

export const EMPTY_FACETS: FacetState = {
  plant: [],
  exceptionClass: [],
  itemType: [],
  abcClass: [],
  plannerCode: [],
  timeToImpact: [],
  autoResolvableOnly: false,
  search: '',
};

type MultiKey = 'plant' | 'exceptionClass' | 'itemType' | 'abcClass' | 'plannerCode' | 'timeToImpact';

const GROUPS: Array<{ key: MultiKey; label: string; facetKey: keyof ExceptionQueryResult['facets'] }> = [
  { key: 'exceptionClass', label: 'Class', facetKey: 'exceptionClass' },
  { key: 'timeToImpact', label: 'Time to impact', facetKey: 'timeToImpact' },
  { key: 'plant', label: 'Site', facetKey: 'plant' },
  { key: 'itemType', label: 'Item type', facetKey: 'itemType' },
  { key: 'abcClass', label: 'ABC', facetKey: 'abcClass' },
  { key: 'plannerCode', label: 'Planner', facetKey: 'plannerCode' },
];

export function Facets({
  facets,
  state,
  onChange,
}: {
  facets: ExceptionQueryResult['facets'] | undefined;
  state: FacetState;
  onChange: (next: FacetState) => void;
}) {
  const activeCount =
    GROUPS.reduce((sum, group) => sum + state[group.key].length, 0) +
    (state.autoResolvableOnly ? 1 : 0) +
    (state.search ? 1 : 0);

  const toggle = (key: MultiKey, value: string) => {
    const current = state[key];
    onChange({
      ...state,
      [key]: current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value],
    });
  };

  return (
    <aside className='flex w-[212px] shrink-0 flex-col border-r'>
      <div className='flex items-center justify-between border-b px-3 py-2'>
        <span className='text-[11px] font-medium tracking-wide uppercase'>Filters</span>
        {activeCount > 0 ? (
          <Button
            variant='ghost'
            size='sm'
            className='h-5 gap-1 px-1.5 text-[11px]'
            onClick={() => onChange(EMPTY_FACETS)}
          >
            <X className='size-3' />
            Clear {activeCount}
          </Button>
        ) : null}
      </div>

      <div className='border-b px-3 py-2'>
        <div className='relative'>
          <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2' />
          <Input
            value={state.search}
            onChange={(event) => onChange({ ...state, search: event.target.value })}
            placeholder='Item, code or site'
            className='h-7 pl-7 text-[12px]'
            aria-label='Search the queue'
          />
        </div>
      </div>

      <div className='flex items-center justify-between border-b px-3 py-2'>
        <Label htmlFor='auto-only' className='text-[12px] font-normal'>
          Auto-resolvable only
        </Label>
        <Switch
          id='auto-only'
          checked={state.autoResolvableOnly}
          onCheckedChange={(checked) => onChange({ ...state, autoResolvableOnly: checked })}
        />
      </div>

      <ScrollArea className='flex-1'>
        <div className='divide-y'>
          {GROUPS.map((group) => {
            const options = facets?.[group.facetKey] ?? [];
            if (options.length === 0) return null;
            return (
              <div key={group.key} className='px-3 py-2'>
                <div className='text-muted-foreground mb-1.5 text-[10.5px] font-medium tracking-wide uppercase'>
                  {group.label}
                </div>
                <div className='space-y-1'>
                  {options.slice(0, 10).map((option: FacetOption) => {
                    const id = `${group.key}-${option.value}`;
                    const checked = state[group.key].includes(option.value);
                    return (
                      <div key={option.value} className='flex items-center gap-2'>
                        <Checkbox
                          id={id}
                          checked={checked}
                          onCheckedChange={() => toggle(group.key, option.value)}
                          className='size-3.5'
                        />
                        <Label htmlFor={id} className='flex-1 cursor-pointer truncate text-[12px] font-normal'>
                          {option.label}
                        </Label>
                        <span className='mono text-muted-foreground text-[11px]'>{formatNumber(option.count)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </aside>
  );
}
