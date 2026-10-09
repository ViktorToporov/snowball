import { buildDemoDataset } from '../data/demo-dataset';
import { CurrencyService } from '../money/currency.service';
import { FinancialDataset } from '../models/domain.models';
import { runForecast } from './forecast.engine';
import {
  Convert,
  cashSummary,
  essentialMonthlyExpenses,
  essentialsByCategory,
  goalViews,
  identityConvert,
  incomeSummary,
  monthlyCashFlow,
  monthlyRentPaid,
  totalCashHistory,
  netWorthSummary,
  plannedExpenseViews,
  propertyMetrics,
  propertyPortfolio,
  securityScore,
} from './metrics';
import { portfolioAllocation, portfolioSummary, rebalanceSuggestions } from './portfolio.engine';
import { assessStrategy, evaluatePhases, StrategyInputs } from './strategy.engine';

/**
 * The demo dataset doubles as the fixture. Assertions are written
 * against the dataset's own contents rather than copied constants, so
 * the suite keeps testing behaviour rather than pinning sample numbers.
 */
function fixture(): FinancialDataset {
  return buildDemoDataset();
}

/** A converter wired to the dataset's own FX table, so USD rows convert. */
function converterFor(data: FinancialDataset): Convert {
  const currency = new CurrencyService();
  currency.loadRates(data.exchangeRates);
  currency.setBase(data.profile.baseCurrency, data.profile.locale);
  return (amount, from) => currency.toBase(amount, from);
}

function inputsFor(data: FinancialDataset, convert: Convert): StrategyInputs {
  const cash = cashSummary(data, convert);
  return {
    data,
    cash,
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

describe('demo dataset', () => {
  const data = fixture();

  it('is stable across builds', () => {
    expect(JSON.stringify(buildDemoDataset())).toBe(JSON.stringify(fixture()));
  });

  it('carries enough history for the year-on-year comparisons', () => {
    expect(data.netWorthSnapshots.length).toBeGreaterThan(13);
    expect(data.incomeHistory.length).toBeGreaterThan(13);
  });

  it("agrees with itself about today's position", () => {
    const convert = converterFor(data);
    const netWorth = netWorthSummary(data, convert);
    const portfolio = portfolioSummary(data, convert);

    const latest = [...data.netWorthSnapshots]
      .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))
      .at(-1)!;

    // The snapshot the charts end on must equal what the tables compute.
    expect(latest.netWorth).toBeCloseTo(netWorth.netWorth, 0);
    expect(latest.cashValue).toBeCloseTo(netWorth.cash, 0);
    expect(latest.investmentValue).toBeCloseTo(portfolio.totalValue, 0);
    expect(latest.liabilities).toBeCloseTo(netWorth.totalLiabilities, 0);

    // Every account's latest snapshot must equal its stated balance.
    for (const account of data.accounts) {
      const snapshot = data.accountBalanceSnapshots
        .filter((s) => s.accountId === account.id)
        .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))
        .at(-1);
      if (!snapshot) continue;
      expect(snapshot.balance).toBeCloseTo(convert(account.balance, account.currency), 0);
    }

    // The net-worth goal tracks net worth, so it should not have drifted.
    const fi = data.goals.find((g) => g.goalType === 'financial_independence')!;
    expect(Math.abs(fi.currentAmount - netWorth.netWorth)).toBeLessThan(1000);
  });

  it('never lets liquid cash go negative', () => {
    const liquid = new Set(data.accounts.filter((a) => a.countsAsLiquid).map((a) => a.id));
    const byDate = new Map<string, number>();
    for (const snapshot of data.accountBalanceSnapshots) {
      if (!liquid.has(snapshot.accountId)) continue;
      byDate.set(snapshot.snapshotDate, (byDate.get(snapshot.snapshotDate) ?? 0) + snapshot.balance);
    }
    for (const total of byDate.values()) expect(total).toBeGreaterThan(0);
  });
});

