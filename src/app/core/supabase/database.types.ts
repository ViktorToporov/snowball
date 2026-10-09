/**
 * TypeScript definitions for the Snowball database.
 *
 * Hand-maintained to mirror `supabase/schema.sql`. To regenerate them
 * from a live project instead:
 *
 *   npx supabase gen types typescript --project-id <ref> --schema public \
 *     > src/app/core/supabase/database.types.ts
 *
 * Note that PostgREST returns `numeric` columns as **strings** so no
 * precision is lost in transit; they are typed as `string` here and
 * parsed with `core/money`.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type DbAccountType =
  | 'checking' | 'savings' | 'brokerage_cash' | 'ewallet' | 'physical_cash' | 'credit_card' | 'other';
export type DbCategoryType = 'income' | 'essential' | 'flexible';
export type DbExpenseFrequency = 'monthly' | 'quarterly' | 'annual';
export type DbIncomeType = 'salary' | 'bonus' | 'rental' | 'investment' | 'freelance' | 'other';
export type DbIncomeFrequency = 'monthly' | 'quarterly' | 'annual' | 'one_off';
export type DbAssetType = 'etf' | 'stock' | 'bond' | 'mutual_fund' | 'crypto' | 'reit' | 'commodity' | 'other';
export type DbInvestmentTxnType = 'buy' | 'sell' | 'dividend' | 'fee' | 'interest' | 'deposit' | 'withdrawal';
export type DbRentalStatus = 'owner_occupied' | 'rented' | 'vacant' | 'listed';
export type DbGoalType =
  | 'emergency_fund' | 'travel' | 'property' | 'vehicle' | 'investment'
  | 'debt_payoff' | 'financial_independence' | 'other';
export type DbGoalStatus = 'active' | 'paused' | 'achieved' | 'abandoned';
export type DbStrategyRuleType =
  | 'emergency_fund' | 'investment' | 'lifestyle' | 'property' | 'debt'
  | 'allocation' | 'savings_rate' | 'cash_ceiling' | 'custom';
export type DbPriorityLevel = 'low' | 'medium' | 'high' | 'critical';
export type DbPlannedExpenseStatus = 'planned' | 'funding' | 'funded' | 'paid' | 'cancelled';
export type DbAssetKind = 'vehicle' | 'valuables' | 'pension' | 'business' | 'receivable' | 'other';
export type DbLiabilityKind = 'mortgage' | 'personal_loan' | 'student_loan' | 'car_loan' | 'credit_card' | 'other';
export type DbScenarioKind = 'conservative' | 'base' | 'optimistic';

/** A `numeric` column as delivered by PostgREST. */
type Numeric = string;

interface Timestamps {
  created_at: string;
  updated_at: string;
}

export interface ProfileRow extends Timestamps {
  id: string;
  display_name: string | null;
  base_currency: string;
  locale: string;
  emergency_fund_target: Numeric;
  physical_cash_ceiling: Numeric;
  theme: 'light' | 'dark' | 'system';
  onboarded: boolean;
}

export interface AccountRow extends Timestamps {
  id: string;
  user_id: string;
  name: string;
  account_type: DbAccountType;
  institution: string | null;
  currency: string;
  balance: Numeric;
  interest_rate: Numeric;
  counts_as_liquid: boolean;
  counts_as_emergency_fund: boolean;
  target_balance: Numeric | null;
  is_archived: boolean;
  sort_order: number;
  notes: string | null;
}

export interface CategoryRow extends Timestamps {
  id: string;
  user_id: string | null;
  name: string;
  category_type: DbCategoryType;
  parent_id: string | null;
  icon: string | null;
  color: string | null;
  is_system: boolean;
  sort_order: number;
}

export interface RecurringExpenseRow extends Timestamps {
  id: string;
  user_id: string;
  name: string;
  amount: Numeric;
  currency: string;
  category_id: string | null;
  account_id: string | null;
  property_id: string | null;
  frequency: DbExpenseFrequency;
  start_date: string;
  end_date: string | null;
  active: boolean;
  notes: string | null;
}

