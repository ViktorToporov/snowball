import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { CurrencyService } from '../../core/money/currency.service';
import { formatRelative } from '../../core/money/format';
import { Property, RentalStatus } from '../../core/models/domain.models';
import { PropertyMetrics, WaterfallStep, monthlyRentPaid, propertyPortfolio } from '../../core/engine/metrics';
import { FinanceStore } from '../../core/state/finance.store';
import { Series, seriesColor } from '../../shared/charts/chart-utils';
import { LineChartComponent } from '../../shared/charts/line-chart.component';
import { ExplainComponent } from '../../shared/ui/explain.component';
import { StatCardComponent } from '../../shared/ui/stat-card.component';
import {
  ConfirmDialogComponent,
  EmptyStateComponent,
  MeterComponent,
  SectionComponent,
  SkeletonComponent,
} from '../../shared/ui/ui-kit';

const STATUSES: Array<{ value: RentalStatus; label: string }> = [
  { value: 'owner_occupied', label: 'Owner occupied' },
  { value: 'rented', label: 'Rented' },
  { value: 'listed', label: 'Listed / seeking tenant' },
  { value: 'vacant', label: 'Vacant' },
];

@Component({
  selector: 'sb-property',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    StatCardComponent,
    SectionComponent,
    MeterComponent,
    ExplainComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ConfirmDialogComponent,
    LineChartComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="page-head__titles">
          <p class="eyebrow">Real assets</p>
          <h1 class="h1">Property</h1>
        </div>
        <div class="page-head__actions">
          <button type="button" class="btn btn--primary btn--sm" (click)="openEditor()">Add property</button>
        </div>
      </header>

      @if (store.isLoading()) {
        <div class="card card--pad"><sb-skeleton [count]="6" /></div>
      } @else if (!store.properties().length) {
        <div class="card">
          <sb-empty title="No property recorded" text="Add a property to track equity, cash flow and rental yield.">
            <button type="button" class="btn btn--primary btn--sm" (click)="openEditor()">Add property</button>
          </sb-empty>
        </div>
      } @else {
        <!-- ========================================================
             Where the household stands on housing, before any detail
             ======================================================== -->
        <section class="housing">
          <div class="housing__side">
            <p class="eyebrow">Where you live</p>
            @if (portfolio().allInvestment) {
              <p class="housing__headline">Renting</p>
              <p class="housing__amount">{{ money(rentPaid()) }}<span class="housing__per">/month</span></p>
              <p class="housing__note">
                You rent your home — it is not an asset on your balance sheet, and the rent is an
                essential expense like any other. Everything below is property you
                <strong>own as an investment</strong>.
              </p>
            } @else {
              <p class="housing__headline">You own your home</p>
              <p class="housing__amount">{{ money(homeCost()) }}<span class="housing__per">/month</span></p>
              <p class="housing__note">
                Mortgage plus running costs on the home you live in. It appears on your balance sheet, but it
                produces no income.
              </p>
            }
          </div>

          <div class="housing__divider" aria-hidden="true"></div>

          <div class="housing__side">
            <p class="eyebrow">
              {{ portfolio().count }} propert{{ portfolio().count === 1 ? 'y' : 'ies' }} owned
              @if (portfolio().letCount) {
                · {{ portfolio().letCount }} let
              }
            </p>
            <p class="housing__amount">{{ money(portfolio().totalEquity) }}<span class="housing__per"> equity</span></p>
            <dl class="housing__facts">
              <div><dt>Value</dt><dd>{{ money(portfolio().totalValue) }}</dd></div>
              <div><dt>Mortgage debt</dt><dd>{{ money(portfolio().totalDebt) }}</dd></div>
              <div><dt>Loan-to-value</dt><dd>{{ pct(portfolio().loanToValue, 0) }}</dd></div>
              <div>
                <dt>Net cash flow</dt>
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
              You <strong>pay</strong> {{ money(rentPaid()) }}/month to live somewhere — counted as an essential
              expense. You <strong>receive</strong> {{ money(rentReceived()) }}/month from tenants — routed
              through the waterfall below and ring-fenced in the Property Reserve, never treated as
              lifestyle income.
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
              <button type="button" class="btn btn--ghost btn--sm" (click)="openEditor(metrics.property)">Edit</button>
            </div>

            <div class="grid grid--stats">
              <sb-stat-card label="Estimated value" [value]="convert(metrics.property.estimatedValue, metrics.property.currency)"
                            [caption]="appreciationCaption(metrics.appreciationSincePurchase)" />
              <sb-stat-card label="Equity" explain="property-equity" [value]="metrics.equity" [accent]="true"
                            [caption]="pct(metrics.loanToValue, 0) + ' loan-to-value'" />
              <sb-stat-card label="Mortgage balance" explain="loan-to-value" [value]="convert(metrics.property.mortgageBalance, metrics.property.currency)"
                            [invertDelta]="true"
                            [caption]="pct(metrics.property.mortgageInterestRate * 100, 2) + ' · ' + metrics.property.remainingMonths + ' months left'" />
              @if (isHome(metrics.property)) {
                <sb-stat-card label="Monthly housing cost"
                              [value]="-(convert(metrics.property.monthlyPayment, metrics.property.currency)
                                        + convert(metrics.property.monthlyPropertyExpenses, metrics.property.currency))"
                              [invertDelta]="true"
                              caption="Mortgage plus running costs — paid from income, not rent" />
              } @else {
                <sb-stat-card label="Monthly cash flow" explain="property-cash-flow" [value]="metrics.monthlyCashFlow"
                              [caption]="metrics.property.monthlyRent > 0 ? pct(metrics.netYield, 2) + ' net yield' : 'No rental income yet'" />
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
                        <span class="waterfall__label">{{ step.label }}</span>
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
                            {{ money(step.split.interest) }} interest ·
                            {{ money(step.split.principal) }} off what you owe
                          } @else if (step.note) {
                            {{ step.note }}
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
                      <strong>Not yet producing rent.</strong>
                      The {{ money(convert(metrics.property.monthlyPayment, metrics.property.currency)) }} mortgage is
                      currently paid from salary.
                      @if (metrics.property.expectedRentStart) {
                        Rent is expected {{ relative(metrics.property.expectedRentStart) }}.
                      }
                    </span>
                  </div>
                }

                <div class="divider" style="margin:18px 0"></div>

                <dl class="mini-facts mini-facts--4">
                  <div><dt>Monthly rent</dt><dd>{{ money(convert(metrics.property.monthlyRent, metrics.property.currency)) }}</dd></div>
                  <div><dt>Running costs</dt><dd>{{ money(convert(metrics.property.monthlyPropertyExpenses, metrics.property.currency)) }}</dd></div>
                  <div>
                    <dt>Gross yield <sb-explain key="rental-yield" /></dt>
                    <dd>{{ pct(metrics.grossYield, 2) }}</dd>
                  </div>
                  <div><dt>Annual cash flow</dt><dd>{{ money(metrics.annualCashFlow) }}</dd></div>
                  <div>
                    <dt>Interest this month <sb-explain key="mortgage-split" /></dt>
                    <dd>{{ money(metrics.monthlyInterest) }}</dd>
                  </div>
                  <div><dt>Principal this month</dt><dd>{{ money(metrics.monthlyPrincipal) }}</dd></div>
                  <div><dt>Equity in 5 years</dt><dd>{{ money(metrics.equityIn(60)) }}</dd></div>
                  <div><dt>Equity in 10 years</dt><dd>{{ money(metrics.equityIn(120)) }}</dd></div>
                </dl>
              </sb-section>

              <!-- Property reserve — only where there is rent to ring-fence -->
              @if (showsReserve(metrics.property)) {
              <sb-section title="Property Reserve" explain="property-reserve" subtitle="Rental surplus is kept here, not treated as lifestyle money.">
                <div class="col" style="gap:16px">
                  <div class="reserve">
                    <span class="reserve__value">{{ money(convert(metrics.property.maintenanceReserve, metrics.property.currency)) }}</span>
                    <span class="reserve__target">
                      of {{ money(convert(metrics.property.maintenanceReserveTarget, metrics.property.currency)) }} target
                    </span>
                  </div>

                  <sb-meter
                    [value]="reserveProgress(metrics.property)"
                    [valueText]="pct(reserveProgress(metrics.property), 0)"
                    label="Reserve funded"
                    [large]="true"
                  />

                  <p class="small secondary">
                    Property cash is ring-fenced on purpose: repairs, void periods and letting costs come out of the
                    reserve rather than out of your emergency fund.
                  </p>

                  @if (metrics.monthlyCashFlow > 0) {
                    <div class="estimate-note">
                      <span>
                        At the current surplus of <strong>{{ money(metrics.monthlyCashFlow) }}/month</strong>, the
                        reserve target is reached in
                        <strong>{{ monthsToReserve(metrics.property, metrics.monthlyCashFlow) }} months</strong>.
                      </span>
                    </div>
                  }
                </div>
              </sb-section>
              }
            </div>

            <sb-section title="Equity over time" subtitle="Value appreciating while the mortgage amortises.">
              @if (equitySeries(metrics.property.id).length) {
                <sb-line-chart [series]="equitySeries(metrics.property.id)" [height]="260" ariaLabel="Property equity over time" />
              } @else {
                <sb-empty title="No valuation history" text="Equity charts here as valuations are recorded." />
              }
            </sb-section>
          </section>
        }
      }

      <!-- ============================================================ -->
      @if (editorOpen()) {
        <div class="scrim" (click)="editorOpen.set(false)" role="presentation">
          <div class="dialog dialog--wide" role="dialog" aria-modal="true" aria-label="Property" (click)="$event.stopPropagation()">
            <h2 class="h2">{{ editingId() ? 'Edit property' : 'Add property' }}</h2>

            <form [formGroup]="form" (ngSubmit)="save()" class="col" style="gap:12px">
              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="pr-name">Name</label>
                  <input id="pr-name" class="input" formControlName="name" placeholder="City Apartment" />
                </div>
                <div class="field">
                  <label class="field__label" for="pr-status">Status</label>
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
                  <label class="field__label" for="pr-value">Estimated value</label>
                  <input id="pr-value" class="input input--num" type="number" step="100" formControlName="estimatedValue" />
                </div>
                <div class="field">
                  <label class="field__label" for="pr-purchase">Purchase price</label>
                  <input id="pr-purchase" class="input input--num" type="number" step="100" formControlName="purchasePrice" />
                </div>
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="pr-mortgage">Mortgage balance</label>
                  <input id="pr-mortgage" class="input input--num" type="number" step="1" formControlName="mortgageBalance" />
                </div>
                <div class="field">
                  <label class="field__label" for="pr-rate">Interest rate (%)</label>
                  <input id="pr-rate" class="input input--num" type="number" step="0.01" formControlName="interestPercent" />
                </div>
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="pr-payment">Monthly payment</label>
                  <input id="pr-payment" class="input input--num" type="number" step="1" formControlName="monthlyPayment" />
                </div>
                <div class="field">
                  <label class="field__label" for="pr-months">Remaining months</label>
                  <input id="pr-months" class="input input--num" type="number" step="1" formControlName="remainingMonths" />
                </div>
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="pr-rent">Monthly rent</label>
                  <input id="pr-rent" class="input input--num" type="number" step="1" formControlName="monthlyRent" />
                </div>
                <div class="field">
                  <label class="field__label" for="pr-expenses">Monthly property expenses</label>
                  <input id="pr-expenses" class="input input--num" type="number" step="1" formControlName="monthlyPropertyExpenses" />
                </div>
              </div>

              <div class="grid grid--3" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="pr-reserve">Reserve balance</label>
                  <input id="pr-reserve" class="input input--num" type="number" step="1" formControlName="maintenanceReserve" />
                </div>
                <div class="field">
                  <label class="field__label" for="pr-reserve-target">Reserve target</label>
                  <input id="pr-reserve-target" class="input input--num" type="number" step="1" formControlName="maintenanceReserveTarget" />
                </div>
                <div class="field">
                  <label class="field__label" for="pr-appreciation">Appreciation (%/yr)</label>
                  <input id="pr-appreciation" class="input input--num" type="number" step="0.1" formControlName="appreciationPercent" />
                </div>
              </div>

              <div class="field">
                <label class="field__label" for="pr-rent-start">Expected rent start</label>
                <input id="pr-rent-start" class="input" type="date" formControlName="expectedRentStart" />
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
        message="Its valuations and mortgage will be removed from your net worth."
        (confirmed)="remove()"
        (cancelled)="confirmDelete.set(false)"
      />
    </div>
  `,
  styleUrl: './property.component.scss',
})
export class PropertyComponent {
  readonly store = inject(FinanceStore);
  private readonly currency = inject(CurrencyService);
  private readonly fb = inject(FormBuilder);

  readonly statuses = STATUSES;
  readonly editorOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly confirmDelete = signal(false);

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
        name: 'Equity',
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
        name: 'Mortgage',
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
      return 'Each month the rent is spent in this order. Only what survives to the bottom is yours to allocate.';
    }
    if (metrics.usage === 'lived-in') return 'Paid out of income — this property produces no rent.';
    return 'Costs continue while the property sits empty; nothing is coming in to meet them.';
  }

  usageLabel(metrics: PropertyMetrics): string {
    if (metrics.usage === 'let') return 'Investment · let to tenants';
    if (metrics.usage === 'lived-in') return 'Your home';
    return 'Investment · no tenant';
  }

  readonly portfolio = computed(() => propertyPortfolio(this.store.properties()));

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
      currency: this.currency.baseCurrency(),
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
