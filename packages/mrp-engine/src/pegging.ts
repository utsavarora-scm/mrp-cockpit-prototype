/**
 * Pegging — the graph that answers "who actually cares about this shortage?".
 *
 * Two kinds of edge:
 *   1. FIFO allocation of supply (and opening stock) to demand within an item-plant.
 *   2. `parentSupplyElementId`, set when BOM explosion created dependent demand,
 *      which is what links one level to the next.
 *
 * Following both upward from a raw material reaches the finished goods and then
 * the customer orders behind it. That trace is the blast radius, and it is the
 * one picture none of SAP, Kinaxis or o9 draws.
 */

import {
  type DemandElement,
  planKey,
  type PeggingAllocation,
  type PeggingGraph,
  type SupplyElement,
} from '@repo/domain';

interface PeggingInput {
  demand: DemandElement[];
  supply: SupplyElement[];
  /** planKey → opening unrestricted stock. */
  openingStock: Map<string, number>;
  planningDate: string;
}

const INDEPENDENT_TYPES = new Set(['SALES_ORDER', 'FORECAST', 'STO_DEMAND']);

export function buildPeggingGraph(input: PeggingInput): PeggingGraph {
  const demandById = new Map<string, DemandElement>();
  for (const element of input.demand) demandById.set(element.id, element);

  const demandByPlan = new Map<string, DemandElement[]>();
  for (const element of input.demand) {
    if (element.type === 'SAFETY_STOCK') continue;
    const key = planKey(element.itemId, element.plantId);
    const bucket = demandByPlan.get(key);
    if (bucket) bucket.push(element);
    else demandByPlan.set(key, [element]);
  }

  const supplyByPlan = new Map<string, SupplyElement[]>();
  for (const element of input.supply) {
    const key = planKey(element.itemId, element.plantId);
    const bucket = supplyByPlan.get(key);
    if (bucket) bucket.push(element);
    else supplyByPlan.set(key, [element]);
  }

  const allocations: PeggingAllocation[] = [];
  const supplyToDemand = new Map<string, string[]>();
  const demandToSupply = new Map<string, string[]>();

  for (const [key, demands] of demandByPlan) {
    demands.sort(compareDemand);
    const supplies = (supplyByPlan.get(key) ?? []).slice().sort(compareSupply);

    let stockRemaining = input.openingStock.get(key) ?? 0;
    let supplyIndex = 0;
    let supplyRemaining = supplies.length > 0 ? (supplies[0] as SupplyElement).qty : 0;

    for (const demandElement of demands) {
      let outstanding = demandElement.qty;

      // Opening stock is consumed first — it is the earliest available supply.
      if (stockRemaining > 0 && outstanding > 0) {
        const taken = Math.min(stockRemaining, outstanding);
        stockRemaining -= taken;
        outstanding -= taken;
        allocations.push({
          demandElementId: demandElement.id,
          supplyElementId: null,
          fromOpeningStock: true,
          qty: taken,
        });
      }

      while (outstanding > 1e-6 && supplyIndex < supplies.length) {
        const supplyElement = supplies[supplyIndex] as SupplyElement;
        if (supplyRemaining <= 1e-6) {
          supplyIndex += 1;
          supplyRemaining = supplyIndex < supplies.length ? (supplies[supplyIndex] as SupplyElement).qty : 0;
          continue;
        }
        const taken = Math.min(supplyRemaining, outstanding);
        supplyRemaining -= taken;
        outstanding -= taken;
        allocations.push({
          demandElementId: demandElement.id,
          supplyElementId: supplyElement.id,
          fromOpeningStock: false,
          qty: taken,
        });
        pushInto(supplyToDemand, supplyElement.id, demandElement.id);
        pushInto(demandToSupply, demandElement.id, supplyElement.id);
      }
    }
  }

  const dependentDemandParent = new Map<string, string>();
  for (const element of input.demand) {
    if (element.parentSupplyElementId) dependentDemandParent.set(element.id, element.parentSupplyElementId);
  }

  /** demand ids per item-plant, for the item-level trace. */
  const demandIdsByPlan = new Map<string, string[]>();
  for (const [key, demands] of demandByPlan) {
    demandIdsByPlan.set(
      key,
      demands.map((d) => d.id)
    );
  }

  const resolveDemandUp = (demandId: string, seen: Set<string>, out: Map<string, DemandElement>): void => {
    if (seen.has(`d:${demandId}`)) return;
    seen.add(`d:${demandId}`);
    const element = demandById.get(demandId);
    if (!element) return;
    if (INDEPENDENT_TYPES.has(element.type)) {
      out.set(element.id, element);
      return;
    }
    const parentSupplyId = element.parentSupplyElementId;
    if (parentSupplyId) resolveSupplyUp(parentSupplyId, seen, out);
  };

  const resolveSupplyUp = (supplyId: string, seen: Set<string>, out: Map<string, DemandElement>): void => {
    if (seen.has(`s:${supplyId}`)) return;
    seen.add(`s:${supplyId}`);
    const covered = supplyToDemand.get(supplyId);
    if (!covered) return;
    for (const demandId of covered) resolveDemandUp(demandId, seen, out);
  };

  return {
    allocations,
    dependentDemandParent,
    supplyToDemand,
    traceUp(supplyElementId: string): DemandElement[] {
      const out = new Map<string, DemandElement>();
      resolveSupplyUp(supplyElementId, new Set<string>(), out);
      return [...out.values()];
    },
    traceUpFromItemPlant(itemId: string, plantId: string): DemandElement[] {
      const out = new Map<string, DemandElement>();
      const seen = new Set<string>();
      for (const demandId of demandIdsByPlan.get(planKey(itemId, plantId)) ?? []) {
        resolveDemandUp(demandId, seen, out);
      }
      return [...out.values()];
    },
  };
}

function pushInto(map: Map<string, string[]>, key: string, value: string): void {
  const bucket = map.get(key);
  if (bucket) {
    if (!bucket.includes(value)) bucket.push(value);
  } else {
    map.set(key, [value]);
  }
}

/** Earliest required date first; ties broken by priority, then id for determinism. */
function compareDemand(a: DemandElement, b: DemandElement): number {
  if (a.requiredDate !== b.requiredDate) return a.requiredDate < b.requiredDate ? -1 : 1;
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Earliest receipt first; ties broken by id so the graph is reproducible. */
function compareSupply(a: SupplyElement, b: SupplyElement): number {
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
