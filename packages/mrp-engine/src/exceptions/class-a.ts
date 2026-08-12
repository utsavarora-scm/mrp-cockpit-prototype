/**
 * Class A — supply continuity.
 *
 * These are the exceptions every planning system already raises. What differs
 * here is that each one is valued: the ranking answers "which shortage costs
 * the most", not "which shortage is earliest".
 *
 * At most one A1 and one A2 per item-plant, at the first occurrence. A component
 * that dips below safety stock on sixty consecutive days is one problem, not
 * sixty, and flooding the queue would destroy the Pareto the product is built on.
 */

import {
  IMPACT_CONFIG,
  formatCurrency,
  formatDateShort,
  formatDays,
  formatQty,
  planKey,
  toEpochDay,
  type EvidenceFact,
  type ItemPlantPlan,
  type Severity,
  type SupplyElement,
} from '@repo/domain';

import { primaryVendor, resolveLeadTime } from '../run-mrp';
import { ExceptionContext, narrate } from './context';
import { MAX_EXPOSURE_WINDOW_DAYS, stockoutProbability, valueException, windowShare } from './impact';

export function detectClassA(ctx: ExceptionContext): void {
  detectBalanceExceptions(ctx);
  detectSupplyTimingExceptions(ctx);
  detectSupersededRequirements(ctx);
  detectOrdersInPast(ctx);
}

/**
 * A5 for requirements the engine declined to order for, because supply already
 * on the books covers them.
 *
 * The planned order would have landed earlier than the receipt that actually
 * covers the need, which is precisely a reschedule-out: the right action is not
 * to raise it. Reporting it matters — the covering receipt is usually sitting
 * later than it should, and silently netting to zero hides that.
 */
function detectSupersededRequirements(ctx: ExceptionContext): void {
  for (const requirements of ctx.index.supersededByKey.values()) {
    for (const requirement of requirements) {
      const item = ctx.item(requirement.itemId);
      const plan = ctx.plan(requirement.itemId, requirement.plantId);
      if (!item || !plan) continue;

      // Only worth reporting where the requirement could not have been ordered
      // for anyway. Where a new order was simply unnecessary, MRP declining to
      // raise one is correct behaviour, not a finding — and there are hundreds
      // of those in any healthy plan.
      if (requirement.wouldBeReleaseDay >= 0) continue;

      const gap = requirement.coveredByDay - requirement.day;
      const carryingCost = requirement.netRequirement * item.standardCost * IMPACT_CONFIG.holdingRate * (gap / 365);

      ctx.emit({
        code: 'A5-RESCHEDULE-OUT',
        severity: 'LOW',
        itemId: requirement.itemId,
        plantId: requirement.plantId,
        bucketDay: requirement.day,
        discriminator: `SUP${requirement.day}`,
        narrative: narrate([
          `A net requirement of ${formatQty(requirement.netRequirement, item.baseUom)} arises on day ${requirement.day} (${formatDateShort(ctx.dateOf(requirement.day))}), but receipts already on the books restore the buffer by day ${requirement.coveredByDay}.`,
          requirement.wouldBeReleaseDay < 0
            ? `A new order could not have been placed in time anyway — offsetting the lead time puts its release on day ${requirement.wouldBeReleaseDay}.`
            : `No new order is raised; the existing receipt covers it ${formatDays(gap)} later.`,
          `Pulling that receipt in would close the gap without adding supply.`,
        ]),
        evidence: [
          {
            kind: 'CALCULATION',
            label: 'Net requirement',
            value: formatQty(requirement.netRequirement, item.baseUom),
            detail: `day ${requirement.day}`,
          },
          {
            kind: 'CALCULATION',
            label: 'Covered by existing supply on',
            value: `day ${requirement.coveredByDay} · ${formatDateShort(ctx.dateOf(requirement.coveredByDay))}`,
          },
          {
            kind: 'CALCULATION',
            label: 'Release date a new order would need',
            value: `day ${requirement.wouldBeReleaseDay}`,
            detail:
              requirement.wouldBeReleaseDay < 0 ? 'Already in the past — the order was never placeable' : undefined,
            ref: { type: 'ITEM_PLANT', itemId: requirement.itemId, plantId: requirement.plantId },
          },
        ],
        impact: valueException({
          probabilityOfMiss: 0,
          exposureRatio: 0,
          peggedDemand: [],
          excessQty: 0,
          obsolescenceQty: 0,
          expediteCost: carryingCost,
          standardCost: item.standardCost,
        }),
      });
    }
  }
}

