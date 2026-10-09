import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { DemoRepository } from '../../core/data/demo.repository';
import { CurrencyService } from '../../core/money/currency.service';
import { CategoryType } from '../../core/models/domain.models';
import { FinanceStore } from '../../core/state/finance.store';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { ThemeService } from '../../core/ui/theme.service';
import { ToastService } from '../../core/ui/toast.service';
import { ViewPrefsService } from '../../core/ui/view-prefs.service';
import {
  AdvancedToggleComponent,
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
  imports: [CommonModule, ReactiveFormsModule, SectionComponent, SkeletonComponent, ConfirmDialogComponent, AdvancedToggleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="page-head__titles">
          <p class="eyebrow">Preferences</p>
          <h1 class="h1">Settings</h1>
        </div>
        <div class="page-head__actions">
          <sb-advanced-toggle />
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
                    <label class="field__label" for="s-currency">Main currency</label>
                    <select id="s-currency" class="select" formControlName="baseCurrency">
                      @for (code of currencies(); track code) {
                        <option [value]="code">{{ code }}</option>
                      }
                    </select>
                    <span class="field__hint">Totals are shown in this currency. Only currencies Snowball can convert to are listed.</span>
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

                @if (unconvertible().length) {
                  <div class="estimate-note" role="status">
                    <span>
                      <strong>Some totals may be off.</strong>
                      Snowball has no exchange rate for {{ unconvertible().join(', ') }}, so we're treating
                      {{ unconvertible().length === 1 ? 'it' : 'them' }} as equal to {{ selectedCurrency() }}
                      (1 {{ unconvertible()[0] }} = 1 {{ selectedCurrency() }}).
                    </span>
                  </div>
                }

                <div class="row" style="justify-content:flex-end">
                  <button type="submit" class="btn btn--primary btn--sm" [disabled]="profileForm.invalid || store.saving()">
                    Save profile
                  </button>
                </div>
              </form>
            </sb-section>

            <!-- ------------------------------------------------- -->
            <sb-section title="Safety cushion" subtitle="Money kept aside for emergencies, like losing your job or a big repair. Your plan is measured against it.">
              <form [formGroup]="targetsForm" (ngSubmit)="saveTargets()" class="col" style="gap:14px">
                <div class="grid grid--2" style="gap:12px">
                  <div class="field">
                    <label class="field__label" for="s-ef">Safety cushion</label>
                    <input id="s-ef" class="input input--num" type="number" step="100" min="0" formControlName="emergencyFundTarget" />
                    <span class="field__hint">{{ runwayText() }}</span>
                  </div>
                  <div class="field">
                    <label class="field__label" for="s-cash">Maximum cash to keep at home</label>
                    <input id="s-cash" class="input input--num" type="number" step="10" min="0" formControlName="physicalCashCeiling" />
                    <span class="field__hint">We'll let you know when you have more cash at home than this.</span>
                  </div>
                </div>

                <div class="estimate-note">
                  @if (store.essentialExpenses() > 0) {
                    <span>
                      A common rule of thumb is 3 to 6 months of fixed bills. Yours are
                      {{ money(store.essentialExpenses()) }} a month, so that's:
                      <span class="suggestions">
                        <button type="button" class="btn btn--ghost btn--sm" (click)="suggestCushion(3)">
                          3 months · {{ money(store.essentialExpenses() * 3) }}
                        </button>
                        <button type="button" class="btn btn--ghost btn--sm" (click)="suggestCushion(6)">
                          6 months · {{ money(store.essentialExpenses() * 6) }}
                        </button>
                      </span>
                      Tap one to use it, or type your own amount.
                    </span>
                  } @else {
                    <span>
                      A common rule of thumb is 3 to 6 months of fixed bills. Add your bills on Money &amp; bills
                      and we'll suggest an amount.
                    </span>
                  }
                </div>

                <div class="row" style="justify-content:flex-end">
                  <button type="submit" class="btn btn--primary btn--sm" [disabled]="targetsForm.invalid || store.saving()">
                    Save safety cushion
                  </button>
                </div>
              </form>
            </sb-section>

            <!-- ------------------------------------------------- -->
            <sb-section title="Categories" subtitle="Built-in categories stay; your own can be added and removed.">
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
                    <option value="essential">Fixed bill</option>
                    <option value="flexible">Everyday spending</option>
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

            @if (auth.isDemo() || prefs.advanced()) {
              <sb-section title="Where your data is kept" subtitle="Technical details, in case something looks wrong.">
                <div class="col" style="gap:12px">
                  <div class="kv">
                    <span class="kv__label">Stored in</span>
                    <span class="kv__value">
                      {{ supabase.isConfigured ? 'Your Snowball account (online)' : 'This browser only (demo)' }}
                    </span>
                  </div>
                  <div class="kv">
                    <span class="kv__label">Exchange rates</span>
                    <span class="kv__value">{{ rateCount() }} available</span>
                  </div>
                  @if (missingRates().length) {
                    <div class="estimate-note">
                      <span>
                        <strong>Some exchange rates are missing.</strong> Snowball has no rate for
                        {{ missingRatesText() }}, so those amounts are counted 1 to 1 and totals that include them may
                        be off.
                      </span>
                    </div>
                  }

                  @if (auth.isDemo()) {
                    <div class="estimate-note">
                      <span>
                        <strong>You're exploring the demo.</strong> Changes are saved in this browser only and aren't
                        synced anywhere. Create an account to keep your own data safe.
                      </span>
                    </div>
                    <button type="button" class="btn btn--ghost btn--sm" (click)="confirmReset.set(true)">
                      Reset demo data
                    </button>
                  }
                </div>
              </sb-section>
            }

            @if (!auth.isDemo()) {
              <sb-section title="Change password" subtitle="At least 8 characters.">
                <form [formGroup]="passwordForm" (ngSubmit)="changePassword()" class="col" style="gap:12px">
                  <div class="field">
                    <label class="field__label" for="s-pw">New password</label>
                    <input id="s-pw" class="input" type="password" autocomplete="new-password" formControlName="password" />
                    @if (passwordForm.controls.password.touched && passwordForm.controls.password.errors?.['minlength']) {
                      <span class="field__error">Use at least 8 characters.</span>
                    }
                  </div>
                  <div class="field">
                    <label class="field__label" for="s-pw2">Repeat new password</label>
                    <input id="s-pw2" class="input" type="password" autocomplete="new-password" formControlName="repeat" />
                    @if (passwordForm.controls.repeat.touched && passwordForm.errors?.['mismatch']) {
                      <span class="field__error">The two passwords don't match.</span>
                    }
                  </div>
                  <div class="row" style="justify-content:flex-end">
                    <button type="submit" class="btn btn--primary btn--sm" [disabled]="passwordForm.invalid || changingPassword()">
                      {{ changingPassword() ? 'Saving…' : 'Change password' }}
                    </button>
                  </div>
                </form>
              </sb-section>
            }

            <sb-section title="Account" subtitle="Your session.">
              <div class="col" style="gap:10px">
                <div class="kv">
                  <span class="kv__label">Signed in as</span>
                  <span class="kv__value truncate">{{ auth.isDemo() ? 'Demo' : auth.user()?.email ?? '—' }}</span>
                </div>
                <button type="button" class="btn btn--ghost btn--block" (click)="store.refresh()">
                  Reload my data
                </button>
                <button type="button" class="btn btn--ghost btn--block" (click)="signOut()">Sign out</button>
              </div>
            </sb-section>

            <sb-section title="About" subtitle="Snowball — keep the dough rolling.">
              <p class="small secondary" style="line-height:1.6">
                Snowball is a personal planning and tracking tool. It keeps real balances, your own estimates and
                forecasts apart. Nothing here is financial advice, and future investment growth is never
                guaranteed.
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
  readonly prefs = inject(ViewPrefsService);
  readonly auth = inject(AuthService);
  readonly supabase = inject(SupabaseService);
  private readonly currency = inject(CurrencyService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  /** Only meaningful in demo mode; harmless otherwise. */
  private readonly demo = inject(DemoRepository);

  readonly locales = LOCALES;
  readonly confirmReset = signal(false);
  readonly changingPassword = signal(false);

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

  readonly passwordForm = this.fb.nonNullable.group(
    {
      password: ['', [Validators.required, Validators.minLength(8)]],
      repeat: ['', Validators.required],
    },
    { validators: passwordsMatch },
  );

  readonly categoryForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    categoryType: ['flexible' as CategoryType, Validators.required],
  });

  readonly categoryGroups = computed(() => {
    const categories = [...(this.store.data()?.categories ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    return [
      { type: 'income' as CategoryType, label: 'Income', items: categories.filter((c) => c.categoryType === 'income') },
      { type: 'essential' as CategoryType, label: 'Fixed monthly bills', items: categories.filter((c) => c.categoryType === 'essential') },
      { type: 'flexible' as CategoryType, label: 'Everyday spending', items: categories.filter((c) => c.categoryType === 'flexible') },
    ].filter((group) => group.items.length > 0);
  });

  readonly rateCount = computed(() => this.store.data()?.exchangeRates.length ?? 0);
  readonly missingRates = computed(() => {
    this.currency.ratesVersion();
    return this.currency.missingPairs();
  });
  readonly missingRatesText = computed(() => this.missingRates().map((pair) => pair.replace('>', ' → ')).join(', '));

  /** The currency picked in the form, before it is saved. */
  readonly selectedCurrency = toSignal(this.profileForm.controls.baseCurrency.valueChanges, {
    initialValue: this.profileForm.controls.baseCurrency.value,
  });

  /** Every currency the user's money is held in. */
  private readonly heldCurrencies = computed(() => {
    const data = this.store.data();
    if (!data) return new Set<string>();
    return new Set<string>([
      ...data.accounts.filter((a) => !a.isArchived).map((a) => a.currency),
      ...data.investments.map((i) => i.currency),
      ...data.properties.map((p) => p.currency),
      ...data.otherAssets.map((a) => a.currency),
      ...data.liabilities.map((l) => l.currency),
      ...data.incomeSources.filter((i) => i.active).map((i) => i.currency),
      ...data.recurringExpenses.filter((e) => e.active).map((e) => e.currency),
    ]);
  });

  /**
   * Currencies worth offering as the main currency: the current one,
   * any Snowball has exchange rates for, and the ones the user holds.
   * With nothing recorded yet there is nothing to convert, so every
   * supported currency is fine.
   */
  readonly currencies = computed(() => {
    const data = this.store.data();
    const current = data?.profile.baseCurrency ?? this.currency.baseCurrency();
    if (!this.heldCurrencies().size) return [...new Set([current, ...CURRENCIES])];
    const fromRates = (data?.exchangeRates ?? []).flatMap((r) => [r.baseCurrency, r.quoteCurrency]);
    return [...new Set([current, ...fromRates, ...this.heldCurrencies()])].sort();
  });

  /** Held currencies with no rate to the selected main currency (they would convert 1 to 1). */
  readonly unconvertible = computed(() => {
    const target = this.selectedCurrency();
    const rates = this.store.data()?.exchangeRates ?? [];
    const has = (from: string, to: string) =>
      rates.some((r) => (r.baseCurrency === from && r.quoteCurrency === to) || (r.baseCurrency === to && r.quoteCurrency === from));
    return [...this.heldCurrencies()].filter((code) => code !== target && !has(code, target)).sort();
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
    const target = Number(this.targetsForm.controls.emergencyFundTarget.value) || 0;
    const essential = this.store.essentialExpenses();
    if (essential <= 0) return 'Add your fixed bills to see how many months this would cover.';
    return `That would cover ${(target / essential).toFixed(1)} months of fixed bills.`;
  }

  suggestCushion(months: number): void {
    const amount = Math.round(this.store.essentialExpenses() * months);
    this.targetsForm.controls.emergencyFundTarget.setValue(amount);
    this.targetsForm.controls.emergencyFundTarget.markAsDirty();
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
    // Setting the cushion is the last step of the first-run checklist.
    await this.store.saveProfile({
      emergencyFundTarget: Number(raw.emergencyFundTarget),
      physicalCashCeiling: Number(raw.physicalCashCeiling),
      onboarded: true,
    });
  }

  async changePassword(): Promise<void> {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    this.changingPassword.set(true);
    try {
      const result = await this.auth.updatePassword(this.passwordForm.controls.password.value);
      if (result.ok) {
        this.toast.success('Password changed');
        this.passwordForm.reset();
      } else {
        this.toast.error('Could not change password', result.message);
      }
    } finally {
      this.changingPassword.set(false);
    }
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
    // The store also resets itself when the user changes; doing it here
    // too means nothing of this account lingers during navigation.
    this.store.reset();
    await this.router.navigate(['/auth/sign-in']);
  }

  money(value: number): string {
    return this.currency.format(value, { decimals: 0 });
  }
}

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const repeat = group.get('repeat')?.value;
  return password && repeat && password !== repeat ? { mismatch: true } : null;
}
