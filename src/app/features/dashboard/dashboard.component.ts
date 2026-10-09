import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SecurityFactor } from '../../core/engine/metrics';
import { CurrencyService } from '../../core/money/currency.service';
import { formatDateShort, formatRelative } from '../../core/money/format';
import { FinanceStore } from '../../core/state/finance.store';
import { DonutChartComponent } from '../../shared/charts/donut-chart.component';
import { LineChartComponent } from '../../shared/charts/line-chart.component';
import { Series, seriesColor } from '../../shared/charts/chart-utils';
import { ExplainComponent } from '../../shared/ui/explain.component';
import { humanize } from '../../shared/ui/humanize.pipe';
import { StatCardComponent } from '../../shared/ui/stat-card.component';
import { NetWorthSplitComponent } from '../../shared/ui/net-worth-split.component';
import {
  EmptyStateComponent,
  MeterComponent,
  SectionComponent,
  SkeletonComponent,
  StatusPillComponent,
} from '../../shared/ui/ui-kit';

/** Remembers whether the user opened "Show details". */
const DETAILS_KEY = 'snowball.dashboard-details';

/** Plain-language names for the safety-score factors. */
const FACTOR_LABELS: Record<string, string> = {
  emergency: 'Safety cushion',
  runway: 'Months you could live on savings',
  savings: 'Left over after bills',
  debt: 'Debts besides a mortgage',
  liquidity: 'Cash you can use now',
};

