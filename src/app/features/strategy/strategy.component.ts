import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { CurrencyService } from '../../core/money/currency.service';
import { formatRelative } from '../../core/money/format';
import { StrategyRule } from '../../core/models/domain.models';
import { FinanceStore } from '../../core/state/finance.store';
import { ToastService } from '../../core/ui/toast.service';
import { DialogDirective } from '../../shared/ui/dialog.directive';
import { humanize } from '../../shared/ui/humanize.pipe';
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
    DialogDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="page-head__titles">
          <p class="eyebrow">Where your money is going</p>
          <h1 class="h1">My plan</h1>
        </div>
        <div class="page-head__actions">
          <button type="button" class="btn btn--ghost btn--sm" (click)="openPriorities()">Edit priorities</button>
          <button type="button" class="btn btn--primary btn--sm" (click)="openRule()">Add a check</button>
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
                <dt>Safety cushion <sb-explain key="emergency-fund" /></dt>
                <dd>{{ money(s.securityFloor) }}</dd>
              </div>
              <div>
                <dt>Free to spend or invest <sb-explain key="available-above-floor" /></dt>
                <dd>{{ money(s.availableAboveFloor) }}</dd>
              </div>
              <div>
                <dt>Due in the next 3 months</dt>
                <dd>{{ money(s.committedSoon) }}</dd>
              </div>
            </dl>
          </div>
        </section>

        <!-- ------------------------------------------------------- -->
        <sb-section title="Priorities" subtitle="What your money is for, in order. The percentages show how you'd like to split what's left each month — a guide, not a strict budget.">
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
            <sb-empty title="No priorities yet" text="Rank what matters to you — a safety cushion, investing, enjoying life.">
              <button type="button" class="btn btn--primary btn--sm" (click)="openPriorities()">Set priorities</button>
            </sb-empty>
          }
        </sb-section>

        <!-- ------------------------------------------------------- -->
        <sb-section title="Your stages" subtitle="Your plan moves in stages. Each one has its own checks and opens up when the one before it is done.">
          <div class="phases">
            @for (evaluation of store.phases(); track evaluation.phase.id) {
              <article class="phase" [class]="'phase phase--' + evaluation.state">
                <header class="phase__head">
                  <div class="row" style="gap:10px; min-width:0">
                    <span class="phase__order">{{ evaluation.phase.phaseOrder }}</span>
                    <div class="col" style="gap:1px; min-width:0">
                      <h3 class="phase__name truncate">{{ evaluation.phase.name }}</h3>
                      <span class="phase__state">
                        {{ evaluation.state === 'active' ? 'You are here' : evaluation.state === 'complete' ? 'Done' : 'Not started yet' }}
                      </span>
                    </div>
                  </div>
                  @if (evaluation.canActivate) {
                    <button type="button" class="btn btn--primary btn--sm" (click)="activate(evaluation.phase.id)">
                      Start this stage
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
                    [label]="evaluation.state === 'active' ? 'Progress' : 'Until this stage opens up'"
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
          title="Checks"
          [subtitle]="'How you are doing against the checks you set' + (s.activePhase ? ' for ' + s.activePhase.name + '.' : '.')"
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
            <sb-empty title="No checks yet" text="Checks turn what you want to do with your money into something Snowball can keep an eye on.">
              <button type="button" class="btn btn--primary btn--sm" (click)="openRule()">Add a check</button>
            </sb-empty>
          }
        </sb-section>

        <!-- ------------------------------------------------------- -->
        @if (s.signals.length) {
          <sb-section title="Things we noticed" subtitle="Based on your last few months.">
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
            <strong>How your status is decided.</strong> Snowball looks at how far you are from your safety
            cushion and how much you've saved a month lately, then checks your upcoming expenses, the maximum
            cash you want to keep and your goals. It never gives you a fixed spending budget — see
            <a routerLink="/forecasts" class="link">Future</a> for the long-run picture.
          </span>
        </div>
      }

      <!-- ============================================================ -->
      @if (ruleOpen()) {
        <div class="scrim" (click)="ruleOpen.set(false)" role="presentation">
          <div class="dialog" role="dialog" aria-modal="true" aria-label="Check" sbDialog (dismiss)="ruleOpen.set(false)" (click)="$event.stopPropagation()">
            <h2 class="h2">{{ editingRuleId() ? 'Edit check' : 'Add a check' }}</h2>

            <form [formGroup]="ruleForm" (ngSubmit)="saveRule()" class="col" style="gap:12px">
              <div class="field">
                <label class="field__label" for="r-name">Name</label>
                <input id="r-name" class="input" formControlName="name" placeholder="Keep my safety cushion full" />
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="r-type">What it checks</label>
                  <select id="r-type" class="select" formControlName="ruleType">
                    @for (option of ruleTypes; track option.value) {
                      <option [value]="option.value">{{ option.label }}</option>
                    }
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="r-phase">Stage</label>
                  <select id="r-phase" class="select" formControlName="phaseId">
                    <option value="">All stages</option>
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
                  <label class="field__label" for="r-priority">Order (1 = first)</label>
                  <input id="r-priority" class="input input--num" type="number" min="1" step="1" formControlName="priority" />
                </div>
              </div>

              <div class="field">
                <label class="field__label" for="r-desc">Description</label>
                <textarea id="r-desc" class="textarea" formControlName="description"
                          placeholder="Keep my safety cushion full before I invest more each month."></textarea>
              </div>

              <label class="switch">
                <input type="checkbox" formControlName="enabled" />
                <span class="switch__track"></span><span class="switch__thumb"></span>
                <span class="small">This check is on</span>
              </label>

              <div class="row" style="justify-content:space-between; margin-top:4px">
                @if (editingRuleId()) {
                  <button type="button" class="btn btn--quiet btn--sm" (click)="confirmDelete.set(true)">Delete</button>
                } @else { <span></span> }
                <div class="row" style="gap:8px">
                  <button type="button" class="btn btn--ghost" (click)="ruleOpen.set(false)">Cancel</button>
                  <button type="submit" class="btn btn--primary" [disabled]="ruleForm.invalid || store.saving()">Save check</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      }

      @if (prioritiesOpen()) {
        <div class="scrim" (click)="prioritiesOpen.set(false)" role="presentation">
          <div class="dialog" role="dialog" aria-modal="true" aria-label="Priorities" sbDialog (dismiss)="prioritiesOpen.set(false)" (click)="$event.stopPropagation()">
            <h2 class="h2">Your priorities</h2>
            <p class="small muted">In order, with how much of what's left each month should go to each. They need to add up to 100%.</p>

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
                        [value]="draftValue(priority.id)"
                        (input)="setDraft(priority.id, $any($event.target).value)"
                        [attr.aria-label]="priority.name + ': percentage of what is left each month'"
                        style="max-width:100px"
                      />
                      <span class="small muted">% of what's left each month</span>
                    </div>
                  </div>
                </div>
              }
            </div>

            @if (draftTotalValid()) {
              <p class="micro muted" aria-live="polite">Total: {{ pct(draftTotal(), 0) }}</p>
            } @else {
              <p class="field__error priorities-warning" role="alert">
                These add up to {{ pct(draftTotal(), 0) }}. Adjust them so they add up to exactly 100%
                ({{ draftTotal() > 100 ? pct(draftTotal() - 100, 0) + ' too much' : pct(100 - draftTotal(), 0) + ' still to share out' }}).
              </p>
            }

            <div class="row" style="justify-content:flex-end; gap:8px">
              <button type="button" class="btn btn--ghost" (click)="prioritiesOpen.set(false)">Cancel</button>
              <button
                type="button"
                class="btn btn--primary"
                [disabled]="!draftTotalValid() || savingPriorities()"
                (click)="savePriorities()"
              >
                {{ savingPriorities() ? 'Saving…' : 'Save priorities' }}
              </button>
            </div>
          </div>
        </div>
      }

      <sb-confirm
        [open]="confirmDelete()"
        title="Delete this rule?"
        message="Your plan status will be worked out again without it."
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
  private readonly toast = inject(ToastService);

  readonly strategy = this.store.strategy;
  readonly priorities = computed(() =>
    [...(this.store.data()?.strategyPriorities ?? [])].sort((a, b) => a.rank - b.rank),
  );

  readonly ruleOpen = signal(false);
  readonly prioritiesOpen = signal(false);
  readonly editingRuleId = signal<string | null>(null);
  readonly confirmDelete = signal(false);

  /** Priority percentages being edited, saved together with one action. */
  readonly draft = signal<Record<string, number>>({});
  readonly savingPriorities = signal(false);

  readonly ruleTypes = [
    { value: 'emergency_fund', label: 'Safety cushion' },
    { value: 'investment', label: 'Monthly investing' },
    { value: 'lifestyle', label: 'Everyday spending' },
    { value: 'property', label: 'Property' },
    { value: 'debt', label: 'Debt' },
    { value: 'allocation', label: 'Investment mix' },
    { value: 'savings_rate', label: 'Share of income saved' },
    { value: 'cash_ceiling', label: 'Maximum cash to keep' },
    { value: 'custom', label: 'Your own check' },
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
    // 'getting-started' falls through to info: friendly, never alarming.
    if (status === 'ahead' || status === 'on-track') return 'good' as const;
    if (status === 'attention') return 'warn' as const;
    if (status === 'off-track') return 'bad' as const;
    return 'info' as const;
  });

  readonly draftTotal = computed(() =>
    this.priorities().reduce((total, priority) => total + this.draftValue(priority.id), 0),
  );

  /** Allow for floating-point noise from decimal inputs. */
  readonly draftTotalValid = computed(() => Math.abs(this.draftTotal() - 100) < 0.01);

  rulesForPhase(phaseId: string) {
    return (this.store.data()?.strategyRules ?? []).filter((rule) => rule.phaseId === phaseId);
  }

  /* -- actions -------------------------------------------------------- */

  async activate(phaseId: string): Promise<void> {
    const phases = this.store.data()?.phases ?? [];
    for (const phase of phases) {
      if (phase.active && phase.id !== phaseId) {
        await this.store.save('financial_phases', phase.id, { active: false }, 'Stage');
      }
    }
    await this.store.save('financial_phases', phaseId, { active: true }, 'Stage');
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
      ? await this.store.save('strategy_rules', id, values, 'Check')
      : await this.store.create('strategy_rules', { ...values, configuration: {} }, 'Check');
    if (ok) this.ruleOpen.set(false);
  }

  async deleteRule(): Promise<void> {
    const id = this.editingRuleId();
    this.confirmDelete.set(false);
    if (!id) return;
    if (await this.store.destroy('strategy_rules', id, 'Check')) this.ruleOpen.set(false);
  }

  openPriorities(): void {
    this.draft.set(Object.fromEntries(this.priorities().map((p) => [p.id, p.allocationPercentage])));
    this.prioritiesOpen.set(true);
  }

  draftValue(id: string): number {
    return this.draft()[id] ?? this.priorities().find((p) => p.id === id)?.allocationPercentage ?? 0;
  }

  setDraft(id: string, value: string): void {
    const number = Number(value);
    this.draft.update((draft) => ({ ...draft, [id]: Number.isFinite(number) ? Math.max(0, number) : 0 }));
  }

  /** Saves every changed priority in one go, with one confirmation. */
  async savePriorities(): Promise<void> {
    if (!this.draftTotalValid()) return;
    const changed = this.priorities().filter((p) => this.draftValue(p.id) !== p.allocationPercentage);
    if (!changed.length) {
      this.prioritiesOpen.set(false);
      return;
    }

    this.savingPriorities.set(true);
    const ok = await this.store.saveMany(
      changed.map((p) => ({
        kind: 'save' as const,
        table: 'strategy_priorities' as const,
        id: p.id,
        values: { allocationPercentage: this.draftValue(p.id) },
      })),
      'Priorities saved',
    );
    this.savingPriorities.set(false);
    if (ok) this.prioritiesOpen.set(false);
  }

  /* -- display --------------------------------------------------------- */

  ruleTone(status: string): string {
    if (status === 'met') return 'good';
    if (status === 'breached') return 'bad';
    if (status === 'progressing') return 'brand';
    return 'neutral';
  }

  ruleLabel(status: string): string {
    if (status === 'met') return 'On track';
    if (status === 'breached') return 'Not met';
    if (status === 'progressing') return 'In progress';
    return 'Doesn’t apply yet';
  }

  ruleTypeLabel(type: string): string {
    return this.ruleTypes.find((option) => option.value === type)?.label ?? humanize(type);
  }

  money(value: number | null): string {
    return this.currency.format(value, { decimals: 0 });
  }

  pct(value: number, decimals = 1): string {
    return this.currency.percent(value, decimals);
  }

  relative(value: string): string {
    return formatRelative(value, this.currency.locale());
  }
}
