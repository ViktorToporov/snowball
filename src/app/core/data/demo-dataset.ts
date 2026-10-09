/**
 * The bundled demo dataset.
 *
 * ⚠️  Entirely fictional sample data. It describes an invented
 *     household ("Alex Delaney") and is not anybody's real finances.
 *
 * The persona is chosen so that every feature in the app has something
 * to show:
 *
 *   · 24 months of balance and income history, so the 3M / 6M / 1Y / ALL
 *     ranges differ, year-on-year income growth is computable, and the
 *     derived spending figures have something to be derived from
 *   · nine accounts — current, joint, e-wallet, two emergency-fund
 *     accounts, physical cash *over* its ceiling, a USD savings account
 *     (exercising currency conversion), a ring-fenced property reserve
 *     and a credit card
 *   · eight holdings across five asset types, two brokers and two
 *     currencies, including a loss-making position and a realised gain
 *   · a household that **rents where it lives** while **owning a let
 *     apartment** with a mortgage on it — so the app has to keep
 *     "rent I pay" and "rent I receive" clearly apart
 *   · a car loan and a credit-card balance, so the debt factor bites
 *   · Phase 1 complete, Phase 2 active, Phase 3 ready to activate
 *   · goals in every state: achieved, on track, and behind
 *
 * Month-to-month variation comes from a seeded PRNG, so the data looks
 * organic but is identical on every reload — and this file stays the
 * TypeScript twin of `supabase/seed.sql`.
 */

import { addMonths, startOfMonth, toIsoDate } from '../money/format';
import { CategoryType, ExpenseFrequency, FinancialDataset } from '../models/domain.models';

const USER = '00000000-0000-4000-a000-0000000000d1';

/** 24 complete months of history, ending with last month. */
const MONTHS = 24;

/** The month the let apartment found its first tenant. */
const RENT_STARTS = 6;
/** The month the salary rise landed. */
const RAISE_AT = 14;

/** Liquid cash at the end of the last complete month. */
const CASH_AT_LAST_MONTH_END = 30_100;

/** Deterministic PRNG — organic-looking, identical on every reload. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ID = {
  current: 'acc-current',
  joint: 'acc-joint',
  revolut: 'acc-revolut',
  savings: 'acc-savings',
  t212cash: 'acc-t212-cash',
  wallet: 'acc-wallet',
  usd: 'acc-usd',
  reserve: 'acc-reserve',
  card: 'acc-card',

  brokerT212: 'inv-acct-t212',
  brokerDegiro: 'inv-acct-degiro',
  brokerCrypto: 'inv-acct-crypto',

  vwce: 'inv-vwce',
  cspx: 'inv-cspx',
  vagf: 'inv-vagf',
  asml: 'inv-asml',
  pie: 'inv-pie',
  eimi: 'inv-eimi',
  btc: 'inv-btc',
  tret: 'inv-tret',

  apartment: 'prop-apartment',

  salary: 'inc-salary',
  rent: 'inc-rent',
  bonus: 'inc-bonus',

  phase1: 'phase-1',
  phase2: 'phase-2',
  phase3: 'phase-3',
};

const CATEGORY_SEED: ReadonlyArray<[string, string, CategoryType, number]> = [
  ['cat-salary', 'Salary', 'income', 1],
  ['cat-bonus', 'Bonus', 'income', 2],
  ['cat-rental', 'Rental income', 'income', 3],
  ['cat-invincome', 'Investment income', 'income', 4],
  ['cat-otherinc', 'Other income', 'income', 5],
  ['cat-housing', 'Housing', 'essential', 10],
  ['cat-mortgage', 'Mortgage', 'essential', 11],
  ['cat-rent', 'Rent', 'essential', 12],
  ['cat-groceries', 'Groceries', 'essential', 13],
  ['cat-utilities', 'Utilities', 'essential', 14],
  ['cat-insurance', 'Insurance', 'essential', 15],
  ['cat-transport', 'Transport', 'essential', 16],
  ['cat-health', 'Healthcare', 'essential', 17],
  ['cat-subs', 'Subscriptions', 'essential', 18],
  ['cat-restaurants', 'Restaurants', 'flexible', 30],
  ['cat-travel', 'Travel', 'flexible', 31],
  ['cat-shopping', 'Shopping', 'flexible', 32],
  ['cat-entertainment', 'Entertainment', 'flexible', 33],
  ['cat-hobbies', 'Hobbies', 'flexible', 34],
  ['cat-otherspend', 'Other spending', 'flexible', 35],
];

/** Two user-defined categories, so Settings has something removable. */
const USER_CATEGORIES: ReadonlyArray<[string, string, CategoryType, number]> = [
  ['cat-maintenance', 'Home maintenance', 'essential', 100],
  ['cat-gifts', 'Gifts & charity', 'flexible', 101],
];

/* -- fixed monthly outgoings -------------------------------------- */
/**
 * Rent on the flat the household actually lives in — they do not own it.
 * Deliberately a different figure from the €1,450 they *receive* on the
 * let apartment, so the two can never be confused for each other.
 */
const HOME_RENT = 1650;
/** Mortgage on the let apartment they do own. */
const APT_MORTGAGE = 640;
const INSURANCE = 95;
const HEALTHCARE = 65;
const SUBSCRIPTIONS = 48;
const FIXED_ESSENTIALS = HOME_RENT + APT_MORTGAGE + INSURANCE + HEALTHCARE + SUBSCRIPTIONS;

/**
 * The declared cost of living. This is the whole of what the user types
 * in about spending — everything else is inferred from the balances.
 * The totals line up with the monthly series used to build the history.
 */
const RECURRING_EXPENSES: ReadonlyArray<
  [id: string, name: string, amount: number, categoryId: string, accountId: string,
   frequency: ExpenseFrequency, propertyId: string | null, notes: string]
> = [
  ['rex-rent', 'Rent — the flat we live in', 1650, 'cat-rent', 'acc-joint', 'monthly', null,
   'Two-bed, paid on the 1st. Not owned — this is an expense, not an asset.'],
  ['rex-apt-mortgage', 'Riverside Apartment mortgage', 640, 'cat-mortgage', 'acc-current', 'monthly', 'prop-apartment',
   'Covered by the tenant\'s rent; see the Property page.'],
  ['rex-groceries', 'Groceries', 625, 'cat-groceries', 'acc-joint', 'monthly', null,
   'Averaged across the weekly shop.'],
  ['rex-utilities', 'Electricity, gas & broadband', 190, 'cat-utilities', 'acc-joint', 'monthly', null,
   'Seasonal — this is the twelve-month average.'],
  ['rex-transport', 'Commuting', 148, 'cat-transport', 'acc-current', 'monthly', null,
   'Fuel and the Leap card.'],
  ['rex-insurance', 'Home & contents insurance', 95, 'cat-insurance', 'acc-joint', 'monthly', null, ''],
  ['rex-health', 'Health cover', 65, 'cat-health', 'acc-current', 'monthly', null, ''],
  ['rex-subs', 'Streaming, cloud & phone', 48, 'cat-subs', 'acc-current', 'monthly', null, ''],
  ['rex-maintenance', 'Repairs and upkeep', 780, 'cat-maintenance', 'acc-joint', 'annual', null,
   'Lumpy in practice — declared annually so it still lands in the baseline.'],
  ['rex-car-loan', 'Car loan repayment', 245, 'cat-transport', 'acc-current', 'monthly', null,
   'Fixed-rate PCP, 44 months left.'],
];

