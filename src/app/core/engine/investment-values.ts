/**
 * What investments are worth, and how much money went into them.
 *
 * Investment accounts are the primary unit. An account is valued one of
 * two ways (see `InvestmentAccount`):
 *
 * - **total** — `currentValue` is set: the figure from the provider's
 *   statement. Holdings linked to it are an optional breakdown and are
 *   never added on top. Money in = what went in before tracking plus
 *   deposits minus withdrawals.
 * - **holdings** — `currentValue` is null: the account is the sum of its
 *   holdings (quantity × price). Money in = their purchase cost.
 *
 * Holdings with no account are valued individually, like the holdings
 * mode. Every total in the app — net worth, snapshots, forecasts, the
 * Investments page — comes from here, so they can't disagree. The SQL
 * functions `portfolio_value()` and `portfolio_cost_basis()` mirror it.
 *
 * Deliberately free of other engine imports so metrics.ts and
 * portfolio.engine.ts can both depend on it without a cycle.
 */

import { money } from '../money/money';
import { monthKey } from '../money/format';
import { FinancialDataset, Investment, InvestmentAccount } from '../models/domain.models';

type Convert = (amount: number, currency: string) => number;

/** Days after which an account total entered by hand counts as out of date. */
export const ACCOUNT_VALUE_STALE_DAYS = 35;

export interface InvestmentAccountView {
  account: InvestmentAccount;
  mode: 'total' | 'holdings';
  /** Total mode: in the account's own currency. Holdings mode: same as `valueBase`. */
  value: number;
  valueBase: number;
  moneyInBase: number;
  profitBase: number;
  /** Profit as a share of money in; null when nothing has gone in. */
  profitPercent: number | null;
  /** Share of all investments, 0–100. */
  share: number;
  holdings: Investment[];
  /** Holdings value, in base currency. For a total-mode account, the broken-down part. */
  holdingsValueBase: number;
  /** Total mode only: account value not covered by the listed holdings. */
  notBrokenDownBase: number | null;
  /** Total mode only: when the total was last entered. */
  valueUpdatedAt: string | null;
  stale: boolean;
}

export interface InvestmentTotals {
  valueBase: number;
  moneyInBase: number;
  profitBase: number;
  accounts: InvestmentAccountView[];
  /** Holdings that don't belong to any account. */
  unassigned: Investment[];
  unassignedValueBase: number;
  unassignedMoneyInBase: number;
}

export function isTotalMode(account: InvestmentAccount | undefined | null): boolean {
  return !!account && account.currentValue !== null && account.currentValue !== undefined;
}

/** Holdings whose value counts towards the totals (not just a breakdown). */
export function countedHoldings(data: FinancialDataset): Investment[] {
  const totalMode = totalModeIds(data);
  return data.investments.filter((i) => !i.investmentAccountId || !totalMode.has(i.investmentAccountId));
}

