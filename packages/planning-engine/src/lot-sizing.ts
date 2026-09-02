/**
 * Lot sizing — turning a net requirement into an order quantity.
 *
 * The five rules are the ones planners actually recognise. The order the
 * post-adjustments apply in matters, and it is not the order that reads most
 * naturally:
 *
 *   rule → scrap → reconcile both increments → split by max lot
 *
 * Scrap comes early because yield loss applies to the whole quantity, and
 * inflating *after* a max-lot split pushes every slice above the ceiling the
 * split existed to respect — a 4,000 MT slice at 10% scrap is 4,444 MT against a
 * 4,000 MT maximum. Reconciling the vendor increment and the material rounding
 * value together, rather than applying one and then the other, is what stops the
 * second silently breaking the first. And the split comes last so it can
 * *construct* slices that satisfy every constraint at once, rather than cutting
 * at the ceiling and discovering the remainder falls below the minimum.
 *
 * Every adjustment records what it did, in `trace`. That trace is the only
 * account of the quantity anything else is allowed to show: re-deriving the
 * arithmetic downstream is how the explain drawer came to print `1 + 385 + 14`
 * under a total of `800`.
 */

import type { ItemPlant, LotSizeRule, LotSizingConflict, LotSizingStep } from '@repo/domain';

export type { LotSizingConflict, LotSizingStep, LotSizingStepKind } from '@repo/domain';

/** Annual cost of holding one rupee of stock, as a fraction. */
const HOLDING_RATE = 0.22;

/** Fixed cost of raising one order, used by the EOQ rule. */
const ORDER_COST = 5000;

/** Quantities closer than this are the same quantity. */
const QTY_EPSILON = 1e-6;

/** How far to search for a quantity satisfying two different increments. */
const MAX_RECONCILE_STEPS = 1000;

/** Backstop against a pathological max lot size producing endless slices. */
const MAX_SLICES = 500;

export interface LotSizingInput {
  rule: LotSizeRule;
  /** Quantity needed at `day` to bring the balance back to the threshold. */
  netRequirement: number;
  itemPlant: ItemPlant;
  standardCost: number;
  /** Bucket the requirement falls in. */
  day: number;
  horizonDays: number;
  grossRequirements: Float64Array;
  scheduledReceipts: Float64Array;
  /** Planned receipts raised so far in this walk. POQ must see them. */
  plannedReceipts: Float64Array;
  /**
   * The planning threshold on a given day — a function, not a scalar, so a
   * seasonal norm cannot silently break POQ once `normByBucket` is wired.
   */
  thresholdAt: (day: number) => number;
  /** Projected available balance at `day`, after this bucket's top-up. */
  projectedAvailable: number;
  /** Minimum order quantity from the effective vendor; 0 when none applies. */
  moq: number;
  /** Vendor increment quantity; 0 when none applies. */
  incrementQty: number;
}

export interface LotSizingOutput {
  /** What the rule itself chose, before scrap, increments and splitting. */
  ruleQty: number;
  /** The reconciled total, before it was split. Slices sum to this. */
  finalOrderQuantity: number;
  /** Final quantities. More than one means a split. */
  orderQtys: number[];
  /** Last day this order is intended to cover — POQ's period end. */
  coversThroughDay: number;
  trace: LotSizingStep[];
  conflicts: LotSizingConflict[];
}

/**
 * Economic order quantity. `D` is annualised from the horizon so a 180-day plan
 * and a 90-day plan give the same answer for the same demand rate.
 */
