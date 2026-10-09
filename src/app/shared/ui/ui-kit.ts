import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';

import { CurrencyService } from '../../core/money/currency.service';
import { ExplainKey } from '../../core/explain/explain.model';
import { ToastService } from '../../core/ui/toast.service';
import { ViewPrefsService } from '../../core/ui/view-prefs.service';
import { DialogDirective } from './dialog.directive';
import { ExplainComponent } from './explain.component';

/* ==================================================================== */
/* Section header                                                        */
/* ==================================================================== */

@Component({
  selector: 'sb-section',
  standalone: true,
  imports: [CommonModule, ExplainComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" [class.card--flush]="flush()">
      <header class="card__head" [class.card__head--bordered]="bordered()">
        <div>
          <h2 class="card__title">
            {{ title() }}
            @if (explain()) {
              <sb-explain [key]="explain()!" />
            }
          </h2>
          @if (subtitle()) {
            <p class="card__sub">{{ subtitle() }}</p>
          }
        </div>
        <div class="row"><ng-content select="[slot=actions]" /></div>
      </header>
      <div [class.card__body]="!flush()" [class.card__body--flush]="flush()">
        <ng-content />
      </div>
      <ng-content select="[slot=foot]" />
    </section>
  `,
  styles: [
    `
      .card__body--flush { padding: 0; }
      .card__title { display: inline-flex; align-items: center; gap: 6px; }
    `,
  ],
})
export class SectionComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly bordered = input(false);
  readonly flush = input(false);
  /** Shows a "how is this worked out?" icon beside the title. */
  readonly explain = input<ExplainKey | null>(null);
}

/* ==================================================================== */
/* Progress meter                                                        */
/* ==================================================================== */

@Component({
  selector: 'sb-meter',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      @if (label() || showValue()) {
        <div class="row row--between meter-head">
          <span class="meter-label">{{ label() }}</span>
          @if (showValue()) {
            <span class="meter-value num">{{ valueText() }}</span>
          }
        </div>
      }
      <div
        [class]="meterClass()"
        role="progressbar"
        [attr.aria-valuenow]="clamped()"
        aria-valuemin="0"
        aria-valuemax="100"
        [attr.aria-label]="label() || 'Progress'"
      >
        <div class="meter__fill" [style.width.%]="clamped()"></div>
      </div>
    </div>
  `,
  styles: [
    `
      .wrap { display: flex; flex-direction: column; gap: 7px; width: 100%; }
      .meter-head { gap: 12px; }
      .meter-label { font-size: 12.5px; color: var(--ink-secondary); font-weight: 550; }
      .meter-value { font-size: 12.5px; color: var(--ink); font-weight: 600; }
    `,
  ],
})
export class MeterComponent {
  readonly value = input.required<number>();
  readonly label = input<string | null>(null);
  readonly valueText = input<string>('');
  readonly showValue = input(true);
  readonly large = input(false);
  /** 'brand' | 'good' | 'warn' | 'bad' | 'auto' */
  readonly tone = input<'brand' | 'good' | 'warn' | 'bad' | 'auto'>('auto');

  readonly clamped = computed(() => Math.max(0, Math.min(100, this.value())));

  /** 'auto' reads severity off the fill: the meter itself carries state. */
  private readonly resolvedTone = computed(() => {
    if (this.tone() !== 'auto') return this.tone();
    const value = this.clamped();
    if (value >= 100) return 'good';
    if (value >= 50) return 'brand';
    if (value >= 20) return 'warn';
    return 'bad';
  });

  readonly meterClass = computed(
    () => `meter meter--${this.resolvedTone()}${this.large() ? ' meter--lg' : ''}`,
  );
}

/* ==================================================================== */
/* Empty / error / loading states                                        */
/* ==================================================================== */

@Component({
  selector: 'sb-empty',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="state">
      <div class="state__icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
          @switch (icon()) {
            @case ('error') {
              <circle cx="10" cy="10" r="7.25" /><path d="M10 6.5v4M10 13.4v.1" stroke-linecap="round" />
            }
            @case ('search') {
              <circle cx="8.75" cy="8.75" r="5.25" /><path d="M12.6 12.6L16.5 16.5" stroke-linecap="round" />
            }
            @default {
              <rect x="3.25" y="4.75" width="13.5" height="11.5" rx="2" />
              <path d="M3.25 8.75h13.5" stroke-linecap="round" />
            }
          }
        </svg>
      </div>
      <p class="state__title">{{ title() }}</p>
      @if (text()) {
        <p class="state__text">{{ text() }}</p>
      }
      <ng-content />
    </div>
  `,
})
export class EmptyStateComponent {
  readonly title = input.required<string>();
  readonly text = input<string | null>(null);
  readonly icon = input<'box' | 'error' | 'search'>('box');
}

@Component({
  selector: 'sb-skeleton',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      @for (row of rows(); track row) {
        <div class="skeleton" [style.height.px]="height()" [style.width.%]="widthFor(row)"></div>
      }
    </div>
  `,
  styles: [`.stack { display: flex; flex-direction: column; gap: 10px; width: 100%; }`],
})
export class SkeletonComponent {
  readonly count = input(4);
  readonly height = input(16);
  readonly rows = computed(() => Array.from({ length: this.count() }, (_, i) => i));

  widthFor(index: number): number {
    // Ragged right edge reads as text, not as a loading block.
    return [100, 86, 94, 72, 90, 80][index % 6];
  }
}

/* ==================================================================== */
/* Confirmation dialog                                                   */
/* ==================================================================== */

@Component({
  selector: 'sb-confirm',
  standalone: true,
  imports: [CommonModule, DialogDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="scrim" (click)="cancelled.emit()" role="presentation">
        <div
          class="dialog"
          role="alertdialog"
          aria-modal="true"
          [attr.aria-label]="title()"
          sbDialog
          (dismiss)="cancelled.emit()"
          (click)="$event.stopPropagation()"
        >
          <div>
            <h2 class="h2">{{ title() }}</h2>
            <p class="small secondary" style="margin-top:6px">{{ message() }}</p>
          </div>
          <div class="row" style="justify-content:flex-end; gap:8px">
            <button type="button" class="btn btn--ghost" (click)="cancelled.emit()">Cancel</button>
            <button type="button" class="btn" [class]="'btn ' + confirmClass()" (click)="confirmed.emit()">
              {{ confirmLabel() }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class ConfirmDialogComponent {
  readonly open = input(false);
  readonly title = input('Are you sure?');
  readonly message = input('This action cannot be undone.');
  readonly confirmLabel = input('Delete');
  readonly destructive = input(true);

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  readonly confirmClass = computed(() => (this.destructive() ? 'btn--danger' : 'btn--primary'));
}

/* ==================================================================== */
/* Toast host                                                            */
/* ==================================================================== */

@Component({
  selector: 'sb-toasts',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toast-host" aria-live="polite" aria-atomic="false">
      @for (toast of toasts.toasts(); track toast.id) {
        <div class="toast" [class]="'toast toast--' + toast.kind" role="status">
          <span class="toast__bar"></span>
          <div style="flex:1; min-width:0">
            <div class="toast__title">{{ toast.title }}</div>
            @if (toast.text) {
              <div class="toast__text">{{ toast.text }}</div>
            }
          </div>
          <button type="button" class="btn btn--quiet btn--sm" (click)="toasts.dismiss(toast.id)" aria-label="Dismiss">
            ✕
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastHostComponent {
  readonly toasts = inject(ToastService);
}

/* ==================================================================== */
/* Money / percent text                                                  */
/* ==================================================================== */

/** A signed monetary figure that colours itself green or red. */
@Component({
  selector: 'sb-money',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="num" [class.pos]="isPositive()" [class.neg]="isNegative()">{{ text() }}</span>`,
})
export class MoneyComponent {
  private readonly currency = inject(CurrencyService);

  readonly value = input.required<number | null>();
  readonly signed = input(false);
  readonly colour = input(true);
  readonly decimals = input<number | undefined>(undefined);
  readonly currencyCode = input<string | null>(null);

  readonly text = computed(() => {
    const value = this.value();
    if (value === null) return '—';
    const options = { signed: this.signed(), decimals: this.decimals() };
    return this.currencyCode()
      ? this.currency.formatIn(value, this.currencyCode()!, options)
      : this.currency.format(value, options);
  });

  readonly isPositive = computed(() => this.colour() && (this.value() ?? 0) > 0);
  readonly isNegative = computed(() => this.colour() && (this.value() ?? 0) < 0);
}

/* ==================================================================== */
/* Status pill — the strategy traffic light                              */
/* ==================================================================== */

@Component({
  selector: 'sb-status-pill',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="pill" [class]="'pill pill--' + tone()">
      <span class="pill__icon" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6">
          @switch (tone()) {
            @case ('good') { <path d="M2.5 6.4l2.4 2.4 4.6-5" stroke-linecap="round" stroke-linejoin="round" /> }
            @case ('warn') { <path d="M6 2.6v4.1M6 9.3v.1" stroke-linecap="round" /><circle cx="6" cy="6" r="5" /> }
            @case ('bad')  { <path d="M3.6 3.6l4.8 4.8M8.4 3.6l-4.8 4.8" stroke-linecap="round" /><circle cx="6" cy="6" r="5" /> }
            @default       { <circle cx="6" cy="6" r="5" /><path d="M6 5.4v3.2M6 3.6v.1" stroke-linecap="round" /> }
          }
        </svg>
      </span>
      <span>{{ label() }}</span>
    </span>
  `,
  styles: [
    `
      .pill {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 4px 11px 4px 9px;
        border-radius: var(--r-pill);
        font-size: 12.5px; font-weight: 600; white-space: nowrap;
      }
      .pill__icon { display: grid; place-items: center; }
      .pill--good { background: var(--status-good-soft); color: var(--positive-ink); }
      .pill--warn { background: var(--status-warn-soft); color: var(--status-warn); }
      .pill--bad  { background: var(--status-bad-soft);  color: var(--negative-ink); }
      .pill--info { background: var(--status-info-soft); color: var(--brand-ink); }
    `,
  ],
})
export class StatusPillComponent {
  readonly tone = input<'good' | 'warn' | 'bad' | 'info'>('info');
  readonly label = input.required<string>();
}

/* ==================================================================== */
/* Advanced-details switch                                               */
/* ==================================================================== */

/**
 * One switch, shared by every page: reveals the investor-grade figures
 * that most people never need. The choice is remembered per browser.
 *
 *     <sb-advanced-toggle />
 *     @if (prefs.advanced()) { …time-weighted return… }
 */
@Component({
  selector: 'sb-advanced-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="adv"
      role="switch"
      [attr.aria-checked]="prefs.advanced()"
      (click)="prefs.toggleAdvanced()"
    >
      <span class="adv__track" aria-hidden="true"><span class="adv__thumb"></span></span>
      <span>Advanced details</span>
    </button>
  `,
  styles: [
    `
      .adv {
        display: inline-flex; align-items: center; gap: 8px;
        min-height: 32px; padding: 4px 8px; border: 0; border-radius: var(--r-sm);
        background: none; color: var(--ink-secondary); font: inherit; font-size: 12.5px; font-weight: 550;
        cursor: pointer;
      }
      .adv:hover { background: var(--surface-hover); }
      .adv__track {
        position: relative; width: 28px; height: 16px; border-radius: var(--r-pill);
        background: var(--line-strong, var(--line)); transition: background-color .15s ease;
      }
      .adv__thumb {
        position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%;
        background: var(--surface); box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: transform .15s ease;
      }
      .adv[aria-checked='true'] .adv__track { background: var(--brand); }
      .adv[aria-checked='true'] .adv__thumb { transform: translateX(12px); }
    `,
  ],
})
export class AdvancedToggleComponent {
  readonly prefs = inject(ViewPrefsService);
}