describe('housing', () => {
  const data = fixture();
  const convert = converterFor(data);

  it('has the household renting its home while owning a let property', () => {
    expect(data.properties.some((p) => p.rentalStatus === 'owner_occupied')).toBe(false);
    expect(data.properties.some((p) => p.rentalStatus === 'rented' && p.monthlyRent > 0)).toBe(true);
    expect(monthlyRentPaid(data, convert)).toBeGreaterThan(0);
  });

  it('keeps rent paid and rent received apart', () => {
    const paid = monthlyRentPaid(data, convert);
    const received = data.properties.reduce((sum, p) => sum + convert(p.monthlyRent, p.currency), 0);

    expect(paid).toBeGreaterThan(0);
    expect(received).toBeGreaterThan(0);
    expect(paid).not.toBe(received);

    // Rent paid is part of the declared baseline; rent received is income.
    expect(essentialMonthlyExpenses(data, convert)).toBeGreaterThan(paid);
    expect(data.recurringExpenses.some((e) => e.amount === paid)).toBe(true);
    expect(data.incomeSources.some((src) => src.incomeType === 'rental')).toBe(true);
  });

  it('never puts a rented home on the balance sheet', () => {
    const netWorth = netWorthSummary(data, convert);
    const owned = data.properties.reduce((sum, p) => sum + convert(p.estimatedValue, p.currency), 0);
    expect(netWorth.propertyValue).toBeCloseTo(owned, 2);
  });

  it('rolls the owned property up for the page header', () => {
    const metrics = data.properties.map((property) => propertyMetrics(property, convert));
    const portfolio = propertyPortfolio(metrics);

    expect(portfolio.count).toBe(data.properties.length);
    expect(portfolio.letCount).toBeGreaterThan(0);
    expect(portfolio.allInvestment).toBe(true);
    expect(portfolio.totalEquity).toBeCloseTo(portfolio.totalValue - portfolio.totalDebt, 2);
  });
});

describe('property waterfall', () => {
  const data = fixture();
  const convert = converterFor(data);
  const metrics = data.properties.map((property) => propertyMetrics(property, convert));

  it('drains down: each running balance follows from the last', () => {
    for (const m of metrics) {
      const steps = m.waterfall;
      expect(steps.length).toBeGreaterThan(2);

      if (m.usage !== 'let') continue;
      // Rent in, then each deduction, and the remainder must reconcile.
      expect(steps[0].running).toBeCloseTo(steps[0].amount, 2);
      for (let i = 1; i < steps.length - 1; i += 1) {
        expect(steps[i].running).toBeCloseTo(steps[i - 1].running + steps[i].amount, 2);
      }
      // The final row restates what survived, and it is the cash flow.
      expect(steps[steps.length - 1].running).toBeCloseTo(m.monthlyCashFlow, 2);
    }
  });

  it('explains every step', () => {
    for (const m of metrics) {
      for (const step of m.waterfall) expect(step.note).toBeTruthy();
    }
  });

  it('classifies how each property is used', () => {
    for (const m of metrics) {
      const expected =
        m.property.rentalStatus === 'owner_occupied' ? 'lived-in' : m.property.monthlyRent > 0 ? 'let' : 'empty';
      expect(m.usage).toBe(expected);
    }
  });
});

describe('cash metrics', () => {
  const data = fixture();
  const convert = converterFor(data);
  const cash = cashSummary(data, convert);

  it('totals only the liquid accounts, converting foreign currency', () => {
    const expected = data.accounts
      .filter((a) => a.countsAsLiquid && !a.isArchived && a.accountType !== 'credit_card')
      .reduce((sum, a) => sum + convert(a.balance, a.currency), 0);

    expect(cash.liquidTotal).toBeCloseTo(expected, 2);
    // The USD account must not have been counted at face value.
    expect(data.accounts.some((a) => a.currency !== 'EUR')).toBe(true);
    expect(cash.liquidTotal).not.toBeCloseTo(
      data.accounts
        .filter((a) => a.countsAsLiquid && a.accountType !== 'credit_card')
        .reduce((sum, a) => sum + a.balance, 0),
      2,
    );
  });

  it('excludes the ring-fenced property reserve from liquid cash', () => {
    const reserve = data.accounts.find((a) => a.name === 'Property Reserve')!;
    expect(reserve.countsAsLiquid).toBe(false);
    expect(cash.accounts.find((a) => a.id === reserve.id)!.shareOfLiquid).toBe(0);
  });

  it('counts only accounts flagged as emergency fund', () => {
    const expected = data.accounts
      .filter((a) => a.countsAsEmergencyFund)
      .reduce((sum, a) => sum + convert(a.balance, a.currency), 0);
    expect(cash.emergencyBalance).toBeCloseTo(expected, 2);
  });

  it('reports the fund as full and cash available above it', () => {
    expect(cash.emergencyShortfall).toBe(0);
    expect(cash.emergencyProgress).toBe(100);
    expect(cash.aboveTarget).toBeGreaterThan(0);
  });

  it('flags the physical cash account as over its ceiling', () => {
    const wallet = cash.accounts.find((a) => a.accountType === 'physical_cash')!;
    expect(wallet.overCeilingBy).toBeGreaterThan(0);
  });
});