export interface IncomeSourceRow extends Timestamps {
  id: string;
  user_id: string;
  name: string;
  income_type: DbIncomeType;
  amount: Numeric;
  gross_amount: Numeric | null;
  currency: string;
  frequency: DbIncomeFrequency;
  account_id: string | null;
  property_id: string | null;
  start_date: string;
  end_date: string | null;
  active: boolean;
  annual_growth: Numeric;
  notes: string | null;
}

export interface IncomeHistoryRow {
  id: string;
  user_id: string;
  income_source_id: string | null;
  period_month: string;
  net_amount: Numeric;
  gross_amount: Numeric | null;
  currency: string;
  notes: string | null;
  created_at: string;
}

export interface InvestmentAccountRow extends Timestamps {
  id: string;
  user_id: string;
  name: string;
  broker: string | null;
  currency: string;
  account_ref: string | null;
  current_value: Numeric | null;
  value_updated_at: string | null;
  contributed_before: Numeric;
  sort_order: number;
  notes: string | null;
}

export interface InvestmentRow extends Timestamps {
  id: string;
  user_id: string;
  investment_account_id: string | null;
  name: string;
  ticker: string | null;
  isin: string | null;
  asset_type: DbAssetType;
  quantity: Numeric;
  average_cost: Numeric;
  current_price: Numeric;
  currency: string;
  region: string | null;
  sector: string | null;
  expense_ratio: Numeric | null;
  target_allocation: Numeric | null;
  realised_gain: Numeric;
  price_updated_at: string | null;
  notes: string | null;
}

export interface InvestmentTransactionRow {
  id: string;
  user_id: string;
  investment_id: string | null;
  investment_account_id: string | null;
  transaction_type: DbInvestmentTxnType;
  quantity: Numeric;
  price: Numeric;
  amount: Numeric | null;
  fees: Numeric;
  currency: string;
  transaction_date: string;
  notes: string | null;
  created_at: string;
}

export interface InvestmentAllocationRow {
  id: string;
  user_id: string;
  investment_id: string;
  bucket: string;
  weight: Numeric;
  created_at: string;
}

export interface TargetAllocationRow extends Timestamps {
  id: string;
  user_id: string;
  bucket: string;
  target_percentage: Numeric;
  tolerance_band: Numeric;
  sort_order: number;
}

export interface PropertyRow extends Timestamps {
  id: string;
  user_id: string;
  name: string;
  address: string | null;
  currency: string;
  estimated_value: Numeric;
  purchase_price: Numeric | null;
  purchase_date: string | null;
  mortgage_balance: Numeric;
  mortgage_interest_rate: Numeric;
  monthly_payment: Numeric;
  remaining_months: number;
  rental_status: DbRentalStatus;
  monthly_rent: Numeric;
  monthly_property_expenses: Numeric;
  maintenance_reserve: Numeric;
  maintenance_reserve_target: Numeric;
  annual_appreciation: Numeric;
  expected_rent_start: string | null;
  notes: string | null;
}

export interface PropertyValuationRow {
  id: string;
  user_id: string;
  property_id: string;
  valuation_date: string;
  estimated_value: Numeric;
  mortgage_balance: Numeric;
  source: string | null;
  created_at: string;
}

export interface OtherAssetRow extends Timestamps {
  id: string;
  user_id: string;
  name: string;
  asset_kind: DbAssetKind;
  current_value: Numeric;
  currency: string;
  purchase_value: Numeric | null;
  annual_depreciation: Numeric;
  is_liquid: boolean;
  notes: string | null;
}

export interface LiabilityRow extends Timestamps {
  id: string;
  user_id: string;
  name: string;
  liability_kind: DbLiabilityKind;
  balance: Numeric;
  currency: string;
  interest_rate: Numeric;
  monthly_payment: Numeric;
  remaining_months: number;
  property_id: string | null;
  notes: string | null;
}

export interface GoalRow extends Timestamps {
  id: string;
  user_id: string;
  name: string;
  goal_type: DbGoalType;
  target_amount: Numeric;
  current_amount: Numeric;
  currency: string;
  target_date: string | null;
  priority: DbPriorityLevel;
  status: DbGoalStatus;
  account_id: string | null;
  monthly_contribution: Numeric;
  track_account_balance: boolean;
  notes: string | null;
}

