/**
 * Lot sizing — turning a net requirement into an order quantity.
 *
 * The five rules are the ones planners actually recognise, and the order in
 * which the post-adjustments apply matters: MOQ first, then rounding, then a
 * max-lot-size split, and only then scrap inflation. Applying scrap before
 * rounding, for instance, produces quantities that are not multiples of the
 * rounding value, which a planner spots immediately.
 */

import { IMPACT_CONFIG, type ItemPlant, type LotSizeRule } from '@repo/domain';

export interface LotSizingInput {
  rule: LotSizeRule;
  /** Quantity needed at `day` to bring the balance back to safety stock. */
  netRequirement: number;
  itemPlant: ItemPlant;
  standardCost: number;
  /** Bucket the requirement falls in. */
  day: number;
  horizonDays: number;
  grossRequirements: Float64Array;
  scheduledReceipts: Float64Array;
  /** Projected available balance at `day`, before this order. Used by MINMAX. */
  projectedAvailable: number;
  /** Minimum order quantity from the effective vendor; 0 when none applies. */
  moq: number;
  /** Vendor increment quantity; 0 when none applies. */
  incrementQty: number;
}

export interface LotSizingOutput {
  /** What the rule itself chose, before MOQ, rounding, splitting and scrap. */
  ruleQty: number;
  /** Final quantities after scrap inflation. More than one means a split. */
  orderQtys: number[];
  /** Last day this order is intended to cover — POQ's period end. */
  coversThroughDay: number;
}

/**
 * Economic order quantity. `D` is annualised from the horizon so a 180-day plan
 * and a 90-day plan give the same answer for the same demand rate.
 */
export function economicOrderQuantity(
  annualDemand: number,
  standardCost: number,
  orderCost = IMPACT_CONFIG.orderCost,
  holdingRate = IMPACT_CONFIG.holdingRate
): number {
  if (annualDemand <= 0 || standardCost <= 0 || holdingRate <= 0) return 0;
  return Math.sqrt((2 * annualDemand * orderCost) / (holdingRate * standardCost));
}

function clamp(value: number, min: number | null, max: number | null): number {
  let result = value;
  if (min !== null && min > 0 && result < min) result = min;
  if (max !== null && max > 0 && result > max) result = max;
  return result;
}

export function applyLotSizing(input: LotSizingInput): LotSizingOutput {
  const { rule, netRequirement, itemPlant, standardCost, day, horizonDays } = input;
  const { fixedLotSize, minLotSize, maxLotSize, roundingValue, periodsOfSupplyDays, scrapPct } = itemPlant;

  let ruleQty = netRequirement;
  let coversThroughDay = day;

  switch (rule) {
    case 'LFL': {
      ruleQty = netRequirement;
      break;
    }
    case 'FOQ': {
      const lot = fixedLotSize && fixedLotSize > 0 ? fixedLotSize : 0;
      ruleQty = lot > 0 ? Math.ceil(netRequirement / lot) * lot : netRequirement;
      break;
    }
    case 'POQ': {
      // Cover this shortage plus the net demand of the rest of the period, so
      // the item is touched once per period rather than once per shortage.
      const periodDays = periodsOfSupplyDays && periodsOfSupplyDays > 0 ? periodsOfSupplyDays : 1;
      const lastDay = Math.min(day + periodDays - 1, horizonDays);
      let lookahead = 0;
      for (let t = day + 1; t <= lastDay; t += 1) {
        const net = (input.grossRequirements[t] as number) - (input.scheduledReceipts[t] as number);
        if (net > 0) lookahead += net;
      }
      ruleQty = netRequirement + lookahead;
      coversThroughDay = lastDay;
      break;
    }
    case 'MINMAX': {
      // The minimum acts as a reorder point; the maximum is the order-up-to level.
      const min = minLotSize && minLotSize > 0 ? minLotSize : 0;
      const max = maxLotSize && maxLotSize > 0 ? maxLotSize : min;
      const target = max > 0 ? max : netRequirement;
      ruleQty = Math.max(target - input.projectedAvailable, netRequirement);
      break;
    }
    case 'EOQ': {
      let horizonDemand = 0;
      for (let t = 0; t <= horizonDays; t += 1) horizonDemand += input.grossRequirements[t] as number;
      const annualised = horizonDays > 0 ? (horizonDemand * 365) / horizonDays : 0;
      const eoq = economicOrderQuantity(annualised, standardCost);
      ruleQty = clamp(eoq > 0 ? eoq : netRequirement, minLotSize, maxLotSize);
      if (ruleQty < netRequirement) ruleQty = netRequirement;
      break;
    }
  }

  // Post-adjustments, in order: MOQ → vendor increment → min lot → rounding.
  let qty = ruleQty;
  if (input.moq > 0 && qty < input.moq) qty = input.moq;
  if (input.incrementQty > 0) qty = Math.ceil(qty / input.incrementQty) * input.incrementQty;
  if (minLotSize !== null && minLotSize > 0 && qty < minLotSize) qty = minLotSize;
  if (roundingValue !== null && roundingValue > 0) qty = Math.ceil(qty / roundingValue) * roundingValue;

  const orderQtys: number[] = [];
  if (maxLotSize !== null && maxLotSize > 0 && qty > maxLotSize) {
    // Split across consecutive working days rather than raising one order the
    // line or the vendor could not physically take.
    let remaining = qty;
    while (remaining > 0 && orderQtys.length < 500) {
      const slice = Math.min(remaining, maxLotSize);
      orderQtys.push(slice);
      remaining -= slice;
    }
  } else {
    orderQtys.push(qty);
  }

  // Scrap inflation last: yield loss applies to whatever is actually released.
  const yieldFactor = scrapPct > 0 && scrapPct < 1 ? 1 - scrapPct : 1;
  const inflated = yieldFactor === 1 ? orderQtys : orderQtys.map((q) => q / yieldFactor);

  return { ruleQty, orderQtys: inflated, coversThroughDay };
}

/** The effective rule, defaulting to lot-for-lot when unmaintained. */
export function effectiveLotSizeRule(itemPlant: ItemPlant): LotSizeRule {
  return itemPlant.lotSizeRule ?? 'LFL';
}
