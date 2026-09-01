/**
 * Screen 6 — the exception queue.
 *
 * Grouped by *what the planner would do about them*, not by exception type,
 * because a planner's morning is a sequence of phone calls and not a taxonomy.
 * Within a group they are ranked by consequence — time to breach, quantity and
 * cover at risk, whether ordering can reach it at all — rather than by count or
 * by material code.
 */

import { ACTION_GROUP_LABEL, ACTION_GROUP_NOTE, type ActionGroup } from '@repo/planning-engine';

import type { ExceptionQueueView, ExceptionView } from '../api-types';
import { runContext } from './context';
import { runHeader } from './header';
import { exceptionsFor } from './material';

/** The order the groups appear in — reachability first, data hygiene last. */
const GROUP_ORDER: ActionGroup[] = [
  'CANNOT_ORDER',
  'SWITCH_SOURCE',
  'GET_CONFIRMATION',
  'MOVE_EXISTING_ORDER',
  'ORDER_NOW',
  'REDUCE_COVER',
  'FIX_DATA',
];

export interface ExceptionFilters {
  plant?: string;
  group?: ActionGroup;
  includeDismissed?: boolean;
  limitPerGroup?: number;
}

export function exceptionQueue(scenarioId: string, filters: ExceptionFilters = {}): ExceptionQueueView {
  const context = runContext(scenarioId);
  const all: ExceptionView[] = [];

  for (const facts of context.materials.values()) {
    if (filters.plant && facts.plantId !== filters.plant) continue;
    if (facts.dailyDemandMean <= 0) continue;
    all.push(...exceptionsFor(facts, context));
  }

  const visible = filters.includeDismissed ? all : all.filter((row) => !row.dismissed);

  const groups = GROUP_ORDER.map((group) => {
    const exceptions = visible
      .filter((row) => row.group === group)
      .sort((a, b) => a.daysToBite - b.daysToBite || b.valueAtStake - a.valueAtStake);

    return {
      group,
      label: ACTION_GROUP_LABEL[group],
      note: ACTION_GROUP_NOTE[group],
      count: exceptions.length,
      valueAtStake: exceptions.reduce((sum, row) => sum + row.valueAtStake, 0),
      exceptions: exceptions.slice(0, filters.limitPerGroup ?? 25),
    };
  }).filter((row) => row.count > 0 && (!filters.group || row.group === filters.group));

  return { header: runHeader(context), groups, total: visible.length };
}

/** Every exception, ranked, for the tiles on the planning position. */
export function exceptionCounts(scenarioId: string): Record<ActionGroup, number> {
  const queue = exceptionQueue(scenarioId, { limitPerGroup: 0 });
  const counts = Object.fromEntries(GROUP_ORDER.map((group) => [group, 0])) as Record<ActionGroup, number>;
  for (const group of queue.groups) counts[group.group] = group.count;
  return counts;
}
