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
      title: 'Cash is not growing',
      detail: `Over the last ${window.length || 0} complete months you saved ${fmt(recentMonthlySaving)} a month on average. At this rate the ${fmt(securityFloor)} security target will not be reached.`,
    });
  }

  if (committedSoon > cash.liquidTotal) {
    signals.push({
      tone: 'bad',
      title: 'Planned spending exceeds available cash',
      detail: `${fmt(committedSoon)} of planned expenses fall due within three months, against ${fmt(cash.liquidTotal)} of liquid cash.`,
    });
  } else if (committedSoon > 0 && committedSoon > cash.liquidTotal * 0.5) {
    signals.push({
      tone: 'warn',
      title: 'Upcoming expenses will absorb much of your cash',
      detail: `${fmt(committedSoon)} is earmarked for planned spending in the next three months — over half of your liquid cash.`,
    });
  }

  const overCeiling = cash.accounts.filter((a) => a.overCeilingBy !== null);
  for (const account of overCeiling) {
    signals.push({
      tone: 'warn',
      title: `${account.name} is above its ceiling`,
      detail: `${fmt(account.overCeilingBy!)} more than the ${fmt(account.targetBalance ?? 0)} limit. Idle cash earns nothing here.`,
    });
  }

  const flexibleTrend = flexibleSpendingTrend(cashFlow);
  if (flexibleTrend !== null && flexibleTrend > 25) {
    signals.push({
      tone: 'warn',
      title: 'Flexible spending is climbing',
      detail: `Recent flexible spending is ${Math.round(flexibleTrend)}% above your 12-month average. That is allowed — it just pushes the security date out.`,
    });
  } else if (flexibleTrend !== null && flexibleTrend < -15) {
    signals.push({
      tone: 'good',
      title: 'Flexible spending has come down',
      detail: `Recent flexible spending is ${Math.abs(Math.round(flexibleTrend))}% below your 12-month average, which is accelerating the plan.`,
    });
  }

  const behindGoals = input.goals.filter((g) => g.goal.status === 'active' && !g.onTrack && g.goal.targetDate);
  if (behindGoals.length) {
    signals.push({
      tone: 'warn',
      title: `${behindGoals.length} goal${behindGoals.length > 1 ? 's are' : ' is'} behind schedule`,
      detail: behindGoals
        .slice(0, 3)
        .map((g) => `${g.goal.name} needs ${fmt(g.requiredMonthly ?? 0)}/month`)
        .join(' · '),
    });
  }

  if (cash.emergencyProgress >= 100) {
    signals.push({
      tone: 'good',
      title: 'Emergency fund is fully funded',
      detail: `Phase 1 is complete. ${nextPhase ? `${nextPhase.name} can be activated.` : ''}`.trim(),
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
      title: `${evaluation.rule.name} is not being met`,
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
    return 'Snowball learns how your money moves from one monthly check-in to the next. Add your accounts and income, then come back next month for your first verdict.';
  }

  if (input.shortfall <= 0) {
    return `Your emergency fund is complete at ${fmt(input.emergencyBalance)}. ${fmt(input.availableAboveFloor)} sits above the security floor and is genuinely free to allocate.`;
  }

  const gap = `You're ${fmt(input.shortfall)} away from your ${fmt(input.securityFloor)} security target.`;

  if (input.recentMonthlySaving <= 0) {
    return `${gap} Over the last three complete months your spending matched or exceeded your income, so the gap isn't closing. Trimming flexible spending is the fastest lever.`;
  }

  const pace = `At your recent savings rate of ${fmt(input.recentMonthlySaving)}/month, you're approximately ${input.monthsToSecurity} month${input.monthsToSecurity === 1 ? '' : 's'} away.`;

  if (input.committedSoon > 0) {
    return `${gap} ${pace} ${fmt(input.committedSoon)} of that is already earmarked for planned spending in the next three months.`;
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
            ? 'Fully funded. The floor is now a hard limit — do not spend below it.'
            : `${fmt(target - current)} to go · ${Math.round(progress)}% secured`,
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
          headline: `${fmt(0)} required`,
          detail: gated
            ? `No monthly investment required while the emergency fund is below target. Existing holdings stay invested${resumeAmount ? `; contributions resume at ${fmt(resumeAmount)}/month once it is full` : ''}.`
            : 'No minimum contribution set.',
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
            ? "This month's contribution has been made."
            : pending
              ? `Not yet paid this month. Last month's ${fmt(lastMonth)} met the minimum, so the standing order is on schedule.`
              : `${fmt(minimum - contributedThisMonth)} short of the monthly minimum.`,
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
        headline: `${fmt(available)} available`,
        detail:
          available > 0
            ? `Cash above the security floor, after ${fmt(committed(planned))} of planned spending. No monthly limit applies.`
            : `Cash is at or below the security floor, so flexible spending comes straight out of the emergency fund. Last month's flexible spending was ${fmt(lastMonth?.flexible ?? 0)}.`,
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
          detail: 'Add a property to activate this rule.', progress: null,
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
          headline: 'Awaiting tenant',
          detail:
            start !== null && start >= 0
              ? `${upcoming.name} is ${upcoming.rentalStatus.replace(/_/g, ' ')}. Rent expected to start in ${start} month${start === 1 ? '' : 's'}; the mortgage is currently paid from salary.`
              : `${upcoming.name} is ${upcoming.rentalStatus.replace(/_/g, ' ')}. The mortgage is currently paid from salary.`,
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
        headline: `${fmt(surplus)}/month to reserve`,
        detail:
          surplus >= 0
            ? `Rent on ${names} covers the mortgage and running costs; ${fmt(surplus)} accrues to the property reserve each month.`
            : `Rent on ${names} falls ${fmt(-surplus)}/month short of the mortgage and running costs — the gap comes from personal cash.`,
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
            ? 'Within the ceiling.'
            : `${fmt(held - ceiling)} above the ceiling — move it somewhere it earns interest.`,
        progress: ceiling > 0 ? Math.min(100, (held / ceiling) * 100) : null,
        currentValue: held,
        targetValue: ceiling,
      };
    }

    case 'allocation': {
      return {
        rule,
        status: 'progressing',
        headline: 'Target model set',
        detail: 'Actual weights are calculated live on the Investments page, with rebalance suggestions.',
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
        detail: `Three-month average savings rate against a ${target.toFixed(0)}% target.`,
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
        detail: debt === 0 ? 'No debt outstanding beyond the mortgage.' : 'Outstanding non-mortgage debt.',
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
        detail: rule.description ?? 'Custom rule — tracked manually.',
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
      let conditionText = 'Activated manually.';
      let met = false;

      if (exit === 'emergency_fund_reached' || condition === 'emergency_fund_reached') {
        progress = cash.emergencyProgress;
        met = emergencyMet;
        conditionText = emergencyMet
          ? 'Emergency fund target reached.'
          : `Unlocks when the emergency fund reaches its target (${Math.round(cash.emergencyProgress)}% there).`;
      } else if (condition === 'rental_income_started') {
        progress = rentStarted ? 100 : 0;
        met = rentStarted;
        conditionText = rentStarted
          ? 'Rental income has started.'
          : 'Unlocks when a property starts producing rental income.';
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
