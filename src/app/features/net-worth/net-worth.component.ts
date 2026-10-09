import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { CurrencyService } from '../../core/money/currency.service';
import { AssetKind, LiabilityKind, OtherAsset, Liability } from '../../core/models/domain.models';
import { FinanceStore } from '../../core/state/finance.store';
import { RangeKey, Series, applyRange, seriesColor } from '../../shared/charts/chart-utils';
import { DonutChartComponent } from '../../shared/charts/donut-chart.component';
import { LineChartComponent } from '../../shared/charts/line-chart.component';
import { ExplainComponent } from '../../shared/ui/explain.component';
import { StatCardComponent } from '../../shared/ui/stat-card.component';
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
  { value: 'receivable', label: 'Money owed to you' },
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
    ReactiveFormsModule,
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
          <p class="eyebrow">Balance sheet</p>
          <h1 class="h1">Net worth</h1>
        </div>
        <div class="page-head__actions">
          <button type="button" class="btn btn--ghost btn--sm" (click)="openAsset()">Add asset</button>
          <button type="button" class="btn btn--ghost btn--sm" (click)="openLiability()">Add liability</button>
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
            <p class="hero__equation">
              {{ money(nw.totalAssets) }} in assets
              <span class="muted">−</span>
              {{ money(nw.totalLiabilities) }} in liabilities
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
          <sb-stat-card label="Liquid net worth" explain="liquid-cash" [value]="nw.liquidNetWorth" [caption]="'Cash and investments, less short-term debt'" />
          <sb-stat-card label="Invested" explain="portfolio-value" [value]="nw.investedNetWorth" [caption]="sharePct(nw.investedNetWorth, nw.totalAssets) + ' of assets'" />
          <sb-stat-card label="Property equity" explain="property-equity" [value]="nw.propertyEquity" [caption]="propertyCaption()" />
          <sb-stat-card label="Total liabilities" [value]="nw.totalLiabilities" [invertDelta]="true" [caption]="sharePct(nw.totalLiabilities, nw.totalAssets) + ' of assets'" />
        </div>

        <!-- --------------------------------------------------------- -->
        <div class="grid grid--wide-left">
          <sb-section title="Net worth over time" explain="net-worth" subtitle="Assets, liabilities and the resulting net position.">
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
              <sb-empty title="No history yet" text="Snapshots build up as your balances change." />
            }
          </sb-section>

          <sb-section title="Composition" subtitle="Every asset class, at today's values.">
            <sb-donut-chart [data]="assetMix()" centerLabel="Assets" [stacked]="true" ariaLabel="Assets by class" />
          </sb-section>
        </div>

        <!-- --------------------------------------------------------- -->
        <div class="grid grid--2">
          <sb-section title="Assets" subtitle="What you own." [flush]="true">
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr><th>Item</th><th>Type</th><th class="t-right">Value</th><th></th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td class="table__primary">Cash accounts</td>
                    <td class="secondary">Liquid</td>
                    <td class="num">{{ money(nw.cash) }}</td>
                    <td></td>
                  </tr>
                  <tr>
                    <td class="table__primary">Investment portfolio</td>
                    <td class="secondary">Invested</td>
                    <td class="num">{{ money(nw.investments) }}</td>
                    <td></td>
                  </tr>
                  @for (property of store.properties(); track property.property.id) {
                    <tr>
                      <td class="table__primary">{{ property.property.name }}</td>
                      <td class="secondary">Property</td>
                      <td class="num">{{ moneyIn(property.property.estimatedValue, property.property.currency) }}</td>
                      <td></td>
                    </tr>
                  }
                  @for (asset of store.data()?.otherAssets ?? []; track asset.id) {
                    <tr>
                      <td class="table__primary">{{ asset.name }}</td>
                      <td class="secondary">{{ assetKindLabel(asset.assetKind) }}</td>
                      <td class="num">{{ moneyIn(asset.currentValue, asset.currency) }}</td>
                      <td class="t-right">
                        <button type="button" class="btn btn--quiet btn--sm" (click)="openAsset(asset)">Edit</button>
                      </td>
                    </tr>
                  }
                </tbody>
                <tfoot>
                  <tr class="total-row">
                    <td colspan="2">Total assets</td>
                    <td class="num">{{ money(nw.totalAssets) }}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </sb-section>

          <sb-section title="Liabilities" subtitle="What you owe." [flush]="true">
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr><th>Item</th><th>Type</th><th class="t-right">Balance</th><th></th></tr>
                </thead>
                <tbody>
                  @for (property of store.properties(); track property.property.id) {
                    @if (property.property.mortgageBalance > 0) {
                      <tr>
                        <td class="table__primary">{{ property.property.name }} — mortgage</td>
                        <td class="secondary">
                          Mortgage · {{ pct(property.property.mortgageInterestRate * 100, 2) }}
                        </td>
                        <td class="num">{{ moneyIn(property.property.mortgageBalance, property.property.currency) }}</td>
                        <td></td>
                      </tr>
                    }
                  }
                  @for (card of creditCards(); track card.id) {
                    <tr>
                      <td class="table__primary">{{ card.name }}</td>
                      <td class="secondary">Credit card</td>
                      <td class="num">{{ moneyIn(card.balance, card.currency) }}</td>
                      <td></td>
                    </tr>
                  }
                  @for (liability of store.data()?.liabilities ?? []; track liability.id) {
                    <tr>
                      <td class="table__primary">{{ liability.name }}</td>
                      <td class="secondary">
                        {{ liabilityKindLabel(liability.liabilityKind) }}
                        @if (liability.interestRate > 0) {
                          · {{ pct(liability.interestRate * 100, 2) }}
                        }
                      </td>
                      <td class="num">{{ moneyIn(liability.balance, liability.currency) }}</td>
                      <td class="t-right">
                        <button type="button" class="btn btn--quiet btn--sm" (click)="openLiability(liability)">Edit</button>
                      </td>
                    </tr>
                  }
                  @if (!hasMortgage() && !creditCards().length && !(store.data()?.liabilities ?? []).length) {
                    <tr><td colspan="4"><p class="small muted" style="padding:8px 0">No liabilities recorded.</p></td></tr>
                  }
                </tbody>
                <tfoot>
                  <tr class="total-row">
                    <td colspan="2">Total liabilities</td>
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
            valuations. Update them on this page whenever you get a better number.
          </span>
        </div>
      }

      <!-- ============================================================ -->
      @if (assetOpen()) {
        <div class="scrim" (click)="assetOpen.set(false)" role="presentation">
          <div class="dialog" role="dialog" aria-modal="true" aria-label="Asset" (click)="$event.stopPropagation()">
            <h2 class="h2">{{ editingAssetId() ? 'Edit asset' : 'Add asset' }}</h2>

            <form [formGroup]="assetForm" (ngSubmit)="saveAsset()" class="col" style="gap:12px">
              <div class="field">
                <label class="field__label" for="as-name">Name</label>
                <input id="as-name" class="input" formControlName="name" placeholder="Car — 2016 hatchback" />
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="as-kind">Type</label>
                  <select id="as-kind" class="select" formControlName="assetKind">
                    @for (option of assetKinds; track option.value) {
                      <option [value]="option.value">{{ option.label }}</option>
                    }
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="as-value">Current value</label>
                  <input id="as-value" class="input input--num" type="number" step="0.01" formControlName="currentValue" />
                </div>
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="as-purchase">Purchase value</label>
                  <input id="as-purchase" class="input input--num" type="number" step="0.01" formControlName="purchaseValue" />
                </div>
                <div class="field">
                  <label class="field__label" for="as-dep">Annual depreciation (%)</label>
                  <input id="as-dep" class="input input--num" type="number" step="0.1" formControlName="depreciationPercent" />
                  <span class="field__hint">Applied in forecasts.</span>
                </div>
              </div>

              <div class="row" style="justify-content:space-between">
                @if (editingAssetId()) {
                  <button type="button" class="btn btn--quiet btn--sm" (click)="confirmAssetDelete.set(true)">Delete</button>
                } @else { <span></span> }
                <div class="row" style="gap:8px">
                  <button type="button" class="btn btn--ghost" (click)="assetOpen.set(false)">Cancel</button>
                  <button type="submit" class="btn btn--primary" [disabled]="assetForm.invalid">Save</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      }

      @if (liabilityOpen()) {
        <div class="scrim" (click)="liabilityOpen.set(false)" role="presentation">
          <div class="dialog" role="dialog" aria-modal="true" aria-label="Liability" (click)="$event.stopPropagation()">
            <h2 class="h2">{{ editingLiabilityId() ? 'Edit liability' : 'Add liability' }}</h2>

            <form [formGroup]="liabilityForm" (ngSubmit)="saveLiability()" class="col" style="gap:12px">
              <div class="field">
                <label class="field__label" for="li-name">Name</label>
                <input id="li-name" class="input" formControlName="name" placeholder="Car loan" />
              </div>

              <div class="grid grid--2" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="li-kind">Type</label>
                  <select id="li-kind" class="select" formControlName="liabilityKind">
                    @for (option of liabilityKinds; track option.value) {
                      <option [value]="option.value">{{ option.label }}</option>
                    }
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="li-balance">Balance</label>
                  <input id="li-balance" class="input input--num" type="number" step="0.01" formControlName="balance" />
                </div>
              </div>

              <div class="grid grid--3" style="gap:12px">
                <div class="field">
                  <label class="field__label" for="li-rate">Interest (%)</label>
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
                  <button type="submit" class="btn btn--primary" [disabled]="liabilityForm.invalid">Save</button>
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
        title="Delete this liability?"
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
        name: 'Assets',
        color: seriesColor(2),
        points: ranged.map((p) => ({ label: p.label, value: p.assets })),
      },
      {
        key: 'liabilities',
        name: 'Liabilities',
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
    return `${Math.round(properties[0].loanToValue)}% loan-to-value`;
  });

  /* -- actions -------------------------------------------------------- */

  openAsset(asset?: OtherAsset): void {
    this.editingAssetId.set(asset?.id ?? null);
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
      currency: this.currency.baseCurrency(),
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
      currency: this.currency.baseCurrency(),
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

  money(value: number | null, signed = false): string {
    return this.currency.format(value, { signed, decimals: Math.abs(value ?? 0) >= 10000 ? 0 : undefined });
  }

  moneyIn(value: number, currencyCode: string): string {
    return this.currency.formatIn(value, currencyCode, { decimals: Math.abs(value) >= 10000 ? 0 : undefined });
  }

  pct(value: number, decimals = 1): string {
    return this.currency.percent(value, decimals);
  }
}
