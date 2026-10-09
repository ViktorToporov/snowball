/**
 * The strategy engine.
 *
 * Takes the user's declared strategy — phases, rules, priorities — and
 * the live financial picture, and answers the only question the
 * dashboard really needs to answer:
 *
 *     Am I following my plan, and is it going to work?
 *
 * It never invents a budget. The lifestyle rule is deliberately
 * open-ended: flexible spending is whatever is left above the security
 * floor, and it is allowed to vary wildly month to month.
 */

import { addMonths, formatCurrency, monthsUntil, startOfMonth, toIsoDate } from '../money/format';
import { FinancialDataset, FinancialPhase, StrategyRule } from '../models/domain.models';
import { CashFlowMonth, CashSummary, GoalView, PlannedExpenseView, round1, round2 } from './metrics';

/**
 * `getting-started` means there is not yet enough history to judge the
 * plan: no account, or fewer than one complete month between check-ins.
 * Judging a brand-new account as "off track" would be both wrong and
 * discouraging.
 */
export type StrategyStatus = 'getting-started' | 'on-track' | 'ahead' | 'attention' | 'off-track';

export interface RuleEvaluation {
  rule: StrategyRule;
  status: 'met' | 'progressing' | 'breached' | 'not-applicable';
  headline: string;
  detail: string;
  /** 0–100 where the rule has a measurable target. */
  progress: number | null;
  currentValue: number | null;
  targetValue: number | null;
}

export interface StrategyAssessment {
  status: StrategyStatus;
  headline: string;
  explanation: string;
  /** Months to fill the emergency fund at the recent savings rate. */
  monthsToSecurity: number | null;
  projectedSecurityDate: string | null;
  /** Trailing savings rate used for the projection. */
  recentMonthlySaving: number;
  /** Liquid cash the user can spend without breaching the floor. */
  availableAboveFloor: number;
  securityFloor: number;
  committedSoon: number;
  activePhase: FinancialPhase | null;
  nextPhase: FinancialPhase | null;
  phaseProgress: number;
  rules: RuleEvaluation[];
  signals: StrategySignal[];
}

export interface StrategySignal {
  tone: 'good' | 'warn' | 'bad' | 'info';
  title: string;
  detail: string;
}

export interface StrategyInputs {
  data: FinancialDataset;
  cash: CashSummary;
  cashFlow: readonly CashFlowMonth[];
  goals: readonly GoalView[];
  planned: readonly PlannedExpenseView[];
  essentialExpenses: number;
  monthlyIncome: number;
  portfolioValue: number;
  currency: string;
  locale: string;
}

