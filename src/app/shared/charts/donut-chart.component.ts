import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { CurrencyService } from '../../core/money/currency.service';
import { arcPath, seriesColor } from './chart-utils';

export interface DonutSlice {
  label: string;
  value: number;
  color?: string;
}

interface RenderedSlice extends DonutSlice {
  path: string;
  share: number;
  fill: string;
}

/**
 * Allocation donut with a labelled legend beside it.
 *
 * The legend carries the value for every slice, which is also the
 * relief required by three light-mode series colours that sit below 3:1
 * against the surface — identity and value are never colour-only here.
 */
@Component({
  selector: 'sb-donut-chart',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="donut" [class.donut--stacked]="stacked()">
      <div class="donut__figure">
        <svg viewBox="0 0 200 200" role="img" [attr.aria-label]="ariaLabel()">
          @for (slice of slices(); track slice.label) {
            <path
              [attr.d]="slice.path"
              [attr.fill]="slice.fill"
              class="donut__slice"
              [class.is-dim]="active() !== null && active() !== slice.label"
              (pointerenter)="active.set(slice.label)"
              (pointerleave)="active.set(null)"
              (focus)="active.set(slice.label)"
              (blur)="active.set(null)"
              tabindex="0"
              [attr.aria-label]="slice.label + ': ' + format(slice.value) + ', ' + slice.share.toFixed(1) + '%'"
            />
          }
          @if (total() > 0) {
            <text x="100" y="94" text-anchor="middle" class="donut__center-value">
              {{ centerValue() }}
            </text>
            <text x="100" y="114" text-anchor="middle" class="donut__center-label">
              {{ centerLabel() }}
            </text>
          }
        </svg>
      </div>

      <ul class="donut__legend">
        @for (slice of slices(); track slice.label) {
          <li
            class="donut__legend-item"
            [class.is-dim]="active() !== null && active() !== slice.label"
            (pointerenter)="active.set(slice.label)"
            (pointerleave)="active.set(null)"
          >
            <span class="legend__key legend__key--rect" [style.background]="slice.fill"></span>
            <span class="donut__legend-label truncate">{{ slice.label }}</span>
            <span class="donut__legend-share">{{ slice.share.toFixed(1) }}%</span>
            <span class="donut__legend-value">{{ format(slice.value) }}</span>
          </li>
        }
      </ul>
    </div>
  `,
  styles: [
    `
      .donut { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 20px; align-items: center; }
      .donut--stacked, :host-context(.is-narrow) .donut { grid-template-columns: minmax(0, 1fr); }
      .donut__figure svg { width: 100%; max-width: 190px; margin: 0 auto; }
      .donut__slice {
        stroke: var(--surface);
        stroke-width: 2;      /* the 2px surface gap between touching marks */
        transition: opacity .14s ease;
        cursor: default;
      }
      .donut__slice.is-dim { opacity: 0.35; }
      .donut__slice:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
      .donut__center-value { font-size: 20px; font-weight: 640; fill: var(--ink); letter-spacing: -0.02em; }
      .donut__center-label { font-size: 10.5px; fill: var(--ink-muted); text-transform: uppercase; letter-spacing: 0.07em; }
      .donut__legend { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .donut__legend-item {
        display: grid;
        grid-template-columns: 12px minmax(0, 1fr) auto auto;
        align-items: center;
        gap: 10px;
        padding: 5px 6px;
        border-radius: 7px;
        font-size: 13px;
        transition: opacity .14s ease, background-color .14s ease;
      }
      .donut__legend-item:hover { background: var(--surface-hover); }
      .donut__legend-item.is-dim { opacity: 0.4; }
      .donut__legend-label { color: var(--ink-secondary); }
      .donut__legend-share { color: var(--ink-muted); font-variant-numeric: tabular-nums; font-size: 12px; }
      .donut__legend-value { font-weight: 560; font-variant-numeric: tabular-nums; }
      @media (max-width: 560px) {
        .donut { grid-template-columns: minmax(0, 1fr); }
      }
    `,
  ],
})
export class DonutChartComponent {
  private readonly currency = inject(CurrencyService);

  readonly data = input.required<DonutSlice[]>();
  readonly centerLabel = input('Total');
  readonly ariaLabel = input('Allocation donut chart');
  readonly stacked = input(false);
  readonly thickness = input(26);
  /** Slices beyond this fold into "Other" — the palette has six slots. */
  readonly maxSlices = input(6);

  readonly active = signal<string | null>(null);

  readonly total = computed(() => this.data().reduce((sum, slice) => sum + Math.max(0, slice.value), 0));

  readonly centerValue = computed(() => this.currency.compact(this.total()));

  /**
   * Categorical hues are assigned in fixed order and never cycled, so
   * anything past the sixth slot folds into a single neutral "Other"
   * rather than repeating a colour that already means something else.
   */
  private readonly folded = computed<DonutSlice[]>(() => {
    const positive = this.data().filter((slice) => slice.value > 0);
    const max = this.maxSlices();
    if (positive.length <= max) return positive;

    const sorted = [...positive].sort((a, b) => b.value - a.value);
    const kept = sorted.slice(0, max - 1);
    const rest = sorted.slice(max - 1);

    return [
      ...kept,
      {
        label: `Other (${rest.length})`,
        value: rest.reduce((sum, slice) => sum + slice.value, 0),
        color: 'var(--ink-muted)',
      },
    ];
  });

  readonly slices = computed<RenderedSlice[]>(() => {
    const total = this.total();
    if (total <= 0) return [];

    const outer = 88;
    const inner = outer - this.thickness();
    let angle = 0;

    return this.folded()
      .map((slice, index) => {
        const share = (slice.value / total) * 100;
        const sweep = (slice.value / total) * Math.PI * 2;
        const path = arcPath(100, 100, outer, inner, angle, angle + sweep);
        angle += sweep;
        return { ...slice, share, path, fill: slice.color ?? seriesColor(index) };
      });
  });

  format(value: number): string {
    return this.currency.format(value, { decimals: 0 });
  }
}
