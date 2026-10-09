-- =====================================================================
--  SNOWBALL — Keep the dough rolling.
--  Complete PostgreSQL schema for Supabase.
--
--  Run this file once against a fresh Supabase project
--  (Dashboard → SQL Editor → New query → paste → Run).
--
--  Contents
--    01  Extensions & helpers
--    02  Enumerated types
--    03  Tables
--    04  Indexes
--    05  updated_at triggers
--    06  New-user bootstrap (profile + system categories + default phases)
--    07  Calculation functions
--    08  Views
--    09  Row Level Security
--
--  Money is stored as `numeric(18,4)` — never floating point.
-- =====================================================================


-- =====================================================================
-- 01  EXTENSIONS & HELPERS
-- =====================================================================

create extension if not exists "pgcrypto";      -- gen_random_uuid()

-- Generic updated_at trigger function.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- =====================================================================
-- 02  ENUMERATED TYPES
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'account_type') then
    create type public.account_type as enum (
      'checking',        -- everyday bank account
      'savings',
      'brokerage_cash',  -- e.g. Trading 212 cash
      'ewallet',         -- e.g. Revolut
      'physical_cash',
      'credit_card',
      'other'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'category_type') then
    create type public.category_type as enum ('income', 'essential', 'flexible');
  end if;

  if not exists (select 1 from pg_type where typname = 'income_type') then
    create type public.income_type as enum ('salary', 'bonus', 'rental', 'investment', 'freelance', 'other');
  end if;

  if not exists (select 1 from pg_type where typname = 'income_frequency') then
    create type public.income_frequency as enum ('monthly', 'quarterly', 'annual', 'one_off');
  end if;

  if not exists (select 1 from pg_type where typname = 'expense_frequency') then
    create type public.expense_frequency as enum ('monthly', 'quarterly', 'annual');
  end if;

  if not exists (select 1 from pg_type where typname = 'asset_type') then
    create type public.asset_type as enum ('etf', 'stock', 'bond', 'mutual_fund', 'crypto', 'reit', 'commodity', 'other');
  end if;

  if not exists (select 1 from pg_type where typname = 'investment_txn_type') then
    create type public.investment_txn_type as enum ('buy', 'sell', 'dividend', 'fee', 'interest');
  end if;

  if not exists (select 1 from pg_type where typname = 'rental_status') then
    create type public.rental_status as enum ('owner_occupied', 'rented', 'vacant', 'listed');
  end if;

  if not exists (select 1 from pg_type where typname = 'goal_type') then
    create type public.goal_type as enum (
      'emergency_fund', 'travel', 'property', 'vehicle', 'investment',
      'debt_payoff', 'financial_independence', 'other'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'goal_status') then
    create type public.goal_status as enum ('active', 'paused', 'achieved', 'abandoned');
  end if;

  if not exists (select 1 from pg_type where typname = 'strategy_rule_type') then
    create type public.strategy_rule_type as enum (
      'emergency_fund',       -- target liquid cash floor
      'investment',           -- minimum / target monthly contribution
      'lifestyle',            -- flexible spending policy
      'property',             -- rental surplus routing
      'debt',                 -- repayment policy
      'allocation',           -- target portfolio allocation
      'savings_rate',
      'cash_ceiling',         -- e.g. max physical cash
      'custom'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'priority_level') then
    create type public.priority_level as enum ('low', 'medium', 'high', 'critical');
  end if;

  if not exists (select 1 from pg_type where typname = 'planned_expense_status') then
    create type public.planned_expense_status as enum ('planned', 'funding', 'funded', 'paid', 'cancelled');
  end if;

  if not exists (select 1 from pg_type where typname = 'asset_kind') then
    create type public.asset_kind as enum ('vehicle', 'valuables', 'pension', 'business', 'receivable', 'other');
  end if;

  if not exists (select 1 from pg_type where typname = 'liability_kind') then
    create type public.liability_kind as enum ('mortgage', 'personal_loan', 'student_loan', 'car_loan', 'credit_card', 'other');
  end if;

  if not exists (select 1 from pg_type where typname = 'scenario_kind') then
    create type public.scenario_kind as enum ('conservative', 'base', 'optimistic');
  end if;
end
$$;


-- =====================================================================
-- 03  TABLES
-- =====================================================================

-- ---------------------------------------------------------------------
-- profiles — one row per auth user
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                        uuid primary key references auth.users (id) on delete cascade,
  display_name              text,
  base_currency             char(3)        not null default 'EUR',
  locale                    text           not null default 'en-IE',
  emergency_fund_target     numeric(18,4)  not null default 7000    check (emergency_fund_target >= 0),
  physical_cash_ceiling     numeric(18,4)  not null default 200     check (physical_cash_ceiling >= 0),
  theme                     text           not null default 'system' check (theme in ('light','dark','system')),
  onboarded                 boolean        not null default false,
  created_at                timestamptz    not null default now(),
  updated_at                timestamptz    not null default now()
);

comment on table public.profiles is 'User profile and global financial preferences.';

-- ---------------------------------------------------------------------
-- exchange_rates — abstraction so rates can later come from an API.
-- Global reference data: readable by any authenticated user, writable
-- only by the service role.
-- ---------------------------------------------------------------------
create table if not exists public.exchange_rates (
  base_currency   char(3)        not null,
  quote_currency  char(3)        not null,
  rate            numeric(20,10) not null check (rate > 0),
  as_of           date           not null default current_date,
  source          text           not null default 'manual',
  primary key (base_currency, quote_currency, as_of)
);

comment on table public.exchange_rates is
  '1 unit of base_currency = `rate` units of quote_currency, on `as_of`.';

-- ---------------------------------------------------------------------
-- categories — system defaults (user_id null) + user-defined
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users (id) on delete cascade,
  name           text                   not null check (length(btrim(name)) > 0),
  category_type  public.category_type   not null,
  parent_id      uuid references public.categories (id) on delete cascade,
  icon           text,
  color          text,
  is_system      boolean                not null default false,
  sort_order     integer                not null default 0,
  created_at     timestamptz            not null default now(),
  updated_at     timestamptz            not null default now(),
  -- System categories have no owner; user categories must have one.
  constraint categories_ownership_ck check (
    (is_system and user_id is null) or (not is_system and user_id is not null)
  )
);

create unique index if not exists categories_user_name_uq
  on public.categories (user_id, lower(name), category_type)
  where user_id is not null;

create unique index if not exists categories_system_name_uq
  on public.categories (lower(name), category_type)
  where user_id is null;

-- ---------------------------------------------------------------------
-- accounts — cash & cash-like accounts
-- ---------------------------------------------------------------------
create table if not exists public.accounts (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid                 not null references auth.users (id) on delete cascade,
  name                      text                 not null check (length(btrim(name)) > 0),
  account_type              public.account_type  not null default 'checking',
  institution               text,
  currency                  char(3)              not null default 'EUR',
  balance                   numeric(18,4)        not null default 0,
  interest_rate             numeric(9,6)         not null default 0 check (interest_rate >= 0),  -- APY, 0.024 = 2.4%
  counts_as_liquid          boolean              not null default true,
  counts_as_emergency_fund  boolean              not null default false,
  target_balance            numeric(18,4),        -- e.g. €200 ceiling for physical cash
  is_archived               boolean              not null default false,
  sort_order                integer              not null default 0,
  notes                     text,
  created_at                timestamptz          not null default now(),
  updated_at                timestamptz          not null default now()
);

