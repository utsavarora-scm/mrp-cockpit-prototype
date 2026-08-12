/**
 * Resolution generation.
 *
 * A resolution is never a text suggestion. Each one carries the mutations that
 * would be applied to a cloned snapshot, so the workbench can re-run the engine
 * and show both what the fix solves and what it breaks. Options that cannot be
 * simulated do not belong here.
 *
 * Every option is drawn from real alternatives in the data: a secondary vendor
 * that actually exists, a substitute that is actually approved, a plant that is
 * actually holding excess.
 */

import {
  IMPACT_CONFIG,
  formatDays,
  formatPercent,
  formatQty,
  planKey,
  type ItemPlantPlan,
  type MrpOptions,
  type PeggingGraph,
  type PlanningException,
  type PlanningSnapshot,
  type Resolution,
  type SnapshotMutation,
  type TargetSystem,
  fromEpochDay,
  toEpochDay,
} from '@repo/domain';

import type { EngineIndex } from './run-mrp';
import { primaryVendor } from './run-mrp';

export interface BuildResolutionsInput {
  snapshot: PlanningSnapshot;
  options: MrpOptions;
  plans: Map<string, ItemPlantPlan>;
  index: EngineIndex;
  exceptions: PlanningException[];
  pegging: PeggingGraph;
}

export function buildResolutions(input: BuildResolutionsInput): Map<string, Resolution> {
  const resolutions = new Map<string, Resolution>();

  for (const exception of input.exceptions) {
    const options: Resolution[] = [];
    const key = planKey(exception.itemId, exception.plantId);

    switch (exception.exceptionClass) {
      case 'A':
        options.push(...supplyContinuityOptions(input, exception, key));
        break;
      case 'B':
        options.push(...masterDataOptions(input, exception, key));
        break;
      case 'C':
        options.push(...reconciliationOptions(input, exception, key));
        break;
      case 'D':
        options.push(...feasibilityOptions(input, exception, key));
        break;
    }

    options.push(acceptAndMonitor(exception));

    // Ranked by a composite of service recovered, cost and confidence: the
    // cheapest option is not automatically the best one.
    options.sort((a, b) => compositeScore(b) - compositeScore(a));
    for (const option of options) resolutions.set(option.id, option);
  }

  return resolutions;
}

/**
 * Composite score. Service recovery dominates, cost is penalised on a log scale
 * so a $200k option is worse than a $20k one but not a hundred times worse, and
 * confidence multiplies the whole thing.
 */
export function compositeScore(resolution: Resolution): number {
  const service = resolution.estimatedServiceImpact * 100;
  const costPenalty = Math.log10(Math.max(resolution.estimatedCost, 1)) * 2;
  const speed = 10 / Math.max(resolution.leadTimeToEffect, 1);
  return (service - costPenalty + speed) * resolution.confidence;
}

// ---------------------------------------------------------------------------

