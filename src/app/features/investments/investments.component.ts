import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { InvestmentAccountView } from '../../core/engine/investment-values';
import { Position } from '../../core/engine/portfolio.engine';
import { CurrencyService } from '../../core/money/currency.service';
import { formatDate, toIsoDate } from '../../core/money/format';
import {
  Account,
  AssetType,
  Investment,
  InvestmentAccount,
  InvestmentTransaction,
  InvestmentTxnType,
} from '../../core/models/domain.models';
import { FinanceStore, WriteOp } from '../../core/state/finance.store';
import { ViewPrefsService } from '../../core/ui/view-prefs.service';
import { Series, seriesColor } from '../../shared/charts/chart-utils';
import { DonutChartComponent } from '../../shared/charts/donut-chart.component';
import { LineChartComponent } from '../../shared/charts/line-chart.component';
import { DialogDirective } from '../../shared/ui/dialog.directive';
import { HumanizePipe, humanize } from '../../shared/ui/humanize.pipe';
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

/** How each kind of activity reads in the history. */
const TXN_LABELS: Record<InvestmentTxnType, string> = {
  buy: 'Bought',
  sell: 'Sold',
  dividend: 'Dividend',
  interest: 'Interest',
  fee: 'Fee',
  deposit: 'Money in',
  withdrawal: 'Money out',
};

/** Cash accounts that are often really an investment account in disguise. */
const MOVABLE_CASH_TYPES: ReadonlySet<string> = new Set(['brokerage_cash', 'savings', 'other']);

type ValueMode = 'total' | 'holdings';
type FlowDirection = 'deposit' | 'withdrawal';

/** One account card: the account figures plus its holdings' positions. */
interface AccountCard {
  view: InvestmentAccountView;
  positions: Position[];
}