-- ---------------------------------------------------------------------
-- recurring_expenses — the declared cost of living
--
--  Snowball has no transaction ledger. The user keeps account balances
--  and holdings up to date, and declares the outgoings that repeat.
--  Everything else — total spending, the flexible portion, the savings
--  rate — is derived from how the balances actually moved. See the
--  `monthly_cash_flow` view in § 08.
-- ---------------------------------------------------------------------
create table if not exists public.recurring_expenses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid                        not null references auth.users (id) on delete cascade,
  name          text                        not null check (length(btrim(name)) > 0),
  amount        numeric(18,4)               not null check (amount >= 0),
  currency      char(3)                     not null default 'EUR',
  category_id   uuid references public.categories (id) on delete set null,
  account_id    uuid references public.accounts (id) on delete set null,
  property_id   uuid,                       -- FK added after properties exists
  frequency     public.expense_frequency    not null default 'monthly',
  start_date    date                        not null default current_date,
  end_date      date,
  active        boolean                     not null default true,
  notes         text,
  created_at    timestamptz                 not null default now(),
  updated_at    timestamptz                 not null default now(),
  constraint recurring_expenses_dates_ck check (end_date is null or end_date >= start_date)
);

comment on table public.recurring_expenses is
  'Declared repeating outgoings. These form the essential baseline; actual total spending is inferred from balance movements rather than itemised.';

-- ---------------------------------------------------------------------
-- income_sources — recurring income definitions
-- ---------------------------------------------------------------------
create table if not exists public.income_sources (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid                      not null references auth.users (id) on delete cascade,
  name           text                      not null check (length(btrim(name)) > 0),
  income_type    public.income_type        not null default 'salary',
  amount         numeric(18,4)             not null check (amount >= 0),   -- net
  gross_amount   numeric(18,4)             check (gross_amount is null or gross_amount >= 0),
  currency       char(3)                   not null default 'EUR',
  frequency      public.income_frequency   not null default 'monthly',
  account_id     uuid references public.accounts (id) on delete set null,
  property_id    uuid,                     -- FK added after properties exists
  start_date     date                      not null default current_date,
  end_date       date,
  active         boolean                   not null default true,
  annual_growth  numeric(9,6)              not null default 0,  -- 0.03 = 3%/yr expected raise
  notes          text,
  created_at     timestamptz               not null default now(),
  updated_at     timestamptz               not null default now(),
  constraint income_sources_dates_ck check (end_date is null or end_date >= start_date)
);

-- ---------------------------------------------------------------------
-- income_history — realised income per month (for the salary chart)
-- ---------------------------------------------------------------------
create table if not exists public.income_history (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid                 not null references auth.users (id) on delete cascade,
  income_source_id  uuid                 references public.income_sources (id) on delete cascade,
  period_month      date                 not null,   -- always the 1st of the month
  net_amount        numeric(18,4)        not null check (net_amount >= 0),
  gross_amount      numeric(18,4),
  currency          char(3)              not null default 'EUR',
  notes             text,
  created_at        timestamptz          not null default now(),
  constraint income_history_month_ck check (date_trunc('month', period_month)::date = period_month)
);

create unique index if not exists income_history_uq
  on public.income_history (user_id, income_source_id, period_month);

-- ---------------------------------------------------------------------
-- investment_accounts — brokers
-- ---------------------------------------------------------------------
create table if not exists public.investment_accounts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid           not null references auth.users (id) on delete cascade,
  name         text           not null check (length(btrim(name)) > 0),
  broker       text,
  currency     char(3)        not null default 'EUR',
  account_ref  text,
  notes        text,
  created_at   timestamptz    not null default now(),
  updated_at   timestamptz    not null default now()
);

-- ---------------------------------------------------------------------
-- investments — holdings
-- ---------------------------------------------------------------------
create table if not exists public.investments (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid                not null references auth.users (id) on delete cascade,
  investment_account_id   uuid                references public.investment_accounts (id) on delete set null,
  name                    text                not null check (length(btrim(name)) > 0),
  ticker                  text,
  isin                    text,
  asset_type              public.asset_type   not null default 'etf',
  quantity                numeric(24,8)       not null default 0 check (quantity >= 0),
  average_cost            numeric(18,6)       not null default 0 check (average_cost >= 0),
  current_price           numeric(18,6)       not null default 0 check (current_price >= 0),
  currency                char(3)             not null default 'EUR',
  region                  text,               -- 'US' | 'Developed ex-US' | 'Emerging' | 'Pacific' | ...
  sector                  text,
  expense_ratio           numeric(9,6)        check (expense_ratio is null or expense_ratio >= 0),
  target_allocation       numeric(7,4)        check (target_allocation is null or (target_allocation >= 0 and target_allocation <= 100)),
  realised_gain           numeric(18,4)       not null default 0,
  price_updated_at        timestamptz,
  notes                   text,
  created_at              timestamptz         not null default now(),
  updated_at              timestamptz         not null default now()
);

-- current_value is derived, never stored, so it can never drift from quantity × price.
comment on column public.investments.average_cost is 'Weighted average cost per unit in the holding currency.';

-- ---------------------------------------------------------------------
-- investment_transactions
-- ---------------------------------------------------------------------
create table if not exists public.investment_transactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid                          not null references auth.users (id) on delete cascade,
  investment_id     uuid                          not null references public.investments (id) on delete cascade,
  transaction_type  public.investment_txn_type    not null,
  quantity          numeric(24,8)                 not null default 0 check (quantity >= 0),
  price             numeric(18,6)                 not null default 0 check (price >= 0),
  amount            numeric(18,4),   -- for dividend/fee/interest where quantity×price does not apply
  fees              numeric(18,4)                 not null default 0 check (fees >= 0),
  currency          char(3)                       not null default 'EUR',
  transaction_date  date                          not null default current_date,
  notes             text,
  created_at        timestamptz                   not null default now(),
  constraint investment_txn_shape_ck check (
    (transaction_type in ('buy','sell') and quantity > 0)
    or (transaction_type in ('dividend','fee','interest') and amount is not null)
  )
);

-- ---------------------------------------------------------------------
-- target_allocations — the strategic portfolio model
-- ---------------------------------------------------------------------
create table if not exists public.target_allocations (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid           not null references auth.users (id) on delete cascade,
  bucket              text           not null check (length(btrim(bucket)) > 0), -- 'US Equities', 'Emerging Markets', ...
  target_percentage   numeric(7,4)   not null check (target_percentage >= 0 and target_percentage <= 100),
  tolerance_band      numeric(7,4)   not null default 5 check (tolerance_band >= 0),
  sort_order          integer        not null default 0,
  created_at          timestamptz    not null default now(),
  updated_at          timestamptz    not null default now()
);

create unique index if not exists target_allocations_uq
  on public.target_allocations (user_id, lower(bucket));

