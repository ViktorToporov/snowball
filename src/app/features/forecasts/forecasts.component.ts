import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ForecastPoint, runForecast } from '../../core/engine/forecast.engine';
import { CurrencyService } from '../../core/money/currency.service';
import { addMonths, formatMonthLong, startOfMonth } from '../../core/money/format';
import { ForecastScenario } from '../../core/models/domain.models';
import { FinanceStore } from '../../core/state/finance.store';
import { Series, seriesColor } from '../../shared/charts/chart-utils';
import { LineChartComponent } from '../../shared/charts/line-chart.component';
import { EmptyStateComponent, SectionComponent, SkeletonComponent } from '../../shared/ui/ui-kit';

type ChartKey = 'netWorth' | 'cash' | 'investments' | 'propertyEquity';

const CHARTS: Array<{ key: ChartKey; label: string; title: string; subtitle: string; color: number }> = [
  {
    key: 'netWorth',
    label: 'Net worth',
    title: 'Net worth over time',
    subtitle: 'Everything you own minus everything you owe, month by month.',
    color: 0,
  },
  {
    key: 'cash',
    label: 'Cash',
    title: 'Cash you can use now, over time',
    subtitle: 'After your bills, everyday spending and planned expenses.',
    color: 3,
  },
  {
    key: 'investments',
    label: 'Investments',
    title: 'Investments over time',
    subtitle: 'Money you put in plus growth. Monthly investing starts again once your safety cushion is full.',
    color: 2,
  },
  {
    key: 'propertyEquity',
    label: 'Property',
    title: 'Your share of property over time',
    subtitle: 'The home going up in value, plus the mortgage being paid off.',
    color: 5,
  },
];

/** The question the page leads with. */
const FOCUS_YEARS = 10;

/** Plain-language names for the forecast's assumptions, keyed by the engine's label. */
const ASSUMPTION_WORDS: Record<string, { label: string; note?: string }> = {
  'Investment return': { label: 'Investment growth', note: 'Per year, before tax and before rising prices. Added a little each month.' },
  'Salary growth': { label: 'Expected yearly raise', note: 'Added once a year.' },
  Inflation: { label: 'Rising prices (inflation)', note: 'Your bills and everyday spending go up by this much each year.' },
  'Cash interest': { label: 'Interest on savings', note: 'Rates change in real life — this one isn’t guaranteed.' },
  'Property appreciation': { label: 'Home value growth' },
  'Monthly investment': { label: 'Invested each month', note: 'Goes back up to the amount in your plan once your safety cushion is full.' },
  'Surplus sweep': { label: 'Spare cash invested', note: 'Cash above your safety cushion plus three months of spending is invested instead of sitting idle.' },
  'Flexible spending': { label: 'Everyday spending', note: 'An average — real months go up and down.' },
  'Rental income': { label: 'Rent' },
  'Planned expenses': { label: 'Planned expenses' },
};

const MILESTONE_WORDS: Record<string, string> = {
  'Emergency fund complete': 'Safety cushion full',
  'Cash exhausted': 'Cash runs out',
};

interface Draft {
  investmentReturn: number;
  salaryGrowth: number;
  inflation: number;
  cashInterest: number;
  propertyAppreciation: number;
  monthlyInvestment: number;
  monthlyFlexibleSpending: number;
  horizonYears: number;
  includeRentalIncome: boolean;
  includePlannedExpenses: boolean;
}

