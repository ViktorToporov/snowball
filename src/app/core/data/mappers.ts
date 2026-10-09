/**
 * Row → model mappers.
 *
 * PostgREST hands back `numeric` columns as strings; every mapper runs
 * them through `num()` so the domain model is plain numbers with cents
 * intact. Going the other way, `toRow()` snake_cases keys for writes.
 */

import { num } from '../money/money';
import * as M from '../models/domain.models';
import * as R from '../supabase/database.types';

const asRecord = (value: R.Json | null | undefined): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const mapProfile = (r: R.ProfileRow): M.Profile => ({
  id: r.id,
  displayName: r.display_name,
  baseCurrency: r.base_currency,
  locale: r.locale,
  emergencyFundTarget: num(r.emergency_fund_target, 2),
  physicalCashCeiling: num(r.physical_cash_ceiling, 2),
  theme: r.theme,
  onboarded: r.onboarded,
});

export const mapAccount = (r: R.AccountRow): M.Account => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  accountType: r.account_type,
  institution: r.institution,
  currency: r.currency,
  balance: num(r.balance, 2),
  interestRate: num(r.interest_rate, 6),
  countsAsLiquid: r.counts_as_liquid,
  countsAsEmergencyFund: r.counts_as_emergency_fund,
  targetBalance: r.target_balance === null ? null : num(r.target_balance, 2),
  isArchived: r.is_archived,
  sortOrder: r.sort_order,
  notes: r.notes,
});

export const mapCategory = (r: R.CategoryRow): M.Category => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  categoryType: r.category_type,
  parentId: r.parent_id,
  icon: r.icon,
  color: r.color,
  isSystem: r.is_system,
  sortOrder: r.sort_order,
});

export const mapRecurringExpense = (r: R.RecurringExpenseRow): M.RecurringExpense => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  amount: num(r.amount, 2),
  currency: r.currency,
  categoryId: r.category_id,
  accountId: r.account_id,
  propertyId: r.property_id,
  frequency: r.frequency,
  startDate: r.start_date,
  endDate: r.end_date,
  active: r.active,
  notes: r.notes,
});

export const mapIncomeSource = (r: R.IncomeSourceRow): M.IncomeSource => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  incomeType: r.income_type,
  amount: num(r.amount, 2),
  grossAmount: r.gross_amount === null ? null : num(r.gross_amount, 2),
  currency: r.currency,
  frequency: r.frequency,
  accountId: r.account_id,
  propertyId: r.property_id,
  startDate: r.start_date,
  endDate: r.end_date,
  active: r.active,
  annualGrowth: num(r.annual_growth, 6),
  notes: r.notes,
});

export const mapIncomeHistory = (r: R.IncomeHistoryRow): M.IncomeHistoryEntry => ({
  id: r.id,
  userId: r.user_id,
  incomeSourceId: r.income_source_id,
  periodMonth: r.period_month,
  netAmount: num(r.net_amount, 2),
  grossAmount: r.gross_amount === null ? null : num(r.gross_amount, 2),
  currency: r.currency,
});

export const mapInvestmentAccount = (r: R.InvestmentAccountRow): M.InvestmentAccount => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  broker: r.broker,
  currency: r.currency,
  notes: r.notes,
});

export const mapInvestment = (r: R.InvestmentRow): M.Investment => ({
  id: r.id,
  userId: r.user_id,
  investmentAccountId: r.investment_account_id,
  name: r.name,
  ticker: r.ticker,
  isin: r.isin,
  assetType: r.asset_type,
  quantity: num(r.quantity, 8),
  averageCost: num(r.average_cost, 6),
  currentPrice: num(r.current_price, 6),
  currency: r.currency,
  region: r.region,
  sector: r.sector,
  expenseRatio: r.expense_ratio === null ? null : num(r.expense_ratio, 6),
  targetAllocation: r.target_allocation === null ? null : num(r.target_allocation, 4),
  realisedGain: num(r.realised_gain, 2),
  priceUpdatedAt: r.price_updated_at,
  notes: r.notes,
});