describe('monthlyCashFlow', () => {
  const data = fixture();
  const convert = converterFor(data);
  const flow = monthlyCashFlow(data, convert, 40);

  it('derives spending from income, contributions and the change in cash', () => {
    const cash = new Map(totalCashHistory(data).map((p) => [p.date.slice(0, 7), p.value]));
    const months = [...cash.keys()].sort();

    for (const month of flow) {
      const key = month.month.slice(0, 7);
      const index = months.indexOf(key);
      expect(index).toBeGreaterThan(0);

      const change = cash.get(months[index])! - cash.get(months[index - 1])!;
      const expected = Math.max(0, month.income - month.contributed - change);
      expect(month.totalExpenses).toBeCloseTo(expected, 1);
    }
  });

  it('never counts an internal transfer as spending', () => {
    // Total cash spans every non-card account, so a transfer between two
    // of them cancels and cannot inflate the derived spending figure.
    const counted = data.accounts.filter((a) => a.accountType !== 'credit_card').length;
    expect(counted).toBeGreaterThan(1);

    const liquidOnly = data.accounts.filter((a) => a.countsAsLiquid).length;
    expect(counted).toBeGreaterThan(liquidOnly); // the ring-fenced reserve is in there too
  });

  it('splits spending so essential and flexible always add back up', () => {
    for (const month of flow) {
      expect(month.essential + month.flexible).toBeCloseTo(month.totalExpenses, 2);
      expect(month.essential).toBeGreaterThanOrEqual(0);
      expect(month.flexible).toBeGreaterThanOrEqual(0);
      expect(month.net).toBeCloseTo(month.income - month.totalExpenses, 2);
    }
  });

  it('never lets the essential slice exceed the declared baseline', () => {
    const baseline = essentialMonthlyExpenses(data, convert);
    for (const month of flow) expect(month.essential).toBeLessThanOrEqual(baseline + 0.01);
  });

  it('returns months in ascending order', () => {
    const sorted = [...flow].sort((a, b) => a.month.localeCompare(b.month));
    expect(flow.map((m) => m.month)).toEqual(sorted.map((m) => m.month));
  });

  it('produces a plausible picture on the demo data', () => {
    const complete = flow.slice(0, -1);
    expect(complete.length).toBeGreaterThan(12);
    // Income should exceed spending in most months for a household that
    // is building wealth, but not in every single one.
    const positive = complete.filter((m) => m.net > 0).length;
    expect(positive).toBeGreaterThan(complete.length / 2);
  });
});

describe('recurring expenses', () => {
  const data = fixture();
  const convert = converterFor(data);

  it('is the only place spending is itemised', () => {
    expect(data.recurringExpenses.length).toBeGreaterThan(3);
    expect((data as unknown as Record<string, unknown>)['transactions']).toBeUndefined();
  });

  it('normalises every frequency onto a month', () => {
    const expected = data.recurringExpenses
      .filter((e) => e.active)
      .reduce((sum, e) => {
        const factor = e.frequency === 'monthly' ? 1 : e.frequency === 'quarterly' ? 1 / 3 : 1 / 12;
        return sum + convert(e.amount, e.currency) * factor;
      }, 0);

    expect(essentialMonthlyExpenses(data, convert)).toBeCloseTo(expected, 2);
  });

  it('breaks the baseline down by category without inventing flexible detail', () => {
    const breakdown = essentialsByCategory(data.recurringExpenses, data.categories, convert);
    const total = breakdown.reduce((sum, b) => sum + b.amount, 0);
    expect(total).toBeCloseTo(essentialMonthlyExpenses(data, convert), 1);
    expect(breakdown.every((b) => b.share > 0)).toBe(true);
  });
});

