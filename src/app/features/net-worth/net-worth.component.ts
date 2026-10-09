import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { CurrencyService } from '../../core/money/currency.service';
import { AssetKind, LiabilityKind, OtherAsset, Liability } from '../../core/models/domain.models';
import { FinanceStore } from '../../core/state/finance.store';
import { RangeKey, Series, applyRange, seriesColor } from '../../shared/charts/chart-utils';
import { DonutChartComponent } from '../../shared/charts/donut-chart.component';
import { LineChartComponent } from '../../shared/charts/line-chart.component';
import { DialogDirective } from '../../shared/ui/dialog.directive';
import { ExplainComponent } from '../../shared/ui/explain.component';
import { StatCardComponent } from '../../shared/ui/stat-card.component';
import { NetWorthSplitComponent } from '../../shared/ui/net-worth-split.component';
import {
  ConfirmDialogComponent,
  EmptyStateComponent,
  SectionComponent,
  SkeletonComponent,
} from '../../shared/ui/ui-kit';

const ASSET_KINDS: Array<{ value: AssetKind; label: string }> = [
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'valuables', label: 'Valuables' },
  { value: 'pension', label: 'Pension' },
  { value: 'business', label: 'Business' },
  { value: 'receivable', label: 'Money someone owes you' },
  { value: 'other', label: 'Other' },
];

const LIABILITY_KINDS: Array<{ value: LiabilityKind; label: string }> = [
  { value: 'personal_loan', label: 'Personal loan' },
  { value: 'student_loan', label: 'Student loan' },
  { value: 'car_loan', label: 'Car loan' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'mortgage', label: 'Mortgage (not on a property)' },
  { value: 'other', label: 'Other' },
];

