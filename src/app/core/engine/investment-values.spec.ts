import { buildDemoDataset } from '../data/demo-dataset';
import { FinancialDataset, Investment, InvestmentAccount, InvestmentTransaction } from '../models/domain.models';
import { investmentFlowsByMonth, investmentTotals } from './investment-values';
import { identityConvert, monthlyCashFlow, netWorthSummary } from './metrics';
import { portfolioSummary } from './portfolio.engine';

const USER = 'u';

function account(overrides: Partial<InvestmentAccount> = {}): InvestmentAccount {
  return {
    id: 'acc', userId: USER, name: 'All my investing', broker: 'Some broker', currency: 'EUR',
    currentValue: 10_000, valueUpdatedAt: new Date().toISOString(), contributedBefore: 8_000,
    sortOrder: 0, notes: null, ...overrides,
  };
}

function holding(overrides: Partial<Investment> = {}): Investment {
  return {
    id: 'h1', userId: USER, investmentAccountId: 'acc', name: 'World ETF', ticker: null, isin: null,
    assetType: 'etf', quantity: 10, averageCost: 90, currentPrice: 100, currency: 'EUR', region: null,
    sector: null, expenseRatio: null, targetAllocation: null, realisedGain: 0, priceUpdatedAt: null,
    notes: null, ...overrides,
  };
}

function flow(type: 'deposit' | 'withdrawal' | 'buy', amount: number, date: string, extra: Partial<InvestmentTransaction> = {}): InvestmentTransaction {
  return {
    id: `${type}-${date}-${amount}`, userId: USER, investmentId: null, investmentAccountId: 'acc',
    transactionType: type, quantity: 0, price: 0, amount, fees: 0, currency: 'EUR',
    transactionDate: date, notes: null, ...extra,
  };
}

/** No investments at all, otherwise the demo household. */
function base(): FinancialDataset {
  return { ...buildDemoDataset(), investmentAccounts: [], investments: [], investmentTransactions: [], investmentAllocations: [] };
}

describe('investment accounts valued as a total', () => {
  it('uses the entered total and money put in', () => {
    const data = { ...base(), investmentAccounts: [account()] };
    const totals = investmentTotals(data, identityConvert);
    expect(totals.valueBase).toBe(10_000);
    expect(totals.moneyInBase).toBe(8_000);
    expect(totals.profitBase).toBe(2_000);
    expect(totals.accounts[0].mode).toBe('total');
  });

  it('adds deposits and subtracts withdrawals from money in', () => {
    const data = {
      ...base(),
      investmentAccounts: [account()],
      investmentTransactions: [flow('deposit', 500, '2026-09-03'), flow('withdrawal', 200, '2026-09-20')],
    };
    expect(investmentTotals(data, identityConvert).moneyInBase).toBe(8_300);
  });

  it('treats holdings inside it as a breakdown, not extra money', () => {
    const data = { ...base(), investmentAccounts: [account()], investments: [holding()] };
    const totals = investmentTotals(data, identityConvert);
    expect(totals.valueBase).toBe(10_000);
    expect(totals.accounts[0].holdingsValueBase).toBe(1_000);
    expect(totals.accounts[0].notBrokenDownBase).toBe(9_000);
  });

  it('flows through to net worth and the portfolio summary', () => {
    const data = { ...base(), investmentAccounts: [account()], investments: [holding()] };
    expect(netWorthSummary(data, identityConvert).investments).toBe(10_000);
    const summary = portfolioSummary(data, identityConvert);
    expect(summary.totalValue).toBe(10_000);
    expect(summary.unrealisedGain).toBe(2_000);
    expect(summary.positions[0].countsInTotal).toBeFalse();
  });

  it('flags a total that has not been updated for over a month', () => {
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const data = { ...base(), investmentAccounts: [account({ valueUpdatedAt: old })] };
    expect(investmentTotals(data, identityConvert).accounts[0].stale).toBeTrue();
  });
});

describe('investment accounts valued from holdings', () => {
  it('adds up the holdings and uses their cost as money in', () => {
    const data = { ...base(), investmentAccounts: [account({ currentValue: null })], investments: [holding()] };
    const totals = investmentTotals(data, identityConvert);
    expect(totals.accounts[0].mode).toBe('holdings');
    expect(totals.valueBase).toBe(1_000);
    expect(totals.moneyInBase).toBe(900);
  });

  it('leaves the demo portfolio value unchanged', () => {
    const data = buildDemoDataset();
    const fromHoldings = data.investments.reduce((sum, i) => sum + i.quantity * i.currentPrice, 0);
    // Demo holdings are EUR except one USD tracker, so compare with identity conversion.
    expect(investmentTotals(data, identityConvert).valueBase).toBeCloseTo(fromHoldings, 1);
  });
});

describe('money moved into investments, by month', () => {
  it('counts deposits, and buys only outside a total-valued account', () => {
    const data = {
      ...base(),
      investmentAccounts: [account(), account({ id: 'broker', currentValue: null })],
      investments: [holding(), holding({ id: 'h2', investmentAccountId: 'broker' })],
      investmentTransactions: [
        flow('deposit', 500, '2026-09-03'),
        // A buy inside the total-valued account moves money already deposited.
        flow('buy', 300, '2026-09-10', { investmentId: 'h1', investmentAccountId: null, quantity: 3, price: 100 }),
        // A buy of an individually valued holding is new money.
        flow('buy', 200, '2026-09-12', { investmentId: 'h2', investmentAccountId: null, quantity: 2, price: 100 }),
      ],
    };
    expect(investmentFlowsByMonth(data, identityConvert).get('2026-09-01')).toBe(700);
  });

  it("doesn't count a transfer to an investment account as spending", () => {
    const data = buildDemoDataset();
    const before = monthlyCashFlow(data, identityConvert, 30);
    const month = before.at(-2)!.month;
    data.investmentAccounts = [...data.investmentAccounts, account()];
    data.investmentTransactions = [...data.investmentTransactions, flow('deposit', 1_000, `${month.slice(0, 7)}-15`)];
    const after = monthlyCashFlow(data, identityConvert, 30);
    const was = before.find((m) => m.month === month)!;
    const now = after.find((m) => m.month === month)!;
    expect(now.contributed - was.contributed).toBeCloseTo(1_000, 2);
    expect(was.totalExpenses - now.totalExpenses).toBeCloseTo(Math.min(1_000, was.totalExpenses), 2);
  });
});
