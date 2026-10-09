import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { linePath, niceDomain, scaleLinear, smoothPath } from './chart-utils';

/**
 * The 12-point trend line inside a stat tile.
 *
 * Deliberately chrome-free — no axes, no tooltip. The tile's value and
 * delta carry the numbers; this only carries the shape.
 */
@Component({
  selector: 'sb-sparkline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.viewBox]="'0 0 ' + width + ' ' + height" [style.height.px]="height" preserveAspectRatio="none" aria-hidden="true">
      @if (areaPath()) {
        <path [attr.d]="areaPath()" [attr.fill]="color()" opacity="0.1" />
      }
      @if (path()) {
        <path
          [attr.d]="path()"
          fill="none"
          [attr.stroke]="color()"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
        />
      }
      @if (end(); as e) {
        <circle [attr.cx]="e.x" [attr.cy]="e.y" r="2.6" [attr.fill]="color()" />
      }
    </svg>
  `,
  styles: [
    `
      :host { display: block; width: 100%; }
      svg { width: 100%; display: block; }
    `,
  ],
})
export class SparklineComponent {
  readonly values = input.required<number[]>();
  readonly color = input('var(--brand)');
  readonly height = 34;
  readonly width = 120;

  private readonly points = computed(() => {
    const values = this.values().filter((v) => Number.isFinite(v));
    if (values.length < 2) return [];

    const domain = niceDomain(values, { zeroBased: false, padding: 0.12 });
    const y = scaleLinear([domain.min, domain.max], [this.height - 3, 3]);
    return values.map((value, index) => ({
      x: (index / (values.length - 1)) * this.width,
      y: y(value),
    }));
  });

  readonly path = computed(() => {
    const points = this.points();
    return points.length ? (points.length > 3 ? smoothPath(points) : linePath(points)) : '';
  });

  readonly areaPath = computed(() => {
    const points = this.points();
    if (!points.length) return '';
    return `${this.path()} L ${points.at(-1)!.x} ${this.height} L ${points[0].x} ${this.height} Z`;
  });

  readonly end = computed(() => this.points().at(-1) ?? null);
}
