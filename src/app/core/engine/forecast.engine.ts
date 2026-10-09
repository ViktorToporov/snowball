/**
 * The forecasting engine.
 *
 * Runs a month-by-month simulation of the whole financial picture:
 * salary (with raises), essential and flexible spending (inflated),
 * cash interest, investment contributions and growth, mortgage
 * amortisation, property appreciation, rental income and one-off
 * planned expenses.
 *
 * Everything it returns is an **estimate**. The assumptions are handed
 * back alongside the numbers so the UI can always show what produced
 * them — no projection is ever presented as a guaranteed return.
 */

import { addMonths, startOfMonth, toIsoDate } from '../money/format';
import { Decimal, amortiseMonth, dec, money } from '../money/money';
import { FinancialDataset, ForecastScenario } from '../models/domain.models';
import { Convert, round2 } from './metrics';

export interface ForecastPoint {
  date: string;
  monthIndex: number;
  cash: number;
  investments: number;
  propertyValue: number;
  mortgageBalance: number;
  propertyEquity: number;
  otherAssets: number;
  /** Non-mortgage debt still outstanding — loans, cards. */
  otherDebt: number;
  netWorth: number;
  /** Money paid into investments so far. */
  contributions: number;
  income: number;
  expenses: number;
  /** Cash held above the security floor at this point. */
  aboveFloor: number;
  /** Set when a planned expense lands in this month. */
  event: string | null;
}

export interface ForecastMilestone {
  label: string;
  monthIndex: number;
  date: string;
  value: number;
  kind: 'security' | 'phase' | 'goal' | 'debt';
}

export interface ForecastResult {
  scenario: ForecastScenario;
  points: ForecastPoint[];
  /** Values at 1 / 5 / 10 / 20 / 30 years, where the horizon reaches. */
  horizons: Array<{ years: number; point: ForecastPoint }>;
  milestones: ForecastMilestone[];
  assumptions: Assumption[];
  /** Month the emergency fund fills, if it does inside the horizon. */
  securityMonth: number | null;
  /** Month the cash balance first goes negative, if ever. */
  cashRunsOutMonth: number | null;
}

export interface Assumption {
  label: string;
  value: string;
  note?: string;
}

export interface ForecastInputs {
  data: FinancialDataset;
  convert: Convert;
  scenario: ForecastScenario;
  /** Current liquid cash. */
  startingCash: number;
  /** Current portfolio value. */
  startingInvestments: number;
  /** Baseline essential outgoings per month. */
  essentialExpenses: number;
  /** Current recurring monthly net income. */
  monthlyIncome: number;
  /** Blended cash interest rate, used when the scenario leaves it at 0. */
  blendedCashRate?: number;
  years?: number;
  formatCurrency: (value: number) => string;
  formatPercent: (value: number) => string;
}

const HORIZON_YEARS = [1, 5, 10, 20, 30];