export function investmentTotals(data: FinancialDataset, convert: Convert, now = new Date()): InvestmentTotals {
  const holdingValue = (i: Investment) => convert(i.quantity * i.currentPrice, i.currency);
  const holdingCost = (i: Investment) => convert(i.quantity * i.averageCost, i.currency);
  const knownAccounts = new Set(data.investmentAccounts.map((a) => a.id));

  const views = [...data.investmentAccounts]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))
    .map((account) => {
      const holdings = data.investments.filter((i) => i.investmentAccountId === account.id);
      const holdingsValueBase = money.sumBy(holdings, holdingValue).toNumber();
      const total = isTotalMode(account);

      let value: number;
      let valueBase: number;
      let moneyInBase: number;
      if (total) {
        value = account.currentValue!;
        valueBase = convert(value, account.currency);
        const flows = data.investmentTransactions.filter((t) => t.investmentAccountId === account.id);
        moneyInBase =
          convert(account.contributedBefore ?? 0, account.currency) +
          money
            .sumBy(flows, (t) =>
              t.transactionType === 'deposit'
                ? convert(t.amount ?? 0, t.currency)
                : t.transactionType === 'withdrawal'
                  ? -convert(t.amount ?? 0, t.currency)
                  : 0,
            )
            .toNumber();
      } else {
        // Holdings can be in mixed currencies, so this mode is only
        // meaningful in the base currency.
        valueBase = holdingsValueBase;
        value = holdingsValueBase;
        moneyInBase = money.sumBy(holdings, holdingCost).toNumber();
      }

      const profitBase = valueBase - moneyInBase;
      return {
        account,
        mode: total ? ('total' as const) : ('holdings' as const),
        value: round2(value),
        valueBase: round2(valueBase),
        moneyInBase: round2(moneyInBase),
        profitBase: round2(profitBase),
        profitPercent: moneyInBase > 0 ? (profitBase / moneyInBase) * 100 : null,
        share: 0,
        holdings,
        holdingsValueBase: round2(holdingsValueBase),
        notBrokenDownBase: total ? round2(Math.max(0, valueBase - holdingsValueBase)) : null,
        valueUpdatedAt: total ? account.valueUpdatedAt ?? null : null,
        stale: total ? isStale(account.valueUpdatedAt, now) : false,
      };
    });

  const unassigned = data.investments.filter((i) => !i.investmentAccountId || !knownAccounts.has(i.investmentAccountId));
  const unassignedValueBase = money.sumBy(unassigned, holdingValue).toNumber();
  const unassignedMoneyInBase = money.sumBy(unassigned, holdingCost).toNumber();

  const valueBase = money.sumBy(views, (v) => v.valueBase).toNumber() + unassignedValueBase;
  const moneyInBase = money.sumBy(views, (v) => v.moneyInBase).toNumber() + unassignedMoneyInBase;
  for (const view of views) view.share = valueBase > 0 ? (view.valueBase / valueBase) * 100 : 0;

  return {
    valueBase: round2(valueBase),
    moneyInBase: round2(moneyInBase),
    profitBase: round2(valueBase - moneyInBase),
    accounts: views,
    unassigned,
    unassignedValueBase: round2(unassignedValueBase),
    unassignedMoneyInBase: round2(unassignedMoneyInBase),
  };
}

/**
 * Net money that left cash for investments, per month ('YYYY-MM').
 *
 * Deposits into accounts count, and so do buys of holdings valued
 * individually. A buy *inside* a total-mode account doesn't: that money
 * already left cash when it was deposited.
 */
export function investmentFlowsByMonth(data: FinancialDataset, convert: Convert): Map<string, number> {
  const totalMode = totalModeIds(data);
  const accountOf = new Map(data.investments.map((i) => [i.id, i.investmentAccountId]));
  const out = new Map<string, number>();

  for (const t of data.investmentTransactions) {
    let sign = 0;
    if (t.transactionType === 'deposit') sign = 1;
    else if (t.transactionType === 'withdrawal') sign = -1;
    else if (t.transactionType === 'buy' || t.transactionType === 'sell') {
      const accountId = t.investmentId ? accountOf.get(t.investmentId) : null;
      if (accountId && totalMode.has(accountId)) continue;
      sign = t.transactionType === 'buy' ? 1 : -1;
    }
    if (!sign) continue;

    const amount = convert(t.amount ?? t.quantity * t.price, t.currency);
    const key = monthKey(t.transactionDate);
    out.set(key, (out.get(key) ?? 0) + sign * amount);
  }
  return out;
}

function totalModeIds(data: FinancialDataset): Set<string> {
  return new Set(data.investmentAccounts.filter(isTotalMode).map((a) => a.id));
}

function isStale(updatedAt: string | null | undefined, now: Date): boolean {
  if (!updatedAt) return true;
  return now.getTime() - new Date(updatedAt).getTime() > ACCOUNT_VALUE_STALE_DAYS * 86_400_000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
