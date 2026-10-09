/**
 * Chart geometry and scales.
 *
 * Snowball draws its own SVG rather than pulling in a charting library:
 * it keeps the marks on the design system's specs (2px lines, 4px
 * rounded data-ends, 2px surface gaps, hairline gridlines), themes with
 * the same CSS custom properties as everything else, and means dark
 * mode is one token swap rather than a second palette config.
 */

export interface Point {
  x: number;
  y: number;
}

export interface SeriesPoint {
  /** ISO date or category label. */
  label: string;
  value: number | null;
}

export interface Series {
  key: string;
  name: string;
  points: SeriesPoint[];
  /** CSS custom property name, e.g. 'var(--series-1)'. */
  color: string;
  /** Draw a translucent wash under the line. */
  area?: boolean;
  /** Render dashed — reserved for projections and targets. */
  dashed?: boolean;
}

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_MARGIN: Margin = { top: 12, right: 16, bottom: 26, left: 52 };

/** The six categorical slots, in the validated order. */
export const SERIES_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
];

export function seriesColor(index: number): string {
  // Never cycle: past six slots the caller should fold into "Other".
  return SERIES_COLORS[Math.min(index, SERIES_COLORS.length - 1)];
}

/** Linear scale from a data domain onto a pixel range. */
export function scaleLinear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  return (value: number) => (span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0));
}

/**
 * A "nice" domain for an axis: rounded bounds and clean tick steps.
 * Charts that can meaningfully sit on zero do, so bar heights stay
 * proportional to their values.
 */
export function niceDomain(
  values: readonly number[],
  options: { zeroBased?: boolean; padding?: number } = {},
): { min: number; max: number; ticks: number[] } {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return { min: 0, max: 1, ticks: [0, 1] };

  let min = Math.min(...finite);
  let max = Math.max(...finite);

  if (options.zeroBased !== false && min > 0) min = 0;
  if (min === max) {
    const bump = Math.abs(min) * 0.1 || 1;
    min -= bump;
    max += bump;
  }

  const padding = options.padding ?? 0.06;
  const span = max - min;
  max += span * padding;
  if (min < 0) min -= span * padding;

  const step = niceStep((max - min) / 4);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  for (let t = niceMin; t <= niceMax + step / 2; t += step) {
    ticks.push(Math.abs(t) < step / 1e6 ? 0 : t);
  }

  return { min: niceMin, max: niceMax, ticks };
}

function niceStep(rough: number): number {
  if (rough <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalised = rough / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Monotone cubic path — smooth without the overshoot a plain spline gives. */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  const slopes = monotoneSlopes(points);
  let path = `M ${points[0].x} ${points[0].y}`;

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const dx = (p1.x - p0.x) / 3;
    path += ` C ${p0.x + dx} ${p0.y + slopes[i] * dx} ${p1.x - dx} ${p1.y - slopes[i + 1] * dx} ${p1.x} ${p1.y}`;
  }
  return path;
}

function monotoneSlopes(points: readonly Point[]): number[] {
  const n = points.length;
  const deltas: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const dx = points[i + 1].x - points[i].x;
    deltas.push(dx === 0 ? 0 : (points[i + 1].y - points[i].y) / dx);
  }

  const slopes = new Array<number>(n);
  slopes[0] = deltas[0];
  slopes[n - 1] = deltas[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    if (deltas[i - 1] * deltas[i] <= 0) slopes[i] = 0;
    else slopes[i] = (deltas[i - 1] + deltas[i]) / 2;
  }

  // Fritsch–Carlson clamp keeps the curve monotone between points.
  for (let i = 0; i < n - 1; i += 1) {
    if (deltas[i] === 0) {
      slopes[i] = 0;
      slopes[i + 1] = 0;
      continue;
    }
    const a = slopes[i] / deltas[i];
    const b = slopes[i + 1] / deltas[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      const t = 3 / h;
      slopes[i] = t * a * deltas[i];
      slopes[i + 1] = t * b * deltas[i];
    }
  }
  return slopes;
}

export function linePath(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

/**
 * A rounded rectangle with only the "data end" rounded — square where
 * it meets the baseline, per the mark spec.
 */
export function barPath(x: number, y: number, width: number, height: number, radius = 4, up = true): string {
  const r = Math.max(0, Math.min(radius, width / 2, Math.abs(height)));
  if (height <= 0) return '';

  return up
    ? `M ${x} ${y + height} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + width - r} ${y} Q ${x + width} ${y} ${x + width} ${y + r} L ${x + width} ${y + height} Z`
    : `M ${x} ${y} L ${x} ${y + height - r} Q ${x} ${y + height} ${x + r} ${y + height} L ${x + width - r} ${y + height} Q ${x + width} ${y + height} ${x + width} ${y + height - r} L ${x + width} ${y} Z`;
}

/** Donut/pie arc path. Angles in radians, measured from 12 o'clock. */
export function arcPath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle;
  if (sweep <= 0) return '';

  // A full circle can't be drawn with a single arc; split it in two.
  if (sweep >= Math.PI * 2 - 1e-6) {
    return (
      arcPath(cx, cy, outerRadius, innerRadius, startAngle, startAngle + Math.PI) +
      ' ' +
      arcPath(cx, cy, outerRadius, innerRadius, startAngle + Math.PI, startAngle + Math.PI * 2 - 1e-6)
    );
  }

  const largeArc = sweep > Math.PI ? 1 : 0;
  const p = (radius: number, angle: number): Point => ({
    x: cx + radius * Math.sin(angle),
    y: cy - radius * Math.cos(angle),
  });

  const o0 = p(outerRadius, startAngle);
  const o1 = p(outerRadius, endAngle);
  const i1 = p(innerRadius, endAngle);
  const i0 = p(innerRadius, startAngle);

  return [
    `M ${o0.x} ${o0.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${o1.x} ${o1.y}`,
    `L ${i1.x} ${i1.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${i0.x} ${i0.y}`,
    'Z',
  ].join(' ');
}

/** Nearest data index to a pixel x — the crosshair's snap. */
export function nearestIndex(xs: readonly number[], x: number): number {
  if (!xs.length) return -1;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < xs.length; i += 1) {
    const distance = Math.abs(xs[i] - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** Show at most `max` axis labels, always including the first and last. */
export function tickIndices(count: number, max = 7): number[] {
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const step = Math.ceil(count / max);
  const indices: number[] = [];
  for (let i = 0; i < count; i += step) indices.push(i);
  if (indices.at(-1) !== count - 1) indices.push(count - 1);
  return indices;
}

export type RangeKey = '3M' | '6M' | '1Y' | 'ALL';

export const RANGE_MONTHS: Record<RangeKey, number> = { '3M': 3, '6M': 6, '1Y': 12, ALL: Number.MAX_SAFE_INTEGER };

/** Trim a date-labelled series to the selected range. */
export function applyRange<T extends { label: string }>(points: readonly T[], range: RangeKey): T[] {
  if (range === 'ALL') return [...points];
  return points.slice(-RANGE_MONTHS[range]);
}