export function runForecast(input: ForecastInputs): ForecastResult {
  const { data, convert, scenario } = input;
  const years = input.years ?? scenario.horizonYears;
  const months = Math.max(12, Math.round(years * 12));
  const start = startOfMonth(new Date());

  /* -- opening state ------------------------------------------------ */
  let cash = dec(input.startingCash);
  let investments = dec(input.startingInvestments);
  let contributions = dec(0);

  const properties = data.properties.map((p) => ({
    source: p,
    value: dec(convert(p.estimatedValue, p.currency)),
    balance: dec(convert(p.mortgageBalance, p.currency)),
    payment: dec(convert(p.monthlyPayment, p.currency)),
    expenses: dec(convert(p.monthlyPropertyExpenses, p.currency)),
    rent: dec(convert(p.monthlyRent, p.currency)),
    rentStartMonth: rentStartIndex(p.expectedRentStart, start),
    reserve: dec(convert(p.maintenanceReserve, p.currency)),
  }));

  const otherAssets = data.otherAssets.map((a) => ({
    value: dec(convert(a.currentValue, a.currency)),
    depreciation: a.annualDepreciation,
  }));

  const liabilities = data.liabilities.map((l) => ({
    balance: dec(convert(l.balance, l.currency)),
    rate: l.interestRate,
    payment: dec(convert(l.monthlyPayment, l.currency)),
  }));

  const plannedByMonth = new Map<number, Array<{ name: string; amount: number }>>();
  if (scenario.includePlannedExpenses) {
    for (const expense of data.plannedExpenses) {
      if (expense.status === 'cancelled' || expense.status === 'paid') continue;
      const index = monthIndexOf(expense.targetDate, start);
      if (index < 0 || index > months) continue;
      const list = plannedByMonth.get(index) ?? [];
      list.push({ name: expense.name, amount: convert(expense.amount - expense.savedAmount, expense.currency) });
      plannedByMonth.set(index, list);
    }
  }

  const securityFloor = data.profile.emergencyFundTarget;
  const cashRate = scenario.cashInterest > 0 ? scenario.cashInterest : (input.blendedCashRate ?? 0);

  /**
   * What the user's own strategy says they will invest once the
   * emergency fund is full. Reading it off the rules — rather than
   * assuming the scenario's pre-security figure holds forever — is what
   * stops the model parking six figures of idle cash for thirty years.
   */
  const resumeInvestment = Math.max(
    scenario.monthlyInvestment,
    ...data.strategyRules
      .filter((rule) => rule.enabled && rule.ruleType === 'investment')
      .map((rule) =>
        Number(rule.configuration['resume_amount'] ?? rule.configuration['minimum_monthly'] ?? rule.targetValue ?? 0),
      ),
    0,
  );

  /**
   * Cash above the floor plus a three-month buffer is swept into
   * investments. Without this the projection implies the user hoards
   * every surplus euro in a current account, which no strategy in the
   * app actually says.
   */
  const sweepThreshold = securityFloor + input.essentialExpenses * 3;

  /* -- the simulation ----------------------------------------------- */
  const points: ForecastPoint[] = [];
  const milestones: ForecastMilestone[] = [];
  let securityMonth: number | null = input.startingCash >= securityFloor ? 0 : null;
  let cashRunsOutMonth: number | null = null;
  let securityReached = securityMonth === 0;

  let salary = dec(input.monthlyIncome);
  let essential = dec(input.essentialExpenses);
  let flexible = dec(scenario.monthlyFlexibleSpending);

  for (let m = 1; m <= months; m += 1) {
    // Annual step-ups, applied on each anniversary.
    if (m % 12 === 1 && m > 1) {
      salary = salary.times(1 + scenario.salaryGrowth);
      essential = essential.times(1 + scenario.inflation);
      flexible = flexible.times(1 + scenario.inflation);
    }

    let monthIncome = salary;
    let monthExpenses = essential.plus(flexible);

    /* -- property ---------------------------------------------------- */
    for (const property of properties) {
      property.value = property.value.times(Math.pow(1 + scenario.propertyAppreciation, 1 / 12));

      if (property.balance.greaterThan(0)) {
        const step = amortiseMonth(property.balance, property.source.mortgageInterestRate, property.payment);
        property.balance = step.closing;
        // The mortgage payment is already inside `essentialExpenses`, so it
        // is not deducted again here — only the rental side is modelled.
      }

      const renting =
        scenario.includeRentalIncome &&
        (property.source.rentalStatus === 'rented' ||
          (property.rentStartMonth !== null && m >= property.rentStartMonth));

      if (renting) {
        const rent = property.rent.greaterThan(0) ? property.rent : estimatedRent(property.value);
        const surplus = rent.minus(property.expenses).minus(property.payment);
        // Per the property rule, rental surplus goes to the reserve, not
        // to lifestyle cash. A shortfall is funded from personal cash.
        if (surplus.greaterThanOrEqualTo(0)) {
          property.reserve = property.reserve.plus(surplus);
        } else {
          monthExpenses = monthExpenses.plus(surplus.abs());
        }
      }
    }

    /* -- other liabilities ------------------------------------------- */
    for (const liability of liabilities) {
      if (liability.balance.lessThanOrEqualTo(0)) continue;
      const step = amortiseMonth(liability.balance, liability.rate, liability.payment);
      liability.balance = step.closing;
      monthExpenses = monthExpenses.plus(liability.payment);
    }

    /* -- cash flow ---------------------------------------------------- */
    cash = cash.plus(monthIncome).minus(monthExpenses);

    // Investment contributions. Phase 1's rule is respected: nothing is
    // required until the emergency fund is full, after which the
    // strategy's own resume amount takes over.
    const fundFull = securityReached || cash.greaterThanOrEqualTo(securityFloor);

    if (fundFull && !securityReached) {
      securityReached = true;
      securityMonth = m;
      milestones.push({
        label: 'Emergency fund complete',
        monthIndex: m,
        date: toIsoDate(addMonths(start, m)),
        value: cash.toNumber(),
        kind: 'security',
      });
    }

    let contribution = fundFull ? dec(resumeInvestment) : dec(scenario.monthlyInvestment);

    // Sweep anything above the floor + buffer into the portfolio.
    if (fundFull && cash.greaterThan(sweepThreshold)) {
      contribution = contribution.plus(cash.minus(sweepThreshold));
    }

    // Never invest the emergency fund back below its floor: once the
    // floor is reached it is a hard limit, not a source of funds.
    const headroom = Decimal.max(cash.minus(fundFull ? securityFloor : 0), new Decimal(0));
    contribution = Decimal.min(contribution, headroom);

    if (contribution.greaterThan(0)) {
      cash = cash.minus(contribution);
      investments = investments.plus(contribution);
      contributions = contributions.plus(contribution);
    }

    // Growth and interest, compounded monthly.
    investments = investments.times(Math.pow(1 + scenario.investmentReturn, 1 / 12));
    if (cash.greaterThan(0)) cash = cash.times(Math.pow(1 + cashRate, 1 / 12));

    /* -- one-off planned expenses ------------------------------------ */
    let event: string | null = null;
    const due = plannedByMonth.get(m);
    if (due?.length) {
      const total = due.reduce((sum, e) => sum + e.amount, 0);
      cash = cash.minus(total);
      monthExpenses = monthExpenses.plus(total);
      event = due.map((e) => e.name).join(', ');
    }

    /* -- other assets depreciate ------------------------------------- */
    for (const asset of otherAssets) {
      asset.value = asset.value.times(Math.pow(1 - asset.depreciation, 1 / 12));
    }

    /* -- milestones ---------------------------------------------------- */
    if (cashRunsOutMonth === null && cash.lessThan(0)) {
      cashRunsOutMonth = m;
      milestones.push({
        label: 'Cash exhausted',
        monthIndex: m,
        date: toIsoDate(addMonths(start, m)),
        value: cash.toNumber(),
        kind: 'security',
      });
    }
    for (const property of properties) {
      if (
        property.balance.lessThanOrEqualTo(0) &&
        !milestones.some((ms) => ms.kind === 'debt' && ms.label.includes(property.source.name))
      ) {
        milestones.push({
          label: `${property.source.name} mortgage cleared`,
          monthIndex: m,
          date: toIsoDate(addMonths(start, m)),
          value: property.value.toNumber(),
          kind: 'debt',
        });
      }
    }

    /* -- record ------------------------------------------------------- */
    const propertyValue = money.sumBy(properties, (p) => p.value.toNumber()).toNumber();
    const mortgageBalance = money.sumBy(properties, (p) => p.balance.toNumber()).toNumber();
    const otherValue =
      money.sumBy(otherAssets, (a) => a.value.toNumber()).toNumber() +
      money.sumBy(properties, (p) => p.reserve.toNumber()).toNumber();
    const otherDebt = money.sumBy(liabilities, (l) => l.balance.toNumber()).toNumber();

    points.push({
      date: toIsoDate(addMonths(start, m)),
      monthIndex: m,
      cash: round2(cash.toNumber()),
      investments: round2(investments.toNumber()),
      propertyValue: round2(propertyValue),
      mortgageBalance: round2(mortgageBalance),
      propertyEquity: round2(propertyValue - mortgageBalance),
      otherAssets: round2(otherValue),
      otherDebt: round2(otherDebt),
      netWorth: round2(
        cash.toNumber() + investments.toNumber() + propertyValue + otherValue - mortgageBalance - otherDebt,
      ),
      contributions: round2(contributions.toNumber()),
      income: round2(monthIncome.toNumber()),
      expenses: round2(monthExpenses.toNumber()),
      aboveFloor: round2(Math.max(0, cash.toNumber() - securityFloor)),
      event,
    });
  }

  const horizons = HORIZON_YEARS.filter((y) => y * 12 <= months).map((y) => ({
    years: y,
    point: points[y * 12 - 1],
  }));

  return {
    scenario,
    points,
    horizons,
    milestones: milestones.sort((a, b) => a.monthIndex - b.monthIndex),
    assumptions: describeAssumptions(input, cashRate, resumeInvestment, sweepThreshold),
    securityMonth,
    cashRunsOutMonth,
  };
}