-- Maps holdings onto allocation buckets. A single holding (a "Pie") can
-- span several buckets, so the mapping is many-to-many with weights.
create table if not exists public.investment_allocations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid           not null references auth.users (id) on delete cascade,
  investment_id  uuid           not null references public.investments (id) on delete cascade,
  bucket         text           not null,
  weight         numeric(7,4)   not null check (weight > 0 and weight <= 100),  -- % of the holding
  created_at     timestamptz    not null default now()
);

create unique index if not exists investment_allocations_uq
  on public.investment_allocations (investment_id, lower(bucket));

-- ---------------------------------------------------------------------
-- properties
-- ---------------------------------------------------------------------
create table if not exists public.properties (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid                    not null references auth.users (id) on delete cascade,
  name                        text                    not null check (length(btrim(name)) > 0),
  address                     text,
  currency                    char(3)                 not null default 'EUR',
  estimated_value             numeric(18,4)           not null default 0 check (estimated_value >= 0),
  purchase_price              numeric(18,4)           check (purchase_price is null or purchase_price >= 0),
  purchase_date               date,
  mortgage_balance            numeric(18,4)           not null default 0 check (mortgage_balance >= 0),
  mortgage_interest_rate      numeric(9,6)            not null default 0 check (mortgage_interest_rate >= 0),
  monthly_payment             numeric(18,4)           not null default 0 check (monthly_payment >= 0),
  remaining_months            integer                 not null default 0 check (remaining_months >= 0),
  rental_status               public.rental_status    not null default 'vacant',
  monthly_rent                numeric(18,4)           not null default 0 check (monthly_rent >= 0),
  monthly_property_expenses   numeric(18,4)           not null default 0 check (monthly_property_expenses >= 0),
  maintenance_reserve         numeric(18,4)           not null default 0 check (maintenance_reserve >= 0),
  maintenance_reserve_target  numeric(18,4)           not null default 0 check (maintenance_reserve_target >= 0),
  annual_appreciation         numeric(9,6)            not null default 0.02,
  expected_rent_start         date,
  notes                       text,
  created_at                  timestamptz             not null default now(),
  updated_at                  timestamptz             not null default now()
);

-- Deferred FKs now that properties exists.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recurring_expenses_property_id_fkey') then
    alter table public.recurring_expenses
      add constraint recurring_expenses_property_id_fkey
      foreign key (property_id) references public.properties (id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'income_sources_property_id_fkey') then
    alter table public.income_sources
      add constraint income_sources_property_id_fkey
      foreign key (property_id) references public.properties (id) on delete set null;
  end if;
end
$$;

-- Property value history, for the equity chart.
create table if not exists public.property_valuations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid           not null references auth.users (id) on delete cascade,
  property_id    uuid           not null references public.properties (id) on delete cascade,
  valuation_date date           not null default current_date,
  estimated_value numeric(18,4) not null check (estimated_value >= 0),
  mortgage_balance numeric(18,4) not null default 0 check (mortgage_balance >= 0),
  source         text,
  created_at     timestamptz    not null default now()
);

create unique index if not exists property_valuations_uq
  on public.property_valuations (property_id, valuation_date);

-- ---------------------------------------------------------------------
-- other_assets / liabilities — everything net worth needs beyond the above
-- ---------------------------------------------------------------------
create table if not exists public.other_assets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid                not null references auth.users (id) on delete cascade,
  name          text                not null check (length(btrim(name)) > 0),
  asset_kind    public.asset_kind   not null default 'other',
  current_value numeric(18,4)       not null default 0 check (current_value >= 0),
  currency      char(3)             not null default 'EUR',
  purchase_value numeric(18,4),
  annual_depreciation numeric(9,6)  not null default 0,
  is_liquid     boolean             not null default false,
  notes         text,
  created_at    timestamptz         not null default now(),
  updated_at    timestamptz         not null default now()
);

create table if not exists public.liabilities (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid                    not null references auth.users (id) on delete cascade,
  name             text                    not null check (length(btrim(name)) > 0),
  liability_kind   public.liability_kind   not null default 'other',
  balance          numeric(18,4)           not null default 0 check (balance >= 0),
  currency         char(3)                 not null default 'EUR',
  interest_rate    numeric(9,6)            not null default 0 check (interest_rate >= 0),
  monthly_payment  numeric(18,4)           not null default 0 check (monthly_payment >= 0),
  remaining_months integer                 not null default 0 check (remaining_months >= 0),
  property_id      uuid references public.properties (id) on delete set null,
  notes            text,
  created_at       timestamptz             not null default now(),
  updated_at       timestamptz             not null default now()
);

comment on table public.liabilities is
  'Non-mortgage debt, plus optionally mortgages tracked outside a property. Property mortgages live on `properties.mortgage_balance` and are NOT duplicated here.';

-- ---------------------------------------------------------------------
-- goals
-- ---------------------------------------------------------------------
create table if not exists public.goals (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid                     not null references auth.users (id) on delete cascade,
  name              text                     not null check (length(btrim(name)) > 0),
  goal_type         public.goal_type         not null default 'other',
  target_amount     numeric(18,4)            not null check (target_amount > 0),
  current_amount    numeric(18,4)            not null default 0 check (current_amount >= 0),
  currency          char(3)                  not null default 'EUR',
  target_date       date,
  priority          public.priority_level    not null default 'medium',
  status            public.goal_status       not null default 'active',
  account_id        uuid references public.accounts (id) on delete set null,
  monthly_contribution numeric(18,4)         not null default 0 check (monthly_contribution >= 0),
  -- When true, current_amount is derived from the linked account balance.
  track_account_balance boolean              not null default false,
  notes             text,
  created_at        timestamptz              not null default now(),
  updated_at        timestamptz              not null default now()
);

-- ---------------------------------------------------------------------
-- financial_phases  &  strategy_rules
-- ---------------------------------------------------------------------
create table if not exists public.financial_phases (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid           not null references auth.users (id) on delete cascade,
  name          text           not null check (length(btrim(name)) > 0),
  phase_order   integer        not null default 1 check (phase_order >= 1),
  active        boolean        not null default false,
  objective     text,
  description   text,
  entry_condition  jsonb       not null default '{}'::jsonb,
  exit_condition   jsonb       not null default '{}'::jsonb,
  completed_at  timestamptz,
  created_at    timestamptz    not null default now(),
  updated_at    timestamptz    not null default now()
);

create unique index if not exists financial_phases_order_uq
  on public.financial_phases (user_id, phase_order);

-- Exactly one active phase per user.
create unique index if not exists financial_phases_single_active_uq
  on public.financial_phases (user_id)
  where active;

create table if not exists public.strategy_rules (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid                            not null references auth.users (id) on delete cascade,
  phase_id           uuid                            references public.financial_phases (id) on delete cascade,
  rule_type          public.strategy_rule_type       not null,
  name               text                            not null check (length(btrim(name)) > 0),
  description        text,
  target_value       numeric(18,4),
  target_percentage  numeric(7,4) check (target_percentage is null or (target_percentage >= 0 and target_percentage <= 100)),
  priority           integer                         not null default 1 check (priority >= 1),
  enabled            boolean                         not null default true,
  configuration      jsonb                           not null default '{}'::jsonb,
  created_at         timestamptz                     not null default now(),
  updated_at         timestamptz                     not null default now()
);

