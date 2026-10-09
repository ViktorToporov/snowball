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

import { formatMonth, parseDate } from '../../core/money/format';
import { CurrencyService } from '../../core/money/currency.service';
import {
  DEFAULT_MARGIN,
  Point,
  Series,
  linePath,
  nearestIndex,
  niceDomain,
  scaleLinear,
  smoothPath,
  tickIndices,
} from './chart-utils';

interface RenderedSeries {
  key: string;
  name: string;
  color: string;
  dashed: boolean;
  area: boolean;
  path: string;
  areaPath: string;
  end: Point | null;
  endValue: number | null;
}

/**
 * Multi-series line / area chart.
 *
 * Ships with the hover layer by default: a snapping crosshair, one
 * tooltip listing every series at that x, and a toggleable legend for
 * two or more series (a single series gets no legend box — the card
 * title already names it).
 */
@Component({
  selector: 'sb-line-chart',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chart" #host>
      @if (visibleSeries().length > 1) {
        <div class="legend chart__legend">
          @for (s of series(); track s.key) {
            <button
              type="button"
              class="legend__item"
              [attr.aria-pressed]="!hidden().has(s.key)"
              (click)="toggle(s.key)"
            >
              <span class="legend__key" [style.background]="s.color"></span>
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
        (pointermove)="onMove($event)"
        (pointerleave)="hover.set(null)"
        (focus)="onFocus()"
        tabindex="0"
      >
        <!-- gridlines: hairline, solid, recessive -->
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

        @if (zeroY(); as zy) {
          <line
            class="chart__zero"
            [attr.x1]="margin.left"
            [attr.x2]="width() - margin.right"
            [attr.y1]="zy"
            [attr.y2]="zy"
          />
        }

        @for (tick of xTicks(); track tick.index) {
          <text class="axis-label" [attr.x]="tick.x" [attr.y]="height() - 8" text-anchor="middle">
            {{ tick.text }}
          </text>
        }

        @for (s of rendered(); track s.key) {
          @if (s.area && s.areaPath) {
            <path [attr.d]="s.areaPath" [attr.fill]="s.color" opacity="0.1" />
          }
        }

        @for (s of rendered(); track s.key) {
          <path
            [attr.d]="s.path"
            fill="none"
            [attr.stroke]="s.color"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            [attr.stroke-dasharray]="s.dashed ? '5 4' : null"
          />
        }

        <!-- end markers carry a 2px surface ring so they stay legible on crossings -->
        @for (s of rendered(); track s.key) {
          @if (s.end && showEndDots()) {
            <circle
              [attr.cx]="s.end.x"
              [attr.cy]="s.end.y"
              r="4"
              [attr.fill]="s.color"
              class="chart__end-dot"
            />
          }
        }

        @if (hover(); as h) {
          <line
            class="chart__crosshair"
            [attr.x1]="h.x"
            [attr.x2]="h.x"
            [attr.y1]="margin.top"
            [attr.y2]="height() - margin.bottom"
          />
          @for (row of h.rows; track row.key) {
            <circle [attr.cx]="h.x" [attr.cy]="row.y" r="4.5" [attr.fill]="row.color" class="chart__end-dot" />
          }
        }
      </svg>

      @if (hover(); as h) {
        <div
          class="chart-tooltip"
          [style.left.px]="tooltipLeft(h.x)"
          [style.top.px]="margin.top + 4"
        >
          <div class="chart-tooltip__head">{{ h.label }}</div>
          @for (row of h.rows; track row.key) {
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
      svg { width: 100%; overflow: visible; outline: none; }
      svg:focus-visible { outline: 2px solid var(--brand); outline-offset: 4px; border-radius: 8px; }
      .chart__grid { stroke: var(--grid); stroke-width: 1; }
      .chart__zero { stroke: var(--axis); stroke-width: 1; }
      .chart__crosshair { stroke: var(--ink-muted); stroke-width: 1; opacity: 0.5; }
      .chart__end-dot { stroke: var(--surface); stroke-width: 2; }
    `,
  ],
})
export class LineChartComponent {
  private readonly currency = inject(CurrencyService);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');

  readonly series = input.required<Series[]>();
  readonly height = input(240);
  readonly width = input(720);
  readonly zeroBased = input(true);
  readonly smooth = input(true);
  readonly showEndDots = input(true);
  /** 'currency' | 'percent' | 'number' */
  readonly valueFormat = input<'currency' | 'percent' | 'number'>('currency');
  readonly labelFormat = input<'month' | 'raw'>('month');
  readonly ariaLabel = input('Line chart');

  readonly margin = DEFAULT_MARGIN;
  readonly hidden = signal(new Set<string>());
  readonly hover = signal<{
    x: number;
    label: string;
    rows: Array<{ key: string; name: string; color: string; text: string; y: number }>;
  } | null>(null);

  readonly visibleSeries = computed(() => this.series().filter((s) => !this.hidden().has(s.key)));

  private readonly labels = computed(() => this.series()[0]?.points.map((p) => p.label) ?? []);

  private readonly scales = computed(() => {
    const values = this.visibleSeries().flatMap((s) =>
      s.points.map((p) => p.value).filter((v): v is number => v !== null),
    );
    const domain = niceDomain(values, { zeroBased: this.zeroBased() });

    const innerWidth = this.width() - this.margin.left - this.margin.right;
    const count = this.labels().length;

    const x = (index: number) => this.margin.left + (count <= 1 ? innerWidth / 2 : (index / (count - 1)) * innerWidth);
    const y = scaleLinear([domain.min, domain.max], [this.height() - this.margin.bottom, this.margin.top]);

    return { x, y, domain };
  });

  readonly yTicks = computed(() => {
    const { y, domain } = this.scales();
    return domain.ticks.map((value) => ({ value, y: y(value), text: this.formatTick(value) }));
  });

  readonly xTicks = computed(() => {
    const { x } = this.scales();
    const labels = this.labels();
    return tickIndices(labels.length, 7).map((index) => ({
      index,
      x: x(index),
      text: this.formatLabel(labels[index]),
    }));
  });

  readonly zeroY = computed(() => {
    const { y, domain } = this.scales();
    return domain.min < 0 && domain.max > 0 ? y(0) : null;
  });

  readonly rendered = computed<RenderedSeries[]>(() => {
    const { x, y } = this.scales();
    const baseline = this.height() - this.margin.bottom;

    return this.visibleSeries().map((series) => {
      const points: Point[] = [];
      series.points.forEach((point, index) => {
        if (point.value === null) return;
        points.push({ x: x(index), y: y(point.value) });
      });

      const path = points.length ? (this.smooth() ? smoothPath(points) : linePath(points)) : '';
      const areaPath =
        series.area && points.length
          ? `${path} L ${points.at(-1)!.x} ${baseline} L ${points[0].x} ${baseline} Z`
          : '';

      return {
        key: series.key,
        name: series.name,
        color: series.color,
        dashed: !!series.dashed,
        area: !!series.area,
        path,
        areaPath,
        end: points.at(-1) ?? null,
        endValue: series.points.at(-1)?.value ?? null,
      };
    });
  });

  toggle(key: string): void {
    const next = new Set(this.hidden());
    if (next.has(key)) next.delete(key);
    else if (this.visibleSeries().length > 1) next.add(key);
    this.hidden.set(next);
  }

  onMove(event: PointerEvent): void {
    const svg = event.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const scale = this.width() / rect.width;
    const px = (event.clientX - rect.left) * scale;
    this.snapTo(px);
  }

  onFocus(): void {
    // Keyboard users get the same readout, anchored to the latest point.
    const labels = this.labels();
    if (labels.length) this.snapTo(this.scales().x(labels.length - 1));
  }

  private snapTo(px: number): void {
    const { x, y } = this.scales();
    const labels = this.labels();
    if (!labels.length) return;

    const xs = labels.map((_, index) => x(index));
    const index = nearestIndex(xs, px);
    if (index < 0) return;

    const rows = this.visibleSeries()
      .map((series) => {
        const value = series.points[index]?.value ?? null;
        if (value === null) return null;
        return {
          key: series.key,
          name: series.name,
          color: series.color,
          text: this.formatValue(value),
          y: y(value),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    this.hover.set({ x: xs[index], label: this.formatLabel(labels[index], true), rows });
  }

  tooltipLeft(x: number): number {
    const element = this.host().nativeElement;
    const ratio = element.clientWidth / this.width();
    const left = x * ratio;
    return Math.max(70, Math.min(left, element.clientWidth - 70));
  }

  private formatValue(value: number): string {
    if (this.valueFormat() === 'percent') return this.currency.percent(value, 1);
    if (this.valueFormat() === 'number') return value.toLocaleString(this.currency.locale());
    return this.currency.format(value, { decimals: Math.abs(value) < 1000 ? 2 : 0 });
  }

  private formatTick(value: number): string {
    if (this.valueFormat() === 'percent') return `${Math.round(value)}%`;
    if (this.valueFormat() === 'number') return Math.round(value).toLocaleString(this.currency.locale());
    return this.currency.compact(value);
  }

  /**
   * Long spans get year-only ticks. "Nov 26" on a 20-year axis reads as
   * a day of the month, not as 2026.
   */
  private readonly spansYears = computed(() => {
    const labels = this.labels();
    if (labels.length < 2) return 0;
    const first = parseDate(labels[0]);
    const last = parseDate(labels.at(-1)!);
    if (!first || !last) return 0;
    return (last.getTime() - first.getTime()) / (365.25 * 86_400_000);
  });

  private formatLabel(label: string, long = false): string {
    if (this.labelFormat() === 'raw') return label;
    const date = parseDate(label);
    if (!date) return label;
    if (long) return date.toLocaleDateString(this.currency.locale(), { month: 'long', year: 'numeric' });
    if (this.spansYears() > 4) return String(date.getFullYear());
    return formatMonth(label, this.currency.locale());
  }
}
