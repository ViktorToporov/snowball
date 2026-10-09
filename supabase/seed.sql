-- =====================================================================
--  SNOWBALL — development seed data
--
--  ⚠️  ENTIRELY FICTIONAL SAMPLE DATA. It describes an invented
--      household ("Alex Delaney") and is nobody's real finances.
--      Do not run this against a production project.
--
--  Prerequisite: run `supabase/schema.sql` first.
--
--  Demo credentials
--    email     demo@snowball.app
--    password  snowball-demo
--
--  The script is idempotent: re-running it wipes and rebuilds the demo
--  user's data. It never touches any other user's rows.
--
--  This is the SQL twin of `src/app/core/data/demo-dataset.ts` — same
--  persona, same numbers — so the app tells one story with or without a
--  backend. The persona is chosen so every feature has something to
--  show:
--
--    · 24 months of balance and income history (so 3M/6M/1Y/ALL differ,
--      year-on-year income growth is computable, and the derived
--      spending figures have something to be derived from)
--
--  Note there is no transaction ledger: the user keeps balances and
--  holdings current and declares what recurs, and spending is inferred
--  from how the balances moved. See `monthly_cash_flow` in schema.sql.
--    · nine accounts, including physical cash *over* its ceiling, a USD
--      savings account, a ring-fenced property reserve and a credit card
--    · eight holdings across five asset types, two currencies, with a
--      loss-making position and a realised gain
--    · a household that **rents where it lives** (€1,650/month, an
--      ordinary essential expense) while **owning one let apartment**
--      with a mortgage on it (€1,450/month coming in) — so "rent I pay"
--      and "rent I receive" can never be confused for one another
--    · a car loan, so the debt factor in the security score bites
--    · Phase 1 complete, Phase 2 active, Phase 3 ready to activate
--    · goals in every state: achieved, on track and behind
--
--  Monthly variation comes from a deterministic pseudo-random formula
--  rather than random(), so re-running the seed reproduces it exactly.
-- =====================================================================

do $$
declare
  v_user           uuid;
  v_demo_email     text := 'demo@snowball.app';

  -- accounts
  a_current        uuid := gen_random_uuid();
  a_joint          uuid := gen_random_uuid();
  a_revolut        uuid := gen_random_uuid();
  a_savings        uuid := gen_random_uuid();
  a_t212_cash      uuid := gen_random_uuid();
  a_wallet         uuid := gen_random_uuid();
  a_usd            uuid := gen_random_uuid();
  a_reserve        uuid := gen_random_uuid();
  a_card           uuid := gen_random_uuid();

  -- brokers & holdings
  ia_t212          uuid := gen_random_uuid();
  ia_degiro        uuid := gen_random_uuid();
  ia_crypto        uuid := gen_random_uuid();
  inv_vwce         uuid := gen_random_uuid();
  inv_cspx         uuid := gen_random_uuid();
  inv_vagf         uuid := gen_random_uuid();
  inv_asml         uuid := gen_random_uuid();
  inv_eimi         uuid := gen_random_uuid();
  inv_pie          uuid := gen_random_uuid();
  inv_btc          uuid := gen_random_uuid();
  inv_tret         uuid := gen_random_uuid();

  -- other entities
  p_apartment      uuid := gen_random_uuid();
  src_salary       uuid := gen_random_uuid();
  src_rent         uuid := gen_random_uuid();
  src_bonus        uuid := gen_random_uuid();
  ph1              uuid := gen_random_uuid();
  ph2              uuid := gen_random_uuid();
  ph3              uuid := gen_random_uuid();
  cat_maintenance  uuid := gen_random_uuid();
  cat_gifts        uuid := gen_random_uuid();

  -- system category lookups
  c_mortgage       uuid;
  c_rent           uuid;
  c_groceries      uuid;
  c_utilities      uuid;
  c_insurance      uuid;
  c_transport      uuid;
  c_health         uuid;
  c_subs           uuid;

  -- ---- history generation -------------------------------------------
  n_months     constant int := 24;   -- complete months, ending last month
  rent_starts  constant int := 6;    -- month the apartment was first let
  raise_at     constant int := 14;   -- month the pay rise landed

  -- fixed monthly outgoings
  -- Rent on the flat they live in — deliberately a different figure from
  -- the €1,450 they receive on the let apartment.
  home_rent     constant numeric := 1650;
  apt_mortgage  constant numeric := 640;
  insurance_v   constant numeric := 95;
  healthcare_v  constant numeric := 65;
  subs_v        constant numeric := 48;

  usd_to_eur   constant numeric := 0.9216589862;

  m0        date := date_trunc('month', current_date)::date;
  i         int;
  v_month   date;
  v_end     date;

  salary_v      numeric;
  rent_v        numeric;
  bonus_v       numeric;
  groceries_v   numeric;
  utilities_v   numeric;
  transport_v   numeric;
  maint_v       numeric;
  flexible_v    numeric;
  contrib_v     numeric;
  reserve_v     numeric;
  essential_v   numeric;

  liquid_cash   numeric;
  total_net     numeric := 0;
  reserve_bal   numeric;
  contrib_total numeric;
  opening_spend numeric;

  pf_value      numeric;
  apt_mort      numeric;
  apt_val       numeric;
  car_val       numeric;
  pension_val   numeric;
  car_loan      numeric;
  card_bal      numeric;
  back          int;

  -- Deterministic "noise" in [0,1) — the SQL counterpart of the app's
  -- seeded PRNG. Same input, same output, every run.
  function_seed numeric;
