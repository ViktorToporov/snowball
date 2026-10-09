/**
 * Derived financial metrics.
 *
 * Pure functions over a `FinancialDataset` — no Angular, no signals, no
 * I/O — so the numbers can be reasoned about (and unit-tested) on their
 * own. `FinanceStore` wraps them in computed signals; components never
 * do arithmetic themselves.
 *
 * Every function converts into the user's base currency through the
 * injected `convert` callback, so nothing here assumes EUR.
 */

import { addMonths, monthKey, monthsUntil, parseDate, startOfMonth, toIsoDate } from '../money/format';
import { dec, money } from '../money/money';
import {
  Account,
  Category,
  CategoryType,
  FinancialDataset,
  Goal,
  PlannedExpense,
  Property,
  RecurringExpense,
  SnapshotRecord,
} from '../models/domain.models';

/** Converts an amount from a source currency into the base currency. */
export type Convert = (amount: number, currency: string) => number;

export const identityConvert: Convert = (amount) => amount;

/* ==================================================================== */
/* Cash                                                                  */
/* ==================================================================== */

export interface AccountView extends Account {
  balanceBase: number;
  /** Interest this account is expected to throw off over 12 months. */
  annualInterest: number;
  shareOfLiquid: number;
  /** Set when the account has a ceiling (e.g. physical cash) and is over it. */
  overCeilingBy: number | null;
}

export interface CashSummary {
  liquidTotal: number;
  emergencyBalance: number;
  emergencyTarget: number;
  emergencyProgress: number;
  /** Cash still needed to fill the emergency fund. */
  emergencyShortfall: number;
  /** Liquid cash sitting above the emergency target. */
  aboveTarget: number;
  annualInterest: number;
  blendedRate: number;
  accounts: AccountView[];
}