describe('income', () => {
  const data = fixture();
  const convert = converterFor(data);
  const income = incomeSummary(data, convert);

  it('normalises every frequency onto a month', () => {
    const annual = data.incomeSources.find((s) => s.frequency === 'annual')!;
    const monthly = data.incomeSources.filter((s) => s.active && s.frequency === 'monthly');
    const expected =
      monthly.reduce((sum, s) => sum + convert(s.amount, s.currency), 0) +
      convert(annual.amount, annual.currency) / 12;

    expect(income.monthlyRecurring).toBeCloseTo(expected, 2);
  });

  it('computes year-on-year growth once there are 13 months', () => {
    expect(income.growth).not.toBeNull();
    expect(income.growth!).toBeGreaterThan(0);
  });
});

describe('net worth', () => {
  const data = fixture();
  const convert = converterFor(data);
  const netWorth = netWorthSummary(data, convert);

  it('is assets minus liabilities', () => {
    expect(netWorth.netWorth).toBeCloseTo(netWorth.totalAssets - netWorth.totalLiabilities, 2);
  });

  it('treats a credit-card account as a liability, not an asset', () => {
    const card = data.accounts.find((a) => a.accountType === 'credit_card')!;
    expect(card.balance).toBeGreaterThan(0);
    expect(netWorth.cash).toBeCloseTo(
      data.accounts
        .filter((a) => a.accountType !== 'credit_card')
        .reduce((sum, a) => sum + convert(a.balance, a.currency), 0),
      2,
    );
    expect(netWorth.totalLiabilities).toBeGreaterThanOrEqual(card.balance);
  });

  it('separates property equity from property value', () => {
    const value = data.properties.reduce((sum, p) => sum + p.estimatedValue, 0);
    const debt = data.properties.reduce((sum, p) => sum + p.mortgageBalance, 0);
    expect(netWorth.propertyValue).toBeCloseTo(value, 2);
    expect(netWorth.propertyEquity).toBeCloseTo(value - debt, 2);
  });
});

describe('portfolio', () => {
  const data = fixture();
  const convert = converterFor(data);
  const portfolio = portfolioSummary(data, convert);

  it('values holdings at quantity × current price, in base currency', () => {
    const expected = data.investments.reduce(
      (sum, i) => sum + convert(i.quantity * i.currentPrice, i.currency),
      0,
    );
    expect(portfolio.totalValue).toBeCloseTo(expected, 2);
  });

  it('separates unrealised from realised gain', () => {
    expect(portfolio.unrealisedGain).toBeCloseTo(portfolio.totalValue - portfolio.totalCost, 2);
    expect(portfolio.realisedGain).toBeGreaterThan(0);
  });

  it('reconciles contributions with the cost basis', () => {
    // The contributions line on the chart claims to be money paid in, so
    // it has to land near the cost of what is actually held.
    const drift = Math.abs(portfolio.totalContributions - portfolio.totalCost) / portfolio.totalCost;
    expect(drift).toBeLessThan(0.05);

    const latestSnapshot = [...data.portfolioSnapshots].sort((a, b) =>
      a.snapshotDate.localeCompare(b.snapshotDate),
    ).at(-1)!;
    expect(latestSnapshot.totalContributions).toBeCloseTo(portfolio.totalContributions, 0);
    expect(latestSnapshot.totalValue).toBeCloseTo(portfolio.totalValue, 0);
  });

  it('surfaces a loss-making position without swallowing it', () => {
    const losers = portfolio.positions.filter((p) => p.unrealisedGain < 0);
    expect(losers.length).toBeGreaterThan(0);
    expect(losers[0].returnPercent).toBeLessThan(0);
  });

  it('reports position weights that sum to 100%', () => {
    const total = portfolio.positions.reduce((sum, p) => sum + p.shareOfPortfolio, 0);
    expect(total).toBeCloseTo(100, 4);
  });

  it('splits a multi-bucket holding by weight and conserves the total', () => {
    const buckets = portfolioAllocation(data, convert);
    const pie = data.investments.find((i) => i.name === 'Diversified Pie')!;
    const pieWeights = data.investmentAllocations.filter((a) => a.investmentId === pie.id);
    expect(pieWeights.length).toBeGreaterThan(1);

    const total = buckets.reduce((sum, b) => sum + b.actualValue, 0);
    expect(total).toBeCloseTo(portfolio.totalValue, 1);
  });

  it('flags drift beyond the tolerance band and suggests a direction', () => {
    const buckets = portfolioAllocation(data, convert);
    for (const bucket of buckets) {
      const expected =
        Math.abs(bucket.drift) <= bucket.toleranceBand
          ? 'on-target'
          : bucket.drift > 0
            ? 'overweight'
            : 'underweight';
      expect(bucket.status).toBe(expected);
    }

    const suggestions = rebalanceSuggestions(buckets);
    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      expect(suggestion.action).toBe(suggestion.drift < 0 ? 'buy' : 'sell');
    }
  });
});

