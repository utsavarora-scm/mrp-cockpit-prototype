/**
 * Statistics the planning engines share.
 *
 * Kept in the domain rather than inside one engine because the norms engine,
 * the scheduling engine and the UI all have to agree on the same z for the same
 * service level — a safety stock that cannot be reproduced from its own inputs
 * is exactly the black box this product exists to replace.
 */

/**
 * Inverse standard normal CDF — the z multiplier for a service level.
 *
 * Acklam's rational approximation, accurate to about 1.15e-9 across the range,
 * which is far tighter than any input it will ever be fed.
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

/**
 * Standard normal CDF, via the Abramowitz–Stegun 7.1.26 error function.
 *
 * Used to price the risk a maintained buffer carries: how often a norm sized
 * below the computed one is actually breached. Accurate to about 1.5e-7, which
 * is several orders finer than the demand statistics feeding it.
 */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;

  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);

  return 0.5 * (1 + sign * y);
}

/**
 * Nearest-rank percentile.
 *
 * Deliberately not interpolated. With fourteen receipts an interpolated P99
 * lands *between* the two largest observations and quietly clips the largest
 * one during winsorising — which would move the hero material's reconstructed
 * lead time off the figure the appendix reconstructs. Nearest-rank returns an
 * observation that actually happened, which is also easier to defend to a
 * planner reading the receipts underneath it.
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(p * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index] as number;
}
