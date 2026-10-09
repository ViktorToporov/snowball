import { Injectable, computed, inject, signal } from '@angular/core';

import { AuthService } from '../auth/auth.service';
import { FINANCE_REPOSITORY } from '../data/finance.repository';
import { assessStrategy, evaluatePhases, StrategyInputs } from '../engine/strategy.engine';
import {
  cashHistory,
  cashSummary,
  totalCashHistory,
  Convert,
  essentialMonthlyExpenses,
  goalViews,
  incomeSummary,
  monthlyCashFlow,
  netWorthSummary,
  plannedExpenseViews,
  propertyMetrics,
  securityScore,
  essentialsByCategory,
  upcomingTimeline,
} from '../engine/metrics';
import { portfolioAllocation, portfolioSummary, rebalanceSuggestions } from '../engine/portfolio.engine';
import { CurrencyService } from '../money/currency.service';
import { FinancialDataset, WritableTable } from '../models/domain.models';
import { ToastService } from '../ui/toast.service';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * The single source of financial truth for the UI.
 *
 * One `load()` pulls the whole dataset; everything else is a computed
 * signal over it. Components read these signals and render — they never
 * do financial arithmetic of their own, which is what keeps the numbers
 * on the Dashboard, Net Worth and Forecasts pages agreeing with each
 * other.
 */
@Injectable({ providedIn: 'root' })
export class FinanceStore {
  private readonly repository = inject(FINANCE_REPOSITORY);
  private readonly auth = inject(AuthService);
  private readonly currency = inject(CurrencyService);
  private readonly toast = inject(ToastService);

  private readonly _data = signal<FinancialDataset | null>(null);
  private readonly _state = signal<LoadState>('idle');
  private readonly _error = signal<string | null>(null);
  private readonly _saving = signal(false);

  readonly data = this._data.asReadonly();
  readonly state = this._state.asReadonly();
  readonly error = this._error.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly isLoading = computed(() => this._state() === 'loading' || this._state() === 'idle');
  readonly isPersistent = this.repository.persistent;

  /* ---------------------------------------------------------------- */
  /* Loading                                                           */
  /* ---------------------------------------------------------------- */

  async load(force = false): Promise<void> {
    if (!force && (this._state() === 'ready' || this._state() === 'loading')) return;

    const userId = this.auth.user()?.id;
    if (!userId) return;

    this._state.set('loading');
    this._error.set(null);

    try {
      const data = await this.repository.load(userId);
      this.currency.loadRates(data.exchangeRates);
      this.currency.setBase(data.profile.baseCurrency, data.profile.locale);
      this._data.set(data);
      this._state.set('ready');
    } catch (error) {
      this._error.set(error instanceof Error ? error.message : 'Could not load your financial data.');
      this._state.set('error');
    }
  }

  async refresh(): Promise<void> {
    await this.load(true);
  }

  /* ---------------------------------------------------------------- */
  /* Writes                                                            */
  /* ---------------------------------------------------------------- */

  async create(table: WritableTable, values: Record<string, unknown>, label = 'Record'): Promise<boolean> {
    return this.write(() => this.repository.insert(table, { ...values, userId: this.auth.user()!.id }), `${label} added`);
  }

  async save(table: WritableTable, id: string, values: Record<string, unknown>, label = 'Record'): Promise<boolean> {
    return this.write(() => this.repository.update(table, id, values), `${label} updated`);
  }

  async destroy(table: WritableTable, id: string, label = 'Record'): Promise<boolean> {
    return this.write(() => this.repository.remove(table, id), `${label} deleted`);
  }

  async saveProfile(values: Record<string, unknown>): Promise<boolean> {
    return this.write(() => this.repository.updateProfile(this.auth.user()!.id, values), 'Settings saved');
  }

