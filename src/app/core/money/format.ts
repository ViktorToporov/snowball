/**
 * Display formatting. Intl does the work; these helpers just keep the
 * options consistent and cache the formatters (constructing an
 * Intl.NumberFormat per cell is measurably slow in long tables).
 */

const cache = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = locale + '|' + JSON.stringify(options);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    cache.set(key, f);
  }
  return f;
}

export interface CurrencyOptions {
  locale?: string;
  currency?: string;
  /** Drop the decimals — the default for figures over ~1,000. */
  compactDecimals?: boolean;
  decimals?: number;
  /** Always show a leading + or −. */
  signed?: boolean;
}

export function formatCurrency(value: number | null | undefined, options: CurrencyOptions = {}): string {
  const {
    locale = 'en-IE',
    currency = 'EUR',
    decimals,
    signed = false,
  } = options;

  if (value === null || value === undefined || !Number.isFinite(value)) return '—';

  const dp = decimals ?? (Math.abs(value) >= 1000 || Number.isInteger(value) ? 0 : 2);

  const text = formatter(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(Math.abs(value));

  if (signed) {
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    return sign + text;
  }
  return value < 0 ? '−' + text : text;
}

/** Axis ticks and stat tiles: €1.2k, €48.5k, €1.4M. */
export function formatCompactCurrency(
  value: number | null | undefined,
  locale = 'en-IE',
  currency = 'EUR',
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';

  const symbol = currencySymbol(currency, locale);
  if (abs >= 1_000_000) return `${sign}${symbol}${trim(abs / 1_000_000)}M`;
  if (abs >= 10_000) return `${sign}${symbol}${trim(abs / 1_000)}k`;
  if (abs >= 1_000) return `${sign}${symbol}${trim(abs / 1_000, 1)}k`;
  return `${sign}${symbol}${Math.round(abs)}`;
}

function trim(value: number, dp = 1): string {
  const rounded = value.toFixed(dp);
  return rounded.replace(/\.0+$/, '');
}

const symbolCache = new Map<string, string>();
export function currencySymbol(currency = 'EUR', locale = 'en-IE'): string {
  const key = `${locale}|${currency}`;
  let symbol = symbolCache.get(key);
  if (!symbol) {
    symbol =
      formatter(locale, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 })
        .formatToParts(0)
        .find((part) => part.type === 'currency')?.value ?? currency;
    symbolCache.set(key, symbol);
  }
  return symbol;
}

export function formatPercent(
  value: number | null | undefined,
  options: { locale?: string; decimals?: number; signed?: boolean } = {},
): string {
  const { locale = 'en-IE', decimals = 1, signed = false } = options;
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const text = formatter(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Math.abs(value));
  const sign = signed ? (value > 0 ? '+' : value < 0 ? '−' : '') : value < 0 ? '−' : '';
  return `${sign}${text}%`;
}

export function formatNumber(
  value: number | null | undefined,
  options: { locale?: string; decimals?: number } = {},
): string {
  const { locale = 'en-IE', decimals = 0 } = options;
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return formatter(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const dateCache = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + '|' + JSON.stringify(options);
  let f = dateCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    dateCache.set(key, f);
  }
  return f;
}

/** Parse 'YYYY-MM-DD' without the UTC shift `new Date(str)` introduces. */
export function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDate(value: string | Date | null | undefined, locale = 'en-IE'): string {
  const date = parseDate(value);
  if (!date) return '—';
  return dateFormatter(locale, { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

export function formatDateShort(value: string | Date | null | undefined, locale = 'en-IE'): string {
  const date = parseDate(value);
  if (!date) return '—';
  return dateFormatter(locale, { day: 'numeric', month: 'short' }).format(date);
}

export function formatMonth(value: string | Date | null | undefined, locale = 'en-IE'): string {
  const date = parseDate(value);
  if (!date) return '—';
  return dateFormatter(locale, { month: 'short', year: '2-digit' }).format(date);
}

export function formatMonthLong(value: string | Date | null | undefined, locale = 'en-IE'): string {
  const date = parseDate(value);
  if (!date) return '—';
  return dateFormatter(locale, { month: 'long', year: 'numeric' }).format(date);
}

/** "in 3 months", "2 weeks ago", "today". */
export function formatRelative(value: string | Date | null | undefined, locale = 'en-IE'): string {
  const date = parseDate(value);
  if (!date) return '—';
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);

  if (Math.abs(days) < 1) return 'today';
  if (Math.abs(days) < 28) return rtf.format(days, 'day');
  const months = Math.round(days / 30.44);
  if (Math.abs(months) < 18) return rtf.format(months, 'month');
  return rtf.format(Math.round(days / 365.25), 'year');
}

/** Whole months between two dates, never below 0. */
export function monthsBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()));
}

/**
 * Whole months from today until `value`, rounded to nearest.
 *
 * Deliberately the same arithmetic `formatRelative` uses, so a goal
 * never says "in 3 months" beside a contribution figure computed over
 * two.
 */
export function monthsUntil(value: string | Date | null | undefined): number | null {
  const date = parseDate(value);
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = (date.getTime() - today.getTime()) / 86_400_000;
  return Math.round(days / 30.44);
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth() + months, 1);
  next.setDate(Math.min(date.getDate(), daysInMonth(next)));
  return next;
}

export function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function monthKey(value: string | Date): string {
  const date = parseDate(value)!;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}