// ---------------------------------------------------------------------------

function detectBalanceExceptions(ctx: ExceptionContext): void {
  for (const [key, plan] of ctx.plans) {
    const itemPlant = ctx.index.itemPlantByKey.get(key);
    const item = ctx.item(plan.itemId);
    if (!itemPlant || !item || !itemPlant.isPlanningRelevant) continue;

    const threshold = plan.safetyStock;
    const horizon = ctx.horizonDays;
    const vendor = primaryVendor(ctx.index.vendorsByKey.get(key));
    const leadTime = resolveLeadTime(itemPlant, vendor, ctx.index.observedLeadTimes.get(key), false);

    let stockoutDay = -1;
    let breachDay = -1;
    let totalDemand = 0;

    for (let day = 0; day <= horizon; day += 1) {
      // A stockout is judged on what will actually arrive, not on what the plan
      // scheduled — an order that needed placing three weeks ago will not show up.
      const feasible = plan.projectedAvailableFeasible[day] as number;
      const scheduled = plan.projectedAvailable[day] as number;
      totalDemand += plan.grossRequirements[day] as number;
      if (stockoutDay === -1 && feasible < -1e-6) stockoutDay = day;
      if (breachDay === -1 && feasible >= -1e-6 && feasible < threshold - 1e-6) breachDay = day;
      void scheduled;
    }

    if (totalDemand <= 0) continue;

    if (stockoutDay >= 0) {
      // The deficit that matters is the one inside the recovery window. A balance
      // that keeps sliding for six months is one problem measured at its onset,
      // not a six-month shortfall.
      let worstInWindow = 0;
      const windowEnd = Math.min(stockoutDay + Math.min(Math.max(leadTime, 7), MAX_EXPOSURE_WINDOW_DAYS), horizon);
      for (let day = stockoutDay; day <= windowEnd; day += 1) {
        const balance = plan.projectedAvailableFeasible[day] as number;
        if (balance < worstInWindow) worstInWindow = balance;
      }
      emitStockout(ctx, plan, key, stockoutDay, worstInWindow, leadTime);
    }
    if (breachDay >= 0 && threshold > 0 && (stockoutDay === -1 || breachDay < stockoutDay)) {
      emitSafetyBreach(ctx, plan, key, breachDay, threshold, leadTime);
    }
    detectCoverage(ctx, plan, key);
  }
}

function emitStockout(
  ctx: ExceptionContext,
  plan: ItemPlantPlan,
  key: string,
  day: number,
  worstBalance: number,
  leadTimeDays: number
): void {
  const item = ctx.item(plan.itemId);
  if (!item) return;
  const shortage = Math.abs(Math.min(0, worstBalance));
  const pegged = ctx.peggedDemandFor(plan.itemId, plan.plantId);
  const probability = stockoutProbability(day, leadTimeDays);
  const exposureRatio = exposureRatioFor(plan, day, leadTimeDays, shortage);

  const consumedIn = windowSum(plan.grossRequirements, 0, day);
  const receivedIn = windowSum(plan.scheduledReceipts, 0, day) + windowSum(plan.plannedReceipts, 0, day);

  const evidence: EvidenceFact[] = [
    {
      kind: 'CALCULATION',
      label: 'Projected balance',
      value: `${formatQty(worstBalance, item.baseUom)} on day ${day}`,
      detail: `${formatDateShort(ctx.dateOf(day))} — first bucket below zero`,
      ref: { type: 'ITEM_PLANT', itemId: plan.itemId, plantId: plan.plantId },
    },
    { kind: 'RECORD', label: 'Opening unrestricted stock', value: formatQty(plan.openingStock, item.baseUom) },
    { kind: 'CALCULATION', label: 'Gross requirements to that day', value: formatQty(consumedIn, item.baseUom) },
    { kind: 'CALCULATION', label: 'Receipts to that day', value: formatQty(receivedIn, item.baseUom) },
    {
      kind: 'PARAMETER',
      label: 'Replenishment lead time',
      value: formatDays(leadTimeDays),
      detail:
        day <= leadTimeDays
          ? 'Shortage falls inside the lead time — no time to recover'
          : 'Shortage falls outside the lead time',
    },
  ];

  const impact = valueException({
    probabilityOfMiss: probability,
    exposureRatio,
    peggedDemand: pegged,
    excessQty: 0,
    obsolescenceQty: 0,
    expediteCost: expediteEstimate(ctx, key, shortage),
    standardCost: item.standardCost,
  });

  ctx.emit({
    code: 'A1-PROJECTED-STOCKOUT',
    severity: day <= leadTimeDays ? 'CRITICAL' : 'HIGH',
    itemId: plan.itemId,
    plantId: plan.plantId,
    bucketDay: day,
    narrative: narrate([
      `Projected balance falls to ${formatQty(worstBalance, item.baseUom)} on day ${day} (${formatDateShort(ctx.dateOf(day))}).`,
      `${formatQty(consumedIn, item.baseUom)} of requirements to that point are met by ${formatQty(plan.openingStock, item.baseUom)} on hand and ${formatQty(receivedIn, item.baseUom)} of receipts.`,
      day <= leadTimeDays
        ? `The gap opens inside the ${formatDays(leadTimeDays)} lead time, so no new order can recover it.`
        : `A new order placed now would arrive in ${formatDays(leadTimeDays)}, ahead of the gap.`,
      pegged.length > 0 ? `${pegged.length} independent demand elements peg to this item.` : '',
    ]),
    evidence,
    impact,
    peggedDemand: pegged,
  });
}

