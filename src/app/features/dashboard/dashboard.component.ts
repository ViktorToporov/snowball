import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { CurrencyService } from '../../core/money/currency.service';
import { formatDateShort, formatRelative } from '../../core/money/format';
import { FinanceStore } from '../../core/state/finance.store';
import { DonutChartComponent } from '../../shared/charts/donut-chart.component';
import { LineChartComponent } from '../../shared/charts/line-chart.component';
import { Series, seriesColor } from '../../shared/charts/chart-utils';
import { ExplainComponent } from '../../shared/ui/explain.component';
import { StatCardComponent } from '../../shared/ui/stat-card.component';
import {
  EmptyStateComponent,
  MeterComponent,
  SectionComponent,
  SkeletonComponent,
  StatusPillComponent,
} from '../../shared/ui/ui-kit';

@Component({
  selector: 'sb-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    StatCardComponent,
    SectionComponent,
    MeterComponent,
    ExplainComponent,
    StatusPillComponent,
    SkeletonComponent,
    EmptyStateComponent,
    LineChartComponent,
    DonutChartComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="page-head__titles">
          <p class="eyebrow">{{ greeting() }}</p>
          <h1 class="h1">Your financial position</h1>
        </div>
        <div class="page-head__actions">
          <span class="micro muted">{{ today }}</span>
          <button type="button" class="btn btn--ghost btn--sm" (click)="store.refresh()">Refresh</button>
        </div>
      </header>

      @if (store.isLoading()) {
        <div class="grid grid--stats">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="card card--pad" style="min-height:118px"><sb-skeleton [count]="3" /></div>
          }
        </div>
        <div class="card card--pad" style="min-height:320px"><sb-skeleton [count]="6" /></div>
      } @else if (store.state() === 'error') {
        <div class="card">
          <sb-empty icon="error" title="Couldn't load your data" [text]="store.error()">
            <button type="button" class="btn btn--primary btn--sm" (click)="store.refresh()">Try again</button>
          </sb-empty>
        </div>
      } @else if (strategy(); as s) {
        <!-- ============================================================
             1. The answer: am I on plan?
             ============================================================ -->
        <section class="verdict" [class]="'verdict verdict--' + tone()">
          <div class="verdict__main">
            <div class="row row--wrap" style="gap:12px">
              <sb-status-pill [tone]="tone()" [label]="s.headline" />
              @if (s.activePhase) {
                <span class="badge badge--neutral">
                  Phase {{ s.activePhase.phaseOrder }} · {{ s.activePhase.name }}
                </span>
              }
            </div>
            <p class="verdict__text">{{ s.explanation }}</p>

            <div class="verdict__facts">
              <div class="verdict__fact">
                <span class="verdict__fact-label">
                  Available above security floor
                  <sb-explain key="available-above-floor" />
                </span>
                <span class="verdict__fact-value">{{ money(s.availableAboveFloor) }}</span>
                <span class="verdict__fact-note">
                  Not a monthly allowance — this is cash you can deploy without breaching the floor.
                </span>
              </div>
              <div class="verdict__fact">
                <span class="verdict__fact-label">
                  Recent savings rate
                  <sb-explain key="strategy-status" />
                </span>
                <span class="verdict__fact-value">{{ money(s.recentMonthlySaving) }}<span class="verdict__per">/mo</span></span>
                <span class="verdict__fact-note">Average of the last three complete months.</span>
              </div>
              <div class="verdict__fact">
                <span class="verdict__fact-label">Security target reached</span>
                <span class="verdict__fact-value">
                  {{ s.monthsToSecurity === null ? 'Not at this rate' : s.monthsToSecurity === 0 ? 'Complete' : s.monthsToSecurity + ' months' }}
                </span>
                <span class="verdict__fact-note">
                  @if (s.monthsToSecurity === 0) {
                    The floor is now a hard limit — it is not spent back down.
                  } @else if (s.projectedSecurityDate) {
                    Projected {{ relative(s.projectedSecurityDate) }}
                  } @else {
                    Increase monthly saving to set a date.
                  }
                </span>
              </div>
            </div>
          </div>

          <a routerLink="/strategy" class="verdict__cta">
            Review strategy
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 3l4 4-4 4" />
            </svg>
          </a>
        </section>

        <!-- ============================================================
             2. Key statistics
             ============================================================ -->
        <div class="grid grid--stats">
          <sb-stat-card
            label="Net Worth"
            explain="net-worth"
            [value]="netWorth()?.netWorth ?? null"
            [delta]="store.deltas().netWorth"
            [trend]="netWorthTrend()"
            [accent]="true"
            period="this month"
          />
          <sb-stat-card
            label="Liquid Cash"
            explain="liquid-cash"
            [value]="cash()?.liquidTotal ?? null"
            [delta]="store.deltas().cash"
            [trend]="cashTrend()"
            period="this month"
          />
          <sb-stat-card
            label="Investments"
            explain="portfolio-value"
            [value]="portfolio()?.totalValue ?? null"
            [delta]="store.deltas().investments"
            [trend]="portfolioTrend()"
            period="this month"
            [badge]="returnBadge()"
            [badgeTone]="(portfolio()?.unrealisedGain ?? 0) >= 0 ? 'good' : 'bad'"
          />
          <sb-stat-card
            label="Property Equity"
            explain="property-equity"
            [value]="netWorth()?.propertyEquity ?? null"
            [delta]="store.deltas().propertyEquity"
            period="this month"
            [caption]="propertyCaption()"
          />
        </div>

        <div class="grid grid--stats">
          <sb-stat-card
            label="Monthly Income"
            explain="monthly-income"
            [value]="income()?.monthlyRecurring ?? null"
            [delta]="store.deltas().income"
            [trend]="incomeTrend()"
            period="vs last month"
          />
          <sb-stat-card
            label="Essential Expenses"
            explain="essential-expenses"
            [value]="store.essentialExpenses()"
            [delta]="store.deltas().essential"
            [invertDelta]="true"
            period="vs last month"
            [caption]="essentialCaption()"
          />
          <sb-stat-card
            label="Financial Security"
            explain="security-score"
            [value]="security()?.score ?? null"
            format="percent"
            [caption]="securityCaption()"
            [badge]="security()?.band ?? null"
            [badgeTone]="securityBadgeTone()"
          />
          <sb-stat-card
            label="Portfolio Return"
            explain="portfolio-return"
            [value]="portfolio()?.totalReturnPercent ?? null"
            format="percent"
            [delta]="portfolio()?.unrealisedGain ?? null"
            period="unrealised"
            [caption]="returnCaption()"
          />
        </div>

        <!-- ============================================================
             3. Financial security
             ============================================================ -->
        <div class="grid grid--wide-left">
          <sb-section
            title="Financial Security"
            explain="security-score"
            subtitle="Liquid cash held against your emergency fund target."
          >
            <div slot="actions">
              <a routerLink="/cash-flow" class="btn btn--ghost btn--sm">Manage cash</a>
            </div>

            <div class="security">
              <div class="security__headline">
                <div class="security__figure">
                  <span class="security__amount">{{ money(cash()!.emergencyBalance) }}</span>
                  <span class="security__target">/ {{ money(cash()!.emergencyTarget) }}</span>
                </div>
                <span class="security__percent">{{ Math.round(cash()!.emergencyProgress) }}% secured</span>
              </div>

              <sb-meter
                [value]="cash()!.emergencyProgress"
                [showValue]="false"
                [large]="true"
                [tone]="cash()!.emergencyProgress >= 100 ? 'good' : cash()!.emergencyProgress >= 50 ? 'brand' : 'warn'"
              />

              <p class="security__runway">
                @if (security()?.monthsOfRunway !== null && security()?.monthsOfRunway !== undefined) {
                  <strong>{{ security()!.monthsOfRunway }} months</strong> of essential expenses covered
                } @else {
                  Add recurring essential expenses to calculate your runway.
                }
              </p>

              <ul class="factors">
                @for (factor of security()!.factors; track factor.key) {
                  <li class="factor">
                    <div class="factor__head">
                      <span class="factor__label">{{ factor.label }}</span>
                      <span class="factor__weight">{{ Math.round(factor.score * factor.weight) }}/{{ factor.weight }}</span>
                    </div>
                    <sb-meter
                      [value]="factor.score * 100"
                      [showValue]="false"
                      [tone]="factor.score >= 0.8 ? 'good' : factor.score >= 0.4 ? 'brand' : 'warn'"
                    />
                    <span class="factor__detail">{{ factor.detail }}</span>
                  </li>
                }
              </ul>
            </div>
          </sb-section>

          <sb-section title="Next goal" [subtitle]="nextGoal() ? nextGoal()!.goal.name : 'No active goals'">
            @if (nextGoal(); as g) {
              <div class="col" style="gap:18px">
                <div class="goal-focus">
                  <span class="goal-focus__value">{{ money(g.currentAmount) }}</span>
                  <span class="goal-focus__target">of {{ money(g.goal.targetAmount) }}</span>
                </div>
                <sb-meter
                  [value]="g.progress"
                  [valueText]="Math.round(g.progress) + '%'"
                  label="Progress"
                  [large]="true"
                />
                <dl class="mini-facts">
                  <div>
                    <dt>Remaining</dt>
                    <dd>{{ money(g.remaining) }}</dd>
                  </div>
                  <div>
                    <dt>Needed monthly</dt>
                    <dd>{{ g.requiredMonthly === null ? '—' : money(g.requiredMonthly) }}</dd>
                  </div>
                  <div>
                    <dt>Target date</dt>
                    <dd>{{ g.goal.targetDate ? relative(g.goal.targetDate) : 'Open-ended' }}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <span class="badge" [class]="g.onTrack ? 'badge badge--good' : 'badge badge--warn'">
                        {{ g.onTrack ? 'On track' : 'Behind' }}
                      </span>
                    </dd>
                  </div>
                </dl>
                <a routerLink="/goals" class="btn btn--ghost btn--sm btn--block">All goals</a>
              </div>
            } @else {
              <sb-empty title="No goals yet" text="Add a goal to see progress here.">
                <a routerLink="/goals" class="btn btn--primary btn--sm">Add a goal</a>
              </sb-empty>
            }
          </sb-section>
        </div>

        <!-- ============================================================
             4. Trends
             ============================================================ -->
        <div class="grid grid--wide-left">
          <sb-section title="Net worth over time" explain="net-worth" subtitle="Assets minus liabilities, month by month.">
            @if (netWorthSeries().length) {
              <sb-line-chart
                [series]="netWorthSeries()"
                [height]="270"
                ariaLabel="Net worth over time"
              />
            } @else {
              <sb-empty title="No history yet" text="Snapshots appear as your accounts are updated." />
            }
          </sb-section>

          <sb-section title="Where your money sits" subtitle="Assets by class, at current values.">
            <sb-donut-chart [data]="assetMix()" centerLabel="Assets" [stacked]="true" ariaLabel="Asset mix" />
          </sb-section>
        </div>

        <div class="grid grid--wide-right">
          <sb-section title="Liquid cash" subtitle="Total across accounts that count as liquid.">
            @if (cashSeries().length) {
              <sb-line-chart [series]="cashSeries()" [height]="220" ariaLabel="Liquid cash over time" />
            } @else {
              <sb-empty title="No cash history" text="Balances will chart here over time." />
            }
          </sb-section>

          <sb-section
            title="Upcoming"
            subtitle="Money events in the next four months."
          >
            <div slot="actions">
              <a routerLink="/goals" class="btn btn--quiet btn--sm">Plan expenses</a>
            </div>

            @if (store.timeline().length) {
              <ol class="timeline">
                @for (event of store.timeline(); track event.date + event.title) {
                  <li class="timeline__item">
                    <div class="timeline__rail">
                      <span class="timeline__dot" [class]="'timeline__dot timeline__dot--' + event.direction"></span>
                    </div>
                    <div class="timeline__body">
                      <div class="row row--between" style="gap:12px; align-items:baseline">
                        <span class="timeline__title">{{ event.title }}</span>
                        @if (event.amount !== null) {
                          <span class="timeline__amount num" [class.pos]="event.amount > 0" [class.neg]="event.amount < 0">
                            {{ money(event.amount, true) }}
                          </span>
                        }
                      </div>
                      <div class="row" style="gap:8px">
                        <span class="timeline__date">{{ short(event.date) }}</span>
                        <span class="timeline__detail truncate">{{ event.detail }}</span>
                      </div>
                    </div>
                  </li>
                }
              </ol>
            } @else {
              <sb-empty title="Nothing scheduled" text="Planned expenses and goal dates show up here." />
            }
          </sb-section>
        </div>

        <!-- ============================================================
             5. Attention
             ============================================================ -->
        @if (strategy()!.signals.length) {
          <sb-section title="What needs your attention" subtitle="Derived from your strategy rules and recent behaviour.">
            <ul class="signals">
              @for (signal of strategy()!.signals; track signal.title) {
                <li class="signal" [class]="'signal signal--' + signal.tone">
                  <span class="signal__mark" aria-hidden="true"></span>
                  <div>
                    <p class="signal__title">{{ signal.title }}</p>
                    <p class="signal__detail">{{ signal.detail }}</p>
                  </div>
                </li>
              }
            </ul>
          </sb-section>
        }
      }
    </div>
  `,
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  readonly store = inject(FinanceStore);
  private readonly currency = inject(CurrencyService);

  readonly Math = Math;
  readonly today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  readonly cash = this.store.cash;
  readonly netWorth = this.store.netWorth;
  readonly portfolio = this.store.portfolio;
  readonly income = this.store.income;
  readonly security = this.store.security;
  readonly strategy = this.store.strategy;

  readonly greeting = computed(() => {
    const hour = new Date().getHours();
    const name = this.store.profile()?.displayName?.split(' ')[0] ?? '';
    const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    return name ? `${part}, ${name}` : part;
  });

  readonly tone = computed(() => {
    const status = this.strategy()?.status;
    if (status === 'ahead' || status === 'on-track') return 'good' as const;
    if (status === 'attention') return 'warn' as const;
    if (status === 'off-track') return 'bad' as const;
    return 'info' as const;
  });

  /* -- trends for the stat tiles ------------------------------------ */

  private readonly snapshots = computed(() => this.store.data()?.netWorthSnapshots ?? []);

  readonly netWorthTrend = computed(() => this.snapshots().slice(-12).map((s) => s.netWorth));
  readonly cashTrend = computed(() => this.snapshots().slice(-12).map((s) => s.cashValue));
  readonly portfolioTrend = computed(() =>
    (this.store.data()?.portfolioSnapshots ?? []).slice(-12).map((s) => s.totalValue),
  );
  // Complete months only: a part-paid current month would read as a crash.
  readonly incomeTrend = computed(() => (this.income()?.completeHistory ?? []).slice(-12).map((h) => h.net));

  /* -- charts -------------------------------------------------------- */

  readonly netWorthSeries = computed<Series[]>(() => {
    const snapshots = this.snapshots();
    if (!snapshots.length) return [];
    return [
      {
        key: 'net-worth',
        name: 'Net worth',
        color: seriesColor(0),
        area: true,
        points: snapshots.map((s) => ({ label: s.snapshotDate, value: s.netWorth })),
      },
    ];
  });

  readonly cashSeries = computed<Series[]>(() => {
    const history = this.store.cashHistory();
    if (!history.length) return [];
    return [
      {
        key: 'cash',
        name: 'Liquid cash',
        color: seriesColor(2),
        area: true,
        points: history.map((point) => ({ label: point.date, value: point.value })),
      },
    ];
  });

  readonly assetMix = computed(() => {
    const netWorth = this.netWorth();
    if (!netWorth) return [];
    return netWorth.components
      .filter((component) => component.kind === 'asset' && component.value > 0)
      .map((component) => ({ label: component.label, value: component.value }));
  });

  /* -- captions ------------------------------------------------------ */

  readonly nextGoal = computed(() => {
    const active = this.store.goals().filter((g) => g.goal.status === 'active' && g.progress < 100);
    return active[0] ?? null;
  });

  readonly returnBadge = computed(() => {
    const portfolio = this.portfolio();
    if (!portfolio || portfolio.totalCost === 0) return null;
    return this.currency.percent(portfolio.totalReturnPercent, 1, true);
  });

  readonly returnCaption = computed(() => {
    const portfolio = this.portfolio();
    if (!portfolio) return null;
    return `${this.money(portfolio.totalCost)} invested · ${this.money(portfolio.totalValue)} today`;
  });

  readonly propertyCaption = computed(() => {
    const properties = this.store.properties();
    if (!properties.length) return 'No property recorded';
    const ltv = properties[0].loanToValue;
    return `${Math.round(ltv)}% loan-to-value · ${properties.length} propert${properties.length === 1 ? 'y' : 'ies'}`;
  });

  readonly essentialCaption = computed(() => {
    const income = this.income()?.monthlyRecurring ?? 0;
    const essential = this.store.essentialExpenses();
    if (income <= 0) return null;
    return `${Math.round((essential / income) * 100)}% of income · ${this.money(income - essential)} uncommitted`;
  });

  readonly securityCaption = computed(() => {
    const score = this.security();
    if (!score) return null;
    return score.monthsOfRunway !== null
      ? `${score.monthsOfRunway} months of essential expenses covered`
      : 'Composite of five factors';
  });

  readonly securityBadgeTone = computed(() => {
    const band = this.security()?.band;
    if (band === 'secure') return 'good' as const;
    if (band === 'solid') return 'brand' as const;
    if (band === 'building') return 'warn' as const;
    return 'bad' as const;
  });

  /* -- formatting ---------------------------------------------------- */

  money(value: number | null, signed = false): string {
    return this.currency.format(value, { signed, decimals: Math.abs(value ?? 0) >= 10000 ? 0 : undefined });
  }

  relative(date: string): string {
    return formatRelative(date, this.currency.locale());
  }

  short(date: string): string {
    return formatDateShort(date, this.currency.locale());
  }
}