export function assessStrategy(input: StrategyInputs): StrategyAssessment {
  const { data, cash, cashFlow, planned } = input;
  const fmt = (value: number) =>
    formatCurrency(value, { locale: input.locale, currency: input.currency, decimals: 0 });

  const activePhase = data.phases.find((p) => p.active) ?? data.phases[0] ?? null;
  const nextPhase = activePhase
    ? data.phases.find((p) => p.phaseOrder === activePhase.phaseOrder + 1) ?? null
    : null;

  /* -- how fast is cash actually accumulating? ---------------------- */
  // The current month is usually partial, so it is excluded from the rate.
  const completed = cashFlow.slice(0, -1);
  const window = completed.slice(-3);
  const recentMonthlySaving = window.length
    ? round2(window.reduce((total, m) => total + m.net, 0) / window.length)
    : 0;

  /* -- the security floor and what is already spoken for ------------ */
  const securityFloor = cash.emergencyTarget;
  const committedSoon = round2(
    planned.filter((p) => p.monthsUntil <= 3).reduce((total, p) => total + p.remaining, 0),
  );
  const availableAboveFloor = round2(Math.max(0, cash.liquidTotal - securityFloor - committedSoon));

  /* -- how long to full security? ----------------------------------- */
  const shortfall = cash.emergencyShortfall;
  const monthsToSecurity =
    shortfall <= 0 ? 0 : recentMonthlySaving > 0 ? Math.ceil(shortfall / recentMonthlySaving) : null;
  const projectedSecurityDate =
    monthsToSecurity === null ? null : toIsoDate(addMonths(startOfMonth(new Date()), monthsToSecurity));

  /* -- rules -------------------------------------------------------- */
  const rules = data.strategyRules
    .filter((rule) => rule.enabled && (!activePhase || rule.phaseId === null || rule.phaseId === activePhase.id))
    .sort((a, b) => a.priority - b.priority)
    .map((rule) => evaluateRule(rule, input, fmt));

  /* -- signals ------------------------------------------------------ */
  const signals: StrategySignal[] = [];

  const enoughHistory = data.accounts.some((a) => !a.isArchived) && window.length > 0;

  if (enoughHistory && shortfall > 0 && recentMonthlySaving <= 0) {
    signals.push({
      tone: 'bad',
      title: 'Your savings are not growing',
      detail: `Over the last ${window.length || 0} full months you saved ${fmt(recentMonthlySaving)} a month on average. At this pace you won't reach your ${fmt(securityFloor)} safety cushion.`,
    });
  }

  if (committedSoon > cash.liquidTotal) {
    signals.push({
      tone: 'bad',
      title: 'Upcoming expenses are more than the cash you have',
      detail: `${fmt(committedSoon)} of planned expenses are due in the next three months, but you have ${fmt(cash.liquidTotal)} of cash you can use now.`,
    });
  } else if (committedSoon > 0 && committedSoon > cash.liquidTotal * 0.5) {
    signals.push({
      tone: 'warn',
      title: 'Upcoming expenses will use much of your cash',
      detail: `${fmt(committedSoon)} is set aside for planned expenses in the next three months — more than half of the cash you can use now.`,
    });
  }

  const overCeiling = cash.accounts.filter((a) => a.overCeilingBy !== null);
  for (const account of overCeiling) {
    signals.push({
      tone: 'warn',
      title: `${account.name} is over its maximum`,
      detail: `${fmt(account.overCeilingBy!)} more than the ${fmt(account.targetBalance ?? 0)} you want to keep here. Money sitting here earns no interest.`,
    });
  }

  const flexibleTrend = flexibleSpendingTrend(cashFlow);
  if (flexibleTrend !== null && flexibleTrend > 25) {
    signals.push({
      tone: 'warn',
      title: 'Everyday spending is going up',
      detail: `Your everyday spending lately is ${Math.round(flexibleTrend)}% above your 12-month average. That's fine — it just means your safety cushion will take a bit longer to fill.`,
    });
  } else if (flexibleTrend !== null && flexibleTrend < -15) {
    signals.push({
      tone: 'good',
      title: 'Everyday spending has come down',
      detail: `Your everyday spending lately is ${Math.abs(Math.round(flexibleTrend))}% below your 12-month average, which moves your plan along faster.`,
    });
  }

  const behindGoals = input.goals.filter((g) => g.goal.status === 'active' && !g.onTrack && g.goal.targetDate);
  if (behindGoals.length) {
    signals.push({
      tone: 'warn',
      title: `${behindGoals.length} goal${behindGoals.length > 1 ? 's are' : ' is'} behind schedule`,
      detail: behindGoals
        .slice(0, 3)
        .map((g) => `${g.goal.name} needs ${fmt(g.requiredMonthly ?? 0)} a month`)
        .join(' · '),
    });
  }

  // A target of zero reads as 100% full; that is "not set", not "done".
  if (cash.emergencyTarget > 0 && cash.emergencyProgress >= 100) {
    signals.push({
      tone: 'good',
      title: 'Your safety cushion is full',
      detail: `Stage 1 is done. ${nextPhase ? `You can move on to ${nextPhase.name}.` : ''}`.trim(),
    });
  }

  // A rule the user wrote for themselves, currently not being followed,
  // belongs in the summary — otherwise the headline can say "ahead" while
  // the rules list is full of breaches.
  const breached = rules.filter((evaluation) => evaluation.status === 'breached');
  for (const evaluation of breached) {
    // The cash ceiling already has its own, more specific signal.
    if (evaluation.rule.ruleType === 'cash_ceiling') continue;
    signals.push({
      tone: 'warn',
      title: `${evaluation.rule.name} isn't being met`,
      detail: `${evaluation.headline} — ${evaluation.detail}`,
    });
  }

  /* -- overall status ----------------------------------------------- */
  const status = deriveStatus({
    enoughHistory,
    shortfall,
    recentMonthlySaving,
    monthsToSecurity,
    committedSoon,
    liquidTotal: cash.liquidTotal,
    signals,
  });

  const explanation = buildExplanation({
    status,
    shortfall,
    monthsToSecurity,
    recentMonthlySaving,
    securityFloor,
    availableAboveFloor,
    committedSoon,
    emergencyBalance: cash.emergencyBalance,
    fmt,
  });

  return {
    status,
    headline: HEADLINES[status],
    explanation,
    monthsToSecurity,
    projectedSecurityDate,
    recentMonthlySaving,
    availableAboveFloor,
    securityFloor,
    committedSoon,
    activePhase,
    nextPhase,
    phaseProgress: round1(cash.emergencyProgress),
    rules,
    signals,
  };
}

