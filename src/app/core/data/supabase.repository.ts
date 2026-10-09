import { Injectable, inject } from '@angular/core';
import { PostgrestError } from '@supabase/supabase-js';

import { addMonths, startOfMonth, toIsoDate } from '../money/format';
import { FinancialDataset, IncomeEntryInput, SnapshotRecord, WritableTable } from '../models/domain.models';
import { SupabaseService } from '../supabase/supabase.service';
import { FinanceRepository } from './finance.repository';
import * as map from './mappers';
import { toRow } from './mappers';

/**
 * Live Supabase implementation.
 *
 * `load()` fires every table read in parallel — RLS scopes each one to
 * the signed-in user, so no `.eq('user_id', …)` filter is needed for
 * correctness. It is included anyway on the larger tables because it
 * lets Postgres use the user-scoped indexes.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseRepository implements FinanceRepository {
  private readonly supabase = inject(SupabaseService);
  readonly persistent = true;

  async load(userId: string): Promise<FinancialDataset> {
    const db = this.supabase.db;

    const [
      profile, accounts, categories, recurringExpenses, incomeSources, incomeHistory,
      investmentAccounts, investments, investmentTransactions, investmentAllocations,
      targetAllocations, properties, propertyValuations, otherAssets, liabilities,
      goals, phases, strategyRules, strategyPriorities, plannedExpenses,
      netWorthSnapshots, portfolioSnapshots, accountBalanceSnapshots, scenarios, exchangeRates,
    ] = await Promise.all([
      db.from('profiles').select('*').eq('id', userId).maybeSingle(),
      db.from('accounts').select('*').eq('user_id', userId).order('sort_order'),
      db.from('categories').select('*').order('sort_order'),
      db.from('recurring_expenses').select('*').eq('user_id', userId).order('name'),
      db.from('income_sources').select('*').eq('user_id', userId),
      db.from('income_history').select('*').eq('user_id', userId).order('period_month'),
      db.from('investment_accounts').select('*').eq('user_id', userId),
      db.from('investments').select('*').eq('user_id', userId),
      db.from('investment_transactions').select('*').eq('user_id', userId).order('transaction_date'),
      db.from('investment_allocations').select('*').eq('user_id', userId),
      db.from('target_allocations').select('*').eq('user_id', userId).order('sort_order'),
      db.from('properties').select('*').eq('user_id', userId),
      db.from('property_valuations').select('*').eq('user_id', userId).order('valuation_date'),
      db.from('other_assets').select('*').eq('user_id', userId),
      db.from('liabilities').select('*').eq('user_id', userId),
      db.from('goals').select('*').eq('user_id', userId),
      db.from('financial_phases').select('*').eq('user_id', userId).order('phase_order'),
      db.from('strategy_rules').select('*').eq('user_id', userId).order('priority'),
      db.from('strategy_priorities').select('*').eq('user_id', userId).order('rank'),
      db.from('planned_expenses').select('*').eq('user_id', userId).order('target_date'),
      db.from('net_worth_snapshots').select('*').eq('user_id', userId).order('snapshot_date'),
      db.from('portfolio_snapshots').select('*').eq('user_id', userId).order('snapshot_date'),
      db.from('account_balance_snapshots').select('*').eq('user_id', userId).order('snapshot_date'),
      db.from('forecast_scenarios').select('*').eq('user_id', userId),
      db.from('exchange_rates').select('*'),
    ]);

    if (!profile.data) {
      throw new Error(
        'No profile row found for this user. The `handle_new_user` trigger in schema.sql should create one on sign-up.',
      );
    }

    return {
      profile: map.mapProfile(profile.data),
      accounts: rows(accounts).map(map.mapAccount),
      categories: rows(categories).map(map.mapCategory),
      recurringExpenses: rows(recurringExpenses).map(map.mapRecurringExpense),
      incomeSources: rows(incomeSources).map(map.mapIncomeSource),
      incomeHistory: rows(incomeHistory).map(map.mapIncomeHistory),
      investmentAccounts: rows(investmentAccounts).map(map.mapInvestmentAccount),
      investments: rows(investments).map(map.mapInvestment),
      investmentTransactions: rows(investmentTransactions).map(map.mapInvestmentTransaction),
      investmentAllocations: rows(investmentAllocations).map(map.mapInvestmentAllocation),
      targetAllocations: rows(targetAllocations).map(map.mapTargetAllocation),
      properties: rows(properties).map(map.mapProperty),
      propertyValuations: rows(propertyValuations).map(map.mapPropertyValuation),
      otherAssets: rows(otherAssets).map(map.mapOtherAsset),
      liabilities: rows(liabilities).map(map.mapLiability),
      goals: rows(goals).map(map.mapGoal),
      phases: rows(phases).map(map.mapPhase),
      strategyRules: rows(strategyRules).map(map.mapStrategyRule),
      strategyPriorities: rows(strategyPriorities).map(map.mapStrategyPriority),
      plannedExpenses: rows(plannedExpenses).map(map.mapPlannedExpense),
      netWorthSnapshots: rows(netWorthSnapshots).map(map.mapNetWorthSnapshot),
      portfolioSnapshots: rows(portfolioSnapshots).map(map.mapPortfolioSnapshot),
      accountBalanceSnapshots: rows(accountBalanceSnapshots).map(map.mapAccountBalanceSnapshot),
      scenarios: rows(scenarios).map(map.mapScenario),
      exchangeRates: rows(exchangeRates).map(map.mapExchangeRate),
    };
  }

  async insert<T extends Record<string, unknown>>(table: WritableTable, values: T): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase.db
      .from(table)
      .insert(toRow(values) as never)
      .select()
      .single();
    if (error) throw describe(error);
    return data as Record<string, unknown>;
  }

  async update<T extends Record<string, unknown>>(
    table: WritableTable,
    id: string,
    values: T,
  ): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase.db
      .from(table)
      .update(toRow(values) as never)
      .eq('id', id)
      .select()
      .single();
    if (error) throw describe(error);
    return data as Record<string, unknown>;
  }

  async remove(table: WritableTable, id: string): Promise<void> {
    const { error } = await this.supabase.db.from(table).delete().eq('id', id);
    if (error) throw describe(error);
  }

  async updateProfile(userId: string, values: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabase.db
      .from('profiles')
      .update(toRow(values) as never)
      .eq('id', userId);
    if (error) throw describe(error);
  }

  async recordSnapshot(userId: string, snapshot: SnapshotRecord): Promise<void> {
    const db = this.supabase.db;
    const date = snapshot.snapshotDate;
    const monthStart = toIsoDate(startOfMonth(new Date(`${date}T00:00:00`)));
    const nextMonth = toIsoDate(addMonths(new Date(`${monthStart}T00:00:00`), 1));

    // One reading per month: drop earlier readings from this month first.
    const tables = ['account_balance_snapshots', 'net_worth_snapshots', 'portfolio_snapshots'] as const;
    for (const table of tables) {
      const { error } = await db
        .from(table)
        .delete()
        .eq('user_id', userId)
        .gte('snapshot_date', monthStart)
        .lt('snapshot_date', nextMonth)
        .neq('snapshot_date', date);
      if (error) throw describe(error);
    }

    if (snapshot.accounts.length) {
      const { error } = await db.from('account_balance_snapshots').upsert(
        snapshot.accounts.map((a) => ({
          user_id: userId,
          account_id: a.accountId,
          snapshot_date: date,
          balance: a.balance,
        })) as never,
        { onConflict: 'account_id,snapshot_date' },
      );
      if (error) throw describe(error);
    }

    const worth = await db.from('net_worth_snapshots').upsert(
      { ...toRow(snapshot.netWorth), user_id: userId, snapshot_date: date, currency: snapshot.currency } as never,
      { onConflict: 'user_id,snapshot_date' },
    );
    if (worth.error) throw describe(worth.error);

    const portfolio = await db.from('portfolio_snapshots').upsert(
      { ...toRow(snapshot.portfolio), user_id: userId, snapshot_date: date, currency: snapshot.currency } as never,
      { onConflict: 'user_id,snapshot_date' },
    );
    if (portfolio.error) throw describe(portfolio.error);
  }

  async recordIncome(userId: string, entries: readonly IncomeEntryInput[]): Promise<void> {
    if (!entries.length) return;
    const { error } = await this.supabase.db.from('income_history').upsert(
      entries.map((e) => ({
        user_id: userId,
        income_source_id: e.incomeSourceId,
        period_month: e.periodMonth,
        net_amount: e.netAmount,
        currency: e.currency,
      })) as never,
      { onConflict: 'user_id,income_source_id,period_month' },
    );
    if (error) throw describe(error);
  }
}

interface QueryResult<T> {
  data: T[] | null;
  error: PostgrestError | null;
}

function rows<T>(result: QueryResult<T>): T[] {
  if (result.error) throw describe(result.error);
  return result.data ?? [];
}

function describe(error: PostgrestError): Error {
  if (error.code === '42501' || error.message.toLowerCase().includes('row-level security')) {
    return new Error('That record belongs to another account, or your session has expired.');
  }
  if (error.code === '23505') return new Error('A record with those details already exists.');
  if (error.code === '23514') return new Error(`That value is not allowed: ${error.details ?? error.message}`);
  return new Error(error.message);
}