function supplyContinuityOptions(
  input: BuildResolutionsInput,
  exception: PlanningException,
  key: string
): Resolution[] {
  const options: Resolution[] = [];
  const item = input.index.itemById.get(exception.itemId);
  const itemPlant = input.index.itemPlantByKey.get(key);
  const plan = input.plans.get(key);
  if (!item || !itemPlant || !plan) return options;

  const shortfall = shortfallAt(plan, exception.bucketDay);
  const vendors = input.index.vendorsByKey.get(key) ?? [];
  const primary = primaryVendor(vendors);
  const planningEpochDay = input.index.planningEpochDay;

  // Reschedule an existing receipt in, when one exists later than the need date.
  const laterSupply = (input.index.supplyByKey.get(key) ?? [])
    .filter((supply) => toEpochDay(supply.dueDate) - planningEpochDay > exception.bucketDay)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];

  if (laterSupply && exception.code !== 'A5-RESCHEDULE-OUT' && exception.code !== 'A6-CANCEL-EXCESS') {
    const newDueDate = fromEpochDay(planningEpochDay + Math.max(0, exception.bucketDay));
    options.push({
      id: `RES-${exception.id}-RESCHED-IN`,
      exceptionId: exception.id,
      type: 'RESCHEDULE_IN',
      label: `Pull in ${laterSupply.id} to ${newDueDate}`,
      rationale: `${laterSupply.id} already carries ${formatQty(laterSupply.qty, item.baseUom)} but arrives after the shortage opens. Moving it earlier costs nothing beyond the supplier's agreement.`,
      mutations: [{ kind: 'RESCHEDULE_SUPPLY', supplyElementId: laterSupply.id, newDueDate }],
      estimatedCost: 0,
      estimatedServiceImpact: 0.6,
      estimatedInventoryImpact: 0,
      leadTimeToEffect: 2,
      confidence: 0.7,
      writebackTargets: ['SAP', 'KINAXIS'],
    });

    if (primary?.expediteAvailable && primary.expediteUnitPriceUplift !== null) {
      const premium = laterSupply.qty * primary.unitPrice * primary.expediteUnitPriceUplift;
      options.push({
        id: `RES-${exception.id}-EXPEDITE`,
        exceptionId: exception.id,
        type: 'EXPEDITE_EXISTING',
        label: `Expedite ${laterSupply.id} via premium freight`,
        rationale: `${primary.vendorId} offers a ${formatDays(primary.expediteLeadTimeDays ?? 0)} expedited lead time at a ${formatPercent(primary.expediteUnitPriceUplift, 0)} uplift. It compresses the existing order rather than raising a new one.`,
        mutations: [
          {
            kind: 'EXPEDITE_SUPPLY',
            supplyElementId: laterSupply.id,
            newDueDate,
            premiumCost: premium,
          },
        ],
        estimatedCost: premium,
        estimatedServiceImpact: 0.85,
        estimatedInventoryImpact: 0,
        leadTimeToEffect: primary.expediteLeadTimeDays ?? 5,
        confidence: 0.9,
        writebackTargets: ['SAP'],
      });
    }
  }

  // Switch to a secondary vendor that can deliver sooner.
  const alternate = vendors
    .filter((vendor) => !vendor.isPrimary && (!primary || vendor.leadTimeDays < primary.leadTimeDays))
    .sort((a, b) => a.leadTimeDays - b.leadTimeDays)[0];

  if (alternate && primary) {
    const priceDelta = (alternate.unitPrice - primary.unitPrice) * Math.max(shortfall, 0);
    options.push({
      id: `RES-${exception.id}-ALT-SOURCE`,
      exceptionId: exception.id,
      type: 'ALTERNATE_SOURCE',
      label: `Source from ${alternate.vendorId} (${formatDays(alternate.leadTimeDays)} lead time)`,
      rationale: `${alternate.vendorId} is an approved alternate at ${formatDays(alternate.leadTimeDays)} against ${primary.vendorId}'s ${formatDays(primary.leadTimeDays)}, at a unit price difference of ${((alternate.unitPrice / primary.unitPrice - 1) * 100).toFixed(1)}%.`,
      mutations: [
        { kind: 'SWITCH_VENDOR', itemId: exception.itemId, plantId: exception.plantId, vendorId: alternate.vendorId },
        {
          kind: 'SET_ITEM_PLANT_PARAM',
          itemId: exception.itemId,
          plantId: exception.plantId,
          field: 'leadTimeDays',
          value: alternate.leadTimeDays,
        },
      ],
      estimatedCost: Math.max(0, priceDelta),
      estimatedServiceImpact: 0.75,
      estimatedInventoryImpact: 0,
      leadTimeToEffect: alternate.leadTimeDays,
      confidence: 0.8,
      writebackTargets: ['SAP', 'KINAXIS'],
    });
  }

  // Use an approved substitute material.
  const substitute = input.snapshot.substitutes.find(
    (candidate) =>
      candidate.itemId === exception.itemId &&
      candidate.plantId === exception.plantId &&
      candidate.approvalStatus === 'APPROVED'
  );
  if (substitute) {
    const substituteItem = input.index.itemById.get(substitute.substituteItemId);
    const costDelta = substituteItem
      ? (substituteItem.standardCost * substitute.conversionFactor - item.standardCost) * Math.max(shortfall, 0)
      : 0;
    const parentBoms = input.index.bomsByComponent.get(key) ?? [];
    const parent = parentBoms.find((bom) => !bom.isAlternate);

    if (parent) {
      options.push({
        id: `RES-${exception.id}-SUBSTITUTE`,
        exceptionId: exception.id,
        type: 'SUBSTITUTE_COMPONENT',
        label: `Substitute ${substitute.substituteItemId}`,
        rationale: `${substitute.substituteItemId} is an approved alternate at a conversion factor of ${substitute.conversionFactor}. ${substitute.note}`,
        mutations: [
          {
            kind: 'SUBSTITUTE_COMPONENT',
            parentItemId: parent.parentItemId,
            plantId: exception.plantId,
            componentItemId: exception.itemId,
            substituteItemId: substitute.substituteItemId,
          },
        ],
        estimatedCost: Math.max(0, costDelta),
        estimatedServiceImpact: 0.7,
        estimatedInventoryImpact: 0,
        leadTimeToEffect: 3,
        confidence: 0.65,
        writebackTargets: ['SAP'],
      });
    }
  }

  // Move stock from a plant that is sitting on excess.
  const donor = findDonorPlant(input, exception.itemId, exception.plantId, shortfall);
  if (donor) {
    options.push({
      id: `RES-${exception.id}-REBALANCE`,
      exceptionId: exception.id,
      type: 'INVENTORY_REBALANCE',
      label: `Transfer ${formatQty(donor.qty, item.baseUom)} from ${donor.plantId}`,
      rationale: `${donor.plantId} holds ${formatDays(donor.coverDays)} of cover against ${exception.plantId}'s shortage. The material already exists inside the network, so this costs freight rather than purchase.`,
      mutations: [
        {
          kind: 'INVENTORY_REBALANCE',
          itemId: exception.itemId,
          fromPlantId: donor.plantId,
          toPlantId: exception.plantId,
          qty: donor.qty,
          arrivalDate: fromEpochDay(planningEpochDay + Math.max(2, exception.bucketDay - 2)),
        },
      ],
      estimatedCost: donor.qty * item.standardCost * 0.03,
      estimatedServiceImpact: 0.8,
      estimatedInventoryImpact: 0,
      leadTimeToEffect: 3,
      confidence: 0.85,
      writebackTargets: ['SAP', 'KINAXIS'],
    });
  }

  // If the root cause is a decayed lead time, correcting it is the durable fix.
  const observed = input.index.observedLeadTimes.get(key);
  if (observed && itemPlant.leadTimeDays !== null && observed.count >= IMPACT_CONFIG.drift.leadTimeMinReceipts) {
    const drift = Math.abs(observed.averageDays - itemPlant.leadTimeDays) / Math.max(itemPlant.leadTimeDays, 1);
    if (drift > IMPACT_CONFIG.drift.leadTimeDriftPct) {
      options.push(fixLeadTimeResolution(exception, itemPlant.leadTimeDays, observed.averageDays, observed.count));
    }
  }

  // Allocate what supply there is by margin and channel priority.
  const topDemand = exception.peggedDemandIds
    .map((id) => input.index.demandById.get(id))
    .filter((demand): demand is NonNullable<typeof demand> => Boolean(demand))
    .sort((a, b) => b.marginPerUnit * b.qty - a.marginPerUnit * a.qty)[0];

  if (topDemand && shortfall > 0) {
    options.push({
      id: `RES-${exception.id}-REPRIORITISE`,
      exceptionId: exception.id,
      type: 'DEMAND_REPRIORITISE',
      label: `Protect ${topDemand.channel ?? 'key'} demand, short the rest`,
      rationale: `Short supply is allocated by margin rather than by order date. ${topDemand.id} carries the highest margin contribution of the pegged orders and is served first.`,
      mutations: [{ kind: 'REPRIORITISE_DEMAND', demandElementId: topDemand.id, newPriority: 1 }],
      estimatedCost: 0,
      estimatedServiceImpact: 0.3,
      estimatedInventoryImpact: 0,
      leadTimeToEffect: 0,
      confidence: 0.95,
      writebackTargets: ['SAP', 'O9'],
    });
  }

  // Direct handling for the reschedule-out and cancel cases.
  if (exception.code === 'A5-RESCHEDULE-OUT' || exception.code === 'A6-CANCEL-EXCESS') {
    // The detector puts the supply element id in the exception's discriminator,
    // which is the id suffix.
    const supply =
      (input.index.supplyByKey.get(key) ?? []).find((element) => exception.id.endsWith(element.id)) ?? null;
    if (supply) {
      if (exception.code === 'A6-CANCEL-EXCESS') {
        options.push({
          id: `RES-${exception.id}-CANCEL`,
          exceptionId: exception.id,
          type: 'CANCEL_ORDER',
          label: `Cancel ${supply.id}`,
          rationale: `Nothing in the horizon pegs to this receipt. Cancelling releases the committed value without touching service.`,
          mutations: [{ kind: 'CANCEL_SUPPLY', supplyElementId: supply.id }],
          estimatedCost: 0,
          estimatedServiceImpact: 0,
          estimatedInventoryImpact: -supply.qty * item.standardCost,
          leadTimeToEffect: 1,
          confidence: 0.9,
          writebackTargets: ['SAP'],
        });
      } else {
        const pushedTo = fromEpochDay(planningEpochDay + Math.min(exception.bucketDay + 14, input.options.horizonDays));
        options.push({
          id: `RES-${exception.id}-RESCHED-OUT`,
          exceptionId: exception.id,
          type: 'RESCHEDULE_OUT',
          label: `Push ${supply.id} out to ${pushedTo}`,
          rationale: `The receipt arrives well before the balance needs it. Moving it out frees warehouse space and defers the cash outflow.`,
          mutations: [{ kind: 'RESCHEDULE_SUPPLY', supplyElementId: supply.id, newDueDate: pushedTo }],
          estimatedCost: 0,
          estimatedServiceImpact: 0,
          estimatedInventoryImpact: -supply.qty * item.standardCost * 0.5,
          leadTimeToEffect: 1,
          confidence: 0.92,
          writebackTargets: ['SAP'],
        });
      }
    }
  }

  return options;
}

