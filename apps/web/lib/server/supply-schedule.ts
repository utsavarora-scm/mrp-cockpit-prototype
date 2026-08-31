/**
 * The Supply Schedule projection.
 *
 * The client's fourth complaint: SAP tells them to buy 2,520 MT and stops. So
 * this does not *display* a schedule — it generates one, and shows the
 * constraints that produced it. The order quantity is derived from the plan's
 * own requirement across the order window rather than typed in anywhere:
 *
 *   total = demand across the window + the norm it has to restore
 *           − stock on hand − supply already committed inside the window
 *
 * The scheduling engine then decides the split, the dates and the feasibility
 * together, because with a shipment cap, a storage ceiling, a receiving rate
 * and a minimum order quantity all in play those are one decision.
 */

import { fromEpochDay, planKey, toEpochDay } from '@repo/domain';
import { buildCalendars, FALLBACK_CALENDAR, scheduleOrder, WorkingCalendar } from '@repo/planning-engine';

import type { ConstraintView, ScheduleView } from '../api-types';
import { categoryNorms } from './norms';
import { planFor, snapshotFor } from './planning-session';

/** `PLN-<itemId>-<plantId>` addresses an order the plan is recommending. */
export function plannedOrderId(itemId: string, plantId: string): string {
  return `PLN-${itemId}-${plantId}`;
}

function parsePlannedOrderId(orderId: string): { itemId: string; plantId: string } | null {
  if (!orderId.startsWith('PLN-')) return null;
  const rest = orderId.slice(4);
  const split = rest.lastIndexOf('-');
  if (split <= 0) return null;
  return { itemId: rest.slice(0, split), plantId: rest.slice(split + 1) };
}