function emitSafetyBreach(
  ctx: ExceptionContext,
  plan: ItemPlantPlan,
  key: string,
  day: number,
  threshold: number,
  leadTimeDays: number
): void {
  const item = ctx.item(plan.itemId);
  if (!item) return;
  const balance = plan.projectedAvailableFeasible[day] as number;
  const shortfall = threshold - balance;
  const pegged = ctx.peggedDemandFor(plan.itemId, plan.plantId);
  const exposureRatio = exposureRatioFor(plan, day, leadTimeDays, shortfall);

  const impact = valueException({
    probabilityOfMiss: IMPACT_CONFIG.probabilityOfMiss.safetyStockBreach,
    exposureRatio,
    peggedDemand: pegged,
    excessQty: 0,
    obsolescenceQty: 0,
    expediteCost: 0,
    standardCost: item.standardCost,
  });

  ctx.emit({
    code: 'A2-SAFETY-STOCK-BREACH',
    severity: shortfall / Math.max(threshold, 1) > 0.5 ? 'HIGH' : 'MEDIUM',
    itemId: plan.itemId,
    plantId: plan.plantId,
    bucketDay: day,
    narrative: narrate([
      `Projected balance drops to ${formatQty(balance, item.baseUom)} on day ${day} (${formatDateShort(ctx.dateOf(day))}), ${formatQty(shortfall, item.baseUom)} below the maintained safety stock of ${formatQty(threshold, item.baseUom)}.`,
      `Cover remains positive, so this is a buffer erosion rather than a stockout.`,
    ]),
    evidence: [
      {
        kind: 'CALCULATION',
        label: 'Projected balance',
        value: `${formatQty(balance, item.baseUom)} on day ${day}`,
        detail: formatDateShort(ctx.dateOf(day)),
        ref: { type: 'ITEM_PLANT', itemId: plan.itemId, plantId: plan.plantId },
      },
      { kind: 'PARAMETER', label: 'Maintained safety stock', value: formatQty(threshold, item.baseUom) },
      { kind: 'CALCULATION', label: 'Shortfall against buffer', value: formatQty(shortfall, item.baseUom) },
    ],
    impact,
    peggedDemand: pegged,
  });
}