/* -- today's account balances ------------------------------------- */
const BALANCES: Record<string, number> = {
  [ID.current]: 3850,
  [ID.joint]: 1240,
  [ID.revolut]: 620,
  [ID.savings]: 13_600,
  [ID.t212cash]: 7600,
  [ID.wallet]: 420,
  [ID.usd]: 2400, // USD
  [ID.reserve]: 9795,
  [ID.card]: 1180,
};

const USD_TO_EUR = 0.9216589862;

const round2 = (value: number) => Math.round(value * 100) / 100;

export function buildDemoDataset(): FinancialDataset {
  const random = mulberry32(20260813);
  const thisMonth = startOfMonth(new Date());
  const today = new Date();

  /** Index 0 is 24 months ago; index MONTHS-1 is *last* month. */
  const monthStart = (index: number) => addMonths(thisMonth, index - MONTHS);
  const monthEndIso = (index: number) => {
    const next = addMonths(thisMonth, index - MONTHS + 1);
    return toIsoDate(new Date(next.getFullYear(), next.getMonth(), 0));
  };
  const dayIn = (index: number, day: number) => {
    const base = monthStart(index);
    return toIsoDate(new Date(base.getFullYear(), base.getMonth(), day));
  };
  const iso = (months: number) => toIsoDate(addMonths(thisMonth, months));

  /* Prices are "as of today", pinned to midnight so the dataset is
     byte-identical on every build rather than drifting by the second. */
  const pricedAt = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();

  /* ================================================================
     1. Monthly series
     ================================================================ */

  const salary: number[] = [];
  const rentReceived: number[] = [];
  const bonus: number[] = [];
  const groceries: number[] = [];
  const utilities: number[] = [];
  const transport: number[] = [];
  const maintenance: number[] = [];
  const flexible: number[] = [];
  const contribution: number[] = [];

  for (let i = 0; i < MONTHS; i += 1) {
    salary.push(i < RAISE_AT ? 4850 : 5400);
    rentReceived.push(i < RENT_STARTS ? 0 : i < RAISE_AT ? 1380 : 1450);
    bonus.push(i === 8 ? 4200 : i === 20 ? 4600 : 0);

    groceries.push(Math.round(560 + random() * 130));

    // Utilities swing with the seasons: coldest in January.
    const month = monthStart(i).getMonth();
    utilities.push(Math.round(175 + 55 * Math.cos((2 * Math.PI * month) / 12) + random() * 30));

    transport.push(Math.round(115 + random() * 65));
    // Occasional home repairs rather than every month.
    maintenance.push(random() < 0.3 ? Math.round(90 + random() * 260) : 0);

    const base = i < RENT_STARTS ? 950 : i < RAISE_AT ? 1250 : 1650;
    const spike = i === 10 || i === 21 ? 1500 : 0;
    flexible.push(Math.round(base + spike + (random() - 0.5) * 520));

    contribution.push(i < RENT_STARTS ? 600 : 900);
  }

  const essentialFor = (i: number) =>
    FIXED_ESSENTIALS + groceries[i] + utilities[i] + transport[i] + maintenance[i];

  const reserveTransfer = (i: number) =>
    i < RENT_STARTS ? 0 : i < RAISE_AT ? 475 : 545;

  /* Opening balance chosen so liquid cash lands exactly on the target
     at the end of the last complete month. */
  let liquidNetTotal = 0;
  for (let i = 0; i < MONTHS; i += 1) {
    liquidNetTotal +=
      salary[i] + rentReceived[i] + bonus[i] - essentialFor(i) - flexible[i] - contribution[i] - reserveTransfer(i);
  }
  let liquidCash = CASH_AT_LAST_MONTH_END - liquidNetTotal;
  let reserveBalance = 0;

  /* ================================================================
     2. Ledger, snapshots and investment activity
     ================================================================ */

  const incomeHistory: FinancialDataset['incomeHistory'] = [];
  const accountSnapshots: FinancialDataset['accountBalanceSnapshots'] = [];
  const netWorthSnapshots: FinancialDataset['netWorthSnapshots'] = [];
  const portfolioSnapshots: FinancialDataset['portfolioSnapshots'] = [];
  const investmentTransactions: FinancialDataset['investmentTransactions'] = [];
  const propertyValuations: FinancialDataset['propertyValuations'] = [];

  /** Share of liquid cash each liquid account holds today. */
  const liquidAccounts: Array<[string, number]> = [
    [ID.current, BALANCES[ID.current]],
    [ID.joint, BALANCES[ID.joint]],
    [ID.revolut, BALANCES[ID.revolut]],
    [ID.savings, BALANCES[ID.savings]],
    [ID.t212cash, BALANCES[ID.t212cash]],
    [ID.wallet, BALANCES[ID.wallet]],
    [ID.usd, BALANCES[ID.usd] * USD_TO_EUR],
  ];
  const liquidTotalToday = liquidAccounts.reduce((sum, [, value]) => sum + value, 0);
  const liquidShares = liquidAccounts.map(([id, value]) => [id, value / liquidTotalToday] as const);

  /* The contribution series is the *sum of actual buys*, so the chart's
     contributions line can never drift away from the cost basis shown
     on the holdings table. */
  const OPENING_BUYS: Array<[id: string, quantity: number, price: number, currency: string, fees: number, note: string]> = [
    [ID.vwce, 120, 101.2, 'EUR', 0, 'Opening position'],
    [ID.cspx, 22, 452.1, 'USD', 0, 'Opening position'],
    [ID.vagf, 345, 24.3, 'EUR', 0, 'Opening position'],
    [ID.eimi, 225, 30, 'EUR', 0, 'Opening position'],
    [ID.pie, 2160, 1.36, 'EUR', 0, 'Opening the pie'],
    [ID.asml, 12, 612.5, 'EUR', 12, 'Opening position'],
    [ID.btc, 0.085, 41_200, 'EUR', 21, 'Small satellite position'],
    [ID.tret, 95, 34.2, 'EUR', 0, 'Opening position'],
  ];

  /** The sale that produced the realised gain, part-way through. */
  const SALE_MONTH = 14;
  const SALE_PROCEEDS = 1926;

  let contributionsToDate = OPENING_BUYS.reduce(
    (sum, [, quantity, price, currency]) =>
      sum + quantity * price * (currency === 'USD' ? USD_TO_EUR : 1),
    0,
  );

  for (let i = 0; i < MONTHS; i += 1) {
    const endIso = monthEndIso(i);
    const essential = essentialFor(i);

    contributionsToDate += contribution[i];
    if (i === SALE_MONTH) contributionsToDate -= SALE_PROCEEDS;
    liquidCash += salary[i] + rentReceived[i] + bonus[i] - essential - flexible[i] - contribution[i] - reserveTransfer(i);
    reserveBalance += reserveTransfer(i);

    /* ---- income history (the only ledger Snowball keeps) ---------- */
    incomeHistory.push({
      id: `inch-salary-${i}`, userId: USER, incomeSourceId: ID.salary,
      periodMonth: toIsoDate(monthStart(i)), netAmount: salary[i] + bonus[i],
      grossAmount: round2((salary[i] + bonus[i]) * 1.42), currency: 'EUR',
    });

    if (rentReceived[i] > 0) {
      incomeHistory.push({
        id: `inch-rent-${i}`, userId: USER, incomeSourceId: ID.rent,
        periodMonth: toIsoDate(monthStart(i)), netAmount: rentReceived[i],
        grossAmount: null, currency: 'EUR',
      });
    }

    /* ---- account balance snapshots -------------------------------- */
    for (const [accountId, share] of liquidShares) {
      accountSnapshots.push({
        id: `abs-${i}-${accountId}`, userId: USER, accountId,
        snapshotDate: endIso, balance: round2(liquidCash * share),
      });
    }
    accountSnapshots.push({
      id: `abs-${i}-${ID.reserve}`, userId: USER, accountId: ID.reserve,
      snapshotDate: endIso, balance: round2(Math.max(0, reserveBalance)),
    });

    /* ---- portfolio ------------------------------------------------ */
    // A rising trend with organic wobble, pinned to today's value.
    const progress = (i + 1) / MONTHS;
    const drift = 1.012 + progress * 0.09;
    const wobble = (random() - 0.5) * 0.05;
    const factor = i === MONTHS - 1 ? 80_463.97 / contributionsToDate : drift + wobble;
    const portfolioValue = round2(contributionsToDate * factor);

    portfolioSnapshots.push({
      id: `pfs-${i}`, userId: USER, snapshotDate: endIso,
      totalValue: portfolioValue, totalContributions: round2(contributionsToDate),
      totalGain: round2(portfolioValue - contributionsToDate), currency: 'EUR',
    });

    /* ---- investment activity -------------------------------------- */
    const buys: Array<[string, number, number, string]> =
      i < RENT_STARTS
        ? [
            [ID.vwce, 0.6, 108 + i * 0.7, 'Monthly contribution'],
            [ID.pie, 0.4, 1.38 + i * 0.004, 'Monthly pie contribution'],
          ]
        : [
            [ID.vwce, 0.5, 108 + i * 0.7, 'Monthly contribution'],
            [ID.eimi, 0.3, 30.4 + i * 0.08, 'Monthly contribution'],
            [ID.vagf, 0.2, 24.6 - i * 0.02, 'Monthly contribution'],
          ];

    for (const [investmentId, share, price, note] of buys) {
      const amount = round2(contribution[i] * share);
      investmentTransactions.push({
        id: `itx-buy-${i}-${investmentId}`, userId: USER, investmentAccountId: null, investmentId, transactionType: 'buy',
        quantity: round2(amount / price), price: round2(price), amount, fees: 0, currency: 'EUR',
        transactionDate: dayIn(i, 28), notes: note,
      });
    }

    if ((i + 1) % 3 === 0) {
      investmentTransactions.push({
        id: `itx-div-${i}`, userId: USER, investmentAccountId: null, investmentId: ID.vagf, transactionType: 'dividend',
        quantity: 0, price: 0, amount: round2(70 + random() * 45), fees: 0, currency: 'EUR',
        transactionDate: dayIn(i, 18), notes: 'Quarterly bond distribution',
      });
    }
    if (i === 4 || i === 16) {
      investmentTransactions.push({
        id: `itx-fee-${i}`, userId: USER, investmentAccountId: null, investmentId: ID.asml, transactionType: 'fee',
        quantity: 0, price: 0, amount: round2(9 + random() * 6), fees: 0, currency: 'EUR',
        transactionDate: dayIn(i, 28), notes: 'Custody fee',
      });
    }

    /* ---- property & net worth -------------------------------------- */
    const back = MONTHS - i;

    const aptMortgage = round2(118_400 + back * 359);

    const aptValue = round2(242_000 - back * 440);
    const carValue = round2(18_400 + back * 185);
    const pensionValue = round2(62_300 - back * 680);
    const carLoan = round2(9850 + back * 225);
    const cardBalance = round2(900 + random() * 700);

    propertyValuations.push({
      id: `pv-apt-${i}`, userId: USER, propertyId: ID.apartment, valuationDate: endIso,
      estimatedValue: aptValue, mortgageBalance: aptMortgage, source: 'estimate',
    });

    const cash = round2(liquidCash + Math.max(0, reserveBalance));
    const liabilities = round2(aptMortgage + carLoan + cardBalance);
    const otherAssets = round2(carValue + pensionValue);

    netWorthSnapshots.push({
      id: `nws-${i}`, userId: USER, snapshotDate: endIso,
      cashValue: cash, investmentValue: portfolioValue,
      propertyValue: aptValue, otherAssets, liabilities,
      netWorth: round2(cash + portfolioValue + aptValue + otherAssets - liabilities),
      currency: 'EUR',
    });
  }

  /* ---- the realised sale, part-way through -------------------------- */
  investmentTransactions.push({
    id: 'itx-sell-eimi', userId: USER, investmentAccountId: null, investmentId: ID.eimi, transactionType: 'sell',
    quantity: 60, price: 32.1, amount: SALE_PROCEEDS, fees: 3.5, currency: 'EUR',
    transactionDate: dayIn(SALE_MONTH, 21), notes: 'Trimmed emerging markets after a run-up',
  });

  /* ---- opening positions -------------------------------------------- */
  const openedOn = toIsoDate(addMonths(thisMonth, -MONTHS - 1));
  investmentTransactions.unshift(
    ...OPENING_BUYS.map(([investmentId, quantity, price, currency, fees, note]) => ({
      id: `itx-open-${investmentId}`, userId: USER, investmentAccountId: null, investmentId,
      transactionType: 'buy' as const, quantity, price,
      amount: round2(quantity * price), fees, currency,
      transactionDate: openedOn, notes: note,
    })),
  );

  /* ================================================================
     3. The current, partly-elapsed month
     ================================================================ */

  const dayOfMonth = today.getDate();

  // Income only counts once it has actually landed.
  if (dayOfMonth >= 26) {
    incomeHistory.push({
      id: 'inch-salary-current', userId: USER, incomeSourceId: ID.salary,
      periodMonth: toIsoDate(thisMonth), netAmount: 5400,
      grossAmount: round2(5400 * 1.42), currency: 'EUR',
    });
  }
  if (dayOfMonth >= 4) {
    incomeHistory.push({
      id: 'inch-rent-current', userId: USER, incomeSourceId: ID.rent,
      periodMonth: toIsoDate(thisMonth), netAmount: 1450, grossAmount: null, currency: 'EUR',
    });
  }

  /* ================================================================
     4. Today's marks
     ================================================================ */

  const todayIso = toIsoDate(today);
  const liquidToday = round2(liquidTotalToday);
  const cashToday = round2(liquidToday + BALANCES[ID.reserve]);
  const propertyToday = 242_000;
  const otherToday = 18_400 + 62_300;
  const liabilitiesToday = 118_400 + 9850 + BALANCES[ID.card];

  netWorthSnapshots.push({
    id: 'nws-today', userId: USER, snapshotDate: todayIso,
    cashValue: cashToday, investmentValue: 80_463.97, propertyValue: propertyToday,
    otherAssets: otherToday, liabilities: liabilitiesToday,
    netWorth: round2(cashToday + 80_463.97 + propertyToday + otherToday - liabilitiesToday),
    currency: 'EUR',
  });
  portfolioSnapshots.push({
    id: 'pfs-today', userId: USER, snapshotDate: todayIso,
    totalValue: 80_463.97, totalContributions: round2(contributionsToDate),
    totalGain: round2(80_463.97 - contributionsToDate), currency: 'EUR',
  });
  for (const [id, balance] of Object.entries(BALANCES)) {
    if (id === ID.card) continue;
    accountSnapshots.push({
      id: `abs-today-${id}`, userId: USER, accountId: id, snapshotDate: todayIso,
      balance: id === ID.usd ? round2(balance * USD_TO_EUR) : balance,
    });
  }

  /* ================================================================
     5. The static picture
     ================================================================ */

  return {
    profile: {
      id: USER,
      displayName: 'Alex Delaney',
      baseCurrency: 'EUR',
      locale: 'en-IE',
      emergencyFundTarget: 21_000,
      physicalCashCeiling: 300,
      theme: 'system',
      onboarded: true,
    },

    accounts: [
      {
        id: ID.current, userId: USER, name: 'Current Account', accountType: 'checking',
        institution: 'Bank of Ireland', currency: 'EUR', balance: BALANCES[ID.current], interestRate: 0,
        countsAsLiquid: true, countsAsEmergencyFund: false, targetBalance: null,
        isArchived: false, sortOrder: 1,
        notes: 'Salary and rent land here; standing orders leave from here.',
      },
      {
        id: ID.joint, userId: USER, name: 'Joint Household', accountType: 'checking',
        institution: 'Bank of Ireland', currency: 'EUR', balance: BALANCES[ID.joint], interestRate: 0,
        countsAsLiquid: true, countsAsEmergencyFund: false, targetBalance: null,
        isArchived: false, sortOrder: 2, notes: 'Shared bills, groceries and the home mortgage.',
      },
      {
        id: ID.revolut, userId: USER, name: 'Revolut', accountType: 'ewallet',
        institution: 'Revolut', currency: 'EUR', balance: BALANCES[ID.revolut], interestRate: 0,
        countsAsLiquid: true, countsAsEmergencyFund: false, targetBalance: null,
        isArchived: false, sortOrder: 3, notes: 'Day-to-day card spending and travel.',
      },
      {
        id: ID.savings, userId: USER, name: 'Emergency Savings', accountType: 'savings',
        institution: 'Trade Republic', currency: 'EUR', balance: BALANCES[ID.savings], interestRate: 0.031,
        countsAsLiquid: true, countsAsEmergencyFund: true, targetBalance: 14_000,
        isArchived: false, sortOrder: 4, notes: 'Instant access at 3.10% — the bulk of the emergency fund.',
      },
      {
        id: ID.t212cash, userId: USER, name: 'Trading 212 Cash', accountType: 'brokerage_cash',
        institution: 'Trading 212', currency: 'EUR', balance: BALANCES[ID.t212cash], interestRate: 0.024,
        countsAsLiquid: true, countsAsEmergencyFund: true, targetBalance: 7000,
        isArchived: false, sortOrder: 5, notes: 'Uninvested cash at 2.40% APY. Variable rate.',
      },
      {
        id: ID.wallet, userId: USER, name: 'Physical Cash', accountType: 'physical_cash',
        institution: null, currency: 'EUR', balance: BALANCES[ID.wallet], interestRate: 0,
        countsAsLiquid: true, countsAsEmergencyFund: false, targetBalance: 300,
        isArchived: false, sortOrder: 6, notes: 'Ceiling is €300 — currently over it.',
      },
      {
        id: ID.usd, userId: USER, name: 'USD Savings', accountType: 'savings',
        institution: 'Wise', currency: 'USD', balance: BALANCES[ID.usd], interestRate: 0.042,
        countsAsLiquid: true, countsAsEmergencyFund: false, targetBalance: null,
        isArchived: false, sortOrder: 7,
        notes: 'Held in dollars for US travel. Converted at the stored EUR/USD rate.',
      },
      {
        id: ID.reserve, userId: USER, name: 'Property Reserve', accountType: 'savings',
        institution: 'Trade Republic', currency: 'EUR', balance: BALANCES[ID.reserve], interestRate: 0.026,
        countsAsLiquid: false, countsAsEmergencyFund: false, targetBalance: 12_000,
        isArchived: false, sortOrder: 8,
        notes: 'Ring-fenced rental surplus, building toward a €12,000 target. Deliberately excluded from liquid cash.',
      },
      {
        id: ID.card, userId: USER, name: 'Visa Credit Card', accountType: 'credit_card',
        institution: 'Bank of Ireland', currency: 'EUR', balance: BALANCES[ID.card], interestRate: 0,
        countsAsLiquid: false, countsAsEmergencyFund: false, targetBalance: null,
        isArchived: false, sortOrder: 9, notes: 'Cleared in full each month.',
      },
    ],

    categories: [
      ...CATEGORY_SEED.map(([id, name, categoryType, sortOrder]) => ({
        id, userId: null, name, categoryType, parentId: null,
        icon: null, color: null, isSystem: true, sortOrder,
      })),
      ...USER_CATEGORIES.map(([id, name, categoryType, sortOrder]) => ({
        id, userId: USER, name, categoryType, parentId: null,
        icon: null, color: null, isSystem: false, sortOrder,
      })),
    ],

    recurringExpenses: RECURRING_EXPENSES.map(([id, name, amount, categoryId, accountId, frequency, propertyId, notes]) => ({
      id, userId: USER, name, amount, currency: 'EUR',
      categoryId, accountId, propertyId, frequency,
      startDate: iso(-MONTHS), endDate: null, active: true, notes,
    })),

    incomeHistory,

    incomeSources: [
      {
        id: ID.salary, userId: USER, name: 'Net Salary', incomeType: 'salary',
        amount: 5400, grossAmount: 7668, currency: 'EUR', frequency: 'monthly',
        accountId: ID.current, propertyId: null, startDate: iso(-72), endDate: null,
        active: true, annualGrowth: 0.035,
        notes: 'Paid on the 26th. Rise applied 10 months ago (€4,850 → €5,400).',
      },
      {
        id: ID.rent, userId: USER, name: 'Riverside Apartment rent', incomeType: 'rental',
        amount: 1450, grossAmount: null, currency: 'EUR', frequency: 'monthly',
        accountId: ID.current, propertyId: ID.apartment, startDate: iso(-MONTHS + RENT_STARTS), endDate: null,
        active: true, annualGrowth: 0.02,
        notes: 'Ring-fenced: the surplus over mortgage and costs goes to the Property Reserve.',
      },
      {
        id: ID.bonus, userId: USER, name: 'Annual Bonus', incomeType: 'bonus',
        amount: 4600, grossAmount: 8200, currency: 'EUR', frequency: 'annual',
        accountId: ID.current, propertyId: null, startDate: iso(-48), endDate: null,
        active: true, annualGrowth: 0,
        notes: 'Paid each spring. Variable — treated conservatively in forecasts.',
      },
    ],

    investmentAccounts: [
      {
        id: ID.brokerT212, userId: USER, name: 'Trading 212 — Invest', broker: 'Trading 212',
        currency: 'EUR', currentValue: null, valueUpdatedAt: null, contributedBefore: 0, sortOrder: 0,
        notes: 'Core ETF holdings and the pie.',
      },
      {
        id: ID.brokerDegiro, userId: USER, name: 'Degiro', broker: 'Degiro',
        currency: 'EUR', currentValue: null, valueUpdatedAt: null, contributedBefore: 0, sortOrder: 0,
        notes: 'Individual shares and the USD-denominated tracker.',
      },
      {
        id: ID.brokerCrypto, userId: USER, name: 'Coinbase', broker: 'Coinbase',
        currency: 'EUR', currentValue: null, valueUpdatedAt: null, contributedBefore: 0, sortOrder: 0,
        notes: 'Small satellite allocation.',
      },
    ],

    investments: [
      {
        id: ID.vwce, userId: USER, investmentAccountId: ID.brokerT212,
        name: 'Vanguard FTSE All-World UCITS ETF (Acc)', ticker: 'VWCE', isin: 'IE00BK5BQT80',
        assetType: 'etf', quantity: 210, averageCost: 108.4, currentPrice: 124.75, currency: 'EUR',
        region: 'Global', sector: 'Broad market', expenseRatio: 0.0022,
        targetAllocation: null, realisedGain: 0, priceUpdatedAt: pricedAt,
        notes: 'The core holding. Split across four allocation buckets by index weight.',
      },
      {
        id: ID.cspx, userId: USER, investmentAccountId: ID.brokerDegiro,
        name: 'iShares Core S&P 500 UCITS ETF', ticker: 'CSPX', isin: 'IE00B5BMR087',
        assetType: 'etf', quantity: 22, averageCost: 452.1, currentPrice: 528.3, currency: 'USD',
        region: 'US Equities', sector: 'Broad market', expenseRatio: 0.0007,
        targetAllocation: null, realisedGain: 0, priceUpdatedAt: pricedAt,
        notes: 'Priced in dollars — converted to euro for every total in the app.',
      },
      {
        id: ID.vagf, userId: USER, investmentAccountId: ID.brokerT212,
        name: 'Vanguard Global Aggregate Bond UCITS ETF', ticker: 'VAGF', isin: 'IE00BG47KH54',
        assetType: 'bond', quantity: 480, averageCost: 24.1, currentPrice: 23.55, currency: 'EUR',
        region: 'Global', sector: 'Fixed income', expenseRatio: 0.001,
        targetAllocation: null, realisedGain: 0, priceUpdatedAt: pricedAt,
        notes: 'Currently below cost — the ballast, not the engine.',
      },
      {
        id: ID.asml, userId: USER, investmentAccountId: ID.brokerDegiro,
        name: 'ASML Holding N.V.', ticker: 'ASML', isin: 'NL0010273215',
        assetType: 'stock', quantity: 12, averageCost: 612.5, currentPrice: 688.2, currency: 'EUR',
        region: 'Developed ex-US', sector: 'Technology', expenseRatio: null,
        targetAllocation: null, realisedGain: 0, priceUpdatedAt: pricedAt,
        notes: 'Single-stock position — deliberately capped at a small share.',
      },
      {
        id: ID.eimi, userId: USER, investmentAccountId: ID.brokerT212,
        name: 'iShares Core MSCI EM IMI UCITS ETF', ticker: 'EIMI', isin: 'IE00BKM4GZ66',
        assetType: 'etf', quantity: 320, averageCost: 31.8, currentPrice: 33.45, currency: 'EUR',
        region: 'Emerging Markets', sector: 'Broad market', expenseRatio: 0.0018,
        targetAllocation: null, realisedGain: 1240, priceUpdatedAt: pricedAt,
        notes: 'Trimmed once already — the realised gain is recorded against this holding.',
      },
      {
        id: ID.pie, userId: USER, investmentAccountId: ID.brokerT212,
        name: 'Diversified Pie', ticker: null, isin: null,
        assetType: 'etf', quantity: 3200, averageCost: 1.42, currentPrice: 1.635, currency: 'EUR',
        region: 'Global', sector: 'Broad market', expenseRatio: 0.0019,
        targetAllocation: null, realisedGain: 0, priceUpdatedAt: pricedAt,
        notes: 'A Trading 212 pie: 40% S&P 500 · 25% Developed World · 20% Emerging · 15% Pacific.',
      },
      {
        id: ID.btc, userId: USER, investmentAccountId: ID.brokerCrypto,
        name: 'Bitcoin', ticker: 'BTC', isin: null,
        assetType: 'crypto', quantity: 0.085, averageCost: 41_200, currentPrice: 58_900, currency: 'EUR',
        region: 'Global', sector: 'Digital assets', expenseRatio: null,
        targetAllocation: null, realisedGain: 0, priceUpdatedAt: pricedAt,
        notes: 'Satellite position. Volatile by design; capped at a few percent.',
      },
      {
        id: ID.tret, userId: USER, investmentAccountId: ID.brokerDegiro,
        name: 'VanEck Global Real Estate UCITS ETF', ticker: 'TRET', isin: 'NL0009690239',
        assetType: 'reit', quantity: 95, averageCost: 34.2, currentPrice: 32.1, currency: 'EUR',
        region: 'Global', sector: 'Real estate', expenseRatio: 0.0025,
        targetAllocation: null, realisedGain: 0, priceUpdatedAt: pricedAt,
        notes: 'Listed property exposure, separate from the two physical properties.',
      },
    ],

    investmentTransactions,

    investmentAllocations: [
      { id: 'ia-1', userId: USER, investmentId: ID.vwce, bucket: 'US Equities', weight: 62 },
      { id: 'ia-2', userId: USER, investmentId: ID.vwce, bucket: 'Developed ex-US', weight: 22 },
      { id: 'ia-3', userId: USER, investmentId: ID.vwce, bucket: 'Emerging Markets', weight: 11 },
      { id: 'ia-4', userId: USER, investmentId: ID.vwce, bucket: 'Pacific', weight: 5 },
      { id: 'ia-5', userId: USER, investmentId: ID.cspx, bucket: 'US Equities', weight: 100 },
      { id: 'ia-6', userId: USER, investmentId: ID.vagf, bucket: 'Bonds & Cash', weight: 100 },
      { id: 'ia-7', userId: USER, investmentId: ID.asml, bucket: 'Developed ex-US', weight: 100 },
      { id: 'ia-8', userId: USER, investmentId: ID.eimi, bucket: 'Emerging Markets', weight: 100 },
      { id: 'ia-9', userId: USER, investmentId: ID.pie, bucket: 'US Equities', weight: 40 },
      { id: 'ia-10', userId: USER, investmentId: ID.pie, bucket: 'Developed ex-US', weight: 25 },
      { id: 'ia-11', userId: USER, investmentId: ID.pie, bucket: 'Emerging Markets', weight: 20 },
      { id: 'ia-12', userId: USER, investmentId: ID.pie, bucket: 'Pacific', weight: 15 },
      { id: 'ia-13', userId: USER, investmentId: ID.btc, bucket: 'Alternatives', weight: 100 },
      { id: 'ia-14', userId: USER, investmentId: ID.tret, bucket: 'Property & REITs', weight: 100 },
    ],

    targetAllocations: [
      { id: 'ta-1', userId: USER, bucket: 'US Equities', targetPercentage: 45, toleranceBand: 5, sortOrder: 1 },
      { id: 'ta-2', userId: USER, bucket: 'Developed ex-US', targetPercentage: 20, toleranceBand: 5, sortOrder: 2 },
      { id: 'ta-3', userId: USER, bucket: 'Emerging Markets', targetPercentage: 12, toleranceBand: 4, sortOrder: 3 },
      { id: 'ta-4', userId: USER, bucket: 'Pacific', targetPercentage: 5, toleranceBand: 3, sortOrder: 4 },
      { id: 'ta-5', userId: USER, bucket: 'Bonds & Cash', targetPercentage: 12, toleranceBand: 4, sortOrder: 5 },
      { id: 'ta-6', userId: USER, bucket: 'Property & REITs', targetPercentage: 3, toleranceBand: 2, sortOrder: 6 },
      { id: 'ta-7', userId: USER, bucket: 'Alternatives', targetPercentage: 3, toleranceBand: 3, sortOrder: 7 },
    ],

    properties: [
      {
        id: ID.apartment, userId: USER, name: 'Riverside Apartment',
        address: '1-bed apartment, city centre', currency: 'EUR',
        estimatedValue: 242_000, purchasePrice: 195_000, purchaseDate: iso(-96),
        mortgageBalance: 118_400, mortgageInterestRate: 0.0285, monthlyPayment: APT_MORTGAGE,
        remainingMonths: 216, rentalStatus: 'rented', monthlyRent: 1450,
        monthlyPropertyExpenses: 265, maintenanceReserve: 9795, maintenanceReserveTarget: 12_000,
        annualAppreciation: 0.022, expectedRentStart: iso(-MONTHS + RENT_STARTS),
        notes:
          'The only property owned. Alex rents a flat to live in and lets this one out. Rent covers the ' +
          'mortgage and running costs first; the €545/month surplus is swept into the Property Reserve ' +
          'rather than treated as lifestyle income.',
      },
    ],

    propertyValuations,

    otherAssets: [
      {
        id: 'oa-car', userId: USER, name: 'Car — 2021 estate', assetKind: 'vehicle',
        currentValue: 18_400, currency: 'EUR', purchaseValue: 28_500, annualDepreciation: 0.11,
        isLiquid: false, notes: 'Sample data. Re-estimated annually.',
      },
      {
        id: 'oa-pension', userId: USER, name: 'Workplace Pension', assetKind: 'pension',
        currentValue: 62_300, currency: 'EUR', purchaseValue: null, annualDepreciation: 0,
        isLiquid: false, notes: 'Employer scheme. Not accessible before retirement, so never counted as liquid.',
      },
    ],

    liabilities: [
      {
        id: 'li-car', userId: USER, name: 'Car Loan', liabilityKind: 'car_loan',
        balance: 9850, currency: 'EUR', interestRate: 0.059, monthlyPayment: 245,
        remainingMonths: 44, propertyId: null, notes: 'Fixed-rate PCP, cleared in just under four years.',
      },
    ],

    goals: [
      {
        id: 'goal-ef', userId: USER, name: 'Emergency Fund', goalType: 'emergency_fund',
        targetAmount: 18_000, currentAmount: 18_100, currency: 'EUR', targetDate: iso(-2),
        priority: 'critical', status: 'achieved', accountId: ID.savings,
        monthlyContribution: 0, trackAccountBalance: false,
        notes: 'Completed two months ago — six months of essential expenses. Phase 1 is done.',
      },
      {
        id: 'goal-japan', userId: USER, name: 'Japan Trip', goalType: 'travel',
        targetAmount: 6500, currentAmount: 4150, currency: 'EUR', targetDate: iso(4),
        priority: 'medium', status: 'active', accountId: ID.revolut,
        monthlyContribution: 620, trackAccountBalance: false,
        notes: 'Three weeks in spring. Funded from cash above the security floor.',
      },
      {
        id: 'goal-deposit', userId: USER, name: 'Deposit — a place to live', goalType: 'property',
        targetAmount: 50_000, currentAmount: 12_400, currency: 'EUR', targetDate: iso(48),
        priority: 'high', status: 'active', accountId: null,
        monthlyContribution: 500, trackAccountBalance: false,
        notes:
          'The household rents its home. This is the deposit to stop renting — kept separate from the ' +
          'let apartment, which is an investment rather than somewhere to live. Behind schedule.',
      },
      {
        id: 'goal-car', userId: USER, name: 'Replace the Car', goalType: 'vehicle',
        targetAmount: 22_000, currentAmount: 5400, currency: 'EUR', targetDate: iso(30),
        priority: 'low', status: 'active', accountId: null,
        monthlyContribution: 600, trackAccountBalance: false,
        notes: 'Clear the current loan first, then trade up.',
      },
      {
        id: 'goal-portfolio', userId: USER, name: 'Portfolio to €250,000', goalType: 'investment',
        targetAmount: 250_000, currentAmount: 80_464, currency: 'EUR', targetDate: iso(96),
        priority: 'medium', status: 'active', accountId: null,
        monthlyContribution: 900, trackAccountBalance: false,
        notes: 'The Phase 2 objective, at the current €900/month contribution.',
      },
      {
        id: 'goal-fi', userId: USER, name: 'Financial Independence', goalType: 'financial_independence',
        targetAmount: 1_100_000, currentAmount: 313_071, currency: 'EUR', targetDate: null,
        priority: 'low', status: 'active', accountId: null,
        monthlyContribution: 0, trackAccountBalance: false,
        notes: 'Long-horizon marker: 25× projected annual expenses. Progress tracks net worth.',
      },
    ],

    phases: [
      {
        id: ID.phase1, userId: USER, name: 'Financial Security', phaseOrder: 1, active: false,
        objective: 'Build liquid cash to €21,000 — six months of essential outgoings, rent included.',
        description:
          'Prioritise cash accumulation. No required new investment contributions; existing investments stay ' +
          'invested. Flexible spending is allowed, funded from cash above the security floor. Now complete — ' +
          'the floor is a hard limit and is not spent back below target.',
        entryCondition: {}, exitCondition: { type: 'emergency_fund_reached', target: 21_000 },
        completedAt: new Date(addMonths(thisMonth, -2)).toISOString(),
      },
      {
        id: ID.phase2, userId: USER, name: 'Wealth Building', phaseOrder: 2, active: true,
        objective: 'Turn monthly surplus into invested assets at the target allocation.',
        description:
          'Active since the emergency fund filled. €900/month goes into the target allocation, the cash reserve ' +
          'is held at the floor, and flexible spending runs off the surplus above it.',
        entryCondition: { type: 'emergency_fund_reached', target: 21_000 },
        exitCondition: { type: 'manual' }, completedAt: null,
      },
      {
        id: ID.phase3, userId: USER, name: 'Property Optimisation', phaseOrder: 3, active: false,
        objective: 'Make the apartment self-funding and build a €12,000 property reserve.',
        description:
          'The tenancy has started, so this phase can be activated. The mortgage continues normally, rent pays ' +
          'the mortgage and running costs, and the surplus accumulates in the Property Reserve.',
        entryCondition: { type: 'rental_income_started' },
        exitCondition: { type: 'manual' }, completedAt: null,
      },
    ],

    strategyRules: [
      {
        id: 'rule-ef', userId: USER, phaseId: ID.phase2, ruleType: 'emergency_fund',
        name: 'Emergency Fund Floor',
        description: 'Hold €21,000 in instant-access cash. Once reached the floor is hard — it is not spent back down.',
        targetValue: 21_000, targetPercentage: null, priority: 1, enabled: true,
        configuration: { counts: 'emergency_accounts', floor_is_hard: true },
      },
      {
        id: 'rule-inv', userId: USER, phaseId: ID.phase2, ruleType: 'investment',
        name: 'Monthly Contribution',
        description: 'Invest €900/month into the target allocation, on the 28th, before any flexible spending.',
        targetValue: 900, targetPercentage: null, priority: 2, enabled: true,
        configuration: { minimum_monthly: 900 },
      },
      {
        id: 'rule-alloc', userId: USER, phaseId: ID.phase2, ruleType: 'allocation',
        name: 'Target Allocation',
        description: 'Hold the strategic allocation within its tolerance bands; rebalance with new contributions before selling.',
        targetValue: null, targetPercentage: null, priority: 3, enabled: true,
        configuration: { rebalance_with_contributions_first: true },
      },
      {
        id: 'rule-life', userId: USER, phaseId: ID.phase2, ruleType: 'lifestyle',
        name: 'Lifestyle Rule',
        description: 'No fixed monthly discretionary limit. Flexible spending is funded from cash above the security floor.',
        targetValue: null, targetPercentage: null, priority: 4, enabled: true,
        configuration: { mode: 'above_security_floor' },
      },
      {
        id: 'rule-savings', userId: USER, phaseId: ID.phase2, ruleType: 'savings_rate',
        name: 'Savings Rate Floor',
        description: 'Keep the three-month average savings rate at or above 25% of income.',
        targetValue: null, targetPercentage: 25, priority: 5, enabled: true,
        configuration: {},
      },
      {
        id: 'rule-prop', userId: USER, phaseId: ID.phase2, ruleType: 'property',
        name: 'Property Rule',
        description:
          'Rental income above the mortgage and property expenses goes to the Property Reserve, never to lifestyle spending.',
        targetValue: 12_000, targetPercentage: null, priority: 6, enabled: true,
        configuration: { route_surplus_to: 'property_reserve', reserve_target: 12_000 },
      },
      {
        id: 'rule-cash', userId: USER, phaseId: ID.phase2, ruleType: 'cash_ceiling',
        name: 'Physical Cash Ceiling',
        description: 'Keep no more than €300 in physical cash; the rest belongs somewhere it earns interest.',
        targetValue: 300, targetPercentage: null, priority: 7, enabled: true,
        configuration: { account_type: 'physical_cash' },
      },
      {
        id: 'rule-debt', userId: USER, phaseId: ID.phase2, ruleType: 'debt',
        name: 'No New Consumer Debt',
        description: 'Clear the credit card in full monthly. The car loan runs to term rather than being overpaid.',
        targetValue: 0, targetPercentage: null, priority: 8, enabled: true,
        configuration: { exclude: ['mortgage', 'car_loan'] },
      },
      {
        id: 'rule-reserve', userId: USER, phaseId: ID.phase3, ruleType: 'property',
        name: 'Property Reserve Target',
        description: 'Build a €12,000 property reserve from rental surplus before treating any rent as personal income.',
        targetValue: 12_000, targetPercentage: null, priority: 1, enabled: true,
        configuration: { reserve_target: 12_000 },
      },
    ],

    strategyPriorities: [
      {
        id: 'pri-1', userId: USER, name: 'Wealth building', rank: 1, allocationPercentage: 55,
        description: 'The €900/month contribution, plus any surplus above the floor at year end.',
      },
      {
        id: 'pri-2', userId: USER, name: 'Financial security', rank: 2, allocationPercentage: 20,
        description: 'Hold the €21,000 floor and top it back up after any drawdown.',
      },
      {
        id: 'pri-3', userId: USER, name: 'Lifestyle & travel', rank: 3, allocationPercentage: 15,
        description: 'Flexible spending funded from cash above the floor. No fixed monthly limit.',
      },
      {
        id: 'pri-4', userId: USER, name: 'Property reserve', rank: 4, allocationPercentage: 10,
        description: 'Rental surplus, ring-fenced for repairs and void periods.',
      },
    ],

    plannedExpenses: [
      {
        id: 'pe-boiler', userId: USER, name: 'Apartment — boiler service', amount: 190, savedAmount: 0,
        currency: 'EUR', targetDate: iso(1), priority: 'medium', category: 'Home maintenance',
        status: 'planned', accountId: ID.joint, propertyId: ID.apartment,
        notes: 'Landlord obligation on the let apartment. Paid from the Property Reserve.',
      },
      {
        id: 'pe-dentist', userId: USER, name: 'Dental work', amount: 480, savedAmount: 480,
        currency: 'EUR', targetDate: iso(2), priority: 'medium', category: 'Healthcare',
        status: 'funded', accountId: ID.current, propertyId: null, notes: 'Fully set aside.',
      },
      {
        id: 'pe-carins', userId: USER, name: 'Car insurance renewal', amount: 740, savedAmount: 300,
        currency: 'EUR', targetDate: iso(2), priority: 'high', category: 'Insurance',
        status: 'funding', accountId: ID.current, propertyId: null, notes: 'Renews in February.',
      },
      {
        id: 'pe-japan', userId: USER, name: 'Japan — flights & hotels', amount: 3400, savedAmount: 2100,
        currency: 'EUR', targetDate: iso(3), priority: 'high', category: 'Travel',
        status: 'funding', accountId: ID.revolut, propertyId: null, notes: 'Booked well ahead of the trip itself.',
      },
      {
        id: 'pe-turnover', userId: USER, name: 'Apartment — tenant turnover', amount: 1250, savedAmount: 0,
        currency: 'EUR', targetDate: iso(5), priority: 'medium', category: 'Property',
        status: 'planned', accountId: null, propertyId: ID.apartment,
        notes: 'Paint, clean and letting fee between tenancies. Comes out of the Property Reserve.',
      },
      {
        id: 'pe-laptop', userId: USER, name: 'Laptop replacement', amount: 2300, savedAmount: 800,
        currency: 'EUR', targetDate: iso(7), priority: 'low', category: 'Electronics',
        status: 'funding', accountId: null, propertyId: null, notes: 'Current machine is five years old.',
      },
      {
        id: 'pe-kitchen', userId: USER, name: 'Apartment — kitchen refresh', amount: 5000, savedAmount: 0,
        currency: 'EUR', targetDate: iso(10), priority: 'medium', category: 'Property',
        status: 'planned', accountId: null, propertyId: ID.apartment,
        notes: 'Refit before the next tenancy, to support a higher rent.',
      },
    ],

    netWorthSnapshots,
    portfolioSnapshots,
    accountBalanceSnapshots: accountSnapshots,

    scenarios: [
      {
        id: 'sc-conservative', userId: USER, name: 'Conservative', kind: 'conservative', isDefault: false,
        salaryGrowth: 0.015, inflation: 0.032, investmentReturn: 0.04, cashInterest: 0.012,
        propertyAppreciation: 0.01, monthlyInvestment: 600, monthlyFlexibleSpending: 2100,
        includeRentalIncome: true, includePlannedExpenses: true, horizonYears: 30,
        notes: 'Lower returns, higher inflation, a void period on the apartment and no real pay rises.',
      },
      {
        id: 'sc-base', userId: USER, name: 'Base case', kind: 'base', isDefault: true,
        salaryGrowth: 0.035, inflation: 0.021, investmentReturn: 0.068, cashInterest: 0.024,
        propertyAppreciation: 0.022, monthlyInvestment: 900, monthlyFlexibleSpending: 1850,
        includeRentalIncome: true, includePlannedExpenses: true, horizonYears: 30,
        notes: 'Long-run nominal assumptions, in line with the current strategy rules.',
      },
      {
        id: 'sc-optimistic', userId: USER, name: 'Optimistic', kind: 'optimistic', isDefault: false,
        salaryGrowth: 0.05, inflation: 0.02, investmentReturn: 0.088, cashInterest: 0.031,
        propertyAppreciation: 0.035, monthlyInvestment: 1400, monthlyFlexibleSpending: 1650,
        includeRentalIncome: true, includePlannedExpenses: true, horizonYears: 30,
        notes: 'Promotion inside two years, strong markets, rent rising with the market.',
      },
    ],

    exchangeRates: [
      { baseCurrency: 'EUR', quoteCurrency: 'EUR', rate: 1, asOf: todayIso, source: 'identity' },
      { baseCurrency: 'EUR', quoteCurrency: 'USD', rate: 1.085, asOf: todayIso, source: 'demo' },
      { baseCurrency: 'EUR', quoteCurrency: 'GBP', rate: 0.84, asOf: todayIso, source: 'demo' },
      { baseCurrency: 'EUR', quoteCurrency: 'CHF', rate: 0.94, asOf: todayIso, source: 'demo' },
      { baseCurrency: 'USD', quoteCurrency: 'EUR', rate: USD_TO_EUR, asOf: todayIso, source: 'demo' },
      { baseCurrency: 'GBP', quoteCurrency: 'EUR', rate: 1.1904761905, asOf: todayIso, source: 'demo' },
      { baseCurrency: 'CHF', quoteCurrency: 'EUR', rate: 1.0638297872, asOf: todayIso, source: 'demo' },
    ],
  };
}

export const DEMO_USER_ID = USER;