const HEADLINES: Record<StrategyStatus, string> = {
  'getting-started': 'Getting started',
  ahead: 'Ahead of plan',
  'on-track': 'On track',
  attention: 'Needs attention',
  'off-track': 'Off track',
};

function deriveStatus(input: {
  enoughHistory: boolean;
  shortfall: number;
  recentMonthlySaving: number;
  monthsToSecurity: number | null;
  committedSoon: number;
  liquidTotal: number;
  signals: readonly StrategySignal[];
}): StrategyStatus {
  if (input.signals.some((s) => s.tone === 'bad')) return 'off-track';
  if (!input.enoughHistory) return 'getting-started';

  // Nothing left to build. "Ahead" is reserved for a clean sheet: cash
  // still accumulating *and* nothing flagged. Otherwise the headline
  // would contradict the warnings sitting underneath it.
  if (input.shortfall <= 0) {
    const flagged = input.signals.some((s) => s.tone === 'warn');
    if (flagged) return 'on-track';
    return input.recentMonthlySaving > 0 ? 'ahead' : 'on-track';
  }

  if (input.recentMonthlySaving <= 0) return 'off-track';
  if (input.monthsToSecurity !== null && input.monthsToSecurity > 24) return 'attention';
  if (input.committedSoon > input.liquidTotal * 0.5) return 'attention';
  if (input.signals.some((s) => s.tone === 'warn')) return 'attention';
  return 'on-track';
}

function buildExplanation(input: {
  status: StrategyStatus;
  shortfall: number;
  monthsToSecurity: number | null;
  recentMonthlySaving: number;
  securityFloor: number;
  availableAboveFloor: number;
  committedSoon: number;
  emergencyBalance: number;
  fmt: (value: number) => string;
}): string {
  const { fmt } = input;

  if (input.status === 'getting-started') {
    return 'Snowball learns how your money moves from one monthly check-in to the next. Add your accounts and income, then come back next month to see how your plan is going.';
  }

  if (input.shortfall <= 0) {
    return `Your safety cushion is full at ${fmt(input.emergencyBalance)}. ${fmt(input.availableAboveFloor)} is free to spend or invest.`;
  }

  const gap = `You're ${fmt(input.shortfall)} away from your ${fmt(input.securityFloor)} safety cushion.`;

  if (input.recentMonthlySaving <= 0) {
    return `${gap} Over the last three full months you spent as much as you earned (or more), so the gap isn't closing. Spending a little less day to day is the quickest way to change that.`;
  }

  const pace = `If you keep saving ${fmt(input.recentMonthlySaving)} a month like you have lately, you'll get there in about ${input.monthsToSecurity} month${input.monthsToSecurity === 1 ? '' : 's'}.`;

  if (input.committedSoon > 0) {
    return `${gap} ${pace} ${fmt(input.committedSoon)} of your cash is already set aside for planned expenses in the next three months.`;
  }

  return `${gap} ${pace}`;
}

/** Recent flexible spending vs the 12-month average, as a percentage. */
function flexibleSpendingTrend(cashFlow: readonly CashFlowMonth[]): number | null {
  const completed = cashFlow.slice(0, -1);
  if (completed.length < 6) return null;

  const recent = completed.slice(-3);
  const baseline = completed.slice(-12);
  const recentAverage = recent.reduce((a, b) => a + b.flexible, 0) / recent.length;
  const baselineAverage = baseline.reduce((a, b) => a + b.flexible, 0) / baseline.length;
  if (baselineAverage <= 0) return null;

  return ((recentAverage - baselineAverage) / baselineAverage) * 100;
}