function detectCoverage(ctx: ExceptionContext, plan: ItemPlantPlan, key: string): void {
  const itemPlant = ctx.index.itemPlantByKey.get(key);
  const item = ctx.item(plan.itemId);
  if (!itemPlant || !item) return;
  const target = itemPlant.periodsOfSupplyDays;
  if (target === null || target <= 0) return;

  const cover = plan.daysOfCover[0] as number;
  if (cover >= target) return;

  const pegged = ctx.peggedDemandFor(plan.itemId, plan.plantId);
  const impact = valueException({
    probabilityOfMiss: IMPACT_CONFIG.probabilityOfMiss.safetyStockBreach,
    exposureRatio:
      Math.min(1, (target - cover) / target) *
      windowShare(target, ctx.horizonDays) *
      ctx.consequenceFactor(plan.itemId, plan.plantId),
    peggedDemand: pegged,
    excessQty: 0,
    obsolescenceQty: 0,
    expediteCost: 0,
    standardCost: item.standardCost,
  });

  ctx.emit({
    code: 'A3-COVERAGE-BELOW-TARGET',
    severity: 'LOW',
    itemId: plan.itemId,
    plantId: plan.plantId,
    bucketDay: 0,
    narrative: narrate([
      `Forward cover today is ${formatDays(cover)} against a target of ${formatDays(target)}.`,
      `Opening stock of ${formatQty(plan.openingStock, item.baseUom)} runs out ${formatDays(target - cover)} short of the intended period of supply.`,
    ]),
    evidence: [
      { kind: 'CALCULATION', label: 'Forward days of cover', value: formatDays(cover) },
      { kind: 'PARAMETER', label: 'Periods of supply target', value: formatDays(target) },
      { kind: 'RECORD', label: 'Opening unrestricted stock', value: formatQty(plan.openingStock, item.baseUom) },
    ],
    impact,
    peggedDemand: pegged,
  });
}

// ---------------------------------------------------------------------------

function detectSupplyTimingExceptions(ctx: ExceptionContext): void {
  const planningDate = ctx.options.planningDate;

  for (const supply of ctx.snapshot.supply) {
    const key = planKey(supply.itemId, supply.plantId);
    const plan = ctx.plans.get(key);
    const item = ctx.item(supply.itemId);
    if (!plan || !item) continue;

    // A7 — still open, already late.
    if (supply.dueDate < planningDate) {
      emitPastDue(ctx, supply, plan, item.baseUom, item.standardCost, planningDate);
      continue;
    }

    const day = dayOf(ctx, supply.dueDate);
    if (day === null) continue;

    // A6 — nothing in the horizon is waiting for this, and the position ends
    // the horizon in surplus even without it. Unpegged alone is not enough:
    // FIFO allocation leaves the last receipt of a healthy item unpegged too.
    if (!ctx.pegging.supplyToDemand.has(supply.id)) {
      // Unpegged alone is not enough. FIFO allocation always leaves the last
      // receipt of a perfectly healthy item unpegged, because the demand it
      // would cover falls beyond the horizon. The receipt is only genuinely
      // excess if the position still ends the horizon comfortably clear of
      // safety stock without it.
      // Measured on the committed position — opening stock plus receipts that
      // exist — not on the post-planning balance, which MRP has already topped
      // up with orders of its own.
      const closingBalance = committedClosingBalance(plan);
      const coverThreshold = averageDailyDemand(plan.grossRequirements) * IMPACT_CONFIG.excessCoverThresholdDays;
      const withoutIt = closingBalance - supply.qty;
      // Only the quantity beyond the excess-cover threshold counts as excess —
      // ending the horizon with a quarter's cover is prudent, not wasteful.
      const surplus = Math.min(supply.qty, Math.max(0, withoutIt - plan.safetyStock - coverThreshold));
      if (surplus * item.standardCost >= MIN_CANCEL_VALUE) {
        emitCancelExcess(ctx, supply, item.baseUom, item.standardCost, day, surplus);
      }
      continue;
    }

    // A5 — arrives well before anything needs it.
    //
    // Judged against the position *already committed* — opening stock plus
    // receipts that exist — not against the post-planning balance. MRP has by
    // then planned the balance flat, so comparing against it would flag almost
    // every receipt in the book as early.
    const daysEarly = daysEarlierThanNeeded(plan, day, supply.qty);
    if (daysEarly !== null) {
      emitRescheduleOut(ctx, supply, item.baseUom, item.standardCost, day, daysEarly);
      continue;
    }

    // A4 — arrives after the position has genuinely run out.
    //
    // Measured against the honest balance going below zero, not against a dip
    // under safety stock. A buffer dip that the plan already covers with an
    // orderable receipt needs no intervention; pulling supply in is only worth a
    // planner's time where the alternative is running out.
    const breach = firstStockoutBefore(plan, day);
    if (breach !== null) {
      emitRescheduleIn(ctx, supply, item.baseUom, day, breach);
    }
  }
}