describe('security score', () => {
  it('is zero-safe on an empty position', () => {
    const score = securityScore({
      emergencyProgress: 0, emergencyBalance: 0, essentialExpenses: 0,
      monthlyIncome: 0, liquidCash: 0, netWorth: 0, nonMortgageDebt: 0, investments: 0,
    });
    expect(score.score).toBe(0);
    expect(score.band).toBe('fragile');
    expect(score.monthsOfRunway).toBeNull();
  });

  it('maxes out on a fully secured position', () => {
    const score = securityScore({
      emergencyProgress: 100, emergencyBalance: 12_000, essentialExpenses: 1000,
      monthlyIncome: 4000, liquidCash: 12_000, netWorth: 40_000, nonMortgageDebt: 0, investments: 20_000,
    });
    expect(score.score).toBe(100);
    expect(score.band).toBe('secure');
    expect(score.monthsOfRunway).toBe(12);
  });

  it('weights the five factors to 100', () => {
    const score = securityScore({
      emergencyProgress: 50, emergencyBalance: 3500, essentialExpenses: 1000,
      monthlyIncome: 2200, liquidCash: 3500, netWorth: 100_000, nonMortgageDebt: 0, investments: 3000,
    });
    expect(score.factors.reduce((sum, f) => sum + f.weight, 0)).toBe(100);
    expect(score.score).toBeGreaterThan(0);
    expect(score.score).toBeLessThan(100);
  });

  it('is penalised by non-mortgage debt', () => {
    const base = {
      emergencyProgress: 100, emergencyBalance: 12_000, essentialExpenses: 1000,
      monthlyIncome: 4000, liquidCash: 12_000, netWorth: 40_000, investments: 20_000,
    };
    expect(securityScore({ ...base, nonMortgageDebt: 20_000 }).score)
      .toBeLessThan(securityScore({ ...base, nonMortgageDebt: 0 }).score);
  });
});

describe('strategy engine', () => {
  const data = fixture();
  const convert = converterFor(data);
  const inputs = inputsFor(data, convert);
  const assessment = assessStrategy(inputs);

  it('holds back "ahead" while rules are still being flagged', () => {
    expect(assessment.status).toBe('on-track');
    expect(assessment.signals.every((s) => s.tone !== 'bad')).toBe(true);
    expect(assessment.signals.some((s) => s.tone === 'warn')).toBe(true);
  });

  it('surfaces every breached rule as a signal', () => {
    const breached = assessment.rules.filter(
      (r) => r.status === 'breached' && r.rule.ruleType !== 'cash_ceiling',
    );
    for (const rule of breached) {
      expect(assessment.signals.some((s) => s.title.includes(rule.rule.name))).toBe(true);
    }
  });

  it('does not judge the monthly contribution before it is due', () => {
    const rule = assessment.rules.find((r) => r.rule.ruleType === 'investment')!;
    expect(rule.status).not.toBe('breached');
  });

  it('nets planned spending off the cash available above the floor', () => {
    expect(assessment.securityFloor).toBe(data.profile.emergencyFundTarget);
    expect(assessment.committedSoon).toBeGreaterThan(0);
    expect(assessment.availableAboveFloor).toBeCloseTo(
      Math.max(0, inputs.cash.liquidTotal - assessment.securityFloor - assessment.committedSoon),
      2,
    );
  });

  it('warns that physical cash is over its maximum', () => {
    expect(assessment.signals.some((s) => s.title.includes('over its maximum'))).toBe(true);
  });

  it('evaluates the monthly investment rule against actual contributions', () => {
    const rule = assessment.rules.find((r) => r.rule.ruleType === 'investment')!;
    expect(rule.targetValue).toBe(900);
    expect(rule.progress).not.toBeNull();
  });

  it('runs the property rule now that rent is flowing', () => {
    const rule = assessment.rules.find((r) => r.rule.ruleType === 'property')!;
    expect(rule.status).toBe('met');
    expect(rule.detail).toContain('repair fund');
  });

  it('keeps one phase active, marks Phase 1 complete and unlocks Phase 3', () => {
    const phases = evaluatePhases(inputs);
    expect(phases.filter((p) => p.state === 'active').length).toBe(1);
    expect(phases.find((p) => p.phase.phaseOrder === 1)!.state).toBe('complete');
    expect(phases.find((p) => p.phase.phaseOrder === 2)!.state).toBe('active');
    // The apartment is let, so Property Optimisation can be switched on.
    expect(phases.find((p) => p.phase.phaseOrder === 3)!.canActivate).toBe(true);
    // A finished phase is never offered for activation.
    expect(phases.find((p) => p.phase.phaseOrder === 1)!.canActivate).toBe(false);
  });
});