/* ==================================================================== */
/* Rule evaluation                                                       */
/* ==================================================================== */

function evaluateRule(
  rule: StrategyRule,
  input: StrategyInputs,
  fmt: (value: number) => string,
): RuleEvaluation {
  const { cash, data, planned, cashFlow } = input;

  switch (rule.ruleType) {
    case 'emergency_fund': {
      const target = rule.targetValue ?? cash.emergencyTarget;
      const current = cash.emergencyBalance;
      const progress = target > 0 ? Math.min(100, (current / target) * 100) : 100;
      return {
        rule,
        status: current >= target ? 'met' : 'progressing',
        headline: `${fmt(current)} / ${fmt(target)}`,
        detail:
          current >= target
            ? 'Full. Try not to dip below this amount.'
            : `${fmt(target - current)} to go · ${Math.round(progress)}% there`,
        progress,
        currentValue: current,
        targetValue: target,
      };
    }

    case 'investment': {
      const minimum = Number(rule.configuration['minimum_monthly'] ?? rule.targetValue ?? 0);
      const resumeWhen = String(rule.configuration['resume_when'] ?? '');
      const contributedThisMonth = monthlyContributions(data, input);

      if (minimum === 0) {
        const gated = resumeWhen === 'emergency_fund_reached' && cash.emergencyShortfall > 0;
        const resumeAmount = Number(rule.configuration['resume_amount'] ?? 0);
        return {
          rule,
          status: gated ? 'met' : 'not-applicable',
          headline: 'Nothing required',
          detail: gated
            ? `No need to invest each month while your safety cushion is still filling up. What you've already invested stays invested${resumeAmount ? `; monthly investing starts again at ${fmt(resumeAmount)} a month once it's full` : ''}.`
            : 'No minimum monthly amount set.',
          progress: null,
          currentValue: contributedThisMonth,
          targetValue: 0,
        };
      }

      // Judging the month before the contribution is due would mark every
      // plan "breached" for the first three weeks of every month, so the
      // previous month stands as evidence until this month's has landed.
      const lastMonth = previousMonthContributions(data);
      const pending = contributedThisMonth < minimum && lastMonth >= minimum;

      return {
        rule,
        status: contributedThisMonth >= minimum ? 'met' : pending ? 'progressing' : 'breached',
        headline: `${fmt(contributedThisMonth)} / ${fmt(minimum)}`,
        detail:
          contributedThisMonth >= minimum
            ? "You've invested this month's amount."
            : pending
              ? `Not paid in yet this month. Last month's ${fmt(lastMonth)} was enough, so you're on schedule.`
              : `${fmt(minimum - contributedThisMonth)} short of your monthly minimum.`,
        progress: minimum > 0 ? Math.min(100, (contributedThisMonth / minimum) * 100) : null,
        currentValue: contributedThisMonth,
        targetValue: minimum,
      };
    }

    case 'lifestyle': {
      const lastMonth = cashFlow.slice(0, -1).at(-1);
      const available = Math.max(0, cash.liquidTotal - cash.emergencyTarget - committed(planned));
      return {
        rule,
        status: available > 0 ? 'met' : 'progressing',
        headline: `${fmt(available)} free`,
        detail:
          available > 0
            ? `Free to spend or invest, after your safety cushion and ${fmt(committed(planned))} of planned expenses. There's no monthly limit.`
            : `Your cash is at or below your safety cushion, so everyday spending is coming out of your emergency money. Last month's everyday spending was ${fmt(lastMonth?.flexible ?? 0)}.`,
        progress: null,
        currentValue: available,
        targetValue: null,
      };
    }

    case 'property': {
      // The rule is about *let* property. With several properties on the
      // books, evaluating only the first one would happily grade the
      // family home against a rental policy.
      const letProperties = data.properties.filter((p) => p.rentalStatus === 'rented' && p.monthlyRent > 0);
      const reserveTarget =
        Number(rule.configuration['reserve_target'] ?? rule.targetValue ?? 0) ||
        letProperties.reduce((total, p) => total + p.maintenanceReserveTarget, 0);

      if (!data.properties.length) {
        return {
          rule, status: 'not-applicable', headline: 'No property',
          detail: 'Add a property to start this check.', progress: null,
          currentValue: null, targetValue: reserveTarget || null,
        };
      }

      if (!letProperties.length) {
        // Nothing is let yet — report on whichever tenancy starts soonest.
        const upcoming = [...data.properties]
          .filter((p) => p.rentalStatus !== 'owner_occupied')
          .sort((a, b) => (a.expectedRentStart ?? '9999').localeCompare(b.expectedRentStart ?? '9999'))[0]
          ?? data.properties[0];

        const start = upcoming.expectedRentStart ? monthsUntil(upcoming.expectedRentStart) : null;
        return {
          rule,
          status: 'not-applicable',
          headline: 'Waiting for a tenant',
          detail:
            start !== null && start >= 0
              ? `${upcoming.name} is ${upcoming.rentalStatus.replace(/_/g, ' ')}. Rent should start in ${start} month${start === 1 ? '' : 's'}; until then the mortgage is paid from your salary.`
              : `${upcoming.name} is ${upcoming.rentalStatus.replace(/_/g, ' ')}. The mortgage is paid from your salary for now.`,
          progress: reserveTarget > 0 ? (upcoming.maintenanceReserve / reserveTarget) * 100 : null,
          currentValue: upcoming.maintenanceReserve,
          targetValue: reserveTarget || null,
        };
      }

      const surplus = round2(
        letProperties.reduce(
          (total, p) => total + p.monthlyRent - p.monthlyPropertyExpenses - p.monthlyPayment,
          0,
        ),
      );
      const reserve = letProperties.reduce((total, p) => total + p.maintenanceReserve, 0);
      const names = letProperties.map((p) => p.name).join(', ');

      return {
        rule,
        status: surplus >= 0 ? 'met' : 'breached',
        headline: `${fmt(surplus)} a month to repair fund`,
        detail:
          surplus >= 0
            ? `Rent on ${names} covers the mortgage and running costs; ${fmt(surplus)} goes into the repair fund each month.`
            : `Rent on ${names} is ${fmt(-surplus)} a month short of the mortgage and running costs — the gap comes from your own cash.`,
        progress: reserveTarget > 0 ? Math.min(100, (reserve / reserveTarget) * 100) : null,
        currentValue: reserve,
        targetValue: reserveTarget || null,
      };
    }

    case 'cash_ceiling': {
      const accountType = String(rule.configuration['account_type'] ?? 'physical_cash');
      const ceiling = rule.targetValue ?? data.profile.physicalCashCeiling;
      const held = cash.accounts
        .filter((a) => a.accountType === accountType)
        .reduce((total, a) => total + a.balanceBase, 0);

      return {
        rule,
        status: held <= ceiling ? 'met' : 'breached',
        headline: `${fmt(held)} / ${fmt(ceiling)}`,
        detail:
          held <= ceiling
            ? 'Within your maximum.'
            : `${fmt(held - ceiling)} over your maximum — move it somewhere it earns interest.`,
        progress: ceiling > 0 ? Math.min(100, (held / ceiling) * 100) : null,
        currentValue: held,
        targetValue: ceiling,
      };
    }

    case 'allocation': {
      return {
        rule,
        status: 'progressing',
        headline: 'Plan set',
        detail: 'See your mix vs your plan, and how to get back to it, on the Investments page.',
        progress: null,
        currentValue: input.portfolioValue,
        targetValue: null,
      };
    }

    case 'savings_rate': {
      const target = rule.targetPercentage ?? 0;
      const recent = cashFlow.slice(0, -1).slice(-3);
      const actual = recent.length
        ? recent.reduce((total, m) => total + m.savingsRate, 0) / recent.length
        : 0;
      return {
        rule,
        status: actual >= target ? 'met' : 'breached',
        headline: `${actual.toFixed(0)}% / ${target.toFixed(0)}%`,
        detail: `Share of income you saved, on average over the last three months, against your ${target.toFixed(0)}% goal.`,
        progress: target > 0 ? Math.min(100, (actual / target) * 100) : null,
        currentValue: round1(actual),
        targetValue: target,
      };
    }

    case 'debt': {
      const debt = data.liabilities.reduce((total, l) => total + l.balance, 0);
      return {
        rule,
        status: debt <= (rule.targetValue ?? 0) ? 'met' : 'progressing',
        headline: fmt(debt),
        detail: debt === 0 ? 'No debt apart from the mortgage.' : 'Debt you still owe, not counting the mortgage.',
        progress: null,
        currentValue: debt,
        targetValue: rule.targetValue,
      };
    }

    default:
      return {
        rule,
        status: 'not-applicable',
        headline: rule.targetValue !== null ? fmt(rule.targetValue) : '—',
        detail: rule.description ?? 'Your own check — keep an eye on it yourself.',
        progress: null,
        currentValue: null,
        targetValue: rule.targetValue,
      };
  }
}