/**
 * How many days earlier than necessary a receipt arrives, or null when it is
 * not early enough to be worth a planner's attention.
 *
 * The balance walked here counts only opening stock and receipts that already
 * exist, minus requirements — deliberately excluding anything the engine planned
 * this run.
 */
function daysEarlierThanNeeded(plan: ItemPlantPlan, arrivalDay: number, qty: number): number | null {
  const horizon = plan.grossRequirements.length - 1;
  const threshold = plan.safetyStock;
  const limit = IMPACT_CONFIG.reschedule.earlyDaysThreshold;

  let committed = plan.openingStock;
  for (let day = 0; day <= horizon; day += 1) {
    committed += (plan.scheduledReceipts[day] as number) - (plan.grossRequirements[day] as number);
    // Once past the arrival day, ask what the position would be without it.
    const without = day >= arrivalDay ? committed - qty : committed;
    if (without < threshold - 1e-6) {
      const daysEarly = day - arrivalDay;
      return daysEarly > limit ? daysEarly : null;
    }
  }
  // Never needed inside the horizon at all — that is A6's territory, not A5's.
  return null;
}

function firstStockoutBefore(plan: ItemPlantPlan, arrivalDay: number): number | null {
  for (let day = 0; day < arrivalDay; day += 1) {
    if ((plan.projectedAvailableFeasible[day] as number) < -1e-6) return day;
  }
  return null;
}

function emitPastDue(
  ctx: ExceptionContext,
  supply: SupplyElement,
  plan: ItemPlantPlan,
  uom: string,
  standardCost: number,
  planningDate: string
): void {
  const daysLate = ctx.planningEpochDay - toEpochDay(supply.dueDate);
  const pegged = ctx.peggedDemandFor(supply.itemId, supply.plantId);

  ctx.emit({
    code: 'A7-PAST-DUE-SUPPLY',
    severity: daysLate > 14 ? 'HIGH' : 'MEDIUM',
    itemId: supply.itemId,
    plantId: supply.plantId,
    bucketDay: 0,
    discriminator: supply.id,
    narrative: narrate([
      `${supply.type.replace('_', ' ').toLowerCase()} ${supply.id} for ${formatQty(supply.qty, uom)} was due ${formatDateShort(supply.dueDate)} and is still open, ${formatDays(daysLate)} past due as at ${formatDateShort(planningDate)}.`,
      `The plan counts it in the first bucket, which overstates availability until it is confirmed.`,
    ]),
    evidence: [
      {
        kind: 'RECORD',
        label: 'Supply element',
        value: `${supply.id} · ${formatQty(supply.qty, uom)}`,
        detail: `Due ${formatDateShort(supply.dueDate)} · ${supply.sourceSystem}`,
        ref: { type: 'SUPPLY_ELEMENT', supplyElementId: supply.id },
      },
      { kind: 'CALCULATION', label: 'Days past due', value: formatDays(daysLate) },
      ...(supply.vendorId
        ? [
            {
              kind: 'RECORD' as const,
              label: 'Vendor',
              value: supply.vendorId,
              ref: { type: 'VENDOR' as const, vendorId: supply.vendorId },
            },
          ]
        : []),
    ],
    impact: valueException({
      probabilityOfMiss: IMPACT_CONFIG.probabilityOfMiss.safetyStockBreach,
      exposureRatio:
        Math.min(1, supply.qty / Math.max(1, windowSum(plan.grossRequirements, 0, 30))) *
        windowShare(30, ctx.horizonDays) *
        ctx.consequenceFactor(supply.itemId, supply.plantId),
      peggedDemand: pegged,
      excessQty: 0,
      obsolescenceQty: 0,
      expediteCost: 0,
      standardCost,
    }),
    peggedDemand: pegged,
  });
}

