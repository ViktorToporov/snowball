import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { CurrencyService } from '../../core/money/currency.service';
import { formatDate, toIsoDate } from '../../core/money/format';
import { AssetType, Investment, InvestmentTxnType } from '../../core/models/domain.models';
import { FinanceStore, WriteOp } from '../../core/state/finance.store';
import { ViewPrefsService } from '../../core/ui/view-prefs.service';
import { Series, seriesColor } from '../../shared/charts/chart-utils';
import { DonutChartComponent } from '../../shared/charts/donut-chart.component';
import { LineChartComponent } from '../../shared/charts/line-chart.component';
import { DialogDirective } from '../../shared/ui/dialog.directive';
import { HumanizePipe } from '../../shared/ui/humanize.pipe';
import { StatCardComponent } from '../../shared/ui/stat-card.component';
import {
  AdvancedToggleComponent,
  ConfirmDialogComponent,
  EmptyStateComponent,
  MeterComponent,
  SectionComponent,
  SkeletonComponent,
} from '../../shared/ui/ui-kit';

const ASSET_TYPES: Array<{ value: AssetType; label: string }> = [
  { value: 'etf', label: 'ETF (index fund)' },
  { value: 'stock', label: 'Company share' },
  { value: 'bond', label: 'Bond' },
  { value: 'mutual_fund', label: 'Fund' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'reit', label: 'Property fund (REIT)' },
  { value: 'commodity', label: 'Gold / commodity' },
  { value: 'other', label: 'Other' },
];

