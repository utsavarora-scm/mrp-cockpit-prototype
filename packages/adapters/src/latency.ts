/**
 * Simulated network latency.
 *
 * The health screen is not believable if every feed answers in zero
 * milliseconds. Delays are deterministic per system and call — the same figure
 * every run, like everything else here — and sit in the range these APIs really
 * respond in.
 */

const BASE_LATENCY_MS: Record<string, number> = {
  SAP: 210,
  KINAXIS: 340,
  O9: 480,
};

const CALL_OFFSET_MS: Record<string, number> = {
  items: 90,
  itemPlants: 240,
  boms: 180,
  stock: 150,
  supply: 120,
  snapshot: 260,
};

/** Deterministic, and skipped entirely in tests so suites stay fast. */
export function latencyFor(system: string, call: string): number {
  return (BASE_LATENCY_MS[system] ?? 200) + (CALL_OFFSET_MS[call] ?? 100);
}

export async function simulatedLatency(system: string, call: string): Promise<void> {
  if (process.env.NODE_ENV === 'test' || process.env.ADAPTER_LATENCY === 'off') return;
  await new Promise((resolve) => setTimeout(resolve, latencyFor(system, call)));
}
