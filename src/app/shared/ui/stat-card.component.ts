import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { CurrencyService } from '../../core/money/currency.service';
import { ExplainKey } from '../../core/explain/explain.model';
import { SparklineComponent } from '../charts/sparkline.component';
import { ExplainComponent } from './explain.component';

/**
 * The headline statistic tile.
 *
 * Contract: label · value · optional delta (signed, against a named
 * period) · optional 12-point sparkline. Green means the number moved
 * in the direction the user wants; red means it did not. `invertDelta`
 * flips that for figures where up is bad — expenses, debt.
 */
@Component({
  selector: 'sb-stat-card',
  standalone: true,
  imports: [CommonModule, SparklineComponent, ExplainComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stat" [class.stat--accent]="accent()">
      <div class="stat__top">
        <span class="stat__label">
          {{ label() }}
          @if (explain()) {
            <sb-explain [key]="explain()!" />
          }
        </span>
        @if (badge()) {
          <span class="badge" [class]="'badge--' + (badgeTone() || 'neutral')">{{ badge() }}</span>
        }
      </div>

      <div class="stat__value" [class.stat__value--sm]="compact()">{{ displayValue() }}</div>

      <div class="stat__foot">
        @if (deltaText(); as text) {
          <span class="stat__delta" [class.pos]="deltaGood()" [class.neg]="deltaBad()">
            {{ text }}
          </span>
          <span class="stat__period">{{ period() }}</span>
        } @else if (caption()) {
          <span class="stat__period">{{ caption() }}</span>
        }
      </div>

      @if (trend().length > 1) {
        <div class="stat__spark">
          <sb-sparkline [values]="trend()" [color]="sparkColor()" />
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .stat {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 18px 18px 16px;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: var(--r-lg);
        box-shadow: var(--shadow-sm);
        min-height: 118px;
        overflow: hidden;
        transition: border-color .16s ease, box-shadow .16s ease;
      }
      .stat:hover { border-color: var(--line-strong); box-shadow: var(--shadow-md); }
      .stat--accent { border-color: color-mix(in srgb, var(--brand) 34%, var(--line)); }

      .stat__top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .stat__label {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 12.5px;
        font-weight: 550;
        color: var(--ink-secondary);
      }
      .stat__value {
        font-size: 27px;
        font-weight: 640;
        letter-spacing: -0.028em;
        line-height: 1.15;
        color: var(--ink);
      }
      .stat__value--sm { font-size: 22px; }
      .stat__foot { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; min-height: 18px; }
      .stat__delta { font-size: 12.5px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--ink-secondary); }
      .stat__period { font-size: 12px; color: var(--ink-muted); }
      .stat__spark { position: absolute; right: 0; bottom: 0; width: 108px; opacity: .85; pointer-events: none; }
    `,
  ],
})
export class StatCardComponent {
  private readonly currency = inject(CurrencyService);

  readonly label = input.required<string>();
  readonly value = input.required<number | null>();
  readonly format = input<'currency' | 'percent' | 'number' | 'raw'>('currency');
  readonly rawValue = input<string | null>(null);
  readonly delta = input<number | null>(null);
  readonly deltaFormat = input<'currency' | 'percent'>('currency');
  readonly period = input('this month');
  readonly caption = input<string | null>(null);
  readonly invertDelta = input(false);
  readonly trend = input<number[]>([]);
  readonly accent = input(false);
  readonly compact = input(false);
  readonly badge = input<string | null>(null);
  readonly badgeTone = input<'neutral' | 'brand' | 'good' | 'warn' | 'bad'>('neutral');
  /** Shows a "how is this worked out?" icon beside the label. */
  readonly explain = input<ExplainKey | null>(null);

  readonly displayValue = computed(() => {
    if (this.format() === 'raw') return this.rawValue() ?? '—';
    const value = this.value();
    if (value === null) return '—';
    if (this.format() === 'percent') return this.currency.percent(value, value >= 100 ? 0 : 1);
    if (this.format() === 'number') return value.toLocaleString(this.currency.locale());
    return this.currency.format(value, { decimals: Math.abs(value) >= 10000 ? 0 : undefined });
  });

  readonly deltaText = computed(() => {
    const delta = this.delta();
    if (delta === null || delta === 0) return null;
    return this.deltaFormat() === 'percent'
      ? this.currency.percent(delta, 1, true)
      : this.currency.format(delta, { signed: true, decimals: Math.abs(delta) >= 1000 ? 0 : 2 });
  });

  private readonly deltaDirection = computed(() => {
    const delta = this.delta();
    if (delta === null || delta === 0) return 0;
    const sign = delta > 0 ? 1 : -1;
    return this.invertDelta() ? -sign : sign;
  });

  readonly deltaGood = computed(() => this.deltaDirection() > 0);
  readonly deltaBad = computed(() => this.deltaDirection() < 0);

  readonly sparkColor = computed(() => {
    const direction = this.deltaDirection();
    if (direction > 0) return 'var(--positive)';
    if (direction < 0) return 'var(--negative)';
    return 'var(--brand)';
  });
}
