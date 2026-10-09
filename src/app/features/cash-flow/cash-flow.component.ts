import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { CurrencyService } from '../../core/money/currency.service';
import { FinanceStore } from '../../core/state/finance.store';
import { AccountType, ExpenseFrequency, RecurringExpense } from '../../core/models/domain.models';
import { toIsoDate } from '../../core/money/format';
import { BarChartComponent } from '../../shared/charts/bar-chart.component';
import { DonutChartComponent } from '../../shared/charts/donut-chart.component';
import { LineChartComponent } from '../../shared/charts/line-chart.component';
import { RangeKey, Series, applyRange, seriesColor } from '../../shared/charts/chart-utils';
import { ExplainComponent } from '../../shared/ui/explain.component';
import { StatCardComponent } from '../../shared/ui/stat-card.component';
import {
  ConfirmDialogComponent,
  EmptyStateComponent,
  MeterComponent,
  SectionComponent,
  SkeletonComponent,
} from '../../shared/ui/ui-kit';

const ACCOUNT_TYPES: Array<{ value: AccountType; label: string }> = [
  { value: 'checking', label: 'Bank account' },
  { value: 'savings', label: 'Savings account' },
  { value: 'brokerage_cash', label: 'Brokerage cash' },
  { value: 'ewallet', label: 'E-wallet' },
  { value: 'physical_cash', label: 'Physical cash' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'other', label: 'Other' },
];