function describeAssumptions(
  input: ForecastInputs,
  cashRate: number,
  resumeInvestment: number,
  sweepThreshold: number,
): Assumption[] {
  const { scenario, formatCurrency: fmt, formatPercent: pct } = input;
  return [
    { label: 'Investment return', value: `${pct(scenario.investmentReturn * 100)} / year`, note: 'Nominal, before tax. Compounded monthly.' },
    { label: 'Salary growth', value: `${pct(scenario.salaryGrowth * 100)} / year`, note: 'Applied on each anniversary.' },
    { label: 'Inflation', value: `${pct(scenario.inflation * 100)} / year`, note: 'Applied to essential and flexible spending.' },
    { label: 'Cash interest', value: `${pct(cashRate * 100)} APY`, note: 'Variable in reality — this rate is not guaranteed.' },
    { label: 'Property appreciation', value: `${pct(scenario.propertyAppreciation * 100)} / year` },
    {
      label: 'Monthly investment',
      value: `${fmt(scenario.monthlyInvestment)} now → ${fmt(resumeInvestment)} / month`,
      note: 'Contributions resume at the rate your strategy rules specify, once the emergency fund is full.',
    },
    {
      label: 'Surplus sweep',
      value: `Above ${fmt(sweepThreshold)}`,
      note: 'Cash above the security floor plus a three-month buffer is invested rather than left idle.',
    },
    { label: 'Flexible spending', value: `${fmt(scenario.monthlyFlexibleSpending)} / month`, note: 'An average — actual months vary widely by design.' },
    { label: 'Rental income', value: scenario.includeRentalIncome ? 'Included from the expected start date' : 'Excluded' },
    { label: 'Planned expenses', value: scenario.includePlannedExpenses ? 'Deducted on their target dates' : 'Excluded' },
  ];
}

/** Rough achievable rent when none is recorded: 5% gross yield. */
function estimatedRent(value: import('../money/money').Decimal) {
  return value.times(0.05).dividedBy(12);
}

function monthIndexOf(isoDate: string, start: Date): number {
  const date = new Date(isoDate);
  return (date.getFullYear() - start.getFullYear()) * 12 + (date.getMonth() - start.getMonth());
}

function rentStartIndex(expectedRentStart: string | null, start: Date): number | null {
  if (!expectedRentStart) return null;
  const index = monthIndexOf(expectedRentStart, start);
  return index < 0 ? 1 : index;
}