// ---------------------------------------------------------------------------

function masterDataOptions(input: BuildResolutionsInput, exception: PlanningException, key: string): Resolution[] {
  const options: Resolution[] = [];
  const itemPlant = input.index.itemPlantByKey.get(key);
  const item = input.index.itemById.get(exception.itemId);
  const plan = input.plans.get(key);

  switch (exception.code) {
    case 'B7-LEAD-TIME-DRIFT': {
      const observed = input.index.observedLeadTimes.get(key);
      if (itemPlant?.leadTimeDays != null && observed) {
        options.push(fixLeadTimeResolution(exception, itemPlant.leadTimeDays, observed.averageDays, observed.count));
      }
      break;
    }
    case 'B8-SAFETY-STOCK-MISALIGNED': {
      const calculated = extractCalculatedSafetyStock(exception);
      if (calculated !== null && item) {
        options.push({
          id: `RES-${exception.id}-FIX-SS`,
          exceptionId: exception.id,
          type: 'FIX_MASTER_DATA',
          label: `Set safety stock to ${formatQty(calculated, item.baseUom)}`,
          rationale: `Recalculated from the current demand variability and lead time at the maintained service level target. Writing it back realigns the buffer with the demand it is meant to absorb.`,
          mutations: [
            {
              kind: 'SET_ITEM_PLANT_PARAM',
              itemId: exception.itemId,
              plantId: exception.plantId,
              field: 'safetyStock',
              value: calculated,
            },
          ],
          estimatedCost: 0,
          estimatedServiceImpact: 0.2,
          estimatedInventoryImpact: (calculated - (itemPlant?.safetyStock ?? 0)) * item.standardCost,
          leadTimeToEffect: 0,
          confidence: 0.88,
          writebackTargets: ['SAP', 'KINAXIS'],
        });
      }
      break;
    }
    case 'B1-INCOMPLETE-PLANNING-MASTER':
    case 'B3-ABSENT-ITEM': {
      options.push({
        id: `RES-${exception.id}-CREATE-MASTER`,
        exceptionId: exception.id,
        type: 'FIX_MASTER_DATA',
        label:
          exception.code === 'B3-ABSENT-ITEM'
            ? `Create the planning master from a similar item`
            : `Complete the missing planning parameters`,
        rationale:
          exception.code === 'B3-ABSENT-ITEM'
            ? `Copies planning parameters from the closest comparable item at this plant, so the item enters the plan with defensible values rather than none at all.`
            : `Fills the unmaintained fields from the plant's defaults for this item type, bringing the item into deterministic planning.`,
        mutations: [
          {
            kind: 'CREATE_ITEM_PLANT',
            itemId: exception.itemId,
            plantId: exception.plantId,
            template: exception.code === 'B3-ABSENT-ITEM' ? 'FROM_SIMILAR' : 'DEFAULT',
          },
        ],
        estimatedCost: 0,
        estimatedServiceImpact: 0.55,
        estimatedInventoryImpact: 0,
        leadTimeToEffect: 1,
        confidence: exception.code === 'B3-ABSENT-ITEM' ? 0.7 : 0.86,
        writebackTargets: ['SAP'],
      });
      break;
    }
    case 'B4-ORPHAN-ITEM': {
      if (plan && item) {
        options.push({
          id: `RES-${exception.id}-DISPOSITION`,
          exceptionId: exception.id,
          type: 'ACCEPT_AND_MONITOR',
          label: `Flag for obsolescence review`,
          rationale: `No demand and no consumption in the horizon. The decision is commercial rather than a planning parameter change, so it is queued for review rather than auto-applied.`,
          mutations: [{ kind: 'ACCEPT_AND_MONITOR', exceptionId: exception.id }],
          estimatedCost: 0,
          estimatedServiceImpact: 0,
          estimatedInventoryImpact: -plan.openingStock * item.standardCost,
          leadTimeToEffect: 30,
          confidence: 0.6,
          writebackTargets: [],
        });
      }
      break;
    }
    default:
      break;
  }

  return options;
}