begin
  -- -------------------------------------------------------------------
  -- 0. Resolve (or create) the demo auth user
  -- -------------------------------------------------------------------
  select id into v_user from auth.users where email = v_demo_email;

  if v_user is null then
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_user, 'authenticated', 'authenticated', v_demo_email,
      crypt('snowball-demo', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Alex Delaney"}'::jsonb,
      now() - interval '25 months', now()
    );

    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), v_user, v_user::text,
      jsonb_build_object('sub', v_user::text, 'email', v_demo_email, 'email_verified', true),
      'email', now(), now(), now()
    )
    on conflict do nothing;

    raise notice 'Created demo auth user % (%)', v_demo_email, v_user;
  else
    raise notice 'Reusing existing auth user % (%)', v_demo_email, v_user;
  end if;

  -- -------------------------------------------------------------------
  -- 1. Wipe any previous demo data (this user only)
  -- -------------------------------------------------------------------
  delete from public.investment_transactions     where user_id = v_user;
  delete from public.investment_allocations      where user_id = v_user;
  delete from public.investments                 where user_id = v_user;
  delete from public.investment_accounts         where user_id = v_user;
  delete from public.target_allocations          where user_id = v_user;
  delete from public.recurring_expenses          where user_id = v_user;
  delete from public.income_history              where user_id = v_user;
  delete from public.income_sources              where user_id = v_user;
  delete from public.account_balance_snapshots   where user_id = v_user;
  delete from public.accounts                    where user_id = v_user;
  delete from public.property_valuations         where user_id = v_user;
  delete from public.planned_expenses            where user_id = v_user;
  delete from public.goals                       where user_id = v_user;
  delete from public.liabilities                 where user_id = v_user;
  delete from public.properties                  where user_id = v_user;
  delete from public.other_assets                where user_id = v_user;
  delete from public.strategy_rules              where user_id = v_user;
  delete from public.strategy_priorities         where user_id = v_user;
  delete from public.financial_phases            where user_id = v_user;
  delete from public.net_worth_snapshots         where user_id = v_user;
  delete from public.portfolio_snapshots         where user_id = v_user;
  delete from public.forecast_scenarios          where user_id = v_user;
  delete from public.categories                  where user_id = v_user;

  -- -------------------------------------------------------------------
  -- 2. Profile
  -- -------------------------------------------------------------------
  insert into public.profiles (id, display_name, base_currency, locale,
                               emergency_fund_target, physical_cash_ceiling, theme, onboarded)
  values (v_user, 'Alex Delaney', 'EUR', 'en-IE', 21000, 300, 'system', true)
  on conflict (id) do update set
    display_name          = excluded.display_name,
    base_currency         = excluded.base_currency,
    locale                = excluded.locale,
    emergency_fund_target = excluded.emergency_fund_target,
    physical_cash_ceiling = excluded.physical_cash_ceiling,
    onboarded             = true;

  -- -------------------------------------------------------------------
  -- 3. Category lookups + two user-defined categories
  -- -------------------------------------------------------------------
  select id into c_mortgage      from public.categories where is_system and name = 'Mortgage';
  select id into c_rent          from public.categories where is_system and name = 'Rent';
  select id into c_groceries     from public.categories where is_system and name = 'Groceries';
  select id into c_utilities     from public.categories where is_system and name = 'Utilities';
  select id into c_insurance     from public.categories where is_system and name = 'Insurance';
  select id into c_transport     from public.categories where is_system and name = 'Transport';
  select id into c_health        from public.categories where is_system and name = 'Healthcare';
  select id into c_subs          from public.categories where is_system and name = 'Subscriptions';

  insert into public.categories (id, user_id, name, category_type, is_system, sort_order) values
    (cat_maintenance, v_user, 'Home maintenance', 'essential', false, 100),
    (cat_gifts,       v_user, 'Gifts & charity',  'flexible',  false, 101);

  -- -------------------------------------------------------------------
  -- 4. Accounts
  -- -------------------------------------------------------------------
  insert into public.accounts
    (id, user_id, name, account_type, institution, currency, balance, interest_rate,
     counts_as_liquid, counts_as_emergency_fund, target_balance, sort_order, notes)
  values
    (a_current,   v_user, 'Current Account',   'checking',       'Bank of Ireland', 'EUR',  3850.00, 0.0000,
     true,  false, null,     1, 'Salary and rent land here; standing orders leave from here.'),
    (a_joint,     v_user, 'Joint Household',   'checking',       'Bank of Ireland', 'EUR',  1240.00, 0.0000,
     true,  false, null,     2, 'Shared bills, groceries and the home mortgage.'),
    (a_revolut,   v_user, 'Revolut',           'ewallet',        'Revolut',         'EUR',   620.00, 0.0000,
     true,  false, null,     3, 'Day-to-day card spending and travel.'),
    (a_savings,   v_user, 'Emergency Savings', 'savings',        'Trade Republic',  'EUR', 13600.00, 0.0310,
     true,  true,  14000.00, 4, 'Instant access at 3.10% — the bulk of the emergency fund.'),
    (a_t212_cash, v_user, 'Trading 212 Cash',  'brokerage_cash', 'Trading 212',     'EUR',  7600.00, 0.0240,
     true,  true,   7000.00, 5, 'Uninvested cash at 2.40% APY. Variable rate.'),
    (a_wallet,    v_user, 'Physical Cash',     'physical_cash',  null,              'EUR',   420.00, 0.0000,
     true,  false,   300.00, 6, 'Ceiling is €300 — currently over it.'),
    (a_usd,       v_user, 'USD Savings',       'savings',        'Wise',            'USD',  2400.00, 0.0420,
     true,  false, null,     7, 'Held in dollars for US travel. Converted at the stored EUR/USD rate.'),
    (a_reserve,   v_user, 'Property Reserve',  'savings',        'Trade Republic',  'EUR',  9795.00, 0.0260,
     false, false, 12000.00, 8, 'Ring-fenced rental surplus, building toward a €12,000 target. Deliberately excluded from liquid cash.'),
    (a_card,      v_user, 'Visa Credit Card',  'credit_card',    'Bank of Ireland', 'EUR',  1180.00, 0.0000,
     false, false, null,     9, 'Cleared in full each month.');

  -- -------------------------------------------------------------------
  -- 5. Properties
  -- -------------------------------------------------------------------
  insert into public.properties
    (id, user_id, name, address, currency, estimated_value, purchase_price, purchase_date,
     mortgage_balance, mortgage_interest_rate, monthly_payment, remaining_months,
     rental_status, monthly_rent, monthly_property_expenses,
     maintenance_reserve, maintenance_reserve_target, annual_appreciation,
     expected_rent_start, notes)
  values
    (p_apartment, v_user, 'Riverside Apartment', '1-bed apartment, city centre', 'EUR',
     242000.00, 195000.00, (m0 - interval '96 months')::date,
     118400.00, 0.0285, apt_mortgage, 216,
     'rented', 1450.00, 265.00, 9795.00, 12000.00, 0.022,
     (m0 - ((n_months - rent_starts) || ' months')::interval)::date,
     'The only property owned. Alex rents a flat to live in and lets this one out. Rent covers the '
     'mortgage and running costs first; the €545/month surplus is swept into the Property Reserve '
     'rather than treated as lifestyle income.');

  -- -------------------------------------------------------------------
  -- 6. Income sources, other assets and liabilities
  --    (income references the apartment, so properties come first)
  -- -------------------------------------------------------------------
  insert into public.income_sources
    (id, user_id, name, income_type, amount, gross_amount, currency, frequency,
     account_id, property_id, start_date, active, annual_growth, notes)
  values
    (src_salary, v_user, 'Net Salary', 'salary', 5400.00, 7668.00, 'EUR', 'monthly',
     a_current, null, (m0 - interval '72 months')::date, true, 0.035,
     'Paid on the 26th. Rise applied 10 months ago (€4,850 → €5,400).'),
    (src_rent, v_user, 'Riverside Apartment rent', 'rental', 1450.00, null, 'EUR', 'monthly',
     a_current, p_apartment, (m0 - ((n_months - rent_starts) || ' months')::interval)::date, true, 0.020,
     'Ring-fenced: the surplus over mortgage and costs goes to the Property Reserve.'),
    (src_bonus, v_user, 'Annual Bonus', 'bonus', 4600.00, 8200.00, 'EUR', 'annual',
     a_current, null, (m0 - interval '48 months')::date, true, 0.000,
     'Paid each spring. Variable — treated conservatively in forecasts.');

  insert into public.other_assets
    (user_id, name, asset_kind, current_value, currency, purchase_value, annual_depreciation, is_liquid, notes)
  values
    (v_user, 'Car — 2021 estate', 'vehicle', 18400.00, 'EUR', 28500.00, 0.110, false,
     'Sample data. Re-estimated annually.'),
    (v_user, 'Workplace Pension', 'pension', 62300.00, 'EUR', null, 0.000, false,
     'Employer scheme. Not accessible before retirement, so never counted as liquid.');

  insert into public.liabilities
    (user_id, name, liability_kind, balance, currency, interest_rate, monthly_payment, remaining_months, notes)
  values
    (v_user, 'Car Loan', 'car_loan', 9850.00, 'EUR', 0.059, 245.00, 44,
     'Fixed-rate PCP, cleared in just under four years.');

  -- -------------------------------------------------------------------
  -- 6b. Recurring expenses — the declared cost of living
  --
  --  This is the whole of what the user types in about spending.
  --  Everything else is inferred from how the balances moved.
  -- -------------------------------------------------------------------
  insert into public.recurring_expenses
    (user_id, name, amount, currency, category_id, account_id, property_id, frequency, start_date, active, notes)
  values
    (v_user, 'Rent — the flat we live in',    1650.00, 'EUR', c_rent,          a_joint,   null,        'monthly', (m0 - interval '24 months')::date, true,
     'Two-bed, paid on the 1st. Not owned — this is an expense, not an asset.'),
    (v_user, 'Riverside Apartment mortgage',   640.00, 'EUR', c_mortgage,      a_current, p_apartment, 'monthly', (m0 - interval '24 months')::date, true,
     'Covered by the tenant''s rent; see the Property page.'),
    (v_user, 'Groceries',                      625.00, 'EUR', c_groceries,     a_joint,   null,        'monthly', (m0 - interval '24 months')::date, true,
     'Averaged across the weekly shop.'),
    (v_user, 'Electricity, gas & broadband',   190.00, 'EUR', c_utilities,     a_joint,   null,        'monthly', (m0 - interval '24 months')::date, true,
     'Seasonal — this is the twelve-month average.'),
    (v_user, 'Commuting',                      148.00, 'EUR', c_transport,     a_current, null,        'monthly', (m0 - interval '24 months')::date, true,
     'Fuel and the Leap card.'),
    (v_user, 'Home & contents insurance',       95.00, 'EUR', c_insurance,     a_joint,   null,        'monthly', (m0 - interval '24 months')::date, true, null),
    (v_user, 'Health cover',                    65.00, 'EUR', c_health,        a_current, null,        'monthly', (m0 - interval '24 months')::date, true, null),
    (v_user, 'Streaming, cloud & phone',        48.00, 'EUR', c_subs,          a_current, null,        'monthly', (m0 - interval '24 months')::date, true, null),
    (v_user, 'Repairs and upkeep',             780.00, 'EUR', cat_maintenance, a_joint,   null,        'annual',  (m0 - interval '24 months')::date, true,
     'Lumpy in practice — declared annually so it still lands in the baseline.'),
    (v_user, 'Car loan repayment',             245.00, 'EUR', c_transport,     a_current, null,        'monthly', (m0 - interval '24 months')::date, true,
     'Fixed-rate PCP, 44 months left.');

  -- -------------------------------------------------------------------
  -- 7. Investments
  -- -------------------------------------------------------------------
  insert into public.investment_accounts (id, user_id, name, broker, currency, notes) values
    (ia_t212,   v_user, 'Trading 212 — Invest', 'Trading 212', 'EUR', 'Core ETF holdings and the pie.'),
    (ia_degiro, v_user, 'Degiro',               'Degiro',      'EUR', 'Individual shares and the USD-denominated tracker.'),
    (ia_crypto, v_user, 'Coinbase',             'Coinbase',    'EUR', 'Small satellite allocation.');

  insert into public.investments
    (id, user_id, investment_account_id, name, ticker, isin, asset_type,
     quantity, average_cost, current_price, currency, region, sector,
     expense_ratio, realised_gain, price_updated_at, notes)
  values
    (inv_vwce, v_user, ia_t212, 'Vanguard FTSE All-World UCITS ETF (Acc)', 'VWCE', 'IE00BK5BQT80', 'etf',
     210.000000, 108.400000, 124.750000, 'EUR', 'Global', 'Broad market', 0.0022, 0.00, now(),
     'The core holding. Split across four allocation buckets by index weight.'),
    (inv_cspx, v_user, ia_degiro, 'iShares Core S&P 500 UCITS ETF', 'CSPX', 'IE00B5BMR087', 'etf',
     22.000000, 452.100000, 528.300000, 'USD', 'US Equities', 'Broad market', 0.0007, 0.00, now(),
     'Priced in dollars — converted to euro for every total in the app.'),
    (inv_vagf, v_user, ia_t212, 'Vanguard Global Aggregate Bond UCITS ETF', 'VAGF', 'IE00BG47KH54', 'bond',
     480.000000, 24.100000, 23.550000, 'EUR', 'Global', 'Fixed income', 0.0010, 0.00, now(),
     'Currently below cost — the ballast, not the engine.'),
    (inv_asml, v_user, ia_degiro, 'ASML Holding N.V.', 'ASML', 'NL0010273215', 'stock',
     12.000000, 612.500000, 688.200000, 'EUR', 'Developed ex-US', 'Technology', null, 0.00, now(),
     'Single-stock position — deliberately capped at a small share.'),
    (inv_eimi, v_user, ia_t212, 'iShares Core MSCI EM IMI UCITS ETF', 'EIMI', 'IE00BKM4GZ66', 'etf',
     320.000000, 31.800000, 33.450000, 'EUR', 'Emerging Markets', 'Broad market', 0.0018, 1240.00, now(),
     'Trimmed once already — the realised gain is recorded against this holding.'),
    (inv_pie, v_user, ia_t212, 'Diversified Pie', null, null, 'etf',
     3200.000000, 1.420000, 1.635000, 'EUR', 'Global', 'Broad market', 0.0019, 0.00, now(),
     'A Trading 212 pie: 40% S&P 500 · 25% Developed World · 20% Emerging · 15% Pacific.'),
    (inv_btc, v_user, ia_crypto, 'Bitcoin', 'BTC', null, 'crypto',
     0.085000, 41200.000000, 58900.000000, 'EUR', 'Global', 'Digital assets', null, 0.00, now(),
     'Satellite position. Volatile by design; capped at a few percent.'),
    (inv_tret, v_user, ia_degiro, 'VanEck Global Real Estate UCITS ETF', 'TRET', 'NL0009690239', 'reit',
     95.000000, 34.200000, 32.100000, 'EUR', 'Global', 'Real estate', 0.0025, 0.00, now(),
     'Listed property exposure, separate from the two physical properties.');

  -- A holding can span several buckets — that is how a "pie" maps onto a
  -- strategic model without being split into separate positions.
  insert into public.investment_allocations (user_id, investment_id, bucket, weight) values
    (v_user, inv_vwce, 'US Equities',      62),
    (v_user, inv_vwce, 'Developed ex-US',  22),
    (v_user, inv_vwce, 'Emerging Markets', 11),
    (v_user, inv_vwce, 'Pacific',           5),
    (v_user, inv_cspx, 'US Equities',     100),
    (v_user, inv_vagf, 'Bonds & Cash',    100),
    (v_user, inv_asml, 'Developed ex-US', 100),
    (v_user, inv_eimi, 'Emerging Markets',100),
    (v_user, inv_pie,  'US Equities',      40),
    (v_user, inv_pie,  'Developed ex-US',  25),
    (v_user, inv_pie,  'Emerging Markets', 20),
    (v_user, inv_pie,  'Pacific',          15),
    (v_user, inv_btc,  'Alternatives',    100),
    (v_user, inv_tret, 'Property & REITs',100);

  insert into public.target_allocations (user_id, bucket, target_percentage, tolerance_band, sort_order) values
    (v_user, 'US Equities',      45, 5, 1),
    (v_user, 'Developed ex-US',  20, 5, 2),
    (v_user, 'Emerging Markets', 12, 4, 3),
    (v_user, 'Pacific',           5, 3, 4),
    (v_user, 'Bonds & Cash',     12, 4, 5),
    (v_user, 'Property & REITs',  3, 2, 6),
    (v_user, 'Alternatives',      3, 3, 7);

  -- Opening positions, bought before the 24-month window.
  insert into public.investment_transactions
    (user_id, investment_id, transaction_type, quantity, price, amount, fees, currency, transaction_date, notes)
  values
    (v_user, inv_vwce, 'buy',  120.000000,   101.200000, 12144.00,  0.00, 'EUR', (m0 - interval '25 months')::date, 'Opening position'),
    (v_user, inv_cspx, 'buy',   22.000000,   452.100000,  9946.20,  0.00, 'USD', (m0 - interval '25 months')::date, 'Opening position'),
    (v_user, inv_vagf, 'buy',  345.000000,    24.300000,  8383.50,  0.00, 'EUR', (m0 - interval '25 months')::date, 'Opening position'),
    (v_user, inv_eimi, 'buy',  225.000000,    30.000000,  6750.00,  0.00, 'EUR', (m0 - interval '25 months')::date, 'Opening position'),
    (v_user, inv_pie,  'buy', 2160.000000,     1.360000,  2937.60,  0.00, 'EUR', (m0 - interval '25 months')::date, 'Opening the pie'),
    (v_user, inv_asml, 'buy',   12.000000,   612.500000,  7350.00, 12.00, 'EUR', (m0 - interval '25 months')::date, 'Opening position'),
    (v_user, inv_btc,  'buy',    0.085000, 41200.000000,  3502.00, 21.00, 'EUR', (m0 - interval '25 months')::date, 'Small satellite position'),
    (v_user, inv_tret, 'buy',   95.000000,    34.200000,  3249.00,  0.00, 'EUR', (m0 - interval '25 months')::date, 'Opening position');

  opening_spend := 12144.00 + round(9946.20 * usd_to_eur, 2) + 8383.50 + 6750.00 + 2937.60 + 7350.00 + 3502.00 + 3249.00;

  -- -------------------------------------------------------------------
  -- 8. Phases, rules and priorities
  -- -------------------------------------------------------------------
  insert into public.financial_phases
    (id, user_id, name, phase_order, active, objective, description, entry_condition, exit_condition, completed_at)
  values
    (ph1, v_user, 'Financial Security', 1, false,
     'Build liquid cash to €21,000 — six months of essential outgoings, rent included.',
     'Prioritise cash accumulation. No required new investment contributions; existing investments stay invested. '
     'Flexible spending is allowed, funded from cash above the security floor. Now complete — the floor is a hard '
     'limit and is not spent back below target.',
     '{}'::jsonb, '{"type":"emergency_fund_reached","target":21000}'::jsonb,
     (now() - interval '2 months')),
    (ph2, v_user, 'Wealth Building', 2, true,
     'Turn monthly surplus into invested assets at the target allocation.',
     'Active since the emergency fund filled. €900/month goes into the target allocation, the cash reserve is held '
     'at the floor, and flexible spending runs off the surplus above it.',
     '{"type":"emergency_fund_reached","target":21000}'::jsonb, '{"type":"manual"}'::jsonb, null),
    (ph3, v_user, 'Property Optimisation', 3, false,
     'Make the apartment self-funding and build a €12,000 property reserve.',
     'The tenancy has started, so this phase can be activated. The mortgage continues normally, rent pays the '
     'mortgage and running costs, and the surplus accumulates in the Property Reserve.',
     '{"type":"rental_income_started"}'::jsonb, '{"type":"manual"}'::jsonb, null);

  insert into public.strategy_rules
    (user_id, phase_id, rule_type, name, description, target_value, target_percentage, priority, enabled, configuration)
  values
    (v_user, ph2, 'emergency_fund', 'Emergency Fund Floor',
     'Hold €21,000 in instant-access cash. Once reached the floor is hard — it is not spent back down.',
     21000, null, 1, true, '{"counts":"emergency_accounts","floor_is_hard":true}'::jsonb),
    (v_user, ph2, 'investment', 'Monthly Contribution',
     'Invest €900/month into the target allocation, on the 28th, before any flexible spending.',
     900, null, 2, true, '{"minimum_monthly":900}'::jsonb),
    (v_user, ph2, 'allocation', 'Target Allocation',
     'Hold the strategic allocation within its tolerance bands; rebalance with new contributions before selling.',
     null, null, 3, true, '{"rebalance_with_contributions_first":true}'::jsonb),
    (v_user, ph2, 'lifestyle', 'Lifestyle Rule',
     'No fixed monthly discretionary limit. Flexible spending is funded from cash above the security floor.',
     null, null, 4, true, '{"mode":"above_security_floor"}'::jsonb),
    (v_user, ph2, 'savings_rate', 'Savings Rate Floor',
     'Keep the three-month average savings rate at or above 25% of income.',
     null, 25, 5, true, '{}'::jsonb),
    (v_user, ph2, 'property', 'Property Rule',
     'Rental income above the mortgage and property expenses goes to the Property Reserve, never to lifestyle spending.',
     12000, null, 6, true, '{"route_surplus_to":"property_reserve","reserve_target":12000}'::jsonb),
    (v_user, ph2, 'cash_ceiling', 'Physical Cash Ceiling',
     'Keep no more than €300 in physical cash; the rest belongs somewhere it earns interest.',
     300, null, 7, true, '{"account_type":"physical_cash"}'::jsonb),
    (v_user, ph2, 'debt', 'No New Consumer Debt',
     'Clear the credit card in full monthly. The car loan runs to term rather than being overpaid.',
     0, null, 8, true, '{"exclude":["mortgage","car_loan"]}'::jsonb),
    (v_user, ph3, 'property', 'Property Reserve Target',
     'Build a €12,000 property reserve from rental surplus before treating any rent as personal income.',
     12000, null, 1, true, '{"reserve_target":12000}'::jsonb);

  insert into public.strategy_priorities (user_id, name, rank, allocation_percentage, description) values
    (v_user, 'Wealth building',    1, 55, 'The €900/month contribution, plus any surplus above the floor at year end.'),
    (v_user, 'Financial security', 2, 20, 'Hold the €21,000 floor and top it back up after any drawdown.'),
    (v_user, 'Lifestyle & travel', 3, 15, 'Flexible spending funded from cash above the floor. No fixed monthly limit.'),
    (v_user, 'Property reserve',   4, 10, 'Rental surplus, ring-fenced for repairs and void periods.');

  -- -------------------------------------------------------------------
  -- 9. Goals — deliberately covering achieved, on-track and behind
  -- -------------------------------------------------------------------
  insert into public.goals
    (user_id, name, goal_type, target_amount, current_amount, currency, target_date,
     priority, status, account_id, monthly_contribution, track_account_balance, notes)
  values
    (v_user, 'Emergency Fund', 'emergency_fund', 18000.00, 18100.00, 'EUR', (m0 - interval '2 months')::date,
     'critical', 'achieved', a_savings, 0.00, false,
     'Completed two months ago — six months of essential expenses. Phase 1 is done.'),
    (v_user, 'Japan Trip', 'travel', 6500.00, 4150.00, 'EUR', (m0 + interval '4 months')::date,
     'medium', 'active', a_revolut, 620.00, false,
     'Three weeks in spring. Funded from cash above the security floor.'),
    (v_user, 'Deposit — a place to live', 'property', 50000.00, 12400.00, 'EUR', (m0 + interval '48 months')::date,
     'high', 'active', null, 500.00, false,
     'The household rents its home. This is the deposit to stop renting — kept separate from the let '
     'apartment, which is an investment rather than somewhere to live. Behind schedule.'),
    (v_user, 'Replace the Car', 'vehicle', 22000.00, 5400.00, 'EUR', (m0 + interval '30 months')::date,
     'low', 'active', null, 600.00, false,
     'Clear the current loan first, then trade up.'),
    (v_user, 'Portfolio to €250,000', 'investment', 250000.00, 80464.00, 'EUR', (m0 + interval '96 months')::date,
     'medium', 'active', null, 900.00, false,
     'The Phase 2 objective, at the current €900/month contribution.'),
    (v_user, 'Financial Independence', 'financial_independence', 1100000.00, 313071.00, 'EUR', null,
     'low', 'active', null, 0.00, false,
     'Long-horizon marker: 25× projected annual expenses. Progress tracks net worth.');

  -- -------------------------------------------------------------------
  -- 10. Planned expenses
  -- -------------------------------------------------------------------
  insert into public.planned_expenses
    (user_id, name, amount, saved_amount, currency, target_date, priority, category, status, account_id, property_id, notes)
  values
    (v_user, 'Apartment — boiler service',   190.00,    0.00, 'EUR', (m0 + interval  '1 month')::date,  'medium', 'Home maintenance', 'planned', a_joint,   p_apartment, 'Landlord obligation on the let apartment. Paid from the Property Reserve.'),
    (v_user, 'Dental work',                 480.00,  480.00, 'EUR', (m0 + interval  '2 months')::date, 'medium', 'Healthcare',       'funded',  a_current, null,        'Fully set aside.'),
    (v_user, 'Car insurance renewal',       740.00,  300.00, 'EUR', (m0 + interval  '2 months')::date, 'high',   'Insurance',        'funding', a_current, null,        'Renews in February.'),
    (v_user, 'Japan — flights & hotels',   3400.00, 2100.00, 'EUR', (m0 + interval  '3 months')::date, 'high',   'Travel',           'funding', a_revolut, null,        'Booked well ahead of the trip itself.'),
    (v_user, 'Apartment — tenant turnover',1250.00,    0.00, 'EUR', (m0 + interval  '5 months')::date, 'medium', 'Property',         'planned', null,      p_apartment, 'Paint, clean and letting fee between tenancies. Comes out of the Property Reserve.'),
    (v_user, 'Laptop replacement',         2300.00,  800.00, 'EUR', (m0 + interval  '7 months')::date, 'low',    'Electronics',      'funding', null,      null,        'Current machine is five years old.'),
    (v_user, 'Apartment — kitchen refresh', 5000.00,    0.00, 'EUR', (m0 + interval '10 months')::date, 'medium', 'Property',         'planned', null,      p_apartment, 'Refit before the next tenancy, to support a higher rent.');

  -- -------------------------------------------------------------------
  -- 11. Forecast scenarios
  -- -------------------------------------------------------------------
  insert into public.forecast_scenarios
    (user_id, name, kind, is_default, salary_growth, inflation, investment_return, cash_interest,
     property_appreciation, monthly_investment, monthly_flexible_spending,
     include_rental_income, include_planned_expenses, horizon_years, notes)
  values
    (v_user, 'Conservative', 'conservative', false, 0.015, 0.032, 0.040, 0.012, 0.010,  600.00, 2100.00, true, true, 30,
     'Lower returns, higher inflation, a void period on the apartment and no real pay rises.'),
    (v_user, 'Base case',    'base',         true,  0.035, 0.021, 0.068, 0.024, 0.022,  900.00, 1850.00, true, true, 30,
     'Long-run nominal assumptions, in line with the current strategy rules.'),
    (v_user, 'Optimistic',   'optimistic',   false, 0.050, 0.020, 0.088, 0.031, 0.035, 1400.00, 1650.00, true, true, 30,
     'Promotion inside two years, strong markets, rent rising with the market.');

  -- ===================================================================
  -- 12. HISTORY — 24 complete months
  -- ===================================================================

  -- First pass: total the net cash movement so the opening balance lands
  -- liquid cash exactly on €26,900 at the end of the last complete month.
  for i in 1..n_months loop
    function_seed := abs(sin(i * 12.9898) * 43758.5453);
    function_seed := function_seed - floor(function_seed);

    salary_v    := case when i <= raise_at then 4850 else 5400 end;
    rent_v      := case when i <= rent_starts then 0 when i <= raise_at then 1380 else 1450 end;
    bonus_v     := case when i = 9 then 4200 when i = 21 then 4600 else 0 end;
    groceries_v := round(560 + function_seed * 130);
    utilities_v := round(175 + 55 * cos(2 * pi() * extract(month from (m0 - ((n_months - i + 1) || ' months')::interval)) / 12) + function_seed * 30);
    transport_v := round(115 + function_seed * 65);
    maint_v     := case when function_seed < 0.3 then round(90 + function_seed * 260) else 0 end;
    flexible_v  := round(
                     (case when i <= rent_starts then 950 when i <= raise_at then 1250 else 1650 end)
                     + (case when i in (11, 22) then 1500 else 0 end)
                     + (function_seed - 0.5) * 520);
    contrib_v   := case when i <= rent_starts then 600 else 900 end;
    reserve_v   := case when i <= rent_starts then 0 when i <= raise_at then 475 else 545 end;
    essential_v := home_rent + apt_mortgage + insurance_v + healthcare_v + subs_v
                   + groceries_v + utilities_v + transport_v + maint_v;

    total_net := total_net + salary_v + rent_v + bonus_v - essential_v - flexible_v - contrib_v - reserve_v;
  end loop;

  liquid_cash   := 30100 - total_net;
  reserve_bal   := 0;
  contrib_total := opening_spend;

  for i in 1..n_months loop
    -- index 1 → 24 months ago; index n_months → last month
    v_month := (m0 - ((n_months - i + 1) || ' months')::interval)::date;
    v_end   := (v_month + interval '1 month - 1 day')::date;

    function_seed := abs(sin(i * 12.9898) * 43758.5453);
    function_seed := function_seed - floor(function_seed);

    salary_v    := case when i <= raise_at then 4850 else 5400 end;
    rent_v      := case when i <= rent_starts then 0 when i <= raise_at then 1380 else 1450 end;
    bonus_v     := case when i = 9 then 4200 when i = 21 then 4600 else 0 end;
    groceries_v := round(560 + function_seed * 130);
    utilities_v := round(175 + 55 * cos(2 * pi() * extract(month from v_month) / 12) + function_seed * 30);
    transport_v := round(115 + function_seed * 65);
    maint_v     := case when function_seed < 0.3 then round(90 + function_seed * 260) else 0 end;
    flexible_v  := round(
                     (case when i <= rent_starts then 950 when i <= raise_at then 1250 else 1650 end)
                     + (case when i in (11, 22) then 1500 else 0 end)
                     + (function_seed - 0.5) * 520);
    contrib_v   := case when i <= rent_starts then 600 else 900 end;
    reserve_v   := case when i <= rent_starts then 0 when i <= raise_at then 475 else 545 end;
    essential_v := home_rent + apt_mortgage + insurance_v + healthcare_v + subs_v
                   + groceries_v + utilities_v + transport_v + maint_v;

    contrib_total := contrib_total + contrib_v;
    if i = 15 then contrib_total := contrib_total - 1926; end if;   -- the realised sale

    liquid_cash := liquid_cash + salary_v + rent_v + bonus_v - essential_v - flexible_v - contrib_v - reserve_v;
    reserve_bal := reserve_bal + reserve_v;

    -- ---- income history (the only ledger Snowball keeps) --------------
    insert into public.income_history (user_id, income_source_id, period_month, net_amount, gross_amount, currency)
    values (v_user, src_salary, v_month, salary_v + bonus_v, round((salary_v + bonus_v) * 1.42, 2), 'EUR');

    if rent_v > 0 then
      insert into public.income_history (user_id, income_source_id, period_month, net_amount, currency)
      values (v_user, src_rent, v_month, rent_v, 'EUR');
    end if;

    -- ---- account balance snapshots ------------------------------------
    -- Shares match today's split across the liquid accounts.
    insert into public.account_balance_snapshots (user_id, account_id, snapshot_date, balance) values
      (v_user, a_current,   v_end, round(liquid_cash * 0.1303, 2)),
      (v_user, a_joint,     v_end, round(liquid_cash * 0.0420, 2)),
      (v_user, a_revolut,   v_end, round(liquid_cash * 0.0210, 2)),
      (v_user, a_savings,   v_end, round(liquid_cash * 0.4604, 2)),
      (v_user, a_t212_cash, v_end, round(liquid_cash * 0.2572, 2)),
      (v_user, a_wallet,    v_end, round(liquid_cash * 0.0142, 2)),
      (v_user, a_usd,       v_end, round(liquid_cash * 0.0749, 2)),
      (v_user, a_reserve,   v_end, round(greatest(0, reserve_bal), 2))
    on conflict do nothing;

    -- ---- portfolio ------------------------------------------------------
    pf_value := round(contrib_total * (1.012 + (i::numeric / n_months) * 0.09 + (function_seed - 0.5) * 0.05), 2);
    if i = n_months then
      pf_value := round(80463.97 * 0.985, 2);   -- last month end, just below today
    end if;

    insert into public.portfolio_snapshots
      (user_id, snapshot_date, total_value, total_contributions, total_gain, currency)
    values
      (v_user, v_end, pf_value, round(contrib_total, 2), round(pf_value - contrib_total, 2), 'EUR')
    on conflict do nothing;

    -- Monthly buys: VWCE-led early on, three-way once Phase 2 begins.
    if i <= rent_starts then
      insert into public.investment_transactions
        (user_id, investment_id, transaction_type, quantity, price, amount, fees, currency, transaction_date, notes)
      values
        (v_user, inv_vwce, 'buy', round(contrib_v * 0.6 / (108 + i * 0.7), 6), round(108 + i * 0.7, 6),
         round(contrib_v * 0.6, 2), 0.00, 'EUR', (v_month + interval '27 days')::date, 'Monthly contribution'),
        (v_user, inv_pie,  'buy', round(contrib_v * 0.4 / (1.38 + i * 0.004), 6), round(1.38 + i * 0.004, 6),
         round(contrib_v * 0.4, 2), 0.00, 'EUR', (v_month + interval '27 days')::date, 'Monthly pie contribution');
    else
      insert into public.investment_transactions
        (user_id, investment_id, transaction_type, quantity, price, amount, fees, currency, transaction_date, notes)
      values
        (v_user, inv_vwce, 'buy', round(contrib_v * 0.5 / (108 + i * 0.7), 6), round(108 + i * 0.7, 6),
         round(contrib_v * 0.5, 2), 0.00, 'EUR', (v_month + interval '27 days')::date, 'Monthly contribution'),
        (v_user, inv_eimi, 'buy', round(contrib_v * 0.3 / (30.4 + i * 0.08), 6), round(30.4 + i * 0.08, 6),
         round(contrib_v * 0.3, 2), 0.00, 'EUR', (v_month + interval '27 days')::date, 'Monthly contribution'),
        (v_user, inv_vagf, 'buy', round(contrib_v * 0.2 / (24.6 - i * 0.02), 6), round(24.6 - i * 0.02, 6),
         round(contrib_v * 0.2, 2), 0.00, 'EUR', (v_month + interval '27 days')::date, 'Monthly contribution');
    end if;

    if i % 3 = 0 then
      insert into public.investment_transactions
        (user_id, investment_id, transaction_type, quantity, price, amount, fees, currency, transaction_date, notes)
      values
        (v_user, inv_vagf, 'dividend', 0, 0, round(70 + function_seed * 45, 2), 0.00, 'EUR',
         (v_month + interval '17 days')::date, 'Quarterly bond distribution');
    end if;

    if i in (5, 17) then
      insert into public.investment_transactions
        (user_id, investment_id, transaction_type, quantity, price, amount, fees, currency, transaction_date, notes)
      values
        (v_user, inv_asml, 'fee', 0, 0, round(9 + function_seed * 6, 2), 0.00, 'EUR',
         (v_month + interval '27 days')::date, 'Custody fee');
    end if;

    -- The trim that produced the realised gain.
    if i = 15 then
      insert into public.investment_transactions
        (user_id, investment_id, transaction_type, quantity, price, amount, fees, currency, transaction_date, notes)
      values
        (v_user, inv_eimi, 'sell', 60.000000, 32.100000, 1926.00, 3.50, 'EUR',
         (v_month + interval '20 days')::date, 'Trimmed emerging markets after a run-up');
    end if;

    -- ---- property valuations & net worth ---------------------------------
    back        := n_months - i + 1;
    apt_mort    := round(118400 + back * 359, 2);
    apt_val     := round(242000 - back * 440, 2);
    car_val     := round(18400 + back * 185, 2);
    pension_val := round(62300 - back * 680, 2);
    car_loan    := round(9850 + back * 225, 2);
    card_bal    := round(900 + function_seed * 700, 2);

    insert into public.property_valuations
      (user_id, property_id, valuation_date, estimated_value, mortgage_balance, source)
    values
      (v_user, p_apartment, v_end, apt_val, apt_mort, 'estimate')
    on conflict do nothing;

    insert into public.net_worth_snapshots
      (user_id, snapshot_date, cash_value, investment_value, property_value, other_assets, liabilities, net_worth, currency)
    values
      (v_user, v_end,
       round(liquid_cash + greatest(0, reserve_bal), 2), pf_value,
       apt_val, round(car_val + pension_val, 2),
       round(apt_mort + car_loan + card_bal, 2),
       round(liquid_cash + greatest(0, reserve_bal) + pf_value + apt_val
             + car_val + pension_val - apt_mort - car_loan - card_bal, 2),
       'EUR')
    on conflict do nothing;
  end loop;

  -- -------------------------------------------------------------------
  -- 13. The current, partly-elapsed month
  --
  --  Only lines whose day has already passed are recorded, so the month
  --  reads as genuinely partial. The strategy engine excludes it from
  --  the savings-rate window for exactly that reason.
  -- -------------------------------------------------------------------
  -- Income only counts once it has actually landed.
  if current_date >= (m0 + interval '3 days')::date then
    insert into public.income_history (user_id, income_source_id, period_month, net_amount, currency)
    values (v_user, src_rent, m0, 1450, 'EUR') on conflict do nothing;
  end if;

  if current_date >= (m0 + interval '25 days')::date then
    insert into public.income_history (user_id, income_source_id, period_month, net_amount, gross_amount, currency)
    values (v_user, src_salary, m0, 5400, round(5400 * 1.42, 2), 'EUR') on conflict do nothing;
  end if;

  -- -------------------------------------------------------------------
  -- 14. Today's marks, so every chart ends on the live figures
  -- -------------------------------------------------------------------
  insert into public.net_worth_snapshots
    (user_id, snapshot_date, cash_value, investment_value, property_value, other_assets, liabilities, net_worth, currency)
  values
    (v_user, current_date, 39336.98, 80463.97, 242000.00, 80700.00, 129430.00, 313070.95, 'EUR')
  on conflict (user_id, snapshot_date) do update set
    cash_value = excluded.cash_value, investment_value = excluded.investment_value,
    property_value = excluded.property_value, other_assets = excluded.other_assets,
    liabilities = excluded.liabilities, net_worth = excluded.net_worth;

  insert into public.portfolio_snapshots
    (user_id, snapshot_date, total_value, total_contributions, total_gain, currency)
  values
    (v_user, current_date, 80463.97, round(contrib_total, 2), round(80463.97 - contrib_total, 2), 'EUR')
  on conflict (user_id, snapshot_date) do update set
    total_value = excluded.total_value, total_contributions = excluded.total_contributions,
    total_gain = excluded.total_gain;

  insert into public.account_balance_snapshots (user_id, account_id, snapshot_date, balance) values
    (v_user, a_current,   current_date,  3850.00),
    (v_user, a_joint,     current_date,  1240.00),
    (v_user, a_revolut,   current_date,   620.00),
    (v_user, a_savings,   current_date, 13600.00),
    (v_user, a_t212_cash, current_date,  7600.00),
    (v_user, a_wallet,    current_date,   420.00),
    (v_user, a_usd,       current_date,  2211.98),
    (v_user, a_reserve,   current_date,  9795.00)
  on conflict (account_id, snapshot_date) do update set balance = excluded.balance;

  raise notice 'Snowball demo data seeded for % — sign in with %/snowball-demo', v_user, v_demo_email;
end
$$;

-- =====================================================================
--  End of seed.
-- =====================================================================
