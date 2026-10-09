import { InjectionToken } from '@angular/core';

import { FinancialDataset, WritableTable } from '../models/domain.models';

/**
 * The application's only door to persistence.
 *
 * Two implementations exist — `SupabaseRepository` and `DemoRepository`
 * — and `provideFinanceRepository()` picks between them at bootstrap.
 * Feature code never imports either directly, which is what lets the
 * whole product run without a backend.
 */
export interface FinanceRepository {
  /** Load everything the app needs in one pass. */
  load(userId: string): Promise<FinancialDataset>;

  insert<T extends Record<string, unknown>>(table: WritableTable, values: T): Promise<Record<string, unknown>>;

  update<T extends Record<string, unknown>>(
    table: WritableTable,
    id: string,
    values: T,
  ): Promise<Record<string, unknown>>;

  remove(table: WritableTable, id: string): Promise<void>;

  updateProfile(userId: string, values: Record<string, unknown>): Promise<void>;

  /** True when writes go to a real database. */
  readonly persistent: boolean;
}

export const FINANCE_REPOSITORY = new InjectionToken<FinanceRepository>('FINANCE_REPOSITORY');
