import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { DemoRepository } from '../../core/data/demo.repository';
import { CurrencyService } from '../../core/money/currency.service';
import { CategoryType } from '../../core/models/domain.models';
import { FinanceStore } from '../../core/state/finance.store';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { ThemeService } from '../../core/ui/theme.service';
import { ToastService } from '../../core/ui/toast.service';
import {
  ConfirmDialogComponent,
  SectionComponent,
  SkeletonComponent,
} from '../../shared/ui/ui-kit';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];
const LOCALES = [
  { value: 'en-IE', label: 'English (Ireland)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'de-DE', label: 'German (Germany)' },
  { value: 'fr-FR', label: 'French (France)' },
  { value: 'es-ES', label: 'Spanish (Spain)' },
  { value: 'pt-PT', label: 'Portuguese (Portugal)' },
];

@Component({
  selector: 'sb-settings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SectionComponent, SkeletonComponent, ConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="page-head__titles">
          <p class="eyebrow">Preferences</p>
          <h1 class="h1">Settings</h1>
        </div>
      </header>

      @if (store.isLoading()) {
        <div class="card card--pad"><sb-skeleton [count]="6" /></div>
      } @else {
        <div class="grid grid--wide-left">
          <div class="col" style="gap:16px">
            <!-- ------------------------------------------------- -->
            <sb-section title="Profile & currency" subtitle="How Snowball addresses you and formats every figure.">
              <form [formGroup]="profileForm" (ngSubmit)="saveProfile()" class="col" style="gap:14px">
                <div class="field">
                  <label class="field__label" for="s-name">Display name</label>
                  <input id="s-name" class="input" formControlName="displayName" />
                </div>

                <div class="grid grid--2" style="gap:12px">
                  <div class="field">
                    <label class="field__label" for="s-currency">Base currency</label>
                    <select id="s-currency" class="select" formControlName="baseCurrency">
                      @for (code of currencies; track code) {
                        <option [value]="code">{{ code }}</option>
                      }
                    </select>
                    <span class="field__hint">Everything is converted into this currency for totals.</span>
                  </div>
                  <div class="field">
                    <label class="field__label" for="s-locale">Number & date format</label>
                    <select id="s-locale" class="select" formControlName="locale">
                      @for (locale of locales; track locale.value) {
                        <option [value]="locale.value">{{ locale.label }}</option>
                      }
                    </select>
                  </div>
                </div>

                <div class="row" style="justify-content:flex-end">
                  <button type="submit" class="btn btn--primary btn--sm" [disabled]="profileForm.invalid || store.saving()">
                    Save profile
                  </button>
                </div>
              </form>
            </sb-section>

            <!-- ------------------------------------------------- -->
            <sb-section title="Security targets" subtitle="The floors your strategy is measured against.">
              <form [formGroup]="targetsForm" (ngSubmit)="saveTargets()" class="col" style="gap:14px">
                <div class="grid grid--2" style="gap:12px">
                  <div class="field">
                    <label class="field__label" for="s-ef">Emergency fund target</label>
                    <input id="s-ef" class="input input--num" type="number" step="100" min="0" formControlName="emergencyFundTarget" />
                    <span class="field__hint">
                      Currently {{ runwayText() }}
                    </span>
                  </div>
                  <div class="field">
                    <label class="field__label" for="s-cash">Physical cash ceiling</label>
                    <input id="s-cash" class="input input--num" type="number" step="10" min="0" formControlName="physicalCashCeiling" />
                    <span class="field__hint">Snowball warns when cash on hand exceeds this.</span>
                  </div>
                </div>

                <div class="estimate-note">
                  <span>
                    A common rule of thumb is three to six months of essential expenses. At
                    {{ money(store.essentialExpenses()) }}/month, that is
                    <strong>{{ money(store.essentialExpenses() * 3) }} – {{ money(store.essentialExpenses() * 6) }}</strong>.
                    Your target is yours to set.
                  </span>
                </div>

                <div class="row" style="justify-content:flex-end">
                  <button type="submit" class="btn btn--primary btn--sm" [disabled]="targetsForm.invalid || store.saving()">
                    Save targets
                  </button>
                </div>
              </form>
            </sb-section>

            <!-- ------------------------------------------------- -->
            <sb-section title="Categories" subtitle="System categories are shared; your own can be added and removed.">
              <div class="col" style="gap:16px">
                @for (group of categoryGroups(); track group.type) {
                  <div class="col" style="gap:8px">
                    <p class="eyebrow">{{ group.label }}</p>
                    <div class="chips">
                      @for (category of group.items; track category.id) {
                        <span class="chip" [class.chip--system]="category.isSystem">
                          {{ category.name }}
                          @if (!category.isSystem) {
                            <button type="button" class="chip__remove" (click)="removeCategory(category.id)"
                                    [attr.aria-label]="'Delete ' + category.name">✕</button>
                          }
                        </span>
                      }
                    </div>
                  </div>
                }

                <form [formGroup]="categoryForm" (ngSubmit)="addCategory()" class="row row--wrap" style="gap:8px">
                  <input class="input" formControlName="name" placeholder="New category name" style="flex:1 1 180px" />
                  <select class="select" formControlName="categoryType" style="flex:0 1 160px">
                    <option value="essential">Essential</option>
                    <option value="flexible">Flexible</option>
                    <option value="income">Income</option>
                  </select>
                  <button type="submit" class="btn btn--ghost btn--sm" [disabled]="categoryForm.invalid">Add</button>
                </form>
              </div>
            </sb-section>
          </div>

          <!-- --------------------------------------------------- -->
          <div class="col" style="gap:16px">
            <sb-section title="Appearance" subtitle="Snowball follows your system theme unless you choose otherwise.">
              <div class="theme-options">
                @for (option of themeOptions; track option.value) {
                  <button
                    type="button"
                    class="theme-option"
                    [class.is-active]="theme.preference() === option.value"
                    (click)="theme.set(option.value)"
                  >
                    <span class="theme-option__swatch" [class]="'theme-option__swatch theme-option__swatch--' + option.value"></span>
                    <span>{{ option.label }}</span>
                  </button>
                }
              </div>
            </sb-section>

            <sb-section title="Data source" subtitle="Where Snowball reads and writes your financial data.">
              <div class="col" style="gap:12px">
                <div class="kv">
                  <span class="kv__label">Backend</span>
                  <span class="kv__value">
                    {{ supabase.isConfigured ? 'Supabase' : 'Demo dataset (this browser only)' }}
                  </span>
                </div>
                <div class="kv">
                  <span class="kv__label">Signed in as</span>
                  <span class="kv__value truncate">{{ auth.user()?.email ?? '—' }}</span>
                </div>
                <div class="kv">
                  <span class="kv__label">Exchange rates</span>
                  <span class="kv__value">{{ rateCount() }} pairs loaded</span>
                </div>
                @if (missingRates().length) {
                  <div class="estimate-note">
                    <span>
                      <strong>Missing exchange rates.</strong> {{ missingRates().join(', ') }} converted 1:1 —
                      add the pair to the <code>exchange_rates</code> table for accurate totals.
                    </span>
                  </div>
                }

                @if (!supabase.isConfigured) {
                  <div class="estimate-note">
                    <span>
                      <strong>Running in demo mode.</strong> Edits are kept in this browser's local storage and are
                      not synced anywhere. Add your Supabase URL and publishable key to
                      <code>src/environments/environment.ts</code>, then reload.
                    </span>
                  </div>
                  <button type="button" class="btn btn--ghost btn--sm" (click)="confirmReset.set(true)">
                    Reset demo data
                  </button>
                }
              </div>
            </sb-section>

            <sb-section title="Account" subtitle="Session and sign-out.">
              <div class="col" style="gap:10px">
                <button type="button" class="btn btn--ghost btn--block" (click)="store.refresh()">
                  Reload financial data
                </button>
                <button type="button" class="btn btn--ghost btn--block" (click)="signOut()">Sign out</button>
              </div>
            </sb-section>

            <sb-section title="About" subtitle="Snowball — keep the dough rolling.">
              <p class="small secondary" style="line-height:1.6">
                Snowball is a personal planning and tracking tool. It distinguishes actual values from your own
                estimates, and both from forecasts. Nothing here is financial advice, and projected investment
                returns are never guaranteed.
              </p>
            </sb-section>
          </div>
        </div>
      }

      <sb-confirm
        [open]="confirmReset()"
        title="Reset demo data?"
        message="Every change you have made in demo mode will be discarded and the original sample dataset restored."
        confirmLabel="Reset"
        (confirmed)="resetDemo()"
        (cancelled)="confirmReset.set(false)"
      />
    </div>
  `,
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  readonly store = inject(FinanceStore);
  readonly theme = inject(ThemeService);
  readonly auth = inject(AuthService);
  readonly supabase = inject(SupabaseService);
  private readonly currency = inject(CurrencyService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  /** Only meaningful in demo mode; harmless otherwise. */
  private readonly demo = inject(DemoRepository);

  readonly currencies = CURRENCIES;
  readonly locales = LOCALES;
  readonly confirmReset = signal(false);

  readonly themeOptions = [
    { value: 'light' as const, label: 'Light' },
    { value: 'dark' as const, label: 'Dark' },
    { value: 'system' as const, label: 'System' },
  ];

  readonly profileForm = this.fb.nonNullable.group({
    displayName: [''],
    baseCurrency: ['EUR', Validators.required],
    locale: ['en-IE', Validators.required],
  });

  readonly targetsForm = this.fb.nonNullable.group({
    emergencyFundTarget: [7000, [Validators.required, Validators.min(0)]],
    physicalCashCeiling: [200, [Validators.required, Validators.min(0)]],
  });

  readonly categoryForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    categoryType: ['flexible' as CategoryType, Validators.required],
  });

  readonly categoryGroups = computed(() => {
    const categories = [...(this.store.data()?.categories ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    return [
      { type: 'income' as CategoryType, label: 'Income', items: categories.filter((c) => c.categoryType === 'income') },
      { type: 'essential' as CategoryType, label: 'Essential expenses', items: categories.filter((c) => c.categoryType === 'essential') },
      { type: 'flexible' as CategoryType, label: 'Flexible spending', items: categories.filter((c) => c.categoryType === 'flexible') },
    ].filter((group) => group.items.length > 0);
  });

  readonly rateCount = computed(() => this.store.data()?.exchangeRates.length ?? 0);
  readonly missingRates = computed(() => {
    this.currency.ratesVersion();
    return this.currency.missingPairs();
  });

  constructor() {
    // Prefill from the loaded profile once it arrives.
    queueMicrotask(() => this.syncForms());
  }

  private syncForms(): void {
    const profile = this.store.profile();
    if (!profile) {
      setTimeout(() => this.syncForms(), 150);
      return;
    }
    this.profileForm.patchValue({
      displayName: profile.displayName ?? '',
      baseCurrency: profile.baseCurrency,
      locale: profile.locale,
    });
    this.targetsForm.patchValue({
      emergencyFundTarget: profile.emergencyFundTarget,
      physicalCashCeiling: profile.physicalCashCeiling,
    });
  }

  runwayText(): string {
    const target = this.targetsForm.controls.emergencyFundTarget.value;
    const essential = this.store.essentialExpenses();
    if (essential <= 0) return 'Add recurring essential expenses to see the runway this buys.';
    return `${(target / essential).toFixed(1)} months of essential expenses.`;
  }

  async saveProfile(): Promise<void> {
    if (this.profileForm.invalid) return;
    const raw = this.profileForm.getRawValue();
    await this.store.saveProfile({
      displayName: raw.displayName.trim() || null,
      baseCurrency: raw.baseCurrency,
      locale: raw.locale,
    });
  }

  async saveTargets(): Promise<void> {
    if (this.targetsForm.invalid) return;
    const raw = this.targetsForm.getRawValue();
    await this.store.saveProfile({
      emergencyFundTarget: Number(raw.emergencyFundTarget),
      physicalCashCeiling: Number(raw.physicalCashCeiling),
    });
  }

  async addCategory(): Promise<void> {
    if (this.categoryForm.invalid) return;
    const raw = this.categoryForm.getRawValue();
    const ok = await this.store.create(
      'categories',
      { name: raw.name.trim(), categoryType: raw.categoryType, isSystem: false, sortOrder: 100 },
      'Category',
    );
    if (ok) this.categoryForm.reset({ name: '', categoryType: raw.categoryType });
  }

  async removeCategory(id: string): Promise<void> {
    await this.store.destroy('categories', id, 'Category');
  }

  resetDemo(): void {
    this.confirmReset.set(false);
    this.demo.reset();
    this.toast.success('Demo data reset', 'Reloading…');
    setTimeout(() => window.location.reload(), 600);
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigate(['/auth/sign-in']);
  }

  money(value: number): string {
    return this.currency.format(value);
  }
}