export interface FinancialPhaseRow extends Timestamps {
  id: string;
  user_id: string;
  name: string;
  phase_order: number;
  active: boolean;
  objective: string | null;
  description: string | null;
  entry_condition: Json;
  exit_condition: Json;
  completed_at: string | null;
}

export interface StrategyRuleRow extends Timestamps {
  id: string;
  user_id: string;
  phase_id: string | null;
  rule_type: DbStrategyRuleType;
  name: string;
  description: string | null;
  target_value: Numeric | null;
  target_percentage: Numeric | null;
  priority: number;
  enabled: boolean;
  configuration: Json;
}

export interface StrategyPriorityRow extends Timestamps {
  id: string;
  user_id: string;
  name: string;
  rank: number;
  allocation_percentage: Numeric;
  description: string | null;
}

export interface PlannedExpenseRow extends Timestamps {
  id: string;
  user_id: string;
  name: string;
  amount: Numeric;
  saved_amount: Numeric;
  currency: string;
  target_date: string;
  priority: DbPriorityLevel;
  category: string | null;
  status: DbPlannedExpenseStatus;
  account_id: string | null;
  property_id: string | null;
  notes: string | null;
}

export interface NetWorthSnapshotRow {
  id: string;
  user_id: string;
  snapshot_date: string;
  cash_value: Numeric;
  investment_value: Numeric;
  property_value: Numeric;
  other_assets: Numeric;
  liabilities: Numeric;
  net_worth: Numeric;
  currency: string;
  created_at: string;
}

export interface PortfolioSnapshotRow {
  id: string;
  user_id: string;
  snapshot_date: string;
  total_value: Numeric;
  total_contributions: Numeric;
  total_gain: Numeric;
  currency: string;
  created_at: string;
}

export interface AccountBalanceSnapshotRow {
  id: string;
  user_id: string;
  account_id: string;
  snapshot_date: string;
  balance: Numeric;
  created_at: string;
}

export interface ForecastScenarioRow extends Timestamps {
  id: string;
  user_id: string;
  name: string;
  kind: DbScenarioKind;
  is_default: boolean;
  salary_growth: Numeric;
  inflation: Numeric;
  investment_return: Numeric;
  cash_interest: Numeric;
  property_appreciation: Numeric;
  monthly_investment: Numeric;
  monthly_flexible_spending: Numeric;
  include_rental_income: boolean;
  include_planned_expenses: boolean;
  horizon_years: number;
  notes: string | null;
}

export interface ExchangeRateRow {
  base_currency: string;
  quote_currency: string;
  rate: Numeric;
  as_of: string;
  source: string;
}

/* ---- Views -------------------------------------------------------- */

export interface FinancialSummaryRow {
  user_id: string;
  base_currency: string;
  emergency_fund_target: Numeric;
  liquid_cash: Numeric;
  emergency_fund_balance: Numeric;
  emergency_fund_progress: Numeric;
  investments_value: Numeric;
  investments_cost_basis: Numeric;
  property_equity: Numeric;
  monthly_income: Numeric;
  essential_monthly_expenses: Numeric;
  net_worth: Numeric;
  security_score: Numeric;
  months_of_runway: Numeric | null;
  available_above_floor: Numeric;
}

export interface PortfolioAllocationRow {
  user_id: string;
  bucket: string;
  actual_value: Numeric;
  actual_percentage: Numeric;
  target_percentage: Numeric;
  drift_percentage: Numeric;
  rebalance_amount: Numeric;
  tolerance_band: Numeric;
}

export interface MonthlyCashFlowRow {
  user_id: string;
  period_month: string;
  income: Numeric;
  essential_expenses: Numeric;
  flexible_expenses: Numeric;
  total_expenses: Numeric;
  net_cash_flow: Numeric;
}

/**
 * The shape `createClient<Database>` expects. Only the pieces the app
 * actually uses are enumerated; anything else falls back to `Json`.
 */