-- Strategy priorities — "Priority 1: financial security" etc.
create table if not exists public.strategy_priorities (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid           not null references auth.users (id) on delete cascade,
  name          text           not null check (length(btrim(name)) > 0),
  rank          integer        not null check (rank >= 1),
  allocation_percentage numeric(7,4) not null default 0
                  check (allocation_percentage >= 0 and allocation_percentage <= 100),
  description   text,
  created_at    timestamptz    not null default now(),
  updated_at    timestamptz    not null default now()
);

create unique index if not exists strategy_priorities_rank_uq
  on public.strategy_priorities (user_id, rank);

-- ---------------------------------------------------------------------
-- planned_expenses — upcoming large spending
-- ---------------------------------------------------------------------
create table if not exists public.planned_expenses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid                              not null references auth.users (id) on delete cascade,
  name          text                              not null check (length(btrim(name)) > 0),
  amount        numeric(18,4)                     not null check (amount > 0),
  saved_amount  numeric(18,4)                     not null default 0 check (saved_amount >= 0),
  currency      char(3)                           not null default 'EUR',
  target_date   date                              not null,
  priority      public.priority_level             not null default 'medium',
  category      text,
  status        public.planned_expense_status     not null default 'planned',
  account_id    uuid references public.accounts (id) on delete set null,
  property_id   uuid references public.properties (id) on delete set null,
  notes         text,
  created_at    timestamptz                       not null default now(),
  updated_at    timestamptz                       not null default now()
);

-- ---------------------------------------------------------------------
-- Snapshots — the history behind the trend charts
-- ---------------------------------------------------------------------
create table if not exists public.net_worth_snapshots (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid           not null references auth.users (id) on delete cascade,
  snapshot_date     date           not null default current_date,
  cash_value        numeric(18,4)  not null default 0,
  investment_value  numeric(18,4)  not null default 0,
  property_value    numeric(18,4)  not null default 0,
  other_assets      numeric(18,4)  not null default 0,
  liabilities       numeric(18,4)  not null default 0,
  net_worth         numeric(18,4)  not null default 0,
  currency          char(3)        not null default 'EUR',
  created_at        timestamptz    not null default now()
);

create unique index if not exists net_worth_snapshots_uq
  on public.net_worth_snapshots (user_id, snapshot_date);

create table if not exists public.portfolio_snapshots (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid           not null references auth.users (id) on delete cascade,
  snapshot_date        date           not null default current_date,
  total_value          numeric(18,4)  not null default 0,
  total_contributions  numeric(18,4)  not null default 0,
  total_gain           numeric(18,4)  not null default 0,
  currency             char(3)        not null default 'EUR',
  created_at           timestamptz    not null default now()
);

create unique index if not exists portfolio_snapshots_uq
  on public.portfolio_snapshots (user_id, snapshot_date);

create table if not exists public.account_balance_snapshots (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid           not null references auth.users (id) on delete cascade,
  account_id     uuid           not null references public.accounts (id) on delete cascade,
  snapshot_date  date           not null default current_date,
  balance        numeric(18,4)  not null default 0,
  created_at     timestamptz    not null default now()
);

create unique index if not exists account_balance_snapshots_uq
  on public.account_balance_snapshots (account_id, snapshot_date);

-- ---------------------------------------------------------------------
-- forecast_scenarios — saved assumption sets for the Forecasts page
-- ---------------------------------------------------------------------
create table if not exists public.forecast_scenarios (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid                   not null references auth.users (id) on delete cascade,
  name                      text                   not null check (length(btrim(name)) > 0),
  kind                      public.scenario_kind   not null default 'base',
  is_default                boolean                not null default false,
  salary_growth             numeric(9,6)           not null default 0.03,
  inflation                 numeric(9,6)           not null default 0.02,
  investment_return         numeric(9,6)           not null default 0.07,
  cash_interest             numeric(9,6)           not null default 0.024,
  property_appreciation     numeric(9,6)           not null default 0.02,
  monthly_investment        numeric(18,4)          not null default 0 check (monthly_investment >= 0),
  monthly_flexible_spending numeric(18,4)          not null default 0 check (monthly_flexible_spending >= 0),
  include_rental_income     boolean                not null default true,
  include_planned_expenses  boolean                not null default true,
  horizon_years             integer                not null default 20 check (horizon_years between 1 and 60),
  notes                     text,
  created_at                timestamptz            not null default now(),
  updated_at                timestamptz            not null default now()
);

create unique index if not exists forecast_scenarios_default_uq
  on public.forecast_scenarios (user_id)
  where is_default;


-- =====================================================================
-- 04  INDEXES
-- =====================================================================

create index if not exists accounts_user_idx                on public.accounts (user_id) where not is_archived;
create index if not exists recurring_expenses_user_idx      on public.recurring_expenses (user_id) where active;
create index if not exists recurring_expenses_category_idx  on public.recurring_expenses (category_id);
create index if not exists recurring_expenses_property_idx  on public.recurring_expenses (property_id) where property_id is not null;
create index if not exists categories_user_idx              on public.categories (user_id);
create index if not exists categories_parent_idx            on public.categories (parent_id);
create index if not exists income_sources_user_idx          on public.income_sources (user_id) where active;
create index if not exists income_history_user_month_idx    on public.income_history (user_id, period_month desc);
create index if not exists investments_user_idx             on public.investments (user_id);
create index if not exists investments_account_idx          on public.investments (investment_account_id);
create index if not exists investment_txn_user_date_idx     on public.investment_transactions (user_id, transaction_date desc);
create index if not exists investment_txn_investment_idx    on public.investment_transactions (investment_id, transaction_date);
create index if not exists investment_allocations_user_idx  on public.investment_allocations (user_id);
create index if not exists target_allocations_user_idx      on public.target_allocations (user_id);
create index if not exists properties_user_idx              on public.properties (user_id);
create index if not exists property_valuations_user_idx     on public.property_valuations (user_id, valuation_date desc);
create index if not exists other_assets_user_idx            on public.other_assets (user_id);
create index if not exists liabilities_user_idx             on public.liabilities (user_id);
create index if not exists goals_user_idx                   on public.goals (user_id, status);
create index if not exists financial_phases_user_idx        on public.financial_phases (user_id, phase_order);
create index if not exists strategy_rules_user_idx          on public.strategy_rules (user_id, priority);
create index if not exists strategy_rules_phase_idx         on public.strategy_rules (phase_id);
create index if not exists strategy_priorities_user_idx     on public.strategy_priorities (user_id, rank);
create index if not exists planned_expenses_user_date_idx   on public.planned_expenses (user_id, target_date);
create index if not exists net_worth_snapshots_user_idx     on public.net_worth_snapshots (user_id, snapshot_date desc);
create index if not exists portfolio_snapshots_user_idx     on public.portfolio_snapshots (user_id, snapshot_date desc);
create index if not exists account_balance_snap_user_idx    on public.account_balance_snapshots (user_id, snapshot_date desc);
create index if not exists forecast_scenarios_user_idx      on public.forecast_scenarios (user_id);
create index if not exists exchange_rates_lookup_idx        on public.exchange_rates (base_currency, quote_currency, as_of desc);


-- =====================================================================
-- 05  updated_at TRIGGERS
-- =====================================================================