function emitCancelExcess(
  ctx: ExceptionContext,
  supply: SupplyElement,
  uom: string,
  standardCost: number,
  day: number,
  surplusQty: number
): void {
  ctx.emit({
    code: 'A6-CANCEL-EXCESS',
    severity: 'MEDIUM',
    itemId: supply.itemId,
    plantId: supply.plantId,
    bucketDay: day,
    discriminator: supply.id,
    narrative: narrate([
      `${supply.id} brings ${formatQty(supply.qty, uom)} on ${formatDateShort(supply.dueDate)} with no demand pegged to it anywhere in the ${ctx.horizonDays}-day horizon.`,
      `Cancelling releases ${formatCurrency(supply.qty * standardCost)} of committed inventory value.`,
    ]),
    evidence: [
      {
        kind: 'RECORD',
        label: 'Unpegged supply',
        value: `${supply.id} · ${formatQty(supply.qty, uom)}`,
        detail: `Due ${formatDateShort(supply.dueDate)}`,
        ref: { type: 'SUPPLY_ELEMENT', supplyElementId: supply.id },
      },
      { kind: 'CALCULATION', label: 'Pegged demand elements', value: '0' },
      { kind: 'CALCULATION', label: 'Inventory value released', value: formatCurrency(supply.qty * standardCost) },
    ],
    impact: valueException({
      probabilityOfMiss: 0,
      exposureRatio: 0,
      peggedDemand: [],
      excessQty: supply.qty,
      obsolescenceQty: 0,
      expediteCost: 0,
      standardCost,
    }),
  });
}

/** Below this, an early receipt is not worth a planner's attention. */
const MIN_CARRYING_COST_TO_REPORT = 350;

/** Below this, cancelling a surplus receipt frees too little to be worth raising. */
const MIN_CANCEL_VALUE = 15_000;

function emitRescheduleOut(
  ctx: ExceptionContext,
  supply: SupplyElement,
  uom: string,
  standardCost: number,
  day: number,
  daysEarly: number
): void {
  const carryingCost = supply.qty * standardCost * IMPACT_CONFIG.holdingRate * (daysEarly / 365);
  if (carryingCost < MIN_CARRYING_COST_TO_REPORT) return;

  ctx.emit({
    code: 'A5-RESCHEDULE-OUT',
    severity: 'LOW',
    itemId: supply.itemId,
    plantId: supply.plantId,
    bucketDay: day,
    discriminator: supply.id,
    narrative: narrate([
      `${supply.id} delivers ${formatQty(supply.qty, uom)} on ${formatDateShort(supply.dueDate)}, ${formatDays(daysEarly)} before the balance first needs it.`,
      `Holding it that long costs about ${formatCurrency(carryingCost)} and occupies space that is not required yet.`,
    ]),
    evidence: [
      {
        kind: 'RECORD',
        label: 'Early receipt',
        value: `${supply.id} · ${formatQty(supply.qty, uom)}`,
        detail: `Due ${formatDateShort(supply.dueDate)}`,
        ref: { type: 'SUPPLY_ELEMENT', supplyElementId: supply.id },
      },
      { kind: 'CALCULATION', label: 'Days earlier than needed', value: formatDays(daysEarly) },
      {
        kind: 'CALCULATION',
        label: 'Carrying cost of the early arrival',
        value: formatCurrency(carryingCost),
        detail: `${(IMPACT_CONFIG.holdingRate * 100).toFixed(0)}% annual holding rate on ${formatCurrency(supply.qty * standardCost)}`,
      },
    ],
    impact: valueException({
      probabilityOfMiss: 0,
      exposureRatio: 0,
      peggedDemand: [],
      excessQty: 0,
      obsolescenceQty: 0,
      expediteCost: carryingCost,
      standardCost,
    }),
  });
}