function committed(planned: readonly PlannedExpenseView[]): number {
  return round2(planned.filter((p) => p.monthsUntil <= 3).reduce((total, p) => total + p.remaining, 0));
}

/** Money paid into investments during the current calendar month. */
function monthlyContributions(data: FinancialDataset, input: StrategyInputs): number {
  const monthStart = toIsoDate(startOfMonth(new Date()));
  return round2(
    data.investmentTransactions
      .filter((t) => t.transactionType === 'buy' && t.transactionDate >= monthStart)
      .reduce((total, t) => total + (t.amount ?? t.quantity * t.price), 0),
  );
}

/** The same figure for the last complete calendar month. */
function previousMonthContributions(data: FinancialDataset): number {
  const thisMonth = startOfMonth(new Date());
  const from = toIsoDate(addMonths(thisMonth, -1));
  const to = toIsoDate(thisMonth);
  return round2(
    data.investmentTransactions
      .filter((t) => t.transactionType === 'buy' && t.transactionDate >= from && t.transactionDate < to)
      .reduce((total, t) => total + (t.amount ?? t.quantity * t.price), 0),
  );
}

/* ==================================================================== */
/* Phase transitions                                                     */
/* ==================================================================== */

export interface PhaseEvaluation {
  phase: FinancialPhase;
  state: 'complete' | 'active' | 'locked';
  progress: number;
  conditionText: string;
  canActivate: boolean;
}