export function supplySchedule(orderId: string, quantityOverride?: number, scenarioId = 'baseline'): ScheduleView | null {
  const snapshot = snapshotFor();
  const plan = planFor(scenarioId);
  const norms = categoryNorms(scenarioId);

  const target = parsePlannedOrderId(orderId) ?? existingOrderTarget(orderId);
  if (!target) return null;

  const { itemId, plantId } = target;
  const key = planKey(itemId, plantId);
  const itemPlan = plan.plans.get(key);
  const master = snapshot.itemPlants.find((row) => row.itemId === itemId && row.plantId === plantId);
  const item = snapshot.items.find((row) => row.id === itemId);
  if (!itemPlan || !master || !item) return null;

  const vendor =
    snapshot.itemVendors.find((row) => row.itemId === itemId && row.plantId === plantId && row.isPrimary) ??
    snapshot.itemVendors.find((row) => row.itemId === itemId && row.plantId === plantId);
  const vendorName = vendor ? (snapshot.vendors.find((row) => row.id === vendor.vendorId)?.name ?? null) : null;

  const recommendation = norms.recommendations.get(key);
  const planningEpochDay = toEpochDay(plan.planningDate);
  const horizon = itemPlan.grossRequirements.length - 1;

  // --- Step 1: the order window ------------------------------------------
  const orderWindowDays = Math.max(
    1,
    Math.round(recommendation?.recommendedOrderDays ?? (master.leadTimeDays ?? 30) + master.grProcessingTimeDays)
  );
  const windowEnd = Math.min(orderWindowDays, horizon);

  // --- Step 2: the total ---------------------------------------------------
  let demandInWindow = 0;
  let committedInWindow = 0;
  for (let day = 0; day <= windowEnd; day += 1) {
    demandInWindow += itemPlan.grossRequirements[day] as number;
    committedInWindow += itemPlan.scheduledReceipts[day] as number;
  }
  const targetClosing = recommendation?.constrainedStockQty ?? itemPlan.safetyStock;
  const derivedTotal = Math.max(
    0,
    demandInWindow + targetClosing - itemPlan.openingStock - committedInWindow
  );

  const increment = vendor?.incrementQty ?? null;
  const rounded = increment && increment > 0 ? Math.ceil(derivedTotal / increment) * increment : Math.round(derivedTotal);
  const totalQty = quantityOverride !== undefined && quantityOverride > 0 ? quantityOverride : rounded;

  // --- The first day the position is uncovered -----------------------------
  let firstUncovered = -1;
  for (let day = 0; day <= horizon; day += 1) {
    if ((itemPlan.projectedAvailableFeasible[day] as number) < itemPlan.safetyStock) {
      firstUncovered = day;
      break;
    }
  }

  const calendars = buildCalendars(snapshot.calendars, plan.planningDate, horizon);
  const plantCalendar =
    calendars.get(snapshot.plants.find((row) => row.id === plantId)?.calendarId ?? '') ??
    new WorkingCalendar(FALLBACK_CALENDAR, plan.planningDate, horizon);

  const reliability = norms.adherence.byVendorMaterial.get(`${vendor?.vendorId ?? ''}@${itemId}`);

  const schedule = scheduleOrder({
    itemId,
    plantId,
    vendorId: vendor?.vendorId ?? 'unsourced',
    totalQty,
    firstUncoveredEpochDay: planningEpochDay + Math.max(firstUncovered, 0),
    dailyDemandMean: recommendation?.dailyDemandMean ?? demandInWindow / Math.max(windowEnd, 1),
    safetyStockQty: targetClosing,
    moq: vendor?.moq ?? null,
    incrementQty: increment,
    maxShipmentQty: vendor?.maxShipmentQty ?? null,
    storageCapacity: master.storageCapacity,
    dailyReceivingCapacity: master.dailyReceivingCapacity,
    shelfLifeDays: item.shelfLifeDays,
    transitDays: vendor?.transitDays ?? 0,
    earliestDispatchDays: vendor?.earliestDispatchDays ?? 0,
    planningEpochDay,
    plantCalendar,
    reliability: reliability
      ? {
          meanDateVarianceDays: reliability.meanDateVarianceDays,
          stdDevDateVarianceDays: reliability.stdDevDateVarianceDays,
          otifRate: reliability.otifRate,
        }
      : undefined,
  });

  const constraints: ConstraintView[] = schedule.drivers.map((driver) => ({
    kind: driver.kind,
    label: DRIVER_LABEL[driver.kind] ?? driver.kind,
    binding: driver.binding,
    value: `${driver.lines} ${driver.lines === 1 ? 'line' : 'lines'}`,
    note: driver.note,
  }));

  constraints.push({
    kind: 'STORAGE_PEAK',
    label: 'Storage on peak on-hand',
    binding: schedule.storageBinding,
    value: `${Math.round(schedule.peakOnHand).toLocaleString('en-IN')} of ${
      master.storageCapacity === null ? '—' : Math.round(master.storageCapacity).toLocaleString('en-IN')
    }`,
    note: 'The buffer plus one delivery is what has to be on the ground at once — a different question from how much can be bought.',
  });

  if (vendor) {
    constraints.push({
      kind: 'DISPATCH_NOTICE',
      label: 'Earliest the vendor can dispatch',
      binding: schedule.infeasibleLines > 0,
      value: `${vendor.earliestDispatchDays} days`,
      note: `Plus ${vendor.transitDays} days in transit before it can be received.`,
    });
  }

  return {
    orderId,
    isPlanned: orderId.startsWith('PLN-'),
    itemId,
    plantId,
    description: item.description,
    baseUom: item.baseUom,
    vendorId: vendor?.vendorId ?? null,
    vendorName,
    isImport: vendor?.isImport ?? false,
    planningDate: plan.planningDate,
    totalQty: schedule.totalQty,
    derivation: {
      orderWindowDays,
      demandInWindow,
      targetClosing,
      openingStock: itemPlan.openingStock,
      committedInWindow,
      derivedTotal: rounded,
      isOverridden: quantityOverride !== undefined && quantityOverride > 0,
    },
    lineCount: schedule.lineCount,
    lines: schedule.lines.map((line) => ({
      line: line.line,
      qty: line.qty,
      requiredByDate: line.requiredByDate,
      requestedDispatchDate: line.requestedDispatchDate,
      coverDays: line.coverDays,
      confidence: line.confidence,
      flags: [...line.flags],
      infeasibleByDays: line.infeasibleByDays,
      // The pipeline stage a line of a *recommended* order sits at: nothing is
      // placed yet, so none of it is confirmed. Real orders carry their own.
      status: 'PLANNED' as const,
    })),
    constraints,
    rationale: schedule.rationale,
    peakOnHand: schedule.peakOnHand,
    storageCapacity: master.storageCapacity,
    infeasibleLines: schedule.infeasibleLines,
    horizonEndDate: fromEpochDay(planningEpochDay + horizon),
  };
}

const DRIVER_LABEL: Record<string, string> = {
  SHIPMENT_CAP: 'Shipment cap',
  STORAGE: 'Storage capacity',
  RECEIVING: 'Goods receipt rate',
  SHELF_LIFE: 'Shelf life',
};

function existingOrderTarget(orderId: string): { itemId: string; plantId: string } | null {
  const element = snapshotFor().supply.find((row) => row.id === orderId);
  return element ? { itemId: element.itemId, plantId: element.plantId } : null;
}
