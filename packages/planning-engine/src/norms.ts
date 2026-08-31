/**
 * The norms engine — what the buffer should be, reconstructed from history.
 *
 * This is the argument the whole product rests on, so every figure it returns
 * carries its own working. The centrepiece is the difference between two ways
 * of sizing a buffer:
 *
 *   naive:    SS = z · σ_D · √LT̄
 *   combined: SS = z · √( LT̄ · σ²_D  +  D̄² · σ²_LT )
 *
 * The naive form treats lead time as a constant. For an imported commodity
 * whose lead time swings by eleven days that assumption is not conservative, it
 * is simply wrong — and the gap between the two answers is not a rounding
 * difference but a factor of seven and a half. Both are computed and returned
 * side by side. The finding has to be *computed* in front of the audience; an
 * asserted 7.6× is a slide, not a system.
 *
 * **On recency weighting.** Spec §5.2 step 2 asks for exponential decay with a
 * 90-day half-life, exposed as a control. It is implemented — but the default
 * here is *unweighted*, and that is deliberate. Weighting this material's
 * fourteen receipts at a 90-day half-life pulls the reconstructed mean from 47
 * days to about 49, because the sample spans eighteen months and the decay is
 * steep across it. The demo's headline figure has to be the plain mean of the
 * receipts a planner can read on screen and add up themselves. The control then
 * *demonstrates* the sensitivity, which is the honest use of it: the spec's own
 * argument for exposing it is that planners already over-weight recent events,
 * and you cannot make that case from behind a default that does the same thing.
 */

import { normalCdf, percentile, zScore } from '@repo/domain';

/** One receipt, as the reconstruction reads it. */
export interface LeadTimeObservation {
  days: number;
  /** ISO date, for recency weighting. */
  receivedOn: string;
  poId: string;
  vendorId: string;
  isImport: boolean;
}

export type NormBasis = 'ITEM_VENDOR_PLANT' | 'VENDOR' | 'CATEGORY';

export interface LeadTimeDistribution {
  mean: number;
  /** Population standard deviation, in days. */
  stdDev: number;
  p50: number;
  p85: number;
  p95: number;
  count: number;
  confidence: 'HIGH' | 'LOW';
  basis: NormBasis;
  /** Observations kept, most recent first. */
  sample: LeadTimeObservation[];
  /** How many observations the P99 winsorise pulled in. */
  winsorisedCount: number;
  halfLifeDays: number | null;
}

/** Below this the sample cannot carry a recommendation on its own. */
export const MIN_RECEIPTS_FOR_RECOMMENDATION = 6;

export interface ReconstructOptions {
  /** Null — the default — weights every observation equally. See the note above. */
  halfLifeDays?: number | null;
  /** The date decay is measured back from. Injected, never `Date.now()`. */
  planningDate: string;
  basis?: NormBasis;
}

/**
 * Step 1 and 2 — reconstruct the lead-time distribution.
 *
 * Imports are never pooled with domestic sourcing. A 47-day sea freight and a
 * 12-day road movement are different processes with different variance, and
 * averaging them produces a figure that describes neither.
 */
export function reconstructLeadTime(
  observations: readonly LeadTimeObservation[],
  options: ReconstructOptions
): LeadTimeDistribution | null {
  if (observations.length === 0) return null;

  const sorted = [...observations].sort((a, b) => (a.receivedOn < b.receivedOn ? 1 : a.receivedOn > b.receivedOn ? -1 : 0));

  // Winsorise at P99: a single mis-keyed receipt date should not set the norm
  // for a whole material, but the observation is pulled in rather than dropped,
  // so the sample size never quietly changes.
  const ascending = [...sorted.map((row) => row.days)].sort((a, b) => a - b);
  const ceiling = percentile(ascending, 0.99);
  let winsorisedCount = 0;
  const sample = sorted.map((row) => {
    if (row.days <= ceiling) return row;
    winsorisedCount += 1;
    return { ...row, days: ceiling };
  });

  const halfLifeDays = options.halfLifeDays ?? null;
  const planningEpoch = Date.parse(`${options.planningDate}T00:00:00Z`);
  const weights = sample.map((row) => {
    if (halfLifeDays === null) return 1;
    const ageDays = (planningEpoch - Date.parse(`${row.receivedOn}T00:00:00Z`)) / 86_400_000;
    return Math.pow(0.5, Math.max(ageDays, 0) / halfLifeDays);
  });

  let weightTotal = 0;
  let weighted = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const weight = weights[i] as number;
    weightTotal += weight;
    weighted += weight * (sample[i] as LeadTimeObservation).days;
  }
  const mean = weighted / weightTotal;

  let spread = 0;
  for (let i = 0; i < sample.length; i += 1) {
    spread += (weights[i] as number) * ((sample[i] as LeadTimeObservation).days - mean) ** 2;
  }
  // Population, matching `observed.ts` and the adherence engine. One convention
  // across the product, so two screens can never disagree about the same spread.
  const stdDev = Math.sqrt(spread / weightTotal);

  const values = sample.map((row) => row.days).sort((a, b) => a - b);

  return {
    mean,
    stdDev,
    p50: percentile(values, 0.5),
    p85: percentile(values, 0.85),
    p95: percentile(values, 0.95),
    count: sample.length,
    confidence: sample.length >= MIN_RECEIPTS_FOR_RECOMMENDATION ? 'HIGH' : 'LOW',
    basis: options.basis ?? 'ITEM_VENDOR_PLANT',
    sample,
    winsorisedCount,
    halfLifeDays,
  };
}