  private async write(action: () => Promise<unknown>, successMessage: string): Promise<boolean> {
    this._saving.set(true);
    try {
      await action();
      await this.load(true);
      this.toast.success(successMessage);
      return true;
    } catch (error) {
      this.toast.error('Could not save', error instanceof Error ? error.message : 'Unexpected error.');
      return false;
    } finally {
      this._saving.set(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Derived state                                                     */
  /* ---------------------------------------------------------------- */

  /** Converts into the user's base currency; re-evaluates when rates change. */
  readonly convert = computed<Convert>(() => {
    this.currency.ratesVersion();
    return (amount: number, currency: string) => this.currency.toBase(amount, currency);
  });

  readonly profile = computed(() => this._data()?.profile ?? null);

  readonly cash = computed(() => {
    const data = this._data();
    return data ? cashSummary(data, this.convert()) : null;
  });

  readonly cashHistory = computed(() => {
    const data = this._data();
    return data ? cashHistory(data) : [];
  });

  readonly cashFlow = computed(() => {
    const data = this._data();
    return data ? monthlyCashFlow(data, this.convert(), 13) : [];
  });

  readonly income = computed(() => {
    const data = this._data();
    return data ? incomeSummary(data, this.convert()) : null;
  });

  readonly essentialExpenses = computed(() => {
    const data = this._data();
    return data ? essentialMonthlyExpenses(data, this.convert()) : 0;
  });

  readonly netWorth = computed(() => {
    const data = this._data();
    return data ? netWorthSummary(data, this.convert()) : null;
  });

  readonly portfolio = computed(() => {
    const data = this._data();
    return data ? portfolioSummary(data, this.convert()) : null;
  });

  readonly allocation = computed(() => {
    const data = this._data();
    return data ? portfolioAllocation(data, this.convert()) : [];
  });

  readonly rebalance = computed(() => rebalanceSuggestions(this.allocation()));

  readonly properties = computed(() => {
    const data = this._data();
    const convert = this.convert();
    return data ? data.properties.map((property) => propertyMetrics(property, convert)) : [];
  });

  readonly goals = computed(() => {
    const data = this._data();
    return data ? goalViews(data, this.convert()) : [];
  });

  readonly plannedExpenses = computed(() => {
    const data = this._data();
    return data ? plannedExpenseViews(data, this.convert()) : [];
  });

  readonly timeline = computed(() => {
    const data = this._data();
    return data ? upcomingTimeline(data, this.convert()) : [];
  });

  /** The declared baseline, grouped by category. */
  readonly essentialSpending = computed(() => {
    const data = this._data();
    if (!data) return [];
    return essentialsByCategory(data.recurringExpenses, data.categories, this.convert());
  });

  readonly recurringExpenses = computed(() => {
    const data = this._data();
    if (!data) return [];
    return [...data.recurringExpenses].sort((a, b) => b.amount - a.amount);
  });

  readonly security = computed(() => {
    const data = this._data();
    const cash = this.cash();
    const netWorth = this.netWorth();
    if (!data || !cash || !netWorth) return null;

    return securityScore({
      emergencyProgress: cash.emergencyProgress,
      emergencyBalance: cash.emergencyBalance,
      essentialExpenses: this.essentialExpenses(),
      monthlyIncome: this.income()?.monthlyRecurring ?? 0,
      liquidCash: cash.liquidTotal,
      netWorth: netWorth.netWorth,
      nonMortgageDebt: data.liabilities
        .filter((l) => l.liabilityKind !== 'mortgage')
        .reduce((total, l) => total + this.convert()(l.balance, l.currency), 0),
      investments: netWorth.investments,
    });
  });

  private readonly strategyInputs = computed<StrategyInputs | null>(() => {
    const data = this._data();
    const cash = this.cash();
    if (!data || !cash) return null;

    return {
      data,
      cash,
      cashFlow: this.cashFlow(),
      goals: this.goals(),
      planned: this.plannedExpenses(),
      essentialExpenses: this.essentialExpenses(),
      monthlyIncome: this.income()?.monthlyRecurring ?? 0,
      portfolioValue: this.portfolio()?.totalValue ?? 0,
      currency: this.currency.baseCurrency(),
      locale: this.currency.locale(),
    };
  });

  readonly strategy = computed(() => {
    const inputs = this.strategyInputs();
    return inputs ? assessStrategy(inputs) : null;
  });

  readonly phases = computed(() => {
    const inputs = this.strategyInputs();
    return inputs ? evaluatePhases(inputs) : [];
  });

  readonly scenarios = computed(() => this._data()?.scenarios ?? []);

  readonly defaultScenario = computed(
    () => this.scenarios().find((s) => s.isDefault) ?? this.scenarios()[0] ?? null,
  );

  /* -- lookups used by the tables ----------------------------------- */

  readonly accountsById = computed(
    () => new Map((this._data()?.accounts ?? []).map((account) => [account.id, account])),
  );

  readonly totalCashHistory = computed(() => {
    const data = this._data();
    return data ? totalCashHistory(data) : [];
  });

  readonly categoriesById = computed(
    () => new Map((this._data()?.categories ?? []).map((category) => [category.id, category])),
  );

  readonly propertiesById = computed(
    () => new Map((this._data()?.properties ?? []).map((property) => [property.id, property])),
  );

  readonly investmentsById = computed(
    () => new Map((this._data()?.investments ?? []).map((investment) => [investment.id, investment])),
  );

  /* -- month-over-month deltas for the stat cards -------------------- */

  readonly deltas = computed(() => {
    const flow = this.cashFlow();
    const history = this._data()?.netWorthSnapshots ?? [];

    /* Liquid cash has its own series. The net-worth snapshot's
       `cashValue` includes ring-fenced accounts like a property reserve,
       so using it here would put the wrong delta under a card labelled
       "Liquid Cash". */
    const liquid = this.cashHistory();
    const liquidDelta =
      liquid.length >= 2 ? round(liquid[liquid.length - 1].value - liquid[liquid.length - 2].value) : null;
    const sorted = [...history].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));

    const latest = sorted.at(-1);
    // Skip the "today" mark and the current partial month.
    const priorMonth = sorted.filter((s) => s.snapshotDate < (latest?.snapshotDate ?? '')).at(-1);

    return {
      cash: liquidDelta,
      investments: latest && priorMonth ? round(latest.investmentValue - priorMonth.investmentValue) : null,
      netWorth: latest && priorMonth ? round(latest.netWorth - priorMonth.netWorth) : null,
      propertyEquity:
        latest && priorMonth
          ? round(
              latest.propertyValue - latest.liabilities - (priorMonth.propertyValue - priorMonth.liabilities),
            )
          : null,
      income: deltaOf(flow, 'income'),
      essential: deltaOf(flow, 'essential'),
      flexible: deltaOf(flow, 'flexible'),
    };
  });
}

function deltaOf(flow: readonly { income: number; essential: number; flexible: number }[], key: 'income' | 'essential' | 'flexible'): number | null {
  // Compare the last two *complete* months.
  const completed = flow.slice(0, -1);
  if (completed.length < 2) return null;
  return round(completed.at(-1)![key] - completed.at(-2)![key]);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
