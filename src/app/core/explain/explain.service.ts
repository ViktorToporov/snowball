import { Injectable, inject } from '@angular/core';

import { CurrencyService } from '../money/currency.service';
import { formatDate } from '../money/format';
import { FinanceStore } from '../state/finance.store';
import { ExplainBasic, ExplainKey, Explanation, ExplainStep } from './explain.model';

/** How each income/bill frequency reads in a sentence. */
const FREQUENCY_WORDS: Record<string, string> = {
  monthly: 'monthly',
  quarterly: 'every 3 months',
  annual: 'yearly',
  one_off: 'one-off',
};

/** How each safety-score band reads in a sentence. */
const BAND_WORDS: Record<string, string> = {
  fragile: 'fragile',
  building: 'still building',
  solid: 'solid',
  secure: 'very secure',
};

/**
 * What every figure means, in plain words and without any numbers.
 *
 * Shown when there is not enough data to work the example through yet,
 * so a new user still gets an answer from the ⓘ instead of nothing.
 */
const BASICS: Record<ExplainKey, ExplainBasic> = {
  'net-worth': {
    title: 'Net worth',
    summary: 'Everything you own minus everything you owe. Add your accounts, investments and debts to see yours.',
  },
  'liquid-cash': {
    title: 'Cash you can use now',
    summary: 'Money you could spend today, across the accounts you have marked “Spendable now”.',
    nextStep: { label: 'Add your accounts', route: '/cash-flow?tab=accounts' },
  },
  'total-cash': {
    title: 'All your cash',
    summary: 'The money in every one of your accounts added together, including money kept separate.',
  },
  'emergency-fund': {
    title: 'Safety cushion',
    summary: 'Money set aside for emergencies, like losing your job or a big repair. Three to six months of bills is a common rule of thumb.',
    nextStep: { label: 'Set your safety cushion', route: '/settings' },
  },
  'available-above-floor': {
    title: 'Free to spend or invest',
    summary: 'Cash left after your safety cushion and the bills due in the next 3 months. It is not a monthly allowance.',
  },
  'security-score': {
    title: 'Safety score',
    summary: 'A score out of 100 for how well you could handle a money shock, like losing your income for a while.',
  },
  runway: {
    title: 'Months you could live on savings',
    summary: 'How long your emergency money would pay your fixed bills if your income stopped. Most guides suggest 3 to 6 months.',
    nextStep: { label: 'Add your fixed bills', route: '/cash-flow?tab=bills' },
  },
  'monthly-income': {
    title: 'Monthly income',
    summary: 'All the money that comes in regularly, worked out as an average month.',
    nextStep: { label: 'Add your income', route: '/cash-flow?tab=income' },
  },
  'essential-expenses': {
    title: 'Fixed monthly bills',
    summary: 'Bills you pay every month no matter what: rent or mortgage, utilities, insurance, subscriptions.',
    nextStep: { label: 'Add your fixed bills', route: '/cash-flow?tab=bills' },
  },
  'total-spending': {
    title: 'How spending is worked out',
    summary: 'Snowball works out spending from your balances: whatever came in and did not end up saved or invested was spent.',
  },
  'flexible-spending': {
    title: 'Everyday spending',
    summary: 'Everything that isn’t a fixed bill — food, going out, shopping. Snowball works it out once it has a month or two of balances.',
  },
  'savings-capacity': {
    title: 'Left over after bills',
    summary: 'What is left each month once your fixed bills are paid, before everyday spending.',
    nextStep: { label: 'Add your income', route: '/cash-flow?tab=income' },
  },
  'savings-rate': {
    title: 'Share of income saved',
    summary: 'How much of what you earn you keep, on average over the last three months. It needs a couple of monthly check-ins first.',
    nextStep: { label: 'Do a check-in', route: '/check-in' },
  },
  'interest-per-year': {
    title: 'Interest per year',
    summary: 'What your cash earns over a year at the interest rates you entered for your accounts.',
  },
  'portfolio-value': {
    title: 'Investments value',
    summary: 'What all your investment accounts are worth, using the latest totals and prices you entered.',
  },
  'portfolio-cost': {
    title: 'Money you put in',
    summary: 'The money that went into your investments, so profit can be told apart from your own savings.',
  },
  'unrealised-gain': {
    title: 'Profit on paper (not sold yet)',
    summary: 'How much more (or less) your investments are worth than what you paid. It only becomes real when you sell.',
  },
  'portfolio-return': {
    title: 'Return on your investments',
    summary: 'How much your investments have grown compared with the money you put in.',
  },
  'time-weighted-return': {
    title: 'Yearly performance',
    summary: 'How well your investments did per year. It ignores money you added, so it measures the investments, not your saving.',
  },
  'contributions-vs-growth': {
    title: 'Money you put in vs growth',
    summary: 'How much of your investments came from your own money, and how much the market added on top.',
  },
  'allocation-drift': {
    title: 'Your mix vs your plan',
    summary: 'Where your investment money actually sits, compared with the mix you planned.',
  },
  rebalance: {
    title: 'How to get back to your plan',
    summary: 'What you could buy or sell to bring your investment mix back in line with your plan.',
  },
  'property-equity': {
    title: 'Your share of the home',
    summary: 'What the property is worth minus what is still owed on the mortgage.',
  },
  'loan-to-value': {
    title: 'Still owed',
    summary: 'How much is still owed on the mortgage, as a percentage of the home’s value. Lower usually means better mortgage rates.',
  },
  'property-cash-flow': {
    title: 'What the property leaves you',
    summary: 'Rent coming in, minus running costs and the mortgage payment, each month.',
  },
  'rental-yield': {
    title: 'Rent as % of value',
    summary: 'A year’s rent as a percentage of what the property is worth, before and after running costs.',
  },
  'mortgage-split': {
    title: 'Paid off the loan vs interest to the bank',
    summary: 'How much of each mortgage payment pays down the loan, and how much goes to the bank as interest.',
  },
  'property-reserve': {
    title: 'Repair fund',
    summary: 'Money from the rent kept separate for repairs and months without a tenant.',
  },
  'goal-required': {
    title: 'Monthly amount needed for a goal',
    summary: 'What you would need to put aside each month to reach a goal by its date.',
    nextStep: { label: 'Add a goal', route: '/goals' },
  },
  'planned-required': {
    title: 'Saving up for a planned expense',
    summary: 'What to set aside each month so the money is ready when a planned expense is due.',
  },
  'strategy-status': {
    title: 'How your plan status is decided',
    summary: 'Snowball compares how fast you are saving with your safety cushion, your checks and your upcoming expenses.',
  },
  forecast: {
    title: 'How the forecast is built',
    summary: 'A month-by-month projection from where you are today, using the assumptions you can see and change.',
  },
  'currency-conversion': {
    title: 'Currency conversion',
    summary: 'Money held in another currency is converted into your main currency using the latest rate Snowball has.',
  },
};

