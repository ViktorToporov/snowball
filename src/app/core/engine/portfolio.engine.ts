/**
 * Portfolio valuation, performance and allocation.
 *
 * Holdings are valued as `quantity × current_price`; that product is
 * never stored, so a stale `current_value` column can't drift away from
 * the truth.
 */

import { money, dec } from '../money/money';
import { FinancialDataset, Investment } from '../models/domain.models';
import { Convert, round2 } from './metrics';

export interface Position {
  investment: Investment;
  brokerName: string | null;
  /** In the holding's own currency. */
  currentValue: number;
  costBasis: number;
  unrealisedGain: number;
  returnPercent: number;
  /** Converted into the user's base currency. */
  currentValueBase: number;
  costBasisBase: number;
  unrealisedGainBase: number;
  shareOfPortfolio: number;
  dayPriceStale: boolean;
}

export interface PortfolioSummary {
  totalValue: number;
  totalCost: number;
  unrealisedGain: number;
  realisedGain: number;
  totalReturnPercent: number;
  /** Cash actually paid in, from the contribution ledger. */
  totalContributions: number;
  /** Value − contributions: the part markets produced, not the saver. */
  marketGrowth: number;
  dividendsReceived: number;
  feesPaid: number;
  /** Time-weighted return over the snapshot history, annualised. */
  annualisedReturn: number | null;
  weightedExpenseRatio: number | null;
  positions: Position[];
}

export function portfolioSummary(data: FinancialDataset, convert: Convert): PortfolioSummary {
  const brokers = new Map(data.investmentAccounts.map((a) => [a.id, a.name]));

  const totalValueBase = money
    .sumBy(data.investments, (i) => convert(i.quantity * i.currentPrice, i.currency))
    .toNumber();

  const positions: Position[] = data.investments
    .map((investment) => {
      const currentValue = round2(investment.quantity * investment.currentPrice);
      const costBasis = round2(investment.quantity * investment.averageCost);
      const currentValueBase = round2(convert(currentValue, investment.currency));
      const costBasisBase = round2(convert(costBasis, investment.currency));

      return {
        investment,
        brokerName: investment.investmentAccountId ? brokers.get(investment.investmentAccountId) ?? null : null,
        currentValue,
        costBasis,
        unrealisedGain: round2(currentValue - costBasis),
        returnPercent: investment.averageCost > 0
          ? ((investment.currentPrice - investment.averageCost) / investment.averageCost) * 100
          : 0,
        currentValueBase,
        costBasisBase,
        unrealisedGainBase: round2(currentValueBase - costBasisBase),
        shareOfPortfolio: totalValueBase > 0 ? (currentValueBase / totalValueBase) * 100 : 0,
        dayPriceStale: isStale(investment.priceUpdatedAt),
      };
    })
    .sort((a, b) => b.currentValueBase - a.currentValueBase);

  const totalCost = money.sumBy(positions, (p) => p.costBasisBase).toNumber();
  const realisedGain = money.sumBy(data.investments, (i) => convert(i.realisedGain, i.currency)).toNumber();

  const buys = data.investmentTransactions.filter((t) => t.transactionType === 'buy');
  const sells = data.investmentTransactions.filter((t) => t.transactionType === 'sell');
  const contributions =
    money.sumBy(buys, (t) => convert(t.amount ?? t.quantity * t.price, t.currency)).toNumber() -
    money.sumBy(sells, (t) => convert(t.amount ?? t.quantity * t.price, t.currency)).toNumber();

  const dividends = money
    .sumBy(
      data.investmentTransactions.filter((t) => t.transactionType === 'dividend' || t.transactionType === 'interest'),
      (t) => convert(t.amount ?? 0, t.currency),
    )
    .toNumber();

  const fees = money
    .sumBy(data.investmentTransactions, (t) => convert((t.fees ?? 0) + (t.transactionType === 'fee' ? t.amount ?? 0 : 0), t.currency))
    .toNumber();

  const rated = data.investments.filter((i) => i.expenseRatio !== null && i.quantity > 0);
  const ratedValue = money.sumBy(rated, (i) => convert(i.quantity * i.currentPrice, i.currency)).toNumber();
  const weightedExpenseRatio = ratedValue > 0
    ? money
        .sumBy(rated, (i) => convert(i.quantity * i.currentPrice, i.currency) * (i.expenseRatio ?? 0))
        .dividedBy(ratedValue)
        .times(100)
        .toNumber()
    : null;

  return {
    totalValue: round2(totalValueBase),
    totalCost: round2(totalCost),
    unrealisedGain: round2(totalValueBase - totalCost),
    realisedGain: round2(realisedGain),
    totalReturnPercent: totalCost > 0 ? ((totalValueBase - totalCost) / totalCost) * 100 : 0,
    totalContributions: round2(contributions),
    marketGrowth: round2(totalValueBase - contributions),
    dividendsReceived: round2(dividends),
    feesPaid: round2(fees),
    annualisedReturn: timeWeightedReturn(data),
    weightedExpenseRatio,
    positions,
  };
}

/**
 * Time-weighted return from the portfolio snapshot series.
 *
 * Each interval's return excludes the contribution made during it
 * (Modified Dietz with the flow at the interval boundary), then the
 * intervals are chain-linked and annualised — so paying more in never
 * shows up as "performance".
 */
