import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { CurrencyService } from '../../core/money/currency.service';
import { formatRelative } from '../../core/money/format';
import { StrategyRule } from '../../core/models/domain.models';
import { FinanceStore } from '../../core/state/finance.store';
import { ExplainComponent } from '../../shared/ui/explain.component';
import {
  ConfirmDialogComponent,
  EmptyStateComponent,
  MeterComponent,
  SectionComponent,
  SkeletonComponent,
  StatusPillComponent,
} from '../../shared/ui/ui-kit';

@Component({
  selector: 'sb-strategy',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    SectionComponent,
    MeterComponent,
    StatusPillComponent,
    ExplainComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ConfirmDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="page-head__titles">
          <p class="eyebrow">The plan</p>
          <h1 class="h1">Strategy</h1>
        </div>
        <div class="page-head__actions">
          <button type="button" class="btn btn--ghost btn--sm" (click)="openPriorities()">Edit priorities</button>
          <button type="button" class="btn btn--primary btn--sm" (click)="openRule()">Add rule</button>
        </div>
      </header>

      @if (store.isLoading()) {
        <div class="card card--pad"><sb-skeleton [count]="8" /></div>
      } @else if (strategy(); as s) {
        <!-- ------------------------------------------------------- -->
        <section class="card card--pad status" [class]="'card card--pad status status--' + tone()">
          <div class="row row--between row--wrap" style="gap:16px">
            <div class="col" style="gap:10px; min-width:0; flex:1">
              <div class="row" style="gap:8px">
                <sb-status-pill [tone]="tone()" [label]="s.headline" />
                <sb-explain key="strategy-status" />
              </div>
              <p class="status__text">{{ s.explanation }}</p>
            </div>
            <dl class="status__metrics">
              <div>
                <dt>Security floor</dt>
                <dd>{{ money(s.securityFloor) }}</dd>
              </div>
              <div>
                <dt>Available above floor</dt>
                <dd>{{ money(s.availableAboveFloor) }}</dd>
              </div>
              <div>
                <dt>Committed &lt; 3 months</dt>
                <dd>{{ money(s.committedSoon) }}</dd>
              </div>
            </dl>
          </div>
        </section>

        <!-- ------------------------------------------------------- -->
        <sb-section title="Priorities" subtitle="What your money is for, in order. Percentages describe intent, not a hard budget.">
          @if (priorities().length) {
            <ol class="priorities">
              @for (priority of priorities(); track priority.id) {
                <li class="priority">
                  <span class="priority__rank">{{ priority.rank }}</span>
                  <div class="priority__body">
                    <div class="row row--between" style="gap:12px">
                      <span class="priority__name">{{ priority.name }}</span>
                      <span class="priority__share num">{{ pct(priority.allocationPercentage, 0) }}</span>
                    </div>
                    <sb-meter [value]="priority.allocationPercentage" [showValue]="false" tone="brand" />
                    @if (priority.description) {
                      <p class="priority__desc">{{ priority.description }}</p>
                    }
                  </div>
                </li>
              }
            </ol>
          } @else {
            <sb-empty title="No priorities set" text="Rank what matters — security, wealth building, lifestyle.">
              <button type="button" class="btn btn--primary btn--sm" (click)="openPriorities()">Set priorities</button>
            </sb-empty>
          }
        </sb-section>

        <!-- ------------------------------------------------------- -->
        <sb-section title="Financial phases" subtitle="Each phase has its own rules; they unlock as conditions are met.">
          <div class="phases">
            @for (evaluation of store.phases(); track evaluation.phase.id) {
              <article class="phase" [class]="'phase phase--' + evaluation.state">
                <header class="phase__head">
                  <div class="row" style="gap:10px; min-width:0">
                    <span class="phase__order">{{ evaluation.phase.phaseOrder }}</span>
                    <div class="col" style="gap:1px; min-width:0">
                      <h3 class="phase__name truncate">{{ evaluation.phase.name }}</h3>
                      <span class="phase__state">
                        {{ evaluation.state === 'active' ? 'Active now' : evaluation.state === 'complete' ? 'Complete' : 'Locked' }}
                      </span>
                    </div>
                  </div>
                  @if (evaluation.canActivate) {
                    <button type="button" class="btn btn--primary btn--sm" (click)="activate(evaluation.phase.id)">
                      Activate
                    </button>
                  }
                </header>

                @if (evaluation.phase.objective) {
                  <p class="phase__objective">{{ evaluation.phase.objective }}</p>
                }

                @if (evaluation.state !== 'complete') {
                  <sb-meter
                    [value]="evaluation.progress"
                    [valueText]="pct(evaluation.progress, 0)"
                    [label]="evaluation.state === 'active' ? 'Toward completion' : 'Toward unlock'"
                    [tone]="evaluation.state === 'active' ? 'brand' : 'warn'"
                  />
                }

                <p class="phase__condition">{{ evaluation.conditionText }}</p>

                @if (evaluation.phase.description) {
                  <p class="phase__desc">{{ evaluation.phase.description }}</p>
                }

                @if (rulesForPhase(evaluation.phase.id).length) {
                  <ul class="phase__rules">
                    @for (rule of rulesForPhase(evaluation.phase.id); track rule.id) {
                      <li>{{ rule.name }}</li>
                    }
                  </ul>
                }
              </article>
            }
          </div>
        </sb-section>

        <!-- ------------------------------------------------------- -->
        <sb-section
          title="Strategy rules"
          [subtitle]="'Evaluated against your live position' + (s.activePhase ? ' for ' + s.activePhase.name + '.' : '.')"
        >
          @if (s.rules.length) {
            <div class="rules">
              @for (evaluation of s.rules; track evaluation.rule.id) {
                <article class="rule">
                  <header class="rule__head">
                    <div class="col" style="gap:2px; min-width:0">
                      <div class="row" style="gap:8px">
                        <h3 class="rule__name truncate">{{ evaluation.rule.name }}</h3>
                        <span class="badge" [class]="'badge badge--' + ruleTone(evaluation.status)">
                          {{ ruleLabel(evaluation.status) }}
                        </span>
                      </div>
                      <span class="rule__type">{{ ruleTypeLabel(evaluation.rule.ruleType) }}</span>
                    </div>
                    <div class="row" style="gap:6px">
                      <span class="rule__headline num">{{ evaluation.headline }}</span>
                      <button type="button" class="btn btn--quiet btn--sm" (click)="openRule(evaluation.rule)">Edit</button>
                    </div>
                  </header>

                  @if (evaluation.progress !== null) {
                    <sb-meter
                      [value]="evaluation.progress"
                      [showValue]="false"
                      [tone]="evaluation.status === 'met' ? 'good' : evaluation.status === 'breached' ? 'bad' : 'brand'"
                    />
                  }

                  <p class="rule__detail">{{ evaluation.detail }}</p>

                  @if (evaluation.rule.description && evaluation.rule.description !== evaluation.detail) {
                    <p class="rule__policy">{{ evaluation.rule.description }}</p>
                  }
                </article>
              }
            </div>
          } @else {
            <sb-empty title="No rules yet" text="Rules turn your intentions into something the app can check.">
              <button type="button" class="btn btn--primary btn--sm" (click)="openRule()">Add a rule</button>
            </sb-empty>
          }
        </sb-section>

        <!-- ------------------------------------------------------- -->
        @if (s.signals.length) {
          <sb-section title="Signals" subtitle="What the engine noticed in your recent behaviour.">
            <ul class="signals">
              @for (signal of s.signals; track signal.title) {
                <li class="signal" [class]="'signal signal--' + signal.tone">
                  <span class="signal__mark"></span>
                  <div>
                    <p class="signal__title">{{ signal.title }}</p>
                    <p class="signal__detail">{{ signal.detail }}</p>
                  </div>
                </li>
              }
            </ul>
          </sb-section>
        }

        <div class="estimate-note">
          <span>
            <strong>How status is decided.</strong> Snowball compares your emergency-fund gap against your
            three-month average savings rate, then checks planned spending, account ceilings and goal schedules.
            It never assumes a fixed monthly discretionary budget — see
            <a routerLink="/forecasts" class="link">Forecasts</a> for the long-run picture.
          </span>
        </div>
      }

      <!-- ============================================================ -->
      @if (ruleOpen()) {
        <div class="scrim" (click)="ruleOpen.set(false)" role="presentation">
          <div class="dialog" role="dialog" aria-modal="true" aria-label="Strategy rule" (click)="$event.stopPropagation()">
            <h2 class="h2">{{ editingRuleId() ? 'Edit rule' : 'Add rule' }}</h2>

            <form [formGroup]="ruleForm" (ngSubmit)="saveRule()" class="col" style="gap:12px">
              <div class="field">
                <label class="field__label" for="r-name">Name</label>
                <input id="r-name" class="input" formControlName="name" placeholder="Emergency Fund Rule" />
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="r-type">Rule type</label>
                  <select id="r-type" class="select" formControlName="ruleType">
                    @for (option of ruleTypes; track option.value) {
                      <option [value]="option.value">{{ option.label }}</option>
                    }
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="r-phase">Phase</label>
                  <select id="r-phase" class="select" formControlName="phaseId">
                    <option value="">All phases</option>
                    @for (phase of store.data()?.phases ?? []; track phase.id) {
                      <option [value]="phase.id">{{ phase.name }}</option>
                    }
                  </select>
                </div>
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="r-target">Target amount</label>
                  <input id="r-target" class="input input--num" type="number" step="1" formControlName="targetValue" />
                </div>
                <div class="field">
                  <label class="field__label" for="r-priority">Priority</label>
                  <input id="r-priority" class="input input--num" type="number" min="1" step="1" formControlName="priority" />
                </div>
              </div>

              <div class="field">
                <label class="field__label" for="r-desc">Description</label>
                <textarea id="r-desc" class="textarea" formControlName="description"
                          placeholder="Hold €7,000 in instant-access cash before increasing investment contributions."></textarea>
              </div>

              <label class="switch">
                <input type="checkbox" formControlName="enabled" />
                <span class="switch__track"></span><span class="switch__thumb"></span>
                <span class="small">Rule is active</span>
              </label>

              <div class="row" style="justify-content:space-between; margin-top:4px">
                @if (editingRuleId()) {
                  <button type="button" class="btn btn--quiet btn--sm" (click)="confirmDelete.set(true)">Delete</button>
                } @else { <span></span> }
                <div class="row" style="gap:8px">
                  <button type="button" class="btn btn--ghost" (click)="ruleOpen.set(false)">Cancel</button>
                  <button type="submit" class="btn btn--primary" [disabled]="ruleForm.invalid || store.saving()">Save rule</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      }

      @if (prioritiesOpen()) {
        <div class="scrim" (click)="prioritiesOpen.set(false)" role="presentation">
          <div class="dialog" role="dialog" aria-modal="true" aria-label="Priorities" (click)="$event.stopPropagation()">
            <h2 class="h2">Strategy priorities</h2>
            <p class="small muted">Ranked, with the share of surplus each one should attract.</p>

            <div class="col" style="gap:12px">
              @for (priority of priorities(); track priority.id) {
                <div class="priority-edit">
                  <span class="priority__rank">{{ priority.rank }}</span>
                  <div class="col" style="gap:6px; flex:1; min-width:0">
                    <span class="small" style="font-weight:600">{{ priority.name }}</span>
                    <div class="row" style="gap:8px">
                      <input
                        class="input input--num"
                        type="number"
                        min="0"
                        max="100"
                        step="5"
                        [value]="priority.allocationPercentage"
                        (change)="updatePriority(priority.id, $any($event.target).value)"
                        [attr.aria-label]="priority.name + ' allocation percentage'"
                        style="max-width:100px"
                      />
                      <span class="small muted">% of surplus</span>
                    </div>
                  </div>
                </div>
              }
            </div>

            <p class="micro muted">Total: {{ pct(prioritiesTotal(), 0) }}</p>

            <div class="row" style="justify-content:flex-end">
              <button type="button" class="btn btn--primary" (click)="prioritiesOpen.set(false)">Done</button>
            </div>
          </div>
        </div>
      }

      <sb-confirm
        [open]="confirmDelete()"
        title="Delete this rule?"
        message="Your strategy status will be recalculated without it."
        (confirmed)="deleteRule()"
        (cancelled)="confirmDelete.set(false)"
      />
    </div>
  `,
  styleUrl: './strategy.component.scss',
})
export class StrategyComponent {
  readonly store = inject(FinanceStore);
  private readonly currency = inject(CurrencyService);
  private readonly fb = inject(FormBuilder);

  readonly strategy = this.store.strategy;
  readonly priorities = computed(() =>
    [...(this.store.data()?.strategyPriorities ?? [])].sort((a, b) => a.rank - b.rank),
  );

  readonly ruleOpen = signal(false);
  readonly prioritiesOpen = signal(false);
  readonly editingRuleId = signal<string | null>(null);
  readonly confirmDelete = signal(false);

  readonly ruleTypes = [
    { value: 'emergency_fund', label: 'Emergency fund' },
    { value: 'investment', label: 'Investment contribution' },
    { value: 'lifestyle', label: 'Lifestyle / flexible spending' },
    { value: 'property', label: 'Property' },
    { value: 'debt', label: 'Debt' },
    { value: 'allocation', label: 'Portfolio allocation' },
    { value: 'savings_rate', label: 'Savings rate' },
    { value: 'cash_ceiling', label: 'Cash ceiling' },
    { value: 'custom', label: 'Custom' },
  ];

  readonly ruleForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    ruleType: ['custom', Validators.required],
    phaseId: [''],
    targetValue: [null as number | null],
    priority: [1, [Validators.required, Validators.min(1)]],
    description: [''],
    enabled: [true],
  });

  readonly tone = computed(() => {
    const status = this.strategy()?.status;
    if (status === 'ahead' || status === 'on-track') return 'good' as const;
    if (status === 'attention') return 'warn' as const;
    if (status === 'off-track') return 'bad' as const;
    return 'info' as const;
  });

  readonly prioritiesTotal = computed(() =>
    this.priorities().reduce((total, priority) => total + priority.allocationPercentage, 0),
  );

  rulesForPhase(phaseId: string) {
    return (this.store.data()?.strategyRules ?? []).filter((rule) => rule.phaseId === phaseId);
  }

  /* -- actions -------------------------------------------------------- */

  async activate(phaseId: string): Promise<void> {
    const phases = this.store.data()?.phases ?? [];
    for (const phase of phases) {
      if (phase.active && phase.id !== phaseId) {
        await this.store.save('financial_phases', phase.id, { active: false }, 'Phase');
      }
    }
    await this.store.save('financial_phases', phaseId, { active: true }, 'Phase');
  }

  openRule(rule?: StrategyRule): void {
    this.editingRuleId.set(rule?.id ?? null);
    this.ruleForm.reset({
      name: rule?.name ?? '',
      ruleType: rule?.ruleType ?? 'custom',
      phaseId: rule?.phaseId ?? '',
      targetValue: rule?.targetValue ?? null,
      priority: rule?.priority ?? 1,
      description: rule?.description ?? '',
      enabled: rule?.enabled ?? true,
    });
    this.ruleOpen.set(true);
  }

  async saveRule(): Promise<void> {
    if (this.ruleForm.invalid) {
      this.ruleForm.markAllAsTouched();
      return;
    }
    const raw = this.ruleForm.getRawValue();
    const values = {
      name: raw.name.trim(),
      ruleType: raw.ruleType,
      phaseId: raw.phaseId || null,
      targetValue: raw.targetValue === null ? null : Number(raw.targetValue),
      priority: Number(raw.priority),
      description: raw.description?.trim() || null,
      enabled: raw.enabled,
    };

    const id = this.editingRuleId();
    const ok = id
      ? await this.store.save('strategy_rules', id, values, 'Rule')
      : await this.store.create('strategy_rules', { ...values, configuration: {} }, 'Rule');
    if (ok) this.ruleOpen.set(false);
  }

  async deleteRule(): Promise<void> {
    const id = this.editingRuleId();
    this.confirmDelete.set(false);
    if (!id) return;
    if (await this.store.destroy('strategy_rules', id, 'Rule')) this.ruleOpen.set(false);
  }

  openPriorities(): void {
    this.prioritiesOpen.set(true);
  }

  async updatePriority(id: string, value: string): Promise<void> {
    await this.store.save('strategy_priorities', id, { allocationPercentage: Number(value) }, 'Priority');
  }

  /* -- display --------------------------------------------------------- */

  ruleTone(status: string): string {
    if (status === 'met') return 'good';
    if (status === 'breached') return 'bad';
    if (status === 'progressing') return 'brand';
    return 'neutral';
  }

  ruleLabel(status: string): string {
    if (status === 'met') return 'Met';
    if (status === 'breached') return 'Breached';
    if (status === 'progressing') return 'In progress';
    return 'Not applicable';
  }

  ruleTypeLabel(type: string): string {
    return this.ruleTypes.find((option) => option.value === type)?.label ?? type;
  }

  money(value: number | null): string {
    return this.currency.format(value);
  }

  pct(value: number, decimals = 1): string {
    return this.currency.percent(value, decimals);
  }

  relative(value: string): string {
    return formatRelative(value, this.currency.locale());
  }
}
