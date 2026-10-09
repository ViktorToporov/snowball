import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { ToastService } from '../../core/ui/toast.service';
import { LogoComponent } from '../../shared/ui/logo.component';

type Mode = 'sign-in' | 'sign-up';

@Component({
  selector: 'sb-auth-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth">
      <!-- Left: the pitch -->
      <section class="auth__aside">
        <div class="auth__aside-inner">
          <sb-logo [large]="true" [showTagline]="true" />

          <div class="auth__pitch">
            <h1 class="display">
              Know exactly where<br />
              you stand.
            </h1>
            <p class="auth__lede">
              Snowball tracks cash, investments, property and debt in one place — then tells you whether
              you're actually following your plan.
            </p>
          </div>

          <ul class="auth__points">
            @for (point of points; track point.title) {
              <li>
                <span class="auth__point-dot"></span>
                <div>
                  <p class="auth__point-title">{{ point.title }}</p>
                  <p class="auth__point-text">{{ point.text }}</p>
                </div>
              </li>
            }
          </ul>
        </div>
      </section>

      <!-- Right: the form -->
      <section class="auth__panel">
        <div class="auth__card">
          <div class="auth__mobile-brand"><sb-logo [showTagline]="true" /></div>

          <div class="col" style="gap:4px">
            <h2 class="h1">{{ mode() === 'sign-in' ? 'Welcome back' : 'Create your account' }}</h2>
            <p class="small muted">
              {{
                mode() === 'sign-in'
                  ? 'Sign in to pick up where you left off.'
                  : 'A few seconds to set up. Your data stays yours.'
              }}
            </p>
          </div>

          @if (demoMode()) {
            <div class="estimate-note">
              <span>
                <strong>Demo mode.</strong> No Supabase project is configured, so Snowball is running on a
                bundled sample dataset held in this browser. Add your credentials to
                <code>src/environments/environment.ts</code> to connect a real backend.
              </span>
            </div>
          }

          <form [formGroup]="form" (ngSubmit)="submit()" class="col" style="gap:14px">
            @if (mode() === 'sign-up') {
              <div class="field">
                <label class="field__label" for="displayName">Name</label>
                <input id="displayName" class="input" formControlName="displayName" autocomplete="name" placeholder="Alex Murphy" />
              </div>
            }

            <div class="field">
              <label class="field__label" for="email">Email</label>
              <input
                id="email"
                class="input"
                type="email"
                formControlName="email"
                autocomplete="email"
                placeholder="you@example.com"
                [attr.aria-invalid]="invalid('email')"
              />
              @if (invalid('email')) {
                <span class="field__error">Enter a valid email address.</span>
              }
            </div>

            <div class="field">
              <label class="field__label" for="password">Password</label>
              <input
                id="password"
                class="input"
                type="password"
                formControlName="password"
                [attr.autocomplete]="mode() === 'sign-in' ? 'current-password' : 'new-password'"
                placeholder="••••••••"
                [attr.aria-invalid]="invalid('password')"
              />
              @if (invalid('password')) {
                <span class="field__error">Passwords must be at least 6 characters.</span>
              }
            </div>

            @if (error(); as message) {
              <p class="auth__error" role="alert">{{ message }}</p>
            }

            <button type="submit" class="btn btn--primary btn--block" [disabled]="busy()">
              {{ busy() ? 'Working…' : mode() === 'sign-in' ? 'Sign in' : 'Create account' }}
            </button>
          </form>

          @if (demoMode()) {
            <button type="button" class="btn btn--ghost btn--block" (click)="enterDemo()">
              Explore the demo — no account needed
            </button>
          }

          <div class="auth__switch">
            @if (mode() === 'sign-in') {
              <span class="small muted">New to Snowball?</span>
              <a routerLink="/auth/sign-up" class="auth__link">Create an account</a>
            } @else {
              <span class="small muted">Already have an account?</span>
              <a routerLink="/auth/sign-in" class="auth__link">Sign in</a>
            }
          </div>

          @if (mode() === 'sign-in' && !demoMode()) {
            <button type="button" class="btn btn--quiet btn--sm" (click)="resetPassword()">
              Forgot your password?
            </button>
          }
        </div>

        <p class="auth__legal">
          Snowball is a personal planning and tracking tool. Projections are estimates, not financial advice.
        </p>
      </section>
    </div>
  `,
  styleUrl: './auth-page.component.scss',
})
export class AuthPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly supabase = inject(SupabaseService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);

  readonly mode = signal<Mode>(
    this.route.snapshot.routeConfig?.path === 'sign-up' ? 'sign-up' : 'sign-in',
  );
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly demoMode = computed(() => !this.supabase.isConfigured);

  readonly points = [
    {
      title: 'A security score, not a guilt trip',
      text: 'How many months of expenses you can cover, and exactly what would move the number.',
    },
    {
      title: 'Flexible spending, on purpose',
      text: 'No rigid monthly budget. See what sits above your security floor and spend it deliberately.',
    },
    {
      title: 'Forecasts with visible assumptions',
      text: 'One, five, ten and twenty years out — with every rate and rule shown alongside.',
    },
  ];

  readonly form = this.fb.nonNullable.group({
    displayName: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  invalid(control: 'email' | 'password'): boolean {
    const field = this.form.controls[control];
    return field.invalid && (field.dirty || field.touched);
  }

  async submit(): Promise<void> {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.busy.set(true);
    const { email, password, displayName } = this.form.getRawValue();

    const result =
      this.mode() === 'sign-in'
        ? await this.auth.signIn(email, password)
        : await this.auth.signUp(email, password, displayName || email.split('@')[0]);

    this.busy.set(false);

    if (!result.ok) {
      this.error.set(result.message ?? 'Something went wrong.');
      return;
    }

    if (result.needsConfirmation) {
      this.toast.info('Check your inbox', 'Confirm your email address, then sign in.');
      await this.router.navigate(['/auth/sign-in']);
      return;
    }

    await this.goToApp();
  }

  enterDemo(): void {
    this.auth.demoSignIn();
    void this.goToApp();
  }

  async resetPassword(): Promise<void> {
    const email = this.form.controls.email.value;
    if (!email) {
      this.error.set('Enter your email address first.');
      return;
    }
    const result = await this.auth.sendPasswordReset(email);
    if (result.ok) this.toast.success('Reset link sent', `Check ${email}.`);
    else this.error.set(result.message ?? 'Could not send the reset link.');
  }

  private async goToApp(): Promise<void> {
    const redirect = this.route.snapshot.queryParamMap.get('redirectTo');
    await this.router.navigateByUrl(redirect && redirect !== '/' ? redirect : '/dashboard');
  }
}