do $$
declare
  t text;
  tables text[] := array[
    'profiles','categories','accounts','recurring_expenses','income_sources',
    'investment_accounts','investments','target_allocations','properties',
    'other_assets','liabilities','goals','financial_phases','strategy_rules',
    'strategy_priorities','planned_expenses','forecast_scenarios'
  ];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t);
  end loop;
end
$$;


-- =====================================================================
-- 06  NEW-USER BOOTSTRAP
-- =====================================================================

-- System categories — shared by every user (user_id is null, is_system true).
insert into public.categories (name, category_type, is_system, sort_order) values
  ('Salary',            'income',    true,  1),
  ('Bonus',             'income',    true,  2),
  ('Rental income',     'income',    true,  3),
  ('Investment income', 'income',    true,  4),
  ('Other income',      'income',    true,  5),

  ('Housing',           'essential', true, 10),
  ('Mortgage',          'essential', true, 11),
  ('Rent',              'essential', true, 12),
  ('Groceries',         'essential', true, 13),
  ('Utilities',         'essential', true, 14),
  ('Insurance',         'essential', true, 15),
  ('Transport',         'essential', true, 16),
  ('Healthcare',        'essential', true, 17),
  ('Subscriptions',     'essential', true, 18),

  ('Restaurants',       'flexible',  true, 30),
  ('Travel',            'flexible',  true, 31),
  ('Shopping',          'flexible',  true, 32),
  ('Entertainment',     'flexible',  true, 33),
  ('Hobbies',           'flexible',  true, 34),
  ('Other spending',    'flexible',  true, 35)
on conflict do nothing;

-- Base FX rates so the app has something to work with out of the box.
-- Replace/refresh from a real provider in production.
insert into public.exchange_rates (base_currency, quote_currency, rate, as_of, source) values
  ('EUR','EUR',1.0,          current_date, 'identity'),
  ('EUR','USD',1.0850000000, current_date, 'seed'),
  ('EUR','GBP',0.8400000000, current_date, 'seed'),
  ('EUR','CHF',0.9400000000, current_date, 'seed'),
  ('USD','EUR',0.9216589862, current_date, 'seed'),
  ('GBP','EUR',1.1904761905, current_date, 'seed'),
  ('CHF','EUR',1.0638297872, current_date, 'seed')
on conflict do nothing;

-- Creates the profile, default phases and a base forecast scenario for
-- every newly-signed-up user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase1 uuid;
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  insert into public.financial_phases (user_id, name, phase_order, active, objective, description, exit_condition)
  values
    (new.id, 'Financial Security', 1, true,
     'Build liquid cash to the emergency fund target.',
     'Prioritise cash accumulation. No required new investment contributions; existing investments stay invested. Flexible spending is allowed above the security floor.',
     '{"type":"emergency_fund_reached"}'::jsonb)
  returning id into v_phase1;

  insert into public.financial_phases (user_id, name, phase_order, active, objective, description, entry_condition)
  values
    (new.id, 'Wealth Building', 2, false,
     'Convert surplus cash flow into invested assets.',
     'Once the emergency fund is full, direct monthly surplus into the target portfolio allocation while holding the cash floor.',
     '{"type":"emergency_fund_reached"}'::jsonb),
    (new.id, 'Property Optimisation', 3, false,
     'Make property self-funding and build a property reserve.',
     'Rental income first covers the mortgage and property costs; surplus accumulates in the property reserve.',
     '{"type":"rental_income_started"}'::jsonb);

  insert into public.strategy_rules (user_id, phase_id, rule_type, name, description, target_value, priority, configuration)
  values
    (new.id, v_phase1, 'emergency_fund', 'Emergency Fund Rule',
     'Hold liquid cash equal to the emergency fund target before increasing investment contributions.',
     7000, 1, '{"counts":"emergency_accounts"}'::jsonb),
    (new.id, v_phase1, 'investment', 'Investment Rule',
     'Minimum monthly investment is €0 while the emergency fund is below target.',
     0, 2, '{"minimum_monthly":0,"resume_when":"emergency_fund_reached"}'::jsonb),
    (new.id, v_phase1, 'lifestyle', 'Lifestyle Rule',
     'No fixed monthly discretionary limit. Flexible spending comes from cash above the security floor.',
     null, 3, '{"mode":"above_security_floor"}'::jsonb),
    (new.id, v_phase1, 'property', 'Property Rule',
     'Rental income above mortgage and property expenses goes to the Property Reserve, not to lifestyle spending.',
     null, 4, '{"route_surplus_to":"property_reserve"}'::jsonb);

  insert into public.strategy_priorities (user_id, name, rank, allocation_percentage, description) values
    (new.id, 'Financial security', 1, 70, 'Liquid cash up to the emergency fund target.'),
    (new.id, 'Wealth building',    2, 20, 'Long-term diversified investing.'),
    (new.id, 'Lifestyle & travel', 3, 10, 'Flexible spending funded from cash above the floor.');

  insert into public.forecast_scenarios (user_id, name, kind, is_default, investment_return, salary_growth, inflation)
  values (new.id, 'Base case', 'base', true, 0.07, 0.03, 0.02);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =====================================================================
-- 07  CALCULATION FUNCTIONS
--
--  All amounts are returned in the user's base currency, converted via
--  public.convert_amount().  Functions are `security invoker` so RLS
--  still applies; they default to auth.uid() when no user is passed.
-- =====================================================================

-- Latest FX rate for a pair. Falls back to the inverse, then to 1.
create or replace function public.fx_rate(p_from char(3), p_to char(3))
returns numeric
language sql
stable
as $$
  select case
    when p_from = p_to then 1::numeric
    else coalesce(
      (select rate from public.exchange_rates
        where base_currency = p_from and quote_currency = p_to
        order by as_of desc limit 1),
      (select 1 / rate from public.exchange_rates
        where base_currency = p_to and quote_currency = p_from and rate <> 0
        order by as_of desc limit 1),
      1::numeric
    )
  end;
$$;

create or replace function public.convert_amount(p_amount numeric, p_from char(3), p_to char(3))
returns numeric
language sql
stable
as $$
  select round(coalesce(p_amount, 0) * public.fx_rate(p_from, p_to), 4);
$$;

create or replace function public.base_currency(p_user uuid default auth.uid())
returns char(3)
language sql
stable
security invoker
as $$
  select coalesce((select base_currency from public.profiles where id = p_user), 'EUR');
$$;

-- ---- Cash --------------------------------------------------------------

create or replace function public.liquid_cash(p_user uuid default auth.uid())
returns numeric
language sql
stable
security invoker
as $$
  select coalesce(sum(public.convert_amount(a.balance, a.currency, public.base_currency(p_user))), 0)
  from public.accounts a
  where a.user_id = p_user
    and a.counts_as_liquid
    and not a.is_archived
    and a.account_type <> 'credit_card';
$$;

create or replace function public.emergency_fund_balance(p_user uuid default auth.uid())
returns numeric
language sql
stable
security invoker
as $$
  select coalesce(sum(public.convert_amount(a.balance, a.currency, public.base_currency(p_user))), 0)
  from public.accounts a
  where a.user_id = p_user
    and a.counts_as_emergency_fund
    and not a.is_archived;
$$;

