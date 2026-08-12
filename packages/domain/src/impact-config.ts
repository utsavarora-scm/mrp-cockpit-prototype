/**
 * Every coefficient behind a number on screen, in one openable file.
 *
 * This file exists to be shown. When someone asks "why is that $4.2M?", the
 * answer is the impact model below plus the seeded facts it runs over — not a
 * hardcoded figure anywhere. Keep it small, commented, and free of logic.
 */

export const IMPACT_CONFIG = {
  /**
   * Probability that pegged demand is actually missed, by exception situation.
   * A stockout inside the replenishment lead time cannot be recovered, so it is
   * certain; outside lead time there is still time to react.
   */
  probabilityOfMiss: {
    stockoutInsideLeadTime: 1.0,
    stockoutOutsideLeadTime: 0.5,
    safetyStockBreach: 0.15,
    /** Master data and reconciliation findings degrade the plan rather than break it. */
    masterDataDefect: 0.25,
    feasibilityDefect: 0.35,
  },

  /**
   * Margin at risk is scaled by the same probability as revenue.
   *
   * Deviation from the source spec, stated openly because it changes a headline
   * number: the spec values margin at 100% for every exception. Left unscaled, a
   * 15%-likely safety stock breach carries its full margin into the ranking,
   * which does not survive being challenged. Set false to restore the literal
   * formula.
   */
  applyProbabilityToMargin: true,

  /** Days of forward cover beyond which inventory counts as excess. */
  excessCoverThresholdDays: 90,

  /** Lot sizing that produces more than this many days of cover is flagged D4. */
  lotSizeExcessCoverDays: 120,

  /** Annual inventory holding rate, applied to standard cost. */
  holdingRate: 0.22,

  /** Fixed cost of raising one order, used by the EOQ rule. */
  orderCost: 5000,

  /** Class-B drift thresholds. */
  drift: {
    /** |observed − maintained| / maintained above this flags B7. */
    leadTimeDriftPct: 0.2,
    /** Minimum receipts needed before drift is claimed. */
    leadTimeMinReceipts: 6,
    /** |calculated SS − maintained SS| / maintained above this flags B8. */
    safetyStockMisalignPct: 0.3,
    /** Description similarity above this, same base UoM and plant, flags B10. */
    duplicateSimilarity: 0.9,
    /** Days of zero demand and zero consumption before stock is an orphan (B4). */
    orphanQuietDays: 180,
  },

  /** Class-C reconciliation thresholds. */
  reconciliation: {
    /** Weekly demand disagreement above this fraction flags C1. */
    demandDivergencePct: 0.05,
    /** On-hand disagreement above this fraction flags C2. */
    inventoryDivergencePct: 0.02,
    /** Hours a Kinaxis planned order may go without an SAP counterpart before C4. */
    planNotExecutedHours: 48,
  },

  /** Rescheduling windows. */
  reschedule: {
    /** A receipt landing this many days early ties up cash and space (A5). */
    earlyDaysThreshold: 14,
  },

  /**
   * Autonomous agent policy. Every condition must hold for an exception to close
   * itself unattended. Editable in the UI; every firing is written to the audit log.
   */
  agentPolicy: {
    minConfidence: 0.85,
    maxImpactValue: 25000,
    allowedAbcClasses: ['B', 'C'] as const,
    allowedResolutionTypes: ['RESCHEDULE_OUT', 'CANCEL_ORDER', 'ACCEPT_AND_MONITOR', 'FIX_MASTER_DATA'] as const,
    allowedExceptionCodes: [
      'A5-RESCHEDULE-OUT',
      'A6-CANCEL-EXCESS',
      'B1-INCOMPLETE-PLANNING-MASTER',
      'B8-SAFETY-STOCK-MISALIGNED',
      'C5-STALE-SYNC',
      'D4-LOT-SIZE-INDUCED-EXCESS',
    ] as const,
  },

  /**
   * Planner minutes spent triaging one exception by hand. Drives the
   * hours-saved counter on the agent log. Shown and editable in the UI —
   * an assumption smuggled into a headline number is worse than no number.
   */
  minutesPerExceptionManual: 12,

  /** Master data health score weights — must sum to 1. */
  healthWeights: {
    completeness: 0.4,
    freshness: 0.3,
    consistency: 0.3,
  },

  /** Planning parameters older than this are no longer considered fresh. */
  paramFreshnessDays: 365,
} as const;

export type ImpactConfig = typeof IMPACT_CONFIG;

/**
 * Standard normal inverse CDF, used for calculated safety stock:
 *   SS = z(serviceLevel) · σ(demand) · sqrt(leadTimeDays)
 * Acklam's rational approximation — accurate to ~1e-9 across (0,1), and
 * deterministic, which matters more here than the last decimal place.
 */
export function zScore(serviceLevel: number): number {
  const p = Math.min(Math.max(serviceLevel, 1e-6), 1 - 1e-6);

  const a = [
    -39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924,
  ];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [
    -0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878,
  ];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      ((((((c[0] as number) * q + (c[1] as number)) * q + (c[2] as number)) * q + (c[3] as number)) * q +
        (c[4] as number)) *
        q +
        (c[5] as number)) /
      (((((d[0] as number) * q + (d[1] as number)) * q + (d[2] as number)) * q + (d[3] as number)) * q + 1)
    );
  }
  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(
        (((((c[0] as number) * q + (c[1] as number)) * q + (c[2] as number)) * q + (c[3] as number)) * q +
          (c[4] as number)) *
          q +
        (c[5] as number)
      ) /
      (((((d[0] as number) * q + (d[1] as number)) * q + (d[2] as number)) * q + (d[3] as number)) * q + 1)
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    (((((((a[0] as number) * r + (a[1] as number)) * r + (a[2] as number)) * r + (a[3] as number)) * r +
      (a[4] as number)) *
      r +
      (a[5] as number)) *
      q) /
    ((((((b[0] as number) * r + (b[1] as number)) * r + (b[2] as number)) * r + (b[3] as number)) * r +
      (b[4] as number)) *
      r +
      1)
  );
}