describe('goals', () => {
  const data = fixture();
  const views = goalViews(data, converterFor(data));

  it('covers achieved, on-track and behind states', () => {
    expect(views.some((v) => v.progress >= 100)).toBe(true);
    expect(views.some((v) => v.onTrack && v.progress < 100)).toBe(true);
    expect(views.some((v) => !v.onTrack)).toBe(true);
  });

  it('derives the required contribution from the remaining months', () => {
    for (const view of views) {
      if (view.monthsRemaining === null) {
        expect(view.requiredMonthly).toBeNull();
        continue;
      }
      expect(view.requiredMonthly).toBeCloseTo(view.remaining / Math.max(1, view.monthsRemaining), 2);
    }
  });
});

describe('forecast engine', () => {
  const data = fixture();
  const convert = converterFor(data);
  const scenario = data.scenarios.find((s) => s.isDefault)!;
  const cash = cashSummary(data, convert);
  const portfolio = portfolioSummary(data, convert);

  const run = (which = scenario) =>
    runForecast({
      data,
      convert,
      scenario: which,
      startingCash: cash.liquidTotal,
      startingInvestments: portfolio.totalValue,
      essentialExpenses: essentialMonthlyExpenses(data, convert),
      monthlyIncome: incomeSummary(data, convert).monthlyRecurring,
      formatCurrency: (value) => `€${Math.round(value)}`,
      formatPercent: (value) => `${value}%`,
    });

  const result = run();

  it('produces one point per month over the horizon', () => {
    expect(result.points.length).toBe(scenario.horizonYears * 12);
  });

  it('offers the standard horizons', () => {
    expect(result.horizons.map((h) => h.years)).toEqual([1, 5, 10, 20, 30]);
  });

  it('invests from the first month when the fund is already full', () => {
    // Month 0 means "already secure at the starting position".
    expect(result.securityMonth).toBe(0);
    expect(result.points[0].contributions).toBeGreaterThan(0);
    expect(result.cashRunsOutMonth).toBeNull();
  });

  it('never invests the emergency fund below its floor', () => {
    const floor = data.profile.emergencyFundTarget;
    for (let i = 1; i < result.points.length; i += 1) {
      const previous = result.points[i - 1];
      const point = result.points[i];
      const invested = point.contributions - previous.contributions;
      // Investing may not be what pushed cash under the floor — spending can —
      // but a month that contributed must still end at or above it.
      if (invested > 0) expect(point.cash).toBeGreaterThanOrEqual(floor - 0.01);
    }
  });

  it('keeps net worth equal to its components', () => {
    for (const point of result.points.slice(0, 36)) {
      const rebuilt =
        point.cash + point.investments + point.propertyValue + point.otherAssets -
        point.mortgageBalance - point.otherDebt;
      expect(point.netWorth).toBeCloseTo(rebuilt, 0);
    }
  });

  it('clears every mortgage inside a 30-year horizon', () => {
    expect(result.points.at(-1)!.mortgageBalance).toBe(0);
    expect(result.milestones.filter((m) => m.kind === 'debt').length).toBe(data.properties.length);
  });

  it('states every assumption it used', () => {
    const labels = result.assumptions.map((a) => a.label);
    expect(labels).toContain('Investment return');
    expect(labels).toContain('Inflation');
    expect(labels).toContain('Surplus sweep');
    expect(labels).toContain('Rental income');
  });

  it('grows faster under the optimistic scenario', () => {
    const optimistic = data.scenarios.find((s) => s.kind === 'optimistic')!;
    const conservative = data.scenarios.find((s) => s.kind === 'conservative')!;
    expect(run(optimistic).points.at(-1)!.netWorth).toBeGreaterThan(run(conservative).points.at(-1)!.netWorth);
  });
});