/**
 * Works out where each phase stands. Phase 1 completes when the
 * emergency fund is full; Phase 3 unlocks when rental income starts.
 */
export function evaluatePhases(input: StrategyInputs): PhaseEvaluation[] {
  const { data, cash } = input;
  const rentStarted = data.properties.some((p) => p.rentalStatus === 'rented' && p.monthlyRent > 0);
  const emergencyMet = cash.emergencyShortfall <= 0;

  return [...data.phases]
    .sort((a, b) => a.phaseOrder - b.phaseOrder)
    .map((phase) => {
      const condition = String(phase.entryCondition['type'] ?? '');
      const exit = String(phase.exitCondition['type'] ?? '');

      let progress = 0;
      let conditionText = 'You start this stage yourself.';
      let met = false;

      if (exit === 'emergency_fund_reached' || condition === 'emergency_fund_reached') {
        progress = cash.emergencyProgress;
        met = emergencyMet;
        conditionText = emergencyMet
          ? 'Your safety cushion is full.'
          : `Opens up when your safety cushion is full (${Math.round(cash.emergencyProgress)}% there).`;
      } else if (condition === 'rental_income_started') {
        progress = rentStarted ? 100 : 0;
        met = rentStarted;
        conditionText = rentStarted
          ? 'Rent is coming in.'
          : 'Opens up when a property starts bringing in rent.';
      }

      const state: PhaseEvaluation['state'] = phase.active
        ? 'active'
        : phase.completedAt || (phase.phaseOrder === 1 && emergencyMet)
          ? 'complete'
          : 'locked';

      return {
        phase,
        state,
        progress: round1(phase.active ? progress : state === 'complete' ? 100 : progress),
        conditionText,
        // A finished phase is not something to switch back on.
        canActivate: !phase.active && met && state !== 'complete',
      };
    });
}
