/**
 * The shape of a "how is this worked out?" explanation.
 *
 * Every calculated figure in Snowball can produce one of these, filled
 * in with the user's own current numbers rather than a generic example.
 * The point is that anything the app asserts can be checked by hand.
 */

export interface ExplainStep {
  label: string;
  value: string;
  /** Optional aside: where the number came from, or why it is that. */
  hint?: string;
  /** Renders as a subtraction rather than an addition in the list. */
  negative?: boolean;
}

export interface Explanation {
  title: string;
  /** One sentence: what the number means. */
  summary: string;
  /** The method, written as an equation. */
  formula: string;
  /** The same equation, with this user's actual figures substituted. */
  steps: ExplainStep[];
  result: { label: string; value: string };
  /** Caveats, rounding, or what would change it. */
  note?: string;
  /** Where the inputs are maintained, so the reader can go and check. */
  source?: string;
}

export type ExplainKey =
  | 'net-worth'
  | 'liquid-cash'
  | 'total-cash'
  | 'emergency-fund'
  | 'available-above-floor'
  | 'security-score'
  | 'runway'
  | 'monthly-income'
  | 'essential-expenses'
  | 'total-spending'
  | 'flexible-spending'
  | 'savings-capacity'
  | 'savings-rate'
  | 'interest-per-year'
  | 'portfolio-value'
  | 'portfolio-cost'
  | 'unrealised-gain'
  | 'portfolio-return'
  | 'time-weighted-return'
  | 'contributions-vs-growth'
  | 'allocation-drift'
  | 'rebalance'
  | 'property-equity'
  | 'loan-to-value'
  | 'property-cash-flow'
  | 'rental-yield'
  | 'mortgage-split'
  | 'property-reserve'
  | 'goal-required'
  | 'planned-required'
  | 'strategy-status'
  | 'forecast'
  | 'currency-conversion';