/** Buys and sells change what you hold; the rest are just money in or out. */
const TRADES: ReadonlySet<string> = new Set<InvestmentTxnType>(['buy', 'sell']);

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
    AdvancedToggleComponent,
    DialogDirective,
    HumanizePipe,
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
          <sb-advanced-toggle />
          <button type="button" class="btn btn--ghost btn--sm" (click)="openActivity()">Record a buy or sell</button>
          <button type="button" class="btn btn--primary btn--sm" (click)="startCreate()">Add holding</button>
        </div>
      </header>

      @if (store.isLoading()) {
        <div class="card card--pad"><sb-skeleton [count]="6" /></div>
      } @else if (portfolio(); as p) {
        <div class="grid grid--stats">
          <sb-stat-card label="Total value" explain="portfolio-value" [value]="p.totalValue" [delta]="store.deltas().investments" [trend]="valueTrend()" [accent]="true" />
          <sb-stat-card
            label="Money you put in"
            [value]="p.totalCost"
            [caption]="p.realisedGain !== 0 ? money(p.realisedGain) + ' profit from sales so far' : 'What you paid for what you hold now'"
          />
          <sb-stat-card
            label="Profit on paper (not sold yet)"
            explain="unrealised-gain"
            [value]="p.unrealisedGain"
            [caption]="pct(p.totalReturnPercent, 1, true) + ' on the money you put in'"
            [badge]="p.unrealisedGain >= 0 ? 'Up' : 'Down'"
            [badgeTone]="p.unrealisedGain >= 0 ? 'good' : 'bad'"
          />
          @if (prefs.advanced()) {
            <sb-stat-card
              label="Yearly performance"
              explain="time-weighted-return"
              [value]="p.annualisedReturn"
              format="percent"
              [caption]="p.annualisedReturn === null ? 'Needs more history' : 'Per year — ignores money you added'"
            />
          }
        </div>

        <!-- ------------------------------------------------------- -->
        <div class="grid grid--wide-left">
          <sb-section title="Value over time" explain="contributions-vs-growth" subtitle="What your investments were worth each month.">
            @if (growthSeries().length) {
              <sb-line-chart [series]="growthSeries()" [height]="270" ariaLabel="Investment value over time" />
              @if (hasContributionHistory()) {
                <div class="estimate-note" style="margin-top:14px">
                  <span>
                    The dashed line is money you put in. The gap above it — <strong>{{ money(p.marketGrowth) }}</strong> —
                    is what the market added on top.
                  </span>
                </div>
              }
            } @else {
              <sb-empty title="No history yet" text="This chart fills in month by month as you update your prices." />
            }
          </sb-section>

          <sb-section title="How your money is spread" subtitle="Each holding's share of the total.">
            <sb-donut-chart [data]="holdingMix()" centerLabel="Invested" [stacked]="true" ariaLabel="Share of each holding" />
          </sb-section>
        </div>

        <!-- ------------------------------------------------------- -->
        <sb-section title="Your holdings" subtitle="Worked out from how many you own × the latest price you entered." [flush]="true">
          @if (p.positions.length) {
            <div class="table-wrap">
              <table class="table table--stack">
                <thead>
                  <tr>
                    <th>Holding</th>
                    @if (prefs.advanced()) {
                      <th class="t-right">Quantity</th>
                      <th class="t-right">Paid per share</th>
                      <th class="t-right">Price now</th>
                    }
                    <th class="t-right">Value</th>
                    <th class="t-right">Profit / loss</th>
                    @if (prefs.advanced()) {
                      <th class="t-right">% of portfolio</th>
                    }
                    <th><span class="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (position of p.positions; track position.investment.id) {
                    <tr>
                      <td>
                        <div class="table__primary">{{ position.investment.name }}</div>
                        <div class="table__meta">
                          {{ assetLabel(position.investment.assetType) }}
                          @if (prefs.advanced()) {
                            @if (position.investment.ticker || position.investment.isin) {
                              · {{ position.investment.ticker || position.investment.isin }}
                            }
                            @if (position.investment.expenseRatio) {
                              · {{ pct(position.investment.expenseRatio * 100, 2) }} yearly fund fee
                            }
                          }
                        </div>
                      </td>
                      @if (prefs.advanced()) {
                        <td class="num secondary" data-label="Quantity">{{ qty(position.investment.quantity) }}</td>
                        <td class="num secondary" data-label="Paid per share">{{ price(position.investment.averageCost, position.investment.currency) }}</td>
                        <td class="num" data-label="Price now">{{ price(position.investment.currentPrice, position.investment.currency) }}</td>
                      }
                      <td class="num" style="font-weight:600" data-label="Value">{{ moneyIn(position.currentValue, position.investment.currency) }}</td>
                      <td class="num" data-label="Profit / loss" [class.pos]="position.unrealisedGain > 0" [class.neg]="position.unrealisedGain < 0">
                        {{ moneyIn(position.unrealisedGain, position.investment.currency, true) }}
                        <span class="table__meta">{{ pct(position.returnPercent, 1, true) }}</span>
                      </td>
                      @if (prefs.advanced()) {
                        <td class="num secondary" data-label="% of portfolio">{{ pct(position.shareOfPortfolio) }}</td>
                      }
                      <td class="t-right">
                        <button type="button" class="btn btn--quiet btn--sm" (click)="startEdit(position.investment)">
                          Edit<span class="sr-only"> {{ position.investment.name }}</span>
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

          } @else {
            <sb-empty title="No holdings yet" text="Add a fund, share or other investment you own to see what it's worth.">
              <button type="button" class="btn btn--primary btn--sm" (click)="startCreate()">Add holding</button>
            </sb-empty>
          }

          @if (p.positions.length) {
            <div slot="foot" class="card__foot">
              Prices are whatever you last entered — Snowball doesn't look up live prices.
              @if (prefs.advanced() && p.weightedExpenseRatio !== null) {
                Average yearly fund fee across everything: {{ pct(p.weightedExpenseRatio, 2) }}.
              }
            </div>
          }
        </sb-section>

        <!-- ------------------------------------------------------- -->
        @if (hasPlan() || prefs.advanced()) {
          <sb-section
            title="Your mix vs your plan"
            explain="allocation-drift"
            subtitle="How your money is actually split, compared with the split you planned."
          >
            @if (prefs.advanced()) {
              <div slot="actions">
                <button type="button" class="btn btn--ghost btn--sm" (click)="openPlan()">
                  {{ hasPlan() ? 'Edit plan' : 'Set your plan' }}
                </button>
              </div>
            }

            @if (hasPlan() && allocation().length) {
              <div class="alloc">
                @for (bucket of allocation(); track bucket.bucket) {
                  <div class="alloc__row">
                    <div class="alloc__head">
                      <span class="alloc__name">{{ bucket.bucket }}</span>
                      <span class="badge" [class]="'badge badge--' + statusTone(bucket.status)">
                        {{ statusLabel(bucket.status) }}
                      </span>
                    </div>

                    <div class="alloc__bars">
                      <div class="alloc__bar-label">Plan</div>
                      <div class="alloc__track">
                        <div class="alloc__fill alloc__fill--target" [style.width.%]="scale(bucket.targetPercentage)"></div>
                      </div>
                      <div class="alloc__value num">{{ pct(bucket.targetPercentage) }}</div>

                      <div class="alloc__bar-label">Now</div>
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
                      <span class="num">{{ driftText(bucket.drift) }}</span>
                      @if (prefs.advanced()) {
                        <span class="muted">· fine within ±{{ pct(bucket.toleranceBand, 0) }}</span>
                      }
                    </div>
                  </div>
                }
              </div>
            } @else {
              <sb-empty
                title="No plan yet"
                text="Decide what share of your money should go where (for example 80% shares, 20% bonds), and we'll show how close you are."
              >
                <button type="button" class="btn btn--primary btn--sm" (click)="openPlan()">Set your plan</button>
              </sb-empty>
            }
          </sb-section>
        }

        @if (prefs.advanced() && hasPlan() && store.rebalance().length) {
          <sb-section title="How to get back to your plan" explain="rebalance" subtitle="Roughly how much to buy or sell in each part of your mix.">
            <div slot="actions">
              <span class="micro muted">Suggestions only — Snowball never buys or sells anything for you.</span>
            </div>
            <ul class="rebalance">
              @for (suggestion of store.rebalance(); track suggestion.bucket) {
                <li class="rebalance__item">
                  <div class="rebalance__main">
                    <span class="rebalance__bucket">{{ suggestion.bucket }}</span>
                    <span class="rebalance__detail">
                      Plan: {{ pct(suggestion.targetPercentage) }} · Now: {{ pct(suggestion.actualPercentage) }} ·
                      {{ driftText(suggestion.drift) }}
                    </span>
                  </div>
                  <div class="rebalance__action">
                    <span class="badge" [class]="suggestion.action === 'buy' ? 'badge badge--brand' : 'badge badge--neutral'">
                      {{ suggestion.action === 'buy' ? 'Buy more' : 'Sell some' }}
                    </span>
                    <span class="num rebalance__amount">{{ money(suggestion.amount) }}</span>
                  </div>
                </li>
              }
            </ul>
            <div class="estimate-note" style="margin-top:14px">
              <span>
                <strong>Easiest fix: point new money at what you have too little of.</strong> That way you rarely need to
                sell anything — selling can cost you tax and fees.
              </span>
            </div>
          </sb-section>
        }

        <!-- ------------------------------------------------------- -->
        <div [class]="prefs.advanced() ? 'grid grid--wide-right' : 'grid'">
          @if (prefs.advanced()) {
            <sb-section title="Money put in vs growth" explain="contributions-vs-growth" subtitle="How much you added through recorded buys, and how much the market added.">
              <div class="col" style="gap:16px">
                <sb-meter
                  [value]="contributionShare()"
                  label="Money you put in (recorded buys)"
                  [valueText]="money(p.totalContributions)"
                  tone="brand"
                  [large]="true"
                />
                <sb-meter
                  [value]="100 - contributionShare()"
                  label="Growth from the market"
                  [valueText]="money(p.marketGrowth)"
                  [tone]="p.marketGrowth >= 0 ? 'good' : 'bad'"
                  [large]="true"
                />
                <div class="divider"></div>
                <dl class="mini-facts">
                  <div><dt>Dividends received</dt><dd>{{ money(p.dividendsReceived) }}</dd></div>
                  <div><dt>Fees paid</dt><dd>{{ money(p.feesPaid) }}</dd></div>
                  <div><dt>Profit from sales</dt><dd>{{ money(p.realisedGain) }}</dd></div>
                  <div><dt>Holdings</dt><dd>{{ p.positions.length }}</dd></div>
                </dl>
              </div>
            </sb-section>
          }

          <sb-section title="Recent activity" subtitle="Buys, sells, dividends and fees you recorded." [flush]="true">
            @if (recentActivity().length) {
              <div class="table-wrap">
                <table class="table table--stack">
                  <thead>
                    <tr><th>Date</th><th>Holding</th><th>Type</th><th class="t-right">Amount</th></tr>
                  </thead>
                  <tbody>
                    @for (txn of recentActivity(); track txn.id) {
                      <tr>
                        <td class="num secondary" style="white-space:nowrap">{{ date(txn.transactionDate) }}</td>
                        <td class="truncate" data-label="Holding">{{ investmentName(txn.investmentId) }}</td>
                        <td data-label="Type">
                          <span class="badge badge--neutral">{{ txn.transactionType | humanize }}</span>
                        </td>
                        <td class="num" data-label="Amount">{{ moneyIn(txn.amount ?? txn.quantity * txn.price, txn.currency) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <sb-empty title="Nothing recorded yet" text="Record buys, sells and dividends here to keep your holdings up to date." />
            }
          </sb-section>
        </div>
      }

      <!-- ============================================================ -->
      @if (editorOpen()) {
        <div class="scrim" (click)="closeEditor()" role="presentation">
          <div class="dialog dialog--wide" role="dialog" aria-modal="true" aria-labelledby="inv-dialog-title" sbDialog (dismiss)="closeEditor()" (click)="$event.stopPropagation()">
            <h2 class="h2" id="inv-dialog-title">{{ editingId() ? 'Edit holding' : 'Add holding' }}</h2>

            <form [formGroup]="form" (ngSubmit)="save()" class="col" style="gap:12px">
              <div class="field">
                <label class="field__label" for="inv-name">Name</label>
                <input id="inv-name" class="input" formControlName="name" placeholder="Vanguard S&P 500 ETF" />
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="inv-type">What kind of investment</label>
                  <select id="inv-type" class="select" formControlName="assetType">
                    @for (option of assetTypes; track option.value) {
                      <option [value]="option.value">{{ option.label }}</option>
                    }
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="inv-currency">Currency</label>
                  <input id="inv-currency" class="input" formControlName="currency" maxlength="3" />
                  <span class="field__hint">The currency its price is quoted in, e.g. EUR or USD.</span>
                </div>
              </div>

              <div class="grid grid--3" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="inv-qty">How many you own</label>
                  <input id="inv-qty" class="input input--num" type="number" step="0.00000001" formControlName="quantity" />
                </div>
                <div class="field">
                  <label class="field__label" for="inv-cost">Paid per share (average)</label>
                  <input id="inv-cost" class="input input--num" type="number" step="0.000001" formControlName="averageCost" />
                </div>
                <div class="field">
                  <label class="field__label" for="inv-price">Price now</label>
                  <input id="inv-price" class="input input--num" type="number" step="0.000001" formControlName="currentPrice" />
                </div>
              </div>

              <details class="more" [open]="moreOpen()">
                <summary>More details (optional)</summary>
                <div class="col" style="gap:12px; margin-top:12px">
                  <div class="grid grid--2" style="gap:12px">
                    <div class="field">
                      <label class="field__label" for="inv-ticker">Ticker</label>
                      <input id="inv-ticker" class="input" formControlName="ticker" placeholder="VUAA" />
                      <span class="field__hint">The short code your broker shows.</span>
                    </div>
                    <div class="field">
                      <label class="field__label" for="inv-isin">ISIN</label>
                      <input id="inv-isin" class="input" formControlName="isin" placeholder="IE00BFMXXD54" />
                      <span class="field__hint">12-character fund or share ID.</span>
                    </div>
                  </div>

                  <div class="grid grid--2" style="gap:12px">
                    <div class="field">
                      <label class="field__label" for="inv-region">Part of your plan</label>
                      <input id="inv-region" class="input" formControlName="region" placeholder="US shares" list="inv-buckets" />
                      <span class="field__hint">Which line of your plan this counts towards (e.g. US shares, Bonds).</span>
                    </div>
                    <div class="field">
                      <label class="field__label" for="inv-sector">Sector</label>
                      <input id="inv-sector" class="input" formControlName="sector" placeholder="Broad market" />
                    </div>
                  </div>

                  <div class="field">
                    <label class="field__label" for="inv-ocf">Yearly fund fee (%)</label>
                    <input id="inv-ocf" class="input input--num" type="number" step="0.001" min="0" formControlName="expensePercent" />
                    <span class="field__hint">Called "OCF" or "TER" on fund factsheets. Leave at 0 if unsure.</span>
                  </div>

                  <div class="field">
                    <label class="field__label" for="inv-notes">Notes</label>
                    <textarea id="inv-notes" class="textarea" formControlName="notes"></textarea>
                  </div>
                </div>
              </details>

              <datalist id="inv-buckets">
                @for (bucket of bucketNames(); track bucket) {
                  <option [value]="bucket"></option>
                }
              </datalist>

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
        <div class="scrim" (click)="closeActivity()" role="presentation">
          <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="act-dialog-title" sbDialog (dismiss)="closeActivity()" (click)="$event.stopPropagation()">
            <h2 class="h2" id="act-dialog-title">Record activity</h2>

            @if (!holdings().length) {
              <p class="small secondary">
                Activity is always about something you own. Add the fund or share first, then come back to record
                buys, sells and dividends for it.
              </p>
              <div class="row" style="justify-content:flex-end; gap:8px">
                <button type="button" class="btn btn--ghost" (click)="closeActivity()">Cancel</button>
                <button type="button" class="btn btn--primary" (click)="closeActivity(); startCreate()">Add a holding first</button>
              </div>
            } @else {
              <form [formGroup]="txnForm" (ngSubmit)="saveActivity()" class="col" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="act-holding">Holding</label>
                  <select id="act-holding" class="select" formControlName="investmentId">
                    @for (investment of holdings(); track investment.id) {
                      <option [value]="investment.id">{{ investment.name }}</option>
                    }
                  </select>
                  @if (selectedHolding(); as h) {
                    <span class="field__hint">You own {{ qty(h.quantity) }} · amounts in {{ h.currency }}</span>
                  }
                </div>

                <div class="grid grid--2" style="gap:12px">
                  <div class="field">
                    <label class="field__label" for="act-type">What happened</label>
                    <select id="act-type" class="select" formControlName="transactionType">
                      <option value="buy">Bought more</option>
                      <option value="sell">Sold some</option>
                      <option value="dividend">Received a dividend</option>
                      <option value="interest">Received interest</option>
                      <option value="fee">Paid a fee</option>
                    </select>
                  </div>
                  <div class="field">
                    <label class="field__label" for="act-date">Date</label>
                    <input id="act-date" class="input" type="date" formControlName="transactionDate" />
                  </div>
                </div>

                @if (isTrade()) {
                  <div class="grid grid--3" style="gap:12px">
                    <div class="field">
                      <label class="field__label" for="act-qty">How many</label>
                      <input id="act-qty" class="input input--num" type="number" step="0.00000001" min="0" formControlName="quantity" />
                    </div>
                    <div class="field">
                      <label class="field__label" for="act-price">Price each</label>
                      <input id="act-price" class="input input--num" type="number" step="0.000001" min="0" formControlName="price" />
                    </div>
                    <div class="field">
                      <label class="field__label" for="act-fees">Fees</label>
                      <input id="act-fees" class="input input--num" type="number" step="0.01" min="0" formControlName="fees" />
                    </div>
                  </div>
                } @else {
                  <div class="field">
                    <label class="field__label" for="act-amount">Amount</label>
                    <input id="act-amount" class="input input--num" type="number" step="0.01" min="0" formControlName="amount" />
                  </div>
                }

                @if (txnError()) {
                  <p class="small neg" role="alert">{{ txnError() }}</p>
                }

                <div class="row" style="justify-content:flex-end; gap:8px">
                  <button type="button" class="btn btn--ghost" (click)="closeActivity()">Cancel</button>
                  <button type="submit" class="btn btn--primary" [disabled]="txnForm.invalid || store.saving()">Record</button>
                </div>
              </form>
            }
          </div>
        </div>
      }

      @if (planOpen()) {
        <div class="scrim" (click)="planOpen.set(false)" role="presentation">
          <div class="dialog dialog--wide" role="dialog" aria-modal="true" aria-labelledby="plan-dialog-title" sbDialog (dismiss)="planOpen.set(false)" (click)="$event.stopPropagation()">
            <h2 class="h2" id="plan-dialog-title">Your plan</h2>
            <p class="small secondary">
              Split your investments into parts and say what share each should have. The names should match the
              "Part of your plan" you gave each holding. The shares must add up to 100%.
            </p>

            <form [formGroup]="planForm" (ngSubmit)="savePlan()" class="col" style="gap:10px">
              <div formArrayName="rows" class="col" style="gap:8px">
                <div class="plan-row plan-row--head" aria-hidden="true">
                  <span>Part</span><span>Share (%)</span><span>Fine within ± (%)</span><span></span>
                </div>
                @for (row of planRows.controls; track row; let i = $index) {
                  <div class="plan-row" [formGroupName]="i">
                    <input class="input" formControlName="bucket" placeholder="US shares" list="inv-buckets-plan" [attr.aria-label]="'Part ' + (i + 1) + ' name'" />
                    <input class="input input--num" type="number" step="0.1" min="0" max="100" formControlName="targetPercentage" [attr.aria-label]="'Part ' + (i + 1) + ' share'" />
                    <input class="input input--num" type="number" step="0.5" min="0" max="50" formControlName="toleranceBand" [attr.aria-label]="'Part ' + (i + 1) + ' allowed difference'" />
                    <button type="button" class="btn btn--quiet btn--sm" (click)="removePlanRow(i)">
                      Remove<span class="sr-only"> part {{ i + 1 }}</span>
                    </button>
                  </div>
                }
              </div>

              <datalist id="inv-buckets-plan">
                @for (bucket of bucketNames(); track bucket) {
                  <option [value]="bucket"></option>
                }
              </datalist>

              <div class="row row--between row--wrap">
                <button type="button" class="btn btn--ghost btn--sm" (click)="addPlanRow()">Add a part</button>
                <span class="small num" [class.neg]="!planSumOk()" [class.pos]="planSumOk()">
                  Total: {{ pct(planTotal(), 1) }}{{ planSumOk() ? '' : ' — needs to be 100%' }}
                </span>
              </div>

              @if (planError()) {
                <p class="small neg" role="alert">{{ planError() }}</p>
              }

              <div class="row" style="justify-content:flex-end; gap:8px">
                <button type="button" class="btn btn--ghost" (click)="planOpen.set(false)">Cancel</button>
                <button type="submit" class="btn btn--primary" [disabled]="store.saving()">Save plan</button>
              </div>
            </form>
          </div>
        </div>
      }

      <sb-confirm
        [open]="confirmDelete()"
        title="Delete this holding?"
        message="Its recorded buys, sells and dividends will be removed too."
        (confirmed)="remove()"
        (cancelled)="confirmDelete.set(false)"
      />
    </div>
  `,
  styleUrl: './investments.component.scss',
})
export class InvestmentsComponent {
  readonly store = inject(FinanceStore);
  readonly prefs = inject(ViewPrefsService);
  private readonly currency = inject(CurrencyService);
  private readonly fb = inject(FormBuilder);

  readonly assetTypes = ASSET_TYPES;
  readonly portfolio = this.store.portfolio;
  readonly allocation = this.store.allocation;

  readonly editorOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly confirmDelete = signal(false);
  readonly txnOpen = signal(false);
  readonly txnError = signal<string | null>(null);
  readonly planOpen = signal(false);
  readonly planError = signal<string | null>(null);
  /** The optional fields start open when editing a holding that already uses them. */
  readonly moreOpen = signal(false);

  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    ticker: [''],
    isin: [''],
    assetType: ['etf' as AssetType, Validators.required],
    currency: ['EUR', [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)]],
    quantity: [0, [Validators.required, Validators.min(0)]],
    averageCost: [0, [Validators.required, Validators.min(0)]],
    currentPrice: [0, [Validators.required, Validators.min(0)]],
    region: [''],
    sector: [''],
    expensePercent: [0, Validators.min(0)],
    notes: [''],
  });

  readonly txnForm = this.fb.nonNullable.group({
    investmentId: ['', Validators.required],
    transactionType: ['buy' as InvestmentTxnType, Validators.required],
    transactionDate: [toIsoDate(new Date()), Validators.required],
    quantity: [0, Validators.min(0)],
    price: [0, Validators.min(0)],
    fees: [0, Validators.min(0)],
    amount: [0, Validators.min(0)],
  });

  readonly planForm = this.fb.nonNullable.group({
    rows: this.fb.array([this.planRow()]),
  });

  get planRows(): FormArray {
    return this.planForm.controls.rows as FormArray;
  }

  private readonly txnType = toSignal(this.txnForm.controls.transactionType.valueChanges, {
    initialValue: this.txnForm.controls.transactionType.value,
  });
  private readonly txnInvestmentId = toSignal(this.txnForm.controls.investmentId.valueChanges, {
    initialValue: this.txnForm.controls.investmentId.value,
  });
  private readonly planValues = toSignal(this.planForm.valueChanges, { initialValue: this.planForm.value });

  readonly isTrade = computed(() => TRADES.has(this.txnType()));
  readonly holdings = computed(() => this.store.data()?.investments ?? []);
  readonly selectedHolding = computed(() => this.store.investmentsById().get(this.txnInvestmentId()) ?? null);
  readonly hasPlan = computed(() => (this.store.data()?.targetAllocations ?? []).length > 0);

  /** Plan lines plus whatever your holdings already say they belong to. */
  readonly bucketNames = computed(() => {
    const names = new Set<string>();
    for (const t of this.store.data()?.targetAllocations ?? []) names.add(t.bucket);
    for (const b of this.allocation()) if (b.bucket !== 'Unclassified') names.add(b.bucket);
    return [...names];
  });

  readonly planTotal = computed(() =>
    (this.planValues().rows ?? []).reduce((sum, row) => sum + (Number(row?.targetPercentage) || 0), 0),
  );
  readonly planSumOk = computed(() => Math.abs(this.planTotal() - 100) < 0.01);

  /* -- charts -------------------------------------------------------- */

  readonly valueTrend = computed(() =>
    (this.store.data()?.portfolioSnapshots ?? []).slice(-12).map((s) => s.totalValue),
  );

  /** Only draw the "money put in" line when buys were actually recorded. */
  readonly hasContributionHistory = computed(() =>
    (this.store.data()?.portfolioSnapshots ?? []).some((s) => s.totalContributions > 0),
  );

  readonly growthSeries = computed<Series[]>(() => {
    const snapshots = this.store.data()?.portfolioSnapshots ?? [];
    if (!snapshots.length) return [];
    const series: Series[] = [
      {
        key: 'value',
        name: 'Worth',
        color: seriesColor(0),
        area: true,
        points: snapshots.map((s) => ({ label: s.snapshotDate, value: s.totalValue })),
      },
    ];
    if (this.hasContributionHistory()) {
      series.push({
        key: 'contributions',
        name: 'Money you put in',
        color: seriesColor(1),
        dashed: true,
        points: snapshots.map((s) => ({ label: s.snapshotDate, value: s.totalContributions })),
      });
    }
    return series;
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

  statusLabel(status: 'on-target' | 'overweight' | 'underweight'): string {
    return status === 'on-target' ? 'On plan' : status === 'overweight' ? 'Too much' : 'Too little';
  }

  /** Drift is in percentage points of the whole portfolio. */
  driftText(drift: number): string {
    if (Math.abs(drift) < 0.05) return 'exactly as planned';
    return `${this.pct(Math.abs(drift))} ${drift > 0 ? 'more' : 'less'} than planned`;
  }

  /* -- holding editor ------------------------------------------------ */

  startCreate(): void {
    this.editingId.set(null);
    this.moreOpen.set(false);
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
    this.moreOpen.set(
      !!(investment.ticker || investment.isin || investment.region || investment.sector || investment.expenseRatio || investment.notes),
    );
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
      currency: raw.currency.trim().toUpperCase(),
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

  /* -- activity ------------------------------------------------------ */

  openActivity(): void {
    this.txnError.set(null);
    this.txnForm.reset({
      investmentId: this.holdings()[0]?.id ?? '',
      transactionType: 'buy',
      transactionDate: toIsoDate(new Date()),
      quantity: 0,
      price: 0,
      fees: 0,
      amount: 0,
    });
    this.txnOpen.set(true);
  }

  closeActivity(): void {
    this.txnOpen.set(false);
    this.txnError.set(null);
  }

  /**
   * Records the activity, then — for buys and sells — brings the holding
   * itself up to date so quantity, average cost and profit from sales
   * stay in step with what was recorded.
   */
  async saveActivity(): Promise<void> {
    this.txnError.set(null);
    if (this.txnForm.invalid) {
      this.txnForm.markAllAsTouched();
      return;
    }
    const raw = this.txnForm.getRawValue();
    const holding = this.store.investmentsById().get(raw.investmentId);
    if (!holding) {
      this.txnError.set('Pick the holding this activity belongs to.');
      return;
    }

    const type = raw.transactionType;
    const trade = TRADES.has(type);
    const quantity = trade ? Number(raw.quantity) : 0;
    const price = trade ? Number(raw.price) : 0;
    const fees = trade ? Number(raw.fees) || 0 : 0;
    const amount = trade ? quantity * price : Number(raw.amount);

    if (trade && (quantity <= 0 || price <= 0)) {
      this.txnError.set('Enter how many and the price each — both need to be more than 0.');
      return;
    }
    if (!trade && amount <= 0) {
      this.txnError.set('Enter an amount more than 0.');
      return;
    }
    if (type === 'sell' && quantity > holding.quantity + 1e-9) {
      this.txnError.set(`You can't sell more than you own (${this.qty(holding.quantity)}).`);
      return;
    }

    const ops: WriteOp[] = [
      {
        kind: 'create',
        table: 'investment_transactions',
        values: {
          investmentId: holding.id,
          transactionType: type,
          transactionDate: raw.transactionDate,
          quantity,
          price,
          amount,
          fees,
          currency: holding.currency,
        },
      },
    ];

    // A trade also changes the holding itself.
    if (type === 'buy') {
      const newQuantity = holding.quantity + quantity;
      const averageCost =
        newQuantity > 0 ? (holding.quantity * holding.averageCost + quantity * price + fees) / newQuantity : 0;
      ops.push({ kind: 'save', table: 'investments', id: holding.id, values: { quantity: newQuantity, averageCost } });
    } else if (type === 'sell') {
      const remaining = Math.max(0, holding.quantity - quantity);
      const realisedGain = (holding.realisedGain ?? 0) + quantity * (price - holding.averageCost) - fees;
      ops.push({
        kind: 'save',
        table: 'investments',
        id: holding.id,
        values: { quantity: remaining < 1e-9 ? 0 : remaining, realisedGain },
      });
    }

    if (!(await this.store.saveMany(ops, 'Activity recorded'))) return;
    this.txnOpen.set(false);
  }

  /* -- plan (target allocation) -------------------------------------- */

  private planRow(bucket = '', targetPercentage = 0, toleranceBand = 5, id: string | null = null) {
    return this.fb.nonNullable.group({
      id: [id as string | null],
      bucket: [bucket, Validators.required],
      targetPercentage: [targetPercentage, [Validators.required, Validators.min(0), Validators.max(100)]],
      toleranceBand: [toleranceBand, [Validators.min(0), Validators.max(50)]],
    });
  }

  openPlan(): void {
    this.planError.set(null);
    const existing = [...(this.store.data()?.targetAllocations ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    this.planRows.clear();
    if (existing.length) {
      for (const t of existing) this.planRows.push(this.planRow(t.bucket, t.targetPercentage, t.toleranceBand, t.id));
    } else {
      // Start from what the holdings already say, so the names match.
      const buckets = this.allocation().filter((b) => b.bucket !== 'Unclassified');
      if (buckets.length) {
        for (const b of buckets) this.planRows.push(this.planRow(b.bucket, Math.round(b.actualPercentage)));
      } else {
        this.planRows.push(this.planRow());
      }
    }
    this.planOpen.set(true);
  }

  addPlanRow(): void {
    this.planRows.push(this.planRow());
  }

  removePlanRow(index: number): void {
    this.planRows.removeAt(index);
  }

  async savePlan(): Promise<void> {
    this.planError.set(null);
    const rows = this.planRows.getRawValue() as Array<{
      id: string | null; bucket: string; targetPercentage: number; toleranceBand: number;
    }>;
    const cleaned = rows.map((row, index) => ({
      id: row.id,
      bucket: (row.bucket ?? '').trim(),
      targetPercentage: Number(row.targetPercentage) || 0,
      toleranceBand: Number(row.toleranceBand) || 0,
      sortOrder: index + 1,
    }));

    if (cleaned.some((row) => !row.bucket)) {
      this.planError.set('Give every part a name.');
      return;
    }
    const names = cleaned.map((row) => row.bucket.toLowerCase());
    if (new Set(names).size !== names.length) {
      this.planError.set('Each part needs a different name.');
      return;
    }
    if (cleaned.some((row) => row.targetPercentage < 0 || row.targetPercentage > 100 || row.toleranceBand < 0 || row.toleranceBand > 50)) {
      this.planError.set('Shares go from 0 to 100%, and the allowed difference from 0 to 50%.');
      return;
    }
    if (cleaned.length && !this.planSumOk()) {
      this.planError.set(`The shares add up to ${this.pct(this.planTotal())} — they need to add up to exactly 100%.`);
      return;
    }

    const existing = this.store.data()?.targetAllocations ?? [];
    const keptIds = new Set(cleaned.map((row) => row.id).filter((id): id is string => !!id));

    const ops: WriteOp[] = existing
      .filter((old) => !keptIds.has(old.id))
      .map((old) => ({ kind: 'destroy' as const, table: 'target_allocations' as const, id: old.id }));
    for (const row of cleaned) {
      const values = {
        bucket: row.bucket,
        targetPercentage: row.targetPercentage,
        toleranceBand: row.toleranceBand,
        sortOrder: row.sortOrder,
      };
      const before = row.id ? existing.find((t) => t.id === row.id) : undefined;
      if (!before) {
        ops.push({ kind: 'create', table: 'target_allocations', values });
      } else if (
        before.bucket !== values.bucket ||
        before.targetPercentage !== values.targetPercentage ||
        before.toleranceBand !== values.toleranceBand ||
        before.sortOrder !== values.sortOrder
      ) {
        ops.push({ kind: 'save', table: 'target_allocations', id: before.id, values });
      }
    }

    const ok = ops.length === 0 || (await this.store.saveMany(ops, 'Plan saved'));
    if (ok) this.planOpen.set(false);
  }

  /* -- display ------------------------------------------------------- */

  assetLabel(type: AssetType): string {
    return ASSET_TYPES.find((option) => option.value === type)?.label ?? type;
  }

  investmentName(id: string): string {
    return this.store.investmentsById().get(id)?.name ?? '—';
  }

  money(value: number | null): string {
    return this.currency.format(value, { decimals: 0 });
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