function reconciliationOptions(input: BuildResolutionsInput, exception: PlanningException, key: string): Resolution[] {
  const options: Resolution[] = [];

  if (exception.code === 'C3-PARAMETER-DRIFT') {
    const itemPlant = input.index.itemPlantByKey.get(key);
    const observed = input.index.observedLeadTimes.get(key);
    // SAP is the system of record for master data, so it is the recommended
    // source of truth unless observation says otherwise.
    const value =
      observed && observed.count >= IMPACT_CONFIG.drift.leadTimeMinReceipts
        ? Math.round(observed.averageDays)
        : (itemPlant?.leadTimeDays ?? null);

    if (value !== null) {
      options.push({
        id: `RES-${exception.id}-ALIGN`,
        exceptionId: exception.id,
        type: 'FIX_MASTER_DATA',
        label: `Align all systems to ${formatDays(value)}`,
        rationale: observed
          ? `Neither system's figure matches the ${observed.count} most recent receipts. Aligning both to the observed ${observed.averageDays.toFixed(1)} days makes the two plans agree on something that is also true.`
          : `SAP is the system of record for planning master data. Propagating its value removes the divergence at source.`,
        mutations: [
          {
            kind: 'SET_ITEM_PLANT_PARAM',
            itemId: exception.itemId,
            plantId: exception.plantId,
            field: 'leadTimeDays',
            value,
          },
        ],
        estimatedCost: 0,
        estimatedServiceImpact: 0.15,
        estimatedInventoryImpact: 0,
        leadTimeToEffect: 0,
        confidence: 0.87,
        writebackTargets: ['SAP', 'KINAXIS'],
      });
    }
  }

  return options;
}