function emitRescheduleIn(
  ctx: ExceptionContext,
  supply: SupplyElement,
  uom: string,
  day: number,
  breachDay: number
): void {
  const pegged = ctx.peggedDemandFor(supply.itemId, supply.plantId);
  const item = ctx.item(supply.itemId);

  ctx.emit({
    code: 'A4-RESCHEDULE-IN',
    severity: 'HIGH',
    itemId: supply.itemId,
    plantId: supply.plantId,
    bucketDay: breachDay,
    discriminator: supply.id,
    narrative: narrate([
      `The balance goes short on day ${breachDay} (${formatDateShort(ctx.dateOf(breachDay))}), but ${supply.id} does not arrive until day ${day} (${formatDateShort(supply.dueDate)}).`,
      `Pulling it in by ${formatDays(day - breachDay)} closes the gap without a new order.`,
    ]),
    evidence: [
      {
        kind: 'CALCULATION',
        label: 'Shortage opens',
        value: `day ${breachDay} · ${formatDateShort(ctx.dateOf(breachDay))}`,
      },
      {
        kind: 'RECORD',
        label: 'Existing receipt',
        value: `${supply.id} · ${formatQty(supply.qty, uom)}`,
        detail: `Due day ${day} · ${formatDateShort(supply.dueDate)}`,
        ref: { type: 'SUPPLY_ELEMENT', supplyElementId: supply.id },
      },
      { kind: 'CALCULATION', label: 'Days to pull in', value: formatDays(day - breachDay) },
    ],
    impact: valueException({
      probabilityOfMiss: IMPACT_CONFIG.probabilityOfMiss.safetyStockBreach,
      exposureRatio: windowShare(day - breachDay, ctx.horizonDays),
      peggedDemand: pegged,
      excessQty: 0,
      obsolescenceQty: 0,
      expediteCost: 0,
      standardCost: item?.standardCost ?? 0,
    }),
    peggedDemand: pegged,
  });
}

// ---------------------------------------------------------------------------

/**
 * A8 — the computed release date is already in the past.
 *
 * The engine keeps these orders rather than dropping them, because an order the
 * plan cannot execute is precisely the thing a planner needs to see. One per
 * item-plant, at the earliest offender.
 */
function detectOrdersInPast(ctx: ExceptionContext): void {
  for (const [key, drafts] of ctx.index.ordersByKey) {
    const offender = drafts.find((draft) => draft.isReleaseInPast);
    if (!offender) continue;

    const plan = ctx.plans.get(key);
    const item = ctx.item(offender.itemId);
    const itemPlant = ctx.index.itemPlantByKey.get(key);
    if (!plan || !item || !itemPlant) continue;

    const observed = ctx.index.observedLeadTimes.get(key);
    const pegged = ctx.peggedDemandFor(offender.itemId, offender.plantId);
    const daysLate = -offender.releaseDay;

    const evidence: EvidenceFact[] = [
      {
        kind: 'CALCULATION',
        label: 'Receipt required',
        value: `day ${offender.receiptDay} · ${formatDateShort(ctx.dateOf(offender.receiptDay))}`,
        detail: `Net requirement ${formatQty(offender.netRequirement, item.baseUom)}`,
      },
      {
        kind: 'PARAMETER',
        label: 'Maintained lead time',
        value: formatDays(offender.effectiveLeadTimeDays),
        detail: `+ ${formatDays(itemPlant.grProcessingTimeDays)} GR processing + ${formatDays(itemPlant.safetyTimeDays)} safety time = ${formatDays(offender.totalOffsetDays)} total offset`,
        ref: { type: 'ITEM_PLANT', itemId: offender.itemId, plantId: offender.plantId },
      },
      {
        kind: 'CALCULATION',
        label: 'Computed release date',
        value: `day ${offender.releaseDay}`,
        detail: `${formatDays(daysLate)} before the planning date — the order can no longer be placed in time`,
      },
      {
        kind: 'PARAMETER',
        label: 'Parameters last maintained',
        value: formatDateShort(itemPlant.paramsLastChangedOn),
        ref: { type: 'ITEM_PLANT', itemId: offender.itemId, plantId: offender.plantId },
      },
    ];

    if (observed && observed.count > 0) {
      evidence.push({
        kind: 'OBSERVATION',
        label: 'Observed lead time',
        value: `${observed.averageDays.toFixed(1)} days`,
        detail: `σ ${observed.stdDevDays.toFixed(1)}d across the last ${observed.count} receipts from ${observed.vendorId}`,
        ref: {
          type: 'RECEIPT_HISTORY',
          itemId: offender.itemId,
          plantId: offender.plantId,
          vendorId: observed.vendorId,
        },
      });
    }

    const severity: Severity = daysLate > 14 ? 'CRITICAL' : 'HIGH';
    const impact = valueException({
      probabilityOfMiss: stockoutProbability(offender.receiptDay, offender.effectiveLeadTimeDays),
      exposureRatio: exposureRatioFor(
        plan,
        offender.receiptDay,
        offender.effectiveLeadTimeDays,
        offender.netRequirement
      ),
      peggedDemand: pegged,
      excessQty: 0,
      obsolescenceQty: 0,
      expediteCost: expediteEstimate(ctx, key, offender.qty),
      standardCost: item.standardCost,
    });

    ctx.emit({
      code: 'A8-ORDER-IN-PAST',
      severity,
      itemId: offender.itemId,
      plantId: offender.plantId,
      bucketDay: offender.receiptDay,
      narrative: narrate([
        `A receipt of ${formatQty(offender.qty, item.baseUom)} is required on day ${offender.receiptDay} (${formatDateShort(ctx.dateOf(offender.receiptDay))}).`,
        `Offsetting ${formatDays(offender.totalOffsetDays)} over the plant calendar puts the release on day ${offender.releaseDay} — ${formatDays(daysLate)} in the past.`,
        observed && observed.count > 0
          ? `The maintained lead time is ${formatDays(offender.effectiveLeadTimeDays)}; the last ${observed.count} receipts averaged ${observed.averageDays.toFixed(1)} days.`
          : `The order cannot be placed early enough to meet the requirement.`,
      ]),
      evidence,
      impact,
      peggedDemand: pegged,
    });
  }
}