/**
 * Reconstruct with fallback: item × vendor × plant, then vendor, then category.
 *
 * A recommendation from a thin sample is still better than a maintained number
 * nobody has revisited since 2024 — but it has to say so, which is what the
 * basis and confidence carry.
 */
export function reconstructWithFallback(
  itemVendorPlant: readonly LeadTimeObservation[],
  vendorLevel: readonly LeadTimeObservation[],
  categoryLevel: readonly LeadTimeObservation[],
  options: ReconstructOptions
): LeadTimeDistribution | null {
  const direct = reconstructLeadTime(itemVendorPlant, { ...options, basis: 'ITEM_VENDOR_PLANT' });
  if (direct && direct.count >= MIN_RECEIPTS_FOR_RECOMMENDATION) return direct;

  const vendor = reconstructLeadTime(vendorLevel, { ...options, basis: 'VENDOR' });
  if (vendor && vendor.count >= MIN_RECEIPTS_FOR_RECOMMENDATION) return { ...vendor, confidence: 'LOW' };

  const category = reconstructLeadTime(categoryLevel, { ...options, basis: 'CATEGORY' });
  if (category && category.count >= MIN_RECEIPTS_FOR_RECOMMENDATION) return { ...category, confidence: 'LOW' };

  return direct ?? vendor ?? category;
}

export type NormConstraintKind = 'CAMPAIGN_CYCLE' | 'MOQ' | 'SHELF_LIFE' | 'STORAGE';

export interface NormConstraint {
  kind: NormConstraintKind;
  binding: boolean;
  /** What the constraint permits, in the unit it is expressed in. */
  limitDays: number | null;
  limitQty: number | null;
  note: string;
}

export interface NormInput {
  itemId: string;
  plantId: string;
  serviceLevel: number;
  dailyDemandMean: number;
  dailyDemandStdDev: number;
  leadTime: LeadTimeDistribution;
  /** Goods receipt processing days — the plant's own handling time. */
  goodsReceiptProcessingDays: number;
  standardCost: number;
  maintainedStockDays: number | null;
  maintainedStockQty: number | null;
  /** Constraint inputs. Null where the material does not carry the constraint. */
  campaignCycleDays: number | null;
  moq: number | null;
  shelfLifeDays: number | null;
  storageCapacity: number | null;
}

export interface NormRecommendation {
  itemId: string;
  plantId: string;
  serviceLevel: number;
  z: number;

  dailyDemandMean: number;
  dailyDemandStdDev: number;
  leadTime: LeadTimeDistribution;

  /** Step 3. */
  recommendedOrderDays: number;
  orderDaysComponents: {
    observedLeadTimeMean: number;
    goodsReceiptProcessingDays: number;
    /** True when transit is already inside the observed figure. See the note. */
    transitIncludedInObserved: boolean;
  };

  /** Step 4 — the combined formula, and the naive one beside it. */
  safetyStockQty: number;
  recommendedStockDays: number;
  naiveSafetyStockQty: number;
  naiveStockDays: number;
  ratioToNaive: number;
  /** LT̄ · σ²_D — the part of the buffer demand variability explains. */
  demandTerm: number;
  /** D̄² · σ²_LT — the part lead-time variability explains. */
  leadTimeTerm: number;
  /** leadTimeTerm / (demandTerm + leadTimeTerm), 0–1. */
  leadTimeShare: number;

  /** Step 5. */
  constraints: NormConstraint[];
  constrainedStockDays: number;
  constrainedStockQty: number;

  /** Step 7. */
  maintainedStockQty: number | null;
  excessCapital: number;
  unprotectedExposure: number;
  stockoutProbability: number;
}

/**
 * Steps 3 to 7 — turn a reconstructed distribution into a recommendation.
 */