function feasibilityOptions(input: BuildResolutionsInput, exception: PlanningException, key: string): Resolution[] {
  const options: Resolution[] = [];
  const itemPlant = input.index.itemPlantByKey.get(key);
  const item = input.index.itemById.get(exception.itemId);
  const plan = input.plans.get(key);
  if (!itemPlant || !item || !plan) return options;

  if (exception.code === 'D4-LOT-SIZE-INDUCED-EXCESS' || exception.code === 'D1-VENDOR-CONSTRAINT') {
    let horizonDemand = 0;
    for (let day = 0; day < plan.grossRequirements.length; day += 1)
      horizonDemand += plan.grossRequirements[day] as number;
    const dailyDemand = horizonDemand / Math.max(plan.grossRequirements.length, 1);
    const targetLot = Math.max(1, Math.round(dailyDemand * 30));

    options.push({
      id: `RES-${exception.id}-RELOT`,
      exceptionId: exception.id,
      type: 'RELOT_SIZE',
      label: `Switch to periodic order quantity, 30-day period`,
      rationale: `Demand averages ${formatQty(dailyDemand, item.baseUom)} per day. A 30-day period of supply orders roughly ${formatQty(targetLot, item.baseUom)} at a time instead of the current rule's ${formatQty(itemPlant.fixedLotSize ?? 0, item.baseUom)}, cutting cover without adding stockout risk.`,
      mutations: [
        { kind: 'SET_LOT_SIZE_RULE', itemId: exception.itemId, plantId: exception.plantId, value: 'POQ' },
        {
          kind: 'SET_ITEM_PLANT_PARAM',
          itemId: exception.itemId,
          plantId: exception.plantId,
          field: 'periodsOfSupplyDays',
          value: 30,
        },
      ],
      estimatedCost: 0,
      estimatedServiceImpact: 0,
      estimatedInventoryImpact: -exception.impact.excessInventoryValue,
      leadTimeToEffect: 0,
      confidence: 0.82,
      writebackTargets: ['SAP', 'KINAXIS'],
    });
  }

  if (exception.code === 'D3-SHELF-LIFE-VIOLATION') {
    const donor = findShortagePlant(input, exception.itemId, exception.plantId);
    if (donor) {
      options.push({
        id: `RES-${exception.id}-REALLOCATE`,
        exceptionId: exception.id,
        type: 'INVENTORY_REBALANCE',
        label: `Reallocate the batch to ${donor}`,
        rationale: `${donor} consumes this material faster and can use the batch before it expires. Moving it converts a write-off into a covered requirement.`,
        mutations: [
          {
            kind: 'INVENTORY_REBALANCE',
            itemId: exception.itemId,
            fromPlantId: exception.plantId,
            toPlantId: donor,
            qty: exception.impact.obsolescenceExposure / Math.max(item.standardCost, 1),
            arrivalDate: fromEpochDay(input.index.planningEpochDay + 3),
          },
        ],
        estimatedCost: exception.impact.obsolescenceExposure * 0.05,
        estimatedServiceImpact: 0.25,
        estimatedInventoryImpact: 0,
        leadTimeToEffect: 3,
        confidence: 0.7,
        writebackTargets: ['SAP'],
      });
    }
  }

  return options;
}

