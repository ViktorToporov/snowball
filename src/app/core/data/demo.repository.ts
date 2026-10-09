import { Injectable } from '@angular/core';

import { FinancialDataset, WritableTable } from '../models/domain.models';
import { buildDemoDataset } from './demo-dataset';
import { FinanceRepository } from './finance.repository';

const STORAGE_KEY = 'snowball.demo-data';

/** Which dataset collection each writable table maps onto. */
const TABLE_TO_COLLECTION: Record<WritableTable, keyof FinancialDataset> = {
  accounts: 'accounts',
  recurring_expenses: 'recurringExpenses',
  categories: 'categories',
  income_sources: 'incomeSources',
  investment_accounts: 'investmentAccounts',
  investments: 'investments',
  investment_transactions: 'investmentTransactions',
  investment_allocations: 'investmentAllocations',
  target_allocations: 'targetAllocations',
  properties: 'properties',
  other_assets: 'otherAssets',
  liabilities: 'liabilities',
  goals: 'goals',
  financial_phases: 'phases',
  strategy_rules: 'strategyRules',
  strategy_priorities: 'strategyPriorities',
  planned_expenses: 'plannedExpenses',
  forecast_scenarios: 'scenarios',
  net_worth_snapshots: 'netWorthSnapshots',
};

/**
 * In-memory stand-in for Supabase.
 *
 * Edits persist to localStorage for the session so the app behaves like
 * a real product — add a transaction, reload, it is still there — while
 * `reset()` puts the demo story back. Writes go through the exact same
 * `FinanceRepository` surface as the live implementation.
 */
@Injectable({ providedIn: 'root' })
export class DemoRepository implements FinanceRepository {
  readonly persistent = false;
  private data: FinancialDataset = this.restore();

  async load(_userId: string): Promise<FinancialDataset> {
    // A touch of latency, so skeleton states are exercised in demo mode too.
    await delay(180);
    return structuredClone(this.data);
  }

  async insert<T extends Record<string, unknown>>(table: WritableTable, values: T): Promise<Record<string, unknown>> {
    const record = { id: cryptoId(), userId: this.data.profile.id, ...values } as Record<string, unknown>;
    this.collection(table).unshift(record);
    this.persist();
    return record;
  }

  async update<T extends Record<string, unknown>>(
    table: WritableTable,
    id: string,
    values: T,
  ): Promise<Record<string, unknown>> {
    const list = this.collection(table);
    const index = list.findIndex((row) => row['id'] === id);
    if (index === -1) throw new Error('That record no longer exists.');
    list[index] = { ...list[index], ...values };
    this.persist();
    return list[index];
  }

  async remove(table: WritableTable, id: string): Promise<void> {
    const list = this.collection(table);
    const index = list.findIndex((row) => row['id'] === id);
    if (index !== -1) list.splice(index, 1);
    this.persist();
  }

  async updateProfile(_userId: string, values: Record<string, unknown>): Promise<void> {
    Object.assign(this.data.profile, values);
    this.persist();
  }

  /** Throw away local edits and rebuild the original demo story. */
  reset(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.data = buildDemoDataset();
  }

  private collection(table: WritableTable): Record<string, unknown>[] {
    const key = TABLE_TO_COLLECTION[table];
    return this.data[key] as unknown as Record<string, unknown>[];
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Quota exceeded or private browsing — the session keeps working in memory.
    }
  }

  private restore(): FinancialDataset {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return buildDemoDataset();
    try {
      const parsed = JSON.parse(stored) as FinancialDataset;
      // Guard against a stale shape from an older build.
      return parsed?.profile && Array.isArray(parsed.accounts) ? parsed : buildDemoDataset();
    } catch {
      return buildDemoDataset();
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cryptoId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}
