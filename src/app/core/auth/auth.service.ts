import { Injectable, computed, inject, signal } from '@angular/core';
import { Session, User } from '@supabase/supabase-js';

import { SupabaseService } from '../supabase/supabase.service';

export interface AuthResult {
  ok: boolean;
  message?: string;
  /** True when sign-up succeeded but the address still needs confirming. */
  needsConfirmation?: boolean;
}

const DEMO_USER: User = {
  id: '00000000-0000-4000-a000-0000000000d1',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'demo@snowball.app',
  app_metadata: { provider: 'demo' },
  user_metadata: { display_name: 'Demo User' },
  created_at: new Date().toISOString(),
} as User;

const DEMO_FLAG = 'snowball.demo-session';

/**
 * Supabase email/password authentication with session persistence.
 *
 * In demo mode (no Supabase credentials) it keeps a flag in
 * localStorage so the sign-in flow, guards and sign-out all still
 * behave exactly as they do against a real backend.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SupabaseService);

  private readonly _session = signal<Session | null>(null);
  private readonly _user = signal<User | null>(null);
  private readonly _ready = signal(false);

  readonly user = this._user.asReadonly();
  readonly session = this._session.asReadonly();
  /** True once the initial session lookup has finished. */
  readonly ready = this._ready.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);
  readonly displayName = computed(
    () => (this._user()?.user_metadata?.['display_name'] as string | undefined) ?? this._user()?.email ?? 'Account',
  );
  readonly isDemo = computed(() => !this.supabase.isConfigured);

  constructor() {
    void this.restore();
  }

  private async restore(): Promise<void> {
    if (!this.supabase.isConfigured) {
      if (localStorage.getItem(DEMO_FLAG) === '1') this._user.set(DEMO_USER);
      this._ready.set(true);
      return;
    }

    const { data } = await this.supabase.db.auth.getSession();
    this.apply(data.session);

    this.supabase.db.auth.onAuthStateChange((_event, session) => this.apply(session));
    this._ready.set(true);
  }

  private apply(session: Session | null): void {
    this._session.set(session);
    this._user.set(session?.user ?? null);
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    if (!this.supabase.isConfigured) return this.demoSignIn();

    const { data, error } = await this.supabase.db.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: friendly(error.message) };
    this.apply(data.session);
    return { ok: true };
  }

  async signUp(email: string, password: string, displayName: string): Promise<AuthResult> {
    if (!this.supabase.isConfigured) return this.demoSignIn();

    const { data, error } = await this.supabase.db.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    if (error) return { ok: false, message: friendly(error.message) };

    // With "Confirm email" enabled Supabase returns a user but no session.
    if (data.user && !data.session) return { ok: true, needsConfirmation: true };

    this.apply(data.session);
    return { ok: true };
  }

  async sendPasswordReset(email: string): Promise<AuthResult> {
    if (!this.supabase.isConfigured) {
      return { ok: false, message: 'Password reset is unavailable in demo mode.' };
    }
    const { error } = await this.supabase.db.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/sign-in`,
    });
    return error ? { ok: false, message: friendly(error.message) } : { ok: true };
  }

  async signOut(): Promise<void> {
    if (!this.supabase.isConfigured) {
      localStorage.removeItem(DEMO_FLAG);
      this._user.set(null);
      return;
    }
    await this.supabase.db.auth.signOut();
    this.apply(null);
  }

  /** Signs into the bundled demo dataset — no network, no credentials. */
  demoSignIn(): AuthResult {
    localStorage.setItem(DEMO_FLAG, '1');
    this._user.set(DEMO_USER);
    this._ready.set(true);
    return { ok: true };
  }

  /** Resolves once `restore()` has settled — used by the auth guards. */
  async whenReady(): Promise<void> {
    if (this._ready()) return;
    await new Promise<void>((resolve) => {
      const poll = setInterval(() => {
        if (this._ready()) {
          clearInterval(poll);
          resolve();
        }
      }, 20);
      // Never block navigation indefinitely on a slow network.
      setTimeout(() => {
        clearInterval(poll);
        resolve();
      }, 4000);
    });
  }
}

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'That email and password combination is not recognised.';
  if (m.includes('email not confirmed')) return 'Confirm your email address before signing in.';
  if (m.includes('already registered')) return 'An account already exists for that email address.';
  if (m.includes('password should be')) return 'Passwords must be at least 6 characters.';
  if (m.includes('rate limit')) return 'Too many attempts. Try again in a minute.';
  return message;
}
