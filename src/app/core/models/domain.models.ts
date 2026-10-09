/**
 * Domain model for Snowball.
 *
 * These are the shapes the application works with. They mirror the
 * PostgreSQL schema in `supabase/schema.sql` but use camelCase and
 * `number` for monetary values that have already been parsed out of
 * PostgreSQL `numeric` strings (see `core/money`).
 */

export type Currency = string; // ISO-4217, e.g. 'EUR'
export type Iso8601Date = string; // 'YYYY-MM-DD'

export type AccountType =
  | 'checking'
  | 'savings'
  | 'brokerage_cash'
  | 'ewallet'
  | 'physical_cash'
  | 'credit_card'
  | 'other';

export type CategoryType = 'income' | 'essential' | 'flexible';
export type ExpenseFrequency = 'monthly' | 'quarterly' | 'annual';
export type IncomeType = 'salary' | 'bonus' | 'rental' | 'investment' | 'freelance' | 'other';
export type IncomeFrequency = 'monthly' | 'quarterly' | 'annual' | 'one_off';
export type AssetType = 'etf' | 'stock' | 'bond' | 'mutual_fund' | 'crypto' | 'reit' | 'commodity' | 'other';
export type InvestmentTxnType = 'buy' | 'sell' | 'dividend' | 'fee' | 'interest';
export type RentalStatus = 'owner_occupied' | 'rented' | 'vacant' | 'listed';
export type GoalType =
  | 'emergency_fund'
  | 'travel'
  | 'property'
  | 'vehicle'
  | 'investment'
  | 'debt_payoff'
  | 'financial_independence'
  | 'other';
export type GoalStatus = 'active' | 'paused' | 'achieved' | 'abandoned';
export type StrategyRuleType =
  | 'emergency_fund'
  | 'investment'
  | 'lifestyle'
  | 'property'
  | 'debt'
  | 'allocation'
  | 'savings_rate'
  | 'cash_ceiling'
  | 'custom';
export type PriorityLevel = 'low' | 'medium' | 'high' | 'critical';
export type PlannedExpenseStatus = 'planned' | 'funding' | 'funded' | 'paid' | 'cancelled';
export type AssetKind = 'vehicle' | 'valuables' | 'pension' | 'business' | 'receivable' | 'other';
export type LiabilityKind = 'mortgage' | 'personal_loan' | 'student_loan' | 'car_loan' | 'credit_card' | 'other';
export type ScenarioKind = 'conservative' | 'base' | 'optimistic';
export type ThemePreference = 'light' | 'dark' | 'system';

export interface Profile {
  id: string;
  displayName: string | null;
  baseCurrency: Currency;
  locale: string;
  emergencyFundTarget: number;
  physicalCashCeiling: number;
  theme: ThemePreference;
  onboarded: boolean;
}

export interface Account {
  id: string;
  userId: string;
  name: string;
  accountType: AccountType;
  institution: string | null;
  currency: Currency;
  balance: number;
  /** APY as a decimal fraction: 0.024 = 2.4%. */
  interestRate: number;
  countsAsLiquid: boolean;
  countsAsEmergencyFund: boolean;
  targetBalance: number | null;
  isArchived: boolean;
  sortOrder: number;
  notes: string | null;
}

export interface Category {
  id: string;
  userId: string | null;
  name: string;
  categoryType: CategoryType;
  parentId: string | null;
  icon: string | null;
  color: string | null;
  isSystem: boolean;
  sortOrder: number;
}

/**
 * A repeating outgoing the user has declared.
 *
 * Snowball has no transaction ledger — the user keeps balances and
 * holdings current, and states what recurs. Total spending is derived
 * from how the balances actually moved (see `monthlyCashFlow`), so this
 * only has to describe the predictable part.
 */
export interface RecurringExpense {
  id: string;
  userId: string;
  name: string;
  amount: number;
  currency: Currency;
  categoryId: string | null;
  accountId: string | null;
  propertyId: string | null;
  frequency: ExpenseFrequency;
  startDate: Iso8601Date;
  endDate: Iso8601Date | null;
  active: boolean;
  notes: string | null;
}

