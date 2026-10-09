import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { runForecast } from '../../core/engine/forecast.engine';
import { CurrencyService } from '../../core/money/currency.service';
import { formatDate } from '../../core/money/format';
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
    title: 'Net worth projection',
    subtitle: 'Assets minus liabilities, projected month by month.',
    color: 0,
  },
  {
    key: 'cash',
    label: 'Liquid cash',
    title: 'Liquid cash projection',
    subtitle: 'Cash after essentials, flexible spending and planned expenses.',
    color: 3,
  },
  {
    key: 'investments',
    label: 'Investments',
    title: 'Investment portfolio projection',
    subtitle: 'Contributions plus compounded growth. Contributions resume once the emergency fund is full.',
    color: 2,
  },
  {
    key: 'propertyEquity',
    label: 'Property equity',
    title: 'Property equity projection',
    subtitle: 'Appreciation combined with mortgage amortisation.',
    color: 5,
  },
];

@Component({
  selector: 'sb-forecasts',
  standalone: true,
  imports: [CommonModule, FormsModule, SectionComponent, SkeletonComponent, EmptyStateComponent, LineChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="page-head__titles">
          <p class="eyebrow">Projections</p>
          <h1 class="h1">Forecasts</h1>
        </div>
        <div class="page-head__actions">
          @if (scenarios().length > 1) {
            <div class="segmented" role="group" aria-label="Scenario">
              @for (scenario of scenarios(); track scenario.id) {
                <button
                  type="button"
                  class="segmented__item"
                  [attr.aria-pressed]="selectedId() === scenario.id"
                  (click)="selectedId.set(scenario.id)"
                >
                  {{ scenario.name }}
                </button>
              }
            </div>
          }
          <button type="button" class="btn btn--ghost btn--sm" (click)="assumptionsOpen.set(!assumptionsOpen())">
            {{ assumptionsOpen() ? 'Hide' : 'Adjust' }} assumptions
          </button>
        </div>
      </header>

      <!-- The disclaimer sits above everything it qualifies. -->
      <div class="estimate-note">
        <span>
          <strong>These are projections, not promises.</strong> Every figure below is a simulation from the
          assumptions shown — investment returns are not guaranteed, interest rates change, and a single bad year
          can move a long-horizon number substantially. Use them to compare choices, not to plan on a specific outcome.
        </span>
      </div>

      @if (store.isLoading()) {
        <div class="card card--pad"><sb-skeleton [count]="8" /></div>
      } @else if (!scenario()) {
        <div class="card">
          <sb-empty title="No scenario configured" text="Add a forecast scenario to project your finances forward." />
        </div>
      } @else if (forecast(); as result) {
        <!-- ------------------------------------------------------- -->
        @if (assumptionsOpen()) {
          <sb-section title="Assumptions" subtitle="Change these to see how sensitive the projection is. Nothing here is saved until you press Save.">
            <div class="assumptions">
              <label class="assumption">
                <span class="assumption__label">Investment return (%/yr)</span>
                <input class="input input--num" type="number" step="0.5" [(ngModel)]="draft.investmentReturn" name="ir" />
              </label>
              <label class="assumption">
                <span class="assumption__label">Salary growth (%/yr)</span>
                <input class="input input--num" type="number" step="0.5" [(ngModel)]="draft.salaryGrowth" name="sg" />
              </label>
              <label class="assumption">
                <span class="assumption__label">Inflation (%/yr)</span>
                <input class="input input--num" type="number" step="0.5" [(ngModel)]="draft.inflation" name="inf" />
              </label>
              <label class="assumption">
                <span class="assumption__label">Cash interest (% APY)</span>
                <input class="input input--num" type="number" step="0.1" [(ngModel)]="draft.cashInterest" name="ci" />
              </label>
              <label class="assumption">
                <span class="assumption__label">Property appreciation (%/yr)</span>
                <input class="input input--num" type="number" step="0.5" [(ngModel)]="draft.propertyAppreciation" name="pa" />
              </label>
              <label class="assumption">
                <span class="assumption__label">Monthly investment</span>
                <input class="input input--num" type="number" step="25" [(ngModel)]="draft.monthlyInvestment" name="mi" />
              </label>
              <label class="assumption">
                <span class="assumption__label">Monthly flexible spending</span>
                <input class="input input--num" type="number" step="25" [(ngModel)]="draft.monthlyFlexibleSpending" name="mf" />
              </label>
              <label class="assumption">
                <span class="assumption__label">Horizon (years)</span>
                <input class="input input--num" type="number" min="1" max="40" step="1" [(ngModel)]="draft.horizonYears" name="hy" />
              </label>

              <label class="switch assumption assumption--switch">
                <input type="checkbox" [(ngModel)]="draft.includeRentalIncome" name="rent" />
                <span class="switch__track"></span><span class="switch__thumb"></span>
                <span class="small">Include rental income</span>
              </label>
              <label class="switch assumption assumption--switch">
                <input type="checkbox" [(ngModel)]="draft.includePlannedExpenses" name="planned" />
                <span class="switch__track"></span><span class="switch__thumb"></span>
                <span class="small">Deduct planned expenses</span>
              </label>
            </div>

            <div class="row" style="justify-content:flex-end; gap:8px; margin-top:14px">
              <button type="button" class="btn btn--ghost btn--sm" (click)="resetDraft()">Reset</button>
              <button type="button" class="btn btn--primary btn--sm" (click)="saveScenario()" [disabled]="store.saving()">
                Save to scenario
              </button>
            </div>
          </sb-section>
        }

        <!-- ------------------------------------------------------- -->
        <div class="horizons">
          @for (horizon of result.horizons; track horizon.years) {
            <article class="horizon">
              <span class="horizon__years">{{ horizon.years }} year{{ horizon.years === 1 ? '' : 's' }}</span>
              <span class="horizon__value">{{ compact(horizon.point.netWorth) }}</span>
              <span class="horizon__label">projected net worth</span>
              <dl class="horizon__parts">
                <div><dt>Cash</dt><dd>{{ compact(horizon.point.cash) }}</dd></div>
                <div><dt>Invested</dt><dd>{{ compact(horizon.point.investments) }}</dd></div>
                <div><dt>Property equity</dt><dd>{{ compact(horizon.point.propertyEquity) }}</dd></div>
              </dl>
            </article>
          }
        </div>

        <!-- ------------------------------------------------------- -->
        <sb-section [title]="activeChart().title" explain="forecast" [subtitle]="activeChart().subtitle">
          <div slot="actions">
            <div class="segmented" role="group" aria-label="Projection">
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
            Projected using {{ pct(scenario()!.investmentReturn * 100) }} annual nominal investment return,
            {{ pct(scenario()!.inflation * 100) }} inflation and {{ pct(scenario()!.cashInterest * 100) }} cash interest.
            Figures are nominal — not adjusted for inflation.
          </p>
        </sb-section>

        <!-- ------------------------------------------------------- -->
        <div class="grid grid--wide-left">
          <sb-section title="Scenario comparison" subtitle="The same starting position under all three sets of assumptions.">
            <sb-line-chart
              [series]="comparisonSeries()"
              [height]="280"
              ariaLabel="Net worth under conservative, base and optimistic scenarios"
            />
            <div class="estimate-note" style="margin-top:14px">
              <span>
                The spread between conservative and optimistic is the honest measure of uncertainty. At
                {{ comparisonHorizon() }} years, that range is
                <strong>{{ compact(comparisonLow()) }} – {{ compact(comparisonHigh()) }}</strong>.
              </span>
            </div>
          </sb-section>

          <sb-section title="Milestones" subtitle="When the model expects key thresholds to be crossed.">
            @if (result.milestones.length) {
              <ol class="milestones">
                @for (milestone of result.milestones; track milestone.label + milestone.monthIndex) {
                  <li class="milestone">
                    <span class="milestone__dot" [class]="'milestone__dot milestone__dot--' + milestone.kind"></span>
                    <div class="col" style="gap:1px; min-width:0">
                      <span class="milestone__label">{{ milestone.label }}</span>
                      <span class="milestone__date">
                        {{ date(milestone.date) }} · month {{ milestone.monthIndex }}
                      </span>
                    </div>
                  </li>
                }
              </ol>
            } @else {
              <sb-empty title="No milestones inside the horizon" text="Try a longer horizon or a higher savings rate." />
            }

            <div class="divider" style="margin:16px 0"></div>

            <dl class="mini-facts">
              <div>
                <dt>Emergency fund complete</dt>
                <dd>{{ result.securityMonth === null ? 'Not inside horizon' : 'Month ' + result.securityMonth }}</dd>
              </div>
              <div>
                <dt>Cash runs out</dt>
                <dd>{{ result.cashRunsOutMonth === null ? 'Never' : 'Month ' + result.cashRunsOutMonth }}</dd>
              </div>
            </dl>
          </sb-section>
        </div>

        <!-- ------------------------------------------------------- -->
        <sb-section title="Assumptions in force" explain="forecast" subtitle="Everything the projection above depends on.">
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr><th>Assumption</th><th>Value</th><th>Note</th></tr>
              </thead>
              <tbody>
                @for (assumption of result.assumptions; track assumption.label) {
                  <tr>
                    <td class="table__primary">{{ assumption.label }}</td>
                    <td class="num">{{ assumption.value }}</td>
                    <td class="secondary">{{ assumption.note ?? '—' }}</td>
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

  /** Editable copy of the scenario, in human units (percent, not fractions). */
  draft = {
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
  };

  readonly scenarios = this.store.scenarios;

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

    return {
      ...base,
      investmentReturn: this.draft.investmentReturn / 100,
      salaryGrowth: this.draft.salaryGrowth / 100,
      inflation: this.draft.inflation / 100,
      cashInterest: this.draft.cashInterest / 100,
      propertyAppreciation: this.draft.propertyAppreciation / 100,
      monthlyInvestment: Number(this.draft.monthlyInvestment),
      monthlyFlexibleSpending: Number(this.draft.monthlyFlexibleSpending),
      horizonYears: Number(this.draft.horizonYears),
      includeRentalIncome: this.draft.includeRentalIncome,
      includePlannedExpenses: this.draft.includePlannedExpenses,
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

  readonly activeChart = computed(() => CHARTS.find((c) => c.key === this.chartKey()) ?? CHARTS[0]);

  readonly projectionSeries = computed<Series[]>(() => {
    const result = this.forecast();
    if (!result) return [];

    const chart = this.activeChart();
    // Sample yearly beyond five years so the line stays readable.
    const points = result.points.filter((p, i) => (result.points.length > 72 ? p.monthIndex % 3 === 0 : true) || i === result.points.length - 1);

    const series: Series[] = [
      {
        key: chart.key,
        name: chart.label,
        color: seriesColor(chart.color),
        area: true,
        points: points.map((p) => ({ label: p.date, value: p[chart.key] })),
      },
    ];

    if (chart.key === 'investments') {
      series.push({
        key: 'contributions',
        name: 'Your contributions',
        color: seriesColor(1),
        dashed: true,
        points: points.map((p) => ({
          label: p.date,
          value: (this.store.portfolio()?.totalContributions ?? 0) + p.contributions,
        })),
      });
    }

    if (chart.key === 'cash') {
      const floor = this.store.data()?.profile.emergencyFundTarget ?? 0;
      series.push({
        key: 'floor',
        name: 'Security floor',
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
        .map((p) => ({ label: p.date, value: p.netWorth })),
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
      .map(({ result }) => result.points[years * 12 - 1]?.netWorth ?? 0)
      .filter((value) => Number.isFinite(value));
  });

  readonly comparisonLow = computed(() => Math.min(...(this.comparisonEndValues().length ? this.comparisonEndValues() : [0])));
  readonly comparisonHigh = computed(() => Math.max(...(this.comparisonEndValues().length ? this.comparisonEndValues() : [0])));

  /* -- assumptions editing --------------------------------------------- */

  constructor() {
    queueMicrotask(() => this.resetDraft());
  }

  resetDraft(): void {
    const scenario = this.scenario();
    if (!scenario) return;
    this.draft = {
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
    };
  }

  async saveScenario(): Promise<void> {
    const scenario = this.scenario();
    if (!scenario) return;
    await this.store.save(
      'forecast_scenarios',
      scenario.id,
      {
        investmentReturn: this.draft.investmentReturn / 100,
        salaryGrowth: this.draft.salaryGrowth / 100,
        inflation: this.draft.inflation / 100,
        cashInterest: this.draft.cashInterest / 100,
        propertyAppreciation: this.draft.propertyAppreciation / 100,
        monthlyInvestment: Number(this.draft.monthlyInvestment),
        monthlyFlexibleSpending: Number(this.draft.monthlyFlexibleSpending),
        horizonYears: Number(this.draft.horizonYears),
        includeRentalIncome: this.draft.includeRentalIncome,
        includePlannedExpenses: this.draft.includePlannedExpenses,
      },
      'Scenario',
    );
  }

  /* -- display ---------------------------------------------------------- */

  compact(value: number): string {
    return this.currency.compact(value);
  }

  pct(value: number): string {
    return this.currency.percent(value, 1);
  }

  date(value: string): string {
    return formatDate(value, this.currency.locale());
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