export function economicOrderQuantity(
  annualDemand: number,
  standardCost: number,
  orderCost = ORDER_COST,
  holdingRate = HOLDING_RATE
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

function ceilTo(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.ceil((value - QTY_EPSILON) / step) * step;
}

function isMultipleOf(value: number, step: number): boolean {
  if (step <= 0) return true;
  const ratio = value / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-6;
}

/**
 * The smallest quantity at or above `floorQty` that is a whole multiple of both
 * increments.
 *
 * Applying one and then the other does not give this: rounding 786 up to a
 * multiple of 25 gives 800, which is not a multiple of 30. Where no common
 * multiple exists within a sane search, that is a master-data conflict and is
 * reported as one rather than resolved by preferring whichever ran last.
 */
function reconcileIncrements(floorQty: number, a: number, b: number): { qty: number; resolved: boolean } {
  if (a <= 0 && b <= 0) return { qty: floorQty, resolved: true };
  if (a <= 0) return { qty: ceilTo(floorQty, b), resolved: true };
  if (b <= 0) return { qty: ceilTo(floorQty, a), resolved: true };

  const larger = Math.max(a, b);
  const smaller = Math.min(a, b);
  let qty = ceilTo(floorQty, larger);
  for (let step = 0; step < MAX_RECONCILE_STEPS; step += 1) {
    if (isMultipleOf(qty, smaller)) return { qty, resolved: true };
    qty += larger;
  }
  return { qty: ceilTo(floorQty, larger), resolved: false };
}

/**
 * Cut `total` into slices that each satisfy every constraint at once.
 *
 * Not `min(remaining, maxLotSize)` in a loop: that leaves a remainder which can
 * fall below the minimum order quantity or off the increment, and no amount of
 * checking afterwards can repair it. Slices are built at the minimum and the
 * spare distributed, so every one lands in `[lowerBound, maxLotSize]` and on the
 * increment.
 */
function buildSlices(
  total: number,
  maxLotSize: number | null,
  step: number,
  lowerBound: number
): { slices: number[]; ok: boolean } {
  if (maxLotSize === null || maxLotSize <= 0 || total <= maxLotSize + QTY_EPSILON) {
    return { slices: [total], ok: true };
  }

  if (step > 0) {
    const units = Math.round(total / step);
    const maxUnits = Math.floor((maxLotSize + QTY_EPSILON) / step);
    const minUnits = Math.max(1, Math.ceil((lowerBound - QTY_EPSILON) / step));
    if (maxUnits < 1 || minUnits > maxUnits) return { slices: [], ok: false };

    const count = Math.ceil(units / maxUnits);
    if (count > MAX_SLICES || count * minUnits > units) return { slices: [], ok: false };

    const sliceUnits = new Array<number>(count).fill(minUnits);
    let spare = units - count * minUnits;
    for (let index = 0; index < count && spare > 0; index += 1) {
      const give = Math.min(maxUnits - minUnits, spare);
      sliceUnits[index] = (sliceUnits[index] as number) + give;
      spare -= give;
    }
    if (spare > 0) return { slices: [], ok: false };
    return { slices: sliceUnits.map((unit) => unit * step), ok: true };
  }

  const count = Math.ceil(total / maxLotSize);
  if (count > MAX_SLICES) return { slices: [], ok: false };

  // With no increment to honour, fill each order to the maximum and leave the
  // remainder last — 400, 400, 200 rather than three orders of 333.33, which is
  // what a planner expects to see on a schedule. Spreading evenly is the
  // fallback for when that remainder would fall below the minimum.
  const greedy: number[] = [];
  let remaining = total;
  while (remaining > QTY_EPSILON && greedy.length < MAX_SLICES) {
    const slice = Math.min(remaining, maxLotSize);
    greedy.push(slice);
    remaining -= slice;
  }
  if (greedy.length > 0 && (greedy[greedy.length - 1] as number) >= lowerBound - QTY_EPSILON) {
    return { slices: greedy, ok: true };
  }

  const each = total / count;
  if (each < lowerBound - QTY_EPSILON) return { slices: [], ok: false };
  return { slices: new Array<number>(count).fill(each), ok: true };
}

export function applyLotSizing(input: LotSizingInput): LotSizingOutput {
  const { rule, netRequirement, itemPlant, standardCost, day, horizonDays } = input;
  const { fixedLotSize, minLotSize, maxLotSize, roundingValue, periodsOfSupplyDays, scrapPct } = itemPlant;

  const trace: LotSizingStep[] = [];
  const conflicts: LotSizingConflict[] = [];
  const push = (step: LotSizingStep): void => {
    trace.push(step);
  };

  let ruleQty = netRequirement;
  let coversThroughDay = day;
  let ruleSource = 'Lot-for-lot — the requirement itself';
  let ruleParameter: number | null = null;

  switch (rule) {
    case 'LFL': {
      ruleQty = netRequirement;
      break;
    }
    case 'FOQ': {
      const lot = fixedLotSize && fixedLotSize > 0 ? fixedLotSize : 0;
      ruleQty = lot > 0 ? Math.ceil(netRequirement / lot) * lot : netRequirement;
      ruleParameter = lot > 0 ? lot : null;
      ruleSource = lot > 0 ? `Fixed order quantity ${lot}` : 'Fixed order quantity, unmaintained';
      break;
    }
    case 'POQ': {
      // Cover this shortage plus whatever the rest of the period cannot cover
      // for itself, so the item is touched once per period rather than once per
      // shortage.
      //
      // The balance is rolled forward across the period rather than each day
      // being floored at zero independently. Flooring per day throws away every
      // day a receipt exceeds that day's demand, so supply already on the water
      // stops counting: on RM-30137 it discarded 992 MT of scheduled inbound and
      // asked for 800 MT the material did not need.
      const periodDays = periodsOfSupplyDays && periodsOfSupplyDays > 0 ? periodsOfSupplyDays : 1;
      const lastDay = Math.min(day + periodDays - 1, horizonDays);
      // The walk starts from the threshold, because that is where this bucket's
      // own top-up leaves the balance. Starting from the pre-order balance would
      // count this bucket's shortfall a second time.
      let running = input.thresholdAt(day);
      let deficit = 0;
      for (let t = day + 1; t <= lastDay; t += 1) {
        running +=
          (input.scheduledReceipts[t] as number) +
          (input.plannedReceipts[t] as number) -
          (input.grossRequirements[t] as number);
        deficit = Math.max(deficit, input.thresholdAt(t) - running);
      }
      ruleQty = netRequirement + Math.max(0, deficit);
      coversThroughDay = lastDay;
      ruleParameter = periodDays;
      ruleSource = `Period of supply, ${periodDays} days`;
      break;
    }
    case 'MINMAX': {
      // The minimum acts as a reorder point; the maximum is the order-up-to level.
      const min = minLotSize && minLotSize > 0 ? minLotSize : 0;
      const max = maxLotSize && maxLotSize > 0 ? maxLotSize : min;
      const target = max > 0 ? max : netRequirement;
      ruleQty = Math.max(target - input.projectedAvailable, netRequirement);
      ruleParameter = target > 0 ? target : null;
      ruleSource = `Order-up-to level ${target}`;
      break;
    }
    case 'EOQ': {
      let horizonDemand = 0;
      for (let t = 0; t <= horizonDays; t += 1) horizonDemand += input.grossRequirements[t] as number;
      const annualised = horizonDays > 0 ? (horizonDemand * 365) / horizonDays : 0;
      const eoq = economicOrderQuantity(annualised, standardCost);
      ruleQty = clamp(eoq > 0 ? eoq : netRequirement, minLotSize, maxLotSize);
      if (ruleQty < netRequirement) ruleQty = netRequirement;
      ruleSource = 'Economic order quantity';
      break;
    }
  }

  push({
    kind: 'RULE',
    beforeQty: netRequirement,
    afterQty: ruleQty,
    deltaQty: ruleQty - netRequirement,
    sliceQtys: null,
    parameter: ruleParameter,
    source: ruleSource,
    applied: true,
    changedQuantity: Math.abs(ruleQty - netRequirement) > QTY_EPSILON,
    changedShape: false,
    binding: Math.abs(ruleQty - netRequirement) > QTY_EPSILON,
  });

  let qty = ruleQty;

  // Scrap first: yield loss applies to the whole quantity, and inflating after
  // the split is what pushed slices above their own maximum.
  if (scrapPct > 0 && scrapPct < 1) {
    const before = qty;
    qty = qty / (1 - scrapPct);
    push({
      kind: 'SCRAP',
      beforeQty: before,
      afterQty: qty,
      deltaQty: qty - before,
      sliceQtys: null,
      parameter: scrapPct,
      source: 'SAP material master — yield loss',
      applied: true,
      changedQuantity: Math.abs(qty - before) > QTY_EPSILON,
      changedShape: false,
      binding: Math.abs(qty - before) > QTY_EPSILON,
    });
  }

  // Floors, each recorded whether or not it bound, so a vendor minimum and a
  // material minimum that duplicate each other both stay visible.
  if (input.moq > 0) {
    const before = qty;
    if (qty < input.moq - QTY_EPSILON) qty = input.moq;
    push({
      kind: 'VENDOR_MOQ',
      beforeQty: before,
      afterQty: qty,
      deltaQty: qty - before,
      sliceQtys: null,
      parameter: input.moq,
      source: 'Vendor master',
      applied: true,
      changedQuantity: qty - before > QTY_EPSILON,
      changedShape: false,
      binding: qty - before > QTY_EPSILON,
    });
  }
  if (minLotSize !== null && minLotSize > 0) {
    const before = qty;
    if (qty < minLotSize - QTY_EPSILON) qty = minLotSize;
    push({
      kind: 'MIN_LOT',
      beforeQty: before,
      afterQty: qty,
      deltaQty: qty - before,
      sliceQtys: null,
      parameter: minLotSize,
      source: 'SAP material master',
      applied: true,
      changedQuantity: qty - before > QTY_EPSILON,
      changedShape: false,
      binding: qty - before > QTY_EPSILON,
    });
  }

  // The two increments are reconciled together, so the second cannot break what
  // the first established.
  const vendorIncrement = input.incrementQty > 0 ? input.incrementQty : 0;
  const materialRounding = roundingValue !== null && roundingValue > 0 ? roundingValue : 0;
  if (vendorIncrement > 0 || materialRounding > 0) {
    const before = qty;
    const reconciled = reconcileIncrements(qty, vendorIncrement, materialRounding);
    qty = reconciled.qty;
    if (!reconciled.resolved) {
      conflicts.push({
        kind: 'INCOMPATIBLE_INCREMENTS',
        detail: `A vendor increment of ${vendorIncrement} and a rounding value of ${materialRounding} share no common multiple within reach. The vendor increment was honoured.`,
      });
    }

    if (vendorIncrement > 0) {
      push({
        kind: 'VENDOR_INCREMENT',
        beforeQty: before,
        afterQty: qty,
        deltaQty: qty - before,
        sliceQtys: null,
        parameter: vendorIncrement,
        source: 'Vendor master',
        applied: true,
        changedQuantity: qty - before > QTY_EPSILON,
        changedShape: false,
        binding: !isMultipleOf(before, vendorIncrement),
      });
    }
    if (materialRounding > 0) {
      push({
        kind: 'ROUNDING',
        beforeQty: vendorIncrement > 0 ? qty : before,
        afterQty: qty,
        deltaQty: vendorIncrement > 0 ? 0 : qty - before,
        sliceQtys: null,
        parameter: materialRounding,
        source: 'SAP material master',
        applied: true,
        changedQuantity: vendorIncrement > 0 ? false : qty - before > QTY_EPSILON,
        changedShape: false,
        binding: !isMultipleOf(before, materialRounding),
      });
    }
  }

  const finalOrderQuantity = qty;

  // The split constructs feasible slices rather than cutting and hoping.
  const sliceStep = (() => {
    if (vendorIncrement > 0 && materialRounding > 0) {
      const reconciled = reconcileIncrements(
        Math.max(vendorIncrement, materialRounding),
        vendorIncrement,
        materialRounding
      );
      return reconciled.resolved ? reconciled.qty : Math.max(vendorIncrement, materialRounding);
    }
    return Math.max(vendorIncrement, materialRounding);
  })();
  const sliceFloor = Math.max(input.moq > 0 ? input.moq : 0, minLotSize !== null && minLotSize > 0 ? minLotSize : 0);

  const partition = buildSlices(finalOrderQuantity, maxLotSize, sliceStep, sliceFloor);
  let orderQtys = partition.slices;
  if (!partition.ok) {
    conflicts.push({
      kind: 'NO_FEASIBLE_PARTITION',
      detail: `${finalOrderQuantity} cannot be split into orders that respect a maximum lot of ${maxLotSize} while each stays at or above ${sliceFloor} and on a ${sliceStep} increment. Raised as one order.`,
    });
    orderQtys = [finalOrderQuantity];
  }

  if (maxLotSize !== null && maxLotSize > 0) {
    push({
      kind: 'MAX_LOT_SPLIT',
      beforeQty: finalOrderQuantity,
      afterQty: finalOrderQuantity,
      deltaQty: 0,
      sliceQtys: orderQtys.slice(),
      parameter: maxLotSize,
      source: 'SAP material master',
      applied: true,
      changedQuantity: false,
      changedShape: orderQtys.length > 1,
      binding: orderQtys.length > 1,
    });
  }

  return { ruleQty, finalOrderQuantity, orderQtys, coversThroughDay, trace, conflicts };
}

/** The effective rule, defaulting to lot-for-lot when unmaintained. */
export function effectiveLotSizeRule(itemPlant: ItemPlant): LotSizeRule {
  return itemPlant.lotSizeRule ?? 'LFL';
}