create or replace function public.emergency_fund_progress(p_user uuid default auth.uid())
returns numeric
language sql
stable
security invoker
as $$
  select case
    when coalesce((select emergency_fund_target from public.profiles where id = p_user), 0) <= 0 then 100
    else least(100, round(
      public.emergency_fund_balance(p_user)
      / (select emergency_fund_target from public.profiles where id = p_user) * 100, 2))
  end;
$$;

-- ---- Income & expenses -------------------------------------------------

-- Recurring monthly income defined in income_sources, normalised to a month.
create or replace function public.monthly_income(p_user uuid default auth.uid())
returns numeric
language sql
stable
security invoker
as $$
  select coalesce(sum(
    public.convert_amount(s.amount, s.currency, public.base_currency(p_user))
      * case s.frequency
          when 'monthly'   then 1
          when 'quarterly' then 1.0/3
          when 'annual'    then 1.0/12
          else 0
        end
  ), 0)
  from public.income_sources s
  where s.user_id = p_user
    and s.active
    and (s.end_date is null or s.end_date >= current_date);
$$;

-- The declared cost of living, normalised to a month.
create or replace function public.essential_monthly_expenses(p_user uuid default auth.uid())
returns numeric
language sql
stable
security invoker
as $$
  select coalesce(sum(
    public.convert_amount(e.amount, e.currency, public.base_currency(p_user))
      * case e.frequency
          when 'monthly'   then 1
          when 'quarterly' then 1.0/3
          when 'annual'    then 1.0/12
        end
  ), 0)
  from public.recurring_expenses e
  where e.user_id = p_user
    and e.active
    and (e.end_date is null or e.end_date >= current_date);
$$;

-- Total cash held across every non-card account, at a point in time.
-- Internal transfers cancel out here, which is what makes the derived
-- spending figure in `monthly_cash_flow` correct.
create or replace function public.total_cash(p_user uuid default auth.uid(), p_as_of date default current_date)
returns numeric
language sql
stable
security invoker
as $$
  select coalesce(sum(public.convert_amount(a.balance, a.currency, public.base_currency(p_user))), 0)
  from public.accounts a
  where a.user_id = p_user
    and not a.is_archived
    and a.account_type <> 'credit_card';
$$;

-- ---- Investments -------------------------------------------------------

create or replace function public.portfolio_value(p_user uuid default auth.uid())
returns numeric
language sql
stable
security invoker
as $$
  select coalesce(sum(public.convert_amount(i.quantity * i.current_price, i.currency, public.base_currency(p_user))), 0)
  from public.investments i
  where i.user_id = p_user;
$$;

create or replace function public.portfolio_cost_basis(p_user uuid default auth.uid())
returns numeric
language sql
stable
security invoker
as $$
  select coalesce(sum(public.convert_amount(i.quantity * i.average_cost, i.currency, public.base_currency(p_user))), 0)
  from public.investments i
  where i.user_id = p_user;
$$;

-- ---- Property ----------------------------------------------------------

create or replace function public.property_equity(p_user uuid default auth.uid())
returns numeric
language sql
stable
security invoker
as $$
  select coalesce(sum(public.convert_amount(p.estimated_value - p.mortgage_balance, p.currency, public.base_currency(p_user))), 0)
  from public.properties p
  where p.user_id = p_user;
$$;

-- ---- Net worth ---------------------------------------------------------

create or replace function public.current_net_worth(p_user uuid default auth.uid())
returns numeric
language sql
stable
security invoker
as $$
  select
      public.liquid_cash(p_user)
    + public.portfolio_value(p_user)
    + public.property_equity(p_user)
    + coalesce((select sum(public.convert_amount(o.current_value, o.currency, public.base_currency(p_user)))
                  from public.other_assets o where o.user_id = p_user), 0)
    - coalesce((select sum(public.convert_amount(l.balance, l.currency, public.base_currency(p_user)))
                  from public.liabilities l where l.user_id = p_user), 0);
$$;

-- ---- Strategy ----------------------------------------------------------

-- Months of essential expenses currently covered by emergency cash.
create or replace function public.months_of_runway(p_user uuid default auth.uid())
returns numeric
language sql
stable
security invoker
as $$
  select case
    when public.essential_monthly_expenses(p_user) <= 0 then null
    else round(public.emergency_fund_balance(p_user) / public.essential_monthly_expenses(p_user), 1)
  end;
$$;

-- Composite 0–100 security score.
--   40%  emergency fund progress
--   20%  runway (capped at 6 months)
--   15%  savings rate
--   15%  debt burden (non-mortgage debt vs annual income)
--   10%  liquidity share of net worth
create or replace function public.security_score(p_user uuid default auth.uid())
returns numeric
language plpgsql
stable
security invoker
as $$
declare
  v_income     numeric := public.monthly_income(p_user);
  v_essential  numeric := public.essential_monthly_expenses(p_user);
  v_runway     numeric := coalesce(public.months_of_runway(p_user), 0);
  v_ef         numeric := public.emergency_fund_progress(p_user);
  v_debt       numeric;
  v_nw         numeric := public.current_net_worth(p_user);
  v_liquid     numeric := public.liquid_cash(p_user);
  s_savings    numeric;
  s_debt       numeric;
  s_liquidity  numeric;
begin
  select coalesce(sum(public.convert_amount(l.balance, l.currency, public.base_currency(p_user))), 0)
    into v_debt
    from public.liabilities l
   where l.user_id = p_user
     and l.liability_kind <> 'mortgage';

  s_savings := case
    when v_income <= 0 then 0
    else least(1, greatest(0, (v_income - v_essential) / v_income / 0.30))
  end;

  s_debt := case
    when v_income <= 0 then 0
    else greatest(0, 1 - (v_debt / (v_income * 12)))
  end;

  s_liquidity := case
    when v_nw <= 0 then 0
    else least(1, (v_liquid / v_nw) / 0.20)
  end;

  return round(
      (v_ef / 100) * 40
    + least(1, v_runway / 6) * 20
    + s_savings * 15
    + s_debt * 15
    + s_liquidity * 10
  , 1);
end;
$$;

-- Cash the user can spend without breaching the security floor.
-- The floor is min(emergency target, current emergency balance is irrelevant):
-- everything liquid above the target is genuinely free.
create or replace function public.available_above_floor(p_user uuid default auth.uid())
returns numeric
language sql
stable
security invoker
as $$
  select greatest(0,
      public.liquid_cash(p_user)
    - coalesce((select emergency_fund_target from public.profiles where id = p_user), 0)
    - coalesce((select sum(public.convert_amount(pe.amount - pe.saved_amount, pe.currency, public.base_currency(p_user)))
                  from public.planned_expenses pe
                 where pe.user_id = p_user
                   and pe.status in ('planned','funding')
                   and pe.target_date <= (current_date + interval '3 months')::date), 0)
  );
$$;

-- ---- Goals -------------------------------------------------------------

create or replace function public.goal_required_monthly(p_goal uuid)
returns numeric
language sql
stable
security invoker
as $$
  select case
    when g.target_date is null then null
    when g.target_date <= current_date then greatest(0, g.target_amount - g.current_amount)
    else round(
      greatest(0, g.target_amount - g.current_amount)
      / greatest(1, ceil(extract(epoch from (g.target_date - current_date)) / 2629746.0)), 2)
  end
  from public.goals g
  where g.id = p_goal;
