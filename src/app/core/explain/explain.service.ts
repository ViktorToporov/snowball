import { Injectable, inject } from '@angular/core';

import { CurrencyService } from '../money/currency.service';
import { formatDate } from '../money/format';
import { FinanceStore } from '../state/finance.store';
import { ExplainKey, Explanation, ExplainStep } from './explain.model';

/**
 * Builds a worked example for every calculated figure in the app.
 *
 * Each entry restates the method as an equation and then substitutes the
 * user's *actual* current numbers, so any figure Snowball shows can be
 * checked by hand. Nothing here recomputes anything: it reads the same
 * signals the UI reads, which is what stops the explanation and the
 * headline drifting apart.
 */
@Injectable({ providedIn: 'root' })
export class ExplainService {
  private readonly store = inject(FinanceStore);
  private readonly currency = inject(CurrencyService);

  private money(value: number | null | undefined): string {
    return this.currency.format(value ?? 0);
  }

  private pct(value: number | null | undefined, decimals = 1): string {
    return this.currency.percent(value ?? 0, decimals);
  }

  explain(key: ExplainKey): Explanation | null {
    const builder = this.builders[key];
    return builder ? builder() : null;
  }

  private readonly builders: Partial<Record<ExplainKey, () => Explanation | null>> = {
    /* ---------------------------------------------------------------- */
    /* Position                                                          */
    /* ---------------------------------------------------------------- */

    'net-worth': () => {
      const nw = this.store.netWorth();
      if (!nw) return null;

      const steps: ExplainStep[] = nw.components.map((component) => ({
        label: component.label,
        value: this.money(component.value),
        negative: component.kind === 'liability',
        hint:
          component.key === 'cash'
            ? 'Every cash account except credit cards'
            : component.key === 'investments'
              ? 'Quantity × current price for each holding'
              : component.key === 'property'
                ? 'Your own estimated values, not market valuations'
                : undefined,
      }));

      return {
        title: 'Net worth',
        summary: 'Everything you own, minus everything you owe.',
        formula: 'Net worth = assets − liabilities',
        steps,
        result: { label: 'Net worth', value: this.money(nw.netWorth) },
        note: 'Property and vehicle values are figures you entered. They are estimates, and the number is only as good as they are.',
        source: 'Cash Flow (balances), Investments (holdings), Property, and the assets and liabilities on this page.',
      };
    },

    'liquid-cash': () => {
      const cash = this.store.cash();
      if (!cash) return null;

      const liquid = cash.accounts.filter((a) => a.countsAsLiquid && a.accountType !== 'credit_card');
      return {
        title: 'Liquid cash',
        summary: 'Money you could spend today, across every account you have flagged as liquid.',
        formula: 'Liquid cash = Σ balances of accounts marked "counts as liquid"',
        steps: liquid.map((account) => ({
          label: account.name,
          value: this.money(account.balanceBase),
          hint:
            account.currency !== this.currency.baseCurrency()
              ? `${this.currency.formatIn(account.balance, account.currency)} converted at the stored rate`
              : undefined,
        })),
        result: { label: 'Liquid cash', value: this.money(cash.liquidTotal) },
        note: 'Accounts you have not marked liquid — a ring-fenced reserve, for instance — are deliberately left out, even though they still count toward net worth.',
        source: 'The "Liquid" column on the Cash Flow page.',
      };
    },

    'total-cash': () => {
      const cash = this.store.cash();
      if (!cash) return null;
      const counted = cash.accounts.filter((a) => a.accountType !== 'credit_card');
      const total = counted.reduce((sum, a) => sum + a.balanceBase, 0);

      return {
        title: 'Total cash',
        summary: 'Every cash account, liquid or not. This is the figure spending is derived from.',
        formula: 'Total cash = Σ balances of all non-card accounts',
        steps: counted.map((account) => ({ label: account.name, value: this.money(account.balanceBase) })),
        result: { label: 'Total cash', value: this.money(total) },
        note: 'Measured across every account on purpose: moving money between two of your own accounts nets to zero here, so an internal transfer can never look like spending.',
      };
    },

    'emergency-fund': () => {
      const cash = this.store.cash();
      if (!cash) return null;
      const contributing = cash.accounts.filter((a) => a.countsAsEmergencyFund);

      return {
        title: 'Emergency fund',
        summary: 'How much of your instant-access cash is earmarked as the safety net.',
        formula: 'Progress = emergency accounts ÷ target × 100',
        steps: [
          ...contributing.map((account) => ({ label: account.name, value: this.money(account.balanceBase) })),
          { label: 'Target', value: this.money(cash.emergencyTarget), hint: 'Set in Settings → Security targets' },
        ],
        result: {
          label: 'Progress',
          value: `${this.money(cash.emergencyBalance)} ÷ ${this.money(cash.emergencyTarget)} = ${this.pct(cash.emergencyProgress, 0)}`,
        },
        note:
          cash.emergencyShortfall > 0
            ? `${this.money(cash.emergencyShortfall)} still to go. Only accounts you tick as "counts toward the emergency fund" are included.`
            : 'Fully funded. Progress is capped at 100% — a surplus shows up as cash above the floor instead.',
        source: 'The "Emergency" column on the Cash Flow page.',
      };
    },

    'available-above-floor': () => {
      const strategy = this.store.strategy();
      const cash = this.store.cash();
      if (!strategy || !cash) return null;

      return {
        title: 'Available above the security floor',
        summary: 'Cash you can deploy without breaking your own safety rules. Not a monthly allowance.',
        formula: 'Available = liquid cash − security floor − unfunded planned spending due within 3 months',
        steps: [
          { label: 'Liquid cash', value: this.money(cash.liquidTotal) },
          { label: 'Security floor', value: this.money(strategy.securityFloor), negative: true, hint: 'Your emergency fund target' },
          {
            label: 'Committed within 3 months',
            value: this.money(strategy.committedSoon),
            negative: true,
            hint: 'The unfunded remainder of planned expenses falling due soon',
          },
        ],
        result: { label: 'Available', value: this.money(strategy.availableAboveFloor) },
        note: 'Floored at zero — if the sum goes negative it means planned spending already exceeds what you have above the floor.',
        source: 'Goals → Upcoming expenses, and Settings → Security targets.',
      };
    },

    /* ---------------------------------------------------------------- */
    /* Security                                                          */
    /* ---------------------------------------------------------------- */

    'security-score': () => {
      const score = this.store.security();
      if (!score) return null;

      return {
        title: 'Financial security score',
        summary: 'Five weighted factors rolled into one 0–100 reading of how well you could absorb a shock.',
        formula: 'Score = Σ (factor score × its weight)',
        steps: score.factors.map((factor) => ({
          label: `${factor.label} (max ${factor.weight})`,
          value: `${Math.round(factor.score * factor.weight)} pts`,
          hint: factor.detail,
        })),
        result: { label: 'Score', value: `${score.score} / 100 — ${score.band}` },
        note: 'The same weights are implemented in the database function `security_score()`, so the app and the server can never disagree about this number.',
      };
    },

    runway: () => {
      const score = this.store.security();
      const cash = this.store.cash();
      const essential = this.store.essentialExpenses();
      if (!score || !cash || essential <= 0) return null;

      return {
        title: 'Expense runway',
        summary: 'How many months you could cover your essentials from the emergency fund alone.',
        formula: 'Runway = emergency fund ÷ essential monthly expenses',
        steps: [
          { label: 'Emergency fund', value: this.money(cash.emergencyBalance) },
          { label: 'Essential expenses', value: `${this.money(essential)} / month`, hint: 'Your declared recurring baseline' },
        ],
        result: {
          label: 'Runway',
          value: `${this.money(cash.emergencyBalance)} ÷ ${this.money(essential)} = ${score.monthsOfRunway} months`,
        },
        note: 'Assumes income stops entirely and flexible spending goes to zero — a deliberately pessimistic reading.',
      };
    },

    /* ---------------------------------------------------------------- */
    /* Cash flow                                                         */
    /* ---------------------------------------------------------------- */

    'monthly-income': () => {
      const data = this.store.data();
      const income = this.store.income();
      if (!data || !income) return null;

      const factor: Record<string, string> = {
        monthly: '× 1',
        quarterly: '÷ 3',
        annual: '÷ 12',
        one_off: '× 0',
      };

      return {
        title: 'Monthly income',
        summary: 'Every active income source, normalised to what it contributes in an average month.',
        formula: 'Monthly income = Σ (amount × frequency factor)',
        steps: data.incomeSources
          .filter((source) => source.active)
          .map((source) => ({
            label: `${source.name} (${source.frequency})`,
            value: this.money(
              this.store.convert()(source.amount, source.currency) *
                (source.frequency === 'monthly' ? 1 : source.frequency === 'quarterly' ? 1 / 3 : source.frequency === 'annual' ? 1 / 12 : 0),
            ),
            hint: `${this.currency.formatIn(source.amount, source.currency)} ${factor[source.frequency]}`,
          })),
        result: { label: 'Per month', value: this.money(income.monthlyRecurring) },
        note: 'A one-off source contributes nothing to the recurring figure — it shows up in the month it actually lands.',
        source: 'Cash Flow → Income.',
      };
    },

    'essential-expenses': () => {
      const expenses = this.store.recurringExpenses().filter((e) => e.active);
      const total = this.store.essentialExpenses();
      if (!expenses.length) return null;

      return {
        title: 'Essential monthly expenses',
        summary: 'The cost of living you declared — the floor beneath every other calculation.',
        formula: 'Essentials = Σ (amount × frequency factor)',
        steps: expenses.map((expense) => ({
          label: expense.name,
          value: this.money(
            this.store.convert()(expense.amount, expense.currency) *
              (expense.frequency === 'monthly' ? 1 : expense.frequency === 'quarterly' ? 1 / 3 : 1 / 12),
          ),
          hint:
            expense.frequency === 'monthly'
              ? undefined
              : `${this.currency.formatIn(expense.amount, expense.currency)} ${expense.frequency} — spread over the year`,
        })),
        result: { label: 'Per month', value: this.money(total) },
        note: 'This is a declaration, not a measurement. It drives your runway and the line between essential and flexible spending, so it is worth keeping honest.',
        source: 'Cash Flow → Recurring expenses.',
      };
    },

    'total-spending': () => {
      const flow = this.store.cashFlow();
      const month = flow.slice(0, -1).at(-1);
      if (!month) return null;

      const cash = this.store.totalCashHistory();
      const closing = cash.at(-2)?.value ?? 0;
      const opening = cash.at(-3)?.value ?? 0;

      return {
        title: 'How spending is worked out',
        summary: 'Snowball has no transaction list. Spending is whatever your income did not turn into cash or investments.',
        formula: 'Spending = income − investment contributions − change in total cash',
        steps: [
          { label: 'Income that month', value: this.money(month.income) },
          { label: 'Into investments', value: this.money(month.contributed), negative: true },
          {
            label: 'Change in total cash',
            value: this.money(closing - opening),
            negative: true,
            hint: `${this.money(opening)} at the start → ${this.money(closing)} at the end`,
          },
        ],
        result: { label: 'Spent', value: this.money(month.totalExpenses) },
        note: 'Because cash is measured across every account, moving money between your own accounts cancels out and is never counted as spending. Keep balances current and this figure stays honest.',
        source: 'Account balances and investment activity — nothing else.',
      };
    },

    'flexible-spending': () => {
      const flow = this.store.cashFlow();
      const month = flow.slice(0, -1).at(-1);
      if (!month) return null;

      return {
        title: 'Flexible spending',
        summary: 'Everything you spent beyond the declared baseline. Never itemised — it is a residual.',
        formula: 'Flexible = total spending − essential baseline',
        steps: [
          { label: 'Total spent', value: this.money(month.totalExpenses), hint: 'Derived from your balances' },
          { label: 'Essential baseline', value: this.money(month.essential), negative: true },
        ],
        result: { label: 'Flexible', value: this.money(month.flexible) },
        note: 'Snowball never claims to know what this was made of, because it was not recorded. It varies month to month by design — that is the point of the flexible-spending model.',
      };
    },

    'savings-capacity': () => {
      const income = this.store.income()?.monthlyRecurring ?? 0;
      const essential = this.store.essentialExpenses();
      if (income <= 0) return null;

      return {
        title: 'Savings capacity',
        summary: 'What is left over each month once the essentials are paid, before any flexible spending.',
        formula: 'Capacity = monthly income − essential expenses',
        steps: [
          { label: 'Monthly income', value: this.money(income) },
          { label: 'Essential expenses', value: this.money(essential), negative: true },
        ],
        result: {
          label: 'Capacity',
          value: `${this.money(income - essential)} (${this.pct(((income - essential) / income) * 100, 0)} of income)`,
        },
        note: 'A ceiling, not a forecast. What you actually save depends on flexible spending, which is deliberately uncapped.',
      };
    },

    'savings-rate': () => {
      const completed = this.store.cashFlow().slice(0, -1).slice(-3);
      if (completed.length < 2) return null;
      const average = completed.reduce((sum, m) => sum + m.savingsRate, 0) / completed.length;

      return {
        title: 'Savings rate',
        summary: 'The share of income you did not spend, averaged over the last three complete months.',
        formula: 'Savings rate = (income − spending) ÷ income',
        steps: completed.map((month) => ({
          label: formatDate(month.month, this.currency.locale()).slice(3),
          value: this.pct(month.savingsRate, 0),
          hint: `${this.money(month.income)} in, ${this.money(month.totalExpenses)} spent`,
        })),
        result: { label: 'Three-month average', value: this.pct(average, 1) },
        note: 'The month in progress is excluded — it is only part-paid, and including it would make every reading look like a collapse.',
      };
    },

    'interest-per-year': () => {
      const cash = this.store.cash();
      if (!cash) return null;
      const earning = cash.accounts.filter((a) => a.interestRate > 0);

      return {
        title: 'Interest per year',
        summary: 'What your cash earns over twelve months at the rates you recorded.',
        formula: 'Interest = Σ (balance × APY)',
        steps: earning.map((account) => ({
          label: `${account.name} @ ${this.pct(account.interestRate * 100, 2)}`,
          value: this.money(account.annualInterest),
        })),
        result: {
          label: 'Per year',
          value: `${this.money(cash.annualInterest)} — a blended ${this.pct(cash.blendedRate, 2)}`,
        },
        note: 'Simple interest at today’s balances and rates. Both move, so treat it as an indication rather than a promise.',
      };
    },

    /* ---------------------------------------------------------------- */
    /* Investments                                                       */
    /* ---------------------------------------------------------------- */

    'portfolio-value': () => {
      const portfolio = this.store.portfolio();
      if (!portfolio) return null;

      return {
        title: 'Portfolio value',
        summary: 'Every holding valued at the last price you recorded.',
        formula: 'Value = Σ (quantity × current price), converted to your base currency',
        steps: portfolio.positions.map((position) => ({
          label: position.investment.name,
          value: this.money(position.currentValueBase),
          hint: `${position.investment.quantity} × ${this.currency.formatIn(position.investment.currentPrice, position.investment.currency)}`,
        })),
        result: { label: 'Portfolio value', value: this.money(portfolio.totalValue) },
        note: 'The product is never stored, so a stale total can never drift away from the quantities and prices. Update prices on the Investments page and every figure follows.',
      };
    },

    'unrealised-gain': () => {
      const portfolio = this.store.portfolio();
      if (!portfolio) return null;

      return {
        title: 'Unrealised gain',
        summary: 'What your holdings are worth versus what you paid for them, before selling anything.',
        formula: 'Unrealised gain = current value − cost basis',
        steps: [
          { label: 'Current value', value: this.money(portfolio.totalValue) },
          { label: 'Cost basis', value: this.money(portfolio.totalCost), negative: true, hint: 'Σ (quantity × average cost)' },
        ],
        result: {
          label: 'Unrealised',
          value: `${this.money(portfolio.unrealisedGain)} (${this.pct(portfolio.totalReturnPercent, 2)} on cost)`,
        },
        note: `Separate from realised gain of ${this.money(portfolio.realisedGain)}, which is locked in from holdings already sold.`,
      };
    },

    'portfolio-return': () => this.builders['unrealised-gain']!(),

    'time-weighted-return': () => {
      const portfolio = this.store.portfolio();
      if (!portfolio || portfolio.annualisedReturn === null) return null;

      return {
        title: 'Time-weighted return',
        summary: 'How your investments performed, with the effect of paying more in stripped out.',
        formula: 'Chain-link each period’s return, then annualise',
        steps: [
          { label: 'Portfolio value', value: this.money(portfolio.totalValue) },
          { label: 'Contributions to date', value: this.money(portfolio.totalContributions) },
          { label: 'Market growth', value: this.money(portfolio.marketGrowth), hint: 'Value minus what you paid in' },
        ],
        result: { label: 'Annualised', value: this.pct(portfolio.annualisedReturn, 2) },
        note: 'Each period excludes the money added during it, so a big contribution never shows up as good performance. This is the honest way to judge the investments rather than the saver.',
      };
    },

    'contributions-vs-growth': () => {
      const portfolio = this.store.portfolio();
      if (!portfolio) return null;

      return {
        title: 'Contributions vs growth',
        summary: 'How much of the portfolio you built by paying in, and how much the market added.',
        formula: 'Market growth = portfolio value − money paid in',
        steps: [
          { label: 'Portfolio value', value: this.money(portfolio.totalValue) },
          { label: 'Contributions (buys − sells)', value: this.money(portfolio.totalContributions), negative: true },
        ],
        result: { label: 'Market growth', value: this.money(portfolio.marketGrowth) },
        note: `Dividends received (${this.money(portfolio.dividendsReceived)}) and fees paid (${this.money(portfolio.feesPaid)}) are tracked separately.`,
        source: 'Investments → Record activity.',
      };
    },

    'allocation-drift': () => {
      const buckets = this.store.allocation();
      const portfolio = this.store.portfolio();
      if (!buckets.length || !portfolio) return null;
      const worst = [...buckets].sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))[0];