export function cashSummary(data: FinancialDataset, convert: Convert): CashSummary {
  const live = data.accounts.filter((a) => !a.isArchived);

  const liquid = live.filter((a) => a.countsAsLiquid && a.accountType !== 'credit_card');
  const liquidTotal = money.sumBy(liquid, (a) => convert(a.balance, a.currency)).toNumber();

  const emergencyBalance = money
    .sumBy(live.filter((a) => a.countsAsEmergencyFund), (a) => convert(a.balance, a.currency))
    .toNumber();

  const target = data.profile.emergencyFundTarget;
  const annualInterest = money
    .sumBy(liquid, (a) => convert(a.balance, a.currency) * a.interestRate)
    .toNumber();

  const accounts: AccountView[] = live
    .map((account) => {
      const balanceBase = convert(account.balance, account.currency);
      return {
        ...account,
        balanceBase,
        annualInterest: money.round(balanceBase * account.interestRate, 2).toNumber(),
        shareOfLiquid: liquidTotal > 0 && account.countsAsLiquid ? (balanceBase / liquidTotal) * 100 : 0,
        overCeilingBy:
          account.targetBalance !== null &&
          account.accountType === 'physical_cash' &&
          balanceBase > account.targetBalance
            ? money.round(balanceBase - account.targetBalance, 2).toNumber()
            : null,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || b.balanceBase - a.balanceBase);

  return {
    liquidTotal: round2(liquidTotal),
    emergencyBalance: round2(emergencyBalance),
    emergencyTarget: target,
    emergencyProgress: target > 0 ? Math.min(100, (emergencyBalance / target) * 100) : 100,
    emergencyShortfall: round2(Math.max(0, target - emergencyBalance)),
    aboveTarget: round2(Math.max(0, liquidTotal - target)),
    annualInterest: round2(annualInterest),
    blendedRate: liquidTotal > 0 ? (annualInterest / liquidTotal) * 100 : 0,
    accounts,
  };
}

/** Total liquid cash at each month end, from the balance snapshots. */
export function cashHistory(data: FinancialDataset): Array<{ date: string; value: number }> {
  const liquidIds = new Set(
    data.accounts.filter((a) => a.countsAsLiquid && !a.isArchived).map((a) => a.id),
  );

  const byDate = new Map<string, number>();
  for (const snapshot of data.accountBalanceSnapshots) {
    if (!liquidIds.has(snapshot.accountId)) continue;
    byDate.set(snapshot.snapshotDate, (byDate.get(snapshot.snapshotDate) ?? 0) + snapshot.balance);
  }

  return [...byDate.entries()]
    .map(([date, value]) => ({ date, value: round2(value) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Total cash at each month end, across every non-card account.
 *
 * Measured across *all* cash accounts on purpose: moving money between
 * your own accounts nets to zero here, so an internal transfer can never
 * be mistaken for spending by the derivation in `monthlyCashFlow`.
 */
export function totalCashHistory(data: FinancialDataset): Array<{ date: string; value: number }> {
  const counted = new Set(
    data.accounts.filter((a) => !a.isArchived && a.accountType !== 'credit_card').map((a) => a.id),
  );

  const byDate = new Map<string, number>();
  for (const snapshot of data.accountBalanceSnapshots) {
    if (!counted.has(snapshot.accountId)) continue;
    byDate.set(snapshot.snapshotDate, (byDate.get(snapshot.snapshotDate) ?? 0) + snapshot.balance);
  }

  return [...byDate.entries()]
    .map(([date, value]) => ({ date, value: round2(value) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* ==================================================================== */
/* Cash flow                                                             */
/* ==================================================================== */

export interface CashFlowMonth {
  month: string;
  income: number;
  /** The declared baseline, capped at what was actually spent. */
  essential: number;
  /** Everything spent beyond the baseline. */
  flexible: number;
  totalExpenses: number;
  /** Money that went into investments rather than being spent. */
  contributed: number;
  net: number;
  savingsRate: number;
}

/** How much a recurring expense costs in an average month. */
const EXPENSE_FREQUENCY_TO_MONTHLY: Record<string, number> = {
  monthly: 1,
  quarterly: 1 / 3,
  annual: 1 / 12,
};

/**
 * The declared cost of living, normalised to a month.
 *
 * This is the baseline the user states once — rent, mortgage, insurance,
 * groceries — not a measurement. It is the denominator for runway and
 * the dividing line between essential and flexible spending.
 */
export function essentialMonthlyExpenses(data: FinancialDataset, convert: Convert): number {
  const today = toIsoDate(new Date());
  return round2(
    money
      .sumBy(
        data.recurringExpenses.filter((e) => e.active && (!e.endDate || e.endDate >= today)),
        (e) => convert(e.amount, e.currency) * (EXPENSE_FREQUENCY_TO_MONTHLY[e.frequency] ?? 0),
      )
      .toNumber(),
  );
}

/**
 * Monthly cash flow, derived rather than itemised.
 *
 * Snowball has no transaction ledger, so spending is inferred from what
 * the money actually did:
 *
 *     spending = income − investment contributions − change in cash
 *
 * Anything income bought that is not still sitting in cash, and did not
 * go into investments, was spent. The essential slice is the declared
 * baseline; the remainder is flexible. Both are capped so the two always
 * add back up to the total.
 */
export function monthlyCashFlow(data: FinancialDataset, convert: Convert, months = 13): CashFlowMonth[] {
  const cash = totalCashHistory(data);
  if (cash.length < 2) return [];

  const essentialBudget = essentialMonthlyExpenses(data, convert);

  // Income actually recorded for each month.
  const incomeByMonth = new Map<string, number>();
  for (const entry of data.incomeHistory) {
    const key = monthKey(entry.periodMonth);
    incomeByMonth.set(key, (incomeByMonth.get(key) ?? 0) + convert(entry.netAmount, entry.currency));
  }

  // Net money moved into investments in each month.
  const contributedByMonth = new Map<string, number>();
  for (const txn of data.investmentTransactions) {
    if (txn.transactionType !== 'buy' && txn.transactionType !== 'sell') continue;
    const key = monthKey(txn.transactionDate);
    const amount = convert(txn.amount ?? txn.quantity * txn.price, txn.currency);
    const signed = txn.transactionType === 'buy' ? amount : -amount;
    contributedByMonth.set(key, (contributedByMonth.get(key) ?? 0) + signed);
  }

  // One cash reading per month — the latest in that month.
  const cashByMonth = new Map<string, number>();
  for (const point of cash) cashByMonth.set(monthKey(point.date), point.value);

  const orderedMonths = [...cashByMonth.keys()].sort();
  const out: CashFlowMonth[] = [];

  for (let i = 1; i < orderedMonths.length; i += 1) {
    const month = orderedMonths[i];
    const closing = cashByMonth.get(month)!;
    const opening = cashByMonth.get(orderedMonths[i - 1])!;

    const income = round2(incomeByMonth.get(month) ?? 0);
    const contributed = round2(contributedByMonth.get(month) ?? 0);
    const spending = Math.max(0, round2(income - contributed - (closing - opening)));

    const essential = round2(Math.min(essentialBudget, spending));
    const flexible = round2(spending - essential);

    out.push({
      month,
      income,
      essential,
      flexible,
      totalExpenses: round2(spending),
      contributed,
      net: round2(income - spending),
      savingsRate: income > 0 ? ((income - spending) / income) * 100 : 0,
    });
  }

  return out.slice(-months);
}

export function categoryTypeLookup(categories: readonly Category[]): Map<string, CategoryType> {
  return new Map(categories.map((c) => [c.id, c.categoryType]));
}

export interface CategoryBreakdown {
  categoryId: string;
  name: string;
  type: CategoryType;
  amount: number;
  share: number;
  itemCount: number;
}

/**
 * The declared baseline, grouped by category.
 *
 * Only the recurring side can be broken down — flexible spending is a
 * residual, not a list of items, so the app never pretends to know what
 * it was made of.
 */
export function essentialsByCategory(
  expenses: readonly RecurringExpense[],
  categories: readonly Category[],
  convert: Convert,
): CategoryBreakdown[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const totals = new Map<string, { amount: number; count: number }>();

  for (const expense of expenses) {
    if (!expense.active) continue;
    const key = expense.categoryId ?? 'uncategorised';
    const entry = totals.get(key) ?? { amount: 0, count: 0 };
    entry.amount +=
      convert(expense.amount, expense.currency) * (EXPENSE_FREQUENCY_TO_MONTHLY[expense.frequency] ?? 0);
    entry.count += 1;
    totals.set(key, entry);
  }

  const grand = [...totals.values()].reduce((a, b) => a + b.amount, 0);

  return [...totals.entries()]
    .map(([categoryId, { amount, count }]) => ({
      categoryId,
      name: byId.get(categoryId)?.name ?? 'Uncategorised',
      type: byId.get(categoryId)?.categoryType ?? ('essential' as CategoryType),
      amount: round2(amount),
      share: grand > 0 ? (amount / grand) * 100 : 0,
      itemCount: count,
    }))
    .sort((a, b) => b.amount - a.amount);
}

/* ==================================================================== */
/* Income                                                                */
/* ==================================================================== */

export interface IncomeSummary {
  /** Recurring income normalised to a month, from `income_sources`. */
  monthlyRecurring: number;
  /** Average realised income over the trailing window. */
  averageRealised: number;
  currentMonth: number;
  previousMonth: number;
  annualised: number;
  /** Year-on-year growth of realised income, where 12+ months exist. */
  growth: number | null;
  /** Every month, including the one in progress — for the full chart. */
  history: Array<{ month: string; net: number; gross: number | null }>;
  /** Complete months only — for sparklines and averages. */
  completeHistory: Array<{ month: string; net: number; gross: number | null }>;
}

const FREQUENCY_TO_MONTHLY: Record<string, number> = {
  monthly: 1,
  quarterly: 1 / 3,
  annual: 1 / 12,
  one_off: 0,
};

export function incomeSummary(data: FinancialDataset, convert: Convert): IncomeSummary {
  const today = toIsoDate(new Date());

  const monthlyRecurring = money
    .sumBy(
      data.incomeSources.filter((s) => s.active && (!s.endDate || s.endDate >= today)),
      (s) => convert(s.amount, s.currency) * (FREQUENCY_TO_MONTHLY[s.frequency] ?? 0),
    )
    .toNumber();

  /* Several sources can pay in the same month — salary, rent, a bonus —
     so history is aggregated per month rather than listed per row.
     Comparing a rent row against a salary row a year earlier would
     produce nonsense growth. */
  const byMonth = new Map<string, { net: number; gross: number | null }>();
  for (const entry of data.incomeHistory) {
    const bucket = byMonth.get(entry.periodMonth) ?? { net: 0, gross: null };
    bucket.net += convert(entry.netAmount, entry.currency);
    if (entry.grossAmount !== null) {
      bucket.gross = (bucket.gross ?? 0) + convert(entry.grossAmount, entry.currency);
    }
    byMonth.set(entry.periodMonth, bucket);
  }

  const history = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, totals]) => ({
      month,
      net: round2(totals.net),
      gross: totals.gross === null ? null : round2(totals.gross),
    }));

  /* The calendar month in progress is usually only part-paid, so it is
     excluded from every average and comparison — otherwise a mid-month
     reading looks like a collapse in income. It stays in `history` so
     the chart still shows it. */
  const currentKey = monthKey(new Date());
  const complete = history.filter((entry) => entry.month !== currentKey);

  const recent = complete.slice(-12);
  const averageRealised = recent.length
    ? round2(recent.reduce((a, b) => a + b.net, 0) / recent.length)
    : monthlyRecurring;

  const currentMonth = complete.at(-1)?.net ?? monthlyRecurring;
  const previousMonth = complete.at(-2)?.net ?? currentMonth;

  let growth: number | null = null;
  if (complete.length >= 13) {
    const yearAgo = complete.at(-13)!.net;
    growth = yearAgo > 0 ? ((currentMonth - yearAgo) / yearAgo) * 100 : null;
  }

  return {
    monthlyRecurring: round2(monthlyRecurring),
    averageRealised,
    currentMonth,
    previousMonth,
    annualised: round2(monthlyRecurring * 12),
    growth,
    history,
    completeHistory: complete,
  };
}

/* ==================================================================== */
/* Net worth                                                             */
/* ==================================================================== */

export interface NetWorthComponent {
  key: string;
  label: string;
  value: number;
  kind: 'asset' | 'liability';
  liquid: boolean;
}

export interface NetWorthSummary {
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  liquidNetWorth: number;
  investedNetWorth: number;
  propertyEquity: number;
  cash: number;
  investments: number;
  propertyValue: number;
  otherAssets: number;
  components: NetWorthComponent[];
  /** Change vs the snapshot nearest one month ago. */
  changeMonth: number | null;
  changeMonthPercent: number | null;
  changeYear: number | null;
}

export function netWorthSummary(data: FinancialDataset, convert: Convert): NetWorthSummary {
  const cash = money
    .sumBy(
      data.accounts.filter((a) => !a.isArchived && a.accountType !== 'credit_card'),
      (a) => convert(a.balance, a.currency),
    )
    .toNumber();

  const investments = money
    .sumBy(data.investments, (i) => convert(i.quantity * i.currentPrice, i.currency))
    .toNumber();

  const propertyValue = money.sumBy(data.properties, (p) => convert(p.estimatedValue, p.currency)).toNumber();
  const mortgages = money.sumBy(data.properties, (p) => convert(p.mortgageBalance, p.currency)).toNumber();
  const otherAssets = money.sumBy(data.otherAssets, (a) => convert(a.currentValue, a.currency)).toNumber();
  const otherDebt = money.sumBy(data.liabilities, (l) => convert(l.balance, l.currency)).toNumber();
  const creditCards = money
    .sumBy(
      data.accounts.filter((a) => !a.isArchived && a.accountType === 'credit_card'),
      (a) => convert(Math.abs(a.balance), a.currency),
    )
    .toNumber();

  const totalAssets = cash + investments + propertyValue + otherAssets;
  const totalLiabilities = mortgages + otherDebt + creditCards;
  const netWorth = totalAssets - totalLiabilities;

  const components: NetWorthComponent[] = (
    [
      { key: 'cash', label: 'Cash', value: round2(cash), kind: 'asset', liquid: true },
      { key: 'investments', label: 'Investments', value: round2(investments), kind: 'asset', liquid: true },
      { key: 'property', label: 'Property', value: round2(propertyValue), kind: 'asset', liquid: false },
      { key: 'other', label: 'Other assets', value: round2(otherAssets), kind: 'asset', liquid: false },
      { key: 'mortgage', label: 'Mortgages', value: round2(mortgages), kind: 'liability', liquid: false },
      { key: 'debt', label: 'Other debt', value: round2(otherDebt + creditCards), kind: 'liability', liquid: false },
    ] satisfies NetWorthComponent[]
  ).filter((c) => c.value !== 0);

  const history = [...data.netWorthSnapshots].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  const monthAgo = nearestSnapshot(history, addMonths(new Date(), -1));
  const yearAgo = nearestSnapshot(history, addMonths(new Date(), -12));

  return {
    netWorth: round2(netWorth),
    totalAssets: round2(totalAssets),
    totalLiabilities: round2(totalLiabilities),
    liquidNetWorth: round2(cash + investments - otherDebt - creditCards),
    investedNetWorth: round2(investments),
    propertyEquity: round2(propertyValue - mortgages),
    cash: round2(cash),
    investments: round2(investments),
    propertyValue: round2(propertyValue),
    otherAssets: round2(otherAssets),
    components,
    changeMonth: monthAgo ? round2(netWorth - monthAgo.netWorth) : null,
    changeMonthPercent: monthAgo ? money.changePercent(netWorth, monthAgo.netWorth) : null,
    changeYear: yearAgo ? round2(netWorth - yearAgo.netWorth) : null,
  };
}

/**
 * Today's balances as a snapshot record, in the base currency.
 *
 * Credit cards are left out of the account readings (they are debt, not
 * cash), matching `totalCashHistory`. Portfolio contributions come from
 * the cost basis of what is currently held.
 */
export function buildSnapshot(
  data: FinancialDataset,
  convert: Convert,
  currency: string,
  date: Date = new Date(),
): SnapshotRecord {
  const worth = netWorthSummary(data, convert);
  const contributions = money
    .sumBy(data.investments, (i) => convert(i.quantity * i.averageCost, i.currency))
    .toNumber();

  return {
    snapshotDate: toIsoDate(date),
    currency,
    accounts: data.accounts
      .filter((a) => !a.isArchived && a.accountType !== 'credit_card')
      .map((a) => ({ accountId: a.id, balance: round2(convert(a.balance, a.currency)) })),
    netWorth: {
      cashValue: worth.cash,
      investmentValue: worth.investments,
      propertyValue: worth.propertyValue,
      otherAssets: worth.otherAssets,
      liabilities: worth.totalLiabilities,
      netWorth: worth.netWorth,
    },
    portfolio: {
      totalValue: worth.investments,
      totalContributions: round2(contributions),
      totalGain: round2(worth.investments - contributions),
    },
  };
}

function nearestSnapshot<T extends { snapshotDate: string }>(sorted: readonly T[], target: Date): T | null {
  if (!sorted.length) return null;
  const iso = toIsoDate(target);
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const snapshot of sorted) {
    const distance = Math.abs(new Date(snapshot.snapshotDate).getTime() - new Date(iso).getTime());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = snapshot;
    }
  }
  // Only meaningful if we landed within ~20 days of the target.
  return bestDistance <= 20 * 86_400_000 ? best : null;
}

/* ==================================================================== */
/* Property                                                              */
/* ==================================================================== */

/**
 * One line of the property cash-flow waterfall.
 *
 * `running` is the money still on the table *after* this step, which is
 * what makes the panel read as a drain-down rather than four unrelated
 * bars.
 */
export interface WaterfallStep {
  label: string;
  /** The signed movement this step represents. */
  amount: number;
  /** What is left after it. */
  running: number;
  kind: 'in' | 'out' | 'result';
  note?: string;
  /**
   * The interest/principal split, where the step is a mortgage payment.
   * Kept as numbers rather than a formatted string: this module is pure
   * and has no business deciding how a currency looks.
   */
  split?: { interest: number; principal: number };
}

export interface PropertyMetrics {
  property: Property;
  equity: number;
  loanToValue: number;
  monthlyInterest: number;
  monthlyPrincipal: number;
  /** rent − property expenses − mortgage payment. */
  monthlyCashFlow: number;
  annualCashFlow: number;
  grossYield: number;
  netYield: number;
  /** The rent → expenses → mortgage → reserve waterfall. */
  waterfall: WaterfallStep[];
  /** How this property is actually being used. */
  usage: 'let' | 'lived-in' | 'empty';
  equityIn: (months: number) => number;
  appreciationSincePurchase: number | null;
}

export function propertyMetrics(property: Property, convert: Convert): PropertyMetrics {
  const value = convert(property.estimatedValue, property.currency);
  const balance = convert(property.mortgageBalance, property.currency);
  const payment = convert(property.monthlyPayment, property.currency);
  const rent = convert(property.monthlyRent, property.currency);
  const expenses = convert(property.monthlyPropertyExpenses, property.currency);

  const monthlyInterest = round2((balance * property.mortgageInterestRate) / 12);
  const monthlyPrincipal = round2(Math.max(0, Math.min(payment - monthlyInterest, balance)));
  const cashFlow = round2(rent - expenses - payment);

  /* Three genuinely different situations, so three different readouts.
     A home you live in has no rent to route; an empty rental has no rent
     yet but still costs money every month. */
  const usage: PropertyMetrics['usage'] =
    property.rentalStatus === 'owner_occupied' ? 'lived-in' : rent > 0 ? 'let' : 'empty';

  const split = { interest: monthlyInterest, principal: monthlyPrincipal };
  const carryingCost = round2(payment + expenses);
  let waterfall: WaterfallStep[];

  if (usage === 'let') {
    waterfall = [
      {
        label: 'Rent received',
        amount: round2(rent), running: round2(rent), kind: 'in',
        note: 'What the tenant pays each month',
      },
      {
        label: 'Running costs',
        amount: round2(-expenses), running: round2(rent - expenses), kind: 'out',
        note: 'Management, insurance, service charge and repairs',
      },
      {
        label: 'Mortgage payment',
        amount: round2(-payment), running: cashFlow, kind: 'out',
        note: 'Part interest to the lender, part straight off what you owe',
        split,
      },
      {
        label: cashFlow >= 0 ? 'Left for the Property Reserve' : 'Shortfall you cover yourself',
        amount: cashFlow, running: cashFlow, kind: 'result',
        note:
          cashFlow >= 0
            ? 'Ring-fenced for repairs and void periods — never lifestyle money'
            : 'The property does not currently pay for itself',
      },
    ];
  } else if (usage === 'lived-in') {
    waterfall = [
      {
        label: 'Mortgage payment', amount: round2(-payment), running: round2(payment), kind: 'out',
        note: 'Part interest to the lender, part straight off what you owe', split,
      },
      { label: 'Running costs', amount: round2(-expenses), running: carryingCost, kind: 'out',
        note: 'Insurance, maintenance and charges' },
      { label: 'Total monthly cost', amount: round2(-carryingCost), running: carryingCost, kind: 'result',
        note: 'Paid from income — there is no rent coming in' },
    ];
  } else {
    waterfall = [
      {
        label: 'Mortgage payment', amount: round2(-payment), running: round2(payment), kind: 'out',
        note: 'Part interest to the lender, part straight off what you owe', split,
      },
      { label: 'Running costs', amount: round2(-expenses), running: carryingCost, kind: 'out',
        note: 'Still payable while the property sits empty' },
      { label: 'Monthly carrying cost', amount: round2(-carryingCost), running: carryingCost, kind: 'result',
        note: 'Funded from your own cash until a tenant is found' },
    ];
  }

  return {
    property,
    equity: round2(value - balance),
    loanToValue: value > 0 ? (balance / value) * 100 : 0,
    monthlyInterest,
    monthlyPrincipal,
    monthlyCashFlow: cashFlow,
    annualCashFlow: round2(cashFlow * 12),
    grossYield: value > 0 ? ((rent * 12) / value) * 100 : 0,
    netYield: value > 0 ? (((rent - expenses) * 12) / value) * 100 : 0,
    waterfall,
    usage,
    equityIn: (months: number) => {
      let remaining = balance;
      for (let m = 0; m < months && remaining > 0; m += 1) {
        const interest = (remaining * property.mortgageInterestRate) / 12;
        remaining = Math.max(0, remaining - Math.max(0, payment - interest));
      }
      const grown = value * Math.pow(1 + property.annualAppreciation, months / 12);
      return round2(grown - remaining);
    },
    appreciationSincePurchase:
      property.purchasePrice && property.purchasePrice > 0
        ? ((value - convert(property.purchasePrice, property.currency)) /
            convert(property.purchasePrice, property.currency)) *
          100
        : null,
  };
}

/**
 * Rent the household *pays* for the roof over its head.
 *
 * Deliberately separate from rent it *receives* on a let property. The
 * two are opposite directions of the same word, and conflating them is
 * the quickest way to make a property page lie.
 */
export function monthlyRentPaid(data: FinancialDataset, convert: Convert): number {
  const rentCategories = new Set(
    data.categories
      .filter((c) => c.categoryType === 'essential' && /^rent$/i.test(c.name.trim()))
      .map((c) => c.id),
  );
  if (!rentCategories.size) return 0;

  return round2(
    money
      .sumBy(
        data.recurringExpenses.filter((e) => e.active && rentCategories.has(e.categoryId ?? '')),
        (e) => convert(e.amount, e.currency) * (EXPENSE_FREQUENCY_TO_MONTHLY[e.frequency] ?? 0),
      )
      .toNumber(),
  );
}

export interface PropertyPortfolio {
  count: number;
  totalValue: number;
  totalDebt: number;
  totalEquity: number;
  /** Combined net monthly cash flow across every property. */
  monthlyCashFlow: number;
  loanToValue: number;
  letCount: number;
  /** True when every property owned is an investment, not a home. */
  allInvestment: boolean;
}

/** Roll-up across every property, for the page header. */
export function propertyPortfolio(metrics: readonly PropertyMetrics[]): PropertyPortfolio {
  const totalValue = round2(metrics.reduce((sum, m) => sum + m.property.estimatedValue, 0));
  const totalDebt = round2(metrics.reduce((sum, m) => sum + m.property.mortgageBalance, 0));

  return {
    count: metrics.length,
    totalValue,
    totalDebt,
    totalEquity: round2(totalValue - totalDebt),
    monthlyCashFlow: round2(metrics.reduce((sum, m) => sum + m.monthlyCashFlow, 0)),
    loanToValue: totalValue > 0 ? (totalDebt / totalValue) * 100 : 0,
    letCount: metrics.filter((m) => m.usage === 'let').length,
    allInvestment: metrics.length > 0 && metrics.every((m) => m.usage !== 'lived-in'),
  };
}

/* ==================================================================== */
/* Goals                                                                 */
/* ==================================================================== */

export interface GoalView {
  goal: Goal;
  currentAmount: number;
  progress: number;
  remaining: number;
  monthsRemaining: number | null;
  requiredMonthly: number | null;
  onTrack: boolean;
  projectedCompletion: string | null;
}

export function goalViews(data: FinancialDataset, convert: Convert): GoalView[] {
  const balances = new Map(data.accounts.map((a) => [a.id, convert(a.balance, a.currency)]));

  return data.goals
    .map((goal) => {
      const current = goal.trackAccountBalance && goal.accountId
        ? balances.get(goal.accountId) ?? goal.currentAmount
        : convert(goal.currentAmount, goal.currency);

      const target = convert(goal.targetAmount, goal.currency);
      const remaining = Math.max(0, target - current);
      const monthsRemaining = goal.targetDate ? monthsUntil(goal.targetDate) : null;
      const requiredMonthly =
        monthsRemaining === null ? null : round2(remaining / Math.max(1, monthsRemaining));

      const contribution = convert(goal.monthlyContribution, goal.currency);
      const monthsAtRate = contribution > 0 ? Math.ceil(remaining / contribution) : null;

      return {
        goal,
        currentAmount: round2(current),
        progress: target > 0 ? Math.min(100, (current / target) * 100) : 0,
        remaining: round2(remaining),
        monthsRemaining,
        requiredMonthly,
        onTrack:
          remaining === 0 ||
          (monthsRemaining === null ? contribution > 0 : contribution >= (requiredMonthly ?? 0)),
        projectedCompletion:
          monthsAtRate === null
            ? null
            : toIsoDate(addMonths(startOfMonth(new Date()), monthsAtRate)),
      };
    })
    .sort((a, b) => {
      const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
      return rank[a.goal.priority] - rank[b.goal.priority] || b.progress - a.progress;
    });
}

/* ==================================================================== */
/* Planned expenses                                                      */
/* ==================================================================== */

export interface PlannedExpenseView {
  expense: PlannedExpense;
  remaining: number;
  monthsUntil: number;
  /** "You need €X/month to have this money available by the target date." */
  requiredMonthly: number;
  progress: number;
  isOverdue: boolean;
}

export function plannedExpenseViews(data: FinancialDataset, convert: Convert): PlannedExpenseView[] {
  return data.plannedExpenses
    .filter((e) => e.status !== 'cancelled' && e.status !== 'paid')
    .map((expense) => {
      const amount = convert(expense.amount, expense.currency);
      const saved = convert(expense.savedAmount, expense.currency);
      const remaining = Math.max(0, amount - saved);
      const months = monthsUntil(expense.targetDate) ?? 0;

      return {
        expense,
        remaining: round2(remaining),
        monthsUntil: months,
        requiredMonthly: round2(remaining / Math.max(1, months)),
        progress: amount > 0 ? Math.min(100, (saved / amount) * 100) : 0,
        isOverdue: months < 0,
      };
    })
    .sort((a, b) => a.expense.targetDate.localeCompare(b.expense.targetDate));
}

/** Unfunded planned spending falling due inside `months`. */
export function committedCash(views: readonly PlannedExpenseView[], months = 3): number {
  return round2(
    views.filter((v) => v.monthsUntil <= months).reduce((total, v) => total + v.remaining, 0),
  );
}

/* ==================================================================== */
/* Timeline                                                              */
/* ==================================================================== */

export type TimelineKind =
  | 'income' | 'mortgage' | 'planned-expense' | 'investment'
  | 'rental' | 'goal' | 'recurring';

export interface TimelineEvent {
  date: string;
  title: string;
  detail: string;
  amount: number | null;
  kind: TimelineKind;
  direction: 'in' | 'out' | 'neutral';
}

/** Upcoming money events for the dashboard timeline. */
export function upcomingTimeline(data: FinancialDataset, convert: Convert, days = 120): TimelineEvent[] {
  const today = new Date();
  const horizon = new Date(today.getTime() + days * 86_400_000);
  const events: TimelineEvent[] = [];

  const nextOccurrence = (dayOfMonth: number): Date => {
    const candidate = new Date(today.getFullYear(), today.getMonth(), dayOfMonth);
    return candidate >= today ? candidate : new Date(today.getFullYear(), today.getMonth() + 1, dayOfMonth);
  };

  for (const source of data.incomeSources) {
    if (!source.active || source.frequency !== 'monthly') continue;
    events.push({
      date: toIsoDate(nextOccurrence(25)),
      title: source.name,
      detail: 'Recurring income',
      amount: convert(source.amount, source.currency),
      kind: 'income',
      direction: 'in',
    });
  }

  for (const property of data.properties) {
    if (property.monthlyPayment > 0) {
      events.push({
        date: toIsoDate(nextOccurrence(3)),
        title: `${property.name} — mortgage`,
        detail: 'Monthly mortgage payment',
        amount: -convert(property.monthlyPayment, property.currency),
        kind: 'mortgage',
        direction: 'out',
      });
    }
    if (property.expectedRentStart && property.rentalStatus !== 'rented') {
      const start = parseDate(property.expectedRentStart);
      if (start && start >= today && start <= horizon) {
        events.push({
          date: property.expectedRentStart,
          title: `${property.name} — expected tenancy start`,
          detail: 'Rental income begins; Phase 3 rules activate',
          amount: null,
          kind: 'rental',
          direction: 'neutral',
        });
      }
    }
  }

  for (const expense of data.plannedExpenses) {
    if (expense.status === 'cancelled' || expense.status === 'paid') continue;
    const due = parseDate(expense.targetDate);
    if (!due || due > horizon) continue;
    events.push({
      date: expense.targetDate,
      title: expense.name,
      detail: expense.category ? `Planned — ${expense.category}` : 'Planned expense',
      amount: -convert(expense.amount, expense.currency),
      kind: 'planned-expense',
      direction: 'out',
    });
  }

  for (const goal of data.goals) {
    if (!goal.targetDate || goal.status !== 'active') continue;
    const due = parseDate(goal.targetDate);
    if (!due || due > horizon || due < today) continue;
    events.push({
      date: goal.targetDate,
      title: `${goal.name} — target date`,
      detail: 'Goal completion date',
      amount: null,
      kind: 'goal',
      direction: 'neutral',
    });
  }

  return events
    .filter((e) => e.date >= toIsoDate(today))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 12);
}

/* ==================================================================== */
/* Security score                                                        */
/* ==================================================================== */

export interface SecurityFactor {
  key: string;
  label: string;
  detail: string;
  /** 0–1, before weighting. */
  score: number;
  weight: number;
}

export interface SecurityScore {
  score: number;
  band: 'fragile' | 'building' | 'solid' | 'secure';
  monthsOfRunway: number | null;
  factors: SecurityFactor[];
}

export interface SecurityInputs {
  emergencyProgress: number;
  emergencyBalance: number;
  essentialExpenses: number;
  monthlyIncome: number;
  liquidCash: number;
  netWorth: number;
  nonMortgageDebt: number;
  investments: number;
}

/**
 * Composite 0–100 score. The weights mirror `public.security_score()`
 * in schema.sql so the client and the database never disagree.
 */
export function securityScore(input: SecurityInputs): SecurityScore {
  const runway = input.essentialExpenses > 0 ? input.emergencyBalance / input.essentialExpenses : null;

  const savingsCapacity =
    input.monthlyIncome > 0
      ? clamp01((input.monthlyIncome - input.essentialExpenses) / input.monthlyIncome / 0.3)
      : 0;

  const debtScore =
    input.monthlyIncome > 0 ? Math.max(0, 1 - input.nonMortgageDebt / (input.monthlyIncome * 12)) : 0;

  const liquidityScore = input.netWorth > 0 ? clamp01(input.liquidCash / input.netWorth / 0.2) : 0;

  const factors: SecurityFactor[] = [
    {
      key: 'emergency',
      label: 'Emergency fund',
      detail: `${Math.round(input.emergencyProgress)}% of target`,
      score: clamp01(input.emergencyProgress / 100),
      weight: 40,
    },
    {
      key: 'runway',
      label: 'Expense runway',
      detail: runway === null ? 'No essential expenses recorded' : `${runway.toFixed(1)} months covered`,
      score: clamp01((runway ?? 0) / 6),
      weight: 20,
    },
    {
      key: 'savings',
      label: 'Savings capacity',
      detail:
        input.monthlyIncome > 0
          ? `${Math.round(((input.monthlyIncome - input.essentialExpenses) / input.monthlyIncome) * 100)}% of income is uncommitted`
          : 'No income recorded',
      score: savingsCapacity,
      weight: 15,
    },
    {
      key: 'debt',
      label: 'Debt burden',
      detail:
        input.nonMortgageDebt > 0
          ? 'Non-mortgage debt outstanding'
          : 'No non-mortgage debt',
      score: debtScore,
      weight: 15,
    },
    {
      key: 'liquidity',
      label: 'Liquidity',
      detail:
        input.netWorth > 0
          ? `${Math.round((input.liquidCash / input.netWorth) * 100)}% of net worth is liquid`
          : 'Net worth not established',
      score: liquidityScore,
      weight: 10,
    },
  ];

  const score = round1(factors.reduce((total, f) => total + f.score * f.weight, 0));

  return {
    score,
    band: score >= 80 ? 'secure' : score >= 60 ? 'solid' : score >= 35 ? 'building' : 'fragile',
    monthsOfRunway: runway === null ? null : Math.round(runway * 10) / 10,
    factors,
  };
}

/* ==================================================================== */
/* Helpers                                                               */
/* ==================================================================== */

export function round2(value: number): number {
  return dec(value).toDecimalPlaces(2).toNumber();
}

export function round1(value: number): number {
  return dec(value).toDecimalPlaces(1).toNumber();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
