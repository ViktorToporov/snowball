import { Pipe, PipeTransform } from '@angular/core';

/** Words that read better than their capitalised enum value. */
const OVERRIDES: Record<string, string> = {
  one_off: 'One-off',
  etf: 'ETF',
  reit: 'REIT',
  ewallet: 'E-wallet',
  brokerage_cash: 'Investment account cash',
  physical_cash: 'Cash at home',
  checking: 'Bank account',
  owner_occupied: 'Lived in',
  rented: 'Rented out',
};

/** `'one_off'` → `'One-off'`, `'monthly'` → `'Monthly'`, `'solid'` → `'Solid'`. */
export function humanize(value: string | null | undefined): string {
  if (!value) return '';
  if (OVERRIDES[value]) return OVERRIDES[value];
  const text = value.replace(/[_-]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

@Pipe({ name: 'humanize', standalone: true })
export class HumanizePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return humanize(value);
  }
}