      return {
        title: 'Target vs actual allocation',
        summary: 'Where your money actually sits, against the model you set — and how far it has drifted.',
        formula: 'Actual % = bucket value ÷ portfolio value · Drift = actual % − target %',
        steps: [
          { label: `${worst.bucket} — value`, value: this.money(worst.actualValue), hint: 'A holding can be split across several buckets by weight' },
          { label: 'Portfolio value', value: this.money(portfolio.totalValue) },
          { label: 'Actual share', value: this.pct(worst.actualPercentage, 1) },
          { label: 'Target share', value: this.pct(worst.targetPercentage, 1), negative: true },
        ],
        result: {
          label: `${worst.bucket} drift`,
          value: `${this.pct(worst.drift, 1)} — ${worst.status.replace('-', ' ')} (tolerance ±${this.pct(worst.toleranceBand, 0)})`,
        },
        note: 'A bucket is only flagged once it drifts beyond its own tolerance band, so ordinary market movement does not generate noise.',
      };
    },

    rebalance: () => {
      const suggestions = this.store.rebalance();
      const portfolio = this.store.portfolio();
      if (!suggestions.length || !portfolio) return null;
      const first = suggestions[0];

      return {
        title: 'Rebalance suggestions',
        summary: 'What it would take to bring each bucket back inside its tolerance band.',
        formula: 'Adjustment = (target % × portfolio value) − current bucket value',
        steps: [
          { label: 'Portfolio value', value: this.money(portfolio.totalValue) },
          { label: `${first.bucket} target`, value: this.pct(first.targetPercentage, 1) },
          { label: 'Target value', value: this.money((first.targetPercentage / 100) * portfolio.totalValue) },
          { label: 'Actual value', value: this.money((first.actualPercentage / 100) * portfolio.totalValue), negative: true },
        ],
        result: {
          label: first.action === 'buy' ? `Add to ${first.bucket}` : `Trim ${first.bucket}`,
          value: this.money(first.amount),
        },
        note: 'Suggestions only — Snowball never places a trade. Directing new contributions at underweight buckets avoids selling, and the tax and fees that come with it.',
      };
    },

    /* ---------------------------------------------------------------- */
    /* Property                                                          */
    /* ---------------------------------------------------------------- */

    'property-equity': () => {
      const first = this.store.properties()[0];
      if (!first) return null;
      const convert = this.store.convert();

      return {
        title: 'Property equity',
        summary: 'The share of the property that is actually yours rather than the lender’s.',
        formula: 'Equity = estimated value − mortgage balance',
        steps: [
          {
            label: 'Estimated value',
            value: this.money(convert(first.property.estimatedValue, first.property.currency)),
            hint: 'Your own estimate — update it when you get a better one',
          },
          {
            label: 'Mortgage balance',
            value: this.money(convert(first.property.mortgageBalance, first.property.currency)),
            negative: true,
          },
        ],
        result: { label: 'Equity', value: this.money(first.equity) },
        note: 'Equity grows two ways: the value rising, and each mortgage payment chipping away at the balance.',
      };
    },

    'loan-to-value': () => {
      const first = this.store.properties()[0];
      if (!first) return null;
      const convert = this.store.convert();

      return {
        title: 'Loan-to-value',
        summary: 'How much of the property is still financed by debt.',
        formula: 'LTV = mortgage balance ÷ estimated value × 100',
        steps: [
          { label: 'Mortgage balance', value: this.money(convert(first.property.mortgageBalance, first.property.currency)) },
          { label: 'Estimated value', value: this.money(convert(first.property.estimatedValue, first.property.currency)) },
        ],
        result: { label: 'LTV', value: this.pct(first.loanToValue, 1) },
        note: 'Lenders price on this. Falling below common thresholds — often 80% or 60% — can matter at remortgage time.',
      };
    },

    'property-cash-flow': () => {
      const let_ = this.store.properties().find((m) => m.usage === 'let') ?? this.store.properties()[0];
      if (!let_) return null;
      const convert = this.store.convert();

      return {
        title: 'Property cash flow',
        summary: 'What the rent is left as, once the property has paid for itself.',
        formula: 'Cash flow = rent − running costs − mortgage payment',
        steps: [
          { label: 'Rent received', value: this.money(convert(let_.property.monthlyRent, let_.property.currency)) },
          { label: 'Running costs', value: this.money(convert(let_.property.monthlyPropertyExpenses, let_.property.currency)), negative: true },
          { label: 'Mortgage payment', value: this.money(convert(let_.property.monthlyPayment, let_.property.currency)), negative: true },
        ],
        result: { label: 'Per month', value: this.money(let_.monthlyCashFlow) },
        note: 'The surplus is ring-fenced in the Property Reserve rather than treated as income, so a good month on the rental never quietly becomes lifestyle money.',
      };
    },

    'rental-yield': () => {
      const let_ = this.store.properties().find((m) => m.usage === 'let');
      if (!let_) return null;
      const convert = this.store.convert();
      const rent = convert(let_.property.monthlyRent, let_.property.currency);
      const costs = convert(let_.property.monthlyPropertyExpenses, let_.property.currency);
      const value = convert(let_.property.estimatedValue, let_.property.currency);

      return {
        title: 'Rental yield',
        summary: 'What the property returns each year as a percentage of what it is worth.',
        formula: 'Gross = rent × 12 ÷ value · Net = (rent − costs) × 12 ÷ value',
        steps: [
          { label: 'Annual rent', value: this.money(rent * 12), hint: `${this.money(rent)} × 12` },
          { label: 'Annual running costs', value: this.money(costs * 12), negative: true },
          { label: 'Property value', value: this.money(value) },
        ],
        result: {
          label: 'Yield',
          value: `${this.pct(let_.grossYield, 2)} gross · ${this.pct(let_.netYield, 2)} net`,
        },
        note: 'Neither figure deducts the mortgage — yield measures the asset, not how you financed it. Cash flow is the one that includes the loan.',
      };
    },

    'mortgage-split': () => {
      const first = this.store.properties()[0];
      if (!first) return null;
      const convert = this.store.convert();
      const balance = convert(first.property.mortgageBalance, first.property.currency);

      return {
        title: 'Interest vs principal',
        summary: 'How much of this month’s payment services the debt, and how much actually reduces it.',
        formula: 'Interest = balance × annual rate ÷ 12 · Principal = payment − interest',
        steps: [
          { label: 'Balance', value: this.money(balance) },
          { label: 'Annual rate', value: this.pct(first.property.mortgageInterestRate * 100, 2) },
          { label: 'Monthly interest', value: this.money(first.monthlyInterest), hint: `${this.money(balance)} × ${this.pct(first.property.mortgageInterestRate * 100, 2)} ÷ 12` },
          { label: 'Payment', value: this.money(convert(first.property.monthlyPayment, first.property.currency)) },
        ],
        result: { label: 'Off the balance', value: this.money(first.monthlyPrincipal) },
        note: 'The principal share grows every month as the balance falls — which is why equity builds slowly at first and then accelerates.',
      };
    },

    'property-reserve': () => {
      const let_ = this.store.properties().find((m) => m.usage === 'let');
      if (!let_) return null;
      const convert = this.store.convert();
      const balance = convert(let_.property.maintenanceReserve, let_.property.currency);
      const target = convert(let_.property.maintenanceReserveTarget, let_.property.currency);

      return {
        title: 'Property reserve',
        summary: 'Rental surplus set aside for repairs and empty months, kept away from everyday money.',
        formula: 'Months to target = (target − balance) ÷ monthly surplus',
        steps: [
          { label: 'Reserve balance', value: this.money(balance) },
          { label: 'Target', value: this.money(target) },
          { label: 'Monthly surplus', value: this.money(let_.monthlyCashFlow) },
        ],
        result: {
          label: 'Funded',
          value: target > 0 ? this.pct((balance / target) * 100, 0) : '—',
        },
        note: 'Ring-fenced on purpose: a boiler or a void month should come out of here, not out of your emergency fund.',
      };
    },

    /* ---------------------------------------------------------------- */
    /* Plan                                                              */
    /* ---------------------------------------------------------------- */

    'goal-required': () => {
      const goal = this.store.goals().find((g) => g.goal.status === 'active' && g.requiredMonthly !== null);
      if (!goal) return null;

      return {
        title: 'Required monthly contribution',
        summary: 'What you would need to put aside each month to hit a goal by its date.',
        formula: 'Required = (target − current) ÷ months remaining',
        steps: [
          { label: `${goal.goal.name} target`, value: this.money(goal.goal.targetAmount) },
          { label: 'Saved so far', value: this.money(goal.currentAmount), negative: true },
          { label: 'Months remaining', value: String(goal.monthsRemaining ?? 0), hint: 'Rounded to the nearest whole month' },
        ],
        result: { label: 'Required', value: `${this.money(goal.requiredMonthly)} / month` },
        note: `A goal counts as on track when what you are contributing meets that figure. ${goal.goal.name} is currently ${goal.onTrack ? 'on track' : 'behind'}.`,
      };
    },

    'planned-required': () => {
      const expense = this.store.plannedExpenses().find((e) => e.remaining > 0);
      if (!expense) return null;

      return {
        title: 'Funding a planned expense',
        summary: 'What you need to set aside monthly to have the money ready on the day.',
        formula: 'Required = (cost − already saved) ÷ months until due',
        steps: [
          { label: `${expense.expense.name} cost`, value: this.money(expense.expense.amount) },
          { label: 'Already saved', value: this.money(expense.expense.savedAmount), negative: true },
          { label: 'Months until due', value: String(Math.max(1, expense.monthsUntil)) },
        ],
        result: { label: 'Required', value: `${this.money(expense.requiredMonthly)} / month` },
        note: 'Unfunded planned spending due within three months is also subtracted from your available cash, so it can never look like money you are free to use.',
      };
    },

    'strategy-status': () => {
      const strategy = this.store.strategy();
      if (!strategy) return null;

      return {
        title: 'How the status is decided',
        summary: 'A verdict on whether your plan is working, from your own rules rather than a generic score.',
        formula: 'Emergency-fund gap ÷ recent savings rate, then checked against your rules and planned spending',
        steps: [
          { label: 'Security floor', value: this.money(strategy.securityFloor) },
          { label: 'Recent savings rate', value: `${this.money(strategy.recentMonthlySaving)} / month`, hint: 'Average of the last three complete months' },
          {
            label: 'Months to target',
            value: strategy.monthsToSecurity === null ? 'Not at this rate' : strategy.monthsToSecurity === 0 ? 'Complete' : `${strategy.monthsToSecurity}`,
          },
          { label: 'Rules flagged', value: String(strategy.signals.filter((s) => s.tone === 'warn' || s.tone === 'bad').length) },
        ],
        result: { label: 'Status', value: strategy.headline },
        note: '"Ahead" is reserved for a clean sheet — the fund full, cash still growing and nothing flagged. Any warning holds it at "on track" so the headline never contradicts the detail below it.',
      };
    },

    forecast: () => {
      const scenario = this.store.defaultScenario();
      const cash = this.store.cash();
      const portfolio = this.store.portfolio();
      if (!scenario || !cash || !portfolio) return null;

      return {
        title: 'How the projection is built',
        summary: 'A month-by-month simulation from today’s position and the assumptions you can see.',
        formula: 'Each month: apply income, spending, contributions, growth, interest and amortisation — then repeat',
        steps: [
          { label: 'Starting cash', value: this.money(cash.liquidTotal) },
          { label: 'Starting investments', value: this.money(portfolio.totalValue) },
          { label: 'Investment return', value: `${this.pct(scenario.investmentReturn * 100, 1)} / year`, hint: 'Nominal, compounded monthly' },
          { label: 'Inflation', value: `${this.pct(scenario.inflation * 100, 1)} / year`, hint: 'Applied to spending each anniversary' },
          { label: 'Monthly investment', value: `${this.money(scenario.monthlyInvestment)} / month` },
        ],
        result: { label: 'Horizon', value: `${scenario.horizonYears} years` },
        note: 'An estimate, not a promise. Returns are not guaranteed, a single bad year moves a long-horizon number a long way, and figures are nominal — not adjusted for inflation.',
      };
    },

    'currency-conversion': () => {
      const data = this.store.data();
      if (!data) return null;
      const foreign = data.accounts.find((a) => a.currency !== data.profile.baseCurrency);
      if (!foreign) return null;

      const rate = data.exchangeRates.find(
        (r) => r.baseCurrency === foreign.currency && r.quoteCurrency === data.profile.baseCurrency,
      );

      return {
        title: 'Currency conversion',
        summary: 'How balances held in another currency are brought into your base currency.',
        formula: 'Converted = amount × stored rate',
        steps: [
          { label: `${foreign.name} balance`, value: this.currency.formatIn(foreign.balance, foreign.currency) },
          {
            label: `${foreign.currency} → ${data.profile.baseCurrency} rate`,
            value: String(rate?.rate ?? 1),
            hint: rate ? `Recorded ${formatDate(rate.asOf, this.currency.locale())}` : 'No rate stored — converted 1:1',
          },
        ],
        result: {
          label: 'In base currency',
          value: this.money(this.store.convert()(foreign.balance, foreign.currency)),
        },
        note: 'No rate is hard-coded anywhere. Rates live in the `exchange_rates` table, and any pair Snowball had to fall back to 1:1 on is flagged in Settings.',
      };
    },
  };
}