@Component({
  selector: 'sb-cash-flow',
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
    BarChartComponent,
    DonutChartComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="page-head__titles">
          <p class="eyebrow">Cash</p>
          <h1 class="h1">Cash flow &amp; accounts</h1>
        </div>
        <div class="page-head__actions">
          <button type="button" class="btn btn--ghost btn--sm" (click)="openExpense()">
            Add recurring expense
          </button>
          <button type="button" class="btn btn--primary btn--sm" (click)="startCreate()">Add account</button>
        </div>
      </header>

      @if (store.isLoading()) {
        <div class="card card--pad"><sb-skeleton [count]="6" /></div>
      } @else if (cash(); as c) {
        <div class="grid grid--stats">
          <sb-stat-card label="Total liquid cash" explain="liquid-cash" [value]="c.liquidTotal" [delta]="store.deltas().cash" [accent]="true" />
          <sb-stat-card
            label="Emergency fund"
            explain="emergency-fund"
            [value]="c.emergencyBalance"
            [caption]="'Target ' + money(c.emergencyTarget) + ' · ' + Math.round(c.emergencyProgress) + '% secured'"
          />
          <sb-stat-card
            label="Above security target"
            explain="available-above-floor"
            [value]="c.aboveTarget"
            [caption]="c.aboveTarget > 0 ? 'Free to allocate' : money(c.emergencyShortfall) + ' still to build'"
          />
          <sb-stat-card
            label="Interest per year"
            explain="interest-per-year"
            [value]="c.annualInterest"
            [caption]="'Blended rate ' + pct(c.blendedRate) + ' across liquid accounts'"
          />
        </div>

        <!-- ---------------------------------------------------------- -->
        <div class="grid grid--wide-left">
          <sb-section title="Cash balance over time" explain="total-cash" subtitle="Total across accounts that count as liquid.">
            <div slot="actions">
              <div class="segmented" role="group" aria-label="Date range">
                @for (option of ranges; track option) {
                  <button
                    type="button"
                    class="segmented__item"
                    [attr.aria-pressed]="range() === option"
                    (click)="range.set(option)"
                  >
                    {{ option }}
                  </button>
                }
              </div>
            </div>

            @if (cashSeries().length) {
              <sb-line-chart [series]="cashSeries()" [height]="260" ariaLabel="Cash balance over time" />
            } @else {
              <sb-empty title="No balance history yet" text="Balances chart here as snapshots accumulate." />
            }
          </sb-section>

          <sb-section title="Cash allocation" explain="currency-conversion" subtitle="How your liquid cash is spread.">
            <sb-donut-chart [data]="allocation()" centerLabel="Liquid" [stacked]="true" ariaLabel="Cash allocation by account" />
          </sb-section>
        </div>

        <!-- ---------------------------------------------------------- -->
        <sb-section title="Accounts" subtitle="Each account can count toward liquid cash, the emergency fund, or neither." [flush]="true">
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Type</th>
                  <th class="t-right">Balance</th>
                  <th class="t-right">Rate</th>
                  <th class="t-right">Interest / yr</th>
                  <th class="t-center">Liquid</th>
                  <th class="t-center">Emergency</th>
                  <th class="t-right">Share</th>
                  <th></th>
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
                        <div class="table__meta neg">{{ money(account.overCeilingBy) }} over its ceiling</div>
                      }
                    </td>
                    <td class="secondary">{{ typeLabel(account.accountType) }}</td>
                    <td class="num">{{ moneyIn(account.balance, account.currency) }}</td>
                    <td class="num secondary">{{ account.interestRate > 0 ? pct(account.interestRate * 100, 2) : '—' }}</td>
                    <td class="num secondary">{{ account.annualInterest > 0 ? money(account.annualInterest) : '—' }}</td>
                    <td class="t-center">{{ account.countsAsLiquid ? '✓' : '—' }}</td>
                    <td class="t-center">{{ account.countsAsEmergencyFund ? '✓' : '—' }}</td>
                    <td class="num secondary">{{ account.countsAsLiquid ? pct(account.shareOfLiquid) : '—' }}</td>
                    <td class="t-right">
                      <button type="button" class="btn btn--quiet btn--sm" (click)="startEdit(account.id)">Edit</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          @if (!c.accounts.length) {
            <sb-empty title="No accounts yet" text="Add your bank, e-wallet and cash accounts to start tracking.">
              <button type="button" class="btn btn--primary btn--sm" (click)="startCreate()">Add account</button>
            </sb-empty>
          }

          <div slot="foot" class="card__foot">
            Update these balances whenever you check them. Snowball works out what you spent from how they
            moved — moving money between your own accounts nets to zero and never looks like spending.
          </div>
        </sb-section>

        <!-- ---------------------------------------------------------- -->
        <div class="grid grid--wide-left">
          <sb-section title="Income vs expenses" explain="total-spending" subtitle="Derived each month from how your balances moved.">
            @if (flowSeries().length) {
              <sb-bar-chart
                [series]="flowSeries()"
                [overlaySeries]="netSeries()"
                [height]="280"
                ariaLabel="Monthly income versus expenses"
              />
            } @else {
              <sb-empty title="No transactions yet" text="Add income and expenses to see the monthly picture." />
            }
          </sb-section>

          <sb-section title="Savings capacity" explain="savings-capacity" subtitle="What is left after essentials, month by month.">
            <div class="col" style="gap:14px">
              <div class="capacity">
                <span class="capacity__value">{{ money(capacity()) }}</span>
                <span class="capacity__label">uncommitted each month at current income and essentials</span>
              </div>
              <sb-meter
                [value]="capacityRate()"
                label="Savings capacity"
                [valueText]="pct(capacityRate())"
                [tone]="capacityRate() >= 30 ? 'good' : capacityRate() >= 15 ? 'brand' : 'warn'"
              />
              <div class="divider"></div>
              <dl class="mini-facts">
                <div><dt>Monthly income</dt><dd>{{ money(income()?.monthlyRecurring ?? 0) }}</dd></div>
                <div><dt>Essential expenses</dt><dd>{{ money(store.essentialExpenses()) }}</dd></div>
                <div>
                  <dt>Avg flexible (3 mo) <sb-explain key="flexible-spending" /></dt>
                  <dd>{{ money(recentFlexible()) }}</dd>
                </div>
                <div><dt>Avg net (3 mo)</dt><dd>{{ money(recentNet()) }}</dd></div>
              </dl>
              <p class="micro muted">
                Flexible spending is never itemised — it is whatever your income did not turn into cash or
                investments, minus the declared baseline. It varies month to month, and that is fine as long as
                the cash strategy stays healthy.
              </p>
            </div>
          </sb-section>
        </div>

        <!-- ---------------------------------------------------------- -->
        <div class="grid grid--wide-left">
          <sb-section
            title="Recurring expenses"
            explain="essential-expenses"
            subtitle="The cost of living you declare once. Everything else is worked out from your balances."
            [flush]="true"
          >
            <div slot="actions">
              <button type="button" class="btn btn--ghost btn--sm" (click)="openExpense()">Add</button>
            </div>

            @if (store.recurringExpenses().length) {
              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Expense</th>
                      <th>Category</th>
                      <th class="t-right">Amount</th>
                      <th class="t-right">Per month</th>
                      <th></th>
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
                        <td class="secondary">{{ categoryName(expense.categoryId) }}</td>
                        <td class="num">
                          {{ moneyIn(expense.amount, expense.currency) }}
                          <span class="micro muted">{{ frequencyLabel(expense.frequency) }}</span>
                        </td>
                        <td class="num" style="font-weight:600">{{ money(perMonth(expense)) }}</td>
                        <td class="t-right">
                          <button type="button" class="btn btn--quiet btn--sm" (click)="openExpense(expense)">Edit</button>
                        </td>
                      </tr>
                    }
                  </tbody>
                  <tfoot>
                    <tr class="total-row">
                      <td colspan="3">Essential baseline</td>
                      <td class="num">{{ money(store.essentialExpenses()) }}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            } @else {
              <sb-empty title="Nothing declared yet" text="Add rent, mortgage, groceries and the rest so Snowball knows your floor.">
                <button type="button" class="btn btn--primary btn--sm" (click)="openExpense()">Add recurring expense</button>
              </sb-empty>
            }
          </sb-section>

          <sb-section title="Essential mix" subtitle="What the declared baseline is made of.">
            @if (essentialMix().length) {
              <sb-donut-chart [data]="essentialMix()" centerLabel="Per month" [stacked]="true" ariaLabel="Essential expenses by category" />
            } @else {
              <sb-empty title="No baseline yet" text="Declare your recurring expenses to see the split." />
            }
          </sb-section>
        </div>

        <!-- ---------------------------------------------------------- -->
        <sb-section title="Income" explain="monthly-income" subtitle="Recurring sources and realised history.">
          <div class="grid grid--wide-left" style="gap:20px">
            <div>
              @if (incomeSeries().length) {
                <sb-line-chart [series]="incomeSeries()" [height]="220" ariaLabel="Salary history" />
              } @else {
                <sb-empty title="No income history" text="Monthly income appears here as it is recorded." />
              }
            </div>
            <div class="col" style="gap:12px">
              @for (source of store.data()?.incomeSources ?? []; track source.id) {
                <div class="income-source">
                  <div class="row row--between">
                    <span class="income-source__name">{{ source.name }}</span>
                    <span class="num" style="font-weight:600">{{ moneyIn(source.amount, source.currency) }}</span>
                  </div>
                  <div class="row" style="gap:8px">
                    <span class="badge badge--neutral">{{ source.frequency }}</span>
                    @if (source.grossAmount) {
                      <span class="micro muted">{{ moneyIn(source.grossAmount, source.currency) }} gross</span>
                    }
                    @if (source.annualGrowth > 0) {
                      <span class="micro muted">+{{ pct(source.annualGrowth * 100) }}/yr expected</span>
                    }
                  </div>
                  @if (source.notes) {
                    <p class="micro muted">{{ source.notes }}</p>
                  }
                </div>
              } @empty {
                <sb-empty title="No income sources" text="Add a salary or other recurring income." />
              }

              @if (income(); as inc) {
                <dl class="mini-facts">
                  <div><dt>Annualised</dt><dd>{{ money(inc.annualised) }}</dd></div>
                  <div><dt>12-month average</dt><dd>{{ money(inc.averageRealised) }}</dd></div>
                  <div><dt>Year-on-year</dt><dd>{{ inc.growth === null ? '—' : pct(inc.growth, 1) }}</dd></div>
                  <div><dt>Income vs expenses</dt><dd>{{ money(capacity()) }}</dd></div>
                </dl>
              }
            </div>
          </div>
        </sb-section>
      }

      <!-- ============================================================ -->
      <!-- Account editor                                                -->
      <!-- ============================================================ -->
      @if (editorOpen()) {
        <div class="scrim" (click)="closeEditor()" role="presentation">
          <div class="dialog" role="dialog" aria-modal="true" aria-label="Account" (click)="$event.stopPropagation()">
            <h2 class="h2">{{ editingId() ? 'Edit account' : 'Add account' }}</h2>

            <form [formGroup]="accountForm" (ngSubmit)="saveAccount()" class="col" style="gap:12px">
              <div class="field">
                <label class="field__label" for="acc-name">Name</label>
                <input id="acc-name" class="input" formControlName="name" placeholder="Current Account" />
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="acc-type">Type</label>
                  <select id="acc-type" class="select" formControlName="accountType">
                    @for (option of accountTypes; track option.value) {
                      <option [value]="option.value">{{ option.label }}</option>
                    }
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="acc-currency">Currency</label>
                  <input id="acc-currency" class="input" formControlName="currency" maxlength="3" />
                </div>
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="acc-balance">Balance</label>
                  <input id="acc-balance" class="input input--num" type="number" step="0.01" formControlName="balance" />
                </div>
                <div class="field">
                  <label class="field__label" for="acc-rate">Interest rate (APY %)</label>
                  <input id="acc-rate" class="input input--num" type="number" step="0.01" formControlName="interestPercent" />
                  <span class="field__hint">Variable rates change — update this when yours does.</span>
                </div>
              </div>

              <div class="field">
                <label class="field__label" for="acc-institution">Institution</label>
                <input id="acc-institution" class="input" formControlName="institution" placeholder="Optional" />
              </div>

              <div class="field">
                <label class="field__label" for="acc-target">Ceiling / target balance</label>
                <input id="acc-target" class="input input--num" type="number" step="1" formControlName="targetBalance" />
                <span class="field__hint">Optional. Physical cash accounts warn when they go above this.</span>
              </div>

              <label class="switch">
                <input type="checkbox" formControlName="countsAsLiquid" />
                <span class="switch__track"></span><span class="switch__thumb"></span>
                <span class="small">Counts toward liquid cash</span>
              </label>

              <label class="switch">
                <input type="checkbox" formControlName="countsAsEmergencyFund" />
                <span class="switch__track"></span><span class="switch__thumb"></span>
                <span class="small">Counts toward the emergency fund</span>
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

      @if (expenseOpen()) {
        <div class="scrim" (click)="expenseOpen.set(false)" role="presentation">
          <div class="dialog" role="dialog" aria-modal="true" aria-label="Recurring expense" (click)="$event.stopPropagation()">
            <h2 class="h2">{{ editingExpenseId() ? 'Edit recurring expense' : 'Add recurring expense' }}</h2>
            <p class="small muted">
              Only things that repeat. One-offs do not belong here — they show up automatically as flexible
              spending when your balances move.
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
                  <label class="field__label" for="rex-frequency">Frequency</label>
                  <select id="rex-frequency" class="select" formControlName="frequency">
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annual">Annual</option>
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
                  <button type="button" class="btn btn--ghost" (click)="expenseOpen.set(false)">Cancel</button>
                  <button type="submit" class="btn btn--primary" [disabled]="expenseForm.invalid || store.saving()">Save</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      }

      <sb-confirm
        [open]="confirmExpenseDelete()"
        title="Delete this recurring expense?"
        message="Your essential baseline — and everything measured against it — will be recalculated without it."
        (confirmed)="deleteExpense()"
        (cancelled)="confirmExpenseDelete.set(false)"
      />

      <sb-confirm
        [open]="confirmDelete()"
        title="Delete this account?"
        message="Transactions that reference it will be kept but lose their account link."
        (confirmed)="deleteAccount()"
        (cancelled)="confirmDelete.set(false)"
      />
    </div>
  `,
  styleUrl: './cash-flow.component.scss',
})
export class CashFlowComponent {
  readonly store = inject(FinanceStore);
  private readonly currency = inject(CurrencyService);
  private readonly fb = inject(FormBuilder);

  readonly Math = Math;
  readonly accountTypes = ACCOUNT_TYPES;
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

  readonly accountOptions = computed(() => this.store.data()?.accounts.filter((a) => !a.isArchived) ?? []);

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
      { key: 'cash', name: 'Liquid cash', color: seriesColor(0), area: true, points },
    ];

    // Only plot the floor when it is within reach — otherwise it sets the
    // y-scale and flattens the cash line into an unreadable smear.
    const peak = Math.max(...points.map((p) => p.value));
    if (target > 0 && peak >= target * 0.35) {
      series.push({
        key: 'target',
        name: 'Security floor',
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
        name: 'Essential',
        color: seriesColor(1),
        points: flow.map((m) => ({ label: m.month, value: m.essential })),
      },
      {
        key: 'flexible',
        name: 'Flexible',
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
      name: 'Net',
      color: seriesColor(2),
      points: flow.map((m) => ({ label: m.month, value: m.net })),
    };
  });

  readonly incomeSeries = computed<Series[]>(() => {
    // Complete months only — a part-paid current month reads as a cliff
    // on a line chart. The bar chart above shows it in context instead.
    const history = this.income()?.completeHistory ?? [];
    if (!history.length) return [];
    return [
      {
        key: 'net',
        name: 'Net income',
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
    return income > 0 ? (this.capacity() / income) * 100 : 0;
  });

  private readonly completedMonths = computed(() => this.store.cashFlow().slice(0, -1));

  readonly recentFlexible = computed(() => average(this.completedMonths().slice(-3).map((m) => m.flexible)));
  readonly recentNet = computed(() => average(this.completedMonths().slice(-3).map((m) => m.net)));

  /* -- actions -------------------------------------------------------- */

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

  readonly essentialCategories = computed(() =>
    (this.store.data()?.categories ?? [])
      .filter((c) => c.categoryType === 'essential')
      .sort((a, b) => a.sortOrder - b.sortOrder),
  );

  readonly essentialMix = computed(() =>
    this.store.essentialSpending().map((entry) => ({ label: entry.name, value: entry.amount })),
  );

  /** What a recurring expense costs in an average month. */
  perMonth(expense: RecurringExpense): number {
    const factor = expense.frequency === 'monthly' ? 1 : expense.frequency === 'quarterly' ? 1 / 3 : 1 / 12;
    return Math.round(this.store.convert()(expense.amount, expense.currency) * factor * 100) / 100;
  }

  frequencyLabel(frequency: ExpenseFrequency): string {
    return frequency === 'monthly' ? '/mo' : frequency === 'quarterly' ? '/qtr' : '/yr';
  }

  categoryName(id: string | null): string {
    return this.store.categoriesById().get(id ?? '')?.name ?? 'Uncategorised';
  }

  accountName(id: string | null): string {
    return this.store.accountsById().get(id ?? '')?.name ?? 'Any account';
  }

  /* -- recurring expenses ----------------------------------------------- */

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
      ? await this.store.save('recurring_expenses', id, values, 'Recurring expense')
      : await this.store.create(
          'recurring_expenses',
          { ...values, active: true, startDate: toIsoDate(new Date()), endDate: null, propertyId: null },
          'Recurring expense',
        );
    if (ok) this.expenseOpen.set(false);
  }

  async deleteExpense(): Promise<void> {
    const id = this.editingExpenseId();
    this.confirmExpenseDelete.set(false);
    if (!id) return;
    if (await this.store.destroy('recurring_expenses', id, 'Recurring expense')) this.expenseOpen.set(false);
  }

  /* -- formatting ------------------------------------------------------ */

  typeLabel(type: AccountType): string {
    return ACCOUNT_TYPES.find((option) => option.value === type)?.label ?? type;
  }

  money(value: number | null): string {
    return this.currency.format(value);
  }

  moneyIn(value: number, currency: string): string {
    return this.currency.formatIn(value, currency);
  }

  pct(value: number, decimals = 1): string {
    return this.currency.percent(value, decimals);
  }
}

function average(values: number[]): number {
  return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : 0;
}
