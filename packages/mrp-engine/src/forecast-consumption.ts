/**
 * Forecast consumption.
 *
 * A firm sales order and the forecast it was expected to fulfil are the same
 * demand counted twice. Consuming one against the other before netting is what
 * stops the plan ordering for both — a classic real-world error, and one worth
 * pointing at during the demo because most spreadsheet-based planning gets it
 * wrong.
 *
 * Buckets are consumed nearest-first within the consumption window, with the
 * backward direction winning ties, which is the convention planners expect.
 */

export interface ConsumptionWindow {
  backwardDays: number;
  forwardDays: number;
}

/**
 * Reduces `forecast` in place by the quantity covered by `salesOrders`.
 * Both arrays are indexed by day offset from the planning date.
 *
 * Returns the total quantity consumed, which the netting pass reports as
 * evidence when a planner asks why gross requirements are lower than the raw
 * forecast.
 */
export function consumeForecast(forecast: Float64Array, salesOrders: Float64Array, window: ConsumptionWindow): number {
  const horizon = forecast.length - 1;
  let consumedTotal = 0;

  // Offsets ordered nearest-first: 0, −1, +1, −2, +2 … backward wins ties.
  const offsets = buildOffsetOrder(window);

  for (let day = 0; day <= horizon; day += 1) {
    let outstanding = salesOrders[day] as number;
    if (outstanding <= 0) continue;

    for (const offset of offsets) {
      if (outstanding <= 0) break;
      const target = day + offset;
      if (target < 0 || target > horizon) continue;
      const available = forecast[target] as number;
      if (available <= 0) continue;
      const taken = Math.min(available, outstanding);
      forecast[target] = available - taken;
      outstanding -= taken;
      consumedTotal += taken;
    }
  }

  return consumedTotal;
}

function buildOffsetOrder(window: ConsumptionWindow): number[] {
  const offsets: number[] = [0];
  const reach = Math.max(window.backwardDays, window.forwardDays);
  for (let distance = 1; distance <= reach; distance += 1) {
    if (distance <= window.backwardDays) offsets.push(-distance);
    if (distance <= window.forwardDays) offsets.push(distance);
  }
  return offsets;
}