export interface IncomeSource {
  id: string;
  userId: string;
  name: string;
  incomeType: IncomeType;
  amount: number;
  grossAmount: number | null;
  currency: Currency;
  frequency: IncomeFrequency;
  accountId: string | null;
  propertyId: string | null;
  startDate: Iso8601Date;
  endDate: Iso8601Date | null;
  active: boolean;
  annualGrowth: number;
  notes: string | null;
}

export interface IncomeHistoryEntry {
  id: string;
  userId: string;
  incomeSourceId: string | null;
  periodMonth: Iso8601Date;
  netAmount: number;
  grossAmount: number | null;
  currency: Currency;
}

export interface InvestmentAccount {
  id: string;
  userId: string;
  name: string;
  broker: string | null;
  currency: Currency;
  notes: string | null;
}

export interface Investment {
  id: string;
  userId: string;
  investmentAccountId: string | null;
  name: string;
  ticker: string | null;
  isin: string | null;
  assetType: AssetType;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  currency: Currency;
  region: string | null;
  sector: string | null;
  expenseRatio: number | null;
  targetAllocation: number | null;
  realisedGain: number;
  priceUpdatedAt: string | null;
  notes: string | null;
}

export interface InvestmentTransaction {
  id: string;
  userId: string;
  investmentId: string;
  transactionType: InvestmentTxnType;
  quantity: number;
  price: number;
  amount: number | null;
  fees: number;
  currency: Currency;
  transactionDate: Iso8601Date;
  notes: string | null;
}

/** Maps a share of one holding onto a strategic allocation bucket. */
export interface InvestmentAllocation {
  id: string;
  userId: string;
  investmentId: string;
  bucket: string;
  /** Percentage of the holding, 0–100. */
  weight: number;
}

export interface TargetAllocation {
  id: string;
  userId: string;
  bucket: string;
  targetPercentage: number;
  toleranceBand: number;
  sortOrder: number;
}

export interface Property {
  id: string;
  userId: string;
  name: string;
  address: string | null;
  currency: Currency;
  estimatedValue: number;
  purchasePrice: number | null;
  purchaseDate: Iso8601Date | null;
  mortgageBalance: number;
  mortgageInterestRate: number;
  monthlyPayment: number;
  remainingMonths: number;
  rentalStatus: RentalStatus;
  monthlyRent: number;
  monthlyPropertyExpenses: number;
  maintenanceReserve: number;
  maintenanceReserveTarget: number;
  annualAppreciation: number;
  expectedRentStart: Iso8601Date | null;
  notes: string | null;
}

export interface PropertyValuation {
  id: string;
  userId: string;
  propertyId: string;
  valuationDate: Iso8601Date;
  estimatedValue: number;
  mortgageBalance: number;
  source: string | null;
}

export interface OtherAsset {
  id: string;
  userId: string;
  name: string;
  assetKind: AssetKind;
  currentValue: number;
  currency: Currency;
  purchaseValue: number | null;
  annualDepreciation: number;
  isLiquid: boolean;
  notes: string | null;
}

export interface Liability {
  id: string;
  userId: string;
  name: string;
  liabilityKind: LiabilityKind;
  balance: number;
  currency: Currency;
  interestRate: number;
  monthlyPayment: number;
  remainingMonths: number;
  propertyId: string | null;
  notes: string | null;
}

export interface Goal {
  id: string;
  userId: string;
  name: string;
  goalType: GoalType;
  targetAmount: number;
  currentAmount: number;
  currency: Currency;
  targetDate: Iso8601Date | null;
  priority: PriorityLevel;
  status: GoalStatus;
  accountId: string | null;
  monthlyContribution: number;
  trackAccountBalance: boolean;
  notes: string | null;
}

export interface FinancialPhase {
  id: string;
  userId: string;
  name: string;
  phaseOrder: number;
  active: boolean;
  objective: string | null;
  description: string | null;
  entryCondition: Record<string, unknown>;
  exitCondition: Record<string, unknown>;
  completedAt: string | null;
}