// ---------------------------------------------------------------------------

/**
 * The share of pegged value a shortfall actually exposes.
 *
 * Two factors multiply, and leaving either out inflates the number by an order
 * of magnitude:
 *
 *   1. `shortfallShare` — how much of the recovery window's requirement is
 *      actually missing. A 2,000 kg gap against 40,000 kg of demand puts 5% at
 *      risk, not everything the component touches.
 *   2. `windowShare` — the recovery window is a slice of the horizon, but the
 *      pegged demand behind it spans the whole horizon. Without this, a shortage
 *      lasting three weeks is valued against six months of orders.
 */
function exposureRatioFor(plan: ItemPlantPlan, day: number, leadTimeDays: number, shortfall: number): number {
  const horizon = plan.grossRequirements.length - 1;
  if (horizon <= 0) return 0;

  const windowDays = Math.min(Math.max(leadTimeDays, 7), MAX_EXPOSURE_WINDOW_DAYS);
  const windowEnd = Math.min(day + windowDays, horizon);
  const windowDemand = windowSum(plan.grossRequirements, day, windowEnd);
  if (windowDemand <= 0) return 0;

  const shortfallShare = Math.min(1, shortfall / windowDemand);
  const windowShare = Math.min(1, (windowEnd - day + 1) / horizon);
  return shortfallShare * windowShare;
}

/** What the cheapest premium recovery would cost, used before resolutions exist. */
function expediteEstimate(ctx: ExceptionContext, key: string, qty: number): number {
  const vendors = ctx.index.vendorsByKey.get(key);
  if (!vendors) return 0;
  let cheapest = 0;
  for (const vendor of vendors) {
    if (!vendor.expediteAvailable || vendor.expediteUnitPriceUplift === null) continue;
    const premium = qty * vendor.unitPrice * vendor.expediteUnitPriceUplift;
    if (cheapest === 0 || premium < cheapest) cheapest = premium;
  }
  return cheapest;
}

/** Opening stock plus existing receipts, less requirements, at the horizon end. */
function committedClosingBalance(plan: ItemPlantPlan): number {
  let balance = plan.openingStock;
  for (let day = 0; day < plan.grossRequirements.length; day += 1) {
    balance += (plan.scheduledReceipts[day] as number) - (plan.grossRequirements[day] as number);
  }
  return balance;
}

function averageDailyDemand(series: Float64Array): number {
  if (series.length === 0) return 0;
  let total = 0;
  for (let day = 0; day < series.length; day += 1) total += series[day] as number;
  return total / series.length;
}

function windowSum(series: Float64Array, from: number, to: number): number {
  let total = 0;
  const end = Math.min(to, series.length - 1);
  for (let day = Math.max(0, from); day <= end; day += 1) total += series[day] as number;
  return total;
}

function dayOf(ctx: ExceptionContext, iso: string): number | null {
  const day = toEpochDay(iso) - ctx.planningEpochDay;
  if (day < 0 || day > ctx.horizonDays) return null;
  return day;
}