$$;


-- =====================================================================
-- 08  VIEWS
--
--  Views run with the querying user's privileges (`security_invoker`),
--  so the underlying RLS policies apply and no data leaks across users.
-- =====================================================================

-- Live holding valuation with derived gain/loss.
create or replace view public.investment_positions
with (security_invoker = true) as
select
  i.id,
  i.user_id,
  i.investment_account_id,
  ia.name                                            as broker_account,
  i.name,
  i.ticker,
  i.isin,
  i.asset_type,
  i.quantity,
  i.average_cost,
  i.current_price,
  i.currency,
  i.region,
  i.sector,
  i.expense_ratio,
  i.target_allocation,
  round(i.quantity * i.current_price, 4)             as current_value,
  round(i.quantity * i.average_cost, 4)              as cost_basis,
  round(i.quantity * (i.current_price - i.average_cost), 4) as unrealised_gain,
  case when i.average_cost > 0
       then round((i.current_price - i.average_cost) / i.average_cost * 100, 4)
       else 0 end                                    as return_percentage,
  i.realised_gain,
  round(public.convert_amount(i.quantity * i.current_price, i.currency, public.base_currency(i.user_id)), 4)
                                                     as current_value_base
from public.investments i
left join public.investment_accounts ia on ia.id = i.investment_account_id;

-- Target vs actual allocation, with the rebalance delta.
create or replace view public.portfolio_allocation
with (security_invoker = true) as
with holding_buckets as (
  -- Explicit bucket weights where defined, otherwise the holding's region,
  -- otherwise "Unclassified".
  select
    i.user_id,
    coalesce(al.bucket, i.region, 'Unclassified')                          as bucket,
    round(public.convert_amount(i.quantity * i.current_price, i.currency, public.base_currency(i.user_id))
          * coalesce(al.weight, 100) / 100, 4)                             as value_base
  from public.investments i
  left join public.investment_allocations al on al.investment_id = i.id
),
totals as (
  select user_id, sum(value_base) as total from holding_buckets group by user_id
)
select
  hb.user_id,
  hb.bucket,
  round(sum(hb.value_base), 2)                                             as actual_value,
  case when t.total > 0 then round(sum(hb.value_base) / t.total * 100, 2) else 0 end
                                                                           as actual_percentage,
  coalesce(ta.target_percentage, 0)                                        as target_percentage,
  round(
    (case when t.total > 0 then sum(hb.value_base) / t.total * 100 else 0 end)
    - coalesce(ta.target_percentage, 0), 2)                                as drift_percentage,
  round(t.total * coalesce(ta.target_percentage, 0) / 100 - sum(hb.value_base), 2)
                                                                           as rebalance_amount,
  coalesce(ta.tolerance_band, 5)                                           as tolerance_band
from holding_buckets hb
join totals t on t.user_id = hb.user_id
left join public.target_allocations ta
       on ta.user_id = hb.user_id and lower(ta.bucket) = lower(hb.bucket)
group by hb.user_id, hb.bucket, t.total, ta.target_percentage, ta.tolerance_band;

-- Monthly cash flow, derived rather than itemised.
--
--  With no transaction ledger, total spending in a month is whatever
--  income did not turn into either cash or investments:
--
--     spending = income − investment contributions − change in cash
--
--  Cash is measured across every non-card account, so moving money
--  between your own accounts nets to zero and can never look like
--  spending. The essential slice is what the user declared in
--  `recurring_expenses`; whatever is left over is flexible.
create or replace view public.monthly_cash_flow
with (security_invoker = true) as
with month_ends as (
  select
    s.user_id,
    date_trunc('month', s.snapshot_date)::date as period_month,
    max(s.snapshot_date)                       as as_of
  from public.account_balance_snapshots s
  group by s.user_id, date_trunc('month', s.snapshot_date)
),
cash_at as (
  select
    m.user_id,
    m.period_month,
    sum(public.convert_amount(s.balance, a.currency, public.base_currency(m.user_id))) as cash
  from month_ends m
  join public.account_balance_snapshots s
    on s.user_id = m.user_id and s.snapshot_date = m.as_of
  join public.accounts a
    on a.id = s.account_id and a.account_type <> 'credit_card'
  group by m.user_id, m.period_month
),
income_by_month as (
  select
    h.user_id,
    h.period_month,
    sum(public.convert_amount(h.net_amount, h.currency, public.base_currency(h.user_id))) as income
  from public.income_history h
  group by h.user_id, h.period_month
),
contributions_by_month as (
  select
    t.user_id,
    date_trunc('month', t.transaction_date)::date as period_month,
    coalesce(sum(public.convert_amount(coalesce(t.amount, t.quantity * t.price), t.currency,
                                       public.base_currency(t.user_id)))
             filter (where t.transaction_type = 'buy'), 0)
    - coalesce(sum(public.convert_amount(coalesce(t.amount, t.quantity * t.price), t.currency,
                                         public.base_currency(t.user_id)))
             filter (where t.transaction_type = 'sell'), 0) as contributed
  from public.investment_transactions t
  group by t.user_id, date_trunc('month', t.transaction_date)
),
joined as (
  select
    c.user_id,
    c.period_month,
    coalesce(i.income, 0)                                                            as income,
    coalesce(k.contributed, 0)                                                       as contributed,
    c.cash - lag(c.cash) over (partition by c.user_id order by c.period_month)       as cash_change,
    public.essential_monthly_expenses(c.user_id)                                     as essential_budget
  from cash_at c
  left join income_by_month i        on i.user_id = c.user_id and i.period_month = c.period_month
  left join contributions_by_month k on k.user_id = c.user_id and k.period_month = c.period_month
),
derived as (
  select
    user_id,
    period_month,
    income,
    essential_budget,
    greatest(0, income - contributed - cash_change) as spending
  from joined
  where cash_change is not null   -- the first month has nothing to compare against
)
select
  user_id,
  period_month,
  round(income, 2)                                            as income,
  round(least(essential_budget, spending), 2)                 as essential_expenses,
  round(greatest(0, spending - essential_budget), 2)          as flexible_expenses,
  round(spending, 2)                                          as total_expenses,
  round(income - spending, 2)                                 as net_cash_flow
from derived;

-- Goal progress with required contribution and on-track flag.
create or replace view public.goal_progress
with (security_invoker = true) as
select
  g.id,
  g.user_id,
  g.name,
  g.goal_type,
  g.target_amount,
  g.current_amount,
  g.currency,
  g.target_date,
  g.priority,
  g.status,
  g.monthly_contribution,
  greatest(0, g.target_amount - g.current_amount)                                       as remaining_amount,
  case when g.target_amount > 0
       then least(100, round(g.current_amount / g.target_amount * 100, 2)) else 0 end    as progress_percentage,
  case
    when g.target_date is null then null
    else greatest(1, ceil(extract(epoch from (g.target_date - current_date)) / 2629746.0))
  end                                                                                    as months_remaining,
  public.goal_required_monthly(g.id)                                                     as required_monthly,
  case
    when g.target_date is null then true
    when g.monthly_contribution <= 0 then g.current_amount >= g.target_amount
    else g.monthly_contribution >= coalesce(public.goal_required_monthly(g.id), 0)
  end                                                                                    as on_track
