# Snowball

### Keep the dough rolling.

A personal finance and wealth-strategy application. Snowball is not an expense
tracker with charts bolted on — it is built to answer three questions on every
screen:

> **Am I financially secure, am I getting richer, and am I following my plan?**

Built with **Angular 20** (standalone components, signals, lazy routes) and
**Supabase** (PostgreSQL, Auth, Row Level Security).

---

## Contents

- [Quick start](#quick-start)
- [Supabase setup](#supabase-setup)
- [Deploying](#deploying)
- [What's in the box](#whats-in-the-box)
- [Architecture](#architecture)
- [Financial model](#financial-model)
- [Database](#database)
- [Design system](#design-system)
- [Scripts](#scripts)
- [Security notes](#security-notes)

---

## Quick start

```bash
npm install
npm start
```

Open <http://localhost:4200>.

With no Supabase credentials configured, Snowball starts in **demo mode**: a
complete sample dataset is generated in the browser. Every feature works — edits
persist to `localStorage`, and **Settings → Reset demo data** restores the
original story.

Click **"Explore the demo — no account needed"** on the sign-in screen.

### The demo dataset

Entirely fictional — an invented household, "Alex Delaney". It is built so that
every screen has something real to show rather than an empty state:

| | |
|---|---|
| **History** | 24 complete months of balances and income, plus the current partly-elapsed one, so the 3M / 6M / 1Y / ALL ranges genuinely differ, year-on-year growth is computable, and the derived spending figures have something to be derived from |
| **Accounts** | Nine — current, joint, e-wallet, two emergency-fund accounts, physical cash *deliberately over its ceiling*, a **USD** savings account (exercising currency conversion), a ring-fenced property reserve, and a credit card |
| **Investments** | Eight holdings across five asset types, three brokers and two currencies — including a **loss-making** position, a **realised gain** from an earlier trim, and a "pie" split across four allocation buckets |
| **Housing** | The household **rents the flat it lives in** (€1,650/month — an ordinary essential expense, not an asset) while **owning one apartment that it lets out** (€1,450/month coming in, with a mortgage still on it). Two different rents, deliberately different figures, kept firmly apart |
| **Debt** | A car loan and a card balance, so the debt factor in the security score actually bites |
| **Strategy** | Phase 1 complete, Phase 2 active, Phase 3 unlocked and ready to activate — with two rules currently breached, so the engine has something to say |
| **Goals** | One achieved, two on track, three behind — including a deposit goal to stop renting |

Month-to-month variation comes from a seeded PRNG, so the numbers look organic
but are byte-identical on every reload. `supabase/seed.sql` reproduces the same
persona in SQL, so the app tells one story with or without a backend.

---

## Supabase setup

### 1. Create a Supabase project

<https://supabase.com/dashboard> → **New project**. Pick a region close to
your users. Note the project reference.

### 2. Run the schema

Open **SQL Editor → New query**, paste the entire contents of
[`supabase/schema.sql`](supabase/schema.sql), and run it.

This creates every table, enum, index, constraint, trigger, calculation
function, view and Row Level Security policy. It is safe to re-run.

Check it worked: **Table Editor** should list 25 tables, each marked as
having Row Level Security enabled.

### 3. Seed demo data (development projects only)

Paste [`supabase/seed.sql`](supabase/seed.sql) into a new query and run it.

It creates a demo auth user and populates it with the same fictional persona the
in-browser demo uses:

| | |
|---|---|
| **Email** | `demo@snowball.app` |
| **Password** | `snowball-demo` |

The seed is idempotent — re-running it wipes and rebuilds that user's data and
never touches anyone else's. **Never run it against your production project**:
it creates an account with a publicly known password.

> If your project blocks direct `auth.users` inserts, create the user through
> **Authentication → Users → Add user** first (same email), then run the seed —
> it detects the existing user and seeds against it.

### 4. Configure authentication

**Authentication → Sign In / Providers → Email**: enable it.

- **Development:** turn **"Confirm email"** off so sign-up gives you a session
  immediately.
- **Production:** leave it on, and set up **custom SMTP** (Authentication →
  Emails → SMTP settings) with a provider such as Resend, Postmark or Amazon SES.
  Supabase's built-in mailer is meant for testing only; it is heavily rate
  limited and may only deliver to your own team's addresses
  [check the current limits in the Supabase docs].

**Authentication → URL Configuration:**

| Setting | Value |
|---|---|
| **Site URL** | `https://your-domain.com` (or `http://localhost:4200` while developing) |
| **Redirect URLs** | `http://localhost:4200/**` and `https://your-domain.com/**` |

Confirmation emails send people to `/dashboard`, and password-reset emails
send them to `/auth/reset-password`, where they choose a new password. Both
must be on an allowed URL or Supabase falls back to the Site URL.

### 5. Add your Supabase URL and publishable key

From **Project Settings → API**, copy the **Project URL** and the
**anon / publishable** key into both environment files:

| File | Used by |
|---|---|
| `src/environments/environment.ts` | `npm start` (development) |
| `src/environments/environment.prod.ts` | `npm run build` (production) |

```ts
supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
supabaseAnonKey: 'YOUR-PUBLISHABLE-ANON-KEY',
```

The publishable key is designed to be public; Row Level Security is what
protects the data. **Never** use the service-role key here. See
[Security notes](#security-notes).

A development build with blank values runs the in-browser demo. A
**production build with blank values refuses to start** (it shows a "not
configured" page). This stops a deploy from quietly serving demo mode, where
any email and password "signs in". To host the demo on purpose, set
`forceDemoMode: true` in `environment.prod.ts`.

### 6. Run the application

```bash
npm start
```

Sign in with the seeded demo user, or create your own account. On sign-up the
`handle_new_user` trigger provisions a profile, the default plan stages and
checks, priorities and a base forecast scenario.

A new account then opens on a **setup checklist**: add accounts → add income →
add fixed bills → set your safety cushion → do your first monthly check-in.

---

## Deploying

Snowball is a static single-page app: `npm run build` writes plain files to
`dist/snowball/browser/`, and any static host can serve them. Supabase is
only the backend; it does not host the site.

### Before the first deploy

1. Fill in `src/environments/environment.prod.ts` (step 5 above).
2. Put the project in a Git repository and push it to GitHub, GitLab or
   Bitbucket. Hosts deploy on every push.
3. Run `npm run build` locally once to make sure it succeeds.

### Netlify

[`netlify.toml`](netlify.toml) is already set up (build command, output folder, Node 22,
single-page routing and security headers).

1. **Add new site → Import an existing project** → pick the repository.
2. Accept the detected settings and deploy.
3. **Domain management → Add a domain** → follow the DNS instructions.

### Vercel

[`vercel.json`](vercel.json) is already set up.

1. **Add New → Project** → import the repository (framework preset: Angular).
2. Deploy.
3. **Settings → Domains** → add your domain and follow the DNS instructions.

### Cloudflare Pages

1. **Workers & Pages → Create → Pages → Connect to Git**.
2. Build command `npm run build`, output directory `dist/snowball/browser`.
3. **Custom domains → Set up a domain**.

Cloudflare Pages serves `index.html` for unknown paths automatically, so no
routing file is needed.

### After the domain is live

1. In Supabase, set **Site URL** to `https://your-domain.com` and add
   `https://your-domain.com/**` to **Redirect URLs** (step 4).
2. Sign up with a real address, confirm the email, then sign out and use
   **Forgot your password?** to check that the reset email arrives and
   `/auth/reset-password` works.
3. Refresh the browser on a deep link such as `/goals`. It should load
   the page, not a 404.

### Production checklist

- [ ] `schema.sql` run on the production project; `seed.sql` **not** run
- [ ] `environment.prod.ts` has the production URL + publishable key
- [ ] Email confirmation on, custom SMTP configured
- [ ] Site URL and Redirect URLs point at the real domain
- [ ] Sign-up, sign-in, password reset and a deep-link refresh all tested
- [ ] Optional: **Project Settings → Add-ons → Point in Time Recovery** or
      regular backups, since this is financial data

### Exchange rates

`schema.sql` seeds EUR ⇄ USD / GBP / CHF rates once, on install. Nothing
refreshes them automatically. Settings only offers base currencies that have
rates. To keep rates current, update the `exchange_rates` table with the
service role, for example from a scheduled Supabase Edge Function that calls an
FX API.

---

## What's in the box

| Page | What it does |
|---|---|
| **Dashboard** | The verdict banner (on track / attention / off track) with a written explanation, nine key statistics with month-over-month deltas and sparklines, the financial security score broken into its five weighted factors, net-worth and cash trends, asset mix, and an upcoming-events timeline. |
| **Cash Flow** | Multiple cash accounts with per-account interest, liquid/emergency flags and ceilings. Declare what recurs; spending is derived from how the balances moved. Cash-over-time against the security floor, allocation donut, income-vs-expenses columns, savings capacity and salary history. |
| **Investments** | Holdings valued live at quantity × price, unrealised and realised gain, time-weighted return, contributions-vs-growth, target vs actual allocation with drift and tolerance bands, and rebalance suggestions (never trades). |
| **Net Worth** | Assets − liabilities with a hero figure, monthly and yearly change, liquid/invested/property splits, a full balance sheet, and manual entry for cars, valuables and other assets. |
| **Property** | Opens by separating **where you live** from **what you own**: if you rent, the rent you pay is shown as the expense it is, next to a roll-up of the property you own as an investment. Then per property — equity, loan-to-value, interest vs principal, gross and net yield, a rent waterfall that drains down the page (rent in → running costs → mortgage → what survives), a ring-fenced Property Reserve, and projected equity at 5 and 10 years. |
| **Goals** | Progress, remaining, required monthly contribution, projected completion and an on-track flag. Plus planned expenses with "you need €X/month to have this by then". |
| **Strategy** | Ranked priorities, three configurable financial phases with unlock conditions, and strategy rules evaluated live against your position. |
| **Forecasts** | Month-by-month simulation to 1/5/10/20/30 years across four projections, three scenarios compared side by side, milestones, and every assumption listed in the open. |
| **Settings** | Base currency and locale, emergency-fund target and cash ceiling, custom categories, theme, and data-source diagnostics. |

**Every calculated figure carries an ⓘ.** Hover it for a quick read, click to
pin it open. Each one states what the number means, the formula, and then the
same formula worked through with *your own current numbers* — so anything the
app asserts can be checked by hand:

```
Available above the security floor
Available = liquid cash − security floor − unfunded planned spending due within 3 months

WITH YOUR NUMBERS
+ Liquid cash                                    €29,542
− Security floor          your emergency target  €21,000
− Committed within 3 months                       €1,930
─────────────────────────────────────────────────────────
  Available                                       €6,612
```

Also throughout: dark mode, responsive layout down to phone width, skeleton
loaders, empty and error states, toasts, confirmation dialogs on destructive
actions, form validation, and keyboard-reachable charts.

---

## Architecture

```
src/app/
  core/
    auth/            Supabase auth service + route guards
    data/            Repository interface, Supabase + demo implementations, mappers
    engine/          Pure calculation: metrics, strategy, forecast, portfolio
    models/          Domain types
    money/           Decimal arithmetic, currency abstraction, formatting
    state/           FinanceStore — signals over the dataset
    supabase/        Client + generated-style database types
    ui/              Theme, toasts
  shared/
    charts/          Hand-built SVG chart kit
    ui/              Cards, meters, badges, dialogs, states, logo
  features/
    dashboard/ check-in/ cash-flow/ investments/ net-worth/
    property/ goals/ strategy/ forecasts/ settings/ auth/
  layout/            App shell: sidebar, topbar, mobile drawer
```

Three rules hold the thing together:

**1. Business logic never lives in a component.** `core/engine/*` is pure
TypeScript over a `FinancialDataset` — no Angular, no I/O. Components read
computed signals off `FinanceStore` and render. That is why the same number
appears identically on the Dashboard, Net Worth and Forecasts pages.

**2. Persistence is behind one interface.** Everything goes through
`FinanceRepository`. `SupabaseRepository` and `DemoRepository` implement it, and
`app.config.ts` picks between them once at bootstrap from the environment
config. No feature code imports either directly — which is what lets the whole
product run without a backend.

**3. Money is `Decimal`, not `number`.** PostgREST returns `numeric` columns as
strings so nothing is lost in transit; `core/money` parses them into `Decimal`
and only converts to `number` at the edges (chart geometry, layout maths).

---

## Financial model

A few decisions worth knowing about, because they shape the whole product:

**No transaction ledger.** You keep account balances and holdings current and
declare what recurs — rent, mortgage, groceries, insurance. Everything else is
*derived*:

```
spending = income − investment contributions − change in total cash
```

Anything your income bought that is not still sitting in cash, and did not go
into investments, was spent. Cash is measured across every non-card account, so
moving money between your own accounts nets to zero and can never look like
spending. The essential slice is what you declared; the rest is flexible.

The trade-off is deliberate: you cannot ask what you spent at a particular shop,
because that was never recorded. In exchange there is nothing to reconcile and
nothing to fall behind on — and the totals are drawn from balances you can see,
rather than from a ledger you have to trust yourself to have completed.

**No monthly discretionary budget.** Snowball deliberately refuses to say
"you have €X left in your fun budget". It distinguishes **essential** spending
(recurring, predictable) from **flexible** spending (travel, restaurants,
shopping) and reports **"available above security floor"** instead. A €100 month
and a €1,200 month are both fine as long as the cash strategy stays healthy —
the app's job is to show the consequence, not to impose a limit.

**The security floor is the anchor.** Liquid cash, minus the emergency-fund
target, minus unfunded planned expenses due within three months. What is left is
genuinely free. Upcoming spending can never masquerade as spare cash.

**Rental income is not lifestyle money.** Rent covers the mortgage and running
costs first; the surplus accrues to a ring-fenced Property Reserve with its own
target. The forecast engine models it that way too.

**Rent you pay and rent you receive are different things.** One is an essential
expense on a home that will never appear on your balance sheet; the other is
income from an asset that does. Snowball never nets them off against each other,
and the Property page says which is which before it shows you anything else.

**Contributions are not performance.** The Investments page separates money you
paid in from what the market added, and reports a time-weighted return
(chain-linked, contribution-adjusted) so paying more in never shows up as a
better return.

**Forecasts are labelled as forecasts.** Every projection ships with its
assumptions visible, a nominal-not-real caveat, and a scenario spread that makes
the uncertainty explicit. Nothing is presented as a guaranteed return.

**The security score is defined once.** The weights — emergency fund 40%,
runway 20%, savings capacity 15%, debt burden 15%, liquidity 10% — are
implemented identically in `core/engine/metrics.ts` and in the
`public.security_score()` SQL function, so the client and the database cannot
disagree.

---

## Database

`supabase/schema.sql` is organised in nine sections: extensions, enums, tables,
indexes, `updated_at` triggers, new-user bootstrap, calculation functions,
views, and Row Level Security.

**23 user-owned tables**, plus shared reference data (`categories` system rows,
`exchange_rates`). There is no `transactions` table — `recurring_expenses` holds
the declared baseline, and `monthly_cash_flow` derives the rest.

**Calculation functions** — `liquid_cash`, `emergency_fund_balance`,
`emergency_fund_progress`, `monthly_income`, `monthly_expenses`,
`essential_monthly_expenses`, `portfolio_value`, `portfolio_cost_basis`,
`property_equity`, `current_net_worth`, `months_of_runway`, `security_score`,
`available_above_floor`, `goal_required_monthly`, plus `fx_rate` /
`convert_amount` for currency conversion.

**Views** — `financial_summary`, `current_net_worth_breakdown`,
`portfolio_allocation`, `monthly_cash_flow`, `goal_progress`,
`property_performance`, `investment_positions`. All declared
`security_invoker = true`, so the querying user's RLS policies apply and no data
can leak across users.

**Monetary columns are `numeric(18,4)`.** Never `float`.

### Regenerating TypeScript types

`src/app/core/supabase/database.types.ts` is hand-maintained to match the
schema. To regenerate it from a live project instead:

```bash
npx supabase gen types typescript --project-id <your-ref> --schema public \
  > src/app/core/supabase/database.types.ts
```

### Currency

EUR is the default base currency, but the schema stores a currency per row and
every calculation converts into the user's base currency. Rates live in the
`exchange_rates` table behind `CurrencyService`, which triangulates through the
base currency and reports any pair it had to fall back to 1:1 on (surfaced in
Settings). **No conversion rate is hard-coded anywhere** — point the table at a
real FX provider whenever you like.

---

## Design system

All tokens live in [`src/styles.scss`](src/styles.scss) as CSS custom
properties, defined three times: on bare `:root` (light), under
`prefers-color-scheme: dark` guarded against an explicit light stamp, and under
`[data-theme="dark"]`. `ThemeService` writes the attribute; nothing else needs
to know about theming.

Charts are hand-built SVG rather than a charting library — it keeps marks on
spec (2px lines, 4px rounded data-ends square at the baseline, 2px surface gaps
between touching marks, hairline gridlines), themes from the same tokens as
everything else, and keeps the bundle small.

**Colour discipline:** green means positive, red means negative — those two are
reserved for financial direction and never used as series colours. The
categorical chart palette is six slots assigned in fixed order and never
cycled, validated for colour-vision deficiency separation and contrast against
both the light (`#ffffff`) and dark (`#12151c`) chart surfaces. Allocation
charts always ship a value-bearing legend, so identity and magnitude are never
carried by colour alone.

---

## Scripts

```bash
npm start          # dev server on :4200
npm run build      # production build
npm test           # unit tests (Karma + Chrome)
```

The test suite covers the parts where being wrong is expensive: decimal
arithmetic and penny allocation, mortgage amortisation, the security-score
weights, the strategy engine's verdict, and the forecast simulation's
invariants (net worth equals its components; nothing is invested before the
emergency fund is full; the emergency fund is never invested back below its
floor).

---

## Security notes

- **Only the publishable (anon) key belongs in the environment files.** The
  service-role key bypasses Row Level Security entirely; putting it in a browser
  app hands every user's data to anyone who opens DevTools. Snowball never reads
  it.
- **RLS is on for every table**, with a policy per command keyed on
  `auth.uid() = user_id`. `profiles` keys on `id`; `categories` allows reading
  shared system rows but only writing your own; `exchange_rates` is read-only
  reference data that only the service role can refresh. Nothing is publicly
  readable: the schema revokes table access and function execution from
  `anon`. RLS is deliberately not *forced*: the sign-up trigger runs as the
  table owner and must be able to create the new user's rows before they have
  a session.
- **`load()` reads whole tables.** Supabase's API returns at most 1,000 rows
  per request by default. That is years of monthly snapshots for a typical
  household, but a very active investor could eventually hit it on
  `investment_transactions` (raise **Project Settings → API → Max rows** or add
  paging).
- **`supabase/seed.sql` is development data.** It creates a user with a known
  password. Never run it against production.

---

## Disclaimer

Snowball is a personal planning and tracking tool. It clearly distinguishes
actual values, user-entered estimates, forecasts and hypothetical scenarios —
but nothing it produces is financial advice, and projected investment returns
are never guaranteed.
