/**
 * Impact valuation — why one exception ranks above another.
 *
 * Sorting by severity is table stakes; every planning system does it. Sorting by
 * money is the product. Each component below is computed from pegged facts, and
 * every coefficient lives in `IMPACT_CONFIG` so it can be opened and shown
 * rather than defended from memory.
 *
 * The exposure ratio matters more than it looks. A shortage of 2,000 kg of a
 * component does not put every order that component touches at risk — only the
 * share the shortfall actually represents. Valuing the whole pegged chain would
 * produce enormous, indefensible numbers.
 */

import { type DemandElement, IMPACT_CONFIG, type ImpactBreakdown } from '@repo/domain';

export interface ImpactInput {
  /** Probability the pegged demand is genuinely missed, 0–1. */
  probabilityOfMiss: number;
  /** Share of the pegged value the shortfall actually exposes, 0–1. */
  exposureRatio: number;
  /** Independent-demand leaves reachable from this exception. */
  peggedDemand: DemandElement[];
  /** Quantity beyond the excess-cover threshold. */
  excessQty: number;
  /** Quantity at risk of expiring before use. */
  obsolescenceQty: number;
  /** Premium the cheapest recovery would cost. */
  expediteCost: number;
  standardCost: number;
}

export function valueException(input: ImpactInput): ImpactBreakdown {
  const ratio = clamp01(input.exposureRatio);
  const probability = clamp01(input.probabilityOfMiss);

  let revenue = 0;
  let margin = 0;
  for (const demand of input.peggedDemand) {
    revenue += demand.qty * demand.pricePerUnit;
    margin += demand.qty * demand.marginPerUnit;
  }

  const revenueAtRisk = revenue * ratio * probability;
  const marginAtRisk = margin * ratio * (IMPACT_CONFIG.applyProbabilityToMargin ? probability : 1);
  const excessInventoryValue = Math.max(0, input.excessQty) * input.standardCost;
  const obsolescenceExposure = Math.max(0, input.obsolescenceQty) * input.standardCost;
  const expediteCostExposure = Math.max(0, input.expediteCost);

  return {
    revenueAtRisk,
    marginAtRisk,
    excessInventoryValue,
    expediteCostExposure,
    obsolescenceExposure,
    total: revenueAtRisk + marginAtRisk + excessInventoryValue + expediteCostExposure + obsolescenceExposure,
  };
}

export function emptyImpact(): ImpactBreakdown {
  return {
    revenueAtRisk: 0,
    marginAtRisk: 0,
    excessInventoryValue: 0,
    expediteCostExposure: 0,
    obsolescenceExposure: 0,
    total: 0,
  };
}

/**
 * Probability of miss for a shortage, which turns on whether there is still
 * time to react. Inside the replenishment lead time there is not.
/**
 * The fraction of the horizon a recovery window represents.
 *
 * Pegged demand is traced across the whole horizon, but an exception only
 * threatens the orders inside its own window. Every exposure ratio must be
 * scaled by this or a three-week problem gets valued against six months of
 * committed revenue.
 *
 * Windows are capped: on a long-lead material the arithmetic window can run to a
 * quarter, but no planner leaves a known shortage untouched that long. Beyond
 * the cap the exposure is a re-planning problem, not a loss.
 */
export const MAX_EXPOSURE_WINDOW_DAYS = 45;

export function windowShare(windowDays: number, horizonDays: number): number {
  if (horizonDays <= 0) return 0;
  const capped = Math.min(Math.max(0, windowDays), MAX_EXPOSURE_WINDOW_DAYS);
  return Math.min(1, capped / horizonDays);
}

export function stockoutProbability(shortageDay: number, leadTimeDays: number): number {
  return shortageDay <= leadTimeDays
    ? IMPACT_CONFIG.probabilityOfMiss.stockoutInsideLeadTime
    : IMPACT_CONFIG.probabilityOfMiss.stockoutOutsideLeadTime;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