export const mapInvestmentTransaction = (r: R.InvestmentTransactionRow): M.InvestmentTransaction => ({
  id: r.id,
  userId: r.user_id,
  investmentId: r.investment_id,
  transactionType: r.transaction_type,
  quantity: num(r.quantity, 8),
  price: num(r.price, 6),
  amount: r.amount === null ? null : num(r.amount, 2),
  fees: num(r.fees, 2),
  currency: r.currency,
  transactionDate: r.transaction_date,
  notes: r.notes,
});

export const mapInvestmentAllocation = (r: R.InvestmentAllocationRow): M.InvestmentAllocation => ({
  id: r.id,
  userId: r.user_id,
  investmentId: r.investment_id,
  bucket: r.bucket,
  weight: num(r.weight, 4),
});

export const mapTargetAllocation = (r: R.TargetAllocationRow): M.TargetAllocation => ({
  id: r.id,
  userId: r.user_id,
  bucket: r.bucket,
  targetPercentage: num(r.target_percentage, 4),
  toleranceBand: num(r.tolerance_band, 4),
  sortOrder: r.sort_order,
});

export const mapProperty = (r: R.PropertyRow): M.Property => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  address: r.address,
  currency: r.currency,
  estimatedValue: num(r.estimated_value, 2),
  purchasePrice: r.purchase_price === null ? null : num(r.purchase_price, 2),
  purchaseDate: r.purchase_date,
  mortgageBalance: num(r.mortgage_balance, 2),
  mortgageInterestRate: num(r.mortgage_interest_rate, 6),
  monthlyPayment: num(r.monthly_payment, 2),
  remainingMonths: r.remaining_months,
  rentalStatus: r.rental_status,
  monthlyRent: num(r.monthly_rent, 2),
  monthlyPropertyExpenses: num(r.monthly_property_expenses, 2),
  maintenanceReserve: num(r.maintenance_reserve, 2),
  maintenanceReserveTarget: num(r.maintenance_reserve_target, 2),
  annualAppreciation: num(r.annual_appreciation, 6),
  expectedRentStart: r.expected_rent_start,
  notes: r.notes,
});

export const mapPropertyValuation = (r: R.PropertyValuationRow): M.PropertyValuation => ({
  id: r.id,
  userId: r.user_id,
  propertyId: r.property_id,
  valuationDate: r.valuation_date,
  estimatedValue: num(r.estimated_value, 2),
  mortgageBalance: num(r.mortgage_balance, 2),
  source: r.source,
});

export const mapOtherAsset = (r: R.OtherAssetRow): M.OtherAsset => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  assetKind: r.asset_kind,
  currentValue: num(r.current_value, 2),
  currency: r.currency,
  purchaseValue: r.purchase_value === null ? null : num(r.purchase_value, 2),
  annualDepreciation: num(r.annual_depreciation, 6),
  isLiquid: r.is_liquid,
  notes: r.notes,
});

export const mapLiability = (r: R.LiabilityRow): M.Liability => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  liabilityKind: r.liability_kind,
  balance: num(r.balance, 2),
  currency: r.currency,
  interestRate: num(r.interest_rate, 6),
  monthlyPayment: num(r.monthly_payment, 2),
  remainingMonths: r.remaining_months,
  propertyId: r.property_id,
  notes: r.notes,
});

export const mapGoal = (r: R.GoalRow): M.Goal => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  goalType: r.goal_type,
  targetAmount: num(r.target_amount, 2),
  currentAmount: num(r.current_amount, 2),
  currency: r.currency,
  targetDate: r.target_date,
  priority: r.priority,
  status: r.status,
  accountId: r.account_id,
  monthlyContribution: num(r.monthly_contribution, 2),
  trackAccountBalance: r.track_account_balance,
  notes: r.notes,
});

