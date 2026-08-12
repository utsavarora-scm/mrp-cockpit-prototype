/**
 * Simulation — apply a resolution's mutations to a cloned snapshot, re-run the
 * engine, and diff the two plans.
 *
 * The diff must show exceptions the fix *creates*, not only the ones it closes.
 * Every real resolution moves a problem somewhere; a tool that only shows the
 * upside is selling, not planning.
 *
 * Cloning is copy-on-write: the arrays are shallow-copied and only the records
 * a mutation actually touches are replaced. Deep-cloning tens of thousands of
 * demand elements per simulation would blow the interaction budget for no gain.
 */

import {
  type DemandElement,
  type ItemPlant,
  type MrpOptions,
  type MrpResult,
  type PlanKpis,
  type PlanningException,
  type PlanningSnapshot,
  type SnapshotMutation,
  type SupplyElement,
  planKey,
} from '@repo/domain';

import { runMrp } from './run-mrp';

export interface PlanDiff {
  resolved: PlanningException[];
  created: PlanningException[];
  unchanged: number;
  kpiDelta: {
    totalExposure: number;
    exceptionCount: number;
    projectedFillRate: number;
    inventoryValue: number;
    daysOnHand: number;
    excessObsoleteExposure: number;
  };
  before: PlanKpis;
  after: PlanKpis;
}

export interface SimulationResult {
  snapshot: PlanningSnapshot;
  plan: MrpResult;
  diff: PlanDiff;
}

export function simulate(
  baseSnapshot: PlanningSnapshot,
  basePlan: MrpResult,
  mutations: SnapshotMutation[],
  options: MrpOptions
): SimulationResult {
  const snapshot = applyMutations(baseSnapshot, mutations);
  const plan = runMrp(snapshot, options);
  return { snapshot, plan, diff: diffPlans(basePlan, plan) };
}

export function diffPlans(before: MrpResult, after: MrpResult): PlanDiff {
  const beforeIds = new Map(before.exceptions.map((exception) => [exception.id, exception]));
  const afterIds = new Map(after.exceptions.map((exception) => [exception.id, exception]));

  const resolved: PlanningException[] = [];
  const created: PlanningException[] = [];
  let unchanged = 0;

  for (const [id, exception] of beforeIds) {
    if (afterIds.has(id)) unchanged += 1;
    else resolved.push(exception);
  }
  for (const [id, exception] of afterIds) {
    if (!beforeIds.has(id)) created.push(exception);
  }

  resolved.sort((a, b) => b.impactValue - a.impactValue);
  created.sort((a, b) => b.impactValue - a.impactValue);

  return {
    resolved,
    created,
    unchanged,
    kpiDelta: {
      totalExposure: after.kpis.totalExposure - before.kpis.totalExposure,
      exceptionCount: after.kpis.exceptionCount - before.kpis.exceptionCount,
      projectedFillRate: after.kpis.projectedFillRate - before.kpis.projectedFillRate,
      inventoryValue: after.kpis.inventoryValue - before.kpis.inventoryValue,
      daysOnHand: after.kpis.daysOnHand - before.kpis.daysOnHand,
      excessObsoleteExposure: after.kpis.excessObsoleteExposure - before.kpis.excessObsoleteExposure,
    },
    before: before.kpis,
    after: after.kpis,
  };
}

// ---------------------------------------------------------------------------

