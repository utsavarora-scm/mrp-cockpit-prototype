/**
 * Mock backend helpers.
 *
 * Prototypes have no real server. These helpers make mock data *feel* like a
 * real API — small artificial delays so loading states are visible, and a tiny
 * localStorage-backed store so changes "stick" across refreshes within a
 * prototype session. Nothing here is persisted to a real database.
 */

const DEFAULT_DELAY_MS = 600;

/** Resolve a value after a short, realistic delay (so spinners/skeletons show). */
export function fakeLatency<T>(value: T, ms: number = DEFAULT_DELAY_MS): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });
}

/** Occasionally useful for demoing error states. Rejects after a delay. */
export function fakeError(message = 'Something went wrong', ms: number = DEFAULT_DELAY_MS): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

/** Stable pseudo-id generator for newly created mock records. */
export function mockId(prefix = 'id'): string {
  return `${prefix}_${Math.floor(performance.now() * 1000).toString(36)}`;
}

/**
 * Read/write a JSON value in localStorage with a default fallback.
 * Safe on the server (returns the fallback during SSR).
 */
export const localStore = {
  get<T>(key: string, fallback: T): T {
    if (typeof window === 'undefined') return fallback;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set<T>(key: string, value: T): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore quota / serialization errors in a prototype */
    }
  },
};