/**
 * Builds a worked example for every calculated figure in the app.
 *
 * Each entry restates the method in words and then substitutes the
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

  /** The plain-language fallback for a figure, with no numbers in it. */
  basic(key: ExplainKey): ExplainBasic | null {
    return BASICS[key] ?? null;
  }

  private readonly builders: Partial<Record<ExplainKey, () => Explanation | null>> = {
    /* ---------------------------------------------------------------- */
    /* Position                                                          */
    /* ---------------------------------------------------------------- */

    'net-worth': () => {
      const nw = this.store.netWorth();
      if (!nw) return null;
      const change = this.store.deltas().netWorth;

      const steps: ExplainStep[] = nw.components.map((component) => ({
        label: component.label,
        value: this.money(component.value),
        negative: component.kind === 'liability',
        hint:
          component.key === 'cash'
            ? 'Every account except credit cards'
            : component.key === 'investments'
              ? 'Number of shares × latest price, for each investment'
              : component.key === 'property'
                ? 'Your own estimate of what it is worth'
                : undefined,
      }));

      return {
        ...BASICS['net-worth'],
        meaning:
          change === null || change === 0
            ? `Your net worth is ${this.money(nw.netWorth)}.`
            : `Your net worth is ${this.money(nw.netWorth)} — ${change > 0 ? 'up' : 'down'} ${this.money(Math.abs(change))} since last month.`,
        summary: 'Everything you own minus everything you owe.',
        formula: 'Net worth = what you own − what you owe',
        steps,
        result: { label: 'Net worth', value: this.money(nw.netWorth) },
        note: 'Property and vehicle values are your own estimates, so this number is only as good as they are.',
        source: 'Money & bills (balances), Investments, Property, and the Net worth page.',
      };
    },

    'liquid-cash': () => {
      const cash = this.store.cash();
      if (!cash) return null;

      const liquid = cash.accounts.filter((a) => a.countsAsLiquid && a.accountType !== 'credit_card');
      return {
        ...BASICS['liquid-cash'],
        summary: 'Money you could spend today, across every account you have marked “Spendable now”.',
        formula: 'Add up the balances of accounts marked “Spendable now”',
        steps: liquid.map((account) => ({
          label: account.name,
          value: this.money(account.balanceBase),
          hint:
            account.currency !== this.currency.baseCurrency()
              ? `${this.currency.formatIn(account.balance, account.currency)} converted at the latest rate`
              : undefined,
        })),
        result: { label: 'Cash you can use now', value: this.money(cash.liquidTotal) },
        note: 'Accounts you keep separate — a repair fund, for instance — are left out here, but still count toward your net worth.',
        source: 'The “Spendable now?” column on the Money & bills page.',
      };
    },

    'total-cash': () => {
      const cash = this.store.cash();
      if (!cash) return null;
      const counted = cash.accounts.filter((a) => a.accountType !== 'credit_card');
      const total = counted.reduce((sum, a) => sum + a.balanceBase, 0);

      return {
        ...BASICS['total-cash'],
        summary: 'Every account added together, spendable now or not. Spending is worked out from this figure.',
        formula: 'Add up the balances of all accounts except credit cards',
        steps: counted.map((account) => ({ label: account.name, value: this.money(account.balanceBase) })),
        result: { label: 'All your cash', value: this.money(total) },
        note: 'Moving money between two of your own accounts doesn’t change this total, so it never looks like spending.',
      };
    },

    'emergency-fund': () => {
      const cash = this.store.cash();
      if (!cash) return null;
      const contributing = cash.accounts.filter((a) => a.countsAsEmergencyFund);
      const essential = this.store.essentialExpenses();
      if (cash.emergencyTarget <= 0) return null;

      const covers = essential > 0 ? cash.emergencyTarget / essential : null;
      const coverText = covers !== null ? ` Your cushion covers about ${covers.toFixed(1)} months of fixed bills.` : '';

      return {
        ...BASICS['emergency-fund'],
        meaning:
          cash.emergencyShortfall > 0
            ? `You're ${this.pct(cash.emergencyProgress, 0)} of the way there — ${this.money(cash.emergencyShortfall)} still to go.${coverText}`
            : `Your safety cushion is full.${coverText}`,
        summary: 'How much of your emergency money is in place, against the safety cushion you set.',
        nextStep: cash.emergencyShortfall > 0 ? { label: 'See your plan', route: '/strategy' } : undefined,
        formula: 'Progress = money in emergency accounts ÷ safety cushion × 100',
        steps: [
          ...contributing.map((account) => ({ label: account.name, value: this.money(account.balanceBase) })),
          { label: 'Safety cushion', value: this.money(cash.emergencyTarget), hint: 'Set in Settings → Safety cushion' },
        ],
        result: {
          label: 'Progress',
          value: `${this.money(cash.emergencyBalance)} ÷ ${this.money(cash.emergencyTarget)} = ${this.pct(cash.emergencyProgress, 0)}`,
        },
        note: 'Only accounts you mark as emergency money count here. Progress stops at 100% — anything extra shows up as money free to spend or invest.',
        source: 'Your accounts on the Money & bills page.',
      };
    },

    'available-above-floor': () => {
      const strategy = this.store.strategy();
      const cash = this.store.cash();
      if (!strategy || !cash) return null;

      return {
        ...BASICS['available-above-floor'],
        meaning:
          strategy.availableAboveFloor > 0
            ? `${this.money(strategy.availableAboveFloor)} is free to spend or invest, after keeping your ${this.money(strategy.securityFloor)} safety cushion and money for bills due in the next 3 months.`
            : 'Nothing is free right now: your cash is at or below your safety cushion plus the bills due in the next 3 months.',
        summary: 'Cash left after your safety cushion and bills due in the next 3 months. Not a monthly allowance.',
        formula: 'Free = cash you can use now − safety cushion − planned expenses due in the next 3 months',
        steps: [
          { label: 'Cash you can use now', value: this.money(cash.liquidTotal) },
          { label: 'Safety cushion', value: this.money(strategy.securityFloor), negative: true },
          {
            label: 'Planned expenses due in the next 3 months',
            value: this.money(strategy.committedSoon),
            negative: true,
            hint: 'Only the part you haven’t already saved for',
          },
        ],
        result: { label: 'Free to spend or invest', value: this.money(strategy.availableAboveFloor) },
        note: 'It never shows less than zero. If the sum would be negative, your planned expenses are already bigger than what you have above your cushion.',
        source: 'Goals → Upcoming expenses, and Settings → Safety cushion.',
      };
    },

    /* ---------------------------------------------------------------- */
    /* Security                                                          */
    /* ---------------------------------------------------------------- */

    'security-score': () => {
      const score = this.store.security();
      if (!score) return null;
      const weakest = [...score.factors].sort((a, b) => a.score - b.score)[0];

      return {
        ...BASICS['security-score'],
        meaning:
          `${score.score} / 100 — ${BAND_WORDS[score.band] ?? score.band}. 60 and up is solid; 80 and up is very secure.` +
          (weakest && weakest.score < 1 ? ` Most room to improve: ${weakest.label.toLowerCase()}.` : ''),
        summary: 'Five things rolled into one score out of 100 for how well you could handle a money shock.',
        formula: 'Score = add up (each part’s score × its points)',
        steps: score.factors.map((factor) => ({
          label: `${factor.label} (up to ${factor.weight})`,
          value: `${Math.round(factor.score * factor.weight)} pts`,
          hint: factor.detail,
        })),
        result: { label: 'Safety score', value: `${score.score} / 100 — ${BAND_WORDS[score.band] ?? score.band}` },
      };
    },

    runway: () => {
      const score = this.store.security();
      const cash = this.store.cash();
      const essential = this.store.essentialExpenses();
      if (!score || !cash || essential <= 0) return null;
      const months = score.monthsOfRunway ?? 0;

      const verdict =
        months < 3
          ? 'That’s under the 3 to 6 months most guides suggest, so building this up is a good first priority.'
          : months <= 6
            ? 'Most guides suggest 3 to 6 months, so you’re in good shape.'
            : 'That’s more than the 3 to 6 months most guides suggest — you’re well covered.';

      return {
        ...BASICS.runway,
        meaning: `${months} month${months === 1 ? '' : 's'}. ${verdict}`,
        summary: 'How many months your emergency money alone would pay your fixed bills.',
        nextStep:
          months < 3
            ? { label: 'Review your fixed bills', route: '/cash-flow?tab=bills' }
            : { label: 'Update your balances', route: '/check-in' },
        formula: 'Months = emergency money ÷ fixed monthly bills',
        steps: [
          { label: 'Emergency money', value: this.money(cash.emergencyBalance) },
          { label: 'Fixed monthly bills', value: `${this.money(essential)} / month`, hint: 'The bills you entered on Money & bills' },
        ],
        result: {
          label: 'Months you could live on savings',
          value: `${this.money(cash.emergencyBalance)} ÷ ${this.money(essential)} = ${months} months`,
        },
        note: 'This assumes your income stops completely and you only pay your fixed bills — a worst-case view, so you know where you stand.',
      };
    },

    /* ---------------------------------------------------------------- */
    /* Cash flow                                                         */
    /* ---------------------------------------------------------------- */

    'monthly-income': () => {
      const data = this.store.data();
      const income = this.store.income();
      if (!data || !income) return null;
      const active = data.incomeSources.filter((source) => source.active);
      if (!active.length) return null;

      const factor: Record<string, string> = {
        monthly: '× 1',
        quarterly: '÷ 3',
        annual: '÷ 12',
        one_off: '× 0',
      };

      return {
        ...BASICS['monthly-income'],
        meaning: `About ${this.money(income.monthlyRecurring)} comes in during an average month.`,
        nextStep: { label: 'Edit your income', route: '/cash-flow?tab=income' },
        formula: 'Monthly income = add up each income, worked out per month',
        steps: active.map((source) => ({
          label: `${source.name} (${FREQUENCY_WORDS[source.frequency] ?? source.frequency})`,
          value: this.money(
            this.store.convert()(source.amount, source.currency) *
              (source.frequency === 'monthly' ? 1 : source.frequency === 'quarterly' ? 1 / 3 : source.frequency === 'annual' ? 1 / 12 : 0),
          ),
          hint: `${this.currency.formatIn(source.amount, source.currency)} ${factor[source.frequency]}`,
        })),
        result: { label: 'Per month', value: this.money(income.monthlyRecurring) },
        note: 'One-off income isn’t counted here — it shows up in the month it actually arrives.',
        source: 'Money & bills → Income.',
      };
    },

    'essential-expenses': () => {
      const expenses = this.store.recurringExpenses().filter((e) => e.active);
      const total = this.store.essentialExpenses();
      if (!expenses.length) return null;
      const income = this.store.income()?.monthlyRecurring ?? 0;
      const share = income > 0 ? (total / income) * 100 : null;

      return {
        ...BASICS['essential-expenses'],
        meaning:
          share === null
            ? `Your fixed bills come to ${this.money(total)} a month.`
            : `Your fixed bills take ${this.pct(share, 0)} of your income. A common guideline is to keep must-pay costs to about half. ${share <= 50 ? 'You’re within that.' : 'Yours are above that, which leaves less room for everything else.'}`,
        summary: 'The bills you pay every month no matter what. Many other figures are built on this one.',
        nextStep: { label: 'Review your bills', route: '/cash-flow?tab=bills' },
        formula: 'Fixed bills = add up each bill, worked out per month',
        steps: expenses.map((expense) => ({
          label: expense.name,
          value: this.money(
            this.store.convert()(expense.amount, expense.currency) *
              (expense.frequency === 'monthly' ? 1 : expense.frequency === 'quarterly' ? 1 / 3 : 1 / 12),
          ),
          hint:
            expense.frequency === 'monthly'
              ? undefined
              : `${this.currency.formatIn(expense.amount, expense.currency)} ${FREQUENCY_WORDS[expense.frequency] ?? expense.frequency} — spread over the year`,
        })),
        result: { label: 'Per month', value: this.money(total) },
        note: 'These are the bills you entered, so keep them up to date — they decide how many months you could live on savings.',
        source: 'Money & bills → Fixed bills.',
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
        ...BASICS['total-spending'],
        summary: 'You don’t list purchases in Snowball. Spending is whatever came in and didn’t end up as cash or investments.',
        formula: 'Spending = income − money invested − change in all your cash',
        steps: [
          { label: 'Income that month', value: this.money(month.income) },
          { label: 'Money invested', value: this.money(month.contributed), negative: true },
          {
            label: 'Change in all your cash',
            value: this.money(closing - opening),
            negative: true,
            hint: `${this.money(opening)} at the start → ${this.money(closing)} at the end`,
          },
        ],
        result: { label: 'Spent', value: this.money(month.totalExpenses) },
        note: 'Moving money between your own accounts cancels out, so it never counts as spending. Keep your balances up to date and this stays accurate.',
        source: 'Your account balances and investment activity.',
      };
    },

    'flexible-spending': () => {
      const flow = this.store.cashFlow();
      const month = flow.slice(0, -1).at(-1);
      if (!month) return null;

      return {
        ...BASICS['flexible-spending'],
        summary: 'Everything you spent that isn’t a fixed bill. Snowball doesn’t list what it was — just the total.',
        formula: 'Everyday spending = everything you spent − fixed bills',
        steps: [
          { label: 'Everything you spent', value: this.money(month.totalExpenses), hint: 'Worked out from your balances' },
          { label: 'Fixed bills', value: this.money(month.essential), negative: true },
        ],
        result: { label: 'Everyday spending', value: this.money(month.flexible) },
        note: 'It’s normal for this to go up and down from month to month. There’s no budget to stick to — the less you spend here, the faster your plan moves.',
      };
    },

    'savings-capacity': () => {
      const income = this.store.income()?.monthlyRecurring ?? 0;
      const essential = this.store.essentialExpenses();
      if (income <= 0) return null;
      const left = income - essential;

      return {
        ...BASICS['savings-capacity'],
        meaning: `${this.money(left)} is left each month after fixed bills — ${this.pct((left / income) * 100, 0)} of your income.`,
        formula: 'Left over = monthly income − fixed bills',
        steps: [
          { label: 'Monthly income', value: this.money(income) },
          { label: 'Fixed bills', value: this.money(essential), negative: true },
        ],
        result: {
          label: 'Left over after bills',
          value: `${this.money(left)} (${this.pct((left / income) * 100, 0)} of income)`,
        },
        note: 'This is the most you could save. What you actually save depends on your everyday spending.',
      };
    },

    'savings-rate': () => {
      const completed = this.store.cashFlow().slice(0, -1).slice(-3);
      if (completed.length < 2) return null;
      const average = completed.reduce((sum, m) => sum + m.savingsRate, 0) / completed.length;

      const verdict =
        average < 0
          ? 'You spent more than you earned on average.'
          : average < 10
            ? 'Many guides suggest saving 10 to 20% of what you earn, so there may be room to save a bit more.'
            : average <= 20
              ? 'Many guides suggest saving 10 to 20% of what you earn — you’re right in that range.'
              : 'Many guides suggest saving 10 to 20% of what you earn — you’re doing better than that.';

      return {
        ...BASICS['savings-rate'],
        meaning: `You kept ${this.pct(average, 0)} of your income. ${verdict}`,
        summary: 'How much of what you earn you didn’t spend, on average over the last three full months.',
        nextStep: undefined,
        formula: 'Share saved = (income − spending) ÷ income',
        steps: completed.map((month) => ({
          label: formatDate(month.month, this.currency.locale()).slice(3),
          value: this.pct(month.savingsRate, 0),
          hint: `${this.money(month.income)} in, ${this.money(month.totalExpenses)} spent`,
        })),
        result: { label: 'Three-month average', value: this.pct(average, 1) },
        note: 'This month isn’t included yet, because it isn’t over.',
      };
    },

    'interest-per-year': () => {
      const cash = this.store.cash();
      if (!cash) return null;
      const earning = cash.accounts.filter((a) => a.interestRate > 0);
      if (!earning.length) return null;

      return {
        ...BASICS['interest-per-year'],
        formula: 'Interest = add up (balance × interest rate per year)',
        steps: earning.map((account) => ({
          label: `${account.name} at ${this.pct(account.interestRate * 100, 2)}`,
          value: this.money(account.annualInterest),
        })),
        result: {
          label: 'Per year',
          value: `${this.money(cash.annualInterest)} — an average interest rate of ${this.pct(cash.blendedRate, 2)}`,
        },
        note: 'Based on today’s balances and rates. Both change, so treat it as a rough guide, not a promise.',
      };
    },

    /* ---------------------------------------------------------------- */
    /* Investments                                                       */
    /* ---------------------------------------------------------------- */

    'portfolio-value': () => {
      const portfolio = this.store.portfolio();
      if (!portfolio || (!portfolio.accounts.length && !portfolio.unassignedPositions.length)) return null;

      return {
        ...BASICS['portfolio-value'],
        formula: 'Value = add up every investment account, converted to your currency',
        steps: [
          ...portfolio.accounts.map((view) => ({
            label: view.account.name,
            value: this.money(view.valueBase),
            hint:
              view.mode === 'total'
                ? 'The total you entered for this account'
                : 'Added up from the investments listed in it (shares × latest price)',
          })),
          ...portfolio.unassignedPositions.map((position) => ({
            label: position.investment.name,
            value: this.money(position.currentValueBase),
            hint: `Not in an account · ${position.investment.quantity} × ${this.currency.formatIn(position.investment.currentPrice, position.investment.currency)}`,
          })),
        ],
        result: { label: 'Investments value', value: this.money(portfolio.totalValue) },
        note: portfolio.staleAccounts
          ? `${portfolio.staleAccounts} account total${portfolio.staleAccounts > 1 ? 's are' : ' is'} over a month old — the monthly check-in updates them.`
          : 'Investments you list inside an account valued as a total are a breakdown of it, so they are not added twice.',
        nextStep: portfolio.staleAccounts ? { label: 'Do your monthly check-in', route: '/check-in' } : undefined,
      };
    },

    'portfolio-cost': () => {
      const portfolio = this.store.portfolio();
      if (!portfolio || (!portfolio.accounts.length && !portfolio.unassignedPositions.length)) return null;

      return {
        ...BASICS['portfolio-cost'],
        formula: 'Money you put in = add up each account: money you added minus money you took out (or, for accounts added up from investments, what you paid for them)',
        steps: [
          ...portfolio.accounts.map((view) => ({
            label: view.account.name,
            value: this.money(view.moneyInBase),
            hint:
              view.mode === 'total'
                ? 'What was in before tracking, plus money added, minus money taken out'
                : 'Shares × price you paid per share',
          })),
          ...portfolio.unassignedPositions.map((position) => ({
            label: position.investment.name,
            value: this.money(position.costBasisBase),
            hint: `Not in an account · ${position.investment.quantity} × ${this.currency.formatIn(position.investment.averageCost, position.investment.currency)}`,
          })),
        ],
        result: { label: 'Money you put in', value: this.money(portfolio.totalCost) },
        note: 'Record money you move into or out of an account (on the Investments page or in the monthly check-in) so profit stays accurate.',
        source: 'Investments → Money in / out.',
      };
    },

    'unrealised-gain': () => {
      const portfolio = this.store.portfolio();
      if (!portfolio || (!portfolio.accounts.length && !portfolio.positions.length)) return null;
      const gain = portfolio.unrealisedGain;

      return {
        ...BASICS['unrealised-gain'],
        meaning:
          gain >= 0
            ? `Your investments are worth ${this.money(gain)} more than you paid (${this.pct(portfolio.totalReturnPercent, 1)}). It’s a profit on paper until you sell.`
            : `Your investments are worth ${this.money(-gain)} less than you paid (${this.pct(portfolio.totalReturnPercent, 1)}). Ups and downs are normal — it only becomes a real loss if you sell.`,
        formula: 'Profit on paper = what it’s worth now − money you put in',
        steps: [
          { label: 'Worth now', value: this.money(portfolio.totalValue) },
          { label: 'Money you put in', value: this.money(portfolio.totalCost), negative: true, hint: 'Money added to your accounts, or what you paid for investments' },
        ],
        result: {
          label: 'Profit on paper',
          value: `${this.money(gain)} (${this.pct(portfolio.totalReturnPercent, 2)} on what you paid)`,
        },
        note: `Profit from sales you’ve already made (${this.money(portfolio.realisedGain)}) is counted separately.`,
      };
    },

    'portfolio-return': () => {
      const base = this.builders['unrealised-gain']!();
      return base ? { ...base, title: BASICS['portfolio-return'].title } : null;
    },

    'time-weighted-return': () => {
      const portfolio = this.store.portfolio();
      if (!portfolio || portfolio.annualisedReturn === null) return null;

      return {
        ...BASICS['time-weighted-return'],
        formula: 'Work out the growth in each period without the money you added, then turn it into a per-year figure',
        steps: [
          { label: 'Investments value', value: this.money(portfolio.totalValue) },
          { label: 'Money you put in', value: this.money(portfolio.totalContributions) },
          { label: 'Market growth', value: this.money(portfolio.marketGrowth), hint: 'Value minus what you paid in' },
        ],
        result: { label: 'Per year', value: this.pct(portfolio.annualisedReturn, 2) },
        note: 'Money you add is left out of each period, so a big deposit never looks like good performance. It shows how the investments did, not how much you saved.',
      };
    },

    'contributions-vs-growth': () => {
      const portfolio = this.store.portfolio();
      if (!portfolio || !portfolio.positions.length) return null;

      return {
        ...BASICS['contributions-vs-growth'],
        formula: 'Market growth = investments value − money you put in',
        steps: [
          { label: 'Investments value', value: this.money(portfolio.totalValue) },
          { label: 'Money you put in (buys − sells)', value: this.money(portfolio.totalContributions), negative: true },
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
      const verdict =
        worst.status === 'overweight' ? 'Too much' : worst.status === 'underweight' ? 'Too little' : 'Close to plan';

      return {
        ...BASICS['allocation-drift'],
        formula: 'Your share = this group’s value ÷ all investments · Difference = your share − planned share',
        steps: [
          { label: `${worst.bucket} — value`, value: this.money(worst.actualValue), hint: 'One investment can be split across several groups' },
          { label: 'All investments', value: this.money(portfolio.totalValue) },
          { label: 'Your share', value: this.pct(worst.actualPercentage, 1) },
          { label: 'Planned share', value: this.pct(worst.targetPercentage, 1), negative: true },
        ],
        result: {
          label: `${worst.bucket}`,
          value: `${this.pct(Math.abs(worst.drift), 1)} ${worst.drift >= 0 ? 'more' : 'less'} than planned — ${verdict.toLowerCase()} (allowed ±${this.pct(worst.toleranceBand, 0)})`,
        },
        note: 'A group is only flagged once it moves further from your plan than you allow, so normal market ups and downs don’t cause alarms.',
      };
    },

    rebalance: () => {
      const suggestions = this.store.rebalance();
      const portfolio = this.store.portfolio();
      if (!suggestions.length || !portfolio) return null;
      const first = suggestions[0];

      return {
        ...BASICS.rebalance,
        formula: 'Amount = (planned share × all investments) − what this group is worth now',
        steps: [
          { label: 'All investments', value: this.money(portfolio.totalValue) },
          { label: `${first.bucket} planned share`, value: this.pct(first.targetPercentage, 1) },
          { label: 'Planned value', value: this.money((first.targetPercentage / 100) * portfolio.totalValue) },
          { label: 'Worth now', value: this.money((first.actualPercentage / 100) * portfolio.totalValue), negative: true },
        ],
        result: {
          label: first.action === 'buy' ? `Add to ${first.bucket}` : `Sell some ${first.bucket}`,
          value: this.money(first.amount),
        },
        note: 'Suggestions only — Snowball never buys or sells anything. Putting new money into the groups you have too little of avoids selling, and the tax and fees that come with it.',
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
        ...BASICS['property-equity'],
        formula: 'Your share = estimated value − still owed on the mortgage',
        steps: [
          {
            label: 'Estimated value',
            value: this.money(convert(first.property.estimatedValue, first.property.currency)),
            hint: 'Your own estimate — update it when you get a better one',
          },
          {
            label: 'Still owed',
            value: this.money(convert(first.property.mortgageBalance, first.property.currency)),
            negative: true,
          },
        ],
        result: { label: 'Your share', value: this.money(first.equity) },
        note: 'Your share grows two ways: the home going up in value, and each mortgage payment paying off some of the loan.',
      };
    },

    'loan-to-value': () => {
      const first = this.store.properties()[0];
      if (!first) return null;
      const convert = this.store.convert();
      const ltv = first.loanToValue;

      const verdict =
        ltv <= 0
          ? 'The mortgage is paid off.'
          : ltv <= 60
            ? 'Under 60% usually gets you the best mortgage rates.'
            : ltv <= 80
              ? 'Under 80% usually gets you better mortgage rates; getting under 60% gets the best ones.'
              : 'Getting under 80% usually unlocks better mortgage rates when you next switch deals.';

      return {
        ...BASICS['loan-to-value'],
        meaning: `You still owe ${this.pct(ltv, 0)} of the home’s value. ${verdict}`,
        formula: 'Still owed % = mortgage left ÷ estimated value × 100',
        steps: [
          { label: 'Mortgage left', value: this.money(convert(first.property.mortgageBalance, first.property.currency)) },
          { label: 'Estimated value', value: this.money(convert(first.property.estimatedValue, first.property.currency)) },
        ],
        result: { label: 'Still owed', value: this.pct(ltv, 1) },
        note: 'Lenders look at this when you remortgage. Common thresholds are 80% and 60%.',
      };
    },

    'property-cash-flow': () => {
      const let_ = this.store.properties().find((m) => m.usage === 'let') ?? this.store.properties()[0];
      if (!let_) return null;
      const convert = this.store.convert();

      return {
        ...BASICS['property-cash-flow'],
        formula: 'Left each month = rent − running costs − mortgage payment',
        steps: [
          { label: 'Rent received', value: this.money(convert(let_.property.monthlyRent, let_.property.currency)) },
          { label: 'Running costs', value: this.money(convert(let_.property.monthlyPropertyExpenses, let_.property.currency)), negative: true },
          { label: 'Mortgage payment', value: this.money(convert(let_.property.monthlyPayment, let_.property.currency)), negative: true },
        ],
        result: { label: 'Per month', value: this.money(let_.monthlyCashFlow) },
        note: 'Anything left over goes into the repair fund rather than your everyday money, so a good month on the rental doesn’t quietly get spent.',
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
        ...BASICS['rental-yield'],
        formula: 'Before costs = rent × 12 ÷ value · After costs = (rent − costs) × 12 ÷ value',
        steps: [
          { label: 'Rent per year', value: this.money(rent * 12), hint: `${this.money(rent)} × 12` },
          { label: 'Running costs per year', value: this.money(costs * 12), negative: true },
          { label: 'Property value', value: this.money(value) },
        ],
        result: {
          label: 'Rent as % of value',
          value: `${this.pct(let_.grossYield, 2)} before costs · ${this.pct(let_.netYield, 2)} after`,
        },
        note: 'Neither figure takes off the mortgage — this measures the property itself, not how you paid for it. “What the property leaves you” is the figure that includes the loan.',
      };
    },

    'mortgage-split': () => {
      const first = this.store.properties()[0];
      if (!first) return null;
      const convert = this.store.convert();
      const balance = convert(first.property.mortgageBalance, first.property.currency);

      return {
        ...BASICS['mortgage-split'],
        formula: 'Interest = mortgage left × interest rate ÷ 12 · Paid off the loan = payment − interest',
        steps: [
          { label: 'Mortgage left', value: this.money(balance) },
          { label: 'Interest rate per year', value: this.pct(first.property.mortgageInterestRate * 100, 2) },
          { label: 'Interest to the bank this month', value: this.money(first.monthlyInterest), hint: `${this.money(balance)} × ${this.pct(first.property.mortgageInterestRate * 100, 2)} ÷ 12` },
          { label: 'Monthly payment', value: this.money(convert(first.property.monthlyPayment, first.property.currency)) },
        ],
        result: { label: 'Paid off the loan', value: this.money(first.monthlyPrincipal) },
        note: 'As the loan shrinks, more of each payment goes to paying it off — which is why your share of the home grows slowly at first, then faster.',
      };
    },

    'property-reserve': () => {
      const let_ = this.store.properties().find((m) => m.usage === 'let');
      if (!let_) return null;
      const convert = this.store.convert();
      const balance = convert(let_.property.maintenanceReserve, let_.property.currency);
      const target = convert(let_.property.maintenanceReserveTarget, let_.property.currency);

      return {
        ...BASICS['property-reserve'],
        formula: 'Months to fill = (goal − balance) ÷ what the rent leaves each month',
        steps: [
          { label: 'Repair fund balance', value: this.money(balance) },
          { label: 'Goal', value: this.money(target) },
          { label: 'Rent left over each month', value: this.money(let_.monthlyCashFlow) },
        ],
        result: {
          label: 'Filled',
          value: target > 0 ? this.pct((balance / target) * 100, 0) : '—',
        },
        note: 'Kept separate on purpose: a new boiler or a month without a tenant should come out of here, not out of your safety cushion.',
      };
    },

    /* ---------------------------------------------------------------- */
    /* Plan                                                              */
    /* ---------------------------------------------------------------- */

    'goal-required': () => {
      const goal = this.store.goals().find((g) => g.goal.status === 'active' && g.requiredMonthly !== null);
      if (!goal) return null;

      return {
        ...BASICS['goal-required'],
        nextStep: undefined,
        formula: 'Needed each month = (goal − saved so far) ÷ months left',
        steps: [
          { label: `${goal.goal.name} goal`, value: this.money(goal.goal.targetAmount) },
          { label: 'Saved so far', value: this.money(goal.currentAmount), negative: true },
          { label: 'Months left', value: String(goal.monthsRemaining ?? 0), hint: 'Rounded to the nearest whole month' },
        ],
        result: { label: 'Needed', value: `${this.money(goal.requiredMonthly)} / month` },
        note: `A goal is on track when you’re putting in at least that much. ${goal.goal.name} is currently ${goal.onTrack ? 'on track' : 'behind'}.`,
      };
    },

    'planned-required': () => {
      const expense = this.store.plannedExpenses().find((e) => e.remaining > 0);
      if (!expense) return null;

      return {
        ...BASICS['planned-required'],
        formula: 'Needed each month = (cost − already saved) ÷ months until due',
        steps: [
          { label: `${expense.expense.name} cost`, value: this.money(expense.expense.amount) },
          { label: 'Already saved', value: this.money(expense.expense.savedAmount), negative: true },
          { label: 'Months until due', value: String(Math.max(1, expense.monthsUntil)) },
        ],
        result: { label: 'Needed', value: `${this.money(expense.requiredMonthly)} / month` },
        note: 'Anything due in the next three months that you haven’t saved for yet is also taken off “Free to spend or invest”, so it never looks like spare money.',
      };
    },

    'strategy-status': () => {
      const strategy = this.store.strategy();
      if (!strategy) return null;

      return {
        ...BASICS['strategy-status'],
        meaning: strategy.explanation,
        summary: 'Whether your plan is working, judged against your own checks rather than a generic score.',
        formula: 'How far from your safety cushion ÷ how much you save each month, then compared with your checks and planned expenses',
        steps: [
          { label: 'Safety cushion', value: this.money(strategy.securityFloor) },
          { label: 'Saved per month', value: `${this.money(strategy.recentMonthlySaving)} / month`, hint: 'Average of the last three full months' },
          {
            label: 'Months until your cushion is full',
            value: strategy.monthsToSecurity === null ? 'Not at this pace' : strategy.monthsToSecurity === 0 ? 'Already full' : `${strategy.monthsToSecurity}`,
          },
          { label: 'Checks flagged', value: String(strategy.signals.filter((s) => s.tone === 'warn' || s.tone === 'bad').length) },
        ],
        result: { label: 'Status', value: strategy.headline },
        note: '“Ahead of plan” only shows when everything is in order: your cushion is full, your savings are still growing and nothing is flagged. Any warning keeps it at “On track”.',
      };
    },

    forecast: () => {
      const scenario = this.store.defaultScenario();
      const cash = this.store.cash();
      const portfolio = this.store.portfolio();
      if (!scenario || !cash || !portfolio) return null;

      return {
        ...BASICS.forecast,
        formula: 'Each month: add income, take off spending, add investing, growth and interest, pay down loans — then repeat',
        steps: [
          { label: 'Cash you have now', value: this.money(cash.liquidTotal) },
          { label: 'Investments now', value: this.money(portfolio.totalValue) },
          { label: 'Investment growth', value: `${this.pct(scenario.investmentReturn * 100, 1)} / year`, hint: 'Before rising prices, added a little each month' },
          { label: 'Rising prices', value: `${this.pct(scenario.inflation * 100, 1)} / year`, hint: 'Spending goes up by this much each year' },
          { label: 'Invested each month', value: `${this.money(scenario.monthlyInvestment)} / month` },
        ],
        result: { label: 'How far ahead', value: `${scenario.horizonYears} years` },
        note: 'An estimate, not a promise. Returns aren’t guaranteed, and one bad year can move a long-range number a lot. “Show in today’s money” takes rising prices into account.',
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
        ...BASICS['currency-conversion'],
        formula: 'Converted = amount × exchange rate',
        steps: [
          { label: `${foreign.name} balance`, value: this.currency.formatIn(foreign.balance, foreign.currency) },
          {
            label: `${foreign.currency} → ${data.profile.baseCurrency} rate`,
            value: String(rate?.rate ?? 1),
            hint: rate ? `As of ${formatDate(rate.asOf, this.currency.locale())}` : 'No rate available — counted 1 to 1',
          },
        ],
        result: {
          label: `In ${data.profile.baseCurrency}`,
          value: this.money(this.store.convert()(foreign.balance, foreign.currency)),
        },
        note: 'Snowball never makes up a rate. If it has no rate for a currency, it counts it 1 to 1 and warns you in Settings.',
      };
    },
  };
}
