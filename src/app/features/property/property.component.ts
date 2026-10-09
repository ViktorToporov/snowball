import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { CurrencyService } from '../../core/money/currency.service';
import { formatRelative } from '../../core/money/format';
import { Property, RentalStatus } from '../../core/models/domain.models';
import { PropertyMetrics, WaterfallStep, monthlyRentPaid, propertyPortfolio } from '../../core/engine/metrics';
import { FinanceStore } from '../../core/state/finance.store';
import { ViewPrefsService } from '../../core/ui/view-prefs.service';
import { Series, seriesColor } from '../../shared/charts/chart-utils';
import { LineChartComponent } from '../../shared/charts/line-chart.component';
import { DialogDirective } from '../../shared/ui/dialog.directive';
import { ExplainComponent } from '../../shared/ui/explain.component';
import { StatCardComponent } from '../../shared/ui/stat-card.component';
import {
  AdvancedToggleComponent,
  ConfirmDialogComponent,
  EmptyStateComponent,
  MeterComponent,
  SectionComponent,
  SkeletonComponent,
} from '../../shared/ui/ui-kit';

const STATUSES: Array<{ value: RentalStatus; label: string }> = [
  { value: 'owner_occupied', label: 'I live here' },
  { value: 'rented', label: 'Rented out' },
  { value: 'listed', label: 'Looking for a tenant' },
  { value: 'vacant', label: 'Empty' },
];