// ---------------------------------------------------------------------------

function fixLeadTimeResolution(
  exception: PlanningException,
  maintained: number,
  observedAverage: number,
  sampleSize: number
): Resolution {
  const corrected = Math.round(observedAverage);
  return {
    id: `RES-${exception.id}-FIX-LT`,
    exceptionId: exception.id,
    type: 'FIX_MASTER_DATA',
    label: `Correct lead time to ${formatDays(corrected)}`,
    rationale: `The maintained ${formatDays(maintained)} has not matched reality across the last ${sampleSize} receipts, which averaged ${observedAverage.toFixed(1)} days. Correcting it makes every future plan for this item honest, rather than fixing this one shortage.`,
    mutations: [
      {
        kind: 'SET_ITEM_PLANT_PARAM',
        itemId: exception.itemId,
        plantId: exception.plantId,
        field: 'leadTimeDays',
        value: corrected,
      },
    ],
    estimatedCost: 0,
    estimatedServiceImpact: 0.45,
    estimatedInventoryImpact: 0,
    leadTimeToEffect: 0,
    confidence: 0.92,
    writebackTargets: ['SAP', 'KINAXIS'],
  };
}

function acceptAndMonitor(exception: PlanningException): Resolution {
  return {
    id: `RES-${exception.id}-ACCEPT`,
    exceptionId: exception.id,
    type: 'ACCEPT_AND_MONITOR',
    label: 'Accept and monitor',
    rationale: 'No change to the plan. The exception stays visible and is re-evaluated on the next run.',
    mutations: [{ kind: 'ACCEPT_AND_MONITOR', exceptionId: exception.id }],
    estimatedCost: 0,
    estimatedServiceImpact: 0,
    estimatedInventoryImpact: 0,
    leadTimeToEffect: 0,
    confidence: 1,
    writebackTargets: [] as TargetSystem[],
  };
}