@Component({
  selector: 'sb-forecasts',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, SectionComponent, SkeletonComponent, EmptyStateComponent, LineChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="page-head__titles">
          <p class="eyebrow">Where you could be</p>
          <h1 class="h1">Future</h1>
        </div>
        @if (ready()) {
          <div class="page-head__actions">
            <label class="switch">
              <input type="checkbox" [checked]="todaysMoney()" (change)="todaysMoney.set(!todaysMoney())" />
              <span class="switch__track"></span><span class="switch__thumb"></span>
              <span class="small">Show in today's money</span>
            </label>
          </div>
        }
      </header>

      @if (store.isLoading()) {
        <div class="card card--pad"><sb-skeleton [count]="8" /></div>
      } @else if (!hasIncome()) {
        <div class="card">
          <sb-empty
            title="Add your income first to see a forecast"
            text="A forecast needs to know what comes in each month. Add your pay and any other regular income, and Snowball will project where you could be."
          >
            <a class="btn btn--primary btn--sm" routerLink="/cash-flow" [queryParams]="{ tab: 'income' }">Add your income</a>
          </sb-empty>
        </div>
      } @else if (!scenario()) {
        <div class="card">
          <sb-empty
            title="No forecast set up yet"
            text="Start with a middle-of-the-road set of assumptions. You can change every one of them afterwards."
          >
            <button type="button" class="btn btn--primary btn--sm" (click)="createScenario()" [disabled]="store.saving()">
              Create my forecast
            </button>
          </sb-empty>
        </div>
      } @else if (forecast(); as result) {
        <!-- ------------------------------------------------------- -->
        <section class="card card--pad focus">
          @if (focus(); as f) {
            <p class="focus__question">Where could I be in {{ f.years }} years?</p>
            <p class="focus__value">{{ compact(value(f.point.netWorth, f.point.monthIndex)) }}</p>
            <p class="focus__caption">
              Estimated net worth in {{ monthYear(f.point.monthIndex) }}
              — {{ todaysMoney() ? "in today's money" : 'in future money (not adjusted for rising prices)' }}.
            </p>
            <dl class="focus__parts">
              <div><dt>Cash</dt><dd>{{ compact(value(f.point.cash, f.point.monthIndex)) }}</dd></div>
              <div><dt>Investments</dt><dd>{{ compact(value(f.point.investments, f.point.monthIndex)) }}</dd></div>
              <div><dt>Your share of property</dt><dd>{{ compact(value(f.point.propertyEquity, f.point.monthIndex)) }}</dd></div>
            </dl>
          }
          <p class="focus__money-note">
            @if (todaysMoney()) {
              <strong>Today's money:</strong> prices rise over time, so a future amount buys less than the same amount
              today. We've shrunk future figures by {{ pct(scenario()!.inflation * 100) }} a year so you can compare them
              with what money buys now.
            } @else {
              <strong>Future money:</strong> these are the amounts you'd actually see in your accounts then. Prices will
              have risen too, so they'll buy less than they would today.
            }
          </p>
        </section>

        <div class="estimate-note">
          <span>
            <strong>An estimate, not a promise.</strong> This is worked out from the assumptions further down.
            Investment growth isn't guaranteed, interest rates change, and one bad year can move a long-range number
            a lot. Use it to compare choices, not to count on a specific amount.
          </span>
        </div>

        <!-- ------------------------------------------------------- -->
        @if (otherHorizons().length) {
          <div class="horizons">
            @for (horizon of otherHorizons(); track horizon.years) {
              <article class="horizon">
                <span class="horizon__years">In {{ horizon.years }} year{{ horizon.years === 1 ? '' : 's' }}</span>
                <span class="horizon__value">{{ compact(value(horizon.point.netWorth, horizon.point.monthIndex)) }}</span>
                <span class="horizon__label">net worth by {{ monthYear(horizon.point.monthIndex) }}</span>
                <dl class="horizon__parts">
                  <div><dt>Cash</dt><dd>{{ compact(value(horizon.point.cash, horizon.point.monthIndex)) }}</dd></div>
                  <div><dt>Investments</dt><dd>{{ compact(value(horizon.point.investments, horizon.point.monthIndex)) }}</dd></div>
                  <div><dt>Your share of property</dt><dd>{{ compact(value(horizon.point.propertyEquity, horizon.point.monthIndex)) }}</dd></div>
                </dl>
              </article>
            }
          </div>
        }

        <!-- ------------------------------------------------------- -->
        <sb-section [title]="activeChart().title" explain="forecast" [subtitle]="activeChart().subtitle">
          <div slot="actions">
            <div class="segmented" role="group" aria-label="What to show">
              @for (chart of charts; track chart.key) {
                <button
                  type="button"
                  class="segmented__item"
                  [attr.aria-pressed]="chartKey() === chart.key"
                  (click)="chartKey.set(chart.key)"
                >
                  {{ chart.label }}
                </button>
              }
            </div>
          </div>

          <sb-line-chart
            [series]="projectionSeries()"
            [height]="330"
            [zeroBased]="true"
            [ariaLabel]="activeChart().title"
          />

          <p class="micro muted" style="margin-top:12px">
            Based on {{ pct(scenario()!.investmentReturn * 100) }} investment growth a year,
            {{ pct(scenario()!.inflation * 100) }} rising prices and {{ pct(scenario()!.cashInterest * 100) }} interest on savings.
            {{ todaysMoney() ? "Shown in today's money." : 'Shown in future money (not adjusted for rising prices).' }}
          </p>
        </sb-section>

        <!-- ------------------------------------------------------- -->
        <sb-section title="Milestones" subtitle="When things are expected to happen, if the assumptions hold.">
          @if (result.milestones.length) {
            <ol class="milestones">
              @for (milestone of result.milestones; track milestone.label + milestone.monthIndex) {
                <li class="milestone">
                  <span class="milestone__dot" [class]="'milestone__dot milestone__dot--' + milestone.kind"></span>
                  <div class="col" style="gap:1px; min-width:0">
                    <span class="milestone__label">{{ milestoneLabel(milestone.label) }}</span>
                    <span class="milestone__date">{{ monthYear(milestone.monthIndex) }}</span>
                  </div>
                </li>
              }
            </ol>
          } @else {
            <sb-empty
              title="No milestones in this time frame"
              text="Try looking further ahead, or saving a little more each month."
            />
          }

          <div class="divider" style="margin:16px 0"></div>

          <dl class="mini-facts">
            <div>
              <dt>Safety cushion full</dt>
              <dd>
                {{ result.securityMonth === null ? 'Not in this time frame' : result.securityMonth === 0 ? 'Already full' : monthYear(result.securityMonth) }}
              </dd>
            </div>
            <div>
              <dt>Cash runs out</dt>
              <dd>{{ result.cashRunsOutMonth === null ? 'Never' : monthYear(result.cashRunsOutMonth) }}</dd>
            </div>
          </dl>
        </sb-section>

        <!-- ------------------------------------------------------- -->
        @if (scenarios().length > 1) {
          <sb-section
            title="Compare scenarios"
            subtitle="The same starting point under cautious, middle and hopeful assumptions. Pick one to use above."
          >
            <div slot="actions">
              <div class="segmented" role="group" aria-label="Scenario used above">
                @for (s of scenarios(); track s.id) {
                  <button
                    type="button"
                    class="segmented__item"
                    [attr.aria-pressed]="scenario()?.id === s.id"
                    (click)="selectScenario(s.id)"
                  >
                    {{ s.name }}
                  </button>
                }
              </div>
            </div>
            <sb-line-chart
              [series]="comparisonSeries()"
              [height]="280"
              ariaLabel="Net worth under each scenario"
            />
            <div class="estimate-note" style="margin-top:14px">
              <span>
                The gap between the cautious and hopeful lines shows how uncertain this is. In
                {{ comparisonHorizon() }} years, net worth could be anywhere from
                <strong>{{ compact(comparisonLow()) }} to {{ compact(comparisonHigh()) }}</strong>.
              </span>
            </div>
          </sb-section>
        }

        <!-- ------------------------------------------------------- -->
        <sb-section title="Assumptions" explain="forecast" subtitle="Everything the forecast depends on. Change them to see what difference they make.">
          <div slot="actions">
            <button type="button" class="btn btn--ghost btn--sm" (click)="toggleAssumptions()">
              {{ assumptionsOpen() ? 'Stop changing' : 'Change assumptions' }}
            </button>
          </div>

          @if (assumptionsOpen()) {
            <p class="small muted" style="margin-bottom:12px">
              The forecast above updates as you type. Nothing is saved until you press Save.
            </p>
            <div class="assumptions">
              <label class="assumption">
                <span class="assumption__label">Investment growth (% per year)</span>
                <input class="input input--num" type="number" step="0.5" [ngModel]="draft().investmentReturn" (ngModelChange)="patch('investmentReturn', $event)" name="ir" />
              </label>
              <label class="assumption">
                <span class="assumption__label">Expected yearly raise (%)</span>
                <input class="input input--num" type="number" step="0.5" [ngModel]="draft().salaryGrowth" (ngModelChange)="patch('salaryGrowth', $event)" name="sg" />
              </label>
              <label class="assumption">
                <span class="assumption__label">Rising prices (% per year)</span>
                <input class="input input--num" type="number" step="0.5" [ngModel]="draft().inflation" (ngModelChange)="patch('inflation', $event)" name="inf" />
              </label>
              <label class="assumption">
                <span class="assumption__label">Interest on savings (% per year)</span>
                <input class="input input--num" type="number" step="0.1" [ngModel]="draft().cashInterest" (ngModelChange)="patch('cashInterest', $event)" name="ci" />
              </label>
              <label class="assumption">
                <span class="assumption__label">Home value growth (% per year)</span>
                <input class="input input--num" type="number" step="0.5" [ngModel]="draft().propertyAppreciation" (ngModelChange)="patch('propertyAppreciation', $event)" name="pa" />
              </label>
              <label class="assumption">
                <span class="assumption__label">Invested each month</span>
                <input class="input input--num" type="number" step="25" [ngModel]="draft().monthlyInvestment" (ngModelChange)="patch('monthlyInvestment', $event)" name="mi" />
              </label>
              <label class="assumption">
                <span class="assumption__label">Everyday spending a month</span>
                <input class="input input--num" type="number" step="25" [ngModel]="draft().monthlyFlexibleSpending" (ngModelChange)="patch('monthlyFlexibleSpending', $event)" name="mf" />
              </label>
              <label class="assumption">
                <span class="assumption__label">How far ahead (years)</span>
                <input class="input input--num" type="number" min="1" max="40" step="1" [ngModel]="draft().horizonYears" (ngModelChange)="patch('horizonYears', $event)" name="hy" />
              </label>

              <label class="switch assumption assumption--switch">
                <input type="checkbox" [ngModel]="draft().includeRentalIncome" (ngModelChange)="patch('includeRentalIncome', $event)" name="rent" />
                <span class="switch__track"></span><span class="switch__thumb"></span>
                <span class="small">Include rent</span>
              </label>
              <label class="switch assumption assumption--switch">
                <input type="checkbox" [ngModel]="draft().includePlannedExpenses" (ngModelChange)="patch('includePlannedExpenses', $event)" name="planned" />
                <span class="switch__track"></span><span class="switch__thumb"></span>
                <span class="small">Take off planned expenses</span>
              </label>
            </div>

            <div class="row" style="justify-content:flex-end; gap:8px; margin:14px 0 18px">
              <button type="button" class="btn btn--ghost btn--sm" (click)="resetDraft()">Undo changes</button>
              <button type="button" class="btn btn--primary btn--sm" (click)="saveScenario()" [disabled]="store.saving()">
                Save
              </button>
            </div>
          }

          <div class="table-wrap">
            <table class="table table--stack">
              <thead>
                <tr><th>Assumption</th><th>Value</th><th>Note</th></tr>
              </thead>
              <tbody>
                @for (assumption of assumptions(); track assumption.label) {
                  <tr>
                    <td class="table__primary">{{ assumption.label }}</td>
                    <td class="num" data-label="Value">{{ assumption.value }}</td>
                    <td class="secondary" data-label="Note">{{ assumption.note ?? '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </sb-section>
      }
    </div>
  `,
  styleUrl: './forecasts.component.scss',
})
export class ForecastsComponent {
  readonly store = inject(FinanceStore);
  private readonly currency = inject(CurrencyService);

  readonly charts = CHARTS;
  readonly chartKey = signal<ChartKey>('netWorth');
  readonly assumptionsOpen = signal(false);
  readonly selectedId = signal<string | null>(null);
  /** On by default: future amounts are much easier to judge in today's prices. */
  readonly todaysMoney = signal(true);

  /** Editable copy of the scenario, in human units (percent, not fractions). */
  readonly draft = signal<Draft>({
    investmentReturn: 7,
    salaryGrowth: 3,
    inflation: 2,
    cashInterest: 2.4,
    propertyAppreciation: 2,
    monthlyInvestment: 0,
    monthlyFlexibleSpending: 600,
    horizonYears: 20,
    includeRentalIncome: true,
    includePlannedExpenses: true,
  });

  readonly scenarios = this.store.scenarios;

  readonly hasIncome = computed(() => (this.store.income()?.monthlyRecurring ?? 0) > 0);
  readonly ready = computed(() => !this.store.isLoading() && this.hasIncome() && !!this.scenario());

  readonly scenario = computed(() => {
    const scenarios = this.scenarios();
    if (!scenarios.length) return null;
    const id = this.selectedId();
    return scenarios.find((s) => s.id === id) ?? this.store.defaultScenario() ?? scenarios[0];
  });

  /** The scenario with any unsaved assumption edits applied. */
  private readonly effectiveScenario = computed<ForecastScenario | null>(() => {
    const base = this.scenario();
    if (!base) return null;
    if (!this.assumptionsOpen()) return base;
    const draft = this.draft();

    return {
      ...base,
      investmentReturn: Number(draft.investmentReturn) / 100,
      salaryGrowth: Number(draft.salaryGrowth) / 100,
      inflation: Number(draft.inflation) / 100,
      cashInterest: Number(draft.cashInterest) / 100,
      propertyAppreciation: Number(draft.propertyAppreciation) / 100,
      monthlyInvestment: Number(draft.monthlyInvestment),
      monthlyFlexibleSpending: Number(draft.monthlyFlexibleSpending),
      horizonYears: Math.max(1, Math.min(40, Number(draft.horizonYears) || 1)),
      includeRentalIncome: draft.includeRentalIncome,
      includePlannedExpenses: draft.includePlannedExpenses,
    };
  });

  private runFor(scenario: ForecastScenario) {
    const data = this.store.data()!;
    return runForecast({
      data,
      convert: this.store.convert(),
      scenario,
      startingCash: this.store.cash()?.liquidTotal ?? 0,
      startingInvestments: this.store.portfolio()?.totalValue ?? 0,
      essentialExpenses: this.store.essentialExpenses(),
      monthlyIncome: this.store.income()?.monthlyRecurring ?? 0,
      blendedCashRate: (this.store.cash()?.blendedRate ?? 0) / 100,
      formatCurrency: (value) => this.currency.format(value, { decimals: 0 }),
      formatPercent: (value) => this.currency.percent(value, 1),
    });
  }

  readonly forecast = computed(() => {
    const scenario = this.effectiveScenario();
    if (!scenario || !this.store.data()) return null;
    return this.runFor(scenario);
  });

  /** The "where could I be in 10 years?" card — or the furthest point if the horizon is shorter. */
  readonly focus = computed(() => {
    const result = this.forecast();
    if (!result || !result.points.length) return null;
    const exact = result.horizons.find((h) => h.years === FOCUS_YEARS);
    if (exact) return exact;
    const last = result.points.at(-1)!;
    return { years: Math.max(1, Math.round(last.monthIndex / 12)), point: last };
  });

  readonly otherHorizons = computed(() => {
    const focus = this.focus();
    return (this.forecast()?.horizons ?? []).filter((h) => h.point.monthIndex !== focus?.point.monthIndex);
  });

  readonly assumptions = computed(() =>
    (this.forecast()?.assumptions ?? []).map((assumption) => {
      const words = ASSUMPTION_WORDS[assumption.label];
      return {
        label: words?.label ?? assumption.label,
        value: assumption.value.replace(' APY', ' / year'),
        note: words?.note ?? assumption.note,
      };
    }),
  );

  readonly activeChart = computed(() => CHARTS.find((c) => c.key === this.chartKey()) ?? CHARTS[0]);

  readonly projectionSeries = computed<Series[]>(() => {
    const result = this.forecast();
    if (!result) return [];

    const chart = this.activeChart();
    // Sample quarterly beyond six years so the line stays readable.
    const points = result.points.filter((p, i) => (result.points.length > 72 ? p.monthIndex % 3 === 0 : true) || i === result.points.length - 1);

    const series: Series[] = [
      {
        key: chart.key,
        name: chart.label,
        color: seriesColor(chart.color),
        area: true,
        points: points.map((p) => ({ label: p.date, value: this.value(p[chart.key], p.monthIndex) })),
      },
    ];

    if (chart.key === 'investments') {
      const already = this.store.portfolio()?.totalContributions ?? 0;
      series.push({
        key: 'contributions',
        name: 'Money you put in',
        color: seriesColor(1),
        dashed: true,
        points: points.map((p) => ({ label: p.date, value: this.value(already + p.contributions, p.monthIndex) })),
      });
    }

    if (chart.key === 'cash') {
      // The cushion is set in today's money, so it is drawn flat either way.
      const floor = this.store.data()?.profile.emergencyFundTarget ?? 0;
      series.push({
        key: 'floor',
        name: 'Safety cushion',
        color: seriesColor(4),
        dashed: true,
        points: points.map((p) => ({ label: p.date, value: floor })),
      });
    }

    return series;
  });

  /* -- scenario comparison -------------------------------------------- */

  private readonly allResults = computed(() => {
    if (!this.store.data()) return [];
    return this.scenarios().map((scenario) => ({ scenario, result: this.runFor(scenario) }));
  });

  readonly comparisonSeries = computed<Series[]>(() => {
    const results = this.allResults();
    if (!results.length) return [];

    const shortest = Math.min(...results.map((r) => r.result.points.length));
    const step = shortest > 72 ? 3 : 1;

    // Explicit slots: yellow / blue / violet. Green is reserved for
    // positive financial direction and must not label a scenario.
    const slots = [4, 0, 2];

    return results.map(({ scenario, result }, index) => ({
      key: scenario.id,
      name: scenario.name,
      color: seriesColor(slots[index] ?? index),
      area: scenario.isDefault,
      points: result.points
        .slice(0, shortest)
        .filter((p) => p.monthIndex % step === 0)
        .map((p) => ({ label: p.date, value: this.value(p.netWorth, p.monthIndex, scenario.inflation) })),
    }));
  });

  readonly comparisonHorizon = computed(() => {
    const results = this.allResults();
    if (!results.length) return 0;
    return Math.min(...results.map((r) => r.scenario.horizonYears));
  });

  private readonly comparisonEndValues = computed(() => {
    const years = this.comparisonHorizon();
    return this.allResults()
      .map(({ scenario, result }) => {
        const point: ForecastPoint | undefined = result.points[years * 12 - 1];
        return point ? this.value(point.netWorth, point.monthIndex, scenario.inflation) : 0;
      })
      .filter((value) => Number.isFinite(value));
  });

  readonly comparisonLow = computed(() => Math.min(...(this.comparisonEndValues().length ? this.comparisonEndValues() : [0])));
  readonly comparisonHigh = computed(() => Math.max(...(this.comparisonEndValues().length ? this.comparisonEndValues() : [0])));

  /* -- assumptions editing --------------------------------------------- */

  selectScenario(id: string): void {
    this.selectedId.set(id);
    this.resetDraft();
  }

  toggleAssumptions(): void {
    if (!this.assumptionsOpen()) this.resetDraft();
    this.assumptionsOpen.update((open) => !open);
  }

  patch<K extends keyof Draft>(key: K, value: Draft[K]): void {
    this.draft.update((draft) => ({ ...draft, [key]: value }));
  }

  resetDraft(): void {
    const scenario = this.scenario();
    if (!scenario) return;
    this.draft.set({
      investmentReturn: round(scenario.investmentReturn * 100),
      salaryGrowth: round(scenario.salaryGrowth * 100),
      inflation: round(scenario.inflation * 100),
      cashInterest: round(scenario.cashInterest * 100),
      propertyAppreciation: round(scenario.propertyAppreciation * 100),
      monthlyInvestment: scenario.monthlyInvestment,
      monthlyFlexibleSpending: scenario.monthlyFlexibleSpending,
      horizonYears: scenario.horizonYears,
      includeRentalIncome: scenario.includeRentalIncome,
      includePlannedExpenses: scenario.includePlannedExpenses,
    });
  }

  async saveScenario(): Promise<void> {
    const scenario = this.scenario();
    const effective = this.effectiveScenario();
    if (!scenario || !effective) return;
    await this.store.save(
      'forecast_scenarios',
      scenario.id,
      {
        investmentReturn: effective.investmentReturn,
        salaryGrowth: effective.salaryGrowth,
        inflation: effective.inflation,
        cashInterest: effective.cashInterest,
        propertyAppreciation: effective.propertyAppreciation,
        monthlyInvestment: effective.monthlyInvestment,
        monthlyFlexibleSpending: effective.monthlyFlexibleSpending,
        horizonYears: effective.horizonYears,
        includeRentalIncome: effective.includeRentalIncome,
        includePlannedExpenses: effective.includePlannedExpenses,
      },
      'Forecast',
    );
  }

  /** A sensible middle-of-the-road starting point for a user with no scenario. */
  async createScenario(): Promise<void> {
    const lastMonth = this.store.cashFlow().slice(0, -1).at(-1);
    await this.store.create(
      'forecast_scenarios',
      {
        name: 'Base case',
        kind: 'base',
        isDefault: true,
        investmentReturn: 0.05,
        salaryGrowth: 0.02,
        inflation: 0.02,
        cashInterest: 0.02,
        propertyAppreciation: 0.02,
        monthlyInvestment: 0,
        monthlyFlexibleSpending: Math.max(0, Math.round(lastMonth?.flexible ?? 0)),
        includeRentalIncome: true,
        includePlannedExpenses: true,
        horizonYears: 20,
        notes: null,
      },
      'Forecast',
    );
  }

  /* -- display ---------------------------------------------------------- */

  /**
   * A projected amount, optionally brought back into today's money:
   * divided by (1 + inflation) for every year between now and then.
   */
  value(amount: number, monthIndex: number, inflation = this.effectiveScenario()?.inflation ?? 0): number {
    if (!this.todaysMoney() || !inflation) return amount;
    return amount / Math.pow(1 + inflation, monthIndex / 12);
  }

  /** "March 2029" for a month counted from the start of this month. */
  monthYear(monthIndex: number): string {
    return formatMonthLong(addMonths(startOfMonth(new Date()), monthIndex), this.currency.locale());
  }

  milestoneLabel(label: string): string {
    return MILESTONE_WORDS[label] ?? label;
  }

  compact(value: number): string {
    return this.currency.compact(value);
  }

  pct(value: number): string {
    return this.currency.percent(value, 1);
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