@Component({
  selector: 'sb-net-worth',
  standalone: true,
  imports: [
    CommonModule,
    NetWorthSplitComponent,
    ReactiveFormsModule,
    RouterLink,
    DialogDirective,
    StatCardComponent,
    SectionComponent,
    ExplainComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ConfirmDialogComponent,
    LineChartComponent,
    DonutChartComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="page-head__titles">
          <p class="eyebrow">The big picture</p>
          <h1 class="h1">Net worth</h1>
          <p class="small secondary">Everything you own minus everything you owe.</p>
        </div>
        <div class="page-head__actions">
          <button type="button" class="btn btn--ghost btn--sm" (click)="openAsset()">Add something you own</button>
          <button type="button" class="btn btn--ghost btn--sm" (click)="openLiability()">Add a debt</button>
        </div>
      </header>

      @if (store.isLoading()) {
        <div class="card card--pad"><sb-skeleton [count]="6" /></div>
      } @else if (netWorth(); as nw) {
        <!-- Hero: exactly one per view -->
        <section class="card card--pad hero">
          <div class="hero__main">
            <p class="eyebrow">Net worth today <sb-explain key="net-worth" /></p>
            <p class="hero__value">{{ money(nw.netWorth) }}</p>
            <sb-net-worth-split class="hero__split" [parts]="nw.split" [large]="true" />
            <p class="hero__equation">
              {{ money(nw.totalAssets) }} you own
              <span class="muted">−</span>
              {{ money(nw.totalLiabilities) }} you owe
            </p>
          </div>
          <div class="hero__deltas">
            <div class="hero__delta">
              <span class="hero__delta-label">This month</span>
              <span class="hero__delta-value num" [class.pos]="(nw.changeMonth ?? 0) > 0" [class.neg]="(nw.changeMonth ?? 0) < 0">
                {{ nw.changeMonth === null ? '—' : money(nw.changeMonth, true) }}
              </span>
            </div>
            <div class="hero__delta">
              <span class="hero__delta-label">Past year</span>
              <span class="hero__delta-value num" [class.pos]="(nw.changeYear ?? 0) > 0" [class.neg]="(nw.changeYear ?? 0) < 0">
                {{ nw.changeYear === null ? '—' : money(nw.changeYear, true) }}
              </span>
            </div>
          </div>
        </section>

        <div class="grid grid--stats">
          <sb-stat-card label="Without your property" [value]="nw.liquidNetWorth" caption="Cash and investments, minus debts other than mortgages" />
          <sb-stat-card label="Investments" explain="portfolio-value" [value]="nw.investedNetWorth" [caption]="sharePct(nw.investedNetWorth, nw.totalAssets) + ' of what you own'" />
          <sb-stat-card label="Your share of property" explain="property-equity" [value]="nw.propertyEquity" [caption]="propertyCaption()" />
          <sb-stat-card label="Everything you owe" [value]="nw.totalLiabilities" [invertDelta]="true" [caption]="sharePct(nw.totalLiabilities, nw.totalAssets) + ' of what you own'" />
        </div>

        <!-- --------------------------------------------------------- -->
        <div class="grid grid--wide-left">
          <sb-section title="Net worth over time" explain="net-worth" subtitle="What you own, what you owe, and the difference.">
            <div slot="actions">
              <div class="segmented" role="group" aria-label="Date range">
                @for (option of ranges; track option) {
                  <button type="button" class="segmented__item" [attr.aria-pressed]="range() === option" (click)="range.set(option)">
                    {{ option }}
                  </button>
                }
              </div>
            </div>

            @if (series().length) {
              <sb-line-chart [series]="series()" [height]="290" ariaLabel="Net worth over time" />
            } @else {
              <sb-empty title="No history yet" text="History builds up from your monthly check-ins — one point each month.">
                <a routerLink="/check-in" class="btn btn--primary btn--sm">Do a check-in</a>
              </sb-empty>
            }
          </sb-section>

          <sb-section title="What you own, by type" subtitle="At today's values.">
            <sb-donut-chart [data]="assetMix()" centerLabel="Assets" [stacked]="true" ariaLabel="What you own, by type" />
          </sb-section>
        </div>

        <!-- --------------------------------------------------------- -->
        <div class="grid grid--2">
          <sb-section title="What you own" subtitle="Your money, investments and things of value." [flush]="true">
            <div class="table-wrap">
              <table class="table table--stack">
                <thead>
                  <tr><th>Item</th><th>Type</th><th class="t-right">Value</th><th><span class="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td class="table__primary">Bank accounts and cash</td>
                    <td class="secondary" data-label="Type">Cash</td>
                    <td class="num" data-label="Value">{{ money(nw.cash) }}</td>
                    <td></td>
                  </tr>
                  <tr>
                    <td class="table__primary">Investments</td>
                    <td class="secondary" data-label="Type">Funds and shares</td>
                    <td class="num" data-label="Value">{{ money(nw.investments) }}</td>
                    <td></td>
                  </tr>
                  @for (property of store.properties(); track property.property.id) {
                    <tr>
                      <td class="table__primary">{{ property.property.name }}</td>
                      <td class="secondary" data-label="Type">Property</td>
                      <td class="num" data-label="Value">{{ moneyIn(property.property.estimatedValue, property.property.currency) }}</td>
                      <td></td>
                    </tr>
                  }
                  @for (asset of store.data()?.otherAssets ?? []; track asset.id) {
                    <tr>
                      <td class="table__primary">{{ asset.name }}</td>
                      <td class="secondary" data-label="Type">{{ assetKindLabel(asset.assetKind) }}</td>
                      <td class="num" data-label="Value">{{ moneyIn(asset.currentValue, asset.currency) }}</td>
                      <td class="t-right">
                        <button type="button" class="btn btn--quiet btn--sm" (click)="openAsset(asset)">
                          Edit<span class="sr-only"> {{ asset.name }}</span>
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
                <tfoot>
                  <tr class="total-row">
                    <td colspan="2">Total you own</td>
                    <td class="num">{{ money(nw.totalAssets) }}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </sb-section>

          <sb-section title="What you owe" subtitle="Mortgages, loans and card balances." [flush]="true">
            <div class="table-wrap">
              <table class="table table--stack">
                <thead>
                  <tr><th>Item</th><th>Type</th><th class="t-right">Still owed</th><th><span class="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  @for (property of store.properties(); track property.property.id) {
                    @if (property.property.mortgageBalance > 0) {
                      <tr>
                        <td class="table__primary">{{ property.property.name }} — mortgage</td>
                        <td class="secondary" data-label="Type">
                          Mortgage · {{ pct(property.property.mortgageInterestRate * 100, 2) }} interest
                        </td>
                        <td class="num" data-label="Still owed">{{ moneyIn(property.property.mortgageBalance, property.property.currency) }}</td>
                        <td></td>
                      </tr>
                    }
                  }
                  @for (card of creditCards(); track card.id) {
                    <tr>
                      <td class="table__primary">{{ card.name }}</td>
                      <td class="secondary" data-label="Type">Credit card</td>
                      <td class="num" data-label="Still owed">{{ moneyIn(Math.abs(card.balance), card.currency) }}</td>
                      <td></td>
                    </tr>
                  }
                  @for (liability of store.data()?.liabilities ?? []; track liability.id) {
                    <tr>
                      <td class="table__primary">{{ liability.name }}</td>
                      <td class="secondary" data-label="Type">
                        {{ liabilityKindLabel(liability.liabilityKind) }}
                        @if (liability.interestRate > 0) {
                          · {{ pct(liability.interestRate * 100, 2) }} interest
                        }
                      </td>
                      <td class="num" data-label="Still owed">{{ moneyIn(liability.balance, liability.currency) }}</td>
                      <td class="t-right">
                        <button type="button" class="btn btn--quiet btn--sm" (click)="openLiability(liability)">
                          Edit<span class="sr-only"> {{ liability.name }}</span>
                        </button>
                      </td>
                    </tr>
                  }
                  @if (!hasMortgage() && !creditCards().length && !(store.data()?.liabilities ?? []).length) {
                    <tr><td colspan="4"><p class="small muted" style="padding:8px 0">You don't owe anything — nothing to show here.</p></td></tr>
                  }
                </tbody>
                <tfoot>
                  <tr class="total-row">
                    <td colspan="2">Total you owe</td>
                    <td class="num">{{ money(nw.totalLiabilities) }}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </sb-section>
        </div>

        <div class="estimate-note">
          <span>
            <strong>Estimates included.</strong> Property and vehicle values are figures you entered, not market
            valuations. Update them whenever you get a better number — your monthly check-in asks for them.
          </span>
        </div>
      }

      <!-- ============================================================ -->
      @if (assetOpen()) {
        <div class="scrim" (click)="assetOpen.set(false)" role="presentation">
          <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="as-dialog-title" sbDialog (dismiss)="assetOpen.set(false)" (click)="$event.stopPropagation()">
            <h2 class="h2" id="as-dialog-title">{{ editingAssetId() ? 'Edit something you own' : 'Add something you own' }}</h2>
            <p class="small secondary">
              For things of value that aren't a bank account, investment or property — a car, a pension, a business.
            </p>

            <form [formGroup]="assetForm" (ngSubmit)="saveAsset()" class="col" style="gap:12px">
              <div class="field">
                <label class="field__label" for="as-name">Name</label>
                <input id="as-name" class="input" formControlName="name" placeholder="Car — 2016 hatchback" />
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="as-kind">What it is</label>
                  <select id="as-kind" class="select" formControlName="assetKind">
                    @for (option of assetKinds; track option.value) {
                      <option [value]="option.value">{{ option.label }}</option>
                    }
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="as-value">What it's worth now</label>
                  <input id="as-value" class="input input--num" type="number" step="0.01" formControlName="currentValue" />
                </div>
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="as-purchase">What you paid (optional)</label>
                  <input id="as-purchase" class="input input--num" type="number" step="0.01" formControlName="purchaseValue" />
                </div>
                <div class="field">
                  <label class="field__label" for="as-dep">Loses value each year (%)</label>
                  <input id="as-dep" class="input input--num" type="number" step="0.1" formControlName="depreciationPercent" />
                  <span class="field__hint">Used for future estimates. Leave at 0 if it keeps its value.</span>
                </div>
              </div>

              <div class="row" style="justify-content:space-between">
                @if (editingAssetId()) {
                  <button type="button" class="btn btn--quiet btn--sm" (click)="confirmAssetDelete.set(true)">Delete</button>
                } @else { <span></span> }
                <div class="row" style="gap:8px">
                  <button type="button" class="btn btn--ghost" (click)="assetOpen.set(false)">Cancel</button>
                  <button type="submit" class="btn btn--primary" [disabled]="assetForm.invalid || store.saving()">Save</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      }

      @if (liabilityOpen()) {
        <div class="scrim" (click)="liabilityOpen.set(false)" role="presentation">
          <div class="dialog dialog--wide" role="dialog" aria-modal="true" aria-labelledby="li-dialog-title" sbDialog (dismiss)="liabilityOpen.set(false)" (click)="$event.stopPropagation()">
            <h2 class="h2" id="li-dialog-title">{{ editingLiabilityId() ? 'Edit debt' : 'Add a debt' }}</h2>
            <p class="small secondary">
              Loans and other debts. Mortgages on a property you own go on the Property page; credit cards are
              picked up from your accounts.
            </p>

            <form [formGroup]="liabilityForm" (ngSubmit)="saveLiability()" class="col" style="gap:12px">
              <div class="field">
                <label class="field__label" for="li-name">Name</label>
                <input id="li-name" class="input" formControlName="name" placeholder="Car loan" />
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="li-kind">What kind</label>
                  <select id="li-kind" class="select" formControlName="liabilityKind">
                    @for (option of liabilityKinds; track option.value) {
                      <option [value]="option.value">{{ option.label }}</option>
                    }
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="li-balance">Still owed</label>
                  <input id="li-balance" class="input input--num" type="number" step="0.01" formControlName="balance" />
                </div>
              </div>

              <div class="grid grid--3" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="li-rate">Interest rate (% per year)</label>
                  <input id="li-rate" class="input input--num" type="number" step="0.01" formControlName="interestPercent" />
                </div>
                <div class="field">
                  <label class="field__label" for="li-payment">Monthly payment</label>
                  <input id="li-payment" class="input input--num" type="number" step="0.01" formControlName="monthlyPayment" />
                </div>
                <div class="field">
                  <label class="field__label" for="li-months">Months left</label>
                  <input id="li-months" class="input input--num" type="number" step="1" formControlName="remainingMonths" />
                </div>
              </div>

              <div class="row" style="justify-content:space-between">
                @if (editingLiabilityId()) {
                  <button type="button" class="btn btn--quiet btn--sm" (click)="confirmLiabilityDelete.set(true)">Delete</button>
                } @else { <span></span> }
                <div class="row" style="gap:8px">
                  <button type="button" class="btn btn--ghost" (click)="liabilityOpen.set(false)">Cancel</button>
                  <button type="submit" class="btn btn--primary" [disabled]="liabilityForm.invalid || store.saving()">Save</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      }

      <sb-confirm
        [open]="confirmAssetDelete()"
        title="Delete this asset?"
        message="It will be removed from your net worth."
        (confirmed)="deleteAsset()"
        (cancelled)="confirmAssetDelete.set(false)"
      />
      <sb-confirm
        [open]="confirmLiabilityDelete()"
        title="Delete this debt?"
        message="It will be removed from your net worth."
        (confirmed)="deleteLiability()"
        (cancelled)="confirmLiabilityDelete.set(false)"
      />
    </div>
  `,
  styleUrl: './net-worth.component.scss',
})
export class NetWorthComponent {
  readonly store = inject(FinanceStore);
  private readonly currency = inject(CurrencyService);
  private readonly fb = inject(FormBuilder);

  readonly assetKinds = ASSET_KINDS;
  readonly liabilityKinds = LIABILITY_KINDS;
  readonly ranges: RangeKey[] = ['3M', '6M', '1Y', 'ALL'];
  readonly range = signal<RangeKey>('1Y');

  readonly netWorth = this.store.netWorth;
  readonly Math = Math;
  /** Editing keeps a record's own currency; new records use the base currency. */
  private editingCurrency: string | null = null;

  readonly assetOpen = signal(false);
  readonly liabilityOpen = signal(false);
  readonly editingAssetId = signal<string | null>(null);
  readonly editingLiabilityId = signal<string | null>(null);
  readonly confirmAssetDelete = signal(false);
  readonly confirmLiabilityDelete = signal(false);

  readonly assetForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    assetKind: ['other' as AssetKind, Validators.required],
    currentValue: [0, [Validators.required, Validators.min(0)]],
    purchaseValue: [null as number | null],
    depreciationPercent: [0],
  });

  readonly liabilityForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    liabilityKind: ['personal_loan' as LiabilityKind, Validators.required],
    balance: [0, [Validators.required, Validators.min(0)]],
    interestPercent: [0],
    monthlyPayment: [0],
    remainingMonths: [0],
  });

  readonly hasMortgage = computed(() =>
    (this.store.data()?.properties ?? []).some((property) => property.mortgageBalance > 0),
  );

  /** Card balances are liabilities, and the table total already counts them. */
  readonly creditCards = computed(() =>
    (this.store.data()?.accounts ?? []).filter(
      (account) => account.accountType === 'credit_card' && !account.isArchived && account.balance !== 0,
    ),
  );

  readonly series = computed<Series[]>(() => {
    const snapshots = this.store.data()?.netWorthSnapshots ?? [];
    if (!snapshots.length) return [];

    const points = snapshots.map((s) => ({
      label: s.snapshotDate,
      netWorth: s.netWorth,
      assets: s.cashValue + s.investmentValue + s.propertyValue + s.otherAssets,
      liabilities: s.liabilities,
    }));
    const ranged = applyRange(points, this.range());

    return [
      {
        key: 'net-worth',
        name: 'Net worth',
        color: seriesColor(0),
        area: true,
        points: ranged.map((p) => ({ label: p.label, value: p.netWorth })),
      },
      {
        key: 'assets',
        name: 'What you own',
        color: seriesColor(2),
        points: ranged.map((p) => ({ label: p.label, value: p.assets })),
      },
      {
        key: 'liabilities',
        name: 'What you owe',
        color: seriesColor(1),
        points: ranged.map((p) => ({ label: p.label, value: p.liabilities })),
      },
    ];
  });

  readonly assetMix = computed(() => {
    const nw = this.netWorth();
    if (!nw) return [];
    return nw.components
      .filter((component) => component.kind === 'asset' && component.value > 0)
      .map((component) => ({ label: component.label, value: component.value }));
  });

  readonly propertyCaption = computed(() => {
    const properties = this.store.properties();
    if (!properties.length) return 'No property recorded';
    const convert = this.store.convert();
    const value = properties.reduce((sum, m) => sum + convert(m.property.estimatedValue, m.property.currency), 0);
    const owed = properties.reduce((sum, m) => sum + convert(m.property.mortgageBalance, m.property.currency), 0);
    if (owed <= 0) return 'Nothing owed on it';
    return `${value > 0 ? Math.round((owed / value) * 100) : 0}% of the value still owed`;
  });

  /* -- actions -------------------------------------------------------- */

  openAsset(asset?: OtherAsset): void {
    this.editingAssetId.set(asset?.id ?? null);
    this.editingCurrency = asset?.currency ?? null;
    this.assetForm.reset({
      name: asset?.name ?? '',
      assetKind: asset?.assetKind ?? 'other',
      currentValue: asset?.currentValue ?? 0,
      purchaseValue: asset?.purchaseValue ?? null,
      depreciationPercent: (asset?.annualDepreciation ?? 0) * 100,
    });
    this.assetOpen.set(true);
  }

  async saveAsset(): Promise<void> {
    if (this.assetForm.invalid) return;
    const raw = this.assetForm.getRawValue();
    const values = {
      name: raw.name.trim(),
      assetKind: raw.assetKind,
      currentValue: Number(raw.currentValue),
      currency: this.editingCurrency ?? this.currency.baseCurrency(),
      purchaseValue: raw.purchaseValue === null ? null : Number(raw.purchaseValue),
      annualDepreciation: Number(raw.depreciationPercent) / 100,
      isLiquid: false,
    };

    const id = this.editingAssetId();
    const ok = id
      ? await this.store.save('other_assets', id, values, 'Asset')
      : await this.store.create('other_assets', values, 'Asset');
    if (ok) this.assetOpen.set(false);
  }

  async deleteAsset(): Promise<void> {
    const id = this.editingAssetId();
    this.confirmAssetDelete.set(false);
    if (!id) return;
    if (await this.store.destroy('other_assets', id, 'Asset')) this.assetOpen.set(false);
  }

  openLiability(liability?: Liability): void {
    this.editingLiabilityId.set(liability?.id ?? null);
    this.editingCurrency = liability?.currency ?? null;
    this.liabilityForm.reset({
      name: liability?.name ?? '',
      liabilityKind: liability?.liabilityKind ?? 'personal_loan',
      balance: liability?.balance ?? 0,
      interestPercent: (liability?.interestRate ?? 0) * 100,
      monthlyPayment: liability?.monthlyPayment ?? 0,
      remainingMonths: liability?.remainingMonths ?? 0,
    });
    this.liabilityOpen.set(true);
  }

  async saveLiability(): Promise<void> {
    if (this.liabilityForm.invalid) return;
    const raw = this.liabilityForm.getRawValue();
    const values = {
      name: raw.name.trim(),
      liabilityKind: raw.liabilityKind,
      balance: Number(raw.balance),
      currency: this.editingCurrency ?? this.currency.baseCurrency(),
      interestRate: Number(raw.interestPercent) / 100,
      monthlyPayment: Number(raw.monthlyPayment),
      remainingMonths: Number(raw.remainingMonths),
    };

    const id = this.editingLiabilityId();
    const ok = id
      ? await this.store.save('liabilities', id, values, 'Liability')
      : await this.store.create('liabilities', values, 'Liability');
    if (ok) this.liabilityOpen.set(false);
  }

  async deleteLiability(): Promise<void> {
    const id = this.editingLiabilityId();
    this.confirmLiabilityDelete.set(false);
    if (!id) return;
    if (await this.store.destroy('liabilities', id, 'Liability')) this.liabilityOpen.set(false);
  }

  /* -- display -------------------------------------------------------- */

  assetKindLabel(kind: AssetKind): string {
    return ASSET_KINDS.find((option) => option.value === kind)?.label ?? kind;
  }

  liabilityKindLabel(kind: LiabilityKind): string {
    return LIABILITY_KINDS.find((option) => option.value === kind)?.label ?? kind;
  }

  sharePct(part: number, whole: number): string {
    return whole > 0 ? this.currency.percent((part / whole) * 100, 0) : '—';
  }

  /** Whole units throughout — this page is about the big picture. */
  money(value: number | null, signed = false): string {
    return this.currency.format(value, { signed, decimals: 0 });
  }

  moneyIn(value: number, currencyCode: string): string {
    return this.currency.formatIn(value, currencyCode, { decimals: 0 });
  }

  pct(value: number, decimals = 1): string {
    return this.currency.percent(value, decimals);
  }
}
