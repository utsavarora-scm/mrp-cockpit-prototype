/**
 * Headline KPIs.
 *
 * Everything here is derived from the plan that was just computed. The one line
 * that matters most is the Pareto share — "1,247 exceptions, $18.4M at risk, top
 * 12 = 71% of exposure" — because it is the argument for the product in a single
 * sentence.
 */

import {
  IMPACT_CONFIG,
  type ExceptionClass,
  type ItemPlantPlan,
  type MrpOptions,
  type PlanKpis,
  type PlanningException,
  type PlanningSnapshot,
  planKey,
} from '@repo/domain';

import type { EngineIndex } from './run-mrp';

/** How many top exceptions the Pareto headline reports on. */
export const PARETO_HEAD_COUNT = 12;

export interface KpiInput {
  snapshot: PlanningSnapshot;
  options: MrpOptions;
  plans: Map<string, ItemPlantPlan>;
  exceptions: PlanningException[];
  index: EngineIndex;
}

export function computeKpis(input: KpiInput): PlanKpis {
  const { exceptions, plans, index } = input;

  let totalExposure = 0;
  const exceptionsByClass: Record<ExceptionClass, number> = { A: 0, B: 0, C: 0, D: 0 };
  const exposureByClass: Record<ExceptionClass, number> = { A: 0, B: 0, C: 0, D: 0 };

  for (const exception of exceptions) {
    totalExposure += exception.impactValue;
    exceptionsByClass[exception.exceptionClass] += 1;
    exposureByClass[exception.exceptionClass] += exception.impactValue;
  }

  // Exceptions arrive sorted by impact, so the head is already the top N.
  let headExposure = 0;
  for (let i = 0; i < Math.min(PARETO_HEAD_COUNT, exceptions.length); i += 1) {
    headExposure += (exceptions[i] as PlanningException).impactValue;
  }

  // How far down the ranked queue a planner has to read to have covered 70% of
  // the money. This is the product thesis stated as a number rather than a claim.
  let running = 0;
  let exceptionsToSeventyPercent = 0;
  const seventyPercentTarget = totalExposure * 0.7;
  for (const exception of exceptions) {
    if (running >= seventyPercentTarget) break;
    running += exception.impactValue;
    exceptionsToSeventyPercent += 1;
  }

  let inventoryValue = 0;
  let dailyCogs = 0;
  let excessObsolete = 0;

  for (const [key, plan] of plans) {
    const item = index.itemById.get(plan.itemId);
    if (!item) continue;
    const stock = index.stockByKey.get(key);
    const onHand = stock
      ? stock.unrestricted + stock.blocked + stock.qualityInspection + stock.inTransit
      : plan.openingStock;
    inventoryValue += onHand * item.standardCost;

    let horizonDemand = 0;
    for (let day = 0; day < plan.grossRequirements.length; day += 1)
      horizonDemand += plan.grossRequirements[day] as number;
    const perDay = horizonDemand / Math.max(plan.grossRequirements.length, 1);
    dailyCogs += perDay * item.standardCost;

    const excessThreshold = perDay * IMPACT_CONFIG.excessCoverThresholdDays;
    if (onHand > excessThreshold) excessObsolete += (onHand - excessThreshold) * item.standardCost;
  }

  const daysOnHand = dailyCogs > 0 ? inventoryValue / dailyCogs : 0;

  return {
    totalExposure,
    exceptionCount: exceptions.length,
    top12Share: totalExposure > 0 ? headExposure / totalExposure : 0,
    exceptionsToSeventyPercent,
    seventyPercentHeadShare: exceptions.length > 0 ? exceptionsToSeventyPercent / exceptions.length : 0,
    projectedFillRate: computeFillRate(input),
    inventoryValue,
    daysOnHand,
    excessObsoleteExposure: excessObsolete,
    expediteSpendMtd: computeExpediteSpend(input),
    autoResolvedPct: exceptions.length > 0 ? exceptions.filter((e) => e.autoResolvable).length / exceptions.length : 0,
    exceptionsByClass,
    exposureByClass,
  };
}

/**
 * Projected case fill rate: the share of independent demand quantity that the
 * plan can actually serve, measured against the projected balance on the day
 * each order is due.
 */
function computeFillRate(input: KpiInput): number {
  let promised = 0;
  let servable = 0;

  for (const demand of input.snapshot.demand) {
    if (demand.type !== 'SALES_ORDER') continue;
    const plan = input.plans.get(planKey(demand.itemId, demand.plantId));
    if (!plan) continue;

    const day = clampToHorizon(
      daysFromPlanningDate(demand.requiredDate, input.index.planningEpochDay),
      plan.projectedAvailable.length - 1
    );
    promised += demand.qty;

    // Judged on what will actually arrive, not on what the plan scheduled.
    const balance = plan.projectedAvailableFeasible[day] as number;
    if (balance >= 0) {
      servable += demand.qty;
    } else {
      // A negative balance on the due date means part of that day's demand
      // cannot be met; attribute the shortfall proportionally.
      const dayDemand = plan.grossRequirements[day] as number;
      const shortfall = Math.min(Math.abs(balance), dayDemand);
      const servableShare = dayDemand > 0 ? 1 - shortfall / dayDemand : 0;
      servable += demand.qty * Math.max(0, servableShare);
    }
  }

  return promised > 0 ? servable / promised : 1;
}

/** Premium freight already committed on open supply inside the current month. */
function computeExpediteSpend(input: KpiInput): number {
  const monthPrefix = input.options.planningDate.slice(0, 7);
  let total = 0;

  for (const supply of input.snapshot.supply) {
    if (supply.type !== 'PO' || !supply.vendorId) continue;
    if (supply.releaseDate.slice(0, 7) !== monthPrefix) continue;

    const vendors = input.index.vendorsByKey.get(planKey(supply.itemId, supply.plantId));
    const vendor = vendors?.find((v) => v.vendorId === supply.vendorId);
    if (!vendor || !vendor.expediteAvailable || vendor.expediteUnitPriceUplift === null) continue;

    // A PO released with a shorter lead time than the vendor's standard was expedited.
    const actualLeadDays = daysBetweenIso(supply.releaseDate, supply.dueDate);
    if (actualLeadDays >= vendor.leadTimeDays) continue;
    total += supply.qty * vendor.unitPrice * vendor.expediteUnitPriceUplift;
  }

  return total;
}

function daysFromPlanningDate(iso: string, planningEpochDay: number): number {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000) - planningEpochDay;
}

function daysBetweenIso(from: string, to: string): number {
  return daysFromPlanningDate(to, 0) - daysFromPlanningDate(from, 0);
}

function clampToHorizon(day: number, horizon: number): number {
  if (day < 0) return 0;
  return day > horizon ? horizon : day;
}
