import Decimal from 'decimal.js';

/**
 * Monetary arithmetic.
 *
 * PostgreSQL `numeric` arrives over PostgREST as a *string* precisely so
 * no precision is lost in transit. Everything in here works on
 * `Decimal`, so €0.1 + €0.2 is €0.30 rather than €0.30000000000000004,
 * and only converts to `number` at the edges (charts, layout maths).
 *
 * Rule of thumb for the rest of the app:
 *   · sums, differences, allocations, amortisation  → `Money` helpers
 *   · pixel positions, chart scales                 → plain numbers
 */

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type Numeric = Decimal | number | string | null | undefined;

/** Parse anything PostgREST or a form can hand us into a Decimal. */
export function dec(value: Numeric): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  if (value instanceof Decimal) return value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Decimal(value) : new Decimal(0);
  }
  // Decimal throws on unparseable input rather than yielding NaN, so a
  // malformed value from the database must not be allowed to escape.
  try {
    const parsed = new Decimal(String(value).replace(/[\s,]/g, ''));
    return parsed.isFinite() ? parsed : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

/**
 * Parse a `numeric` column into a plain number, rounded to `dp`
 * decimals. Used at the repository boundary so the rest of the app can
 * treat model fields as numbers without losing cents.
 */
export function num(value: Numeric, dp = 4): number {
  return dec(value).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toNumber();
}

export const money = {
  add: (a: Numeric, b: Numeric) => dec(a).plus(dec(b)),
  sub: (a: Numeric, b: Numeric) => dec(a).minus(dec(b)),
  mul: (a: Numeric, b: Numeric) => dec(a).times(dec(b)),

  div(a: Numeric, b: Numeric): Decimal {
    const divisor = dec(b);
    return divisor.isZero() ? new Decimal(0) : dec(a).dividedBy(divisor);
  },

  sum(values: Numeric[]): Decimal {
    return values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), new Decimal(0));
  },

  sumBy<T>(items: readonly T[], pick: (item: T) => Numeric): Decimal {
    return items.reduce<Decimal>((acc, item) => acc.plus(dec(pick(item))), new Decimal(0));
  },

  /** `part / whole` as a percentage; 0 when `whole` is 0. */
  percentOf(part: Numeric, whole: Numeric): Decimal {
    const total = dec(whole);
    return total.isZero() ? new Decimal(0) : dec(part).dividedBy(total).times(100);
  },

  /** `(current - previous) / |previous|` as a percentage; null when undefined. */
  changePercent(current: Numeric, previous: Numeric): number | null {
    const prev = dec(previous);
    if (prev.isZero()) return null;
    return dec(current).minus(prev).dividedBy(prev.abs()).times(100).toNumber();
  },

  /** Round to cents. Use before persisting or displaying. */
  round(value: Numeric, dp = 2): Decimal {
    return dec(value).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
  },

  clamp(value: Numeric, min: Numeric, max: Numeric): Decimal {
    const v = dec(value);
    const lo = dec(min);
    const hi = dec(max);
    if (v.lessThan(lo)) return lo;
    if (v.greaterThan(hi)) return hi;
    return v;
  },

  max: (...values: Numeric[]) => values.map(dec).reduce((a, b) => (a.greaterThan(b) ? a : b), new Decimal(-Infinity)),
  min: (...values: Numeric[]) => values.map(dec).reduce((a, b) => (a.lessThan(b) ? a : b), new Decimal(Infinity)),

  isPositive: (value: Numeric) => dec(value).greaterThan(0),
  isNegative: (value: Numeric) => dec(value).lessThan(0),
  isZero: (value: Numeric) => dec(value).isZero(),

  /** Plain number, safe for chart geometry. */
  toNumber: (value: Numeric, dp = 4) => num(value, dp),
};

/**
 * Split `total` into `parts` pieces whose rounded values sum back to
 * exactly `total` — the classic "penny allocation" problem. Remainder
 * cents go to the earliest buckets.
 */
export function allocate(total: Numeric, weights: readonly number[], dp = 2): number[] {
  const amount = dec(total);
  const weightTotal = weights.reduce((a, b) => a + b, 0);
  if (weightTotal <= 0 || weights.length === 0) return weights.map(() => 0);

  const unit = new Decimal(10).pow(-dp);
  const raw = weights.map((w) => amount.times(w).dividedBy(weightTotal));
  const floored = raw.map((v) => v.toDecimalPlaces(dp, Decimal.ROUND_DOWN));
  let remainder = amount.minus(floored.reduce((a, b) => a.plus(b), new Decimal(0)));

  const order = raw
    .map((v, i) => ({ i, frac: v.minus(floored[i]) }))
    .sort((a, b) => b.frac.comparedTo(a.frac));

  const out = floored.slice();
  let cursor = 0;
  while (remainder.greaterThanOrEqualTo(unit) && cursor < order.length) {
    const idx = order[cursor].i;
    out[idx] = out[idx].plus(unit);
    remainder = remainder.minus(unit);
    cursor += 1;
  }
  return out.map((v) => v.toNumber());
}

/** Compound `principal` at `annualRate` for `months`, contributing monthly. */
export function futureValue(
  principal: Numeric,
  monthlyContribution: Numeric,
  annualRate: number,
  months: number,
): Decimal {
  const monthlyRate = new Decimal(annualRate).dividedBy(12);
  let balance = dec(principal);
  const contribution = dec(monthlyContribution);
  for (let m = 0; m < months; m += 1) {
    balance = balance.times(monthlyRate.plus(1)).plus(contribution);
  }
  return balance;
}

/**
 * One step of a standard amortising loan.
 * Returns the interest and principal portions of a single payment.
 */
export function amortiseMonth(
  balance: Numeric,
  annualRate: number,
  payment: Numeric,
): { interest: Decimal; principal: Decimal; closing: Decimal } {
  const open = dec(balance);
  const interest = open.times(annualRate).dividedBy(12);
  const scheduled = dec(payment);
  // Never repay more than what is outstanding.
  const principal = Decimal.min(scheduled.minus(interest), open);
  const closing = Decimal.max(open.minus(principal), new Decimal(0));
  return { interest, principal: Decimal.max(principal, new Decimal(0)), closing };
}

/** Level payment for a fully amortising loan, for schedule reconstruction. */
export function annuityPayment(principal: Numeric, annualRate: number, months: number): Decimal {
  const p = dec(principal);
  if (months <= 0) return p;
  const r = new Decimal(annualRate).dividedBy(12);
  if (r.isZero()) return p.dividedBy(months);
  const factor = r.plus(1).pow(months);
  return p.times(r).times(factor).dividedBy(factor.minus(1));
}

export { Decimal };