export interface StrategyRule {
  id: string;
  userId: string;
  phaseId: string | null;
  ruleType: StrategyRuleType;
  name: string;
  description: string | null;
  targetValue: number | null;
  targetPercentage: number | null;
  priority: number;
  enabled: boolean;
  configuration: Record<string, unknown>;
}

export interface StrategyPriority {
  id: string;
  userId: string;
  name: string;
  rank: number;
  allocationPercentage: number;
  description: string | null;
}

export interface PlannedExpense {
  id: string;
  userId: string;
  name: string;
  amount: number;
  savedAmount: number;
  currency: Currency;
  targetDate: Iso8601Date;
  priority: PriorityLevel;
  category: string | null;
  status: PlannedExpenseStatus;
  accountId: string | null;
  propertyId: string | null;
  notes: string | null;
}

export interface NetWorthSnapshot {
  id: string;
  userId: string;
  snapshotDate: Iso8601Date;
  cashValue: number;
  investmentValue: number;
  propertyValue: number;
  otherAssets: number;
  liabilities: number;
  netWorth: number;
  currency: Currency;
}

export interface PortfolioSnapshot {
  id: string;
  userId: string;
  snapshotDate: Iso8601Date;
  totalValue: number;
  totalContributions: number;
  totalGain: number;
  currency: Currency;
}

export interface AccountBalanceSnapshot {
  id: string;
  userId: string;
  accountId: string;
  snapshotDate: Iso8601Date;
  balance: number;
}

export interface ForecastScenario {
  id: string;
  userId: string;
  name: string;
  kind: ScenarioKind;
  isDefault: boolean;
  salaryGrowth: number;
  inflation: number;
  investmentReturn: number;
  cashInterest: number;
  propertyAppreciation: number;
  monthlyInvestment: number;
  monthlyFlexibleSpending: number;
  includeRentalIncome: boolean;
  includePlannedExpenses: boolean;
  horizonYears: number;
  notes: string | null;
}

export interface ExchangeRate {
  baseCurrency: Currency;
  quoteCurrency: Currency;
  rate: number;
  asOf: Iso8601Date;
  source: string;
}

/** Everything the app needs, loaded in one pass. */
export interface FinancialDataset {
  profile: Profile;
  accounts: Account[];
  categories: Category[];
  recurringExpenses: RecurringExpense[];
  incomeSources: IncomeSource[];
  incomeHistory: IncomeHistoryEntry[];
  investmentAccounts: InvestmentAccount[];
  investments: Investment[];
  investmentTransactions: InvestmentTransaction[];
  investmentAllocations: InvestmentAllocation[];
  targetAllocations: TargetAllocation[];
  properties: Property[];
  propertyValuations: PropertyValuation[];
  otherAssets: OtherAsset[];
  liabilities: Liability[];
  goals: Goal[];
  phases: FinancialPhase[];
  strategyRules: StrategyRule[];
  strategyPriorities: StrategyPriority[];
  plannedExpenses: PlannedExpense[];
  netWorthSnapshots: NetWorthSnapshot[];
  portfolioSnapshots: PortfolioSnapshot[];
  accountBalanceSnapshots: AccountBalanceSnapshot[];
  scenarios: ForecastScenario[];
  exchangeRates: ExchangeRate[];
}

/** Tables the generic CRUD surface can write to. */
export type WritableTable =
  | 'accounts'
  | 'recurring_expenses'
  | 'categories'
  | 'income_sources'
  | 'investment_accounts'
  | 'investments'
  | 'investment_transactions'
  | 'investment_allocations'
  | 'target_allocations'
  | 'properties'
  | 'other_assets'
  | 'liabilities'
  | 'goals'
  | 'financial_phases'
  | 'strategy_rules'
  | 'strategy_priorities'
  | 'planned_expenses'
  | 'forecast_scenarios'
  | 'net_worth_snapshots';