@Component({
  selector: 'sb-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    NetWorthSplitComponent,
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
          <h1 class="h1">Your money at a glance</h1>
          @if (updatedText(); as text) {
            <p class="small updated" [class.updated--stale]="stale()">{{ text }}</p>
          }
        </div>
        <div class="page-head__actions">
          <span class="micro muted">{{ today }}</span>
          <button type="button" class="btn btn--ghost btn--sm" (click)="store.refresh()">Refresh</button>
        </div>
      </header>

      @if (store.isLoading()) {
        <div class="grid grid--stats">
          @for (i of [1, 2, 3]; track i) {
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
             1. The answer: how am I doing?
             ============================================================ -->
        <section class="verdict" [class]="'verdict verdict--' + tone()">
          <div class="verdict__main">
            <div class="row row--wrap" style="gap:12px">
              <sb-status-pill [tone]="tone()" [label]="s.headline" />
              @if (stageLabel(); as stage) {
                <span class="badge badge--neutral">{{ stage }}</span>
              }
            </div>
            <p class="verdict__text">{{ s.explanation }}</p>

            @if (s.status !== 'getting-started') {
              <div class="verdict__facts">
                <div class="verdict__fact">
                  <span class="verdict__fact-label">
                    Free to spend or invest
                    <sb-explain key="available-above-floor" />
                  </span>
                  <span class="verdict__fact-value">{{ money(s.availableAboveFloor) }}</span>
                  <span class="verdict__fact-note">
                    After your safety cushion and bills due in the next 3 months. A one-off amount, not a monthly allowance.
                  </span>
                </div>
                <div class="verdict__fact">
                  <span class="verdict__fact-label">
                    Saved per month
                    <sb-explain key="savings-rate" />
                  </span>
                  <span class="verdict__fact-value">{{ money(s.recentMonthlySaving) }}<span class="verdict__per">/mo</span></span>
                  <span class="verdict__fact-note">Average of the last 3 complete months.</span>
                </div>
                <div class="verdict__fact">
                  <span class="verdict__fact-label">Safety cushion full</span>
                  <span class="verdict__fact-value">
                    {{ s.monthsToSecurity === null ? 'Not at this rate' : s.monthsToSecurity === 0 ? 'Already full' : 'In ' + s.monthsToSecurity + ' months' }}
                  </span>
                  <span class="verdict__fact-note">
                    @if (s.monthsToSecurity === 0) {
                      Keep this money set aside — it's for emergencies, not for spending.
                    } @else if (s.projectedSecurityDate) {
                      Around {{ relative(s.projectedSecurityDate) }} at your current pace.
                    } @else {
                      Saving a little each month will give you a date.
                    }
                  </span>
                </div>
              </div>
            }
          </div>

          @if (store.checkInDue()) {
            <a routerLink="/check-in" class="verdict__cta verdict__cta--primary">
              Do your monthly check-in
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M5 3l4 4-4 4" />
              </svg>
            </a>
          } @else {
            <a routerLink="/strategy" class="verdict__cta">
              See my plan
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M5 3l4 4-4 4" />
              </svg>
            </a>
          }
        </section>

        <!-- ============================================================
             2. First run: what to set up next
             ============================================================ -->
        @if (!store.setupComplete() && store.setupSteps().length) {
          <section class="card card--pad setup" aria-labelledby="setup-title">
            <div class="row row--between row--wrap" style="gap:12px">
              <div>
                <h2 class="h2" id="setup-title">Get set up</h2>
                <p class="small muted">A few things so Snowball can work out where you stand.</p>
              </div>
              <span class="badge badge--brand">{{ setupDone() }} of {{ store.setupSteps().length }} done</span>
            </div>
            <sb-meter
              [value]="(setupDone() / store.setupSteps().length) * 100"
              [showValue]="false"
              tone="brand"
            />
            <ol class="setup__list">
              @for (step of store.setupSteps(); track step.key) {
                <li class="setup__step" [class.is-done]="step.done">
                  <span class="setup__check" aria-hidden="true">
                    @if (step.done) {
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M2.5 6.2l2.3 2.3 4.7-5" />
                      </svg>
                    }
                  </span>
                  <div class="setup__body">
                    <p class="setup__label">
                      {{ step.label }}
                      <span class="sr-only">{{ step.done ? '(done)' : '(to do)' }}</span>
                    </p>
                    @if (!step.done) {
                      <p class="small muted">{{ step.hint }}</p>
                    }
                  </div>
                  @if (!step.done) {
                    <a [routerLink]="step.route" [queryParams]="step.queryParams" class="btn btn--ghost btn--sm">Start</a>
                  }
                </li>
              }
            </ol>
          </section>
        } @else if (store.checkInDue()) {
          <section class="card card--pad checkin-due">
            <div>
              <h2 class="h2">Time for your monthly check-in</h2>
              <p class="small muted">
                Confirm your balances and pay so Snowball can work out what you spent. Takes about 2 minutes.
              </p>
            </div>
            <a routerLink="/check-in" class="btn btn--primary">Start check-in</a>
          </section>
        }

        @if (hasMoney()) {
          <!-- ============================================================
               3. The three numbers that matter
               ============================================================ -->
          <div class="grid grid--stats">
            <sb-stat-card
              label="Net worth"
              explain="net-worth"
              hint="Everything you own minus everything you owe"
              [value]="netWorth()?.netWorth ?? null"
              [delta]="store.deltas().netWorth"
              [trend]="netWorthTrend()"
              [accent]="true"
              period="this month"
            >
              @if (netWorth(); as nw) {
                <sb-net-worth-split class="nw-split" [parts]="nw.split" />
              }
            </sb-stat-card>
            <sb-stat-card
              label="Cash you can use now"
              explain="liquid-cash"
              hint="In accounts you can get at today"
              [value]="cash()?.liquidTotal ?? null"
              [delta]="store.deltas().cash"
              [trend]="cashTrend()"
              period="this month"
            />
            <sb-stat-card
              label="Months you could live on savings"
              explain="runway"
              hint="If your pay stopped, covering your fixed bills"
              format="raw"
              [value]="security()?.monthsOfRunway ?? null"
              [rawValue]="runwayText()"
              [caption]="runwayCaption()"
            />
          </div>

          <!-- ============================================================
               4. Safety cushion and next goal
               ============================================================ -->
          <div class="grid grid--wide-left">
            <sb-section
              title="Safety cushion"
              explain="emergency-fund"
              subtitle="Money set aside for emergencies."
            >
              <div slot="actions">
                <a routerLink="/cash-flow" class="btn btn--ghost btn--sm">Manage accounts</a>
              </div>

              @if (cash(); as c) {
                @if (c.emergencyTarget > 0) {
                  <div class="security">
                    <div class="security__headline">
                      <div class="security__figure">
                        <span class="security__amount">{{ money(c.emergencyBalance) }}</span>
                        <span class="security__target">of {{ money(c.emergencyTarget) }}</span>
                      </div>
                      <span class="security__percent">Safety cushion {{ Math.round(c.emergencyProgress) }}% full</span>
                    </div>

                    <sb-meter
                      [value]="c.emergencyProgress"
                      [showValue]="false"
                      [large]="true"
                      [tone]="c.emergencyProgress >= 100 ? 'good' : c.emergencyProgress >= 50 ? 'brand' : 'warn'"
                    />

                    <p class="security__runway">
                      @if (c.emergencyShortfall > 0) {
                        <strong>{{ money(c.emergencyShortfall) }}</strong> still to go.
                      } @else {
                        Your safety cushion is full. Nice work.
                      }
                    </p>
                  </div>
                } @else {
                  <sb-empty
                    title="No safety cushion set yet"
                    text="Decide how much to keep aside for emergencies. Three to six months of bills is a common rule of thumb."
                  >
                    <a routerLink="/settings" class="btn btn--primary btn--sm">Set my safety cushion</a>
                  </sb-empty>
                }
              }
            </sb-section>

            <sb-section title="Next goal" [subtitle]="nextGoalName()">
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
                      <dt>Still to save</dt>
                      <dd>{{ money(g.remaining) }}</dd>
                    </div>
                    <div>
                      <dt>Needed per month</dt>
                      <dd>{{ g.requiredMonthly === null ? '—' : money(g.requiredMonthly) }}</dd>
                    </div>
                    <div>
                      <dt>Target date</dt>
                      <dd>{{ g.goal.targetDate ? relative(g.goal.targetDate) : 'No date set' }}</dd>
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
                <sb-empty title="No goals yet" text="Saving for a holiday, a car or a deposit? Add it as a goal.">
                  <a routerLink="/goals" class="btn btn--primary btn--sm">Add a goal</a>
                </sb-empty>
              }
            </sb-section>
          </div>

          <!-- ============================================================
               5. Trend and what's coming up
               ============================================================ -->
          <div class="grid grid--wide-left">
            <sb-section title="Net worth over time" explain="net-worth" subtitle="Everything you own minus everything you owe, month by month.">
              @if ((netWorthSeries()[0]?.points?.length ?? 0) > 1) {
                <sb-line-chart
                  [series]="netWorthSeries()"
                  [height]="270"
                  ariaLabel="Net worth over time"
                />
              } @else {
                <sb-empty title="Your history starts here" text="Each monthly check-in adds a point to this chart." />
              }
            </sb-section>

            <sb-section title="Coming up" subtitle="Money events in the next four months.">
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
                <sb-empty title="Nothing coming up" text="Big expenses you plan for and goal dates show up here." />
              }
            </sb-section>
          </div>

          <!-- ============================================================
               6. Things we noticed
               ============================================================ -->
          @if (s.signals.length) {
            <sb-section title="Things we noticed" subtitle="Based on your plan and your recent months.">
              <ul class="signals">
                @for (signal of s.signals; track signal.title) {
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

          <!-- ============================================================
               7. Everything else, on request
               ============================================================ -->
          <div class="details-toggle">
            <button
              type="button"
              class="btn btn--ghost"
              [attr.aria-expanded]="showDetails()"
              aria-controls="dashboard-details"
              (click)="toggleDetails()"
            >
              {{ showDetails() ? 'Hide details' : 'Show details' }}
              <svg class="details-toggle__chev" [class.is-open]="showDetails()" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 5l4 4 4-4" />
              </svg>
            </button>
          </div>

          @if (showDetails()) {
            <div id="dashboard-details" class="col" style="gap:24px">
              <div class="grid grid--stats">
                <sb-stat-card
                  label="Monthly income"
                  explain="monthly-income"
                  hint="Your regular take-home pay, per month"
                  [value]="income()?.monthlyRecurring ?? null"
                  [delta]="store.deltas().income"
                  [trend]="incomeTrend()"
                  period="vs last month"
                  [caption]="(income()?.monthlyRecurring ?? 0) > 0 ? null : 'Add your income to see this'"
                />
                <sb-stat-card
                  label="Fixed monthly bills"
                  explain="essential-expenses"
                  hint="Rent, utilities, insurance, subscriptions"
                  [value]="store.essentialExpenses()"
                  [delta]="store.deltas().essential"
                  [invertDelta]="true"
                  period="vs last month"
                  [caption]="essentialCaption()"
                />
                <sb-stat-card
                  label="Safety score"
                  explain="security-score"
                  hint="How well you could handle a money shock"
                  format="raw"
                  [value]="security()?.score ?? null"
                  [rawValue]="scoreText()"
                  [badge]="bandLabel()"
                  [badgeTone]="securityBadgeTone()"
                />
                @if (hasInvestments()) {
                  <sb-stat-card
                    label="Investments"
                    explain="portfolio-value"
                    hint="What your investments are worth today"
                    [value]="portfolio()?.totalValue ?? null"
                    [delta]="store.deltas().investments"
                    [trend]="portfolioTrend()"
                    period="this month"
                    [badge]="returnBadge()"
                    [badgeTone]="(portfolio()?.unrealisedGain ?? 0) >= 0 ? 'good' : 'bad'"
                    [caption]="returnCaption()"
                  />
                }
                @if (hasProperty()) {
                  <sb-stat-card
                    label="Your share of property"
                    explain="property-equity"
                    hint="Home value minus what's still owed"
                    [value]="netWorth()?.propertyEquity ?? null"
                    [delta]="store.deltas().propertyEquity"
                    period="this month"
                    [caption]="propertyCaption()"
                  />
                }
              </div>

              @if (security(); as score) {
                <sb-section
                  title="What makes up your safety score"
                  explain="security-score"
                  [subtitle]="scoreText() + ' · ' + bandLabel()"
                >
                  <ul class="factors factors--flat">
                    @for (factor of score.factors; track factor.key) {
                      <li class="factor">
                        <div class="factor__head">
                          <span class="factor__label">{{ factorLabel(factor) }}</span>
                          <span class="factor__weight">{{ Math.round(factor.score * factor.weight) }} of {{ factor.weight }} points</span>
                        </div>
                        <sb-meter
                          [value]="factor.score * 100"
                          [showValue]="false"
                          [tone]="factor.score >= 0.8 ? 'good' : factor.score >= 0.4 ? 'brand' : 'warn'"
                        />
                        <span class="factor__detail">{{ factorDetail(factor) }}</span>
                      </li>
                    }
                  </ul>
                </sb-section>
              }

              <div class="grid grid--wide-right">
                <sb-section title="Where your money sits" subtitle="What you own, by type, at today's values.">
                  @if (assetMix().length) {
                    <sb-donut-chart [data]="assetMix()" centerLabel="You own" [stacked]="true" ariaLabel="What you own, by type" />
                  } @else {
                    <sb-empty title="Nothing to show yet" text="Add an account with money in it to see how your money is spread." />
                  }
                </sb-section>

                <sb-section title="Cash you can use now, over time" subtitle="Total across accounts you can get at today.">
                  @if (cashSeries().length && cashSeries()[0].points.length > 1) {
                    <sb-line-chart [series]="cashSeries()" [height]="220" ariaLabel="Cash you can use now, over time" />
                  } @else {
                    <sb-empty title="Your history starts here" text="Each monthly check-in adds a point to this chart." />
                  }
                </sb-section>
              </div>
            </div>
          }
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

  readonly showDetails = signal(readDetailsPref());

  toggleDetails(): void {
    const next = !this.showDetails();
    this.showDetails.set(next);
    try {
      localStorage.setItem(DETAILS_KEY, next ? '1' : '0');
    } catch {
      // Storage unavailable (private mode) — the choice just isn't remembered.
    }
  }

  readonly greeting = computed(() => {
    const hour = new Date().getHours();
    const name = this.store.profile()?.displayName?.split(' ')[0] ?? '';
    const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    return name ? `${part}, ${name}` : part;
  });

  /** Getting started is never alarming — and nothing on the Overview is red. */
  readonly tone = computed(() => {
    const status = this.strategy()?.status;
    if (status === 'ahead' || status === 'on-track') return 'good' as const;
    if (status === 'attention') return 'warn' as const;
    if (status === 'off-track') return 'bad' as const;
    return 'info' as const;
  });

  readonly stageLabel = computed(() => {
    const phase = this.strategy()?.activePhase;
    if (!phase) return null;
    const name = /financial security|emergency/i.test(phase.name) ? 'Build your safety cushion' : phase.name;
    return `Stage ${phase.phaseOrder}: ${name}`;
  });

  /* -- what the user has --------------------------------------------- */

  /** Anything at all recorded that has a value — otherwise the numbers are all €0. */
  readonly hasMoney = computed(() => {
    const data = this.store.data();
    if (!data) return false;
    return (
      data.accounts.some((a) => !a.isArchived) ||
      data.investments.length > 0 ||
      data.properties.length > 0 ||
      data.otherAssets.length > 0 ||
      data.liabilities.length > 0
    );
  });

  readonly hasInvestments = computed(() => (this.store.data()?.investments.length ?? 0) > 0);
  readonly hasProperty = computed(() => (this.store.data()?.properties.length ?? 0) > 0);

  readonly setupDone = computed(() => this.store.setupSteps().filter((s) => s.done).length);

  /* -- freshness ------------------------------------------------------ */

  readonly stale = computed(() => (this.store.daysSinceUpdate() ?? 0) > 35);

  readonly updatedText = computed(() => {
    if (!this.store.data()?.accounts.some((a) => !a.isArchived)) return null;
    const days = this.store.daysSinceUpdate();
    if (days === null) return 'Balances not checked in yet';
    if (days === 0) return 'Balances last updated today';
    if (days === 1) return 'Balances last updated yesterday';
    return `Balances last updated ${days} days ago`;
  });

  /* -- trends for the stat tiles ------------------------------------ */

  private readonly snapshots = computed(() => this.store.data()?.netWorthSnapshots ?? []);

  readonly netWorthTrend = computed(() => this.snapshots().slice(-12).map((s) => s.netWorth));
  readonly cashTrend = computed(() => this.store.cashHistory().slice(-12).map((p) => p.value));
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
        name: 'Cash you can use now',
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

  readonly nextGoalName = computed(() => this.nextGoal()?.goal.name ?? 'No active goals');

  readonly runwayText = computed(() => {
    const months = this.security()?.monthsOfRunway;
    if (months === null || months === undefined) return '—';
    const rounded = months >= 10 ? Math.round(months) : Math.round(months * 10) / 10;
    return `${rounded.toLocaleString(this.currency.locale())} month${rounded === 1 ? '' : 's'}`;
  });

  readonly runwayCaption = computed(() => {
    const months = this.security()?.monthsOfRunway;
    if (months === null || months === undefined) return 'Add your fixed monthly bills to see this';
    if (months < 3) return 'Three to six months is a common aim';
    return 'From your safety cushion savings';
  });

  readonly scoreText = computed(() => {
    const score = this.security()?.score;
    return score === undefined ? '—' : `${Math.round(score)} / 100`;
  });

  readonly bandLabel = computed(() => humanize(this.security()?.band ?? null));

  readonly returnBadge = computed(() => {
    const portfolio = this.portfolio();
    if (!portfolio || portfolio.totalCost === 0) return null;
    return this.currency.percent(portfolio.totalReturnPercent, 1, true);
  });

  readonly returnCaption = computed(() => {
    const portfolio = this.portfolio();
    if (!portfolio || portfolio.totalCost === 0) return null;
    return `You put in ${this.money(portfolio.totalCost)}`;
  });

  readonly propertyCaption = computed(() => {
    const netWorth = this.netWorth();
    if (!netWorth || netWorth.propertyValue <= 0) return null;
    const owed = Math.max(0, netWorth.propertyValue - netWorth.propertyEquity);
    if (owed <= 0) return 'Nothing owed';
    return `Still owed: ${Math.round((owed / netWorth.propertyValue) * 100)}% of the value`;
  });

  readonly essentialCaption = computed(() => {
    const income = this.income()?.monthlyRecurring ?? 0;
    const essential = this.store.essentialExpenses();
    if (essential <= 0) return 'Add your fixed bills to see this';
    if (income <= 0) return null;
    return `${Math.round((essential / income) * 100)}% of your pay · ${this.money(income - essential)} left over`;
  });

  readonly securityBadgeTone = computed(() => {
    const band = this.security()?.band;
    if (band === 'secure') return 'good' as const;
    if (band === 'solid') return 'brand' as const;
    return 'warn' as const;
  });

  factorLabel(factor: SecurityFactor): string {
    return FACTOR_LABELS[factor.key] ?? factor.label;
  }

  /** The factor details in plain words; the score itself comes from the store. */
  factorDetail(factor: SecurityFactor): string {
    const cash = this.cash();
    const income = this.income()?.monthlyRecurring ?? 0;
    const essential = this.store.essentialExpenses();
    const netWorth = this.netWorth()?.netWorth ?? 0;
    switch (factor.key) {
      case 'emergency':
        return cash && cash.emergencyTarget > 0
          ? `${Math.round(cash.emergencyProgress)}% full`
          : 'No safety cushion set yet';
      case 'runway':
        return this.security()?.monthsOfRunway == null ? 'Add your fixed monthly bills' : this.runwayText();
      case 'savings':
        return income > 0
          ? `${Math.round(((income - essential) / income) * 100)}% of your pay is left over after bills`
          : 'Add your income';
      case 'debt':
        return factor.detail.startsWith('No') ? 'No debts besides a mortgage' : 'You have debts besides a mortgage';
      case 'liquidity':
        return netWorth > 0 && cash
          ? `${Math.round((cash.liquidTotal / netWorth) * 100)}% of your net worth is cash you can use now`
          : 'Not enough to work out yet';
      default:
        return factor.detail;
    }
  }

  /* -- formatting ---------------------------------------------------- */

  /** Whole units — cents are noise on an overview. */
  money(value: number | null, signed = false): string {
    return this.currency.format(value, { signed, decimals: 0 });
  }

  relative(date: string): string {
    return formatRelative(date, this.currency.locale());
  }

  short(date: string): string {
    return formatDateShort(date, this.currency.locale());
  }
}

function readDetailsPref(): boolean {
  try {
    return localStorage.getItem(DETAILS_KEY) === '1';
  } catch {
    return false;
  }
}
