import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, WritableSignal, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { CurrencyService } from '../../core/money/currency.service';
import { monthKey, toIsoDate } from '../../core/money/format';
import { Account, IncomeSource } from '../../core/models/domain.models';
import { CheckInInput, FinanceStore } from '../../core/state/finance.store';
import { humanize } from '../../shared/ui/humanize.pipe';
import { EmptyStateComponent, MeterComponent, SkeletonComponent } from '../../shared/ui/ui-kit';

type StepKey = 'pay' | 'balances' | 'investments';

const STEP_TITLES: Record<StepKey, string> = {
  pay: 'Your pay',
  balances: 'Your balances',
  investments: 'Investments',
};

/** Months between two dates, ignoring the day. */
function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

/** Two decimals at most, no trailing zeros — what goes in the box. */
function toField(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** A typed amount, or null when the box is empty or not a number. */
function parseField(text: string | undefined): number | null {
  if (text === undefined || text.trim() === '') return null;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/**
 * The monthly check-in.
 *
 * Snowball has no bank feed: it works out spending from how balances
 * move between check-ins. So once a month the user confirms their pay
 * and every balance, pre-filled with what we already know, and the
 * store saves it all in one go. Only figures the user changed are
 * written; income is always confirmed.
 */
@Component({
  selector: 'sb-check-in',
  standalone: true,
  imports: [CommonModule, RouterLink, EmptyStateComponent, MeterComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page checkin">
      <header class="page-head">
        <div class="page-head__titles">
          <p class="eyebrow">{{ monthName }}</p>
          <h1 class="h1">Monthly check-in</h1>
        </div>
      </header>

      @if (store.isLoading()) {
        <div class="card card--pad"><sb-skeleton [count]="5" /></div>
      } @else if (store.state() === 'error') {
        <div class="card">
          <sb-empty icon="error" title="Couldn't load your data" [text]="store.error()">
            <button type="button" class="btn btn--primary btn--sm" (click)="store.refresh()">Try again</button>
          </sb-empty>
        </div>
      } @else if (saved()) {
        <!-- ============================================================
             Done — what this month looked like
             ============================================================ -->
        <section class="card card--pad col result" style="gap:18px" aria-live="polite">
          <div>
            <h2 class="h2">All done — thanks!</h2>
            <p class="small muted">Your numbers are up to date.</p>
          </div>

          @if (spending(); as sp) {
            <p class="result__lead">
              {{ sp.isCurrent ? 'This month' : 'In ' + sp.label }} you spent about
              <strong>{{ money(sp.total) }}</strong>
              ({{ money(sp.fixed) }} on fixed bills, {{ money(sp.everyday) }} on everyday spending).
            </p>
          } @else {
            <p class="result__lead">
              Next month we'll be able to show what you spent — we need two check-ins to compare.
            </p>
          }

          @if (store.cash(); as cash) {
            @if (cash.emergencyTarget > 0) {
              <div class="col" style="gap:8px">
                <div class="row row--between row--wrap">
                  <span class="small" style="font-weight:600">Safety cushion</span>
                  <span class="small muted">
                    {{ money(cash.emergencyBalance) }} of {{ money(cash.emergencyTarget) }} ·
                    {{ Math.round(cash.emergencyProgress) }}% full
                  </span>
                </div>
                <sb-meter
                  [value]="cash.emergencyProgress"
                  [showValue]="false"
                  [large]="true"
                  [tone]="cash.emergencyProgress >= 100 ? 'good' : 'brand'"
                />
              </div>
            } @else {
              <p class="small muted">
                Tip: <a routerLink="/settings">set a safety cushion</a> — money kept aside for emergencies — to track it here.
              </p>
            }
          }

          <div class="row row--wrap">
            <a routerLink="/dashboard" class="btn btn--primary">Back to Overview</a>
          </div>
        </section>
      } @else if (!accounts().length) {
        <div class="card">
          <sb-empty
            title="Add your accounts first"
            text="The check-in confirms the balance of each account you hold. Add your bank accounts, then come back here."
          >
            <a routerLink="/cash-flow" [queryParams]="{ tab: 'accounts' }" class="btn btn--primary btn--sm">Add accounts</a>
          </sb-empty>
        </div>
      } @else {
        <p class="checkin__why card card--pad card--sunken">
          Snowball works out your spending from how your balances change, so it needs your numbers once a month.
          Takes about 2 minutes. Best done just after payday.
        </p>

        <!-- Progress through the steps -->
        <ol class="steps" aria-label="Check-in steps">
          @for (key of steps(); track key; let i = $index) {
            <li
              class="steps__item"
              [class.is-current]="i === stepIndex()"
              [class.is-done]="i < stepIndex()"
              [attr.aria-current]="i === stepIndex() ? 'step' : null"
            >
              <span class="steps__num">{{ i + 1 }}</span>
              <span class="steps__label">{{ stepTitles[key] }}</span>
            </li>
          }
        </ol>

        <form class="card card--pad col" style="gap:20px" (submit)="$event.preventDefault(); next()">
          @switch (step()) {
            <!-- ---------------------------------------------------- pay -->
            @case ('pay') {
              <div>
                <h2 class="h2">Did you get paid as usual this month?</h2>
                <p class="small muted">We've filled in what you usually get. Change it if this month was different.</p>
              </div>

              @if (incomeSources().length) {
                <div class="checkin__list">
                  @for (source of incomeSources(); track source.id) {
                    <div class="field checkin__row">
                      <label class="field__label checkin__label" [for]="'inc-' + source.id">
                        {{ source.name }}
                        <span class="field__hint">{{ incomeHint(source) }}</span>
                      </label>
                      <div class="checkin__control">
                        <span class="checkin__ccy" aria-hidden="true">{{ source.currency }}</span>
                        <input
                          class="input input--num checkin__input"
                          type="number"
                          inputmode="decimal"
                          step="0.01"
                          min="0"
                          [id]="'inc-' + source.id"
                          [value]="incomeValue(source)"
                          (input)="setIncome(source.id, $event)"
                        />
                      </div>
                      @if (incomeValue(source) !== '0') {
                        <button type="button" class="btn btn--quiet btn--sm checkin__zero" (click)="zeroIncome(source.id)">
                          Didn't arrive
                        </button>
                      }
                    </div>
                  }
                </div>
              } @else {
                <div class="card card--sunken card--pad col" style="gap:10px">
                  <p class="small">
                    You haven't added any income yet. Adding your take-home pay lets Snowball work out what you spend.
                  </p>
                  <div class="row row--wrap">
                    <a routerLink="/cash-flow" [queryParams]="{ tab: 'income' }" class="btn btn--ghost btn--sm">Add my income</a>
                    <span class="small muted">or carry on without it.</span>
                  </div>
                </div>
              }
            }

            <!-- ----------------------------------------------- balances -->
            @case ('balances') {
              <div>
                <h2 class="h2">What's in each account today?</h2>
                <p class="small muted">Check your banking app and type in today's balance. For credit cards, enter what you owe.</p>
              </div>

              <div class="checkin__list">
                @for (account of accounts(); track account.id) {
                  <div class="field checkin__row">
                    <label class="field__label checkin__label" [for]="'acc-' + account.id">
                      {{ account.name }}
                      <span class="field__hint">
                        {{ account.accountType === 'credit_card' ? 'Balance owed' : accountKind(account) }}
                        @if (account.institution) { · {{ account.institution }} }
                      </span>
                    </label>
                    <div class="checkin__control">
                      <span class="checkin__ccy" aria-hidden="true">{{ account.currency }}</span>
                      <input
                        class="input input--num checkin__input"
                        type="number"
                        inputmode="decimal"
                        step="0.01"
                        [id]="'acc-' + account.id"
                        [value]="balanceValue(account)"
                        (input)="setField(balances, account.id, $event)"
                      />
                    </div>
                  </div>
                }
              </div>
            }

            <!-- -------------------------------------------- investments -->
            @case ('investments') {
              @if (totalAccounts().length) {
                <div>
                  <h2 class="h2">Your investment accounts</h2>
                  <p class="small muted">
                    The total your provider's app or statement shows today, and any money you moved in or out
                    this month — so a transfer isn't mistaken for spending.
                  </p>
                </div>

                <div class="checkin__list">
                  @for (account of totalAccounts(); track account.id) {
                    <div class="checkin__row checkin__row--pair">
                      <div class="field">
                        <label class="field__label checkin__label" [for]="'iacc-' + account.id">
                          {{ account.name }}
                          <span class="field__hint">What it's worth today</span>
                        </label>
                        <div class="checkin__control">
                          <span class="checkin__ccy" aria-hidden="true">{{ account.currency }}</span>
                          <input
                            class="input input--num checkin__input"
                            type="number"
                            inputmode="decimal"
                            step="0.01"
                            min="0"
                            [id]="'iacc-' + account.id"
                            [value]="fieldValue(accountValues, account.id, account.currentValue ?? 0)"
                            (input)="setField(accountValues, account.id, $event)"
                          />
                        </div>
                      </div>
                      <div class="field">
                        <label class="field__label checkin__label" [for]="'iflow-' + account.id">
                          Money added this month
                          <span class="field__hint">Optional. Use a minus for money taken out.</span>
                        </label>
                        <div class="checkin__control">
                          <span class="checkin__ccy" aria-hidden="true">{{ account.currency }}</span>
                          <input
                            class="input input--num checkin__input"
                            type="number"
                            inputmode="decimal"
                            step="0.01"
                            placeholder="0"
                            [id]="'iflow-' + account.id"
                            [value]="accountFlows()[account.id] || ''"
                            (input)="setField(accountFlows, account.id, $event)"
                          />
                        </div>
                      </div>
                    </div>
                  }
                </div>
              }

              @if (holdings().length) {
              <div>
                <h2 class="h2">Today's prices</h2>
                <p class="small muted">The price of one share or unit. Your broker's app shows it next to each holding.</p>
              </div>

              <div class="checkin__list">
                @for (holding of holdings(); track holding.id) {
                  <div class="field checkin__row">
                    <label class="field__label checkin__label" [for]="'inv-' + holding.id">
                      {{ holding.name }}
                      <span class="field__hint">
                        {{ holding.quantity.toLocaleString() }} held · worth
                        <strong>{{ formatIn(holdingValue(holding.id, holding.quantity, holding.currentPrice), holding.currency) }}</strong>
                      </span>
                    </label>
                    <div class="checkin__control">
                      <span class="checkin__ccy" aria-hidden="true">{{ holding.currency }}</span>
                      <input
                        class="input input--num checkin__input"
                        type="number"
                        inputmode="decimal"
                        step="0.0001"
                        min="0"
                        [id]="'inv-' + holding.id"
                        [value]="fieldValue(prices, holding.id, holding.currentPrice)"
                        (input)="setField(prices, holding.id, $event)"
                      />
                    </div>
                  </div>
                }
              </div>
              }
            }
          }

          <!-- Optional: home and debts, on the last step only -->
          @if (isLastStep() && hasHomeOrDebts()) {
            <div class="checkin__optional">
              <button
                type="button"
                class="btn btn--quiet checkin__disclose"
                [attr.aria-expanded]="showHome()"
                aria-controls="checkin-home"
                (click)="showHome.set(!showHome())"
              >
                Home & debts <span class="muted">(optional)</span>
                <svg [class.is-open]="showHome()" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 5l4 4 4-4" />
                </svg>
              </button>

              @if (showHome()) {
                <div id="checkin-home" class="checkin__list">
                  <p class="small muted">Only update these if they changed — most people do it a few times a year.</p>
                  @for (property of properties(); track property.id) {
                    <div class="field checkin__row">
                      <label class="field__label checkin__label" [for]="'pv-' + property.id">
                        {{ property.name }} — what it's worth
                      </label>
                      <div class="checkin__control">
                        <span class="checkin__ccy" aria-hidden="true">{{ property.currency }}</span>
                        <input
                          class="input input--num checkin__input"
                          type="number"
                          inputmode="decimal"
                          step="1"
                          min="0"
                          [id]="'pv-' + property.id"
                          [value]="fieldValue(propertyValues, property.id, property.estimatedValue)"
                          (input)="setField(propertyValues, property.id, $event)"
                        />
                      </div>
                    </div>
                    <div class="field checkin__row">
                      <label class="field__label checkin__label" [for]="'pm-' + property.id">
                        {{ property.name }} — mortgage still owed
                      </label>
                      <div class="checkin__control">
                        <span class="checkin__ccy" aria-hidden="true">{{ property.currency }}</span>
                        <input
                          class="input input--num checkin__input"
                          type="number"
                          inputmode="decimal"
                          step="0.01"
                          min="0"
                          [id]="'pm-' + property.id"
                          [value]="fieldValue(mortgages, property.id, property.mortgageBalance)"
                          (input)="setField(mortgages, property.id, $event)"
                        />
                      </div>
                    </div>
                  }
                  @for (liability of liabilities(); track liability.id) {
                    <div class="field checkin__row">
                      <label class="field__label checkin__label" [for]="'li-' + liability.id">
                        {{ liability.name }}
                        <span class="field__hint">{{ kind(liability.liabilityKind) }} · still owed</span>
                      </label>
                      <div class="checkin__control">
                        <span class="checkin__ccy" aria-hidden="true">{{ liability.currency }}</span>
                        <input
                          class="input input--num checkin__input"
                          type="number"
                          inputmode="decimal"
                          step="0.01"
                          min="0"
                          [id]="'li-' + liability.id"
                          [value]="fieldValue(debts, liability.id, liability.balance)"
                          (input)="setField(debts, liability.id, $event)"
                        />
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          }

          <div class="checkin__nav">
            @if (stepIndex() > 0) {
              <button type="button" class="btn btn--ghost" (click)="back()" [disabled]="store.saving()">Back</button>
            } @else {
              <a routerLink="/dashboard" class="btn btn--quiet">Not now</a>
            }
            <span class="spacer"></span>
            @if (isLastStep()) {
              <button type="submit" class="btn btn--primary" [disabled]="store.saving()">
                {{ store.saving() ? 'Saving…' : 'Save check-in' }}
              </button>
            } @else {
              <button type="submit" class="btn btn--primary">Next</button>
            }
          </div>
        </form>
      }
    </div>
  `,
  styles: [
    `
      .checkin { max-width: 720px; }
      .checkin__why { font-size: 14px; line-height: 1.55; color: var(--ink-secondary); }

      .checkin__row--pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      @media (max-width: 560px) { .checkin__row--pair { grid-template-columns: 1fr; } }
      .steps { display: flex; gap: 8px; margin: 0; padding: 0; list-style: none; flex-wrap: wrap; }
      .steps__item {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 6px 12px 6px 6px;
        border-radius: var(--r-pill);
        border: 1px solid var(--line);
        background: var(--surface);
        font-size: 13px; color: var(--ink-muted);
      }
      .steps__num {
        width: 22px; height: 22px; border-radius: 50%;
        display: grid; place-items: center;
        font-size: 12px; font-weight: 640;
        background: var(--surface-sunken); color: var(--ink-secondary);
      }
      .steps__item.is-current { border-color: var(--brand); color: var(--ink); font-weight: 580; }
      .steps__item.is-current .steps__num { background: var(--brand); color: var(--brand-contrast); }
      .steps__item.is-done .steps__num { background: var(--status-good); color: var(--brand-contrast); }

      .checkin__list { display: flex; flex-direction: column; gap: 4px; }
      .checkin__row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(150px, 220px);
        align-items: center;
        gap: 6px 16px;
        padding: 12px 0;
        border-top: 1px solid var(--line);
      }
      .checkin__label { display: flex; flex-direction: column; gap: 2px; font-size: 14px; color: var(--ink); }
      .checkin__control { position: relative; display: flex; align-items: center; }
      .checkin__ccy {
        position: absolute; left: 12px;
        font-size: 12px; font-weight: 600; color: var(--ink-muted);
        pointer-events: none;
      }
      .checkin__input { min-height: 46px; font-size: 16px; padding-left: 52px; }
      .checkin__zero { grid-column: 2; justify-self: end; }

      .checkin__optional { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--line); padding-top: 12px; }
      .checkin__disclose { align-self: flex-start; gap: 6px; }
      .checkin__disclose svg { transition: transform .16s ease; }
      .checkin__disclose svg.is-open { transform: rotate(180deg); }

      .checkin__nav { display: flex; align-items: center; gap: 8px; padding-top: 4px; }
      .checkin__nav .btn { min-height: 44px; padding-left: 20px; padding-right: 20px; }

      .result__lead { font-size: 16px; line-height: 1.55; }
      .result__lead strong { font-weight: 650; }

      @media (max-width: 560px) {
        .checkin__row { grid-template-columns: minmax(0, 1fr); }
        .checkin__zero { grid-column: 1; }
        .steps__label { display: none; }
        .steps__item.is-current .steps__label { display: inline; }
      }
    `,
  ],
})
export class CheckInComponent {
  readonly store = inject(FinanceStore);
  private readonly currency = inject(CurrencyService);

  readonly Math = Math;
  readonly stepTitles = STEP_TITLES;
  readonly monthName = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  /* -- what the user typed (raw text, keyed by record id) ------------- */
  // Only edited boxes are stored; everything else shows the known value.

  readonly income = signal<Record<string, string>>({});
  readonly balances = signal<Record<string, string>>({});
  readonly prices = signal<Record<string, string>>({});
  readonly accountValues = signal<Record<string, string>>({});
  readonly accountFlows = signal<Record<string, string>>({});
  readonly propertyValues = signal<Record<string, string>>({});
  readonly mortgages = signal<Record<string, string>>({});
  readonly debts = signal<Record<string, string>>({});

  readonly stepIndex = signal(0);
  readonly showHome = signal(false);
  readonly saved = signal(false);

  /* -- what there is to check ---------------------------------------- */

  readonly accounts = computed(() =>
    (this.store.data()?.accounts ?? [])
      .filter((a) => !a.isArchived)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
  );

  readonly incomeSources = computed(() => {
    const today = toIsoDate(new Date());
    return (this.store.data()?.incomeSources ?? []).filter(
      (s) => s.active && s.startDate <= today && (!s.endDate || s.endDate >= monthKey(today)),
    );
  });

  /** Investment accounts the user values as a single total. */
  readonly totalAccounts = computed(() =>
    (this.store.data()?.investmentAccounts ?? []).filter((a) => a.currentValue !== null && a.currentValue !== undefined),
  );

  /**
   * Holdings valued by price. Holdings inside a total-valued account are
   * only a breakdown of its total, so they aren't asked about here.
   */
  readonly holdings = computed(() => {
    const totals = new Set(this.totalAccounts().map((a) => a.id));
    return (this.store.data()?.investments ?? []).filter(
      (i) => i.quantity > 0 && !(i.investmentAccountId && totals.has(i.investmentAccountId)),
    );
  });
  readonly properties = computed(() => this.store.data()?.properties ?? []);
  readonly liabilities = computed(() => this.store.data()?.liabilities ?? []);
  readonly hasHomeOrDebts = computed(() => this.properties().length > 0 || this.liabilities().length > 0);

  readonly steps = computed<StepKey[]>(() =>
    this.holdings().length || this.totalAccounts().length ? ['pay', 'balances', 'investments'] : ['pay', 'balances'],
  );
  readonly step = computed(() => this.steps()[Math.min(this.stepIndex(), this.steps().length - 1)]);
  readonly isLastStep = computed(() => this.stepIndex() >= this.steps().length - 1);

  /** Income already recorded for this month, so a second check-in shows it. */
  private readonly recordedThisMonth = computed(() => {
    const thisMonth = monthKey(new Date());
    const map = new Map<string, number>();
    for (const entry of this.store.data()?.incomeHistory ?? []) {
      if (entry.incomeSourceId && monthKey(entry.periodMonth) === thisMonth) {
        map.set(entry.incomeSourceId, entry.netAmount);
      }
    }
    return map;
  });

  /* -- the result, read back from the store after saving -------------- */

  readonly spending = computed(() => {
    const latest = this.store.cashFlow().at(-1);
    if (!latest) return null;
    const isCurrent = monthKey(latest.month) === monthKey(new Date());
    return {
      isCurrent,
      label: new Date(`${monthKey(latest.month)}T00:00:00`).toLocaleDateString(undefined, { month: 'long' }),
      total: latest.totalExpenses,
      fixed: latest.essential,
      everyday: latest.flexible,
    };
  });

  /* -- field helpers -------------------------------------------------- */

  /** What usually arrives this month — the full amount only in a month it is due. */
  expectedIncome(source: IncomeSource): number {
    const recorded = this.recordedThisMonth().get(source.id);
    if (recorded !== undefined) return recorded;
    if (source.frequency === 'monthly') return source.amount;
    const gap = monthsBetween(new Date(`${source.startDate}T00:00:00`), new Date());
    if (source.frequency === 'quarterly') return gap >= 0 && gap % 3 === 0 ? source.amount : 0;
    if (source.frequency === 'annual') return gap >= 0 && gap % 12 === 0 ? source.amount : 0;
    return gap === 0 ? source.amount : 0; // one-off
  }

  incomeValue(source: IncomeSource): string {
    return this.income()[source.id] ?? toField(this.expectedIncome(source));
  }

  incomeHint(source: IncomeSource): string {
    const usual = this.currency.formatIn(source.amount, source.currency, { decimals: 0 });
    if (source.frequency === 'monthly') return `Usually ${usual} a month`;
    if (source.frequency === 'one_off') return `One-off payment of ${usual} — enter it if it arrived this month`;
    return `${humanize(source.frequency)}, usually ${usual} — enter what arrived this month`;
  }

  setIncome(id: string, event: Event): void {
    this.setField(this.income, id, event);
  }

  zeroIncome(id: string): void {
    this.income.update((values) => ({ ...values, [id]: '0' }));
  }

  /** Credit cards are entered as a positive "balance owed". */
  balanceValue(account: Account): string {
    const original = account.accountType === 'credit_card' ? Math.abs(account.balance) : account.balance;
    return this.balances()[account.id] ?? toField(original);
  }

  fieldValue(store: WritableSignal<Record<string, string>>, id: string, original: number): string {
    return store()[id] ?? toField(original);
  }

  setField(store: WritableSignal<Record<string, string>>, id: string, event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    store.update((values) => ({ ...values, [id]: text }));
  }

  holdingValue(id: string, quantity: number, original: number): number {
    return quantity * (parseField(this.prices()[id]) ?? original);
  }

  formatIn(value: number, currency: string): string {
    return this.currency.formatIn(value, currency, { decimals: 0 });
  }

  accountKind(account: Account): string {
    return humanize(account.accountType);
  }

  kind(value: string): string {
    return humanize(value);
  }

  money(value: number): string {
    return this.currency.format(value, { decimals: 0 });
  }

  /* -- navigation ----------------------------------------------------- */

  back(): void {
    this.stepIndex.update((i) => Math.max(0, i - 1));
    scrollTop();
  }

  next(): void {
    if (this.isLastStep()) {
      void this.save();
      return;
    }
    this.stepIndex.update((i) => i + 1);
    scrollTop();
  }

  /* -- saving --------------------------------------------------------- */

  private buildInput(): CheckInInput {
    const changed = (text: string | undefined, original: number): number | null => {
      const value = parseField(text);
      return value !== null && Math.abs(value - original) > 0.000_001 ? value : null;
    };

    const balances: CheckInInput['balances'] = [];
    for (const account of this.accounts()) {
      const isCard = account.accountType === 'credit_card';
      const shown = isCard ? Math.abs(account.balance) : account.balance;
      const value = changed(this.balances()[account.id], shown);
      if (value === null) continue;
      // Keep the sign convention the card was stored with.
      const balance = isCard && account.balance < 0 ? -Math.abs(value) : value;
      balances.push({ accountId: account.id, balance });
    }

    const prices: CheckInInput['prices'] = [];
    for (const holding of this.holdings()) {
      const value = changed(this.prices()[holding.id], holding.currentPrice);
      if (value !== null && value >= 0) prices.push({ investmentId: holding.id, currentPrice: value });
    }

    const properties: CheckInInput['properties'] = [];
    for (const property of this.properties()) {
      const value = changed(this.propertyValues()[property.id], property.estimatedValue);
      const mortgage = changed(this.mortgages()[property.id], property.mortgageBalance);
      if (value === null && mortgage === null) continue;
      properties.push({
        propertyId: property.id,
        estimatedValue: value ?? property.estimatedValue,
        mortgageBalance: mortgage ?? property.mortgageBalance,
      });
    }

    const liabilities: CheckInInput['liabilities'] = [];
    for (const liability of this.liabilities()) {
      const value = changed(this.debts()[liability.id], liability.balance);
      if (value !== null) liabilities.push({ liabilityId: liability.id, balance: Math.max(0, value) });
    }

    // Income is always confirmed, changed or not.
    const income: CheckInInput['income'] = this.incomeSources().map((source) => ({
      incomeSourceId: source.id,
      netAmount: Math.max(0, parseField(this.income()[source.id]) ?? this.expectedIncome(source)),
      currency: source.currency,
    }));

    const investmentAccounts: NonNullable<CheckInInput['investmentAccounts']> = [];
    for (const account of this.totalAccounts()) {
      const value = changed(this.accountValues()[account.id], account.currentValue ?? 0);
      const moved = parseField(this.accountFlows()[account.id]) ?? 0;
      // Confirming an unchanged total still counts as "updated today".
      const confirmed = value ?? account.currentValue ?? 0;
      investmentAccounts.push({ investmentAccountId: account.id, currentValue: Math.max(0, confirmed), moneyMoved: moved });
    }

    return { balances, prices, income, properties, liabilities, investmentAccounts };
  }

  async save(): Promise<void> {
    if (this.store.saving()) return;
    const ok = await this.store.checkIn(this.buildInput());
    if (ok) {
      this.saved.set(true);
      scrollTop();
    }
  }
}

function scrollTop(): void {
  try {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch {
    // Not available (tests / old browsers) — harmless.
  }
}
