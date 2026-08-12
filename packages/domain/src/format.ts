/**
 * Presentation rules, shared by the engine's narratives and the UI so a figure
 * reads identically wherever it appears. USD, en-US, abbreviated above six
 * figures. Never show more precision than the data supports.
 */

const CURRENCY_FULL = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const CURRENCY_CENTS = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** `$18.4M`, `$4.2M`, `$425K`, `$25,000`. */
export function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 100_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return CURRENCY_FULL.format(value);
}

/** Full precision, for unit prices and small costs. */
export function formatCurrencyExact(value: number): string {
  return Math.abs(value) < 100 ? CURRENCY_CENTS.format(value) : CURRENCY_FULL.format(value);
}

export function formatQty(value: number, uom?: string): string {
  const rounded = Math.abs(value) < 10 ? Number(value.toFixed(2)) : Math.round(value);
  return uom ? `${NUMBER.format(rounded)} ${uom}` : NUMBER.format(rounded);
}

export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

export function formatPercent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** Signed, for deltas: `+2.4%`, `−0.8%`. */
export function formatDelta(fraction: number, digits = 1): string {
  const pct = fraction * 100;
  if (pct >= 0) return `+${pct.toFixed(digits)}%`;
  return `−${Math.abs(pct).toFixed(digits)}%`;
}

export function formatDays(days: number): string {
  return `${Math.round(days)}d`;
}

const DATE_SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const DATE_FULL = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

/** ISO date string → `Sep 14`. Parsed as UTC so it never shifts by timezone. */
export function formatDateShort(iso: string): string {
  return DATE_SHORT.format(new Date(`${iso}T00:00:00Z`));
}

export function formatDateFull(iso: string): string {
  return DATE_FULL.format(new Date(`${iso}T00:00:00Z`));
}