@Component({
  selector: 'sb-investments',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
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
          <button type="button" class="btn btn--quiet btn--sm" (click)="startCreate()">Add investment</button>
          <button type="button" class="btn btn--quiet btn--sm" (click)="openActivity()">Record activity</button>
          <button type="button" class="btn btn--ghost btn--sm" (click)="openFlow()">Money in / out</button>
          <button type="button" class="btn btn--primary btn--sm" (click)="startCreateAccount()">Add investment account</button>
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
            [caption]="p.realisedGain !== 0 ? money(p.realisedGain) + ' profit from sales so far' : 'What you have paid in so far'"
          />
          <sb-stat-card
            label="Profit"
            explain="unrealised-gain"
            [value]="p.unrealisedGain"
            [caption]="p.totalCost > 0 ? pct(p.totalReturnPercent, 1, true) + ' on the money you put in' : 'Value minus the money you put in'"
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

        @if (p.staleAccounts > 0) {
          <div class="estimate-note stale-note" role="status">
            <span>
              {{ p.staleAccounts === 1 ? '1 account total is' : p.staleAccounts + ' account totals are' }} over a month old —
              <a routerLink="/check-in" class="inline-link">update them</a> so your numbers stay right.
            </span>
          </div>
        }

        <!-- ------------------------------------------------------- -->
        <sb-section title="Your investment accounts" subtitle="Where your invested money lives — a broker, an app, a pension fund.">
          @if (accountCards().length) {
            <div class="accts">
              @for (card of accountCards(); track card.view.account.id) {
                <article class="acct" [attr.aria-labelledby]="'acct-' + card.view.account.id">
                  <header class="acct__head">
                    <div class="acct__titles">
                      <h3 class="acct__name" [id]="'acct-' + card.view.account.id">{{ card.view.account.name }}</h3>
                      <p class="acct__meta">
                        @if (card.view.account.broker) {
                          {{ card.view.account.broker }} ·
                        }
                        @if (card.view.mode === 'total' && card.view.account.currency !== baseCurrency()) {
                          In {{ card.view.account.currency }} ·
                        }
                        {{ card.view.mode === 'total' ? 'You enter the total' : 'Added up from its investments' }}
                      </p>
                    </div>
                    <div class="acct__value">
                      <div class="acct__amount num">{{ accountValueText(card.view) }}</div>
                      @if (card.view.mode === 'total' && card.view.account.currency !== baseCurrency()) {
                        <div class="acct__sub num">≈ {{ money(card.view.valueBase) }}</div>
                      }
                    </div>
                  </header>

                  <dl class="acct__facts">
                    <div>
                      <dt>Money you put in</dt>
                      <dd class="num">{{ money(card.view.moneyInBase) }}</dd>
                    </div>
                    <div>
                      <dt>Profit</dt>
                      <dd class="num" [class.pos]="card.view.profitBase > 0" [class.neg]="card.view.profitBase < 0">
                        {{ signedMoney(card.view.profitBase) }}
                        @if (card.view.profitPercent !== null) {
                          <span class="acct__pct">{{ pct(card.view.profitPercent, 1, true) }}</span>
                        }
                      </dd>
                    </div>
                    <div>
                      <dt>Share of all investments</dt>
                      <dd class="num">{{ pct(card.view.share) }}</dd>
                    </div>
                    @if (card.view.mode === 'total') {
                      <div>
                        <dt>Value updated</dt>
                        <dd [class.acct__stale]="card.view.stale">
                          {{ updatedText(card.view.valueUpdatedAt) }}
                          @if (card.view.stale) {
                            <span class="badge badge--warn">Update it</span>
                          }
                        </dd>
                      </div>
                    }
                  </dl>

                  <div class="acct__actions">
                    @if (card.view.mode === 'total') {
                      <button type="button" class="btn btn--primary btn--sm" (click)="openValue(card.view)">
                        Update value<span class="sr-only"> of {{ card.view.account.name }}</span>
                      </button>
                      <button type="button" class="btn btn--ghost btn--sm" (click)="openFlow(card.view.account.id)">
                        Money in / out<span class="sr-only"> for {{ card.view.account.name }}</span>
                      </button>
                    } @else if (card.view.holdings.length) {
                      <a routerLink="/check-in" class="btn btn--ghost btn--sm">
                        Update prices<span class="sr-only"> in {{ card.view.account.name }}</span>
                      </a>
                    }
                    <button type="button" class="btn btn--quiet btn--sm" (click)="startEditAccount(card.view.account)">
                      Edit<span class="sr-only"> {{ card.view.account.name }}</span>
                    </button>
                    <button type="button" class="btn btn--quiet btn--sm" (click)="askDeleteAccount(card.view.account)">
                      Delete<span class="sr-only"> {{ card.view.account.name }}</span>
                    </button>
                  </div>

                  <details class="acct__inside" [open]="card.view.holdings.length > 0">
                    <summary>
                      What's inside
                      @if (card.view.holdings.length) {
                        <span class="muted">({{ card.view.holdings.length }})</span>
                      }
                    </summary>

                    <div class="acct__inside-body">
                      @if (card.view.mode === 'holdings') {
                        <p class="micro muted">This account's value is added up from the investments listed here.</p>
                      }

                      @if (card.positions.length) {
                        <ng-container *ngTemplateOutlet="holdingTable; context: { $implicit: card.positions }" />
                      }

                      @if (card.view.mode === 'total') {
                        @if ((card.view.notBrokenDownBase ?? 0) > 0) {
                          <div class="acct__rest">
                            <div>
                              <div class="acct__rest-name">{{ card.positions.length ? 'Not broken down' : 'Whole account' }}</div>
                              <div class="micro muted">Optional — add investments to see what this account holds.</div>
                            </div>
                            <div class="num acct__rest-value">{{ money(card.view.notBrokenDownBase) }}</div>
                          </div>
                        }
                        @if (card.positions.length) {
                          <p class="micro muted">These are a breakdown of the account's total — they aren't added on top.</p>
                        }
                      } @else if (!card.positions.length) {
                        <p class="micro muted">Nothing listed yet, so this account counts as zero.</p>
                      }

                      <div>
                        <button type="button" class="btn btn--ghost btn--sm" (click)="startCreate(card.view.account.id)">
                          Add an investment to this account<span class="sr-only"> ({{ card.view.account.name }})</span>
                        </button>
                      </div>
                    </div>
                  </details>
                </article>
              }
            </div>
          } @else {
            <sb-empty
              title="No investment accounts yet"
              text="An investment account is wherever your invested money lives — a broker, an app, a pension fund. Enter its total value and you're done; listing what's inside is optional."
            >
              <button type="button" class="btn btn--primary btn--sm" (click)="startCreateAccount()">Add investment account</button>
            </sb-empty>
          }

          @if (hasHoldings()) {
            <div slot="foot" class="card__foot">
              Prices are whatever you last entered — Snowball doesn't look up live prices.
              @if (prefs.advanced() && p.weightedExpenseRatio !== null) {
                Average yearly fund fee across everything: {{ pct(p.weightedExpenseRatio, 2) }}.
              }
            </div>
          }
        </sb-section>

        @if (p.unassignedPositions.length) {
          <sb-section
            title="Investments not in an account"
            [subtitle]="accounts().length ? 'Move each one into the account that holds it, so every total counts once.' : 'Each one counts on its own. Add an account to group them.'"
            [flush]="true"
          >
            <ng-container *ngTemplateOutlet="holdingTable; context: { $implicit: p.unassignedPositions, move: accounts().length > 0 }" />
          </sb-section>
        }

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
              <sb-empty title="No history yet" text="This chart fills in month by month as you update your values." />
            }
          </sb-section>

          <sb-section title="How your money is spread" subtitle="What makes up your investments.">
            @if (holdingMix().length) {
              <sb-donut-chart [data]="holdingMix()" centerLabel="Invested" [stacked]="true" ariaLabel="Share of each investment" />
            } @else {
              <sb-empty title="Nothing to show yet" text="Add an investment account to see how your money is spread." />
            }
          </sb-section>
        </div>

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
            <sb-section title="Money put in vs growth" explain="contributions-vs-growth" subtitle="How much you paid in, and how much the market added.">
              <div class="col" style="gap:16px">
                <sb-meter
                  [value]="contributionShare()"
                  label="Money you put in"
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
                  <div><dt>Accounts / investments</dt><dd>{{ p.accounts.length }} / {{ p.positions.length }}</dd></div>
                </dl>
              </div>
            </sb-section>
          }

          <sb-section title="Recent activity" subtitle="Money in and out, buys, sells and dividends you recorded." [flush]="true">
            @if (recentActivity().length) {
              <div class="table-wrap">
                <table class="table table--stack">
                  <thead>
                    <tr><th>Date</th><th>Account or investment</th><th>Type</th><th class="t-right">Amount</th></tr>
                  </thead>
                  <tbody>
                    @for (txn of recentActivity(); track txn.id) {
                      <tr>
                        <td class="num secondary" style="white-space:nowrap">{{ date(txn.transactionDate) }}</td>
                        <td class="truncate" data-label="Account or investment">{{ activitySubject(txn) }}</td>
                        <td data-label="Type">
                          <span class="badge" [class]="'badge badge--' + txnTone(txn.transactionType)">{{ txnLabel(txn.transactionType) }}</span>
                        </td>
                        <td class="num" data-label="Amount">{{ moneyIn(txn.amount ?? txn.quantity * txn.price, txn.currency) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <sb-empty title="Nothing recorded yet" text="Record money you add or take out, and any buys, sells or dividends, to keep your profit right." />
            }
          </sb-section>
        </div>
      }

      <!-- ============================================================ -->
      <!-- Shared table of holdings (inside an account or unassigned)  -->
      <ng-template #holdingTable let-positions let-move="move">
        <div class="table-wrap">
          <table class="table table--stack acct-table">
            <thead>
              <tr>
                <th>Investment</th>
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
              @for (position of asPositions(positions); track position.investment.id) {
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
                      {{ move ? 'Move or edit' : 'Edit' }}<span class="sr-only"> {{ position.investment.name }}</span>
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </ng-template>

      <!-- ============================================================ -->
      <!-- Investment account: create / edit                           -->
      @if (accountOpen()) {
        <div class="scrim" (click)="closeAccount()" role="presentation">
          <div class="dialog dialog--wide" role="dialog" aria-modal="true" aria-labelledby="acct-dialog-title" sbDialog (dismiss)="closeAccount()" (click)="$event.stopPropagation()">
            <h2 class="h2" id="acct-dialog-title">{{ editingAccountId() ? 'Edit investment account' : 'Add investment account' }}</h2>

            <form [formGroup]="accountForm" (ngSubmit)="saveAccount()" class="col" style="gap:12px">
              @if (!editingAccountId() && movableCash().length) {
                <div class="move-box">
                  <div class="field">
                    <label class="field__label" for="acct-import">Already added it under Money &amp; bills? Move it here</label>
                    <select id="acct-import" class="select" formControlName="importFrom">
                      <option value="">No, it's a new one</option>
                      @for (cash of movableCash(); track cash.id) {
                        <option [value]="cash.id">{{ cash.name }} · {{ moneyIn(cash.balance, cash.currency) }} ({{ cash.accountType | humanize }})</option>
                      }
                    </select>
                  </div>
                  @if (importFromId()) {
                    <p class="micro muted">
                      We'll fill in its details below and hide it from Money &amp; bills, so it stops counting as cash
                      you can use and isn't counted twice.
                    </p>
                  }
                </div>
              }

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="acct-name">Name</label>
                  <input id="acct-name" class="input" formControlName="name" placeholder="My investment account" />
                </div>
                <div class="field">
                  <label class="field__label" for="acct-broker">Provider (optional)</label>
                  <input id="acct-broker" class="input" formControlName="broker" placeholder="Trading 212, Vanguard, your pension fund…" />
                </div>
              </div>

              <div class="field" style="max-width:220px">
                <label class="field__label" for="acct-currency">Currency</label>
                <input id="acct-currency" class="input" formControlName="currency" maxlength="3" />
                <span class="field__hint">The currency the provider shows its total in.</span>
              </div>

              <fieldset class="choices">
                <legend class="field__label">How should Snowball value it?</legend>
                <label class="choice" [class.choice--on]="accountMode() === 'total'">
                  <input type="radio" formControlName="mode" value="total" />
                  <span>
                    <span class="choice__title">I'll enter the total (recommended)</span>
                    <span class="choice__text">Type in the value from the app or statement now and then. Listing what's inside is optional.</span>
                  </span>
                </label>
                <label class="choice" [class.choice--on]="accountMode() === 'holdings'">
                  <input type="radio" formControlName="mode" value="holdings" />
                  <span>
                    <span class="choice__title">Add up the investments I list</span>
                    <span class="choice__text">The value is how many of each you own × the price you enter.</span>
                  </span>
                </label>
              </fieldset>

              @if (accountMode() === 'total') {
                <div class="grid grid--2" style="gap:12px">
                  <div class="field">
                    <label class="field__label" for="acct-value">Current value</label>
                    <input id="acct-value" class="input input--num" type="number" step="0.01" min="0" formControlName="currentValue" />
                    <span class="field__hint">The total the provider shows right now.</span>
                  </div>
                  <div class="field">
                    <label class="field__label" for="acct-contributed">Money you've put in so far (optional)</label>
                    <input id="acct-contributed" class="input input--num" type="number" step="0.01" min="0" formControlName="contributedBefore" />
                    <span class="field__hint">
                      @if (editingAccountId()) {
                        Money you paid in before you started recording money in / out here. Used to work out your profit.
                      } @else {
                        Used to work out your profit. Leave empty if you're not sure — we'll count it as all money in, so profit starts at zero.
                      }
                    </span>
                  </div>
                </div>
              } @else {
                <p class="small secondary">
                  After saving, use "Add an investment to this account" on its card to list what it holds.
                </p>
              }

              <div class="field">
                <label class="field__label" for="acct-notes">Notes (optional)</label>
                <textarea id="acct-notes" class="textarea" formControlName="notes"></textarea>
              </div>

              @if (accountError()) {
                <p class="small neg" role="alert">{{ accountError() }}</p>
              }

              <div class="row" style="justify-content:flex-end; gap:8px; margin-top:4px">
                <button type="button" class="btn btn--ghost" (click)="closeAccount()">Cancel</button>
                <button type="submit" class="btn btn--primary" [disabled]="accountForm.invalid || store.saving()">
                  {{ importFromId() ? 'Move to investments' : 'Save account' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- Investment account: update the total ------------------------ -->
      @if (valueAccount(); as account) {
        <div class="scrim" (click)="closeValue()" role="presentation">
          <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="value-dialog-title" sbDialog (dismiss)="closeValue()" (click)="$event.stopPropagation()">
            <h2 class="h2" id="value-dialog-title">Update {{ account.name }}</h2>
            <p class="small secondary">
              Last value: {{ moneyIn(account.currentValue ?? 0, account.currency) }} · {{ updatedText(account.valueUpdatedAt) }}
            </p>

            <form [formGroup]="valueForm" (ngSubmit)="saveValue()" class="col" style="gap:12px">
              <div class="field">
                <label class="field__label" for="value-new">Value now ({{ account.currency }})</label>
                <input id="value-new" class="input input--num" type="number" step="0.01" min="0" formControlName="currentValue" />
                <span class="field__hint">The total the provider shows today.</span>
              </div>

              <div class="field">
                <label class="field__label" for="value-flow">Did you add or take out money since last time?</label>
                <select id="value-flow" class="select" formControlName="flow">
                  <option value="none">No</option>
                  <option value="deposit">Yes, I added money</option>
                  <option value="withdrawal">Yes, I took money out</option>
                </select>
                <span class="field__hint">So a deposit isn't mistaken for profit.</span>
              </div>

              @if (valueFlow() !== 'none') {
                <div class="field">
                  <label class="field__label" for="value-flow-amount">
                    {{ valueFlow() === 'deposit' ? 'How much you added' : 'How much you took out' }} ({{ account.currency }})
                  </label>
                  <input id="value-flow-amount" class="input input--num" type="number" step="0.01" min="0" formControlName="flowAmount" />
                </div>
              }

              @if (valueError()) {
                <p class="small neg" role="alert">{{ valueError() }}</p>
              }

              <div class="row" style="justify-content:flex-end; gap:8px">
                <button type="button" class="btn btn--ghost" (click)="closeValue()">Cancel</button>
                <button type="submit" class="btn btn--primary" [disabled]="valueForm.invalid || store.saving()">Save value</button>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- Investment account: money in / out ------------------------- -->
      @if (flowOpen()) {
        <div class="scrim" (click)="closeFlow()" role="presentation">
          <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="flow-dialog-title" sbDialog (dismiss)="closeFlow()" (click)="$event.stopPropagation()">
            <h2 class="h2" id="flow-dialog-title">Money in / out</h2>

            @if (!accounts().length) {
              <p class="small secondary">
                Money goes in and out of an investment account. Add the account first, then record what you put in or
                took out.
              </p>
              <div class="row" style="justify-content:flex-end; gap:8px">
                <button type="button" class="btn btn--ghost" (click)="closeFlow()">Cancel</button>
                <button type="button" class="btn btn--primary" (click)="closeFlow(); startCreateAccount()">Add an account first</button>
              </div>
            } @else {
              <form [formGroup]="flowForm" (ngSubmit)="saveFlow()" class="col" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="flow-account">Account</label>
                  <select id="flow-account" class="select" formControlName="accountId">
                    @for (account of accounts(); track account.id) {
                      <option [value]="account.id">{{ account.name }}</option>
                    }
                  </select>
                  @if (flowAccount(); as account) {
                    @if (account.currentValue === null) {
                      <span class="field__hint">
                        This account's value is added up from its investments, so this is kept as a record only.
                        Record a buy or sell to change what it holds.
                      </span>
                    } @else {
                      <span class="field__hint">Amounts in {{ account.currency }}. Remember to update its total too.</span>
                    }
                  }
                </div>

                <fieldset class="choices choices--row">
                  <legend class="field__label">What happened</legend>
                  <label class="choice" [class.choice--on]="flowDirection() === 'deposit'">
                    <input type="radio" formControlName="direction" value="deposit" />
                    <span class="choice__title">I put money in</span>
                  </label>
                  <label class="choice" [class.choice--on]="flowDirection() === 'withdrawal'">
                    <input type="radio" formControlName="direction" value="withdrawal" />
                    <span class="choice__title">I took money out</span>
                  </label>
                </fieldset>

                <div class="grid grid--2" style="gap:12px">
                  <div class="field">
                    <label class="field__label" for="flow-amount">Amount</label>
                    <input id="flow-amount" class="input input--num" type="number" step="0.01" min="0" formControlName="amount" />
                  </div>
                  <div class="field">
                    <label class="field__label" for="flow-date">Date</label>
                    <input id="flow-date" class="input" type="date" formControlName="date" />
                  </div>
                </div>

                <div class="field">
                  <label class="field__label" for="flow-notes">Note (optional)</label>
                  <input id="flow-notes" class="input" formControlName="notes" placeholder="Monthly top-up" />
                </div>

                @if (flowError()) {
                  <p class="small neg" role="alert">{{ flowError() }}</p>
                }

                <div class="row" style="justify-content:flex-end; gap:8px">
                  <button type="button" class="btn btn--ghost" (click)="closeFlow()">Cancel</button>
                  <button type="submit" class="btn btn--primary" [disabled]="flowForm.invalid || store.saving()">Record</button>
                </div>
              </form>
            }
          </div>
        </div>
      }

      <!-- Holding: create / edit -------------------------------------- -->
      @if (editorOpen()) {
        <div class="scrim" (click)="closeEditor()" role="presentation">
          <div class="dialog dialog--wide" role="dialog" aria-modal="true" aria-labelledby="inv-dialog-title" sbDialog (dismiss)="closeEditor()" (click)="$event.stopPropagation()">
            <h2 class="h2" id="inv-dialog-title">{{ editingId() ? 'Edit investment' : 'Add investment' }}</h2>

            <form [formGroup]="form" (ngSubmit)="save()" class="col" style="gap:12px">
              <div class="field">
                <label class="field__label" for="inv-name">Name</label>
                <input id="inv-name" class="input" formControlName="name" placeholder="Vanguard S&P 500 ETF" />
              </div>

              <div class="field">
                <label class="field__label" for="inv-account">Account</label>
                <select id="inv-account" class="select" formControlName="investmentAccountId">
                  @for (account of accounts(); track account.id) {
                    <option [value]="account.id">{{ account.name }}</option>
                  }
                  <option value="">Not in an account</option>
                </select>
                @if (holdingAccountIsTotal()) {
                  <span class="field__hint">This is a breakdown — it won't be added on top of the account's total.</span>
                } @else if (!holdingAccountId()) {
                  <span class="field__hint">It will count on its own, outside any account.</span>
                }
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
                  <button type="submit" class="btn btn--primary" [disabled]="form.invalid || store.saving()">Save investment</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- Holding activity: buys, sells, dividends -------------------- -->
      @if (txnOpen()) {
        <div class="scrim" (click)="closeActivity()" role="presentation">
          <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="act-dialog-title" sbDialog (dismiss)="closeActivity()" (click)="$event.stopPropagation()">
            <h2 class="h2" id="act-dialog-title">Record activity</h2>

            @if (!holdings().length) {
              <p class="small secondary">
                Buys, sells and dividends are always about a specific investment. Add the fund or share first, then
                come back to record activity for it. To record money you put into an account, use "Money in / out".
              </p>
              <div class="row row--wrap" style="justify-content:flex-end; gap:8px">
                <button type="button" class="btn btn--ghost" (click)="closeActivity()">Cancel</button>
                @if (accounts().length) {
                  <button type="button" class="btn btn--ghost" (click)="closeActivity(); openFlow()">Money in / out</button>
                }
                <button type="button" class="btn btn--primary" (click)="closeActivity(); startCreate()">Add an investment first</button>
              </div>
            } @else {
              <form [formGroup]="txnForm" (ngSubmit)="saveActivity()" class="col" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="act-holding">Investment</label>
                  <select id="act-holding" class="select" formControlName="investmentId">
                    @for (investment of holdings(); track investment.id) {
                      <option [value]="investment.id">{{ investment.name }}</option>
                    }
                  </select>
                  @if (selectedHolding(); as h) {
                    <span class="field__hint">You own {{ qty(h.quantity) }} · amounts in {{ h.currency }}</span>
                    @if (selectedHoldingInTotal()) {
                      <span class="field__hint">
                        This only changes the breakdown — the account total stays what you entered.
                      </span>
                    }
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
        title="Delete this investment?"
        message="Its recorded buys, sells and dividends will be removed too."
        (confirmed)="remove()"
        (cancelled)="confirmDelete.set(false)"
      />

      <sb-confirm
        [open]="!!deletingAccount()"
        [title]="'Delete ' + (deletingAccount()?.name ?? 'this account') + '?'"
        [message]="deleteAccountMessage()"
        confirmLabel="Delete account"
        (confirmed)="removeAccount()"
        (cancelled)="deletingAccount.set(null)"
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
  readonly baseCurrency = this.currency.baseCurrency;

  readonly editorOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly confirmDelete = signal(false);
  readonly txnOpen = signal(false);
  readonly txnError = signal<string | null>(null);
  readonly planOpen = signal(false);
  readonly planError = signal<string | null>(null);
  /** The optional fields start open when editing a holding that already uses them. */
  readonly moreOpen = signal(false);

  readonly accountOpen = signal(false);
  readonly editingAccountId = signal<string | null>(null);
  readonly accountError = signal<string | null>(null);
  readonly deletingAccount = signal<InvestmentAccount | null>(null);
  readonly valueAccount = signal<InvestmentAccount | null>(null);
  readonly valueError = signal<string | null>(null);
  readonly flowOpen = signal(false);
  readonly flowError = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    investmentAccountId: [''],
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

  readonly accountForm = this.fb.nonNullable.group({
    importFrom: [''],
    name: ['', Validators.required],
    broker: [''],
    currency: ['EUR', [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)]],
    mode: ['total' as ValueMode],
    currentValue: [null as number | null, Validators.min(0)],
    contributedBefore: [null as number | null, Validators.min(0)],
    notes: [''],
  });

  readonly valueForm = this.fb.nonNullable.group({
    currentValue: [0 as number | null, [Validators.required, Validators.min(0)]],
    flow: ['none' as 'none' | FlowDirection],
    flowAmount: [null as number | null, Validators.min(0)],
  });

  readonly flowForm = this.fb.nonNullable.group({
    accountId: ['', Validators.required],
    direction: ['deposit' as FlowDirection],
    amount: [null as number | null, [Validators.required, Validators.min(0)]],
    date: [toIsoDate(new Date()), Validators.required],
    notes: [''],
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
  readonly holdingAccountId = toSignal(this.form.controls.investmentAccountId.valueChanges, {
    initialValue: this.form.controls.investmentAccountId.value,
  });
  readonly accountMode = toSignal(this.accountForm.controls.mode.valueChanges, {
    initialValue: this.accountForm.controls.mode.value,
  });
  readonly importFromId = toSignal(this.accountForm.controls.importFrom.valueChanges, {
    initialValue: this.accountForm.controls.importFrom.value,
  });
  readonly valueFlow = toSignal(this.valueForm.controls.flow.valueChanges, {
    initialValue: this.valueForm.controls.flow.value,
  });
  readonly flowDirection = toSignal(this.flowForm.controls.direction.valueChanges, {
    initialValue: this.flowForm.controls.direction.value,
  });
  private readonly flowAccountId = toSignal(this.flowForm.controls.accountId.valueChanges, {
    initialValue: this.flowForm.controls.accountId.value,
  });

  constructor() {
    // Listen to the form rather than (change) events, so the control
    // already holds the new value when these run.
    this.accountForm.controls.importFrom.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.applyImport());
    this.accountForm.controls.mode.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.onModeChange());
  }

  readonly isTrade = computed(() => TRADES.has(this.txnType()));
  readonly holdings = computed(() => this.store.data()?.investments ?? []);
  readonly hasHoldings = computed(() => this.holdings().length > 0);
  readonly selectedHolding = computed(() => this.store.investmentsById().get(this.txnInvestmentId()) ?? null);
  readonly hasPlan = computed(() => (this.store.data()?.targetAllocations ?? []).length > 0);

  /* -- accounts ------------------------------------------------------ */

  readonly accounts = computed(() =>
    [...(this.store.data()?.investmentAccounts ?? [])].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name),
    ),
  );
  private readonly accountsById = computed(() => new Map(this.accounts().map((a) => [a.id, a])));

  /** Each account with the positions of the holdings listed in it. */
  readonly accountCards = computed<AccountCard[]>(() => {
    const p = this.portfolio();
    if (!p) return [];
    const byId = new Map(p.positions.map((position) => [position.investment.id, position]));
    return p.accounts.map((view) => ({
      view,
      positions: view.holdings
        .map((h) => byId.get(h.id))
        .filter((position): position is Position => !!position)
        .sort((a, b) => b.currentValueBase - a.currentValueBase),
    }));
  });

  readonly holdingAccountIsTotal = computed(() => {
    const account = this.accountsById().get(this.holdingAccountId());
    return !!account && account.currentValue !== null;
  });

  readonly selectedHoldingInTotal = computed(() => {
    const accountId = this.selectedHolding()?.investmentAccountId;
    const account = accountId ? this.accountsById().get(accountId) : undefined;
    return !!account && account.currentValue !== null;
  });

  readonly flowAccount = computed(() => this.accountsById().get(this.flowAccountId()) ?? null);

  /** Cash accounts that could really be an investment account. */
  readonly movableCash = computed<Account[]>(() =>
    (this.store.data()?.accounts ?? []).filter((a) => !a.isArchived && MOVABLE_CASH_TYPES.has(a.accountType)),
  );

  readonly deleteAccountMessage = computed(() => {
    const account = this.deletingAccount();
    if (!account) return '';
    const listed = this.holdings().filter((h) => h.investmentAccountId === account.id).length;
    const parts = ['Its money in / out records will be deleted too.'];
    if (listed) {
      parts.push(
        `The ${listed === 1 ? 'investment' : listed + ' investments'} listed in it will stay, but won't be in an account — they'll then count on their own.`,
      );
    }
    return parts.join(' ');
  });

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

  /** Only draw the "money put in" line when money in was actually recorded. */
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

  /**
   * Every listed investment, plus — for accounts valued as a total — the
   * part of the total nobody has broken down yet.
   */
  readonly holdingMix = computed(() => {
    const p = this.portfolio();
    if (!p) return [];
    const slices = p.positions
      .filter((position) => position.currentValueBase > 0)
      .map((position) => ({
        label: position.investment.ticker ?? position.investment.name,
        value: position.currentValueBase,
      }));
    for (const view of p.accounts) {
      const rest = view.notBrokenDownBase ?? 0;
      if (rest <= 0) continue;
      slices.push({
        label: view.holdings.length ? `${view.account.name} (not broken down)` : view.account.name,
        value: rest,
      });
    }
    return slices.sort((a, b) => b.value - a.value);
  });

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

  /* -- investment account editor ------------------------------------- */

  startCreateAccount(): void {
    this.editingAccountId.set(null);
    this.accountError.set(null);
    this.accountForm.reset({
      importFrom: '',
      name: '',
      broker: '',
      currency: this.currency.baseCurrency(),
      mode: 'total',
      currentValue: null,
      contributedBefore: null,
      notes: '',
    });
    this.accountOpen.set(true);
  }

  startEditAccount(account: InvestmentAccount): void {
    this.editingAccountId.set(account.id);
    this.accountError.set(null);
    this.accountForm.reset({
      importFrom: '',
      name: account.name,
      broker: account.broker ?? '',
      currency: account.currency,
      mode: account.currentValue !== null ? 'total' : 'holdings',
      currentValue: account.currentValue,
      contributedBefore: account.currentValue !== null ? account.contributedBefore ?? 0 : null,
      notes: account.notes ?? '',
    });
    this.accountOpen.set(true);
  }

  closeAccount(): void {
    this.accountOpen.set(false);
    this.editingAccountId.set(null);
    this.accountError.set(null);
  }

  /** Fills the form from the cash account being moved over. */
  applyImport(): void {
    const cash = this.movableCash().find((a) => a.id === this.accountForm.controls.importFrom.value);
    if (!cash) return;
    this.accountForm.patchValue({
      name: cash.name,
      broker: cash.institution ?? '',
      currency: cash.currency,
      mode: 'total',
      currentValue: cash.balance,
      contributedBefore: null,
    });
  }

  /**
   * Switching an existing account from "add up holdings" to "enter the
   * total" starts from what its holdings are worth (and cost) today, so
   * nothing jumps.
   */
  onModeChange(): void {
    const id = this.editingAccountId();
    if (!id || this.accountForm.controls.mode.value !== 'total') return;
    const view = this.portfolio()?.accounts.find((v) => v.account.id === id);
    if (!view || view.mode !== 'holdings') return;
    const controls = this.accountForm.controls;
    const toAccount = (base: number) =>
      round2(this.currency.convert(base, this.currency.baseCurrency(), view.account.currency));
    if (numberOrNull(controls.currentValue.value) === null) controls.currentValue.setValue(toAccount(view.valueBase));
    if (!numberOrNull(controls.contributedBefore.value)) controls.contributedBefore.setValue(toAccount(view.moneyInBase));
  }

  async saveAccount(): Promise<void> {
    this.accountError.set(null);
    if (this.accountForm.invalid) {
      this.accountForm.markAllAsTouched();
      return;
    }
    const raw = this.accountForm.getRawValue();
    const existing = this.editingAccountId() ? this.accountsById().get(this.editingAccountId()!) : undefined;
    const total = raw.mode === 'total';
    const currentValue = total ? numberOrNull(raw.currentValue) : null;
    const currencyCode = raw.currency.trim().toUpperCase();

    if (total && (currentValue === null || currentValue < 0)) {
      this.accountError.set("Enter the account's current value (0 or more).");
      return;
    }

    let contributedBefore = total ? numberOrNull(raw.contributedBefore) : (existing?.contributedBefore ?? 0);
    if (contributedBefore !== null && contributedBefore < 0) {
      this.accountError.set("Money you've put in can't be less than 0.");
      return;
    }
    if (contributedBefore === null) {
      // Not sure? Treat today's value as all money in, so profit starts at zero.
      contributedBefore = existing
        ? Math.max(0, round2(currentValue! - this.netFlows(existing.id, currencyCode)))
        : currentValue!;
    }

    const valueChanged = !existing || existing.currentValue !== currentValue;
    const values = {
      name: raw.name.trim(),
      broker: raw.broker.trim() || null,
      currency: currencyCode,
      currentValue,
      contributedBefore,
      valueUpdatedAt: total ? (valueChanged ? new Date().toISOString() : existing?.valueUpdatedAt ?? null) : null,
      notes: raw.notes.trim() || null,
    };

    let ok: boolean;
    if (existing) {
      ok = await this.store.save('investment_accounts', existing.id, values, 'Investment account');
    } else {
      const sortOrder = Math.max(0, ...this.accounts().map((a) => (a.sortOrder ?? 0) + 1));
      const cash = this.movableCash().find((a) => a.id === raw.importFrom);
      if (cash) {
        ok = await this.store.saveMany(
          [
            { kind: 'create', table: 'investment_accounts', values: { ...values, sortOrder } },
            { kind: 'save', table: 'accounts', id: cash.id, values: { isArchived: true } },
          ],
          `${values.name} moved to investments`,
        );
      } else {
        ok = await this.store.create('investment_accounts', { ...values, sortOrder }, 'Investment account');
      }
    }
    if (ok) this.closeAccount();
  }

  askDeleteAccount(account: InvestmentAccount): void {
    this.deletingAccount.set(account);
  }

  /**
   * Deletes the account and its money in / out records, and leaves its
   * holdings in place without an account. Done explicitly (not left to the
   * database) so the in-browser demo behaves the same.
   */
  async removeAccount(): Promise<void> {
    const account = this.deletingAccount();
    this.deletingAccount.set(null);
    if (!account) return;
    const data = this.store.data();
    const ops: WriteOp[] = [
      ...(data?.investments ?? [])
        .filter((h) => h.investmentAccountId === account.id)
        .map((h): WriteOp => ({ kind: 'save', table: 'investments', id: h.id, values: { investmentAccountId: null } })),
      ...(data?.investmentTransactions ?? [])
        .filter((t) => t.investmentAccountId === account.id && !t.investmentId)
        .map((t): WriteOp => ({ kind: 'destroy', table: 'investment_transactions', id: t.id })),
      { kind: 'destroy', table: 'investment_accounts', id: account.id },
    ];
    await this.store.saveMany(ops, `${account.name} deleted`);
  }

  /** Deposits minus withdrawals recorded for an account, in `currencyCode`. */
  private netFlows(accountId: string, currencyCode: string): number {
    return (this.store.data()?.investmentTransactions ?? [])
      .filter((t) => t.investmentAccountId === accountId)
      .reduce((sum, t) => {
        const amount = this.currency.convert(t.amount ?? 0, t.currency, currencyCode);
        if (t.transactionType === 'deposit') return sum + amount;
        if (t.transactionType === 'withdrawal') return sum - amount;
        return sum;
      }, 0);
  }

  /* -- update an account's total ------------------------------------- */

  openValue(view: InvestmentAccountView): void {
    this.valueError.set(null);
    this.valueForm.reset({ currentValue: view.account.currentValue ?? view.value, flow: 'none', flowAmount: null });
    this.valueAccount.set(view.account);
  }

  closeValue(): void {
    this.valueAccount.set(null);
    this.valueError.set(null);
  }

  async saveValue(): Promise<void> {
    this.valueError.set(null);
    const account = this.valueAccount();
    if (!account) return;
    const raw = this.valueForm.getRawValue();
    const currentValue = numberOrNull(raw.currentValue);
    if (currentValue === null || currentValue < 0) {
      this.valueError.set('Enter the value now (0 or more).');
      return;
    }
    const flowAmount = numberOrNull(raw.flowAmount) ?? 0;
    if (raw.flow !== 'none' && flowAmount <= 0) {
      this.valueError.set('Enter how much money moved — more than 0 — or choose "No".');
      return;
    }

    const ops: WriteOp[] = [
      {
        kind: 'save',
        table: 'investment_accounts',
        id: account.id,
        values: { currentValue, valueUpdatedAt: new Date().toISOString() },
      },
    ];
    if (raw.flow !== 'none') ops.push(this.flowOp(account, raw.flow, flowAmount, toIsoDate(new Date()), null));

    if (await this.store.saveMany(ops, `${account.name} updated`)) this.closeValue();
  }

  /* -- money in / out ------------------------------------------------ */

  openFlow(accountId?: string): void {
    this.flowError.set(null);
    this.flowForm.reset({
      accountId: accountId ?? this.accounts()[0]?.id ?? '',
      direction: 'deposit',
      amount: null,
      date: toIsoDate(new Date()),
      notes: '',
    });
    this.flowOpen.set(true);
  }

  closeFlow(): void {
    this.flowOpen.set(false);
    this.flowError.set(null);
  }

  async saveFlow(): Promise<void> {
    this.flowError.set(null);
    const raw = this.flowForm.getRawValue();
    const account = this.accountsById().get(raw.accountId);
    if (!account) {
      this.flowError.set('Pick the account the money went into or came out of.');
      return;
    }
    const amount = numberOrNull(raw.amount) ?? 0;
    if (amount <= 0) {
      this.flowError.set('Enter an amount more than 0.');
      return;
    }
    const op = this.flowOp(account, raw.direction, amount, raw.date, raw.notes.trim() || null);
    if (await this.store.saveMany([op], raw.direction === 'deposit' ? 'Money in recorded' : 'Money out recorded')) {
      this.closeFlow();
    }
  }

  /** A deposit or withdrawal against an account (no holding involved). */
  private flowOp(
    account: InvestmentAccount,
    direction: FlowDirection,
    amount: number,
    transactionDate: string,
    notes: string | null,
  ): WriteOp {
    return {
      kind: 'create',
      table: 'investment_transactions',
      values: {
        investmentAccountId: account.id,
        investmentId: null,
        transactionType: direction,
        amount: round2(amount),
        quantity: 0,
        price: 0,
        fees: 0,
        currency: account.currency,
        transactionDate,
        notes,
      },
    };
  }

  /* -- holding editor ------------------------------------------------ */

  /** `accountId` preselects the account when adding from its card. */
  startCreate(accountId?: string): void {
    const account = accountId ? this.accountsById().get(accountId) : this.accounts().length === 1 ? this.accounts()[0] : undefined;
    this.editingId.set(null);
    this.moreOpen.set(false);
    this.form.reset({
      name: '', investmentAccountId: account?.id ?? '', ticker: '', isin: '', assetType: 'etf',
      currency: account?.currency ?? this.currency.baseCurrency(),
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
    const accountId = investment.investmentAccountId;
    this.form.reset({
      name: investment.name,
      investmentAccountId: accountId && this.accountsById().has(accountId) ? accountId : '',
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
      investmentAccountId: raw.investmentAccountId || null,
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
      ? await this.store.save('investments', id, values, 'Investment')
      : await this.store.create('investments', { ...values, realisedGain: 0 }, 'Investment');

    if (ok) this.closeEditor();
  }

  async remove(): Promise<void> {
    const id = this.editingId();
    this.confirmDelete.set(false);
    if (!id) return;
    if (await this.store.destroy('investments', id, 'Investment')) this.closeEditor();
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
   * stay in step with what was recorded. Inside an account valued as a
   * total this only changes the breakdown; the total stays as entered.
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
      this.txnError.set('Pick the investment this activity belongs to.');
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
          investmentAccountId: null,
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

  /** Narrows the template outlet's untyped context. */
  asPositions(value: unknown): Position[] {
    return value as Position[];
  }

  assetLabel(type: AssetType): string {
    return ASSET_TYPES.find((option) => option.value === type)?.label ?? type;
  }

  /** A total is shown in the account's own currency; an added-up value in yours. */
  accountValueText(view: InvestmentAccountView): string {
    return view.mode === 'total'
      ? this.currency.formatIn(view.value, view.account.currency, { decimals: 0 })
      : this.money(view.valueBase);
  }

  updatedText(iso: string | null): string {
    if (!iso) return 'Not dated yet';
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days <= 0) return 'Updated today';
    if (days === 1) return 'Updated yesterday';
    if (days < 60) return `Updated ${days} days ago`;
    return `Updated ${Math.round(days / 30)} months ago`;
  }

  /** The account for money in / out, the investment for everything else. */
  activitySubject(txn: InvestmentTransaction): string {
    if (txn.investmentId) return this.store.investmentsById().get(txn.investmentId)?.name ?? '—';
    if (txn.investmentAccountId) return this.accountsById().get(txn.investmentAccountId)?.name ?? '—';
    return '—';
  }

  txnLabel(type: InvestmentTxnType): string {
    return TXN_LABELS[type] ?? humanize(type);
  }

  txnTone(type: InvestmentTxnType): string {
    if (type === 'deposit') return 'brand';
    if (type === 'dividend' || type === 'interest') return 'good';
    return 'neutral';
  }

  money(value: number | null): string {
    return this.currency.format(value, { decimals: 0 });
  }

  signedMoney(value: number): string {
    return this.currency.format(value, { decimals: 0, signed: true });
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

/** A number input's value: '' / null / NaN become null. */
function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
