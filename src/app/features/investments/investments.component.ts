import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { CurrencyService } from '../../core/money/currency.service';
import { formatDate, toIsoDate } from '../../core/money/format';
import { AssetType, Investment } from '../../core/models/domain.models';
import { FinanceStore } from '../../core/state/finance.store';
import { Series, seriesColor } from '../../shared/charts/chart-utils';
import { DonutChartComponent } from '../../shared/charts/donut-chart.component';
import { LineChartComponent } from '../../shared/charts/line-chart.component';
import { StatCardComponent } from '../../shared/ui/stat-card.component';
import {
  ConfirmDialogComponent,
  EmptyStateComponent,
  MeterComponent,
  SectionComponent,
  SkeletonComponent,
} from '../../shared/ui/ui-kit';

const ASSET_TYPES: Array<{ value: AssetType; label: string }> = [
  { value: 'etf', label: 'ETF' },
  { value: 'stock', label: 'Stock' },
  { value: 'bond', label: 'Bond' },
  { value: 'mutual_fund', label: 'Mutual fund' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'reit', label: 'REIT' },
  { value: 'commodity', label: 'Commodity' },
  { value: 'other', label: 'Other' },
];

@Component({
  selector: 'sb-investments',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    StatCardComponent,
    SectionComponent,
    MeterComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ConfirmDialogComponent,
    LineChartComponent,
    DonutChartComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="page-head__titles">
          <p class="eyebrow">Portfolio</p>
          <h1 class="h1">Investments</h1>
        </div>
        <div class="page-head__actions">
          <button type="button" class="btn btn--ghost btn--sm" (click)="txnOpen.set(true)">Record activity</button>
          <button type="button" class="btn btn--primary btn--sm" (click)="startCreate()">Add holding</button>
        </div>
      </header>

      @if (store.isLoading()) {
        <div class="card card--pad"><sb-skeleton [count]="6" /></div>
      } @else if (portfolio(); as p) {
        <div class="grid grid--stats">
          <sb-stat-card label="Portfolio value" explain="portfolio-value" [value]="p.totalValue" [delta]="store.deltas().investments" [trend]="valueTrend()" [accent]="true" />
          <sb-stat-card label="Total invested" explain="contributions-vs-growth" [value]="p.totalCost" [caption]="money(p.totalContributions) + ' contributed to date'" />
          <sb-stat-card
            label="Unrealised gain"
            explain="unrealised-gain"
            [value]="p.unrealisedGain"
            [caption]="pct(p.totalReturnPercent, 2) + ' on cost'"
            [badge]="p.unrealisedGain >= 0 ? 'Gain' : 'Loss'"
            [badgeTone]="p.unrealisedGain >= 0 ? 'good' : 'bad'"
          />
          <sb-stat-card
            label="Time-weighted return"
            explain="time-weighted-return"
            [value]="p.annualisedReturn"
            format="percent"
            [caption]="p.annualisedReturn === null ? 'Needs more history' : 'Annualised, excludes contributions'"
          />
        </div>

        <!-- ------------------------------------------------------- -->
        <div class="grid grid--wide-left">
          <sb-section title="Portfolio value over time" explain="contributions-vs-growth" subtitle="Contributions versus what the market added.">
            @if (growthSeries().length) {
              <sb-line-chart [series]="growthSeries()" [height]="270" ariaLabel="Portfolio value and contributions" />
              <div class="estimate-note" style="margin-top:14px">
                <span>
                  The gap between the two lines is <strong>{{ money(p.marketGrowth) }}</strong> of market growth —
                  everything below the contributions line is money you paid in, not performance.
                </span>
              </div>
            } @else {
              <sb-empty title="No portfolio history" text="Value charts here as snapshots accumulate." />
            }
          </sb-section>

          <sb-section title="Holdings mix" subtitle="Each position's share of the portfolio.">
            <sb-donut-chart [data]="holdingMix()" centerLabel="Invested" [stacked]="true" ariaLabel="Allocation by holding" />
          </sb-section>
        </div>

        <!-- ------------------------------------------------------- -->
        <sb-section title="Holdings" subtitle="Valued live at quantity × current price." [flush]="true">
          @if (p.positions.length) {
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Holding</th>
                    <th>Type</th>
                    <th class="t-right">Quantity</th>
                    <th class="t-right">Avg cost</th>
                    <th class="t-right">Price</th>
                    <th class="t-right">Value</th>
                    <th class="t-right">Gain / loss</th>
                    <th class="t-right">Return</th>
                    <th class="t-right">Weight</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (position of p.positions; track position.investment.id) {
                    <tr>
                      <td>
                        <div class="table__primary">{{ position.investment.name }}</div>
                        <div class="table__meta">
                          {{ position.investment.ticker || position.investment.isin || position.brokerName || '—' }}
                          @if (position.investment.expenseRatio) {
                            · {{ pct(position.investment.expenseRatio * 100, 2) }} OCF
                          }
                        </div>
                      </td>
                      <td class="secondary">{{ assetLabel(position.investment.assetType) }}</td>
                      <td class="num secondary">{{ qty(position.investment.quantity) }}</td>
                      <td class="num secondary">{{ price(position.investment.averageCost, position.investment.currency) }}</td>
                      <td class="num">{{ price(position.investment.currentPrice, position.investment.currency) }}</td>
                      <td class="num" style="font-weight:600">{{ moneyIn(position.currentValue, position.investment.currency) }}</td>
                      <td class="num" [class.pos]="position.unrealisedGain > 0" [class.neg]="position.unrealisedGain < 0">
                        {{ moneyIn(position.unrealisedGain, position.investment.currency, true) }}
                      </td>
                      <td class="num" [class.pos]="position.returnPercent > 0" [class.neg]="position.returnPercent < 0">
                        {{ pct(position.returnPercent, 2, true) }}
                      </td>
                      <td class="num secondary">{{ pct(position.shareOfPortfolio) }}</td>
                      <td class="t-right">
                        <button type="button" class="btn btn--quiet btn--sm" (click)="startEdit(position.investment)">Edit</button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

          } @else {
            <sb-empty title="No holdings yet" text="Add your first ETF, stock or fund to start tracking performance.">
              <button type="button" class="btn btn--primary btn--sm" (click)="startCreate()">Add holding</button>
            </sb-empty>
          }

          @if (p.positions.length) {
            <div slot="foot" class="card__foot">
              Prices are whatever you last recorded — Snowball does not fetch live quotes.
              @if (p.weightedExpenseRatio !== null) {
                Weighted ongoing charge across the portfolio: {{ pct(p.weightedExpenseRatio, 2) }}.
              }
            </div>
          }
        </sb-section>

        <!-- ------------------------------------------------------- -->
        <sb-section
          title="Target vs actual allocation"
          explain="allocation-drift"
          subtitle="Actual weights are calculated live from your holdings; a single holding can span several buckets."
        >
          <div slot="actions">
            <span class="micro muted">Suggestions only — Snowball never places trades.</span>
          </div>

          @if (allocation().length) {
            <div class="alloc">
              @for (bucket of allocation(); track bucket.bucket) {
                <div class="alloc__row">
                  <div class="alloc__head">
                    <span class="alloc__name">{{ bucket.bucket }}</span>
                    <span class="badge" [class]="'badge badge--' + statusTone(bucket.status)">
                      {{ bucket.status === 'on-target' ? 'On target' : bucket.status === 'overweight' ? 'Overweight' : 'Underweight' }}
                    </span>
                  </div>

                  <div class="alloc__bars">
                    <div class="alloc__bar-label">Target</div>
                    <div class="alloc__track">
                      <div class="alloc__fill alloc__fill--target" [style.width.%]="scale(bucket.targetPercentage)"></div>
                    </div>
                    <div class="alloc__value num">{{ pct(bucket.targetPercentage) }}</div>

                    <div class="alloc__bar-label">Actual</div>
                    <div class="alloc__track">
                      <div
                        class="alloc__fill"
                        [class.alloc__fill--over]="bucket.status === 'overweight'"
                        [class.alloc__fill--under]="bucket.status === 'underweight'"
                        [style.width.%]="scale(bucket.actualPercentage)"
                      ></div>
                    </div>
                    <div class="alloc__value num">{{ pct(bucket.actualPercentage) }}</div>
                  </div>

                  <div class="alloc__foot">
                    <span class="num">{{ money(bucket.actualValue) }}</span>
                    <span class="muted">·</span>
                    <span [class.pos]="bucket.drift > 0" [class.neg]="bucket.drift < 0" class="num">
                      {{ pct(bucket.drift, 1, true) }} vs target
                    </span>
                    <span class="muted">· tolerance ±{{ pct(bucket.toleranceBand, 0) }}</span>
                  </div>
                </div>
              }
            </div>
          } @else {
            <sb-empty title="No allocation model" text="Set target percentages to see drift and rebalance suggestions." />
          }
        </sb-section>

        @if (store.rebalance().length) {
          <sb-section title="Rebalance suggestions" explain="rebalance" subtitle="What would bring each bucket back inside its band.">
            <ul class="rebalance">
              @for (suggestion of store.rebalance(); track suggestion.bucket) {
                <li class="rebalance__item">
                  <div class="rebalance__main">
                    <span class="rebalance__bucket">{{ suggestion.bucket }}</span>
                    <span class="rebalance__detail">
                      Target: {{ pct(suggestion.targetPercentage) }} · Actual: {{ pct(suggestion.actualPercentage) }} ·
                      {{ suggestion.drift > 0 ? 'Overweight' : 'Underweight' }} by {{ pct(Math.abs(suggestion.drift)) }}
                    </span>
                  </div>
                  <div class="rebalance__action">
                    <span class="badge" [class]="suggestion.action === 'buy' ? 'badge badge--brand' : 'badge badge--neutral'">
                      {{ suggestion.action === 'buy' ? 'Add' : 'Trim' }}
                    </span>
                    <span class="num rebalance__amount">{{ money(suggestion.amount) }}</span>
                  </div>
                </li>
              }
            </ul>
            <div class="estimate-note" style="margin-top:14px">
              <span>
                <strong>Rebalance with contributions first.</strong> Directing new money to underweight buckets avoids
                selling — and the tax and fees that come with it.
              </span>
            </div>
          </sb-section>
        }

        <!-- ------------------------------------------------------- -->
        <div class="grid grid--wide-right">
          <sb-section title="Contributions vs growth" explain="contributions-vs-growth" subtitle="How much of the portfolio you built, and how much the market did.">
            <div class="col" style="gap:16px">
              <sb-meter
                [value]="contributionShare()"
                label="Your contributions"
                [valueText]="money(p.totalContributions)"
                tone="brand"
                [large]="true"
              />
              <sb-meter
                [value]="100 - contributionShare()"
                label="Market growth"
                [valueText]="money(p.marketGrowth)"
                [tone]="p.marketGrowth >= 0 ? 'good' : 'bad'"
                [large]="true"
              />
              <div class="divider"></div>
              <dl class="mini-facts">
                <div><dt>Dividends received</dt><dd>{{ money(p.dividendsReceived) }}</dd></div>
                <div><dt>Fees paid</dt><dd>{{ money(p.feesPaid) }}</dd></div>
                <div><dt>Realised gain</dt><dd>{{ money(p.realisedGain) }}</dd></div>
                <div><dt>Holdings</dt><dd>{{ p.positions.length }}</dd></div>
              </dl>
            </div>
          </sb-section>

          <sb-section title="Recent activity" subtitle="Buys, sells, dividends and fees." [flush]="true">
            @if (recentActivity().length) {
              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr><th>Date</th><th>Holding</th><th>Type</th><th class="t-right">Amount</th></tr>
                  </thead>
                  <tbody>
                    @for (txn of recentActivity(); track txn.id) {
                      <tr>
                        <td class="num secondary" style="white-space:nowrap">{{ date(txn.transactionDate) }}</td>
                        <td class="truncate">{{ investmentName(txn.investmentId) }}</td>
                        <td>
                          <span class="badge badge--neutral">{{ txn.transactionType }}</span>
                        </td>
                        <td class="num">{{ moneyIn(txn.amount ?? txn.quantity * txn.price, txn.currency) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <sb-empty title="No activity recorded" text="Record buys and dividends to track contributions accurately." />
            }
          </sb-section>
        </div>
      }

      <!-- ============================================================ -->
      @if (editorOpen()) {
        <div class="scrim" (click)="closeEditor()" role="presentation">
          <div class="dialog" role="dialog" aria-modal="true" aria-label="Holding" (click)="$event.stopPropagation()">
            <h2 class="h2">{{ editingId() ? 'Edit holding' : 'Add holding' }}</h2>

            <form [formGroup]="form" (ngSubmit)="save()" class="col" style="gap:12px">
              <div class="field">
                <label class="field__label" for="inv-name">Name</label>
                <input id="inv-name" class="input" formControlName="name" placeholder="Vanguard S&P 500 UCITS ETF" />
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="inv-ticker">Ticker</label>
                  <input id="inv-ticker" class="input" formControlName="ticker" placeholder="VUAA" />
                </div>
                <div class="field">
                  <label class="field__label" for="inv-isin">ISIN</label>
                  <input id="inv-isin" class="input" formControlName="isin" placeholder="IE00BFMXXD54" />
                </div>
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="inv-type">Asset type</label>
                  <select id="inv-type" class="select" formControlName="assetType">
                    @for (option of assetTypes; track option.value) {
                      <option [value]="option.value">{{ option.label }}</option>
                    }
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="inv-currency">Currency</label>
                  <input id="inv-currency" class="input" formControlName="currency" maxlength="3" />
                </div>
              </div>

              <div class="grid grid--3" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="inv-qty">Quantity</label>
                  <input id="inv-qty" class="input input--num" type="number" step="0.00000001" formControlName="quantity" />
                </div>
                <div class="field">
                  <label class="field__label" for="inv-cost">Average cost</label>
                  <input id="inv-cost" class="input input--num" type="number" step="0.000001" formControlName="averageCost" />
                </div>
                <div class="field">
                  <label class="field__label" for="inv-price">Current price</label>
                  <input id="inv-price" class="input input--num" type="number" step="0.000001" formControlName="currentPrice" />
                </div>
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="inv-region">Region / bucket</label>
                  <input id="inv-region" class="input" formControlName="region" placeholder="US Equities" />
                  <span class="field__hint">Used as the allocation bucket when no explicit split exists.</span>
                </div>
                <div class="field">
                  <label class="field__label" for="inv-sector">Sector</label>
                  <input id="inv-sector" class="input" formControlName="sector" placeholder="Broad market" />
                </div>
              </div>

              <div class="field">
                <label class="field__label" for="inv-ocf">Ongoing charge (%)</label>
                <input id="inv-ocf" class="input input--num" type="number" step="0.001" formControlName="expensePercent" />
              </div>

              <div class="field">
                <label class="field__label" for="inv-notes">Notes</label>
                <textarea id="inv-notes" class="textarea" formControlName="notes"></textarea>
              </div>

              <div class="row" style="justify-content:space-between; margin-top:4px">
                @if (editingId()) {
                  <button type="button" class="btn btn--quiet btn--sm" (click)="confirmDelete.set(true)">Delete</button>
                } @else {
                  <span></span>
                }
                <div class="row" style="gap:8px">
                  <button type="button" class="btn btn--ghost" (click)="closeEditor()">Cancel</button>
                  <button type="submit" class="btn btn--primary" [disabled]="form.invalid || store.saving()">Save holding</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      }

      @if (txnOpen()) {
        <div class="scrim" (click)="txnOpen.set(false)" role="presentation">
          <div class="dialog" role="dialog" aria-modal="true" aria-label="Investment activity" (click)="$event.stopPropagation()">
            <h2 class="h2">Record activity</h2>

            <form [formGroup]="txnForm" (ngSubmit)="saveActivity()" class="col" style="gap:12px">
              <div class="field">
                <label class="field__label" for="act-holding">Holding</label>
                <select id="act-holding" class="select" formControlName="investmentId">
                  @for (investment of store.data()?.investments ?? []; track investment.id) {
                    <option [value]="investment.id">{{ investment.name }}</option>
                  }
                </select>
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="act-type">Type</label>
                  <select id="act-type" class="select" formControlName="transactionType">
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                    <option value="dividend">Dividend</option>
                    <option value="fee">Fee</option>
                    <option value="interest">Interest</option>
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="act-date">Date</label>
                  <input id="act-date" class="input" type="date" formControlName="transactionDate" />
                </div>
              </div>

              <div class="grid grid--3" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="act-qty">Quantity</label>
                  <input id="act-qty" class="input input--num" type="number" step="0.00000001" formControlName="quantity" />
                </div>
                <div class="field">
                  <label class="field__label" for="act-price">Price</label>
                  <input id="act-price" class="input input--num" type="number" step="0.000001" formControlName="price" />
                </div>
                <div class="field">
                  <label class="field__label" for="act-fees">Fees</label>
                  <input id="act-fees" class="input input--num" type="number" step="0.01" formControlName="fees" />
                </div>
              </div>

              <div class="field">
                <label class="field__label" for="act-amount">Amount</label>
                <input id="act-amount" class="input input--num" type="number" step="0.01" formControlName="amount" />
                <span class="field__hint">For dividends, fees and interest, where quantity × price does not apply.</span>
              </div>

              <div class="row" style="justify-content:flex-end; gap:8px">
                <button type="button" class="btn btn--ghost" (click)="txnOpen.set(false)">Cancel</button>
                <button type="submit" class="btn btn--primary" [disabled]="txnForm.invalid || store.saving()">Record</button>
              </div>
            </form>
          </div>
        </div>
      }

      <sb-confirm
        [open]="confirmDelete()"
        title="Delete this holding?"
        message="Its transaction history will be removed too."
        (confirmed)="remove()"
        (cancelled)="confirmDelete.set(false)"
      />
    </div>
  `,
  styleUrl: './investments.component.scss',
})
export class InvestmentsComponent {
  readonly store = inject(FinanceStore);
  private readonly currency = inject(CurrencyService);
  private readonly fb = inject(FormBuilder);

  readonly Math = Math;
  readonly assetTypes = ASSET_TYPES;
  readonly portfolio = this.store.portfolio;
  readonly allocation = this.store.allocation;

  readonly editorOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly confirmDelete = signal(false);
  readonly txnOpen = signal(false);

  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    ticker: [''],
    isin: [''],
    assetType: ['etf' as AssetType, Validators.required],
    currency: ['EUR', Validators.required],
    quantity: [0, [Validators.required, Validators.min(0)]],
    averageCost: [0, [Validators.required, Validators.min(0)]],
    currentPrice: [0, [Validators.required, Validators.min(0)]],
    region: [''],
    sector: [''],
    expensePercent: [0],
    notes: [''],
  });

  readonly txnForm = this.fb.nonNullable.group({
    investmentId: ['', Validators.required],
    transactionType: ['buy', Validators.required],
    transactionDate: [toIsoDate(new Date()), Validators.required],
    quantity: [0],
    price: [0],
    fees: [0],
    amount: [0],
  });

  /* -- charts -------------------------------------------------------- */

  readonly valueTrend = computed(() =>
    (this.store.data()?.portfolioSnapshots ?? []).slice(-12).map((s) => s.totalValue),
  );

  readonly growthSeries = computed<Series[]>(() => {
    const snapshots = this.store.data()?.portfolioSnapshots ?? [];
    if (!snapshots.length) return [];
    return [
      {
        key: 'value',
        name: 'Portfolio value',
        color: seriesColor(0),
        area: true,
        points: snapshots.map((s) => ({ label: s.snapshotDate, value: s.totalValue })),
      },
      {
        key: 'contributions',
        name: 'Contributions',
        color: seriesColor(1),
        dashed: true,
        points: snapshots.map((s) => ({ label: s.snapshotDate, value: s.totalContributions })),
      },
    ];
  });

  readonly holdingMix = computed(
    () =>
      this.portfolio()?.positions.map((position) => ({
        label: position.investment.ticker ?? position.investment.name,
        value: position.currentValueBase,
      })) ?? [],
  );

  readonly contributionShare = computed(() => {
    const p = this.portfolio();
    if (!p || p.totalValue <= 0) return 0;
    return Math.max(0, Math.min(100, (p.totalContributions / p.totalValue) * 100));
  });

  readonly recentActivity = computed(() =>
    [...(this.store.data()?.investmentTransactions ?? [])]
      .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate))
      .slice(0, 8),
  );

  /** Longest bar in the allocation comparison sets the scale. */
  private readonly allocationMax = computed(() =>
    Math.max(
      10,
      ...this.allocation().flatMap((bucket) => [bucket.actualPercentage, bucket.targetPercentage]),
    ),
  );

  scale(percentage: number): number {
    return (percentage / this.allocationMax()) * 100;
  }

  statusTone(status: 'on-target' | 'overweight' | 'underweight'): string {
    return status === 'on-target' ? 'good' : status === 'overweight' ? 'warn' : 'neutral';
  }

  /* -- editor -------------------------------------------------------- */

  startCreate(): void {
    this.editingId.set(null);
    this.form.reset({
      name: '', ticker: '', isin: '', assetType: 'etf',
      currency: this.currency.baseCurrency(),
      quantity: 0, averageCost: 0, currentPrice: 0,
      region: '', sector: '', expensePercent: 0, notes: '',
    });
    this.editorOpen.set(true);
  }

  startEdit(investment: Investment): void {
    this.editingId.set(investment.id);
    this.form.reset({
      name: investment.name,
      ticker: investment.ticker ?? '',
      isin: investment.isin ?? '',
      assetType: investment.assetType,
      currency: investment.currency,
      quantity: investment.quantity,
      averageCost: investment.averageCost,
      currentPrice: investment.currentPrice,
      region: investment.region ?? '',
      sector: investment.sector ?? '',
      expensePercent: (investment.expenseRatio ?? 0) * 100,
      notes: investment.notes ?? '',
    });
    this.editorOpen.set(true);
  }

  closeEditor(): void {
    this.editorOpen.set(false);
    this.editingId.set(null);
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const values = {
      name: raw.name.trim(),
      ticker: raw.ticker?.trim().toUpperCase() || null,
      isin: raw.isin?.trim().toUpperCase() || null,
      assetType: raw.assetType,
      currency: raw.currency.toUpperCase(),
      quantity: Number(raw.quantity),
      averageCost: Number(raw.averageCost),
      currentPrice: Number(raw.currentPrice),
      region: raw.region?.trim() || null,
      sector: raw.sector?.trim() || null,
      expenseRatio: raw.expensePercent ? Number(raw.expensePercent) / 100 : null,
      priceUpdatedAt: new Date().toISOString(),
      notes: raw.notes?.trim() || null,
    };

    const id = this.editingId();
    const ok = id
      ? await this.store.save('investments', id, values, 'Holding')
      : await this.store.create(
          'investments',
          { ...values, investmentAccountId: this.store.data()?.investmentAccounts[0]?.id ?? null, realisedGain: 0 },
          'Holding',
        );

    if (ok) this.closeEditor();
  }

  async remove(): Promise<void> {
    const id = this.editingId();
    this.confirmDelete.set(false);
    if (!id) return;
    if (await this.store.destroy('investments', id, 'Holding')) this.closeEditor();
  }

  async saveActivity(): Promise<void> {
    if (this.txnForm.invalid) {
      this.txnForm.markAllAsTouched();
      return;
    }
    const raw = this.txnForm.getRawValue();
    const quantity = Number(raw.quantity);
    const price = Number(raw.price);
    const explicitAmount = Number(raw.amount);

    const ok = await this.store.create(
      'investment_transactions',
      {
        investmentId: raw.investmentId,
        transactionType: raw.transactionType,
        transactionDate: raw.transactionDate,
        quantity,
        price,
        amount: explicitAmount > 0 ? explicitAmount : quantity * price,
        fees: Number(raw.fees),
        currency: this.currency.baseCurrency(),
      },
      'Activity',
    );

    if (ok) this.txnOpen.set(false);
  }

  /* -- display ------------------------------------------------------- */

  assetLabel(type: AssetType): string {
    return ASSET_TYPES.find((option) => option.value === type)?.label ?? type;
  }

  investmentName(id: string): string {
    return this.store.investmentsById().get(id)?.name ?? '—';
  }

  money(value: number | null): string {
    return this.currency.format(value);
  }

  moneyIn(value: number, currencyCode: string, signed = false): string {
    return this.currency.formatIn(value, currencyCode, { signed });
  }

  price(value: number, currencyCode: string): string {
    return this.currency.formatIn(value, currencyCode, { decimals: value < 10 ? 4 : 2 });
  }

  qty(value: number): string {
    return value.toLocaleString(this.currency.locale(), { maximumFractionDigits: 4 });
  }

  pct(value: number | null, decimals = 1, signed = false): string {
    return this.currency.percent(value, decimals, signed);
  }

  date(value: string): string {
    return formatDate(value, this.currency.locale());
  }
}