export function timeWeightedReturn(data: FinancialDataset): number | null {
  const snapshots = [...data.portfolioSnapshots].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  if (snapshots.length < 3) return null;

  let linked = dec(1);
  let intervals = 0;

  for (let i = 1; i < snapshots.length; i += 1) {
    const previous = snapshots[i - 1];
    const current = snapshots[i];
    const flow = current.totalContributions - previous.totalContributions;
    const opening = previous.totalValue + flow;
    if (opening <= 0) continue;

    linked = linked.times(dec(current.totalValue).dividedBy(opening));
    intervals += 1;
  }

  if (intervals < 2) return null;

  const first = new Date(snapshots[0].snapshotDate).getTime();
  const last = new Date(snapshots.at(-1)!.snapshotDate).getTime();
  const years = (last - first) / (365.25 * 86_400_000);
  if (years <= 0.08) return null;

  return round2((Math.pow(linked.toNumber(), 1 / years) - 1) * 100);
}

/* ==================================================================== */
/* Allocation                                                            */
/* ==================================================================== */

export interface AllocationBucket {
  bucket: string;
  actualValue: number;
  actualPercentage: number;
  targetPercentage: number;
  targetValue: number;
  /** actual − target, in percentage points. */
  drift: number;
  toleranceBand: number;
  status: 'on-target' | 'overweight' | 'underweight';
  /** Positive = buy this much; negative = sell this much. */
  rebalanceAmount: number;
}

/**
 * Actual allocation, derived live from the holdings.
 *
 * A holding can be split across several buckets via
 * `investment_allocations` — that is how a Trading 212 "pie" maps onto
 * a strategic model without being broken into separate positions.
 */
export function portfolioAllocation(data: FinancialDataset, convert: Convert): AllocationBucket[] {
  const weightsByInvestment = new Map<string, Array<{ bucket: string; weight: number }>>();
  for (const allocation of data.investmentAllocations) {
    const list = weightsByInvestment.get(allocation.investmentId) ?? [];
    list.push({ bucket: allocation.bucket, weight: allocation.weight });
    weightsByInvestment.set(allocation.investmentId, list);
  }

  const actual = new Map<string, number>();
  for (const investment of data.investments) {
    const value = convert(investment.quantity * investment.currentPrice, investment.currency);
    const splits = weightsByInvestment.get(investment.id);

    if (splits?.length) {
      const weightTotal = splits.reduce((a, b) => a + b.weight, 0) || 100;
      for (const split of splits) {
        actual.set(split.bucket, (actual.get(split.bucket) ?? 0) + (value * split.weight) / weightTotal);
      }
    } else {
      const bucket = investment.region ?? 'Unclassified';
      actual.set(bucket, (actual.get(bucket) ?? 0) + value);
    }
  }

  const total = [...actual.values()].reduce((a, b) => a + b, 0);
  const targets = new Map(data.targetAllocations.map((t) => [t.bucket.toLowerCase(), t]));
  const buckets = new Set<string>([
    ...actual.keys(),
    ...data.targetAllocations.map((t) => t.bucket),
  ]);

  return [...buckets]
    .map((bucket) => {
      const value = actual.get(bucket) ?? 0;
      const target = targets.get(bucket.toLowerCase());
      const targetPercentage = target?.targetPercentage ?? 0;
      const tolerance = target?.toleranceBand ?? 5;
      const actualPercentage = total > 0 ? (value / total) * 100 : 0;
      const drift = actualPercentage - targetPercentage;

      return {
        bucket,
        actualValue: round2(value),
        actualPercentage,
        targetPercentage,
        targetValue: round2((total * targetPercentage) / 100),
        drift,
        toleranceBand: tolerance,
        status:
          Math.abs(drift) <= tolerance ? ('on-target' as const)
          : drift > 0 ? ('overweight' as const)
          : ('underweight' as const),
        rebalanceAmount: round2((total * targetPercentage) / 100 - value),
      };
    })
    .sort((a, b) => {
      const order = data.targetAllocations.findIndex((t) => t.bucket === a.bucket);
      const otherOrder = data.targetAllocations.findIndex((t) => t.bucket === b.bucket);
      if (order !== -1 && otherOrder !== -1) return order - otherOrder;
      if (order !== -1) return -1;
      if (otherOrder !== -1) return 1;
      return b.actualValue - a.actualValue;
    });
}

export interface RebalanceSuggestion {
  bucket: string;
  action: 'buy' | 'sell';
  amount: number;
  drift: number;
  targetPercentage: number;
  actualPercentage: number;
}

/**
 * What to buy or sell to close the gaps. Suggestions only — Snowball
 * never places a trade.
 */
export function rebalanceSuggestions(buckets: readonly AllocationBucket[]): RebalanceSuggestion[] {
  return buckets
    .filter((b) => b.status !== 'on-target' && Math.abs(b.rebalanceAmount) >= 1)
    .map((b) => ({
      bucket: b.bucket,
      action: b.rebalanceAmount > 0 ? ('buy' as const) : ('sell' as const),
      amount: Math.abs(b.rebalanceAmount),
      drift: b.drift,
      targetPercentage: b.targetPercentage,
      actualPercentage: b.actualPercentage,
    }))
    .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
}

/** Allocation grouped by an arbitrary holding property, for the donuts. */
export function allocationBy(
  data: FinancialDataset,
  convert: Convert,
  key: 'assetType' | 'sector' | 'region' | 'currency',
): Array<{ label: string; value: number; share: number }> {
  const totals = new Map<string, number>();
  for (const investment of data.investments) {
    const label = String(investment[key] ?? 'Unclassified');
    totals.set(label, (totals.get(label) ?? 0) + convert(investment.quantity * investment.currentPrice, investment.currency));
  }
  const grand = [...totals.values()].reduce((a, b) => a + b, 0);
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value: round2(value), share: grand > 0 ? (value / grand) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
}

function isStale(priceUpdatedAt: string | null): boolean {
  if (!priceUpdatedAt) return true;
  return Date.now() - new Date(priceUpdatedAt).getTime() > 7 * 86_400_000;
}