export interface Database {
  public: {
    Tables: {
      profiles: { Row: ProfileRow; Insert: Partial<ProfileRow> & { id: string }; Update: Partial<ProfileRow> };
      accounts: { Row: AccountRow; Insert: Partial<AccountRow>; Update: Partial<AccountRow> };
      categories: { Row: CategoryRow; Insert: Partial<CategoryRow>; Update: Partial<CategoryRow> };
      recurring_expenses: { Row: RecurringExpenseRow; Insert: Partial<RecurringExpenseRow>; Update: Partial<RecurringExpenseRow> };
      income_sources: { Row: IncomeSourceRow; Insert: Partial<IncomeSourceRow>; Update: Partial<IncomeSourceRow> };
      income_history: { Row: IncomeHistoryRow; Insert: Partial<IncomeHistoryRow>; Update: Partial<IncomeHistoryRow> };
      investment_accounts: { Row: InvestmentAccountRow; Insert: Partial<InvestmentAccountRow>; Update: Partial<InvestmentAccountRow> };
      investments: { Row: InvestmentRow; Insert: Partial<InvestmentRow>; Update: Partial<InvestmentRow> };
      investment_transactions: { Row: InvestmentTransactionRow; Insert: Partial<InvestmentTransactionRow>; Update: Partial<InvestmentTransactionRow> };
      investment_allocations: { Row: InvestmentAllocationRow; Insert: Partial<InvestmentAllocationRow>; Update: Partial<InvestmentAllocationRow> };
      target_allocations: { Row: TargetAllocationRow; Insert: Partial<TargetAllocationRow>; Update: Partial<TargetAllocationRow> };
      properties: { Row: PropertyRow; Insert: Partial<PropertyRow>; Update: Partial<PropertyRow> };
      property_valuations: { Row: PropertyValuationRow; Insert: Partial<PropertyValuationRow>; Update: Partial<PropertyValuationRow> };
      other_assets: { Row: OtherAssetRow; Insert: Partial<OtherAssetRow>; Update: Partial<OtherAssetRow> };
      liabilities: { Row: LiabilityRow; Insert: Partial<LiabilityRow>; Update: Partial<LiabilityRow> };
      goals: { Row: GoalRow; Insert: Partial<GoalRow>; Update: Partial<GoalRow> };
      financial_phases: { Row: FinancialPhaseRow; Insert: Partial<FinancialPhaseRow>; Update: Partial<FinancialPhaseRow> };
      strategy_rules: { Row: StrategyRuleRow; Insert: Partial<StrategyRuleRow>; Update: Partial<StrategyRuleRow> };
      strategy_priorities: { Row: StrategyPriorityRow; Insert: Partial<StrategyPriorityRow>; Update: Partial<StrategyPriorityRow> };
      planned_expenses: { Row: PlannedExpenseRow; Insert: Partial<PlannedExpenseRow>; Update: Partial<PlannedExpenseRow> };
      net_worth_snapshots: { Row: NetWorthSnapshotRow; Insert: Partial<NetWorthSnapshotRow>; Update: Partial<NetWorthSnapshotRow> };
      portfolio_snapshots: { Row: PortfolioSnapshotRow; Insert: Partial<PortfolioSnapshotRow>; Update: Partial<PortfolioSnapshotRow> };
      account_balance_snapshots: { Row: AccountBalanceSnapshotRow; Insert: Partial<AccountBalanceSnapshotRow>; Update: Partial<AccountBalanceSnapshotRow> };
      forecast_scenarios: { Row: ForecastScenarioRow; Insert: Partial<ForecastScenarioRow>; Update: Partial<ForecastScenarioRow> };
      exchange_rates: { Row: ExchangeRateRow; Insert: Partial<ExchangeRateRow>; Update: Partial<ExchangeRateRow> };
    };
    Views: {
      financial_summary: { Row: FinancialSummaryRow };
      portfolio_allocation: { Row: PortfolioAllocationRow };
      monthly_cash_flow: { Row: MonthlyCashFlowRow };
    };
    Functions: Record<string, never>;
    Enums: {
      account_type: DbAccountType;
      category_type: DbCategoryType;
      asset_type: DbAssetType;
      goal_type: DbGoalType;
    };
  };
}
