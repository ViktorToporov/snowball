import { Injectable, signal } from '@angular/core';

import { Currency, ExchangeRate } from '../models/domain.models';
import { formatCompactCurrency, formatCurrency, formatPercent, CurrencyOptions } from './format';
import { dec, Decimal } from './money';

/**
 * Exchange-rate abstraction.
 *
 * Rates are held as a plain lookup table so they can come from
 * anywhere: the `exchange_rates` table (the default), a scheduled edge
 * function, or a live FX API. Nothing in the application hard-codes a
 * conversion rate — a missing pair converts 1:1 and is reported through
 * `missingPairs()` so the UI can flag it rather than silently lie.
 */
@Injectable({ providedIn: 'root' })
export class CurrencyService {
  private rates = new Map<string, Decimal>();
  private readonly missing = new Set<string>();

  readonly baseCurrency = signal<Currency>('EUR');
  readonly locale = signal<string>('en-IE');
  /** Bumped whenever rates change, so computed signals re-evaluate. */
  readonly ratesVersion = signal(0);

  setBase(currency: Currency, locale?: string): void {
    this.baseCurrency.set(currency);
    if (locale) this.locale.set(locale);
  }

  loadRates(rates: readonly ExchangeRate[]): void {
    this.rates = new Map();
    for (const rate of rates) {
      this.rates.set(key(rate.baseCurrency, rate.quoteCurrency), dec(rate.rate));
    }
    this.missing.clear();
    this.ratesVersion.update((v) => v + 1);
  }

  /** Rate to convert 1 unit of `from` into `to`. */
  rate(from: Currency, to: Currency): Decimal {
    if (from === to) return new Decimal(1);

    const direct = this.rates.get(key(from, to));
    if (direct) return direct;

    const inverse = this.rates.get(key(to, from));
    if (inverse && !inverse.isZero()) return new Decimal(1).dividedBy(inverse);

    // Triangulate through the base currency where possible.
    const base = this.baseCurrency();
    if (from !== base && to !== base) {
      const toBase = this.rates.get(key(from, base));
      const fromBase = this.rates.get(key(base, to));
      if (toBase && fromBase) return toBase.times(fromBase);
    }

    this.missing.add(key(from, to));
    return new Decimal(1);
  }

  /** Convert into the user's base currency. */
  toBase(amount: number | string | Decimal | null | undefined, from: Currency): number {
    return this.convert(amount, from, this.baseCurrency());
  }

  convert(amount: number | string | Decimal | null | undefined, from: Currency, to: Currency): number {
    if (from === to) return dec(amount).toDecimalPlaces(4).toNumber();
    return dec(amount).times(this.rate(from, to)).toDecimalPlaces(4).toNumber();
  }

  /** Pairs the app had to fall back to 1:1 on. */
  missingPairs(): string[] {
    return [...this.missing];
  }

  /* -- formatting helpers, pre-bound to the user's locale ------------- */

  format(value: number | null | undefined, options: CurrencyOptions = {}): string {
    return formatCurrency(value, {
      locale: this.locale(),
      currency: this.baseCurrency(),
      ...options,
    });
  }

  formatIn(value: number | null | undefined, currency: Currency, options: CurrencyOptions = {}): string {
    return formatCurrency(value, { locale: this.locale(), currency, ...options });
  }

  compact(value: number | null | undefined): string {
    return formatCompactCurrency(value, this.locale(), this.baseCurrency());
  }

  percent(value: number | null | undefined, decimals = 1, signed = false): string {
    return formatPercent(value, { locale: this.locale(), decimals, signed });
  }
}

function key(from: string, to: string): string {
  return `${from}>${to}`;
}