export function computeNorm(input: NormInput): NormRecommendation {
  const z = zScore(input.serviceLevel);
  const meanLeadTime = input.leadTime.mean;
  const sigmaDemand = input.dailyDemandStdDev;
  const sigmaLeadTime = input.leadTime.stdDev;
  const meanDemand = input.dailyDemandMean;

  // --- Step 3 -------------------------------------------------------------
  //
  // Spec §5.2 writes this as observed + transit + processing. Here the observed
  // figure is reconstructed as `receivedOn − orderedOn`, which is what a goods
  // receipt against a purchase order actually measures — so transit is already
  // *inside* it. Adding it again would inflate the order window by the twelve
  // days of sea freight a second time, and the resulting order dates would be
  // wrong by a fortnight in the direction that looks safe. Only the plant's own
  // handling time is genuinely outside the reconstruction.
  const recommendedOrderDays = meanLeadTime + input.goodsReceiptProcessingDays;

  // --- Step 4 -------------------------------------------------------------
  const demandTerm = meanLeadTime * sigmaDemand ** 2;
  const leadTimeTerm = meanDemand ** 2 * sigmaLeadTime ** 2;
  const combined = z * Math.sqrt(demandTerm + leadTimeTerm);
  const naive = z * sigmaDemand * Math.sqrt(meanLeadTime);

  const recommendedStockDays = meanDemand > 0 ? combined / meanDemand : 0;
  const naiveStockDays = meanDemand > 0 ? naive / meanDemand : 0;

  // --- Step 5 -------------------------------------------------------------
  const constraints: NormConstraint[] = [];
  let stockDays = recommendedStockDays;

  if (input.campaignCycleDays !== null && input.campaignCycleDays > 0) {
    const binding = input.campaignCycleDays > stockDays;
    constraints.push({
      kind: 'CAMPAIGN_CYCLE',
      binding,
      limitDays: input.campaignCycleDays,
      limitQty: input.campaignCycleDays * meanDemand,
      note: `Production runs on a ${input.campaignCycleDays}-day campaign cycle, so cover cannot sit below it.`,
    });
    if (binding) stockDays = input.campaignCycleDays;
  }

  if (input.moq !== null && input.moq > 0 && meanDemand > 0) {
    const moqDays = input.moq / meanDemand;
    const binding = moqDays > stockDays;
    constraints.push({
      kind: 'MOQ',
      binding,
      limitDays: moqDays,
      limitQty: input.moq,
      note: `One minimum order of ${Math.round(input.moq)} covers ${moqDays.toFixed(1)} days, which is the least this norm can be.`,
    });
    if (binding) stockDays = moqDays;
  }

  if (input.shelfLifeDays !== null && input.shelfLifeDays > 0) {
    // Cover plus the order window has to be consumed well inside shelf life.
    const ceilingDays = input.shelfLifeDays * 0.75 - recommendedOrderDays;
    const binding = ceilingDays < stockDays;
    constraints.push({
      kind: 'SHELF_LIFE',
      binding,
      limitDays: ceilingDays,
      limitQty: ceilingDays * meanDemand,
      note: `Shelf life of ${input.shelfLifeDays} days leaves ${Math.max(ceilingDays, 0).toFixed(0)} days of cover once the ${recommendedOrderDays.toFixed(0)}-day order window is allowed for.`,
    });
    if (binding) stockDays = Math.max(ceilingDays, 0);
  }

  let stockQty = stockDays * meanDemand;

  if (input.storageCapacity !== null && input.storageCapacity > 0) {
    const binding = stockQty > input.storageCapacity;
    constraints.push({
      kind: 'STORAGE',
      binding,
      limitDays: meanDemand > 0 ? input.storageCapacity / meanDemand : null,
      limitQty: input.storageCapacity,
      note: `The plant can hold ${Math.round(input.storageCapacity)}, which caps the norm however the formula sizes it.`,
    });
    if (binding) {
      stockQty = input.storageCapacity;
      stockDays = meanDemand > 0 ? stockQty / meanDemand : 0;
    }
  }

  // --- Step 7 -------------------------------------------------------------
  // A plant maintains its buffer one of two ways, and which one it uses decides
  // what "the maintained norm" even means here. Where an explicit safety stock
  // is set, that is the number driving replenishment. Where it is not — which
  // is most packaging, sitting on a stock-days policy instead — the norm is the
  // cover the policy asks for. Reading only the safety stock field makes every
  // stock-days material look as though it holds nothing, which hides the whole
  // excess-capital half of the finding.
  const maintainedQty =
    input.maintainedStockQty !== null && input.maintainedStockQty > 0
      ? input.maintainedStockQty
      : input.maintainedStockDays !== null
        ? input.maintainedStockDays * meanDemand
        : null;

  // How often the maintained buffer is actually breached, given the spread the
  // combined formula measured. This is what makes "121 MT" a risk rather than
  // merely a smaller number than 914.
  const sigmaCombined = Math.sqrt(demandTerm + leadTimeTerm);
  const stockoutProbability =
    maintainedQty === null || sigmaCombined === 0 ? 0 : 1 - normalCdf(maintainedQty / sigmaCombined);

  let excessCapital = 0;
  let unprotectedExposure = 0;
  if (maintainedQty !== null) {
    if (maintainedQty > stockQty) excessCapital = (maintainedQty - stockQty) * input.standardCost;
    else unprotectedExposure = (stockQty - maintainedQty) * input.standardCost * stockoutProbability;
  }

  return {
    itemId: input.itemId,
    plantId: input.plantId,
    serviceLevel: input.serviceLevel,
    z,
    dailyDemandMean: meanDemand,
    dailyDemandStdDev: sigmaDemand,
    leadTime: input.leadTime,
    recommendedOrderDays,
    orderDaysComponents: {
      observedLeadTimeMean: meanLeadTime,
      goodsReceiptProcessingDays: input.goodsReceiptProcessingDays,
      transitIncludedInObserved: true,
    },
    safetyStockQty: combined,
    recommendedStockDays,
    naiveSafetyStockQty: naive,
    naiveStockDays,
    ratioToNaive: naive === 0 ? 0 : combined / naive,
    demandTerm,
    leadTimeTerm,
    leadTimeShare: demandTerm + leadTimeTerm === 0 ? 0 : leadTimeTerm / (demandTerm + leadTimeTerm),
    constraints,
    constrainedStockDays: stockDays,
    constrainedStockQty: stockQty,
    maintainedStockQty: maintainedQty,
    excessCapital,
    unprotectedExposure,
    stockoutProbability,
  };
}

