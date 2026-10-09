import { CommonModule, DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { CurrencyService } from '../../core/money/currency.service';
import { FinanceStore } from '../../core/state/finance.store';
import { ViewPrefsService } from '../../core/ui/view-prefs.service';
import {
  AccountType,
  ExpenseFrequency,
  IncomeFrequency,
  IncomeSource,
  IncomeType,
  RecurringExpense,
} from '../../core/models/domain.models';
import { formatMonthLong, toIsoDate } from '../../core/money/format';
import { BarChartComponent } from '../../shared/charts/bar-chart.component';
import { DonutChartComponent } from '../../shared/charts/donut-chart.component';
import { LineChartComponent } from '../../shared/charts/line-chart.component';
import { RangeKey, Series, applyRange, seriesColor } from '../../shared/charts/chart-utils';
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

/** `label` is what the table shows; `hint` helps pick the right one in the form. */
const ACCOUNT_TYPES: Array<{ value: AccountType; label: string; hint: string }> = [
  { value: 'checking', label: 'Bank account', hint: 'where your pay lands and bills go out' },
  { value: 'savings', label: 'Savings account', hint: 'money put aside, often earning interest' },
  { value: 'brokerage_cash', label: 'Cash in an investment account', hint: 'not yet invested' },
  { value: 'ewallet', label: 'E-wallet', hint: 'PayPal, Revolut and similar' },
  { value: 'physical_cash', label: 'Cash at home', hint: 'notes and coins' },
  { value: 'credit_card', label: 'Credit card', hint: 'the balance is money you owe' },
  { value: 'other', label: 'Other', hint: 'anything else that holds cash' },
];

const INCOME_TYPES: Array<{ value: IncomeType; label: string }> = [
  { value: 'salary', label: 'Salary' },
  { value: 'bonus', label: 'Bonus' },
  { value: 'rental', label: 'Rent from a property' },
  { value: 'investment', label: 'Investment income (dividends, interest)' },
  { value: 'freelance', label: 'Freelance or self-employed' },
  { value: 'other', label: 'Other' },
];

const INCOME_FREQUENCIES: Array<{ value: IncomeFrequency; label: string }> = [
  { value: 'monthly', label: 'Every month' },
  { value: 'quarterly', label: 'Every 3 months' },
  { value: 'annual', label: 'Once a year' },
  { value: 'one_off', label: 'One-off' },
];

/** How much of each payment lands in an average month. One-offs don't recur. */
const PER_MONTH: Record<string, number> = { monthly: 1, quarterly: 1 / 3, annual: 1 / 12, one_off: 0 };

type TabKey = 'accounts' | 'bills' | 'income' | 'history';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'accounts', label: 'Accounts' },
  { key: 'bills', label: 'Bills' },
  { key: 'income', label: 'Income' },
  { key: 'history', label: 'History' },
];