function shortfallAt(plan: ItemPlantPlan, day: number): number {
  if (day < 0 || day >= plan.projectedAvailable.length) return 0;
  const balance = plan.projectedAvailable[day] as number;
  return Math.max(0, plan.safetyStock - balance);
}

/** A plant holding materially more cover than it needs, and enough to help. */
function findDonorPlant(
  input: BuildResolutionsInput,
  itemId: string,
  shortPlantId: string,
  needed: number
): { plantId: string; qty: number; coverDays: number } | null {
  if (needed <= 0) return null;
  let best: { plantId: string; qty: number; coverDays: number } | null = null;

  for (const plant of input.snapshot.plants) {
    if (plant.id === shortPlantId) continue;
    const plan = input.plans.get(planKey(itemId, plant.id));
    if (!plan) continue;
    const cover = plan.daysOfCover[0] as number;
    if (cover < IMPACT_CONFIG.excessCoverThresholdDays) continue;

    const spare = plan.openingStock - plan.safetyStock;
    if (spare <= 0) continue;
    const qty = Math.min(spare, needed);
    if (qty <= 0) continue;

    if (!best || cover > best.coverDays) best = { plantId: plant.id, qty, coverDays: cover };
  }

  return best;
}

/** A plant that is short of this material and could consume a surplus batch. */
function findShortagePlant(input: BuildResolutionsInput, itemId: string, sourcePlantId: string): string | null {
  for (const plant of input.snapshot.plants) {
    if (plant.id === sourcePlantId) continue;
    const plan = input.plans.get(planKey(itemId, plant.id));
    if (!plan) continue;
    if ((plan.daysOfCover[0] as number) < 30) return plant.id;
  }
  return null;
}

/** Pulls the recalculated figure back out of the evidence the detector recorded. */
function extractCalculatedSafetyStock(exception: PlanningException): number | null {
  const fact = exception.evidence.find((entry) => entry.label === 'Calculated safety stock');
  if (!fact) return null;
  const digits = fact.value.replace(/[^0-9.]/g, '');
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
