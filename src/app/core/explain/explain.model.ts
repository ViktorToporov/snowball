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
  /**
   * Plain-language verdict for *this* user, shown first: what the figure
   * says about their situation, ideally against a familiar benchmark
   * ("4.2 months. Most guides suggest 3 to 6, so you're in good shape.").
   */
  meaning?: string;
  /** One sentence: what the number means. */
  summary: string;
  /** Optional link to the place where the user can act on it. */
  nextStep?: { label: string; route: string };
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

/**
 * The plain-language part of an explanation, with no numbers in it.
 * Used on its own when there is not enough data yet to work an example
 * through — so a brand-new user still gets told what a figure means.
 */
export type ExplainBasic = Pick<Explanation, 'title' | 'summary' | 'meaning' | 'nextStep' | 'source'>;

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