@Component({
  selector: 'sb-cash-flow',
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
    BarChartComponent,
    DonutChartComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="page-head__titles">
          <p class="eyebrow">Accounts, bills and income</p>
          <h1 class="h1">Money &amp; bills</h1>
        </div>
        <div class="page-head__actions">
          <sb-advanced-toggle />
          <button type="button" class="btn btn--ghost btn--sm" (click)="openIncome()">Add income</button>
          <button type="button" class="btn btn--ghost btn--sm" (click)="openExpense()">Add a bill</button>
          <button type="button" class="btn btn--primary btn--sm" (click)="startCreate()">Add account</button>
        </div>
      </header>

      @if (store.isLoading()) {
        <div class="card card--pad"><sb-skeleton [count]="6" /></div>
      } @else if (cash(); as c) {
        <div class="grid grid--stats">
          <sb-stat-card
            label="Cash you can use now"
            explain="liquid-cash"
            [value]="c.liquidTotal"
            [delta]="store.deltas().cash"
            [accent]="true"
          />
          <sb-stat-card
            label="Emergency fund"
            explain="emergency-fund"
            [value]="c.emergencyBalance"
            [caption]="
              c.emergencyTarget > 0
                ? 'Safety cushion ' + money(c.emergencyTarget) + ' · ' + Math.round(c.emergencyProgress) + '% there'
                : 'No safety cushion set yet'
            "
          />
          <sb-stat-card
            label="Above your safety cushion"
            explain="emergency-fund"
            [value]="c.aboveTarget"
            [caption]="
              c.aboveTarget > 0
                ? 'Cash you can use now, beyond your safety cushion'
                : 'Your emergency fund needs ' + money(c.emergencyShortfall) + ' more'
            "
          />
          @if (prefs.advanced()) {
            <sb-stat-card
              label="Interest per year"
              explain="interest-per-year"
              [value]="c.annualInterest"
              [caption]="'Average interest rate ' + pct(c.blendedRate) + ' on cash you can use now'"
            />
          }
        </div>

        <!-- ---------------------------------------------------------- -->
        <!-- Tabs                                                         -->
        <!-- ---------------------------------------------------------- -->
        <div class="tabs" role="tablist" aria-label="Money and bills sections">
          @for (t of tabs; track t.key; let i = $index) {
            <button
              type="button"
              role="tab"
              class="tabs__tab"
              [id]="'cf-tab-' + t.key"
              [attr.aria-selected]="tab() === t.key"
              [attr.aria-controls]="tab() === t.key ? 'cf-panel-' + t.key : null"
              [attr.tabindex]="tab() === t.key ? 0 : -1"
              (click)="selectTab(t.key)"
              (keydown)="onTabKey($event, i)"
            >
              {{ t.label }}
              @if (tabCount(t.key); as count) {
                <span class="tabs__count">{{ count }}</span>
              }
            </button>
          }
        </div>

        <div
          class="tab-panel"
          role="tabpanel"
          tabindex="0"
          [id]="'cf-panel-' + tab()"
          [attr.aria-labelledby]="'cf-tab-' + tab()"
        >
          @switch (tab()) {
            <!-- ======================================================== -->
            <!-- Accounts                                                   -->
            <!-- ======================================================== -->
            @case ('accounts') {
              <sb-section
                title="Accounts"
                subtitle="Each account can count as cash you can use now, as part of your emergency fund, or neither."
                [flush]="true"
              >
                <div slot="actions">
                  <button type="button" class="btn btn--ghost btn--sm" (click)="startCreate()">Add account</button>
                </div>

                @if (c.accounts.length) {
                  <div class="table-wrap">
                    <table class="table table--stack">
                      <thead>
                        <tr>
                          <th>Account</th>
                          <th>Type</th>
                          <th class="t-right">Balance</th>
                          @if (prefs.advanced()) {
                            <th class="t-right">Rate</th>
                            <th class="t-right">Interest / yr</th>
                          }
                          <th class="t-center">Spendable now?</th>
                          <th class="t-center">Emergency fund?</th>
                          @if (prefs.advanced()) {
                            <th class="t-right">Share</th>
                          }
                          <th><span class="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (account of c.accounts; track account.id) {
                          <tr>
                            <td>
                              <div class="table__primary">{{ account.name }}</div>
                              @if (account.institution) {
                                <div class="table__meta">{{ account.institution }}</div>
                              }
                              @if (account.overCeilingBy !== null) {
                                <div class="table__meta neg">
                                  {{ money(account.overCeilingBy) }} over the maximum you want to keep here
                                </div>
                              }
                            </td>
                            <td class="secondary" data-label="Type">{{ typeLabel(account.accountType) }}</td>
                            <td class="num" data-label="Balance">{{ moneyIn(account.balance, account.currency) }}</td>
                            @if (prefs.advanced()) {
                              <td class="num secondary" data-label="Interest rate">
                                {{ account.interestRate > 0 ? pct(account.interestRate * 100, 2) : '—' }}
                              </td>
                              <td class="num secondary" data-label="Interest / yr">
                                {{ account.annualInterest > 0 ? money(account.annualInterest) : '—' }}
                              </td>
                            }
                            <td class="t-center" data-label="Spendable now?">
                              <span aria-hidden="true">{{ account.countsAsLiquid ? '✓' : '—' }}</span>
                              <span class="sr-only">{{ account.countsAsLiquid ? 'Yes' : 'No' }}</span>
                            </td>
                            <td class="t-center" data-label="Emergency fund?">
                              <span aria-hidden="true">{{ account.countsAsEmergencyFund ? '✓' : '—' }}</span>
                              <span class="sr-only">{{ account.countsAsEmergencyFund ? 'Yes' : 'No' }}</span>
                            </td>
                            @if (prefs.advanced()) {
                              <td class="num secondary" data-label="Share">
                                {{ account.countsAsLiquid ? pct(account.shareOfLiquid) : '—' }}
                              </td>
                            }
                            <td class="t-right" data-label="">
                              <button
                                type="button"
                                class="btn btn--quiet btn--sm"
                                [attr.aria-label]="'Edit ' + account.name"
                                (click)="startEdit(account.id)"
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                } @else {
                  <sb-empty
                    title="No accounts yet"
                    text="Add your bank accounts, savings, e-wallets and cash at home to see how much you can use."
                  >
                    <button type="button" class="btn btn--primary btn--sm" (click)="startCreate()">Add account</button>
                  </sb-empty>
                }

                <div slot="foot" class="card__foot">
                  Update these balances whenever you check them, or once a month in the
                  <a routerLink="/check-in">monthly check-in</a>. Snowball works out your everyday spending from how
                  they change — moving money between your own accounts never counts as spending.
                </div>
              </sb-section>

              @if (allocation().length) {
                <sb-section title="Where your cash is" explain="liquid-cash" subtitle="How your cash you can use now is spread across accounts.">
                  <sb-donut-chart [data]="allocation()" centerLabel="Usable now" [stacked]="true" ariaLabel="Cash you can use now, by account" />
                </sb-section>
              }
            }

            <!-- ======================================================== -->
            <!-- Bills                                                      -->
            <!-- ======================================================== -->
            @case ('bills') {
              <div class="grid grid--wide-left">
                <sb-section
                  title="Bills"
                  explain="essential-expenses"
                  subtitle="Costs that repeat — rent, insurance, subscriptions. Add them once; everything else is worked out from your balances."
                  [flush]="true"
                >
                  <div slot="actions">
                    <button type="button" class="btn btn--ghost btn--sm" (click)="openExpense()">Add a bill</button>
                  </div>

                  @if (store.recurringExpenses().length) {
                    <div class="table-wrap">
                      <table class="table table--stack">
                        <thead>
                          <tr>
                            <th>Bill</th>
                            <th>Category</th>
                            <th class="t-right">Amount</th>
                            <th class="t-right">Per month</th>
                            <th><span class="sr-only">Actions</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (expense of store.recurringExpenses(); track expense.id) {
                            <tr>
                              <td>
                                <div class="table__primary">{{ expense.name }}</div>
                                @if (expense.notes) {
                                  <div class="table__meta truncate">{{ expense.notes }}</div>
                                }
                              </td>
                              <td class="secondary" data-label="Category">{{ categoryName(expense.categoryId) }}</td>
                              <td class="num" data-label="Amount">
                                {{ moneyIn(expense.amount, expense.currency) }}
                                <span class="micro muted">{{ frequencyLabel(expense.frequency) }}</span>
                              </td>
                              <td class="num" style="font-weight:600" data-label="Per month">{{ money(perMonth(expense)) }}</td>
                              <td class="t-right" data-label="">
                                <button
                                  type="button"
                                  class="btn btn--quiet btn--sm"
                                  [attr.aria-label]="'Edit ' + expense.name"
                                  (click)="openExpense(expense)"
                                >
                                  Edit
                                </button>
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  } @else {
                    <sb-empty
                      title="No bills added yet"
                      text="Add rent or mortgage, insurance, phone, subscriptions and groceries so Snowball knows what you need each month."
                    >
                      <button type="button" class="btn btn--primary btn--sm" (click)="openExpense()">Add a bill</button>
                    </sb-empty>
                  }
                  @if (store.recurringExpenses().length) {
                    <div slot="foot" class="card__foot total-foot">
                      <span>Fixed monthly bills</span>
                      <strong class="num">{{ money(store.essentialExpenses()) }}</strong>
                    </div>
                  }
                </sb-section>

                <div class="col" style="gap:16px">
                  <sb-section title="Left over after bills" explain="savings-capacity" subtitle="Your monthly income minus your fixed monthly bills.">
                    <div class="col" style="gap:14px">
                      <div class="capacity">
                        <span class="capacity__value">{{ money(capacity()) }}</span>
                        <span class="capacity__label">left each month for everyday spending and saving</span>
                      </div>
                      <sb-meter
                        [value]="capacityRate()"
                        label="Share of income left over"
                        [valueText]="pct(capacityRate())"
                        [tone]="capacityRate() >= 30 ? 'good' : capacityRate() >= 15 ? 'brand' : 'warn'"
                      />
                      <div class="divider"></div>
                      <dl class="mini-facts">
                        <div><dt>Monthly income</dt><dd>{{ money(income()?.monthlyRecurring ?? 0) }}</dd></div>
                        <div><dt>Fixed monthly bills</dt><dd>{{ money(store.essentialExpenses()) }}</dd></div>
                        <div>
                          <dt>Everyday spending <sb-explain key="flexible-spending" /></dt>
                          <dd>{{ hasFlowHistory() ? money(recentFlexible()) : '—' }}</dd>
                        </div>
                        <div><dt>Saved per month</dt><dd>{{ hasFlowHistory() ? money(recentNet()) : '—' }}</dd></div>
                      </dl>
                      <p class="micro muted">
                        Everyday spending is everything that isn't a fixed bill, averaged over the last 3 months. You
                        never list it item by item — Snowball works it out from how your balances changed. It goes up
                        and down from month to month, and that's fine.
                      </p>
                      @if (!income()?.monthlyRecurring) {
                        <button type="button" class="btn btn--ghost btn--sm" (click)="selectTab('income')">Add your income</button>
                      }
                    </div>
                  </sb-section>

                  @if (essentialMix().length) {
                    <sb-section title="What your bills are made of" subtitle="Fixed monthly bills, by category.">
                      <sb-donut-chart [data]="essentialMix()" centerLabel="Per month" [stacked]="true" ariaLabel="Fixed monthly bills by category" />
                    </sb-section>
                  }
                </div>
              </div>
            }

            <!-- ======================================================== -->
            <!-- Income                                                     -->
            <!-- ======================================================== -->
            @case ('income') {
              <sb-section
                title="Income"
                explain="monthly-income"
                subtitle="Money that comes in regularly — your pay, rent from a property, side income."
                [flush]="true"
              >
                <div slot="actions">
                  <button type="button" class="btn btn--ghost btn--sm" (click)="openIncome()">Add income</button>
                </div>

                @if (incomeSources().length) {
                  <div class="table-wrap">
                    <table class="table table--stack">
                      <thead>
                        <tr>
                          <th>Income</th>
                          <th>Type</th>
                          <th class="t-right">Take-home</th>
                          <th class="t-right">Per month</th>
                          <th>Paid into</th>
                          <th><span class="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (source of incomeSources(); track source.id) {
                          <tr [class.is-inactive]="!source.active">
                            <td>
                              <div class="table__primary">
                                {{ source.name }}
                                @if (!source.active) {
                                  <span class="badge badge--neutral">Not active</span>
                                }
                              </div>
                              @if (source.grossAmount) {
                                <div class="table__meta">{{ moneyIn(source.grossAmount, source.currency) }} before tax</div>
                              }
                              @if (source.annualGrowth > 0) {
                                <div class="table__meta">Expected raise {{ pct(source.annualGrowth * 100) }} a year</div>
                              }
                              @if (source.notes) {
                                <div class="table__meta truncate">{{ source.notes }}</div>
                              }
                            </td>
                            <td class="secondary" data-label="Type">{{ incomeTypeLabel(source.incomeType) }}</td>
                            <td class="num" data-label="Take-home">
                              {{ moneyIn(source.amount, source.currency) }}
                              <span class="badge badge--neutral">{{ incomeFrequencyLabel(source.frequency) }}</span>
                            </td>
                            <td class="num" style="font-weight:600" data-label="Per month">
                              {{ source.frequency === 'one_off' || !source.active ? '—' : money(incomePerMonth(source)) }}
                            </td>
                            <td class="secondary" data-label="Paid into">{{ source.accountId ? accountName(source.accountId) : '—' }}</td>
                            <td class="t-right" data-label="">
                              <button
                                type="button"
                                class="btn btn--quiet btn--sm"
                                [attr.aria-label]="'Edit ' + source.name"
                                (click)="openIncome(source)"
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                } @else {
                  <sb-empty
                    title="No income added yet"
                    text="Add your salary or any other money that comes in regularly. Snowball needs it to work out what's left over after bills."
                  >
                    <button type="button" class="btn btn--primary btn--sm" (click)="openIncome()">Add income</button>
                  </sb-empty>
                }
                @if (incomeSources().length) {
                  <div slot="foot" class="card__foot total-foot">
                    <span>Monthly income</span>
                    <strong class="num">{{ money(income()?.monthlyRecurring ?? 0) }}</strong>
                  </div>
                }
              </sb-section>

              <div class="grid grid--wide-left">
                <sb-section title="Monthly pay history" subtitle="What actually came in, month by month.">
                  @if (recentIncome().length) {
                    @if ((incomeSeries()[0]?.points?.length ?? 0) > 1) {
                      <sb-line-chart [series]="incomeSeries()" [height]="220" ariaLabel="Take-home income by month" />
                    }
                    <div class="table-wrap">
                      <table class="table">
                        <thead>
                          <tr><th>Month</th><th class="t-right">Take-home</th></tr>
                        </thead>
                        <tbody>
                          @for (entry of recentIncome(); track entry.month) {
                            <tr>
                              <td>{{ monthLabel(entry.month) }}</td>
                              <td class="num">{{ money(entry.net) }}</td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                    <p class="micro muted" style="margin-top:10px">
                      Each month's pay is recorded in the <a routerLink="/check-in">monthly check-in</a>.
                    </p>
                  } @else {
                    <sb-empty
                      title="No pay recorded yet"
                      text="Each month's pay is recorded in the monthly check-in. Your history builds up from there."
                    >
                      <a class="btn btn--primary btn--sm" routerLink="/check-in">Do your check-in</a>
                    </sb-empty>
                  }
                </sb-section>

                <sb-section title="Income at a glance">
                  @if (income(); as inc) {
                    <dl class="mini-facts">
                      <div><dt>Expected per year</dt><dd>{{ money(inc.annualised) }}</dd></div>
                      <div>
                        <dt>Average month</dt>
                        <dd>{{ inc.completeHistory.length ? money(inc.averageRealised) : '—' }}</dd>
                      </div>
                      <div><dt>vs last year</dt><dd>{{ inc.growth === null ? '—' : pct(inc.growth, 1, true) }}</dd></div>
                      <div><dt>Left over after bills</dt><dd>{{ money(capacity()) }}</dd></div>
                    </dl>
                    <p class="micro muted" style="margin-top:12px">
                      "Average month" covers up to the last 12 full months of recorded pay. "vs last year" needs
                      at least 13 months of history.
                    </p>
                  }
                </sb-section>
              </div>
            }

            <!-- ======================================================== -->
            <!-- History                                                    -->
            <!-- ======================================================== -->
            @case ('history') {
              @if (!cashSeries().length && !flowSeries().length) {
                <sb-section title="History">
                  <sb-empty
                    title="Your history starts with your first check-in"
                    text="Once a month, a quick check-in records your balances and pay. Charts of your cash, income and spending build up here over time."
                  >
                    <a class="btn btn--primary btn--sm" routerLink="/check-in">Do your check-in</a>
                  </sb-empty>
                </sb-section>
              } @else {
                <sb-section title="Cash you can use now, over time" explain="liquid-cash" subtitle="Total of the accounts marked as spendable now, from each balance update.">
                  <div slot="actions">
                    <div class="segmented" role="group" aria-label="Date range">
                      @for (option of ranges; track option) {
                        <button
                          type="button"
                          class="segmented__item"
                          [attr.aria-pressed]="range() === option"
                          (click)="range.set(option)"
                        >
                          {{ rangeLabel(option) }}
                        </button>
                      }
                    </div>
                  </div>

                  @if (cashSeries().length) {
                    <sb-line-chart [series]="cashSeries()" [height]="260" ariaLabel="Cash you can use now, over time" />
                  } @else {
                    <sb-empty title="No balance history yet" text="This chart fills in as you update your balances each month.">
                      <a class="btn btn--primary btn--sm" routerLink="/check-in">Do your check-in</a>
                    </sb-empty>
                  }
                </sb-section>

                <sb-section
                  title="Money in vs money out"
                  explain="total-spending"
                  subtitle="Worked out each month from how your balances changed."
                >
                  @if (flowSeries().length) {
                    <sb-bar-chart
                      [series]="flowSeries()"
                      [overlaySeries]="netSeries()"
                      [height]="280"
                      ariaLabel="Monthly income versus bills and everyday spending"
                    />
                  } @else {
                    <sb-empty
                      title="Not enough history yet"
                      text="This needs at least two monthly check-ins, so Snowball can see how your balances changed."
                    >
                      <a class="btn btn--primary btn--sm" routerLink="/check-in">Do your check-in</a>
                    </sb-empty>
                  }
                </sb-section>
              }
            }
          }
        </div>
      }

      <!-- ============================================================ -->
      <!-- Account editor                                                -->
      <!-- ============================================================ -->
      @if (editorOpen()) {
        <div class="scrim" (click)="closeEditor()" role="presentation">
          <div
            class="dialog dialog--wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="acc-dialog-title"
            sbDialog
            (dismiss)="closeEditor()"
            (click)="$event.stopPropagation()"
          >
            <h2 class="h2" id="acc-dialog-title">{{ editingId() ? 'Edit account' : 'Add account' }}</h2>

            <form [formGroup]="accountForm" (ngSubmit)="saveAccount()" class="col" style="gap:12px">
              <div class="field">
                <label class="field__label" for="acc-name">Name</label>
                <input id="acc-name" class="input" formControlName="name" placeholder="Current account" />
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="acc-type">Type</label>
                  <select id="acc-type" class="select" formControlName="accountType">
                    @for (option of accountTypes; track option.value) {
                      <option [value]="option.value">{{ option.label }} — {{ option.hint }}</option>
                    }
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="acc-currency">Currency</label>
                  <input id="acc-currency" class="input" formControlName="currency" maxlength="3" />
                  <span class="field__hint">3-letter code, e.g. EUR, USD, GBP.</span>
                </div>
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="acc-balance">Balance</label>
                  <input id="acc-balance" class="input input--num" type="number" step="0.01" formControlName="balance" />
                </div>
                <div class="field">
                  <label class="field__label" for="acc-rate">Interest rate per year (%)</label>
                  <input id="acc-rate" class="input input--num" type="number" step="0.01" formControlName="interestPercent" />
                  <span class="field__hint">Leave at 0 if it earns nothing. Update it when your bank changes the rate.</span>
                </div>
              </div>

              <div class="field">
                <label class="field__label" for="acc-institution">Bank or provider</label>
                <input id="acc-institution" class="input" formControlName="institution" placeholder="Optional" />
              </div>

              <div class="field">
                <label class="field__label" for="acc-target">Maximum to keep (optional)</label>
                <input id="acc-target" class="input input--num" type="number" step="1" formControlName="targetBalance" />
                <span class="field__hint">You'll get a nudge when this account holds more than this — handy for cash at home.</span>
              </div>

              <label class="switch">
                <input type="checkbox" formControlName="countsAsLiquid" />
                <span class="switch__track"></span><span class="switch__thumb"></span>
                <span class="small">Spendable now — I could use this money today</span>
              </label>

              <label class="switch">
                <input type="checkbox" formControlName="countsAsEmergencyFund" />
                <span class="switch__track"></span><span class="switch__thumb"></span>
                <span class="small">Part of my emergency fund</span>
              </label>

              <div class="field">
                <label class="field__label" for="acc-notes">Notes</label>
                <textarea id="acc-notes" class="textarea" formControlName="notes"></textarea>
              </div>

              <div class="row" style="justify-content:space-between; margin-top:4px">
                @if (editingId()) {
                  <button type="button" class="btn btn--quiet btn--sm" (click)="confirmDelete.set(true)">Delete</button>
                } @else {
                  <span></span>
                }
                <div class="row" style="gap:8px">
                  <button type="button" class="btn btn--ghost" (click)="closeEditor()">Cancel</button>
                  <button type="submit" class="btn btn--primary" [disabled]="accountForm.invalid || store.saving()">
                    {{ store.saving() ? 'Saving…' : 'Save account' }}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- ============================================================ -->
      <!-- Bill editor                                                   -->
      <!-- ============================================================ -->
      @if (expenseOpen()) {
        <div class="scrim" (click)="closeExpense()" role="presentation">
          <div
            class="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rex-dialog-title"
            sbDialog
            (dismiss)="closeExpense()"
            (click)="$event.stopPropagation()"
          >
            <h2 class="h2" id="rex-dialog-title">{{ editingExpenseId() ? 'Edit bill' : 'Add a bill' }}</h2>
            <p class="small muted">
              Only costs that repeat, like rent, insurance or subscriptions. One-off purchases don't go here — they
              are counted automatically as everyday spending when your balances change.
            </p>

            <form [formGroup]="expenseForm" (ngSubmit)="saveExpense()" class="col" style="gap:12px">
              <div class="field">
                <label class="field__label" for="rex-name">Name</label>
                <input id="rex-name" class="input" formControlName="name" placeholder="Rent" />
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="rex-amount">Amount</label>
                  <input id="rex-amount" class="input input--num" type="number" step="0.01" formControlName="amount" />
                </div>
                <div class="field">
                  <label class="field__label" for="rex-frequency">How often</label>
                  <select id="rex-frequency" class="select" formControlName="frequency">
                    <option value="monthly">Every month</option>
                    <option value="quarterly">Every 3 months</option>
                    <option value="annual">Once a year</option>
                  </select>
                </div>
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="rex-category">Category</label>
                  <select id="rex-category" class="select" formControlName="categoryId">
                    <option value="">Uncategorised</option>
                    @for (category of essentialCategories(); track category.id) {
                      <option [value]="category.id">{{ category.name }}</option>
                    }
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="rex-account">Paid from</label>
                  <select id="rex-account" class="select" formControlName="accountId">
                    <option value="">Any account</option>
                    @for (account of accountOptions(); track account.id) {
                      <option [value]="account.id">{{ account.name }}</option>
                    }
                  </select>
                </div>
              </div>

              <div class="field">
                <label class="field__label" for="rex-notes">Notes</label>
                <textarea id="rex-notes" class="textarea" formControlName="notes"></textarea>
              </div>

              <div class="row" style="justify-content:space-between; margin-top:4px">
                @if (editingExpenseId()) {
                  <button type="button" class="btn btn--quiet btn--sm" (click)="confirmExpenseDelete.set(true)">Delete</button>
                } @else { <span></span> }
                <div class="row" style="gap:8px">
                  <button type="button" class="btn btn--ghost" (click)="closeExpense()">Cancel</button>
                  <button type="submit" class="btn btn--primary" [disabled]="expenseForm.invalid || store.saving()">
                    {{ store.saving() ? 'Saving…' : 'Save bill' }}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- ============================================================ -->
      <!-- Income editor                                                 -->
      <!-- ============================================================ -->
      @if (incomeOpen()) {
        <div class="scrim" (click)="closeIncome()" role="presentation">
          <div
            class="dialog dialog--wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="inc-dialog-title"
            sbDialog
            (dismiss)="closeIncome()"
            (click)="$event.stopPropagation()"
          >
            <h2 class="h2" id="inc-dialog-title">{{ editingIncomeId() ? 'Edit income' : 'Add income' }}</h2>
            <p class="small muted">
              Money that comes in regularly. Enter what actually lands in your account after tax.
            </p>

            <form [formGroup]="incomeForm" (ngSubmit)="saveIncome()" class="col" style="gap:12px">
              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="inc-name">Name</label>
                  <input id="inc-name" class="input" formControlName="name" placeholder="Salary at Acme" />
                </div>
                <div class="field">
                  <label class="field__label" for="inc-type">Type</label>
                  <select id="inc-type" class="select" formControlName="incomeType">
                    @for (option of incomeTypes; track option.value) {
                      <option [value]="option.value">{{ option.label }}</option>
                    }
                  </select>
                </div>
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="inc-amount">Take-home amount</label>
                  <input id="inc-amount" class="input input--num" type="number" step="0.01" min="0" formControlName="amount" />
                  <span class="field__hint">What arrives in your account, after tax.</span>
                </div>
                <div class="field">
                  <label class="field__label" for="inc-gross">Before tax (optional)</label>
                  <input id="inc-gross" class="input input--num" type="number" step="0.01" min="0" formControlName="grossAmount" />
                </div>
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="inc-frequency">How often</label>
                  <select id="inc-frequency" class="select" formControlName="frequency">
                    @for (option of incomeFrequencies; track option.value) {
                      <option [value]="option.value">{{ option.label }}</option>
                    }
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="inc-currency">Currency</label>
                  <input id="inc-currency" class="input" formControlName="currency" maxlength="3" />
                  <span class="field__hint">3-letter code, e.g. EUR, USD, GBP.</span>
                </div>
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="inc-account">Paid into (optional)</label>
                  <select id="inc-account" class="select" formControlName="accountId">
                    <option value="">Not specified</option>
                    @for (account of accountOptions(); track account.id) {
                      <option [value]="account.id">{{ account.name }}</option>
                    }
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="inc-start">Started on</label>
                  <input id="inc-start" class="input" type="date" formControlName="startDate" />
                </div>
              </div>

              <div class="field">
                <label class="field__label" for="inc-growth">Expected yearly raise (optional)</label>
                <input
                  id="inc-growth"
                  class="input input--num"
                  type="number"
                  step="0.1"
                  formControlName="growthPercent"
                  placeholder="e.g. 3"
                />
                <span class="field__hint">In %. Used for looking ahead in Future — leave empty if you don't expect one.</span>
              </div>

              <label class="switch">
                <input type="checkbox" formControlName="active" />
                <span class="switch__track"></span><span class="switch__thumb"></span>
                <span class="small">Still coming in — turn off when it stops (its history is kept)</span>
              </label>

              <div class="field">
                <label class="field__label" for="inc-notes">Notes</label>
                <textarea id="inc-notes" class="textarea" formControlName="notes"></textarea>
              </div>

              <div class="row" style="justify-content:space-between; margin-top:4px">
                @if (editingIncomeId()) {
                  <button type="button" class="btn btn--quiet btn--sm" (click)="confirmIncomeDelete.set(true)">Delete</button>
                } @else { <span></span> }
                <div class="row" style="gap:8px">
                  <button type="button" class="btn btn--ghost" (click)="closeIncome()">Cancel</button>
                  <button type="submit" class="btn btn--primary" [disabled]="incomeForm.invalid || store.saving()">
                    {{ store.saving() ? 'Saving…' : 'Save income' }}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      }

      <sb-confirm
        [open]="confirmExpenseDelete()"
        title="Delete this bill?"
        message="Your fixed monthly bills — and everything worked out from them — will be recalculated without it."
        (confirmed)="deleteExpense()"
        (cancelled)="confirmExpenseDelete.set(false)"
      />

      <sb-confirm
        [open]="confirmIncomeDelete()"
        title="Delete this income?"
        message="Its recorded monthly pay is deleted too. If it has just stopped, edit it and turn off “Still coming in” instead to keep the history."
        (confirmed)="deleteIncome()"
        (cancelled)="confirmIncomeDelete.set(false)"
      />

      <sb-confirm
        [open]="confirmDelete()"
        title="Delete this account?"
        message="Its balance history is deleted too. Bills and income linked to it are kept, but no longer point to an account."
        (confirmed)="deleteAccount()"
        (cancelled)="confirmDelete.set(false)"
      />
    </div>
  `,
  styleUrl: './cash-flow.component.scss',
})
export class CashFlowComponent {
  readonly store = inject(FinanceStore);
  readonly prefs = inject(ViewPrefsService);
  private readonly currency = inject(CurrencyService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  readonly Math = Math;
  readonly accountTypes = ACCOUNT_TYPES;
  readonly incomeTypes = INCOME_TYPES;
  readonly incomeFrequencies = INCOME_FREQUENCIES;
  readonly tabs = TABS;
  readonly ranges: RangeKey[] = ['3M', '6M', '1Y', 'ALL'];
  readonly range = signal<RangeKey>('1Y');

  readonly cash = this.store.cash;
  readonly income = this.store.income;

  readonly editorOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly confirmDelete = signal(false);
  readonly expenseOpen = signal(false);
  readonly editingExpenseId = signal<string | null>(null);
  readonly confirmExpenseDelete = signal(false);
  readonly incomeOpen = signal(false);
  readonly editingIncomeId = signal<string | null>(null);
  readonly confirmIncomeDelete = signal(false);

  /* -- tabs (kept in ?tab= so /cash-flow?tab=income links work) ------ */

  private readonly tabParam = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('tab'))), {
    initialValue: this.route.snapshot.queryParamMap.get('tab'),
  });

  readonly tab = computed<TabKey>(() => {
    const value = this.tabParam();
    return TABS.some((t) => t.key === value) ? (value as TabKey) : 'accounts';
  });

  selectTab(key: TabKey): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: key === 'accounts' ? null : key },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Arrow keys / Home / End move between tabs, as screen-reader users expect. */
  onTabKey(event: KeyboardEvent, index: number): void {
    const last = TABS.length - 1;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = index === last ? 0 : index + 1;
        break;
      case 'ArrowLeft':
        next = index === 0 ? last : index - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    const key = TABS[next].key;
    this.selectTab(key);
    this.document.getElementById(`cf-tab-${key}`)?.focus();
  }

  tabCount(key: TabKey): number | null {
    switch (key) {
      case 'accounts':
        return this.cash()?.accounts.length || null;
      case 'bills':
        return this.store.recurringExpenses().length || null;
      case 'income':
        return this.incomeSources().length || null;
      default:
        return null;
    }
  }

  /* -- forms --------------------------------------------------------- */

  readonly accountForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    accountType: ['checking' as AccountType, Validators.required],
    institution: [''],
    currency: ['EUR', [Validators.required, Validators.minLength(3), Validators.maxLength(3)]],
    balance: [0, Validators.required],
    interestPercent: [0],
    targetBalance: [null as number | null],
    countsAsLiquid: [true],
    countsAsEmergencyFund: [false],
    notes: [''],
  });

  readonly expenseForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    amount: [0, [Validators.required, Validators.min(0)]],
    categoryId: [''],
    accountId: [''],
    frequency: ['monthly' as ExpenseFrequency, Validators.required],
    notes: [''],
  });

  readonly incomeForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    incomeType: ['salary' as IncomeType, Validators.required],
    amount: [0, [Validators.required, Validators.min(0)]],
    grossAmount: [null as number | null, Validators.min(0)],
    frequency: ['monthly' as IncomeFrequency, Validators.required],
    currency: ['EUR', [Validators.required, Validators.minLength(3), Validators.maxLength(3)]],
    accountId: [''],
    startDate: [toIsoDate(new Date()), Validators.required],
    growthPercent: [null as number | null],
    active: [true],
    notes: [''],
  });

  readonly accountOptions = computed(() => this.store.data()?.accounts.filter((a) => !a.isArchived) ?? []);

  /** Active sources first, then by size. */
  readonly incomeSources = computed(() =>
    [...(this.store.data()?.incomeSources ?? [])].sort(
      (a, b) => Number(b.active) - Number(a.active) || this.incomePerMonth(b) - this.incomePerMonth(a),
    ),
  );

  /** Last 12 months of recorded pay (all sources combined), newest first. */
  readonly recentIncome = computed(() => [...(this.income()?.history ?? [])].slice(-12).reverse());

  /* -- charts -------------------------------------------------------- */

  readonly cashSeries = computed<Series[]>(() => {
    const history = this.store.cashHistory();
    if (!history.length) return [];
    const points = applyRange(
      history.map((point) => ({ label: point.date, value: point.value })),
      this.range(),
    );
    const target = this.cash()?.emergencyTarget ?? 0;

    const series: Series[] = [
      { key: 'cash', name: 'Cash you can use now', color: seriesColor(0), area: true, points },
    ];

    // Only plot the cushion when it is within reach — otherwise it sets the
    // y-scale and flattens the cash line into an unreadable smear.
    const peak = Math.max(...points.map((p) => p.value));
    if (target > 0 && peak >= target * 0.35) {
      series.push({
        key: 'target',
        name: 'Safety cushion',
        color: seriesColor(4),
        dashed: true,
        points: points.map((p) => ({ label: p.label, value: target })),
      });
    }
    return series;
  });

  readonly allocation = computed(() => {
    const accounts = this.cash()?.accounts.filter((a) => a.countsAsLiquid && a.balanceBase > 0) ?? [];
    return accounts.map((account) => ({ label: account.name, value: account.balanceBase }));
  });

  readonly flowSeries = computed<Series[]>(() => {
    const flow = this.store.cashFlow();
    if (!flow.length) return [];
    return [
      {
        key: 'income',
        name: 'Income',
        color: seriesColor(0),
        points: flow.map((m) => ({ label: m.month, value: m.income })),
      },
      {
        key: 'essential',
        name: 'Fixed bills',
        color: seriesColor(1),
        points: flow.map((m) => ({ label: m.month, value: m.essential })),
      },
      {
        key: 'flexible',
        name: 'Everyday spending',
        color: seriesColor(4),
        points: flow.map((m) => ({ label: m.month, value: m.flexible })),
      },
    ];
  });

  readonly netSeries = computed<Series | null>(() => {
    const flow = this.store.cashFlow();
    if (!flow.length) return null;
    return {
      key: 'net',
      name: 'Saved',
      color: seriesColor(2),
      points: flow.map((m) => ({ label: m.month, value: m.net })),
    };
  });

  readonly incomeSeries = computed<Series[]>(() => {
    // Complete months only — a part-paid current month reads as a cliff
    // on a line chart. The table below still lists it.
    const history = (this.income()?.completeHistory ?? []).slice(-12);
    if (!history.length) return [];
    return [
      {
        key: 'net',
        name: 'Take-home',
        color: seriesColor(0),
        area: true,
        points: history.map((entry) => ({ label: entry.month, value: entry.net })),
      },
    ];
  });

  /* -- facts --------------------------------------------------------- */

  readonly capacity = computed(() => (this.income()?.monthlyRecurring ?? 0) - this.store.essentialExpenses());

  readonly capacityRate = computed(() => {
    const income = this.income()?.monthlyRecurring ?? 0;
    return income > 0 ? Math.max(0, (this.capacity() / income) * 100) : 0;
  });

  private readonly completedMonths = computed(() => this.store.cashFlow().slice(0, -1));

  readonly hasFlowHistory = computed(() => this.completedMonths().length > 0);
  readonly recentFlexible = computed(() => average(this.completedMonths().slice(-3).map((m) => m.flexible)));
  readonly recentNet = computed(() => average(this.completedMonths().slice(-3).map((m) => m.net)));

  /* -- accounts ------------------------------------------------------- */

  startCreate(): void {
    this.editingId.set(null);
    this.accountForm.reset({
      name: '',
      accountType: 'checking',
      institution: '',
      currency: this.currency.baseCurrency(),
      balance: 0,
      interestPercent: 0,
      targetBalance: null,
      countsAsLiquid: true,
      countsAsEmergencyFund: false,
      notes: '',
    });
    this.editorOpen.set(true);
  }

  startEdit(id: string): void {
    const account = this.store.accountsById().get(id);
    if (!account) return;
    this.editingId.set(id);
    this.accountForm.reset({
      name: account.name,
      accountType: account.accountType,
      institution: account.institution ?? '',
      currency: account.currency,
      balance: account.balance,
      interestPercent: account.interestRate * 100,
      targetBalance: account.targetBalance,
      countsAsLiquid: account.countsAsLiquid,
      countsAsEmergencyFund: account.countsAsEmergencyFund,
      notes: account.notes ?? '',
    });
    this.editorOpen.set(true);
  }

  closeEditor(): void {
    this.editorOpen.set(false);
    this.editingId.set(null);
  }

  async saveAccount(): Promise<void> {
    if (this.accountForm.invalid) {
      this.accountForm.markAllAsTouched();
      return;
    }
    const raw = this.accountForm.getRawValue();
    const values = {
      name: raw.name.trim(),
      accountType: raw.accountType,
      institution: raw.institution?.trim() || null,
      currency: raw.currency.toUpperCase(),
      balance: Number(raw.balance),
      interestRate: Number(raw.interestPercent) / 100,
      targetBalance: raw.targetBalance === null || raw.targetBalance === undefined ? null : Number(raw.targetBalance),
      countsAsLiquid: raw.countsAsLiquid,
      countsAsEmergencyFund: raw.countsAsEmergencyFund,
      notes: raw.notes?.trim() || null,
    };

    const id = this.editingId();
    const ok = id
      ? await this.store.save('accounts', id, values, 'Account')
      : await this.store.create('accounts', { ...values, isArchived: false, sortOrder: 99 }, 'Account');

    if (ok) this.closeEditor();
  }

  async deleteAccount(): Promise<void> {
    const id = this.editingId();
    this.confirmDelete.set(false);
    if (!id) return;
    if (await this.store.destroy('accounts', id, 'Account')) this.closeEditor();
  }

  /* -- bills ---------------------------------------------------------- */

  readonly essentialCategories = computed(() =>
    (this.store.data()?.categories ?? [])
      .filter((c) => c.categoryType === 'essential')
      .sort((a, b) => a.sortOrder - b.sortOrder),
  );

  readonly essentialMix = computed(() =>
    this.store.essentialSpending().map((entry) => ({ label: entry.name, value: entry.amount })),
  );

  /** What a bill costs in an average month. */
  perMonth(expense: RecurringExpense): number {
    const factor = PER_MONTH[expense.frequency] ?? 1;
    return Math.round(this.store.convert()(expense.amount, expense.currency) * factor * 100) / 100;
  }

  frequencyLabel(frequency: ExpenseFrequency): string {
    return frequency === 'monthly' ? '/month' : frequency === 'quarterly' ? 'every 3 months' : '/year';
  }

  categoryName(id: string | null): string {
    return this.store.categoriesById().get(id ?? '')?.name ?? 'Uncategorised';
  }

  accountName(id: string | null): string {
    return this.store.accountsById().get(id ?? '')?.name ?? 'Any account';
  }

  openExpense(expense?: RecurringExpense): void {
    this.editingExpenseId.set(expense?.id ?? null);
    this.expenseForm.reset({
      name: expense?.name ?? '',
      amount: expense?.amount ?? 0,
      categoryId: expense?.categoryId ?? '',
      accountId: expense?.accountId ?? '',
      frequency: expense?.frequency ?? 'monthly',
      notes: expense?.notes ?? '',
    });
    this.expenseOpen.set(true);
  }

  closeExpense(): void {
    this.expenseOpen.set(false);
    this.editingExpenseId.set(null);
  }

  async saveExpense(): Promise<void> {
    if (this.expenseForm.invalid) {
      this.expenseForm.markAllAsTouched();
      return;
    }
    const raw = this.expenseForm.getRawValue();
    const values = {
      name: raw.name.trim(),
      amount: Number(raw.amount),
      currency: this.currency.baseCurrency(),
      categoryId: raw.categoryId || null,
      accountId: raw.accountId || null,
      frequency: raw.frequency,
      notes: raw.notes?.trim() || null,
    };

    const id = this.editingExpenseId();
    const ok = id
      ? await this.store.save('recurring_expenses', id, values, 'Bill')
      : await this.store.create(
          'recurring_expenses',
          { ...values, active: true, startDate: toIsoDate(new Date()), endDate: null, propertyId: null },
          'Bill',
        );
    if (ok) this.closeExpense();
  }

  async deleteExpense(): Promise<void> {
    const id = this.editingExpenseId();
    this.confirmExpenseDelete.set(false);
    if (!id) return;
    if (await this.store.destroy('recurring_expenses', id, 'Bill')) this.closeExpense();
  }

  /* -- income --------------------------------------------------------- */

  openIncome(source?: IncomeSource): void {
    this.editingIncomeId.set(source?.id ?? null);
    this.incomeForm.reset({
      name: source?.name ?? '',
      incomeType: source?.incomeType ?? 'salary',
      amount: source?.amount ?? 0,
      grossAmount: source?.grossAmount ?? null,
      frequency: source?.frequency ?? 'monthly',
      currency: source?.currency ?? this.currency.baseCurrency(),
      accountId: source?.accountId ?? '',
      startDate: source?.startDate ?? toIsoDate(new Date()),
      growthPercent: source?.annualGrowth ? Math.round(source.annualGrowth * 10000) / 100 : null,
      active: source?.active ?? true,
      notes: source?.notes ?? '',
    });
    this.incomeOpen.set(true);
  }

  closeIncome(): void {
    this.incomeOpen.set(false);
    this.editingIncomeId.set(null);
  }

  async saveIncome(): Promise<void> {
    if (this.incomeForm.invalid) {
      this.incomeForm.markAllAsTouched();
      return;
    }
    const raw = this.incomeForm.getRawValue();
    const gross = raw.grossAmount === null || (raw.grossAmount as unknown) === '' ? null : Number(raw.grossAmount);
    const growth = raw.growthPercent === null || (raw.growthPercent as unknown) === '' ? 0 : Number(raw.growthPercent);
    const values = {
      name: raw.name.trim(),
      incomeType: raw.incomeType,
      amount: Number(raw.amount),
      grossAmount: gross,
      currency: raw.currency.trim().toUpperCase(),
      frequency: raw.frequency,
      accountId: raw.accountId || null,
      startDate: raw.startDate || toIsoDate(new Date()),
      annualGrowth: growth / 100,
      active: raw.active,
      notes: raw.notes?.trim() || null,
    };

    const id = this.editingIncomeId();
    const ok = id
      ? await this.store.save('income_sources', id, values, 'Income')
      : await this.store.create('income_sources', { ...values, propertyId: null, endDate: null }, 'Income');
    if (ok) this.closeIncome();
  }

  async deleteIncome(): Promise<void> {
    const id = this.editingIncomeId();
    this.confirmIncomeDelete.set(false);
    if (!id) return;
    if (await this.store.destroy('income_sources', id, 'Income')) this.closeIncome();
  }

  /** What an income source brings in during an average month, in the base currency. */
  incomePerMonth(source: IncomeSource): number {
    const factor = PER_MONTH[source.frequency] ?? 0;
    return Math.round(this.store.convert()(source.amount, source.currency) * factor * 100) / 100;
  }

  incomeTypeLabel(type: IncomeType): string {
    return INCOME_TYPES.find((option) => option.value === type)?.label ?? type;
  }

  incomeFrequencyLabel(frequency: IncomeFrequency): string {
    return INCOME_FREQUENCIES.find((option) => option.value === frequency)?.label ?? frequency;
  }

  /* -- formatting ------------------------------------------------------ */

  typeLabel(type: AccountType): string {
    return ACCOUNT_TYPES.find((option) => option.value === type)?.label ?? type;
  }

  rangeLabel(range: RangeKey): string {
    return range === 'ALL' ? 'All' : range;
  }

  monthLabel(month: string): string {
    return formatMonthLong(month);
  }

  money(value: number | null): string {
    return this.currency.format(value);
  }

  moneyIn(value: number, currency: string): string {
    return this.currency.formatIn(value, currency);
  }

  pct(value: number, decimals = 1, signed = false): string {
    return this.currency.percent(value, decimals, signed);
  }
}

function average(values: number[]): number {
  return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : 0;
}