// ---------------------------------------------------------------------------
// Step 6 — seasonality
// ---------------------------------------------------------------------------

export interface NormCurvePoint {
  weekStart: string;
  stockDays: number;
  stockQty: number;
}

/** Outside this band a single annual norm stops describing any actual week. */
export const SEASONALITY_BAND = { low: 0.75, high: 1.35 } as const;

/**
 * Peak-week demand over mean-week demand. One number that answers "does this
 * material have a shape?" before any seasonal machinery is spun up.
 */
export function seasonalityIndex(weeklyDemand: readonly number[]): number {
  if (weeklyDemand.length === 0) return 1;
  let total = 0;
  let peak = 0;
  for (const value of weeklyDemand) {
    total += value;
    if (value > peak) peak = value;
  }
  const mean = total / weeklyDemand.length;
  return mean === 0 ? 1 : peak / mean;
}

export function isSeasonal(weeklyDemand: readonly number[]): boolean {
  const index = seasonalityIndex(weeklyDemand);
  return index < SEASONALITY_BAND.low || index > SEASONALITY_BAND.high;
}

/**
 * A norm computed per week against that week's own forward coverage window,
 * rather than one figure sized off an annual average.
 */
export function normCurve(
  weekStarts: readonly string[],
  weeklyDemand: readonly number[],
  coverageWeeks: number,
  z: number,
  sigmaDemandDaily: number,
  meanLeadTimeDays: number,
  sigmaLeadTimeDays: number
): NormCurvePoint[] {
  return weekStarts.map((weekStart, index) => {
    let forward = 0;
    let weeks = 0;
    for (let step = 0; step < coverageWeeks && index + step < weeklyDemand.length; step += 1) {
      forward += weeklyDemand[index + step] as number;
      weeks += 1;
    }
    const dailyMean = weeks === 0 ? 0 : forward / (weeks * 7);
    const qty = z * Math.sqrt(meanLeadTimeDays * sigmaDemandDaily ** 2 + dailyMean ** 2 * sigmaLeadTimeDays ** 2);
    return { weekStart, stockDays: dailyMean === 0 ? 0 : qty / dailyMean, stockQty: qty };
  });
}

/**
 * What a *maintained* flat norm actually delivers, period by period.
 *
 * This is the Act 2 line: a 30-day norm sized off the annual average is 50 days
 * of cover in April and 14 in July. It was never a 30-day norm — it was 30 days
 * on average, and the average describes no actual week of the year.
 */
export function flatNormCoverageByPeriod(
  flatNormQty: number,
  periods: ReadonlyArray<{ label: string; weeklyDemand: number }>
): Array<{ label: string; weeklyDemand: number; coverWeeks: number; coverDays: number }> {
  return periods.map((period) => {
    const coverWeeks = period.weeklyDemand === 0 ? 0 : flatNormQty / period.weeklyDemand;
    return { label: period.label, weeklyDemand: period.weeklyDemand, coverWeeks, coverDays: coverWeeks * 7 };
  });
}