export function applyMutations(base: PlanningSnapshot, mutations: SnapshotMutation[]): PlanningSnapshot {
  if (mutations.length === 0) return base;

  const next: PlanningSnapshot = {
    ...base,
    itemPlants: base.itemPlants.slice(),
    supply: base.supply.slice(),
    demand: base.demand.slice(),
    boms: base.boms.slice(),
    itemVendors: base.itemVendors.slice(),
  };

  for (const mutation of mutations) {
    switch (mutation.kind) {
      case 'SET_ITEM_PLANT_PARAM': {
        replaceItemPlant(next, mutation.itemId, mutation.plantId, (record) => ({
          ...record,
          [mutation.field]: mutation.value,
        }));
        break;
      }
      case 'SET_LOT_SIZE_RULE': {
        replaceItemPlant(next, mutation.itemId, mutation.plantId, (record) => ({
          ...record,
          lotSizeRule: mutation.value,
        }));
        break;
      }
      case 'CREATE_ITEM_PLANT': {
        createItemPlant(next, mutation.itemId, mutation.plantId, mutation.template);
        break;
      }
      case 'RESCHEDULE_SUPPLY':
      case 'EXPEDITE_SUPPLY': {
        replaceSupply(next, mutation.supplyElementId, (record) => ({
          ...record,
          dueDate: mutation.newDueDate,
          isFirm: true,
        }));
        break;
      }
      case 'CANCEL_SUPPLY': {
        next.supply = next.supply.filter((record) => record.id !== mutation.supplyElementId);
        break;
      }
      case 'ADD_SUPPLY': {
        next.supply.push({
          id: `SIM-PO-${mutation.itemId}-${mutation.plantId}-${mutation.dueDate}`,
          type: mutation.sourcePlantId ? 'STO' : 'PO',
          itemId: mutation.itemId,
          plantId: mutation.plantId,
          qty: mutation.qty,
          dueDate: mutation.dueDate,
          releaseDate: mutation.dueDate,
          vendorId: mutation.vendorId,
          sourcePlantId: mutation.sourcePlantId,
          isFirm: true,
          sourceSystem: 'ENGINE',
        });
        break;
      }
      case 'SWITCH_VENDOR': {
        const key = planKey(mutation.itemId, mutation.plantId);
        next.itemVendors = next.itemVendors.map((record) =>
          planKey(record.itemId, record.plantId) === key
            ? { ...record, isPrimary: record.vendorId === mutation.vendorId }
            : record
        );
        break;
      }
      case 'SUBSTITUTE_COMPONENT': {
        next.boms = next.boms.map((line) =>
          line.parentItemId === mutation.parentItemId &&
          line.plantId === mutation.plantId &&
          line.componentItemId === mutation.componentItemId &&
          !line.isAlternate
            ? { ...line, componentItemId: mutation.substituteItemId }
            : line
        );
        break;
      }
      case 'SWITCH_ALTERNATE_BOM': {
        next.boms = next.boms.map((line) => {
          if (line.parentItemId !== mutation.parentItemId || line.plantId !== mutation.plantId) return line;
          return { ...line, isAlternate: line.alternateBomId !== mutation.alternateBomId };
        });
        break;
      }
      case 'INVENTORY_REBALANCE': {
        // Modelled as matched supply and demand rather than by editing stock, so
        // the transfer shows up on both plants' time-phased grids.
        next.supply.push({
          id: `SIM-STO-${mutation.itemId}-${mutation.toPlantId}-${mutation.arrivalDate}`,
          type: 'STO',
          itemId: mutation.itemId,
          plantId: mutation.toPlantId,
          qty: mutation.qty,
          dueDate: mutation.arrivalDate,
          releaseDate: mutation.arrivalDate,
          vendorId: null,
          sourcePlantId: mutation.fromPlantId,
          isFirm: true,
          sourceSystem: 'ENGINE',
        });
        next.demand.push({
          id: `SIM-STOD-${mutation.itemId}-${mutation.fromPlantId}-${mutation.arrivalDate}`,
          type: 'STO_DEMAND',
          itemId: mutation.itemId,
          plantId: mutation.fromPlantId,
          qty: mutation.qty,
          requiredDate: mutation.arrivalDate,
          customerId: null,
          channel: 'INTERNAL',
          marginPerUnit: 0,
          pricePerUnit: 0,
          priority: 3,
          parentSupplyElementId: null,
          sourceSystem: 'ENGINE',
        });
        break;
      }
      case 'REPRIORITISE_DEMAND': {
        next.demand = next.demand.map((record: DemandElement) =>
          record.id === mutation.demandElementId ? { ...record, priority: mutation.newPriority } : record
        );
        break;
      }
      case 'ACCEPT_AND_MONITOR':
        // Deliberately inert: accepting an exception records a decision, it does
        // not change the plan. The diff should show nothing moving.
        break;
    }
  }

  return next;
}

function replaceItemPlant(
  snapshot: PlanningSnapshot,
  itemId: string,
  plantId: string,
  update: (record: ItemPlant) => ItemPlant
): void {
  const index = snapshot.itemPlants.findIndex((record) => record.itemId === itemId && record.plantId === plantId);
  if (index < 0) return;
  snapshot.itemPlants[index] = update(snapshot.itemPlants[index] as ItemPlant);
}

function replaceSupply(
  snapshot: PlanningSnapshot,
  supplyElementId: string,
  update: (record: SupplyElement) => SupplyElement
): void {
  const index = snapshot.supply.findIndex((record) => record.id === supplyElementId);
  if (index < 0) return;
  snapshot.supply[index] = update(snapshot.supply[index] as SupplyElement);
}

/**
 * Creating a missing planning master. `FROM_SIMILAR` copies the parameters of
 * the closest comparable item at the same plant — same type and base UoM —
 * which is what a planner would do by hand.
 */
function createItemPlant(
  snapshot: PlanningSnapshot,
  itemId: string,
  plantId: string,
  template: 'FROM_SIMILAR' | 'DEFAULT'
): void {
  if (snapshot.itemPlants.some((record) => record.itemId === itemId && record.plantId === plantId)) {
    // Already exists — this is the "complete the missing fields" case.
    replaceItemPlant(snapshot, itemId, plantId, (record) => ({
      ...record,
      mrpType: record.mrpType ?? 'PD',
      procurementType: record.procurementType ?? 'BUY',
      lotSizeRule: record.lotSizeRule ?? 'LFL',
      leadTimeDays: record.leadTimeDays ?? 21,
      safetyStock: record.safetyStock ?? 0,
      isPlanningRelevant: true,
    }));
    return;
  }

  const item = snapshot.items.find((record) => record.id === itemId);
  let source: ItemPlant | undefined;

  if (template === 'FROM_SIMILAR' && item) {
    const siblingIds = new Set(
      snapshot.items
        .filter((other) => other.type === item.type && other.baseUom === item.baseUom)
        .map((other) => other.id)
    );
    source = snapshot.itemPlants.find((record) => record.plantId === plantId && siblingIds.has(record.itemId));
  }

  snapshot.itemPlants.push(
    source
      ? { ...source, itemId, plantId, isPlanningRelevant: true, paramsLastChangedOn: source.paramsLastChangedOn }
      : {
          itemId,
          plantId,
          mrpType: 'PD',
          procurementType: 'BUY',
          lotSizeRule: 'LFL',
          fixedLotSize: null,
          minLotSize: null,
          maxLotSize: null,
          roundingValue: null,
          periodsOfSupplyDays: null,
          reorderPoint: null,
          leadTimeDays: 21,
          grProcessingTimeDays: 1,
          safetyStock: 0,
          safetyTimeDays: 0,
          scrapPct: 0,
          serviceLevelTarget: 0.95,
          plannerCode: null,
          sourcePlantId: null,
          isPlanningRelevant: true,
          paramsLastChangedOn: '2026-01-01',
        }
  );
}
