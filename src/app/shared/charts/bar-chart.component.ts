import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';

import { CurrencyService } from '../../core/money/currency.service';
import { formatMonth, parseDate } from '../../core/money/format';
import { DEFAULT_MARGIN, Series, barPath, niceDomain, scaleLinear, tickIndices } from './chart-utils';

interface Bar {
  key: string;
  seriesKey: string;
  name: string;
  color: string;
  path: string;
  x: number;
  width: number;
  value: number;
  labelIndex: number;
}

/**
 * Grouped column chart — the monthly income-vs-expenses comparison.
 *
 * Marks follow the spec: capped at 24px thick, 4px rounded data-end,
 * square at the baseline, with a 2px surface gap between neighbours.
 * The mark itself is the hit target; there is no crosshair.
 */
@Component({
  selector: 'sb-bar-chart',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chart" #host>
      @if (series().length > 1) {
        <div class="legend chart__legend">
          @for (s of series(); track s.key) {
            <button
              type="button"
              class="legend__item"
              [attr.aria-pressed]="!hidden().has(s.key)"
              (click)="toggle(s.key)"
            >
              <span class="legend__key legend__key--rect" [style.background]="s.color"></span>
              <span>{{ s.name }}</span>
            </button>
          }
        </div>
      }

      <svg
        [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
        [style.height.px]="height()"
        preserveAspectRatio="none"
        role="img"
        [attr.aria-label]="ariaLabel()"
        (pointerleave)="hover.set(null)"
      >
        @for (tick of yTicks(); track tick.value) {
          <line
            class="chart__grid"
            [attr.x1]="margin.left"
            [attr.x2]="width() - margin.right"
            [attr.y1]="tick.y"
            [attr.y2]="tick.y"
          />
          <text class="axis-label" [attr.x]="margin.left - 8" [attr.y]="tick.y + 3.5" text-anchor="end">
            {{ tick.text }}
          </text>
        }

        <line
          class="chart__axis"
          [attr.x1]="margin.left"
          [attr.x2]="width() - margin.right"
          [attr.y1]="baseline()"
          [attr.y2]="baseline()"
        />

        @for (tick of xTicks(); track tick.index) {
          <text class="axis-label" [attr.x]="tick.x" [attr.y]="height() - 8" text-anchor="middle">
            {{ tick.text }}
          </text>
        }

        @if (lineOverlay(); as overlay) {
          <path [attr.d]="overlay.path" fill="none" [attr.stroke]="overlay.color" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="5 4" />
        }

        @for (bar of bars(); track bar.key) {
          <path
            [attr.d]="bar.path"
            [attr.fill]="bar.color"
            [class.is-dim]="hover() && hover()!.key !== bar.key"
          />
          <!-- hit target is wider than the mark -->
          <rect
            [attr.x]="bar.x - 4"
            [attr.width]="bar.width + 8"
            [attr.y]="margin.top"
            [attr.height]="baseline() - margin.top"
            fill="transparent"
            (pointerenter)="hover.set(bar)"
            (focus)="hover.set(bar)"
            tabindex="0"
            [attr.aria-label]="bar.name + ' ' + format(bar.value)"
          />
        }
      </svg>

      @if (hover(); as bar) {
        <div class="chart-tooltip" [style.left.px]="tooltipLeft(bar.x + bar.width / 2)" [style.top.px]="margin.top + 4">
          <div class="chart-tooltip__head">{{ labelAt(bar.labelIndex) }}</div>
          @for (row of rowsAt(bar.labelIndex); track row.key) {
            <div class="chart-tooltip__row">
              <span class="chart-tooltip__key" [style.background]="row.color"></span>
              <span class="chart-tooltip__name">{{ row.name }}</span>
              <span class="chart-tooltip__val">{{ row.text }}</span>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .chart { position: relative; width: 100%; }
      .chart__legend { margin-bottom: 10px; }
      svg { width: 100%; overflow: visible; }
      .chart__grid { stroke: var(--grid); stroke-width: 1; }
      .chart__axis { stroke: var(--axis); stroke-width: 1; }
      path.is-dim { opacity: 0.42; transition: opacity .12s ease; }
      rect:focus-visible { outline: 2px solid var(--brand); outline-offset: 0; }
    `,
  ],
})
export class BarChartComponent {
  private readonly currency = inject(CurrencyService);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');

  readonly series = input.required<Series[]>();
  /** Drawn as a dashed line on top of the bars — e.g. net cash flow. */
  readonly overlaySeries = input<Series | null>(null);
  readonly height = input(260);
  readonly width = input(720);
  readonly ariaLabel = input('Bar chart');

  readonly margin = DEFAULT_MARGIN;
  readonly hidden = signal(new Set<string>());
  readonly hover = signal<Bar | null>(null);

  readonly visibleSeries = computed(() => this.series().filter((s) => !this.hidden().has(s.key)));
  private readonly labels = computed(() => this.series()[0]?.points.map((p) => p.label) ?? []);

  readonly baseline = computed(() => this.height() - this.margin.bottom);

  private readonly scales = computed(() => {
    const values = [
      ...this.visibleSeries().flatMap((s) => s.points.map((p) => p.value ?? 0)),
      ...(this.overlaySeries()?.points.map((p) => p.value ?? 0) ?? []),
    ];
    const domain = niceDomain(values, { zeroBased: true });
    const y = scaleLinear([domain.min, domain.max], [this.baseline(), this.margin.top]);
    const innerWidth = this.width() - this.margin.left - this.margin.right;
    const bandWidth = innerWidth / Math.max(1, this.labels().length);
    return { y, domain, innerWidth, bandWidth };
  });

  readonly yTicks = computed(() => {
    const { y, domain } = this.scales();
    return domain.ticks.map((value) => ({ value, y: y(value), text: this.currency.compact(value) }));
  });

  readonly xTicks = computed(() => {
    const { bandWidth } = this.scales();
    return tickIndices(this.labels().length, 8).map((index) => ({
      index,
      x: this.margin.left + bandWidth * (index + 0.5),
      text: this.labelAt(index, false),
    }));
  });

  readonly bars = computed<Bar[]>(() => {
    const { y, bandWidth } = this.scales();
    const visible = this.visibleSeries();
    const zero = y(0);
    const out: Bar[] = [];

    // 2px surface gap between neighbours; bars capped at 24px thick.
    const gap = 2;
    const groupWidth = Math.min(bandWidth * 0.68, 24 * visible.length + gap * (visible.length - 1));
    const barWidth = Math.max(3, (groupWidth - gap * (visible.length - 1)) / Math.max(1, visible.length));

    this.labels().forEach((_, labelIndex) => {
      const groupStart = this.margin.left + bandWidth * (labelIndex + 0.5) - groupWidth / 2;

      visible.forEach((series, seriesIndex) => {
        const value = series.points[labelIndex]?.value ?? 0;
        const x = groupStart + seriesIndex * (barWidth + gap);
        const top = y(Math.max(0, value));
        const height = Math.abs(zero - y(value));
        if (height < 0.5) return;

        out.push({
          key: `${series.key}-${labelIndex}`,
          seriesKey: series.key,
          name: series.name,
          color: series.color,
          path: barPath(x, value >= 0 ? top : zero, barWidth, height, 4, value >= 0),
          x,
          width: barWidth,
          value,
          labelIndex,
        });
      });
    });

    return out;
  });

  readonly lineOverlay = computed(() => {
    const overlay = this.overlaySeries();
    if (!overlay) return null;
    const { y, bandWidth } = this.scales();
    const path = overlay.points
      .map((point, index) => {
        const x = this.margin.left + bandWidth * (index + 0.5);
        return `${index === 0 ? 'M' : 'L'} ${x} ${y(point.value ?? 0)}`;
      })
      .join(' ');
    return { path, color: overlay.color };
  });

  toggle(key: string): void {
    const next = new Set(this.hidden());
    if (next.has(key)) next.delete(key);
    else if (this.visibleSeries().length > 1) next.add(key);
    this.hidden.set(next);
  }

  labelAt(index: number, long = true): string {
    const label = this.labels()[index] ?? '';
    const date = parseDate(label);
    if (!date) return label;
    return long
      ? date.toLocaleDateString(this.currency.locale(), { month: 'long', year: 'numeric' })
      : formatMonth(label, this.currency.locale());
  }

  rowsAt(index: number) {
    const rows = this.visibleSeries().map((series) => ({
      key: series.key,
      name: series.name,
      color: series.color,
      text: this.format(series.points[index]?.value ?? 0),
    }));

    const overlay = this.overlaySeries();
    if (overlay) {
      rows.push({
        key: overlay.key,
        name: overlay.name,
        color: overlay.color,
        text: this.format(overlay.points[index]?.value ?? 0),
      });
    }
    return rows;
  }

  format(value: number): string {
    return this.currency.format(value, { decimals: 0 });
  }

  tooltipLeft(x: number): number {
    const element = this.host().nativeElement;
    const ratio = element.clientWidth / this.width();
    return Math.max(80, Math.min(x * ratio, element.clientWidth - 80));
  }
}
