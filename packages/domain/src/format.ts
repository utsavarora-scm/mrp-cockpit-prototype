/**
 * Presentation rules, shared by the engine's narratives and the UI so a figure
 * reads identically wherever it appears.
 *
 * Indian conventions throughout: rupees, lakh and crore, and `14 Sep` rather
 * than `Sep 14`. A dollar sign or a transposed date reads as foreign to this
 * audience just as fast as a wrong number does.
 */

const CURRENCY_FULL = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const CURRENCY_PAISE = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUMBER = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** One crore. */
const CRORE = 10_000_000;
/** One lakh. */
const LAKH = 100_000;

/** `₹8.68 Cr`, `₹12.4 L`, `₹25,000`. Abbreviated above six figures. */
export function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= CRORE) return `${sign}₹${(abs / CRORE).toFixed(2)} Cr`;
  if (abs >= LAKH) return `${sign}₹${(abs / LAKH).toFixed(1)} L`;
  return CURRENCY_FULL.format(value);
}

/** Full precision, for unit prices and small costs. */
export function formatCurrencyExact(value: number): string {
  return Math.abs(value) < 100 ? CURRENCY_PAISE.format(value) : CURRENCY_FULL.format(value);
}

/** `35 lakh`, `4.5 lakh` — how volumes are actually spoken about here. */
export function formatLakh(value: number, digits = 1): string {
  return `${(value / LAKH).toFixed(digits)} lakh`;
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

const DATE_SHORT = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const DATE_FULL = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** ISO date string → `14 Sep`. Parsed as UTC so it never shifts by timezone. */
export function formatDateShort(iso: string): string {
  return DATE_SHORT.format(new Date(`${iso}T00:00:00Z`));
}

export function formatDateFull(iso: string): string {
  return DATE_FULL.format(new Date(`${iso}T00:00:00Z`));
}