export const mapPhase = (r: R.FinancialPhaseRow): M.FinancialPhase => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  phaseOrder: r.phase_order,
  active: r.active,
  objective: r.objective,
  description: r.description,
  entryCondition: asRecord(r.entry_condition),
  exitCondition: asRecord(r.exit_condition),
  completedAt: r.completed_at,
});

export const mapStrategyRule = (r: R.StrategyRuleRow): M.StrategyRule => ({
  id: r.id,
  userId: r.user_id,
  phaseId: r.phase_id,
  ruleType: r.rule_type,
  name: r.name,
  description: r.description,
  targetValue: r.target_value === null ? null : num(r.target_value, 2),
  targetPercentage: r.target_percentage === null ? null : num(r.target_percentage, 4),
  priority: r.priority,
  enabled: r.enabled,
  configuration: asRecord(r.configuration),
});

export const mapStrategyPriority = (r: R.StrategyPriorityRow): M.StrategyPriority => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  rank: r.rank,
  allocationPercentage: num(r.allocation_percentage, 4),
  description: r.description,
});

export const mapPlannedExpense = (r: R.PlannedExpenseRow): M.PlannedExpense => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  amount: num(r.amount, 2),
  savedAmount: num(r.saved_amount, 2),
  currency: r.currency,
  targetDate: r.target_date,
  priority: r.priority,
  category: r.category,
  status: r.status,
  accountId: r.account_id,
  propertyId: r.property_id,
  notes: r.notes,
});

export const mapNetWorthSnapshot = (r: R.NetWorthSnapshotRow): M.NetWorthSnapshot => ({
  id: r.id,
  userId: r.user_id,
  snapshotDate: r.snapshot_date,
  cashValue: num(r.cash_value, 2),
  investmentValue: num(r.investment_value, 2),
  propertyValue: num(r.property_value, 2),
  otherAssets: num(r.other_assets, 2),
  liabilities: num(r.liabilities, 2),
  netWorth: num(r.net_worth, 2),
  currency: r.currency,
});

export const mapPortfolioSnapshot = (r: R.PortfolioSnapshotRow): M.PortfolioSnapshot => ({
  id: r.id,
  userId: r.user_id,
  snapshotDate: r.snapshot_date,
  totalValue: num(r.total_value, 2),
  totalContributions: num(r.total_contributions, 2),
  totalGain: num(r.total_gain, 2),
  currency: r.currency,
});

export const mapAccountBalanceSnapshot = (r: R.AccountBalanceSnapshotRow): M.AccountBalanceSnapshot => ({
  id: r.id,
  userId: r.user_id,
  accountId: r.account_id,
  snapshotDate: r.snapshot_date,
  balance: num(r.balance, 2),
});

export const mapScenario = (r: R.ForecastScenarioRow): M.ForecastScenario => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  kind: r.kind,
  isDefault: r.is_default,
  salaryGrowth: num(r.salary_growth, 6),
  inflation: num(r.inflation, 6),
  investmentReturn: num(r.investment_return, 6),
  cashInterest: num(r.cash_interest, 6),
  propertyAppreciation: num(r.property_appreciation, 6),
  monthlyInvestment: num(r.monthly_investment, 2),
  monthlyFlexibleSpending: num(r.monthly_flexible_spending, 2),
  includeRentalIncome: r.include_rental_income,
  includePlannedExpenses: r.include_planned_expenses,
  horizonYears: r.horizon_years,
  notes: r.notes,
});

export const mapExchangeRate = (r: R.ExchangeRateRow): M.ExchangeRate => ({
  baseCurrency: r.base_currency,
  quoteCurrency: r.quote_currency,
  rate: num(r.rate, 10),
  asOf: r.as_of,
  source: r.source,
});

/** camelCase → snake_case, for writes. */
export function toRow(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    out[key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())] = value;
  }
  return out;
}
