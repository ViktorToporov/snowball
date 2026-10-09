import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { CurrencyService } from '../../core/money/currency.service';
import { formatDate, formatRelative, toIsoDate } from '../../core/money/format';
import { Goal, GoalType, PlannedExpense, PriorityLevel } from '../../core/models/domain.models';
import { FinanceStore } from '../../core/state/finance.store';
import { StatCardComponent } from '../../shared/ui/stat-card.component';
import {
  ConfirmDialogComponent,
  EmptyStateComponent,
  MeterComponent,
  SectionComponent,
  SkeletonComponent,
} from '../../shared/ui/ui-kit';

const GOAL_TYPES: Array<{ value: GoalType; label: string }> = [
  { value: 'emergency_fund', label: 'Emergency fund' },
  { value: 'travel', label: 'Travel' },
  { value: 'property', label: 'Property' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'investment', label: 'Investment' },
  { value: 'debt_payoff', label: 'Debt payoff' },
  { value: 'financial_independence', label: 'Financial independence' },
  { value: 'other', label: 'Other' },
];

const PRIORITIES: PriorityLevel[] = ['critical', 'high', 'medium', 'low'];

@Component({
  selector: 'sb-goals',
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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="page-head__titles">
          <p class="eyebrow">Targets</p>
          <h1 class="h1">Goals &amp; upcoming expenses</h1>
        </div>
        <div class="page-head__actions">
          <button type="button" class="btn btn--ghost btn--sm" (click)="openExpense()">Add planned expense</button>
          <button type="button" class="btn btn--primary btn--sm" (click)="openGoal()">Add goal</button>
        </div>
      </header>

      @if (store.isLoading()) {
        <div class="card card--pad"><sb-skeleton [count]="6" /></div>
      } @else {
        <div class="grid grid--stats">
          <sb-stat-card label="Active goals" [value]="activeGoals().length" format="number"
                        [caption]="onTrackCount() + ' on track'" />
          <sb-stat-card label="Total still to save" [value]="totalRemaining()"
                        [caption]="'Across all active goals'" />
          <sb-stat-card label="Required per month" explain="goal-required" [value]="totalRequiredMonthly()"
                        [caption]="'To hit every dated goal on time'" />
          <sb-stat-card label="Committed within 3 months" explain="available-above-floor" [value]="committedSoon()"
                        [invertDelta]="true" [caption]="'Unfunded planned expenses falling due'" />
        </div>

        <!-- ------------------------------------------------------- -->
        <sb-section title="Goals" explain="goal-required" subtitle="Progress, required contribution and whether each one is on schedule.">
          @if (goals().length) {
            <div class="goals">
              @for (view of goals(); track view.goal.id) {
                <article class="goal" [class.goal--done]="view.progress >= 100">
                  <header class="goal__head">
                    <div class="col" style="gap:3px; min-width:0">
                      <div class="row" style="gap:8px">
                        <h3 class="goal__name truncate">{{ view.goal.name }}</h3>
                        <span class="badge" [class]="'badge badge--' + priorityTone(view.goal.priority)">
                          {{ view.goal.priority }}
                        </span>
                      </div>
                      <span class="goal__type">{{ goalTypeLabel(view.goal.goalType) }}</span>
                    </div>
                    <button type="button" class="btn btn--quiet btn--sm" (click)="openGoal(view.goal)">Edit</button>
                  </header>

                  <div class="goal__figures">
                    <span class="goal__current">{{ money(view.currentAmount) }}</span>
                    <span class="goal__target">of {{ money(view.goal.targetAmount) }}</span>
                  </div>

                  <sb-meter
                    [value]="view.progress"
                    [valueText]="pct(view.progress, 0)"
                    [showValue]="true"
                    label="Progress"
                    [tone]="view.progress >= 100 ? 'good' : view.onTrack ? 'brand' : 'warn'"
                  />

                  <dl class="goal__facts">
                    <div>
                      <dt>Remaining</dt>
                      <dd>{{ money(view.remaining) }}</dd>
                    </div>
                    <div>
                      <dt>Needed / month</dt>
                      <dd>{{ view.requiredMonthly === null ? '—' : money(view.requiredMonthly) }}</dd>
                    </div>
                    <div>
                      <dt>Contributing</dt>
                      <dd>{{ money(view.goal.monthlyContribution) }}</dd>
                    </div>
                    <div>
                      <dt>Target date</dt>
                      <dd>{{ view.goal.targetDate ? date(view.goal.targetDate) : 'Open-ended' }}</dd>
                    </div>
                  </dl>

                  <footer class="goal__foot">
                    @if (view.progress >= 100) {
                      <span class="badge badge--good">Achieved</span>
                    } @else if (view.onTrack) {
                      <span class="badge badge--good">On track</span>
                    } @else {
                      <span class="badge badge--warn">Behind schedule</span>
                    }

                    @if (view.projectedCompletion) {
                      <span class="micro muted">
                        At {{ money(view.goal.monthlyContribution) }}/month, complete {{ relative(view.projectedCompletion) }}
                      </span>
                    } @else if (view.remaining > 0) {
                      <span class="micro muted">Set a monthly contribution to project a completion date</span>
                    }
                  </footer>
                </article>
              }
            </div>
          } @else {
            <sb-empty title="No goals yet" text="Emergency fund, a vacation, a property refurb — anything with a number and a date.">
              <button type="button" class="btn btn--primary btn--sm" (click)="openGoal()">Add your first goal</button>
            </sb-empty>
          }
        </sb-section>

        <!-- ------------------------------------------------------- -->
        <sb-section
          title="Upcoming expenses"
          explain="planned-required"
          subtitle="Planned spending that affects your available cash forecast."
          [flush]="true"
        >
          @if (store.plannedExpenses().length) {
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Expense</th>
                    <th>Due</th>
                    <th class="t-right">Cost</th>
                    <th class="t-right">Saved</th>
                    <th class="t-right">Remaining</th>
                    <th class="t-right">Needed / month</th>
                    <th style="width:130px">Progress</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (view of store.plannedExpenses(); track view.expense.id) {
                    <tr>
                      <td>
                        <div class="table__primary">{{ view.expense.name }}</div>
                        @if (view.expense.category) {
                          <div class="table__meta">{{ view.expense.category }}</div>
                        }
                      </td>
                      <td>
                        <div class="num secondary">{{ date(view.expense.targetDate) }}</div>
                        <div class="table__meta" [class.neg]="view.isOverdue">
                          {{ relative(view.expense.targetDate) }}
                        </div>
                      </td>
                      <td class="num">{{ money(view.expense.amount) }}</td>
                      <td class="num secondary">{{ money(view.expense.savedAmount) }}</td>
                      <td class="num">{{ money(view.remaining) }}</td>
                      <td class="num" style="font-weight:600">{{ money(view.requiredMonthly) }}</td>
                      <td>
                        <sb-meter
                          [value]="view.progress"
                          [showValue]="false"
                          [tone]="view.progress >= 100 ? 'good' : view.monthsUntil <= 1 ? 'warn' : 'brand'"
                        />
                      </td>
                      <td class="t-right">
                        <button type="button" class="btn btn--quiet btn--sm" (click)="openExpense(view.expense)">Edit</button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

          } @else {
            <sb-empty title="Nothing planned" text="Add vacations, renewals and large purchases so they show up in your cash forecast.">
              <button type="button" class="btn btn--primary btn--sm" (click)="openExpense()">Add planned expense</button>
            </sb-empty>
          }

          @if (store.plannedExpenses().length) {
            <div slot="foot" class="card__foot">
              Snowball subtracts unfunded planned expenses from "available above security floor", so upcoming
              spending can never look like free cash.
            </div>
          }
        </sb-section>
      }

      <!-- ============================================================ -->
      @if (goalOpen()) {
        <div class="scrim" (click)="goalOpen.set(false)" role="presentation">
          <div class="dialog" role="dialog" aria-modal="true" aria-label="Goal" (click)="$event.stopPropagation()">
            <h2 class="h2">{{ editingGoalId() ? 'Edit goal' : 'Add goal' }}</h2>

            <form [formGroup]="goalForm" (ngSubmit)="saveGoal()" class="col" style="gap:12px">
              <div class="field">
                <label class="field__label" for="g-name">Name</label>
                <input id="g-name" class="input" formControlName="name" placeholder="Emergency Fund" />
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="g-type">Type</label>
                  <select id="g-type" class="select" formControlName="goalType">
                    @for (option of goalTypes; track option.value) {
                      <option [value]="option.value">{{ option.label }}</option>
                    }
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="g-priority">Priority</label>
                  <select id="g-priority" class="select" formControlName="priority">
                    @for (option of priorities; track option) {
                      <option [value]="option">{{ option }}</option>
                    }
                  </select>
                </div>
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="g-target">Target amount</label>
                  <input id="g-target" class="input input--num" type="number" step="1" formControlName="targetAmount" />
                </div>
                <div class="field">
                  <label class="field__label" for="g-current">Current amount</label>
                  <input id="g-current" class="input input--num" type="number" step="1" formControlName="currentAmount" />
                </div>
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="g-date">Target date</label>
                  <input id="g-date" class="input" type="date" formControlName="targetDate" />
                </div>
                <div class="field">
                  <label class="field__label" for="g-contribution">Monthly contribution</label>
                  <input id="g-contribution" class="input input--num" type="number" step="1" formControlName="monthlyContribution" />
                </div>
              </div>

              <div class="field">
                <label class="field__label" for="g-account">Linked account</label>
                <select id="g-account" class="select" formControlName="accountId">
                  <option value="">None</option>
                  @for (account of accounts(); track account.id) {
                    <option [value]="account.id">{{ account.name }}</option>
                  }
                </select>
              </div>

              <label class="switch">
                <input type="checkbox" formControlName="trackAccountBalance" />
                <span class="switch__track"></span><span class="switch__thumb"></span>
                <span class="small">Track the linked account balance automatically</span>
              </label>

              <div class="field">
                <label class="field__label" for="g-notes">Notes</label>
                <textarea id="g-notes" class="textarea" formControlName="notes"></textarea>
              </div>

              <div class="row" style="justify-content:space-between; margin-top:4px">
                @if (editingGoalId()) {
                  <button type="button" class="btn btn--quiet btn--sm" (click)="confirmGoalDelete.set(true)">Delete</button>
                } @else { <span></span> }
                <div class="row" style="gap:8px">
                  <button type="button" class="btn btn--ghost" (click)="goalOpen.set(false)">Cancel</button>
                  <button type="submit" class="btn btn--primary" [disabled]="goalForm.invalid || store.saving()">Save goal</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      }

      @if (expenseOpen()) {
        <div class="scrim" (click)="expenseOpen.set(false)" role="presentation">
          <div class="dialog" role="dialog" aria-modal="true" aria-label="Planned expense" (click)="$event.stopPropagation()">
            <h2 class="h2">{{ editingExpenseId() ? 'Edit planned expense' : 'Add planned expense' }}</h2>

            <form [formGroup]="expenseForm" (ngSubmit)="saveExpense()" class="col" style="gap:12px">
              <div class="field">
                <label class="field__label" for="e-name">Name</label>
                <input id="e-name" class="input" formControlName="name" placeholder="Vacation" />
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="e-amount">Expected cost</label>
                  <input id="e-amount" class="input input--num" type="number" step="1" formControlName="amount" />
                </div>
                <div class="field">
                  <label class="field__label" for="e-saved">Already set aside</label>
                  <input id="e-saved" class="input input--num" type="number" step="1" formControlName="savedAmount" />
                </div>
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="e-date">Target date</label>
                  <input id="e-date" class="input" type="date" formControlName="targetDate" />
                </div>
                <div class="field">
                  <label class="field__label" for="e-priority">Priority</label>
                  <select id="e-priority" class="select" formControlName="priority">
                    @for (option of priorities; track option) {
                      <option [value]="option">{{ option }}</option>
                    }
                  </select>
                </div>
              </div>

              <div class="field">
                <label class="field__label" for="e-category">Category</label>
                <input id="e-category" class="input" formControlName="category" placeholder="Travel" />
              </div>

              <div class="field">
                <label class="field__label" for="e-notes">Notes</label>
                <textarea id="e-notes" class="textarea" formControlName="notes"></textarea>
              </div>

              @if (expenseForm.controls.amount.value > 0 && expenseForm.controls.targetDate.value) {
                <div class="estimate-note">
                  <span>
                    You need <strong>{{ money(requiredForForm()) }}/month</strong> to have this money available by
                    {{ date(expenseForm.controls.targetDate.value) }}.
                  </span>
                </div>
              }

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
        [open]="confirmGoalDelete()"
        title="Delete this goal?"
        message="Progress toward it will no longer be tracked."
        (confirmed)="deleteGoal()"
        (cancelled)="confirmGoalDelete.set(false)"
      />
      <sb-confirm
        [open]="confirmExpenseDelete()"
        title="Delete this planned expense?"
        message="It will stop affecting your available-cash forecast."
        (confirmed)="deleteExpense()"
        (cancelled)="confirmExpenseDelete.set(false)"
      />
    </div>
  `,
  styleUrl: './goals.component.scss',
})
export class GoalsComponent {
  readonly store = inject(FinanceStore);
  private readonly currency = inject(CurrencyService);
  private readonly fb = inject(FormBuilder);

  readonly goalTypes = GOAL_TYPES;
  readonly priorities = PRIORITIES;

  readonly goalOpen = signal(false);
  readonly expenseOpen = signal(false);
  readonly editingGoalId = signal<string | null>(null);
  readonly editingExpenseId = signal<string | null>(null);
  readonly confirmGoalDelete = signal(false);
  readonly confirmExpenseDelete = signal(false);

  readonly goals = this.store.goals;
  readonly accounts = computed(() => this.store.data()?.accounts.filter((a) => !a.isArchived) ?? []);

  readonly activeGoals = computed(() => this.goals().filter((view) => view.goal.status === 'active'));
  readonly onTrackCount = computed(() => this.activeGoals().filter((view) => view.onTrack).length);
  readonly totalRemaining = computed(() =>
    round(this.activeGoals().reduce((total, view) => total + view.remaining, 0)),
  );
  readonly totalRequiredMonthly = computed(() =>
    round(this.activeGoals().reduce((total, view) => total + (view.requiredMonthly ?? 0), 0)),
  );
  readonly committedSoon = computed(() =>
    round(
      this.store
        .plannedExpenses()
        .filter((view) => view.monthsUntil <= 3)
        .reduce((total, view) => total + view.remaining, 0),
    ),
  );

  readonly goalForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    goalType: ['other' as GoalType, Validators.required],
    priority: ['medium' as PriorityLevel, Validators.required],
    targetAmount: [1000, [Validators.required, Validators.min(1)]],
    currentAmount: [0, Validators.min(0)],
    targetDate: [''],
    monthlyContribution: [0, Validators.min(0)],
    accountId: [''],
    trackAccountBalance: [false],
    notes: [''],
  });

  readonly expenseForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    savedAmount: [0, Validators.min(0)],
    targetDate: [toIsoDate(new Date()), Validators.required],
    priority: ['medium' as PriorityLevel, Validators.required],
    category: [''],
    notes: [''],
  });

  requiredForForm(): number {
    const raw = this.expenseForm.getRawValue();
    const remaining = Math.max(0, Number(raw.amount) - Number(raw.savedAmount));
    const target = new Date(raw.targetDate);
    const today = new Date();
    const months = Math.max(
      1,
      (target.getFullYear() - today.getFullYear()) * 12 + (target.getMonth() - today.getMonth()),
    );
    return round(remaining / months);
  }

  /* -- goals ---------------------------------------------------------- */

  openGoal(goal?: Goal): void {
    this.editingGoalId.set(goal?.id ?? null);
    this.goalForm.reset({
      name: goal?.name ?? '',
      goalType: goal?.goalType ?? 'other',
      priority: goal?.priority ?? 'medium',
      targetAmount: goal?.targetAmount ?? 1000,
      currentAmount: goal?.currentAmount ?? 0,
      targetDate: goal?.targetDate ?? '',
      monthlyContribution: goal?.monthlyContribution ?? 0,
      accountId: goal?.accountId ?? '',
      trackAccountBalance: goal?.trackAccountBalance ?? false,
      notes: goal?.notes ?? '',
    });
    this.goalOpen.set(true);
  }

  async saveGoal(): Promise<void> {
    if (this.goalForm.invalid) {
      this.goalForm.markAllAsTouched();
      return;
    }
    const raw = this.goalForm.getRawValue();
    const values = {
      name: raw.name.trim(),
      goalType: raw.goalType,
      priority: raw.priority,
      targetAmount: Number(raw.targetAmount),
      currentAmount: Number(raw.currentAmount),
      currency: this.currency.baseCurrency(),
      targetDate: raw.targetDate || null,
      monthlyContribution: Number(raw.monthlyContribution),
      accountId: raw.accountId || null,
      trackAccountBalance: raw.trackAccountBalance,
      notes: raw.notes?.trim() || null,
    };

    const id = this.editingGoalId();
    const ok = id
      ? await this.store.save('goals', id, values, 'Goal')
      : await this.store.create('goals', { ...values, status: 'active' }, 'Goal');
    if (ok) this.goalOpen.set(false);
  }

  async deleteGoal(): Promise<void> {
    const id = this.editingGoalId();
    this.confirmGoalDelete.set(false);
    if (!id) return;
    if (await this.store.destroy('goals', id, 'Goal')) this.goalOpen.set(false);
  }

  /* -- planned expenses ------------------------------------------------ */

  openExpense(expense?: PlannedExpense): void {
    this.editingExpenseId.set(expense?.id ?? null);
    this.expenseForm.reset({
      name: expense?.name ?? '',
      amount: expense?.amount ?? 0,
      savedAmount: expense?.savedAmount ?? 0,
      targetDate: expense?.targetDate ?? toIsoDate(new Date()),
      priority: expense?.priority ?? 'medium',
      category: expense?.category ?? '',
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
      savedAmount: Number(raw.savedAmount),
      currency: this.currency.baseCurrency(),
      targetDate: raw.targetDate,
      priority: raw.priority,
      category: raw.category?.trim() || null,
      notes: raw.notes?.trim() || null,
    };

    const id = this.editingExpenseId();
    const ok = id
      ? await this.store.save('planned_expenses', id, values, 'Planned expense')
      : await this.store.create(
          'planned_expenses',
          { ...values, status: Number(raw.savedAmount) > 0 ? 'funding' : 'planned' },
          'Planned expense',
        );
    if (ok) this.expenseOpen.set(false);
  }

  async deleteExpense(): Promise<void> {
    const id = this.editingExpenseId();
    this.confirmExpenseDelete.set(false);
    if (!id) return;
    if (await this.store.destroy('planned_expenses', id, 'Planned expense')) this.expenseOpen.set(false);
  }

  /* -- display --------------------------------------------------------- */

  goalTypeLabel(type: GoalType): string {
    return GOAL_TYPES.find((option) => option.value === type)?.label ?? type;
  }

  priorityTone(priority: PriorityLevel): string {
    if (priority === 'critical') return 'bad';
    if (priority === 'high') return 'warn';
    if (priority === 'medium') return 'brand';
    return 'neutral';
  }

  money(value: number | null): string {
    return this.currency.format(value);
  }

  pct(value: number, decimals = 1): string {
    return this.currency.percent(value, decimals);
  }

  date(value: string): string {
    return formatDate(value, this.currency.locale());
  }

  relative(value: string): string {
    return formatRelative(value, this.currency.locale());
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