from public.goals g;

-- Per-property cash-flow waterfall: rent → expenses → mortgage → reserve.
create or replace view public.property_performance
with (security_invoker = true) as
select
  p.id,
  p.user_id,
  p.name,
  p.currency,
  p.estimated_value,
  p.purchase_price,
  p.mortgage_balance,
  p.mortgage_interest_rate,
  p.monthly_payment,
  p.remaining_months,
  p.rental_status,
  p.monthly_rent,
  p.monthly_property_expenses,
  p.maintenance_reserve,
  p.maintenance_reserve_target,
  round(p.estimated_value - p.mortgage_balance, 2)                                       as equity,
  case when p.estimated_value > 0
       then round(p.mortgage_balance / p.estimated_value * 100, 2) else 0 end            as loan_to_value,
  round(p.monthly_rent - p.monthly_property_expenses - p.monthly_payment, 2)             as monthly_cash_flow,
  round((p.monthly_rent - p.monthly_property_expenses - p.monthly_payment) * 12, 2)      as annual_cash_flow,
  case when p.estimated_value > 0
       then round(p.monthly_rent * 12 / p.estimated_value * 100, 2) else 0 end           as gross_yield,
  case when p.estimated_value > 0
       then round((p.monthly_rent - p.monthly_property_expenses) * 12 / p.estimated_value * 100, 2)
       else 0 end                                                                        as net_yield,
  -- First-month principal reduction at the current rate.
  round(greatest(0, p.monthly_payment - p.mortgage_balance * p.mortgage_interest_rate / 12), 2)
                                                                                         as monthly_principal_reduction,
  round(p.mortgage_balance * p.mortgage_interest_rate / 12, 2)                           as monthly_interest
from public.properties p;

-- One row per user: the headline numbers the dashboard leads with.
create or replace view public.financial_summary
with (security_invoker = true) as
select
  pr.id                                                       as user_id,
  pr.base_currency,
  pr.emergency_fund_target,
  public.liquid_cash(pr.id)                                   as liquid_cash,
  public.emergency_fund_balance(pr.id)                        as emergency_fund_balance,
  public.emergency_fund_progress(pr.id)                       as emergency_fund_progress,
  public.portfolio_value(pr.id)                               as investments_value,
  public.portfolio_cost_basis(pr.id)                          as investments_cost_basis,
  public.property_equity(pr.id)                               as property_equity,
  public.monthly_income(pr.id)                                as monthly_income,
  public.essential_monthly_expenses(pr.id)                    as essential_monthly_expenses,
  public.current_net_worth(pr.id)                             as net_worth,
  public.security_score(pr.id)                                as security_score,
  public.months_of_runway(pr.id)                              as months_of_runway,
  public.available_above_floor(pr.id)                         as available_above_floor
from public.profiles pr;

-- Convenience view: current net worth broken into its components.
create or replace view public.current_net_worth_breakdown
with (security_invoker = true) as
select
  pr.id                                     as user_id,
  public.liquid_cash(pr.id)                 as cash_value,
  public.portfolio_value(pr.id)             as investment_value,
  coalesce((select sum(public.convert_amount(p.estimated_value, p.currency, pr.base_currency))
              from public.properties p where p.user_id = pr.id), 0)     as property_value,
  coalesce((select sum(public.convert_amount(o.current_value, o.currency, pr.base_currency))
              from public.other_assets o where o.user_id = pr.id), 0)   as other_assets,
  coalesce((select sum(public.convert_amount(p.mortgage_balance, p.currency, pr.base_currency))
              from public.properties p where p.user_id = pr.id), 0)
  + coalesce((select sum(public.convert_amount(l.balance, l.currency, pr.base_currency))
              from public.liabilities l where l.user_id = pr.id), 0)    as liabilities,
  public.current_net_worth(pr.id)           as net_worth
from public.profiles pr;


-- =====================================================================
-- 09  ROW LEVEL SECURITY
--
--  Every user-owned table: enable RLS, then one policy per command
--  keyed on `auth.uid() = user_id`.  Nothing is publicly readable.
-- =====================================================================

do $$
declare
  t text;
  owned text[] := array[
    'accounts','recurring_expenses','income_sources','income_history',
    'investment_accounts','investments','investment_transactions',
    'target_allocations','investment_allocations','properties',
    'property_valuations','other_assets','liabilities','goals',
    'financial_phases','strategy_rules','strategy_priorities',
    'planned_expenses','net_worth_snapshots','portfolio_snapshots',
    'account_balance_snapshots','forecast_scenarios'
  ];
begin
  foreach t in array owned loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format('drop policy if exists "%1$s_select_own" on public.%1$I', t);
    execute format('drop policy if exists "%1$s_insert_own" on public.%1$I', t);
    execute format('drop policy if exists "%1$s_update_own" on public.%1$I', t);
    execute format('drop policy if exists "%1$s_delete_own" on public.%1$I', t);

    execute format(
      'create policy "%1$s_select_own" on public.%1$I
         for select to authenticated using (auth.uid() = user_id)', t);
    execute format(
      'create policy "%1$s_insert_own" on public.%1$I
         for insert to authenticated with check (auth.uid() = user_id)', t);
    execute format(
      'create policy "%1$s_update_own" on public.%1$I
         for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
    execute format(
      'create policy "%1$s_delete_own" on public.%1$I
         for delete to authenticated using (auth.uid() = user_id)', t);
  end loop;
end
$$;

-- ---- profiles (keyed on `id`, not `user_id`) ----------------------------
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_select_own" on public.profiles
  for select to authenticated using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
-- Deliberately no delete policy: profiles are removed by the auth.users cascade.

-- ---- categories: system rows are read-only shared reference data --------
alter table public.categories enable row level security;
alter table public.categories force row level security;

drop policy if exists "categories_select" on public.categories;
drop policy if exists "categories_insert_own" on public.categories;
drop policy if exists "categories_update_own" on public.categories;
drop policy if exists "categories_delete_own" on public.categories;

create policy "categories_select" on public.categories
  for select to authenticated using (is_system or auth.uid() = user_id);
create policy "categories_insert_own" on public.categories
  for insert to authenticated with check (auth.uid() = user_id and not is_system);
create policy "categories_update_own" on public.categories
  for update to authenticated using (auth.uid() = user_id and not is_system)
                            with check (auth.uid() = user_id and not is_system);
create policy "categories_delete_own" on public.categories
  for delete to authenticated using (auth.uid() = user_id and not is_system);

-- ---- exchange_rates: shared read-only reference data --------------------
alter table public.exchange_rates enable row level security;

drop policy if exists "exchange_rates_select" on public.exchange_rates;
create policy "exchange_rates_select" on public.exchange_rates
  for select to authenticated using (true);
-- No insert/update/delete policy: only the service role may refresh rates.

-- ---- Lock down the default grants --------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Views are queried, never written.
revoke insert, update, delete on
  public.financial_summary,
  public.current_net_worth_breakdown,
  public.portfolio_allocation,
  public.investment_positions,
  public.monthly_cash_flow,
  public.goal_progress,
  public.property_performance
from authenticated;

-- =====================================================================
--  End of schema.
-- =====================================================================