@Component({
  selector: 'sb-property',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    StatCardComponent,
    SectionComponent,
    MeterComponent,
    ExplainComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ConfirmDialogComponent,
    AdvancedToggleComponent,
    DialogDirective,
    LineChartComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="page-head__titles">
          <p class="eyebrow">Homes you own</p>
          <h1 class="h1">Property</h1>
        </div>
        <div class="page-head__actions">
          @if (store.properties().length) {
            <sb-advanced-toggle />
          }
          <button type="button" class="btn btn--primary btn--sm" (click)="openEditor()">Add property</button>
        </div>
      </header>

      @if (store.isLoading()) {
        <div class="card card--pad"><sb-skeleton [count]="6" /></div>
      } @else if (!store.properties().length) {
        <!-- ========================================================
             Nothing owned — most people rent, and that is fine
             ======================================================== -->
        <section class="housing housing--single">
          <div class="housing__side">
            <p class="eyebrow">Where you live</p>
            @if (rentPaid() > 0) {
              <p class="housing__headline">Renting</p>
              <p class="housing__amount">{{ money(rentPaid()) }}<span class="housing__per">/month in rent</span></p>
              <p class="housing__note">
                Renting is completely normal. Your rent is counted as one of your fixed monthly bills, so it is
                already part of your plan. This page is for homes you <strong>own</strong> — the one you live in, or
                one you rent out to someone else.
              </p>
            } @else {
              <p class="housing__headline">Nothing recorded yet</p>
              <p class="housing__note">
                This page is for homes you <strong>own</strong> — the one you live in, or one you rent out. If you rent
                where you live, add your rent as a fixed monthly bill in
                <a routerLink="/cash-flow">Money &amp; bills</a> instead; there's nothing to add here.
              </p>
            }
            <div class="row" style="margin-top:12px">
              <button type="button" class="btn btn--ghost btn--sm" (click)="openEditor()">Add a property you own</button>
            </div>
          </div>
        </section>
      } @else {
        <!-- ========================================================
             Where the household stands on housing, before any detail
             ======================================================== -->
        <section class="housing">
          <div class="housing__side">
            <p class="eyebrow">Where you live</p>
            @if (portfolio().allInvestment) {
              @if (rentPaid() > 0) {
                <p class="housing__headline">Renting</p>
                <p class="housing__amount">{{ money(rentPaid()) }}<span class="housing__per">/month in rent</span></p>
                <p class="housing__note">
                  You rent your home — that's normal, and the rent is counted as one of your fixed monthly bills.
                  Everything below is property you <strong>own and rent out</strong>.
                </p>
              } @else {
                <p class="housing__headline">Not recorded</p>
                <p class="housing__note">
                  If you rent where you live, add the rent as a fixed monthly bill in
                  <a routerLink="/cash-flow">Money &amp; bills</a>. Everything below is property you own as an investment.
                </p>
              }
            } @else {
              <p class="housing__headline">You own your home</p>
              <p class="housing__amount">{{ money(homeCost()) }}<span class="housing__per">/month to live there</span></p>
              <p class="housing__note">
                Mortgage plus running costs on the home you live in. It counts towards what you own, but it doesn't
                bring in any money.
              </p>
            }
          </div>

          <div class="housing__divider" aria-hidden="true"></div>

          <div class="housing__side">
            <p class="eyebrow">
              {{ portfolio().count }} propert{{ portfolio().count === 1 ? 'y' : 'ies' }} owned
              @if (portfolio().letCount) {
                · {{ portfolio().letCount }} rented out
              }
            </p>
            <p class="housing__amount">{{ money(portfolio().totalEquity) }}<span class="housing__per"> is your share</span></p>
            <dl class="housing__facts">
              <div><dt>Value</dt><dd>{{ money(portfolio().totalValue) }}</dd></div>
              <div>
                <dt>Still owed</dt>
                <dd>{{ money(portfolio().totalDebt) }} <span class="muted">({{ pct(portfolio().loanToValue, 0) }} of value)</span></dd>
              </div>
              <div>
                <dt>Monthly cash flow</dt>
                <dd [class.pos]="portfolio().monthlyCashFlow > 0" [class.neg]="portfolio().monthlyCashFlow < 0">
                  {{ money(portfolio().monthlyCashFlow, true) }}/mo
                </dd>
              </div>
            </dl>
          </div>
        </section>

        @if (portfolio().allInvestment && rentPaid() > 0) {
          <div class="estimate-note">
            <span>
              <strong>Two different rents, kept apart.</strong>
              You <strong>pay</strong> {{ money(rentPaid()) }}/month to live somewhere — counted as a fixed monthly
              bill. You <strong>receive</strong> {{ money(rentReceived()) }}/month from tenants — that pays the
              property's own costs first, and anything left is kept separate in its repair fund, not spent.
            </span>
          </div>
        }

        @for (metrics of store.properties(); track metrics.property.id) {
          <section class="col" style="gap:16px">
            <div class="row row--between row--wrap">
              <div class="row" style="gap:12px">
                <h2 class="h2">{{ metrics.property.name }}</h2>
                <span class="badge" [class]="'badge badge--' + statusTone(metrics.property.rentalStatus)">
                  {{ statusLabel(metrics.property.rentalStatus) }}
                </span>
                <span class="usage-tag">{{ usageLabel(metrics) }}</span>
              </div>
              <button type="button" class="btn btn--ghost btn--sm" (click)="openEditor(metrics.property)">
                Edit<span class="sr-only"> {{ metrics.property.name }}</span>
              </button>
            </div>

            <div class="grid grid--stats">
              <sb-stat-card label="Estimated value" [value]="convert(metrics.property.estimatedValue, metrics.property.currency)"
                            [caption]="appreciationCaption(metrics.appreciationSincePurchase)" />
              <sb-stat-card label="Still owed" explain="loan-to-value" [value]="convert(metrics.property.mortgageBalance, metrics.property.currency)"
                            [invertDelta]="true"
                            [caption]="owedCaption(metrics)" />
              <sb-stat-card label="Your share" explain="property-equity" [value]="metrics.equity" [accent]="true"
                            caption="What it's worth minus what's still owed" />
              @if (isHome(metrics.property)) {
                <sb-stat-card label="Costs you each month"
                              [value]="convert(metrics.property.monthlyPayment, metrics.property.currency)
                                        + convert(metrics.property.monthlyPropertyExpenses, metrics.property.currency)"
                              caption="Mortgage plus running costs, paid from your income" />
              } @else {
                <sb-stat-card label="Monthly cash flow" explain="property-cash-flow" [value]="metrics.monthlyCashFlow"
                              [caption]="cashFlowCaption(metrics)" />
              }
            </div>

            <div [class]="showsReserve(metrics.property) ? 'grid grid--wide-left' : 'grid'">
              <!-- Waterfall -->
              <sb-section
                [title]="waterfallTitle(metrics)"
                explain="property-cash-flow"
                [subtitle]="waterfallSubtitle(metrics)"
              >
                <ol class="waterfall">
                  @for (step of metrics.waterfall; track step.label; let last = $last) {
                    <li class="waterfall__step" [class]="'waterfall__step waterfall__step--' + step.kind">
                      <div class="waterfall__meta">
                        <span class="waterfall__label">{{ plain(step.label) }}</span>
                        <span class="waterfall__amount num" [class.pos]="step.amount > 0" [class.neg]="step.amount < 0">
                          {{ money(step.amount, true) }}
                        </span>
                      </div>

                      <div class="waterfall__bar-wrap">
                        <div class="waterfall__bar" [style.width.%]="barWidth(step, metrics)"></div>
                      </div>

                      <div class="waterfall__foot">
                        <span class="waterfall__note">
                          @if (step.split) {
                            {{ money(step.split.interest) }} interest to the bank ·
                            {{ money(step.split.principal) }} paid off the loan
                          } @else if (step.note) {
                            {{ plain(step.note) }}
                          }
                        </span>
                        @if (!last && metrics.usage === 'let') {
                          <span class="waterfall__running num">{{ money(step.running) }} left</span>
                        }
                      </div>
                    </li>
                  }
                </ol>

                @if (metrics.property.monthlyRent <= 0 && !isHome(metrics.property)) {
                  <div class="estimate-note" style="margin-top:16px">
                    <span>
                      <strong>No rent coming in yet.</strong>
                      The {{ money(convert(metrics.property.monthlyPayment, metrics.property.currency)) }} mortgage is
                      currently paid from your own income.
                      @if (metrics.property.expectedRentStart) {
                        Rent is expected {{ relative(metrics.property.expectedRentStart) }}.
                      }
                    </span>
                  </div>
                }

                <div class="divider" style="margin:18px 0"></div>

                <dl class="mini-facts mini-facts--4">
                  @if (!isHome(metrics.property)) {
                    <div><dt>Monthly rent</dt><dd>{{ money(convert(metrics.property.monthlyRent, metrics.property.currency)) }}</dd></div>
                  }
                  <div><dt>Running costs</dt><dd>{{ money(convert(metrics.property.monthlyPropertyExpenses, metrics.property.currency)) }}</dd></div>
                  <div>
                    <dt>Interest to the bank <sb-explain key="mortgage-split" /></dt>
                    <dd>{{ money(metrics.monthlyInterest) }}<span class="muted">/mo</span></dd>
                  </div>
                  <div><dt>Paid off the loan</dt><dd>{{ money(metrics.monthlyPrincipal) }}<span class="muted">/mo</span></dd></div>
                  @if (!isHome(metrics.property)) {
                    <div><dt>Cash flow per year</dt><dd>{{ money(metrics.annualCashFlow, true) }}</dd></div>
                  }
                  @if (prefs.advanced()) {
                    @if (!isHome(metrics.property)) {
                      <div>
                        <dt>Rent as % of value (before costs) <sb-explain key="rental-yield" /></dt>
                        <dd>{{ pct(metrics.grossYield, 2) }}</dd>
                      </div>
                      <div><dt>Rent as % of value (after costs)</dt><dd>{{ pct(metrics.netYield, 2) }}</dd></div>
                    }
                    <div><dt>Your share in 5 years</dt><dd>{{ money(metrics.equityIn(60)) }}</dd></div>
                    <div><dt>Your share in 10 years</dt><dd>{{ money(metrics.equityIn(120)) }}</dd></div>
                  }
                </dl>
                @if (prefs.advanced()) {
                  <p class="micro muted" style="margin-top:10px">
                    Future figures assume the yearly price rise you entered and that the mortgage is paid as now —
                    in future money (not adjusted for rising prices).
                  </p>
                }
              </sb-section>

              <!-- Repair fund — only where there is rent to keep separate -->
              @if (showsReserve(metrics.property)) {
              <sb-section title="Repair fund" explain="property-reserve" subtitle="Spare rent is kept here for the property, not spent.">
                <div class="col" style="gap:16px">
                  <div class="reserve">
                    <span class="reserve__value">{{ money(convert(metrics.property.maintenanceReserve, metrics.property.currency)) }}</span>
                    <span class="reserve__target">
                      of {{ money(convert(metrics.property.maintenanceReserveTarget, metrics.property.currency)) }} goal
                    </span>
                  </div>

                  <sb-meter
                    [value]="reserveProgress(metrics.property)"
                    [valueText]="pct(reserveProgress(metrics.property), 0)"
                    label="Repair fund filled"
                    [large]="true"
                  />

                  <p class="small secondary">
                    Property money is kept separate on purpose: repairs, months without a tenant and letting costs are
                    paid from here rather than from your safety cushion.
                  </p>

                  @if (metrics.monthlyCashFlow > 0) {
                    <div class="estimate-note">
                      <span>
                        With <strong>{{ money(metrics.monthlyCashFlow) }}/month</strong> left over, the repair fund
                        reaches its goal in
                        <strong>{{ monthsToReserve(metrics.property, metrics.monthlyCashFlow) }} months</strong>.
                      </span>
                    </div>
                  }
                </div>
              </sb-section>
              }
            </div>

            <sb-section title="Your share over time" subtitle="The value going up while the loan goes down.">
              @if (equitySeries(metrics.property.id).length) {
                <sb-line-chart [series]="equitySeries(metrics.property.id)" [height]="260" ariaLabel="Your share of the property over time" />
              } @else {
                <sb-empty title="No history yet" text="This chart fills in as you update the value and what's owed in your monthly check-ins." />
              }
            </sb-section>
          </section>
        }
      }

      <!-- ============================================================ -->
      @if (editorOpen()) {
        <div class="scrim" (click)="editorOpen.set(false)" role="presentation">
          <div class="dialog dialog--wide" role="dialog" aria-modal="true" aria-labelledby="pr-dialog-title" sbDialog (dismiss)="editorOpen.set(false)" (click)="$event.stopPropagation()">
            <h2 class="h2" id="pr-dialog-title">{{ editingId() ? 'Edit property' : 'Add property' }}</h2>

            <form [formGroup]="form" (ngSubmit)="save()" class="col" style="gap:12px">
              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="pr-name">Name</label>
                  <input id="pr-name" class="input" formControlName="name" placeholder="City apartment" />
                </div>
                <div class="field">
                  <label class="field__label" for="pr-status">How it's used</label>
                  <select id="pr-status" class="select" formControlName="rentalStatus">
                    @for (option of statuses; track option.value) {
                      <option [value]="option.value">{{ option.label }}</option>
                    }
                  </select>
                </div>
              </div>

              <div class="field">
                <label class="field__label" for="pr-address">Address</label>
                <input id="pr-address" class="input" formControlName="address" />
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="pr-value">What it's worth now (estimate)</label>
                  <input id="pr-value" class="input input--num" type="number" step="100" min="0" formControlName="estimatedValue" />
                </div>
                <div class="field">
                  <label class="field__label" for="pr-purchase">What you paid</label>
                  <input id="pr-purchase" class="input input--num" type="number" step="100" min="0" formControlName="purchasePrice" />
                </div>
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="pr-mortgage">Still owed on the mortgage</label>
                  <input id="pr-mortgage" class="input input--num" type="number" step="1" min="0" formControlName="mortgageBalance" />
                </div>
                <div class="field">
                  <label class="field__label" for="pr-rate">Mortgage interest rate (% per year)</label>
                  <input id="pr-rate" class="input input--num" type="number" step="0.01" min="0" formControlName="interestPercent" />
                </div>
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="pr-payment">Monthly mortgage payment</label>
                  <input id="pr-payment" class="input input--num" type="number" step="1" min="0" formControlName="monthlyPayment" />
                </div>
                <div class="field">
                  <label class="field__label" for="pr-months">Months left on the mortgage</label>
                  <input id="pr-months" class="input input--num" type="number" step="1" min="0" formControlName="remainingMonths" />
                </div>
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="pr-rent">Rent you receive per month</label>
                  <input id="pr-rent" class="input input--num" type="number" step="1" min="0" formControlName="monthlyRent" />
                  <span class="field__hint">Leave at 0 if you live there or it's empty.</span>
                </div>
                <div class="field">
                  <label class="field__label" for="pr-expenses">Monthly running costs</label>
                  <input id="pr-expenses" class="input input--num" type="number" step="1" min="0" formControlName="monthlyPropertyExpenses" />
                  <span class="field__hint">Insurance, service charge, upkeep.</span>
                </div>
              </div>

              <div class="grid grid--3" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="pr-reserve">Repair fund balance</label>
                  <input id="pr-reserve" class="input input--num" type="number" step="1" min="0" formControlName="maintenanceReserve" />
                </div>
                <div class="field">
                  <label class="field__label" for="pr-reserve-target">Repair fund goal</label>
                  <input id="pr-reserve-target" class="input input--num" type="number" step="1" min="0" formControlName="maintenanceReserveTarget" />
                </div>
                <div class="field">
                  <label class="field__label" for="pr-appreciation">Expected price rise (% per year)</label>
                  <input id="pr-appreciation" class="input input--num" type="number" step="0.1" formControlName="appreciationPercent" />
                </div>
              </div>

              <div class="field">
                <label class="field__label" for="pr-rent-start">Rent expected from</label>
                <input id="pr-rent-start" class="input" type="date" formControlName="expectedRentStart" />
                <span class="field__hint">Only if it isn't rented out yet.</span>
              </div>

              <div class="field">
                <label class="field__label" for="pr-notes">Notes</label>
                <textarea id="pr-notes" class="textarea" formControlName="notes"></textarea>
              </div>

              <div class="row" style="justify-content:space-between; margin-top:4px">
                @if (editingId()) {
                  <button type="button" class="btn btn--quiet btn--sm" (click)="confirmDelete.set(true)">Delete</button>
                } @else { <span></span> }
                <div class="row" style="gap:8px">
                  <button type="button" class="btn btn--ghost" (click)="editorOpen.set(false)">Cancel</button>
                  <button type="submit" class="btn btn--primary" [disabled]="form.invalid || store.saving()">Save property</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      }

      <sb-confirm
        [open]="confirmDelete()"
        title="Delete this property?"
        message="Its value history and mortgage will be removed from your net worth."
        (confirmed)="remove()"
        (cancelled)="confirmDelete.set(false)"
      />
    </div>
  `,
  styleUrl: './property.component.scss',
})
export class PropertyComponent {
  readonly store = inject(FinanceStore);
  readonly prefs = inject(ViewPrefsService);
  private readonly currency = inject(CurrencyService);
  private readonly fb = inject(FormBuilder);

  readonly statuses = STATUSES;
  readonly editorOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly confirmDelete = signal(false);
  private editingCurrency: string | null = null;

  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    address: [''],
    rentalStatus: ['vacant' as RentalStatus, Validators.required],
    estimatedValue: [0, [Validators.required, Validators.min(0)]],
    purchasePrice: [null as number | null],
    mortgageBalance: [0, Validators.min(0)],
    interestPercent: [0],
    monthlyPayment: [0],
    remainingMonths: [0],
    monthlyRent: [0],
    monthlyPropertyExpenses: [0],
    maintenanceReserve: [0],
    maintenanceReserveTarget: [0],
    appreciationPercent: [2],
    expectedRentStart: [''],
    notes: [''],
  });

  equitySeries(propertyId: string): Series[] {
    const valuations = (this.store.data()?.propertyValuations ?? []).filter((v) => v.propertyId === propertyId);
    if (!valuations.length) return [];

    return [
      {
        key: 'equity',
        name: 'Your share',
        color: seriesColor(0),
        area: true,
        points: valuations.map((v) => ({ label: v.valuationDate, value: v.estimatedValue - v.mortgageBalance })),
      },
      {
        key: 'value',
        name: 'Estimated value',
        color: seriesColor(2),
        points: valuations.map((v) => ({ label: v.valuationDate, value: v.estimatedValue })),
      },
      {
        key: 'mortgage',
        name: 'Still owed',
        color: seriesColor(1),
        points: valuations.map((v) => ({ label: v.valuationDate, value: v.mortgageBalance })),
      },
    ];
  }

  /**
   * The bar shows what is *left* after each step, so the panel drains
   * down the page. On a property with no rent there is nothing to drain,
   * so the bar falls back to the size of the payment itself.
   */
  barWidth(step: WaterfallStep, metrics: PropertyMetrics): number {
    const rent = this.convert(metrics.property.monthlyRent, metrics.property.currency);
    const scale =
      metrics.usage === 'let'
        ? Math.max(rent, 1)
        : Math.max(
            this.convert(metrics.property.monthlyPayment, metrics.property.currency) +
              this.convert(metrics.property.monthlyPropertyExpenses, metrics.property.currency),
            1,
          );
    const value = metrics.usage === 'let' ? step.running : Math.abs(step.running);
    return Math.max(2, Math.min(100, (Math.abs(value) / scale) * 100));
  }

  waterfallTitle(metrics: PropertyMetrics): string {
    if (metrics.usage === 'let') return 'Where the rent goes';
    if (metrics.usage === 'lived-in') return 'What this home costs';
    return 'What this property costs while empty';
  }

  waterfallSubtitle(metrics: PropertyMetrics): string {
    if (metrics.usage === 'let') {
      return 'Each month the rent pays these, in this order. What is left at the bottom is yours.';
    }
    if (metrics.usage === 'lived-in') return 'Paid from your income — a home you live in brings in no rent.';
    return 'The costs keep coming while it sits empty, and no rent is coming in to cover them.';
  }

  usageLabel(metrics: PropertyMetrics): string {
    if (metrics.usage === 'let') return 'Investment · rented out';
    if (metrics.usage === 'lived-in') return 'Your home';
    return 'Investment · no tenant';
  }

  readonly portfolio = computed(() => propertyPortfolio(this.store.properties(), this.store.convert()));

  owedCaption(metrics: PropertyMetrics): string {
    const property = metrics.property;
    if (property.mortgageBalance <= 0) return 'No mortgage — fully yours';
    const parts = [`${this.pct(metrics.loanToValue, 0)} of the value`];
    if (property.mortgageInterestRate > 0) parts.push(`${this.pct(property.mortgageInterestRate * 100, 2)} interest`);
    if (property.remainingMonths > 0) parts.push(`${property.remainingMonths} months left`);
    return parts.join(' · ');
  }

  cashFlowCaption(metrics: PropertyMetrics): string {
    if (metrics.property.monthlyRent <= 0) return 'No rent coming in yet';
    if (this.prefs.advanced()) return `Rent is ${this.pct(metrics.netYield, 2)} of value a year, after costs`;
    return metrics.monthlyCashFlow >= 0 ? 'Rent left after costs and mortgage' : 'Rent does not cover the costs — you top it up';
  }

  /**
   * Waterfall labels come from the calculations in plain-ish English; a
   * few words still read like a finance textbook, so swap them here.
   */
  plain(text: string): string {
    return text
      .replace(/the Property Reserve/g, 'the repair fund')
      .replace(/Property Reserve/g, 'Repair fund')
      .replace(/Ring-fenced/g, 'Kept separate')
      .replace(/ring-fenced/g, 'kept separate')
      .replace(/void periods/g, 'months without a tenant')
      .replace(/never lifestyle money/g, 'not spending money');
  }

  /** Rent the household pays to live somewhere — never rent it receives. */
  readonly rentPaid = computed(() => {
    const data = this.store.data();
    return data ? monthlyRentPaid(data, this.store.convert()) : 0;
  });

  /** Rent the household receives from tenants. */
  readonly rentReceived = computed(() =>
    this.store
      .properties()
      .reduce((total, m) => total + this.convert(m.property.monthlyRent, m.property.currency), 0),
  );

  /** Monthly cost of an owner-occupied home, where one exists. */
  readonly homeCost = computed(() => {
    const home = this.store.properties().find((m) => m.usage === 'lived-in');
    if (!home) return 0;
    return (
      this.convert(home.property.monthlyPayment, home.property.currency) +
      this.convert(home.property.monthlyPropertyExpenses, home.property.currency)
    );
  });

  isHome(property: Property): boolean {
    return property.rentalStatus === 'owner_occupied';
  }

  /** Only property that earns (or will earn) rent has a reserve to show. */
  showsReserve(property: Property): boolean {
    return !this.isHome(property) && property.maintenanceReserveTarget > 0;
  }

  reserveProgress(property: Property): number {
    if (property.maintenanceReserveTarget <= 0) return 0;
    return Math.min(100, (property.maintenanceReserve / property.maintenanceReserveTarget) * 100);
  }

  monthsToReserve(property: Property, surplus: number): number {
    const remaining = Math.max(0, property.maintenanceReserveTarget - property.maintenanceReserve);
    return surplus > 0 ? Math.ceil(remaining / surplus) : 0;
  }

  /* -- editor -------------------------------------------------------- */

  openEditor(property?: Property): void {
    this.editingId.set(property?.id ?? null);
    this.editingCurrency = property?.currency ?? null;
    this.form.reset({
      name: property?.name ?? '',
      address: property?.address ?? '',
      rentalStatus: property?.rentalStatus ?? 'vacant',
      estimatedValue: property?.estimatedValue ?? 0,
      purchasePrice: property?.purchasePrice ?? null,
      mortgageBalance: property?.mortgageBalance ?? 0,
      interestPercent: (property?.mortgageInterestRate ?? 0) * 100,
      monthlyPayment: property?.monthlyPayment ?? 0,
      remainingMonths: property?.remainingMonths ?? 0,
      monthlyRent: property?.monthlyRent ?? 0,
      monthlyPropertyExpenses: property?.monthlyPropertyExpenses ?? 0,
      maintenanceReserve: property?.maintenanceReserve ?? 0,
      maintenanceReserveTarget: property?.maintenanceReserveTarget ?? 0,
      appreciationPercent: (property?.annualAppreciation ?? 0.02) * 100,
      expectedRentStart: property?.expectedRentStart ?? '',
      notes: property?.notes ?? '',
    });
    this.editorOpen.set(true);
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const values = {
      name: raw.name.trim(),
      address: raw.address?.trim() || null,
      // Editing keeps the property's own currency; new ones use the base currency.
      currency: this.editingCurrency ?? this.currency.baseCurrency(),
      rentalStatus: raw.rentalStatus,
      estimatedValue: Number(raw.estimatedValue),
      purchasePrice: raw.purchasePrice === null ? null : Number(raw.purchasePrice),
      mortgageBalance: Number(raw.mortgageBalance),
      mortgageInterestRate: Number(raw.interestPercent) / 100,
      monthlyPayment: Number(raw.monthlyPayment),
      remainingMonths: Number(raw.remainingMonths),
      monthlyRent: Number(raw.monthlyRent),
      monthlyPropertyExpenses: Number(raw.monthlyPropertyExpenses),
      maintenanceReserve: Number(raw.maintenanceReserve),
      maintenanceReserveTarget: Number(raw.maintenanceReserveTarget),
      annualAppreciation: Number(raw.appreciationPercent) / 100,
      expectedRentStart: raw.expectedRentStart || null,
      notes: raw.notes?.trim() || null,
    };

    const id = this.editingId();
    const ok = id
      ? await this.store.save('properties', id, values, 'Property')
      : await this.store.create('properties', values, 'Property');
    if (ok) this.editorOpen.set(false);
  }

  async remove(): Promise<void> {
    const id = this.editingId();
    this.confirmDelete.set(false);
    if (!id) return;
    if (await this.store.destroy('properties', id, 'Property')) this.editorOpen.set(false);
  }

  /* -- display -------------------------------------------------------- */

  statusLabel(status: RentalStatus): string {
    return STATUSES.find((option) => option.value === status)?.label ?? status;
  }

  statusTone(status: RentalStatus): string {
    if (status === 'rented') return 'good';
    if (status === 'listed') return 'brand';
    if (status === 'vacant') return 'warn';
    return 'neutral';
  }

  appreciationCaption(appreciation: number | null): string {
    return appreciation === null
      ? 'No purchase price recorded'
      : `${this.currency.percent(appreciation, 1, true)} since purchase`;
  }

  convert(value: number, currencyCode: string): number {
    return this.store.convert()(value, currencyCode);
  }

  money(value: number | null, signed = false): string {
    return this.currency.format(value, { signed, decimals: Math.abs(value ?? 0) >= 10000 ? 0 : undefined });
  }

  pct(value: number, decimals = 1): string {
    return this.currency.percent(value, decimals);
  }

  relative(date: string): string {
    return formatRelative(date, this.currency.locale());
  }
}
