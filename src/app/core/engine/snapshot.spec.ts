import { buildDemoDataset } from '../data/demo-dataset';
import { CurrencyService } from '../money/currency.service';
import { FinancialDataset } from '../models/domain.models';
import {
  Convert,
  buildSnapshot,
  cashSummary,
  essentialMonthlyExpenses,
  goalViews,
  incomeSummary,
  monthlyCashFlow,
  netWorthSummary,
  plannedExpenseViews,
} from './metrics';
import { portfolioSummary } from './portfolio.engine';
import { assessStrategy, StrategyInputs } from './strategy.engine';

function converterFor(data: FinancialDataset): Convert {
  const currency = new CurrencyService();
  currency.loadRates(data.exchangeRates);
  currency.setBase(data.profile.baseCurrency, data.profile.locale);
  return (amount, from) => currency.toBase(amount, from);
}

function inputsFor(data: FinancialDataset, convert: Convert): StrategyInputs {
  return {
    data,
    cash: cashSummary(data, convert),
    cashFlow: monthlyCashFlow(data, convert, 30),
    goals: goalViews(data, convert),
    planned: plannedExpenseViews(data, convert),
    essentialExpenses: essentialMonthlyExpenses(data, convert),
    monthlyIncome: incomeSummary(data, convert).monthlyRecurring,
    portfolioValue: portfolioSummary(data, convert).totalValue,
    currency: 'EUR',
    locale: 'en-IE',
  };
}

/** A brand-new account: profile and defaults, nothing entered yet. */
function emptyAccount(): FinancialDataset {
  const demo = buildDemoDataset();
  return {
    ...demo,
    accounts: [],
    recurringExpenses: [],
    incomeSources: [],
    incomeHistory: [],
    investmentAccounts: [],
    investments: [],
    investmentTransactions: [],
    investmentAllocations: [],
    targetAllocations: [],
    properties: [],
    propertyValuations: [],
    otherAssets: [],
    liabilities: [],
    goals: [],
    plannedExpenses: [],
    netWorthSnapshots: [],
    portfolioSnapshots: [],
    accountBalanceSnapshots: [],
  };
}

describe('buildSnapshot', () => {
  const data = buildDemoDataset();
  const convert = converterFor(data);
  const snapshot = buildSnapshot(data, convert, 'EUR', new Date(2026, 9, 9));

  it('is dated as given', () => {
    expect(snapshot.snapshotDate).toBe('2026-10-09');
  });

  it('agrees with the net-worth summary', () => {
    const worth = netWorthSummary(data, convert);
    expect(snapshot.netWorth.netWorth).toBe(worth.netWorth);
    expect(snapshot.netWorth.cashValue).toBe(worth.cash);
    expect(snapshot.netWorth.liabilities).toBe(worth.totalLiabilities);
  });

  it('reads every live cash account and leaves credit cards out', () => {
    const expected = data.accounts.filter((a) => !a.isArchived && a.accountType !== 'credit_card');
    expect(snapshot.accounts.length).toBe(expected.length);
    const cards = new Set(data.accounts.filter((a) => a.accountType === 'credit_card').map((a) => a.id));
    expect(snapshot.accounts.some((a) => cards.has(a.accountId))).toBeFalse();
  });

  it('stores balances in the base currency, so they add up to the cash total', () => {
    const total = snapshot.accounts.reduce((sum, a) => sum + a.balance, 0);
    expect(total).toBeCloseTo(snapshot.netWorth.cashValue, 0);
  });

  it('splits the portfolio into money put in and growth', () => {
    const { totalValue, totalContributions, totalGain } = snapshot.portfolio;
    expect(totalValue - totalContributions).toBeCloseTo(totalGain, 1);
  });
});

describe('strategy for a brand-new account', () => {
  it('says "getting started" rather than "off track"', () => {
    const data = emptyAccount();
    const assessment = assessStrategy(inputsFor(data, converterFor(data)));
    expect(assessment.status).toBe('getting-started');
    expect(assessment.signals.some((s) => s.tone === 'bad')).toBeFalse();
  });

  it('still says "getting started" with accounts but no history', () => {
    const data = emptyAccount();
    data.accounts = buildDemoDataset().accounts;
    const assessment = assessStrategy(inputsFor(data, converterFor(data)));
    expect(assessment.status).toBe('getting-started');
  });
});
