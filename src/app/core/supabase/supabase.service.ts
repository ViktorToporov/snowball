import { Injectable, signal } from '@angular/core';
import { SupabaseClient, createClient } from '@supabase/supabase-js';

import { environment } from '../../../environments/environment';
import { Database } from './database.types';

/**
 * Owns the single Supabase browser client.
 *
 * When no credentials are configured the service reports
 * `isConfigured === false` and the app falls back to the bundled demo
 * dataset, so `ng serve` produces a working product straight after
 * `npm install`.
 *
 * Only the publishable (anon) key is ever used here. Row Level Security
 * on every table is what actually keeps one user's data away from
 * another's — see `supabase/schema.sql` § 09.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private client: SupabaseClient<Database> | null = null;

  readonly isConfigured: boolean;
  readonly demoMode = signal(false);

  constructor() {
    const hasCredentials =
      !!environment.supabaseUrl &&
      !!environment.supabaseAnonKey &&
      !environment.supabaseUrl.includes('YOUR-PROJECT-REF');

    this.isConfigured = hasCredentials && !environment.forceDemoMode;
    this.demoMode.set(!this.isConfigured);

    if (this.isConfigured) {
      this.client = createClient<Database>(environment.supabaseUrl, environment.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'snowball.auth',
        },
        global: { headers: { 'x-application-name': 'snowball' } },
      });
    }
  }

  /**
   * The live client. Throws when Supabase is not configured — callers
   * on the demo path must check `isConfigured` first.
   */
  get db(): SupabaseClient<Database> {
    if (!this.client) {
      throw new Error(
        'Supabase is not configured. Add supabaseUrl and supabaseAnonKey to src/environments/environment.ts.',
      );
    }
    return this.client;
  }

  /** Null-safe accessor for code paths that tolerate demo mode. */
  get maybeDb(): SupabaseClient<Database> | null {
    return this.client;
  }
}
